/**
 * `design-loop resume <loopId>` — pick up an existing Claude Design
 * session without losing in-flight design work.
 *
 * Use cases:
 *   - You ran `submit --headed`, started designing, then the browser
 *     window got closed (you multi-tasked, terminal got SIGTERM, the
 *     laptop slept too long, etc). The Claude Design project is still
 *     alive on the server, and you don't want to re-submit the brief.
 *   - You came back the next day and want to keep iterating with
 *     Claude on a previous design.
 *
 * Reuses the same interactive review prompt as `submit`. If Claude was
 * mid-generation when the prior session was interrupted, we'll watch
 * activity and only prompt once it goes quiet; if it was already settled,
 * you get prompted immediately.
 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { DesignLoopConfig } from '../config.ts';
import { withDefaults } from '../config.ts';
import { runApply } from './apply.ts';
import {
  defaultAuthPaths,
  resumeReview,
  type AuthPaths,
  type ReviewAction,
  type ReviewContext,
} from './claude-design.ts';
import { offerClipboardCopy, writeCursorPrompt, type PromptResult } from './cursor-prompt.ts';
import { acquireLock } from './lock.ts';
import { loopPaths, readManifest, writeManifest } from './loops.ts';
import { promptChoice } from './prompt.ts';
import { runPull } from './pull.ts';

export interface ResumeArgs {
  config: DesignLoopConfig;
  rootDir: string;
  loopId: string;
  /** Override the manifest-saved project URL. */
  projectUrl?: string;
  /** Show the browser window. Required for the interactive prompt to be
   * meaningful — you can't iterate on a design you can't see. */
  headed?: boolean;
  /** Skip the interactive prompt (e.g. for CI / scripts). */
  noInteractive?: boolean;
  /** Skip the auto-apply step that runs after a successful fetch. */
  noApply?: boolean;
}

export interface ResumeOutcome {
  projectUrl: string;
  bundleUrl: string | null;
  pulled: boolean;
  applied: boolean;
  translatedFiles: string[];
}

export async function runResume(args: ResumeArgs): Promise<ResumeOutcome> {
  const config = withDefaults(args.config);
  const loopsRoot = resolve(args.rootDir, config.loopsDir);
  const paths = loopPaths(loopsRoot, args.loopId);
  if (!existsSync(paths.manifestPath)) {
    throw new Error(`Loop ${args.loopId} not found at ${paths.root}.`);
  }
  const lock = acquireLock(loopsRoot, {
    command: 'resume',
    loopId: args.loopId,
  });
  try {
    return await runResumeInner(args, config, paths);
  } finally {
    lock.release();
  }
}

async function runResumeInner(
  args: ResumeArgs,
  config: ReturnType<typeof withDefaults>,
  paths: ReturnType<typeof loopPaths>,
): Promise<ResumeOutcome> {

  const manifest = readManifest(paths);
  const projectUrl = args.projectUrl ?? manifest.claudeProjectUrl;
  if (!projectUrl) {
    throw new Error(
      `No Claude Design project URL on record for ${args.loopId}. Pass --project-url=<url>, or run \`design-loop submit ${args.loopId}\` if you haven't started a session yet.`,
    );
  }

  const authPaths = resolveAuthPaths(config);
  if (!existsSync(authPaths.storageState)) {
    throw new Error(
      `No saved Claude Design auth at ${authPaths.storageState}. Run \`design-loop login\` first.`,
    );
  }

  const wantInteractive =
    !args.noInteractive && process.stdin.isTTY === true && args.headed === true;

  console.log(`[resume] loop=${args.loopId} interactive=${wantInteractive}`);
  if (args.noInteractive !== true && args.headed !== true) {
    console.log(
      '[resume] --headed not set; running non-interactive (exits after first design settle).',
    );
  }

  const result = await resumeReview({
    authPaths,
    projectUrl,
    headed: args.headed,
    review: wantInteractive ? buildReviewHook() : undefined,
  });

  // Manifest already had this URL; re-save in case --project-url overrode it.
  if (result.projectUrl !== manifest.claudeProjectUrl) {
    manifest.claudeProjectUrl = result.projectUrl;
    writeManifest(paths, manifest);
  }

  let pulled = false;
  let applied = false;
  let translatedFiles: string[] = [];
  if (result.bundleUrl) {
    console.log(`[resume] bundle URL: ${result.bundleUrl}`);
    console.log('[resume] expanding bundle locally ...');
    await runPull({
      config: args.config,
      rootDir: args.rootDir,
      loopId: args.loopId,
      bundleSource: result.bundleUrl,
    });
    pulled = true;

    if (!args.noApply) {
      try {
        console.log('[resume] translating bundle to framework scaffolds ...');
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
          `[resume] apply step failed (continuing — bundle is still pulled): ${(err as Error).message}`,
        );
      }
    }
  }

  let promptResult: PromptResult | null = null;
  if (applied && translatedFiles.length) {
    try {
      promptResult = await writeCursorPrompt({
        config: args.config,
        rootDir: args.rootDir,
        loopId: args.loopId,
        translatedFiles,
      });
    } catch (err) {
      console.warn(`[resume] could not build Cursor prompt: ${(err as Error).message}`);
    }
  }

  await printNextSteps(
    args.loopId,
    result.projectUrl,
    pulled,
    applied,
    translatedFiles,
    promptResult,
    !args.noInteractive,
  );
  return {
    projectUrl: result.projectUrl,
    bundleUrl: result.bundleUrl,
    pulled,
    applied,
    translatedFiles,
  };
}

function buildReviewHook() {
  return async (ctx: ReviewContext): Promise<{ action: ReviewAction }> => {
    if (ctx.settleCount === 1) {
      console.log('');
      console.log('  ✦ Resumed Claude Design session.');
      console.log(`  ✦ Project URL: ${ctx.projectUrl}`);
      if (ctx.claudeBusy) {
        console.log('  ⚠ Claude appears to be actively working right now.');
        console.log('  ⚠ Pick [w] to wait for it to finish before fetching,');
        console.log('  ⚠ or [f] now to grab whatever is currently in the canvas.');
      } else {
        console.log('  ✦ Design appears settled — pick [f] to bring it home,');
        console.log('  ✦ or [w] to keep iterating with Claude in the browser.');
      }
    } else {
      console.log('');
      console.log(`  ✦ Round ${ctx.settleCount} settled. What now?`);
    }

    while (true) {
      const key = await promptChoice({
        question: 'What next?',
        choices: [
          { key: 'f', label: 'Fetch — Share → Handoff in this browser, then pull bundle' },
          { key: 'w', label: 'Wait — keep iterating in Claude Design (no timeout)' },
          { key: 'u', label: 'URL — print the project URL again' },
          { key: 'q', label: 'Quit — close browser without fetching' },
        ],
      });
      if (key === 'u') {
        console.log(`  Project URL: ${ctx.projectUrl}`);
        continue;
      }
      if (key === 'f' || key === 'w' || key === 'q') {
        return { action: key === 'f' ? 'fetch' : key === 'w' ? 'wait' : 'quit' };
      }
    }
  };
}

async function printNextSteps(
  loopId: string,
  projectUrl: string,
  pulled: boolean,
  applied: boolean,
  translatedFiles: string[],
  promptResult: PromptResult | null,
  interactive: boolean,
): Promise<void> {
  console.log('');
  if (applied) {
    console.log('  ✦ Done. Bundle pulled, scaffolds written:');
    for (const f of translatedFiles) console.log(`      ${f}`);
    console.log('');
    if (promptResult) {
      await offerClipboardCopy(promptResult, { interactive });
    } else {
      console.log('  Next: open Cursor chat and ask it to merge the scaffold into the live route.');
    }
    console.log('');
    console.log(`  Verify: design-loop verify ${loopId}`);
  } else if (pulled) {
    console.log('  Bundle pulled (apply skipped or failed). Inspect at:');
    console.log(`    design-loops/${loopId}/bundle/`);
    console.log('  Re-run apply manually:');
    console.log(`    design-loop apply ${loopId}`);
  } else {
    console.log('  Project still alive on Anthropic\'s side:');
    console.log(`    ${projectUrl}`);
    console.log(`    design-loop resume ${loopId} --headed   # to come back later`);
    console.log(`    design-loop fetch  ${loopId}            # to auto-handoff without iterating`);
  }
  console.log('');
}

function resolveAuthPaths(config: ReturnType<typeof withDefaults>): AuthPaths {
  const fallback = defaultAuthPaths();
  if (!config.storageState) return fallback;
  return {
    storageState: config.storageState,
    profileDir: fallback.profileDir,
  };
}
