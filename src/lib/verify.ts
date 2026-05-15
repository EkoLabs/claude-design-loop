/**
 * `design-loop verify` — re-capture the live route after apply, and write a
 * report comparing it to the original input screenshots and (if present) the
 * design canvas screenshots from the bundle. Visual diffing is intentionally
 * minimal: side-by-side file references for a human or agent to interpret.
 * The report cross-references which approved checklist items the verifier
 * could (or could not) confirm in the rendered output.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import type { DesignLoopConfig } from '../config.ts';
import { withDefaults } from '../config.ts';
import { captureRoute } from './browser.ts';
import { loopPaths, readManifest } from './loops.ts';

export interface VerifyArgs {
  config: DesignLoopConfig;
  rootDir: string;
  loopId: string;
}

export interface VerifyResult {
  reportPath: string;
  afterScreenshots: string[];
}

export async function runVerify(args: VerifyArgs): Promise<VerifyResult> {
  const config = withDefaults(args.config);
  const loopsRoot = resolve(args.rootDir, config.loopsDir);
  const paths = loopPaths(loopsRoot, args.loopId);
  if (!existsSync(paths.root)) {
    throw new Error(`Loop ${args.loopId} not found.`);
  }
  const manifest = readManifest(paths);

  const afterDir = join(paths.outputDir, 'after');
  mkdirSync(afterDir, { recursive: true });

  const url = joinUrl(manifest.devUrl, manifest.route);
  console.log(`[verify] re-capturing ${url} ...`);
  const capture = await captureRoute({
    url,
    outDir: afterDir,
    breakpoints: manifest.breakpoints,
    settleMs: config.settleMs,
    storageState: config.storageState,
    waitFor: config.waitFor,
  });

  const beforeRefs = manifest.breakpoints.map((bp) => ({
    width: bp,
    path: relative(paths.root, join(paths.inputsDir, `screenshot-${bp}.png`)),
  }));
  const afterRefs = capture.screenshots.map((s) => ({
    width: s.width,
    path: relative(paths.root, s.path),
  }));

  const checklist = readChecklistItems(paths.reviewChecklistPath);

  const md = [
    `# Verify report — ${args.loopId}`,
    '',
    `Route: \`${manifest.route}\``,
    `Captured at: ${new Date().toISOString()}`,
    '',
    '## Before / after screenshots',
    '',
    '| Breakpoint | Before | After |',
    '|---|---|---|',
    ...manifest.breakpoints.map((bp) => {
      const before = beforeRefs.find((b) => b.width === bp)?.path ?? '—';
      const after = afterRefs.find((a) => a.width === bp)?.path ?? '—';
      return `| ${bp}px | \`${before}\` | \`${after}\` |`;
    }),
    '',
    '## Review checklist items',
    checklist.length
      ? checklist
          .map((it) => `- [ ] confirm in render: ${it}`)
          .join('\n')
      : '_(no items in the checklist — generate one with `design:pull` first)_',
    '',
    '## Next step',
    '',
    'Open the after-screenshots side-by-side with the before-screenshots and the',
    'Claude Design canvas. Tick the items above that the rendered output actually',
    'reflects. Anything not ticked = either not implemented or implemented incorrectly.',
    '',
  ].join('\n');

  writeFileSync(paths.verifyReportPath, md, 'utf8');
  console.log(`[verify] wrote ${paths.verifyReportPath}`);

  return {
    reportPath: paths.verifyReportPath,
    afterScreenshots: capture.screenshots.map((s) => s.path),
  };
}

function joinUrl(base: string, route: string): string {
  const b = base.replace(/\/+$/, '');
  const r = route.startsWith('/') ? route : `/${route}`;
  return `${b}${r}`;
}

function readChecklistItems(path: string): string[] {
  if (!existsSync(path)) return [];
  const md = readFileSync(path, 'utf8');
  const items: string[] = [];
  for (const line of md.split('\n')) {
    const m = line.match(/^\s*-\s*\[(x|X)\]\s+(.+)/);
    if (m && m[2]) items.push(m[2].trim());
  }
  return items;
}
