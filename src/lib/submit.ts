/**
 * `design-loop submit <loopId>` — drive claude.ai/design end-to-end.
 *
 * Opens Claude Design, creates a project, attaches the screenshots, sends
 * the brief, and waits for Claude to finish the first design pass. After
 * that, hands control to an **interactive review loop** in the terminal:
 * the user iterates with Claude in the browser as much as they want, and
 * comes back to the terminal to choose:
 *
 *   - `[f]etch` — drive Share → Handoff in the same browser session, get
 *                 the bundle URL, expand it locally with `pull`.
 *   - `[w]ait`  — keep iterating in claude.ai/design. The browser stays
 *                 open. Whenever Claude works again and goes quiet, the
 *                 prompt re-appears.
 *   - `[u]rl`   — print the project URL again (in case it scrolled off).
 *   - `[q]uit`  — close the browser without fetching. Use the standalone
 *                 `design-loop fetch <loopId>` later if you change your
 *                 mind.
 *
 * There's no timeout on the review phase — the human controls lifetime.
 */

import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { DesignLoopConfig } from '../config.ts';
import { withDefaults } from '../config.ts';
import { runApply } from './apply.ts';
import {
  defaultAuthPaths,
  submitToClaudeDesign,
  type AuthPaths,
  type ReviewAction,
  type ReviewContext,
} from './claude-design.ts';
import { offerClipboardCopy, writeCursorPrompt, type PromptResult } from './cursor-prompt.ts';
import { acquireLock } from './lock.ts';
import { loopPaths, readManifest, writeManifest } from './loops.ts';
import { promptChoice } from './prompt.ts';
import { runPull } from './pull.ts';

export interface SubmitArgs {
  config: DesignLoopConfig;
  rootDir: string;
  loopId: string;
  /** Show the browser window. Required to engage the interactive prompt. */
  headed?: boolean;
  /** Override the project name. Default: derived from loop id. */
  projectName?: string;
  /** Override fidelity. Default: high-fidelity. */
  fidelity?: 'wireframe' | 'high-fidelity';
  /** Disable the interactive review prompt (treat first settle as done).
   * Useful for CI or background runs. Default: prompt iff stdin is a TTY. */
  noInteractive?: boolean;
  /** Skip the auto-apply step that runs after a successful fetch. Default
   * is to chain pull → apply so `[f]` produces ready-to-merge scaffolds. */
  noApply?: boolean;
}

export interface SubmitOutcome {
  projectUrl: string;
  bundleUrl: string | null;
  pulled: boolean;
  applied: boolean;
  translatedFiles: string[];
}

export async function runSubmit(args: SubmitArgs): Promise<SubmitOutcome> {
  const config = withDefaults(args.config);
  const loopsRoot = resolve(args.rootDir, config.loopsDir);
  const paths = loopPaths(loopsRoot, args.loopId);
  // Browser-driving commands acquire the per-repo lock so two of them
  // can't fight over the shared Chromium profile. Idempotent for the
  // same pid — nested wizard → submit just re-uses the held lock.
  const lock = acquireLock(loopsRoot, {
    command: 'submit',
    loopId: args.loopId,
  });
  try {
    return await runSubmitInner(args, config, paths);
  } finally {
    lock.release();
  }
}

async function runSubmitInner(
  args: SubmitArgs,
  config: ReturnType<typeof withDefaults>,
  paths: ReturnType<typeof loopPaths>,
): Promise<SubmitOutcome> {
  if (!existsSync(paths.briefPath)) {
    throw new Error(`Loop ${args.loopId} not found at ${paths.root} or has no brief.md.`);
  }

  const authPaths = resolveAuthPaths(config);
  if (!existsSync(authPaths.storageState)) {
    throw new Error(
      `No saved Claude Design auth at ${authPaths.storageState}. Run \`design-loop login\` first.`,
    );
  }

  const manifest = readManifest(paths);
  if (!manifest.designSystem.id) {
    throw new Error(
      `Loop ${args.loopId} was created without a design-system id. Re-run \`design-loop brief ${args.loopId}\` with a design system that has \`id\` set in config.`,
    );
  }
  const fidelity = args.fidelity ?? 'high-fidelity';
  const projectName = args.projectName ?? args.loopId;
  const attachmentPaths = collectAttachments(paths.inputsDir);

  // Interactive review requires:
  //   1. --headed: there's nothing to iterate on if you can't see the browser.
  //   2. A real TTY: the single-key prompt needs raw-mode stdin.
  //   3. The user didn't opt out via --no-interactive.
  const wantInteractive =
    !args.noInteractive && process.stdin.isTTY === true && args.headed === true;

  console.log(
    `[submit] loop=${args.loopId} fidelity=${fidelity} attachments=${attachmentPaths.length} interactive=${wantInteractive}`,
  );
  if (args.noInteractive !== true && args.headed !== true) {
    console.log(
      '[submit] --headed not set; running non-interactive (exits after first design settle).',
    );
  }

  const result = await submitToClaudeDesign({
    authPaths,
    designSystemId: manifest.designSystem.id,
    projectName,
    briefPath: paths.briefPath,
    attachmentPaths,
    fidelity,
    headed: args.headed,
    review: wantInteractive ? buildReviewHook() : undefined,
    // Persist the project URL the moment the canvas opens, so a later
    // `design-loop resume <loopId>` works even if the user kills the
    // process during the long review phase.
    onCanvasOpened: (url) => {
      manifest.claudeProjectUrl = url;
      writeManifest(paths, manifest);
      console.log(`[submit] project URL saved to manifest (resume-safe).`);
    },
  });

  // Refresh the URL in case it changed (e.g. ?file=... once an artifact
  // opened). The early-save call above already persisted the canonical
  // /design/p/<uuid> form; this just keeps things tidy.
  if (manifest.claudeProjectUrl !== result.projectUrl) {
    manifest.claudeProjectUrl = result.projectUrl;
    writeManifest(paths, manifest);
  }

  // If the user chose [f]etch, the browser already produced a bundle URL —
  // chain pull → apply so a single `[f]` keypress produces ready-to-merge
  // scaffolds, no extra commands.
  let pulled = false;
  let applied = false;
  let translatedFiles: string[] = [];
  if (result.bundleUrl) {
    console.log(`[submit] bundle URL: ${result.bundleUrl}`);
    console.log('[submit] expanding bundle locally ...');
    await runPull({
      config: args.config,
      rootDir: args.rootDir,
      loopId: args.loopId,
      bundleSource: result.bundleUrl,
    });
    pulled = true;

    if (!args.noApply) {
      try {
        console.log('[submit] translating bundle to framework scaffolds ...');
        const applyResult = await runApply({
          config: args.config,
          rootDir: args.rootDir,
          loopId: args.loopId,
          silent: true,
        });
        applied = true;
        translatedFiles = applyResult.translatedFiles;
      } catch (err) {
        // Apply is best-effort — if the adapter fails (e.g. no HTML in
        // bundle, framework mismatch), keep the pulled bundle so the
        // user can investigate. Surface the error and move on.
        console.warn(
          `[submit] apply step failed (continuing — bundle is still pulled): ${(err as Error).message}`,
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
      console.warn(`[submit] could not build Cursor prompt: ${(err as Error).message}`);
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

/**
 * The interactive review hook. Called every time Claude has been quiet
 * for a settle window. Loops internally so 'u' (show URL) doesn't count
 * as a settle — it just re-renders the menu.
 */
function buildReviewHook() {
  return async (ctx: ReviewContext): Promise<{ action: ReviewAction }> => {
    if (ctx.settleCount === 1) {
      console.log('');
      console.log('  ✦ Design ready for review.');
      console.log(`  ✦ Project URL: ${ctx.projectUrl}`);
      console.log('  ✦ Iterate with Claude in the open browser as much as you like.');
      console.log('  ✦ When you\'re happy, come back here and pick [f] to bring it home.');
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
    await printMergeHandoff(loopId, translatedFiles, promptResult, interactive);
  } else if (pulled) {
    console.log('  Bundle pulled (apply skipped or failed). Inspect at:');
    console.log(`    design-loops/${loopId}/bundle/`);
    console.log('  Re-run apply manually:');
    console.log(`    design-loop apply ${loopId}`);
  } else {
    console.log('  Design left open in Claude Design:');
    console.log(`    ${projectUrl}`);
    console.log('  Pick up where you left off:');
    console.log(`    design-loop resume ${loopId} --headed              # re-open + interactive prompt`);
    console.log(`    design-loop fetch  ${loopId}                       # auto-handoff, no prompting`);
    console.log(`    design-loop pull   ${loopId} --bundle-url=<url>    # manual bundle URL paste`);
  }
  console.log('');
}

async function printMergeHandoff(
  loopId: string,
  translatedFiles: string[],
  promptResult: PromptResult | null,
  interactive: boolean,
): Promise<void> {
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
}

function resolveAuthPaths(config: ReturnType<typeof withDefaults>): AuthPaths {
  const fallback = defaultAuthPaths();
  if (!config.storageState) return fallback;
  return {
    storageState: config.storageState,
    profileDir: fallback.profileDir,
  };
}

/**
 * Collect attachments to upload alongside the brief. Claude Design's drop
 * zone accepts images and PDFs in practice. Other types (.yaml, .json,
 * .md) cause the UI to reject the WHOLE batch with "Couldn't upload N
 * files". Filter aggressively so a successful image upload isn't poisoned
 * by an unsupported sibling.
 */
function collectAttachments(inputsDir: string): string[] {
  if (!existsSync(inputsDir)) return [];
  return readdirSync(inputsDir)
    .filter((name) => /\.(png|jpe?g|webp|gif|pdf)$/i.test(name))
    .map((name) => join(inputsDir, name));
}
