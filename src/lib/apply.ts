/**
 * `design-loop apply` — translation step.
 *
 * Reads the human-edited `review-checklist.md`, loads the framework adapter,
 * and asks the adapter to translate the bundle's standalone HTML into
 * framework-native scaffolds in `output/translated/`. Does NOT modify the
 * live codebase — that's a deliberate manual / agent step, because merging
 * into existing routes is a judgement call the package shouldn't make.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getAdapter } from '../adapters/index.ts';
import type { DesignLoopConfig } from '../config.ts';
import { offerClipboardCopy, writeCursorPrompt, type PromptResult } from './cursor-prompt.ts';
import { loopPaths, readManifest, writeManifest } from './loops.ts';

export interface ApplyArgs {
  config: DesignLoopConfig;
  rootDir: string;
  loopId: string;
  /** When true, suppress the standalone Cursor-prompt handoff banner.
   * Used by `submit`/`resume`/`fetch` which print their own consolidated
   * next-steps message. Default false (so standalone `apply` still asks). */
  silent?: boolean;
  /** When false, skip the "copy to clipboard?" question even on a TTY.
   * Default true. */
  interactive?: boolean;
}

export interface ApplyResult {
  outputDir: string;
  translatedFiles: string[];
  notes: string[];
  promptResult: PromptResult | null;
}

export async function runApply(args: ApplyArgs): Promise<ApplyResult> {
  const loopsRoot = resolve(args.rootDir, args.config.loopsDir ?? 'design-loops');
  const paths = loopPaths(loopsRoot, args.loopId);
  if (!existsSync(paths.bundleDir)) {
    throw new Error(
      `Bundle directory missing for ${args.loopId}. Run \`design-loop pull\` first.`,
    );
  }
  mkdirSync(paths.outputDir, { recursive: true });

  const checklist = parseChecklist(paths.reviewChecklistPath);
  const adapter = getAdapter(args.config.framework);

  console.log(
    `[apply] adapter=${adapter.name} approved=${checklist.approved.length} rejected=${checklist.rejected.length}`,
  );

  const result = await adapter.apply({
    config: args.config,
    rootDir: args.rootDir,
    loopId: args.loopId,
    loopRoot: paths.root,
    bundleDir: paths.bundleDir,
    outputDir: paths.outputDir,
    approvedItems: checklist.approved,
    rejectedItems: checklist.rejected,
    notes: checklist.notes,
  });

  const summary = [
    `# Apply summary — ${args.loopId}`,
    '',
    `Adapter: \`${adapter.name}\``,
    `Approved items: ${checklist.approved.length}`,
    `Rejected items: ${checklist.rejected.length}`,
    '',
    '## Translated files',
    result.translatedFiles.length
      ? result.translatedFiles.map((f) => `- \`${f}\``).join('\n')
      : '- (none)',
    '',
    '## Adapter notes',
    result.notes.map((n) => `- ${n}`).join('\n'),
    '',
    '## Next step',
    '',
    `Run \`design-loop verify ${args.loopId}\` once the translated scaffolds are merged into the live route.`,
    '',
  ].join('\n');
  const summaryPath = resolve(paths.outputDir, 'APPLY_SUMMARY.md');
  writeFileSync(summaryPath, summary, 'utf8');
  console.log(`[apply] wrote ${summaryPath}`);

  const manifest = readManifest(paths);
  manifest.apply = {
    appliedAt: new Date().toISOString(),
    targetFiles: result.translatedFiles,
    skippedItems: checklist.rejected,
  };
  writeManifest(paths, manifest);

  let promptResult: PromptResult | null = null;
  if (result.translatedFiles.length) {
    try {
      promptResult = await writeCursorPrompt({
        config: args.config,
        rootDir: args.rootDir,
        loopId: args.loopId,
        translatedFiles: result.translatedFiles,
      });
      if (!args.silent) {
        console.log('');
        await offerClipboardCopy(promptResult, { interactive: args.interactive });
        console.log('');
      }
    } catch (err) {
      console.warn(`[apply] could not build Cursor prompt: ${(err as Error).message}`);
    }
  }

  return {
    outputDir: paths.outputDir,
    translatedFiles: result.translatedFiles,
    notes: result.notes,
    promptResult,
  };
}

function parseChecklist(path: string): {
  approved: string[];
  rejected: string[];
  notes: string;
} {
  if (!existsSync(path)) {
    return { approved: [], rejected: [], notes: '' };
  }
  const md = readFileSync(path, 'utf8');
  const lines = md.split('\n');
  const approved: string[] = [];
  const rejected: string[] = [];
  const noteLines: string[] = [];
  let inNotes = false;
  for (const line of lines) {
    if (/^##\s*notes/i.test(line)) {
      inNotes = true;
      continue;
    }
    if (/^##\s/.test(line)) {
      inNotes = false;
      continue;
    }
    if (inNotes) {
      noteLines.push(line);
      continue;
    }
    const checked = line.match(/^\s*-\s*\[(x|X)\]\s+(.+)/);
    if (checked && checked[2]) {
      approved.push(checked[2].trim());
      continue;
    }
    const rejectedItem = line.match(/^\s*-\s*\[(✗|x✗)\]\s+(.+)/);
    if (rejectedItem && rejectedItem[2]) {
      rejected.push(rejectedItem[2].trim());
    }
  }
  return {
    approved,
    rejected,
    notes: noteLines.join('\n').trim(),
  };
}
