/**
 * Per-repo concurrency guard for browser-driving commands.
 *
 * Why a lock at all: every Claude Design session shares one persistent
 * Chromium profile (so auth state survives between runs). Two sessions
 * touching the same profile at the same time corrupts the profile and
 * fights over the auth state. The lock makes parallelism explicit instead
 * of letting two flows quietly stomp on each other.
 *
 * Scope: per-repo (one lock file at <loopsDir>/.lock.json), regardless of
 * which loopId is being driven. That's intentional — apply/pull/brief
 * don't need a lock since they don't open the browser.
 *
 * Stale detection: we record the pid + start time. If we find an existing
 * lock and the pid is gone (`process.kill(pid, 0)` throws ESRCH), we
 * silently take it over. If the pid is still alive we refuse and tell the
 * user how to inspect/break the lock.
 */

import {
  existsSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { resolve } from 'node:path';
import { ensureLoopsRootGitignore } from './gitignore.ts';

export interface LockInfo {
  pid: number;
  startedAt: string;
  command: string;
  loopId?: string;
}

export interface CheckResult {
  active: boolean;
  alive: boolean;
  info?: LockInfo;
}

export interface AcquireOptions {
  /** What is asking for the lock — for diagnostics in the lock file. */
  command: string;
  /** Optional loopId to record in the lock file. */
  loopId?: string;
  /** When true, silently break a live lock owned by another pid. Default
   * false — caller should prompt the user before passing this. */
  force?: boolean;
}

export interface Lock {
  release: () => void;
}

const LOCK_FILE = '.lock.json';

function lockPath(loopsRoot: string): string {
  return resolve(loopsRoot, LOCK_FILE);
}

export function checkLock(loopsRoot: string): CheckResult {
  const path = lockPath(loopsRoot);
  if (!existsSync(path)) return { active: false, alive: false };
  let info: LockInfo;
  try {
    info = JSON.parse(readFileSync(path, 'utf8')) as LockInfo;
  } catch {
    // Garbage lock file — treat as stale.
    return { active: true, alive: false };
  }
  return { active: true, alive: isProcessAlive(info.pid), info };
}

/** A no-op lock returned when the current pid already owns the lock —
 * lets nested calls (e.g. wizard → submit) request the lock without
 * fighting each other. */
const NOOP_LOCK: Lock = { release: () => {} };

export function acquireLock(loopsRoot: string, opts: AcquireOptions): Lock {
  // Side-effect: also creates `loopsRoot` (recursively) and plants the
  // sub-`.gitignore` so loop run artifacts can't be accidentally committed
  // even if the consumer never ran `design-loop init`.
  ensureLoopsRootGitignore(loopsRoot);
  const path = lockPath(loopsRoot);

  const existing = checkLock(loopsRoot);

  // Nested call from the same process — re-use the existing lock and
  // hand the inner caller a no-op so its release() doesn't unlink early.
  if (existing.active && existing.info?.pid === process.pid) {
    return NOOP_LOCK;
  }

  if (existing.active && existing.alive && !opts.force) {
    const info = existing.info;
    const detail = info
      ? `pid=${info.pid}, started=${info.startedAt}, command=${info.command}${info.loopId ? `, loop=${info.loopId}` : ''}`
      : '(unreadable lock file)';
    throw new LockHeldError(
      `Another design-loop session is running (${detail}). Wait for it to finish, or run with the wizard's force-unlock option once you're sure it's safe.`,
      info,
    );
  }

  const info: LockInfo = {
    pid: process.pid,
    startedAt: new Date().toISOString(),
    command: opts.command,
    loopId: opts.loopId,
  };
  writeFileSync(path, JSON.stringify(info, null, 2) + '\n', 'utf8');

  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    try {
      // Only unlink if the lock still belongs to us. Defensive: prevents
      // accidentally deleting a fresh lock another process took over after
      // we got SIGKILLed.
      const current = checkLock(loopsRoot);
      if (current.info && current.info.pid === process.pid) unlinkSync(path);
    } catch {
      /* best effort */
    }
  };

  // Wire automatic release. We hook the common termination paths;
  // SIGKILL / hard crashes will leave the lock and rely on stale-detection.
  process.once('exit', release);
  process.once('SIGINT', () => {
    release();
    process.exit(130);
  });
  process.once('SIGTERM', () => {
    release();
    process.exit(143);
  });

  return { release };
}

export class LockHeldError extends Error {
  constructor(
    message: string,
    public readonly info?: LockInfo,
  ) {
    super(message);
    this.name = 'LockHeldError';
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // ESRCH = no such process; EPERM = exists but we lack permission.
    // EPERM still means alive, so only treat ESRCH as dead.
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}
