import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  acquireLock,
  checkLock,
  LockHeldError,
  type LockInfo,
} from '../src/lib/lock.ts';

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(resolve(tmpdir(), 'cdl-lock-test-'));
});

afterEach(() => {
  try {
    rmSync(tmp, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

describe('lock', () => {
  it('checkLock reports `active: false` when no lock exists', () => {
    expect(checkLock(tmp)).toEqual({ active: false, alive: false });
  });

  it('acquireLock writes a lock file and release removes it', () => {
    const lock = acquireLock(tmp, { command: 'test' });
    const status = checkLock(tmp);
    expect(status.active).toBe(true);
    expect(status.alive).toBe(true);
    expect(status.info?.pid).toBe(process.pid);
    expect(status.info?.command).toBe('test');

    lock.release();
    expect(checkLock(tmp).active).toBe(false);
  });

  it('acquireLock returns a no-op when the same pid already holds the lock', () => {
    const outer = acquireLock(tmp, { command: 'outer' });
    const inner = acquireLock(tmp, { command: 'inner' });
    inner.release(); // no-op
    expect(checkLock(tmp).active).toBe(true);
    outer.release();
    expect(checkLock(tmp).active).toBe(false);
  });

  it('acquireLock throws LockHeldError when another live pid owns the lock', () => {
    const otherPid = process.pid; // any pid that's known to be alive
    const fakeInfo: LockInfo = {
      pid: otherPid,
      startedAt: new Date().toISOString(),
      command: 'someone-else',
    };
    // Simulate a lock that doesn't belong to us by writing one with our pid
    // but using a different command, then bypassing the same-pid noop by
    // writing for a *different* live pid.
    // Here we use pid=1 (init) which is always alive on Unix.
    const initPid = process.platform === 'win32' ? otherPid : 1;
    fakeInfo.pid = initPid;
    writeFileSync(
      resolve(tmp, '.lock.json'),
      JSON.stringify(fakeInfo, null, 2),
      'utf8',
    );

    if (initPid === process.pid) {
      // win32 fallback: same-pid path returns a noop, not a throw — skip the
      // strict assertion but still validate checkLock semantics.
      const status = checkLock(tmp);
      expect(status.active).toBe(true);
      return;
    }

    expect(() => acquireLock(tmp, { command: 'me' })).toThrow(LockHeldError);
  });

  it('acquireLock silently overwrites a stale lock (process gone)', () => {
    const stalePid = 0xfffffe; // wildly unlikely to exist
    const stale: LockInfo = {
      pid: stalePid,
      startedAt: new Date(0).toISOString(),
      command: 'ghost',
    };
    writeFileSync(
      resolve(tmp, '.lock.json'),
      JSON.stringify(stale, null, 2),
      'utf8',
    );

    const status = checkLock(tmp);
    expect(status.active).toBe(true);
    expect(status.alive).toBe(false);

    const lock = acquireLock(tmp, { command: 'me' });
    const after = checkLock(tmp);
    expect(after.active).toBe(true);
    expect(after.info?.pid).toBe(process.pid);
    lock.release();
  });

  it('checkLock treats garbage lock files as stale', () => {
    writeFileSync(resolve(tmp, '.lock.json'), 'not-json', 'utf8');
    const status = checkLock(tmp);
    expect(status.active).toBe(true);
    expect(status.alive).toBe(false);
  });
});
