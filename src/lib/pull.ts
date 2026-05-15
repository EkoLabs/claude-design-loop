/**
 * `design-loop pull` — the inbound half of the loop.
 *
 * Takes a Claude Design handoff bundle URL (or a path to a downloaded .zip)
 * and a loop id. Expands the bundle into the loop dir. If Claude happens
 * to have produced a `RECOMMENDATIONS.md` artifact (rare in the new flow,
 * but supported), it gets surfaced at the loop root for easy review.
 *
 * If the URL points at `api.anthropic.com/v1/design/h/<id>`, the package
 * tries an unauthenticated fetch first. If that returns 401/403, it falls
 * back to a "manual mode" where the user is told to download the bundle
 * themselves and pass `--bundle-path=...`.
 */

import {
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  closeSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { extname, join, resolve } from 'node:path';
import type { DesignLoopConfig } from '../config.ts';
import { loopPaths, readManifest, writeManifest } from './loops.ts';

export interface PullArgs {
  config: DesignLoopConfig;
  rootDir: string;
  loopId: string;
  /** Either a URL (preferred) or a path to a downloaded bundle .zip. */
  bundleSource: string;
}

export interface PullResult {
  bundleDir: string;
  recommendationsPath: string | null;
  reviewChecklistPath: string;
  files: string[];
}

export async function runPull(args: PullArgs): Promise<PullResult> {
  const loopsRoot = resolve(args.rootDir, args.config.loopsDir ?? 'design-loops');
  const paths = loopPaths(loopsRoot, args.loopId);
  if (!existsSync(paths.root)) {
    throw new Error(
      `Loop ${args.loopId} not found at ${paths.root}. Did you run \`brief\` first?`,
    );
  }
  mkdirSync(paths.bundleDir, { recursive: true });

  console.log(`[pull] expanding bundle into ${paths.bundleDir} ...`);
  const sourceUrl = await materializeBundle(args.bundleSource, paths.bundleDir);
  const files = walkFiles(paths.bundleDir).map((p) =>
    p.slice(paths.bundleDir.length + 1),
  );

  // Opportunistic surface: if Claude happened to produce a RECOMMENDATIONS.md
  // (or similar prose artifact) in the bundle, copy it to <loopRoot>/RECOMMENDATIONS.md
  // so reviewers don't have to dig. The new flow doesn't require this — the
  // canvas IS the deliverable — but we still expose it when present.
  const recDestPath = join(paths.root, 'RECOMMENDATIONS.md');
  const recPath = surfaceRecommendations(paths.bundleDir, recDestPath);
  const checklistPath = writeReviewChecklist(
    paths.reviewChecklistPath,
    recPath ? readFileSync(recPath, 'utf8') : null,
    args.loopId,
  );

  const manifest = readManifest(paths);
  manifest.bundle = {
    sourceUrl,
    fetchedAt: new Date().toISOString(),
    files,
  };
  writeManifest(paths, manifest);

  if (recPath) {
    console.log(`[pull] surfaced ${recPath}`);
  }
  console.log(`[pull] expanded ${files.length} files into ${paths.bundleDir}`);
  console.log(`[pull] review checklist: ${checklistPath}`);

  return {
    bundleDir: paths.bundleDir,
    recommendationsPath: recPath,
    reviewChecklistPath: checklistPath,
    files,
  };
}

async function materializeBundle(source: string, destDir: string): Promise<string> {
  if (/^https?:\/\//i.test(source)) {
    const tmp = join(destDir, '.bundle.archive');
    await downloadToFile(source, tmp);
    await extractArchive(tmp, destDir);
    // Clean up the temp archive after a successful extraction. Failed
    // extracts intentionally leave it behind for debugging.
    try {
      unlinkSync(tmp);
    } catch {
      /* ignore — best-effort cleanup */
    }
    return source;
  }
  const abs = resolve(source);
  if (!existsSync(abs)) {
    throw new Error(`Bundle source ${source} does not exist.`);
  }
  // Don't delete user-provided archives — only our own temp downloads.
  await extractArchive(abs, destDir);
  return abs;
}

async function downloadToFile(url: string, dest: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      throw new Error(
        `Bundle URL returned ${res.status}. The handoff endpoint may require an authenticated browser session.\n` +
          `Workaround: download the bundle manually from claude.ai/design and rerun \`design-loop pull <loopId> --bundle-path=<file>\`.`,
      );
    }
    throw new Error(`Bundle URL returned ${res.status}: ${res.statusText}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(dest, buf);
}

/**
 * Extract a Claude Design handoff bundle, auto-detecting the format from
 * magic bytes (we don't trust extensions because the URL has none and our
 * temp-download writes `.bundle.archive`).
 *
 * Anthropic's `/v1/design/h/<id>` endpoint serves **gzipped tar** as of
 * May 2026. Earlier docs / community examples sometimes call it a "zip
 * bundle" so we keep zip support as a fallback in case the format flips
 * back, or in case a user manually exported in a different format.
 *
 * Magic-byte sniffing is more robust than extension-based dispatch
 * because we control neither the URL nor the temp filename precisely.
 */
async function extractArchive(archivePath: string, destDir: string): Promise<void> {
  const fmt = detectArchiveFormat(archivePath);
  if (fmt === 'tar.gz') return extractTarGz(archivePath, destDir);
  if (fmt === 'zip') return extractZip(archivePath, destDir);
  throw new Error(
    `Unrecognized bundle archive at ${archivePath} (magic bytes don't match gzip or zip). Inspect the file and report — Claude Design's handoff format may have changed.`,
  );
}

type ArchiveFormat = 'tar.gz' | 'zip' | 'unknown';

function detectArchiveFormat(path: string): ArchiveFormat {
  const fd = openSync(path, 'r');
  try {
    const buf = Buffer.alloc(4);
    readSync(fd, buf, 0, 4, 0);
    // gzip: 1f 8b — used by .tar.gz
    if (buf[0] === 0x1f && buf[1] === 0x8b) return 'tar.gz';
    // zip: 50 4b 03 04 (or 50 4b 05 06 / 50 4b 07 08 for empty / spanned)
    if (buf[0] === 0x50 && buf[1] === 0x4b) return 'zip';
    // Last-chance: trust the extension if magic was inconclusive (e.g. an
    // empty file or odd corruption).
    const ext = extname(path).toLowerCase();
    if (ext === '.zip') return 'zip';
    if (ext === '.gz' || ext === '.tgz' || ext === '.tar') return 'tar.gz';
    return 'unknown';
  } finally {
    closeSync(fd);
  }
}

async function extractTarGz(archivePath: string, destDir: string): Promise<void> {
  const { spawnSync } = await import('node:child_process');
  const result = spawnSync('tar', ['-xzf', archivePath, '-C', destDir], {
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    throw new Error(
      `tar -xzf failed (exit ${result.status}). Is GNU/BSD tar on PATH?`,
    );
  }
}

async function extractZip(zipPath: string, destDir: string): Promise<void> {
  const { spawnSync } = await import('node:child_process');
  const result = spawnSync('unzip', ['-o', zipPath, '-d', destDir], {
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    throw new Error(`unzip failed (exit ${result.status}). Is unzip on PATH?`);
  }
}

function surfaceRecommendations(bundleDir: string, destPath: string): string | null {
  const found = findFile(bundleDir, /^recommendations\.md$/i);
  if (!found) return null;
  const content = readFileSync(found, 'utf8');
  writeFileSync(destPath, content, 'utf8');
  return destPath;
}

function findFile(dir: string, match: RegExp): string | null {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = findFile(full, match);
      if (nested) return nested;
    } else if (match.test(entry.name)) {
      return full;
    }
  }
  return null;
}

function walkFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkFiles(full));
    } else {
      out.push(full);
    }
  }
  return out;
}

/**
 * Generate a flat checklist from the recommendations doc. Best-effort: looks
 * for numbered list items in any "issues found" / "proposed changes" /
 * "approved changes implemented" section. Anything we can't parse becomes a
 * single "review the doc" item — the human can hand-edit the checklist.
 */
function writeReviewChecklist(
  destPath: string,
  recommendationsMd: string | null,
  loopId: string,
): string {
  const items = recommendationsMd ? extractChecklistItems(recommendationsMd) : [];
  const body = [
    `# Review checklist — ${loopId}`,
    '',
    'Tick items you want to implement. Items left unchecked will be skipped',
    'by `design-loop apply`. Items marked with ✗ will be explicitly excluded.',
    '',
    items.length
      ? items.map((it) => `- [ ] ${it}`).join('\n')
      : '- [ ] Review `RECOMMENDATIONS.md` and add items here manually.',
    '',
    '## Notes',
    '',
    '_(free-form notes for the agent — anything you want it to know)_',
    '',
  ].join('\n');
  writeFileSync(destPath, body, 'utf8');
  return destPath;
}

function extractChecklistItems(md: string): string[] {
  const lines = md.split('\n');
  const items: string[] = [];
  let inRelevantSection = false;
  const relevant =
    /^##\s*(ux\s*issues|proposed\s*changes|approved\s*changes|implementation)/i;
  for (const line of lines) {
    if (/^##\s/.test(line)) {
      inRelevantSection = relevant.test(line);
      continue;
    }
    if (!inRelevantSection) continue;
    const numbered = line.match(/^\s*\d+\.\s+(.*)/);
    if (numbered && numbered[1]) {
      items.push(numbered[1].trim().slice(0, 200));
    }
  }
  return items;
}
