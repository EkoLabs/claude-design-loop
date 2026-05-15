/**
 * .gitignore management for consumer repos.
 *
 * design-loop writes per-machine working state under `<repo>/<loopsDir>/`
 * (bundles, screenshots, scaffolds, manifests, lockfile). None of it
 * should ever be committed. We protect against accidental commits with
 * two complementary mechanisms:
 *
 *   1. `ensureRootGitignoreEntry` — invoked by `design-loop init`.
 *      Appends `<loopsDir>/` to the consumer's repo-level `.gitignore`
 *      so teammates see and review the rule via normal git workflow.
 *
 *   2. `ensureLoopsRootGitignore` — invoked on every loop run via
 *      `acquireLock`. Plants `<loopsRoot>/.gitignore` containing
 *      `*\n!.gitignore\n`, which makes git ignore everything inside
 *      regardless of root-level config. Belt-and-suspenders against
 *      a missing/edited root rule, and the sub-gitignore itself is the
 *      only file in the directory we *do* want committed so teammates
 *      inherit the protection without needing to run `init`.
 *
 * Both helpers are idempotent and refuse to clobber existing user
 * customisations.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const SUB_GITIGNORE_CONTENT =
  '# Auto-managed by @ekolabs/claude-design-loop. All loop run output\n' +
  '# is local working state and should never be committed. The only\n' +
  '# thing checked in here is this .gitignore itself.\n' +
  '*\n' +
  '!.gitignore\n';

export interface RootGitignoreResult {
  /** Absolute path of the .gitignore we touched. */
  path: string;
  /** What we did: `created`, `appended`, or `unchanged`. */
  action: 'created' | 'appended' | 'unchanged';
  /**
   * The two lines we ensured are present. The first ignores the
   * directory contents; the second un-ignores the directory's own
   * `.gitignore` so teammates inherit the second-layer protection
   * via normal git workflow.
   */
  entries: [string, string];
}

/**
 * Make sure `<loopsDir>/` is properly ignored in `<rootDir>/.gitignore`.
 * We write a two-line rule:
 *
 *   <loopsDir>/*
 *   !<loopsDir>/.gitignore
 *
 * The first line ignores everything under `<loopsDir>/` (loop runs,
 * bundles, screenshots, scaffolds, manifests, lockfile). The second
 * line punches a hole for the sub-`.gitignore` we plant on every loop
 * run, so it propagates through git to teammates and survives even if
 * someone later edits the root rule.
 *
 * Recognises any pre-existing rule that already ignores the directory
 * in a recognisable form (`design-loops`, `design-loops/`,
 * `design-loops/*`) and is fully idempotent in that case — never
 * clobbers user customisations.
 */
export function ensureRootGitignoreEntry(
  rootDir: string,
  loopsDir: string,
): RootGitignoreResult {
  const path = resolve(rootDir, '.gitignore');
  const trimmedDir = loopsDir.replace(/\/+$/, '');
  const ignore = `${trimmedDir}/*`;
  const unignore = `!${trimmedDir}/.gitignore`;
  const entries: [string, string] = [ignore, unignore];

  if (!existsSync(path)) {
    const header =
      '# Auto-added by @ekolabs/claude-design-loop. Local design-loop\n' +
      '# working state — bundles, screenshots, scaffolds, manifests.\n' +
      `# (\`!${trimmedDir}/.gitignore\` lets the sub-gitignore propagate.)\n`;
    writeFileSync(path, `${header}${ignore}\n${unignore}\n`, 'utf8');
    return { path, action: 'created', entries };
  }

  const current = readFileSync(path, 'utf8');
  if (hasIgnoreEntry(current, loopsDir)) {
    return { path, action: 'unchanged', entries };
  }

  const needsLeadingNewline = current.length > 0 && !current.endsWith('\n');
  const block =
    `${needsLeadingNewline ? '\n' : ''}` +
    `\n# @ekolabs/claude-design-loop — local loop run output\n` +
    `${ignore}\n${unignore}\n`;
  writeFileSync(path, current + block, 'utf8');
  return { path, action: 'appended', entries };
}

/**
 * Returns true if `content` already ignores the loops directory in any
 * recognisable form. We intentionally match on the directory name only,
 * not on adjacent flags/comments, so a manual rule is honoured.
 */
function hasIgnoreEntry(content: string, loopsDir: string): boolean {
  const trimmedDir = loopsDir.replace(/\/+$/, '');
  const candidates = new Set([
    `${trimmedDir}`,
    `${trimmedDir}/`,
    `${trimmedDir}/*`,
    `/${trimmedDir}`,
    `/${trimmedDir}/`,
    `/${trimmedDir}/*`,
    `**/${trimmedDir}`,
    `**/${trimmedDir}/`,
    `**/${trimmedDir}/*`,
  ]);
  for (const raw of content.split('\n')) {
    const line = raw.replace(/^\s+|\s+$/g, '');
    if (!line || line.startsWith('#') || line.startsWith('!')) continue;
    if (candidates.has(line)) return true;
  }
  return false;
}

export interface LoopsRootGitignoreResult {
  path: string;
  action: 'created' | 'unchanged' | 'preserved-custom';
}

/**
 * Plant a `.gitignore` inside `<loopsRoot>/` that ignores everything
 * except itself. Idempotent: if the file already exists with our exact
 * content we no-op; if it exists with different content we leave it
 * alone (someone customised it on purpose).
 */
export function ensureLoopsRootGitignore(
  loopsRoot: string,
): LoopsRootGitignoreResult {
  mkdirSync(loopsRoot, { recursive: true });
  const path = resolve(loopsRoot, '.gitignore');

  if (!existsSync(path)) {
    writeFileSync(path, SUB_GITIGNORE_CONTENT, 'utf8');
    return { path, action: 'created' };
  }

  const current = readFileSync(path, 'utf8');
  if (current === SUB_GITIGNORE_CONTENT) {
    return { path, action: 'unchanged' };
  }
  return { path, action: 'preserved-custom' };
}
