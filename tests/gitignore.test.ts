import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ensureLoopsRootGitignore,
  ensureRootGitignoreEntry,
} from '../src/lib/gitignore.ts';

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(resolve(tmpdir(), 'cdl-gi-test-'));
});

afterEach(() => {
  try {
    rmSync(tmp, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

describe('ensureRootGitignoreEntry', () => {
  it('creates .gitignore from scratch with the two-line rule', () => {
    const result = ensureRootGitignoreEntry(tmp, 'design-loops');
    expect(result.action).toBe('created');
    expect(result.entries).toEqual([
      'design-loops/*',
      '!design-loops/.gitignore',
    ]);
    const content = readFileSync(result.path, 'utf8');
    expect(content).toContain('design-loops/*');
    expect(content).toContain('!design-loops/.gitignore');
    expect(content).toMatch(/^#/); // starts with header comment
  });

  it('appends entries to an existing .gitignore', () => {
    const path = resolve(tmp, '.gitignore');
    writeFileSync(path, 'node_modules/\n.env\n', 'utf8');
    const result = ensureRootGitignoreEntry(tmp, 'design-loops');
    expect(result.action).toBe('appended');
    const content = readFileSync(path, 'utf8');
    expect(content).toContain('node_modules/');
    expect(content).toContain('.env');
    expect(content).toContain('design-loops/*');
    expect(content).toContain('!design-loops/.gitignore');
  });

  it('handles missing trailing newline gracefully', () => {
    const path = resolve(tmp, '.gitignore');
    writeFileSync(path, '.env', 'utf8'); // no trailing newline
    ensureRootGitignoreEntry(tmp, 'design-loops');
    const content = readFileSync(path, 'utf8');
    expect(content.split('\n').filter(Boolean)).toContain('.env');
    expect(content).toContain('design-loops/*');
  });

  it('is a no-op when the directory is already ignored (`design-loops/`)', () => {
    const path = resolve(tmp, '.gitignore');
    const original = 'design-loops/\n';
    writeFileSync(path, original, 'utf8');
    const result = ensureRootGitignoreEntry(tmp, 'design-loops');
    expect(result.action).toBe('unchanged');
    expect(readFileSync(path, 'utf8')).toBe(original);
  });

  it('recognises the bare directory name (no trailing slash)', () => {
    const path = resolve(tmp, '.gitignore');
    writeFileSync(path, 'design-loops\n', 'utf8');
    const result = ensureRootGitignoreEntry(tmp, 'design-loops');
    expect(result.action).toBe('unchanged');
  });

  it('recognises an existing globbed rule (`design-loops/*`)', () => {
    const path = resolve(tmp, '.gitignore');
    writeFileSync(path, 'design-loops/*\n', 'utf8');
    const result = ensureRootGitignoreEntry(tmp, 'design-loops');
    expect(result.action).toBe('unchanged');
  });

  it('does not match a comment that mentions the dir name', () => {
    const path = resolve(tmp, '.gitignore');
    writeFileSync(path, '# design-loops\n.env\n', 'utf8');
    const result = ensureRootGitignoreEntry(tmp, 'design-loops');
    expect(result.action).toBe('appended');
    const content = readFileSync(path, 'utf8');
    expect(content).toContain('design-loops/*');
  });

  it('does not match a `!design-loops/...` un-ignore line', () => {
    const path = resolve(tmp, '.gitignore');
    writeFileSync(path, '!design-loops/.gitignore\n.env\n', 'utf8');
    const result = ensureRootGitignoreEntry(tmp, 'design-loops');
    expect(result.action).toBe('appended');
  });

  it('respects a custom loopsDir', () => {
    const result = ensureRootGitignoreEntry(tmp, '.cache/design');
    expect(result.entries).toEqual([
      '.cache/design/*',
      '!.cache/design/.gitignore',
    ]);
    const content = readFileSync(result.path, 'utf8');
    expect(content).toContain('.cache/design/*');
    expect(content).toContain('!.cache/design/.gitignore');
  });

  it('strips trailing slashes from the configured loopsDir', () => {
    const result = ensureRootGitignoreEntry(tmp, 'design-loops/');
    expect(result.entries).toEqual([
      'design-loops/*',
      '!design-loops/.gitignore',
    ]);
  });
});

describe('ensureLoopsRootGitignore', () => {
  it('creates the loopsRoot directory and plants .gitignore', () => {
    const loopsRoot = resolve(tmp, 'design-loops');
    expect(existsSync(loopsRoot)).toBe(false);
    const result = ensureLoopsRootGitignore(loopsRoot);
    expect(result.action).toBe('created');
    expect(existsSync(loopsRoot)).toBe(true);
    const content = readFileSync(result.path, 'utf8');
    expect(content).toContain('*\n');
    expect(content).toContain('!.gitignore');
  });

  it('is idempotent when content already matches', () => {
    const loopsRoot = resolve(tmp, 'design-loops');
    ensureLoopsRootGitignore(loopsRoot);
    const result = ensureLoopsRootGitignore(loopsRoot);
    expect(result.action).toBe('unchanged');
  });

  it('does not clobber a customised .gitignore', () => {
    const loopsRoot = resolve(tmp, 'design-loops');
    mkdirSync(loopsRoot, { recursive: true });
    const path = resolve(loopsRoot, '.gitignore');
    const custom = '# I customised this on purpose\n*.tmp\n';
    writeFileSync(path, custom, 'utf8');
    const result = ensureLoopsRootGitignore(loopsRoot);
    expect(result.action).toBe('preserved-custom');
    expect(readFileSync(path, 'utf8')).toBe(custom);
  });
});
