/**
 * `design-loop fetch <loopId>` — bring a finished design back into the repo.
 *
 * Workflow:
 *   1. Read the loop's manifest to find the saved Claude Design project URL
 *      (or accept --project-url to override).
 *   2. Open the project, click Share → Handoff to Claude Code, scrape the
 *      bundle URL from the modal.
 *   3. Hand off to `runPull` which downloads + expands the bundle.
 *
 * Run this when you've reviewed the design in Claude Design and you're
 * happy with it. Until then, `submit` only leaves the project running and
 * doesn't pull anything down — so iteration in claude.ai/design doesn't
 * fight with our local artifact storage.
 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { DesignLoopConfig } from '../config.ts';
import { withDefaults } from '../config.ts';
import { runApply } from './apply.ts';
import {
  defaultAuthPaths,
  fetchHandoffBundleUrl,
  type AuthPaths,
} from './claude-design.ts';
import { offerClipboardCopy, writeCursorPrompt } from './cursor-prompt.ts';
import { acquireLock } from './lock.ts';
import { loopPaths, readManifest } from './loops.ts';
import { runPull } from './pull.ts';

export interface FetchArgs {
  config: DesignLoopConfig;
  rootDir: string;
  loopId: string;
  /** Override the project URL stored in the manifest. */
  projectUrl?: string;
  /** Show the browser window. */
  headed?: boolean;
  /** Skip the pull step (just print the bundle URL). */
  noPull?: boolean;
  /** Skip the auto-apply step that runs after pull. */
  noApply?: boolean;
}

export interface FetchOutcome {
  projectUrl: string;
  bundleUrl: string;
  pulled: boolean;
  applied: boolean;
  translatedFiles: string[];
}

export async function runFetch(args: FetchArgs): Promise<FetchOutcome> {
  const config = withDefaults(args.config);
  const loopsRoot = resolve(args.rootDir, config.loopsDir);
  const paths = loopPaths(loopsRoot, args.loopId);
  if (!existsSync(paths.manifestPath)) {
    throw new Error(`Loop ${args.loopId} not found at ${paths.root}.`);
  }
  const lock = acquireLock(loopsRoot, {
    command: 'fetch',
    loopId: args.loopId,
  });
  try {
    return await runFetchInner(args, config, paths);
  } finally {
    lock.release();
  }
}

async function runFetchInner(
  args: FetchArgs,
  config: ReturnType<typeof withDefaults>,
  paths: ReturnType<typeof loopPaths>,
): Promise<FetchOutcome> {

  const manifest = readManifest(paths);
  const projectUrl = args.projectUrl ?? manifest.claudeProjectUrl;
  if (!projectUrl) {
    throw new Error(
      `No Claude Design project URL on record for ${args.loopId}. Pass --project-url=<url>, or run \`design-loop submit ${args.loopId}\` first to create + save the project.`,
    );
  }

  const authPaths = resolveAuthPaths(config);
  if (!existsSync(authPaths.storageState)) {
    throw new Error(
      `No saved Claude Design auth at ${authPaths.storageState}. Run \`design-loop login\` first.`,
    );
  }

  console.log(`[fetch] opening ${projectUrl} ...`);
  const bundleUrl = await fetchHandoffBundleUrl({
    authPaths,
    projectUrl,
    headed: args.headed,
  });
  console.log(`[fetch] captured handoff bundle: ${bundleUrl}`);

  if (args.noPull) {
    console.log(`[fetch] --no-pull set. Run pull manually:`);
    console.log(`    design-loop pull ${args.loopId} --bundle-url=${bundleUrl}`);
    return {
      projectUrl,
      bundleUrl,
      pulled: false,
      applied: false,
      translatedFiles: [],
    };
  }

  await runPull({
    config: args.config,
    rootDir: args.rootDir,
    loopId: args.loopId,
    bundleSource: bundleUrl,
  });

  let applied = false;
  let translatedFiles: string[] = [];
  if (!args.noApply) {
    try {
      console.log('[fetch] translating bundle to framework scaffolds ...');
      const applyResult = await runApply({
        config: args.config,
        rootDir: args.rootDir,
        loopId: args.loopId,
        silent: true,
      });
      applied = true;
      translatedFiles = applyResult.translatedFiles;
    } catch (err) {
      console.warn(
        `[fetch] apply step failed (continuing — bundle is still pulled): ${(err as Error).message}`,
      );
    }
  }

  console.log('');
  if (applied) {
    console.log('  ✦ Done. Bundle pulled, scaffolds written:');
    for (const f of translatedFiles) console.log(`      ${f}`);

    let promptResult = null;
    try {
      promptResult = await writeCursorPrompt({
        config: args.config,
        rootDir: args.rootDir,
        loopId: args.loopId,
        translatedFiles,
      });
    } catch (err) {
      console.warn(`[fetch] could not build Cursor prompt: ${(err as Error).message}`);
    }

    console.log('');
    if (promptResult) {
      await offerClipboardCopy(promptResult, { interactive: true });
    } else {
      console.log('  Next: open Cursor chat and ask it to merge the scaffold into the live route.');
    }
    console.log('');
    console.log(`  Verify: design-loop verify ${args.loopId}`);
  } else {
    console.log('  Bundle pulled. Re-run apply manually if needed:');
      console.log(`      design-loop apply ${args.loopId}`);
  }
  console.log('');

  return { projectUrl, bundleUrl, pulled: true, applied, translatedFiles };
}

function resolveAuthPaths(config: ReturnType<typeof withDefaults>): AuthPaths {
  const fallback = defaultAuthPaths();
  if (!config.storageState) return fallback;
  return {
    storageState: config.storageState,
    profileDir: fallback.profileDir,
  };
}
