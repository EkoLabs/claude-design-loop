/**
 * Build a ready-to-paste prompt the user can drop straight into Cursor chat
 * to finish the design-loop round-trip (merge scaffold + JSX sources into
 * the live route).
 *
 * The prompt is also written to `output/CURSOR_PROMPT.md` and, on macOS,
 * piped through `pbcopy` so the user gets a "✓ copied to clipboard" signal
 * and the merge step is one cmd+v away.
 */

import { spawn } from 'node:child_process';
import { existsSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, relative, resolve } from 'node:path';
import type { DesignLoopConfig } from '../config.ts';
import { loopPaths, readManifest } from './loops.ts';
import { promptYesNo } from './prompt.ts';
import { colors, hint, success, warn } from './ui.ts';

export interface BuildPromptArgs {
  config: DesignLoopConfig;
  rootDir: string;
  loopId: string;
  /** Files written by the adapter (absolute paths). */
  translatedFiles: string[];
}

export interface PromptResult {
  /** Absolute path to the markdown file holding the prompt. */
  promptPath: string;
  /** The full prompt text — handy for tests + for the caller to print. */
  prompt: string;
}

export async function writeCursorPrompt(args: BuildPromptArgs): Promise<PromptResult> {
  const loopsRoot = resolve(args.rootDir, args.config.loopsDir ?? 'design-loops');
  const paths = loopPaths(loopsRoot, args.loopId);
  const manifest = readManifest(paths);

  const prompt = buildCursorPrompt({
    rootDir: args.rootDir,
    loopId: args.loopId,
    route: manifest.route,
    framework: manifest.framework,
    designSystem: manifest.designSystem.name,
    routesDir: args.config.routesDir,
    translatedFiles: args.translatedFiles,
    sourcesDir: pickSourcesDir(args.translatedFiles),
  });

  const promptPath = resolve(paths.outputDir, 'CURSOR_PROMPT.md');
  writeFileSync(promptPath, prompt, 'utf8');

  return { promptPath, prompt };
}

export interface OfferClipboardCopyOptions {
  /** When false, skip the interactive prompt entirely (CI / `--no-interactive`).
   * Default true. */
  interactive?: boolean;
}

export interface OfferClipboardCopyResult {
  /** True if the user (or default) chose to copy and pbcopy succeeded. */
  copied: boolean;
  /** True if we asked the user (i.e. interactive + TTY). */
  asked: boolean;
}

/** Surface the prompt to the user. Always prints the file path. If
 * stdout is a TTY and interactive mode is enabled, asks "copy to
 * clipboard?" (default yes) and pipes through pbcopy on confirm. Never
 * copies without explicit consent. */
export async function offerClipboardCopy(
  result: PromptResult,
  opts: OfferClipboardCopyOptions = {},
): Promise<OfferClipboardCopyResult> {
  console.log(`  ${colors.cyan('📋')} ${colors.bold('Cursor merge prompt ready:')}`);
  console.log(`     ${colors.dim(result.promptPath)}`);

  const interactive = opts.interactive !== false && !!process.stdin.isTTY;
  if (!interactive) {
    hint('Open the file, copy its contents, paste into a new Cursor chat.');
    return { copied: false, asked: false };
  }

  const yes = await promptYesNo({
    question: 'Copy the prompt to your clipboard?',
    defaultYes: true,
  });
  if (!yes) {
    hint('Clipboard untouched. Grab the prompt from the file when ready.');
    return { copied: false, asked: true };
  }

  const ok = await copyToClipboard(result.prompt);
  if (ok) {
    success(`Copied. Open a new Cursor chat in this repo and paste (${colors.bold('⌘V')}).`);
  } else {
    warn('Clipboard copy failed (no `pbcopy` on this system?).');
    hint(`Open and copy manually: ${result.promptPath}`);
  }
  return { copied: ok, asked: true };
}

interface ScaffoldRef {
  componentName: string;
  scaffoldRel: string;
  sourcesRel: string | null;
  sourceFiles: string[];
}

function buildCursorPrompt(opts: {
  rootDir: string;
  loopId: string;
  route: string;
  framework: string;
  designSystem: string;
  routesDir: string;
  translatedFiles: string[];
  sourcesDir: string | null;
}): string {
  const scaffolds = opts.translatedFiles.map((abs) => describeScaffold(abs, opts.rootDir));
  const targetRoute = mapRouteToFile(opts.route, opts.framework, opts.routesDir, opts.rootDir);

  const lines: string[] = [];
  lines.push(
    `Merge the Claude Design output for the \`${opts.route}\` route into the live codebase.`,
  );
  lines.push('');
  lines.push(`**Loop**: \`${opts.loopId}\``);
  lines.push(`**Design system**: ${opts.designSystem}`);
  lines.push(`**Framework**: ${opts.framework}`);
  lines.push('');
  lines.push('## Files to read');
  lines.push('');
  for (const s of scaffolds) {
    lines.push(`- **Scaffold (target shape + design tokens)**: \`${s.scaffoldRel}\``);
    if (s.sourcesRel) {
      lines.push(`- **JSX sources (the real UI lives here)**: \`${s.sourcesRel}/\``);
      const entry = s.sourceFiles.find((f) => /^app\.jsx?$/i.test(f));
      const others = s.sourceFiles.filter((f) => f !== entry);
      if (entry) lines.push(`  - Entry: \`${entry}\``);
      if (others.length) {
        lines.push(`  - Other files: ${others.map((f) => `\`${f}\``).join(', ')}`);
      }
    }
  }
  lines.push(`- **Live route to update**: \`${targetRoute}\``);
  lines.push('');
  lines.push('## What to do');
  lines.push('');
  lines.push(
    '1. Read the JSX files in the sources directory. Build a mental model of the component tree, props, and layout.',
  );
  lines.push(
    `2. Translate the JSX into ${formatHint(opts.framework)} markup inside the live route file (or factor large sections into \`${suggestComponentDir(opts.routesDir)}/\`).`,
  );
  lines.push(
    "3. Wire data from the route's existing loader. If the design needs fields the loader doesn't return, propose the loader patch — don't invent mock data.",
  );
  lines.push(
    "4. Keep the CSS from the scaffold's `<style>` block intact (those are the design tokens). Inline it on the route or extract to a shared stylesheet — your judgement.",
  );
  lines.push(`5. Use ${idiomHint(opts.framework)}. Don't carry React patterns over.`);
  lines.push("6. Don't add dependencies that aren't already in the project's `package.json`.");
  lines.push(
    '7. After the merge, run the dev server and confirm the route renders without console errors.',
  );
  lines.push('');
  lines.push(
    '> Skip the design-loop CLI for this step — the round-trip ends here. Just merge the files above.',
  );
  lines.push('');
  return lines.join('\n');
}

function describeScaffold(absScaffold: string, rootDir: string): ScaffoldRef {
  const componentName = basename(absScaffold).replace(/\.[^.]+$/, '');
  const scaffoldRel = relative(rootDir, absScaffold);
  const sourcesAbs = resolve(absScaffold, '..', 'sources', componentName);
  let sourcesRel: string | null = null;
  let sourceFiles: string[] = [];
  if (existsSync(sourcesAbs) && statSync(sourcesAbs).isDirectory()) {
    sourcesRel = relative(rootDir, sourcesAbs);
    sourceFiles = readdirSync(sourcesAbs)
      .filter((n) => !n.startsWith('.'))
      .sort();
  }
  return { componentName, scaffoldRel, sourcesRel, sourceFiles };
}

function pickSourcesDir(translatedFiles: string[]): string | null {
  const first = translatedFiles[0];
  if (!first) return null;
  return resolve(first, '..', 'sources');
}

function mapRouteToFile(
  route: string,
  framework: string,
  routesDir: string,
  rootDir: string,
): string {
  const trimmed = route.replace(/^\/+|\/+$/g, '');
  const rel = relative(rootDir, routesDir);
  if (framework === 'svelte') {
    const segment = trimmed ? `/${trimmed}` : '';
    return `${rel}${segment}/+page.svelte`;
  }
  if (framework === 'react') {
    const segment = trimmed ? `/${trimmed}` : '';
    return `${rel}${segment}/page.tsx (Next.js) or equivalent`;
  }
  return `${rel}${trimmed ? `/${trimmed}` : ''} (the file rendering this route)`;
}

function suggestComponentDir(routesDir: string): string {
  // Heuristic: dashboard/src/routes -> dashboard/src/lib/components.
  // Falls back to <routesDir>/_components for unknown layouts.
  const guess = routesDir.replace(/\/routes\/?$/, '/lib/components');
  if (guess !== routesDir) return guess.replace(/\/+$/, '');
  return `${routesDir.replace(/\/+$/, '')}/_components`;
}

function formatHint(framework: string): string {
  if (framework === 'svelte') return 'Svelte 5 runes-based';
  if (framework === 'react') return 'React (TSX)';
  if (framework === 'vue') return 'Vue 3 SFC';
  return framework;
}

function idiomHint(framework: string): string {
  if (framework === 'svelte') return 'Svelte 5 idioms (`$state`, `$derived`, `$props`, `{#if}`, `{#each}`)';
  if (framework === 'react') return 'React idioms (functional components, hooks)';
  if (framework === 'vue') return 'Vue 3 Composition API idioms';
  return `${framework} idioms`;
}

async function copyToClipboard(text: string): Promise<boolean> {
  // macOS only for now. Cross-platform clipboard libs add a dep we don't
  // need — pbcopy is the 99% case for this team. On Linux we'd use xclip
  // / wl-copy; on Windows clip.exe. Skip silently elsewhere — the user
  // can still cat the markdown file.
  if (process.platform !== 'darwin') return false;
  return new Promise((resolveP) => {
    try {
      const child = spawn('pbcopy');
      child.on('error', () => resolveP(false));
      child.on('close', (code) => resolveP(code === 0));
      child.stdin.end(text, 'utf8');
    } catch {
      resolveP(false);
    }
  });
}
