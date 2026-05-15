/**
 * Loop directory layout + ID conventions.
 *
 * Each loop run is a self-contained folder under `<repo>/<loopsDir>/<id>/`.
 * The ID is `<iso-timestamp>-<route-slug>` so directory listing is naturally
 * chronological and self-describing.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { ensureLoopsRootGitignore } from './gitignore.ts';

export interface LoopPaths {
  id: string;
  root: string;
  inputsDir: string;
  bundleDir: string;
  outputDir: string;
  briefPath: string;
  manifestPath: string;
  reviewChecklistPath: string;
  verifyReportPath: string;
}

export interface LoopManifest {
  id: string;
  createdAt: string;
  route: string;
  framework: string;
  devUrl: string;
  designSystem: { name: string; id?: string };
  breakpoints: number[];
  /** URL of the Claude Design project that was created for this loop. Set
   * by `submit` so subsequent `fetch`/`pull` runs can reuse it without the
   * user pasting URLs around. */
  claudeProjectUrl?: string;
  /** Set after `fetch` or `pull` runs. */
  bundle?: {
    sourceUrl: string;
    fetchedAt: string;
    files: string[];
  };
  /** Set after `apply` runs. */
  apply?: {
    appliedAt: string;
    targetFiles: string[];
    skippedItems: string[];
  };
}

export function slugifyRoute(route: string): string {
  const trimmed = route.replace(/^\/+|\/+$/g, '');
  if (!trimmed) return 'root';
  return trimmed.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
}

export function makeLoopId(route: string, when = new Date()): string {
  const iso = when.toISOString().replace(/[:.]/g, '-').replace('Z', '');
  return `${iso}-${slugifyRoute(route)}`;
}

/** Human-friendly name for the new Claude Design project, e.g.
 *  `/canonical — 2026-05-15 14:16`. Used as the default in the wizard. */
export function prettyProjectName(route: string, when = new Date()): string {
  const yyyy = when.getFullYear();
  const mm = String(when.getMonth() + 1).padStart(2, '0');
  const dd = String(when.getDate()).padStart(2, '0');
  const hh = String(when.getHours()).padStart(2, '0');
  const mi = String(when.getMinutes()).padStart(2, '0');
  return `${route} \u2014 ${yyyy}-${mm}-${dd} ${hh}:${mi}`;
}

export function loopPaths(loopsRoot: string, id: string): LoopPaths {
  const root = resolve(loopsRoot, id);
  return {
    id,
    root,
    inputsDir: join(root, 'inputs'),
    bundleDir: join(root, 'bundle'),
    outputDir: join(root, 'output'),
    briefPath: join(root, 'brief.md'),
    manifestPath: join(root, 'manifest.json'),
    reviewChecklistPath: join(root, 'review-checklist.md'),
    verifyReportPath: join(root, 'verify-report.md'),
  };
}

export function ensureLoopDirs(paths: LoopPaths): void {
  // Plant the sub-`.gitignore` in loopsRoot before the loop subdir is
  // created, so even capture-only flows (`brief` without `submit`) get
  // the safety net. Idempotent.
  ensureLoopsRootGitignore(dirname(paths.root));
  mkdirSync(paths.root, { recursive: true });
  mkdirSync(paths.inputsDir, { recursive: true });
}

export function writeManifest(paths: LoopPaths, manifest: LoopManifest): void {
  writeFileSync(paths.manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
}

export function readManifest(paths: LoopPaths): LoopManifest {
  return JSON.parse(readFileSync(paths.manifestPath, 'utf8')) as LoopManifest;
}
