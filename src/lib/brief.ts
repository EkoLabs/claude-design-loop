/**
 * `design-loop brief` — the outbound half of the loop.
 *
 * Captures the current state of a route (screenshots + DOM snapshot) and
 * writes a short brief.md the user (or `submit`) sends to Claude Design.
 *
 * The brief is intentionally short. The job here is to capture **the visual
 * truth** (screenshots) and let Claude Design do the design work. We don't
 * inline 10kb of project docs into the prompt anymore — that biases Claude
 * toward "implement this exactly as described" instead of "redesign this".
 */

import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { DesignLoopConfig, DesignSystemRef } from '../config.ts';
import { getDefaultDesignSystem, withDefaults } from '../config.ts';
import { captureRoute } from './browser.ts';
import {
  ensureLoopDirs,
  loopPaths,
  makeLoopId,
  writeManifest,
  type LoopManifest,
} from './loops.ts';
import { renderBrief } from './templates.ts';

export interface BriefArgs {
  config: DesignLoopConfig;
  rootDir: string;
  route: string;
  /** Override config breakpoints. */
  breakpoints?: number[];
  /** Optional one-line intent passed through to the brief template. */
  intent?: string;
  /** Override the design system. Default: first entry from `config.designSystem`. */
  designSystem?: DesignSystemRef;
}

export interface BriefResult {
  loopId: string;
  briefPath: string;
  inputsDir: string;
  manifestPath: string;
}

export async function runBrief(args: BriefArgs): Promise<BriefResult> {
  const config = withDefaults(args.config);

  if (config.excludeRoutes.includes(args.route)) {
    throw new Error(
      `Route \`${args.route}\` is excluded by config (\`excludeRoutes\`). Refusing to run.`,
    );
  }

  const breakpoints = args.breakpoints ?? config.breakpoints;
  const id = makeLoopId(args.route);
  const paths = loopPaths(resolve(args.rootDir, config.loopsDir), id);
  ensureLoopDirs(paths);

  const url = joinUrl(config.devUrl, args.route);
  console.log(`[brief] capturing ${url} at [${breakpoints.join(', ')}]px ...`);

  const capture = await captureRoute({
    url,
    outDir: paths.inputsDir,
    breakpoints,
    settleMs: config.settleMs,
    storageState: config.storageState,
    waitFor: config.waitFor,
  });

  const designSystem = args.designSystem ?? getDefaultDesignSystem(args.config);
  const briefMarkdown = renderBrief({
    framework: config.framework,
    route: args.route,
    pageTitle: capture.pageTitle,
    designSystemName: designSystem.name,
    intent: args.intent,
    breakpoints,
  });

  writeFileSync(paths.briefPath, briefMarkdown, 'utf8');

  const manifest: LoopManifest = {
    id,
    createdAt: new Date().toISOString(),
    route: args.route,
    framework: config.framework,
    devUrl: config.devUrl,
    designSystem,
    breakpoints,
  };
  writeManifest(paths, manifest);

  console.log(`[brief] wrote ${paths.briefPath}`);
  console.log(`[brief] loop id: ${id}`);
  console.log(
    `[brief] inputs/ has ${capture.screenshots.length} screenshot(s). Edit brief.md if you want to add a one-line intent before submit.`,
  );
  return {
    loopId: id,
    briefPath: paths.briefPath,
    inputsDir: paths.inputsDir,
    manifestPath: paths.manifestPath,
  };
}

function joinUrl(base: string, route: string): string {
  const b = base.replace(/\/+$/, '');
  const r = route.startsWith('/') ? route : `/${route}`;
  return `${b}${r}`;
}
