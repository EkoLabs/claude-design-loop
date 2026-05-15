/**
 * `design-loop` (no subcommand) — the interactive wizard.
 *
 * Guides the user end-to-end with sensible defaults at every step:
 *   1. acquire repo-wide concurrency lock (refuses if another session is live)
 *   2. ask "new design or resume in-progress?" if any resumable loops exist
 *   3. (NEW) pick route → pick design system → optional intent → project name
 *   4. show summary, confirm, then chain brief → submit (with the existing
 *      [f]/[w]/[u]/[q] review prompt + auto-pull/apply on [f])
 *   5. (RESUME) pick a saved loop, then re-attach to its Claude Design canvas
 *
 * The wizard composes existing pieces — runBrief, runSubmit, runResume,
 * runApply — rather than duplicating their logic. Subcommands stay as
 * escape hatches for CI / power users.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { getAdapter } from '../adapters/index.ts';
import type { DiscoveredRoute } from '../adapters/types.ts';
import {
  getDesignSystems,
  withDefaults,
  type DesignLoopConfig,
  type DesignSystemRef,
} from '../config.ts';
import { runBrief } from './brief.ts';
import {
  defaultAuthPaths,
  listDesignSystems,
} from './claude-design.ts';
import {
  acquireLock,
  checkLock,
  LockHeldError,
  type LockInfo,
} from './lock.ts';
import {
  loopPaths,
  prettyProjectName,
  readManifest,
  type LoopManifest,
  type LoopPaths,
} from './loops.ts';
import {
  promptList,
  promptText,
  promptYesNo,
  type PromptListItem,
} from './prompt.ts';
import { runResume } from './resume.ts';
import { runSubmit } from './submit.ts';
import {
  banner,
  bullet,
  colors,
  error,
  hint,
  kvBlock,
  line,
  rule,
  section,
  success,
  warn,
} from './ui.ts';

export interface WizardArgs {
  config: DesignLoopConfig;
  rootDir: string;
  /** Default true. Set false in tests / CI. */
  headed?: boolean;
}

export async function runWizard(args: WizardArgs): Promise<void> {
  const config = withDefaults(args.config);
  const loopsRoot = resolve(args.rootDir, config.loopsDir);

  banner('design-loop', 'Cursor ⇄ Claude Design');

  // ── Concurrency guard ────────────────────────────────────────────────
  await ensureNoActiveSession(loopsRoot);

  // ── New or resume? ────────────────────────────────────────────────────
  const resumable = listResumableLoops(loopsRoot);
  let mode: 'new' | 'resume' = 'new';
  if (resumable.length > 0) {
    section('What are we doing?');
    mode = await promptList<'new' | 'resume'>({
      question: 'Pick an action:',
      items: [
        { label: 'Start a new design', value: 'new' },
        {
          label: `Resume an in-progress design`,
          hint: `${resumable.length} saved`,
          value: 'resume',
        },
      ],
      defaultIndex: 0,
    });
  }

  if (mode === 'resume') {
    await runResumeFlow({
      config: args.config,
      rootDir: args.rootDir,
      headed: args.headed ?? true,
      resumable,
    });
    return;
  }

  await runNewFlow({
    config: args.config,
    rootDir: args.rootDir,
    headed: args.headed ?? true,
  });
}

// ────────────────────────────────────────────────────────────────────────
// NEW flow
// ────────────────────────────────────────────────────────────────────────

interface NewFlowArgs {
  config: DesignLoopConfig;
  rootDir: string;
  headed: boolean;
}

async function runNewFlow(args: NewFlowArgs): Promise<void> {
  const config = withDefaults(args.config);

  section('Pick a route');
  const route = await pickRoute(args.config, args.rootDir);
  if (!route) {
    warn('No routes found. Check `routesDir` in your design-loop config.');
    return;
  }

  section('Pick a design system');
  const designSystem = await pickDesignSystem(args.config);

  section('Set the intent (optional)');
  hint('One short line about what you\'re optimizing for. Press Enter to skip.');
  const intent = await promptText({
    question: 'Intent',
    default: '',
  });

  section('Name the Claude Design project');
  const defaultName = prettyProjectName(route);
  const projectName = await promptText({
    question: 'Project name',
    default: defaultName,
    hint: 'Press Enter to accept the default.',
  });

  section('Ready to go');
  kvBlock([
    ['Route', route],
    ['Design system', designSystem.name],
    intent ? ['Intent', intent] : null,
    ['Project name', projectName],
    ['Design system id', designSystem.id ?? colors.yellow('(missing — submit will fail)')],
    ['Framework', config.framework],
    ['Dev URL', `${config.devUrl}${route === '/' ? '' : route}`],
  ]);
  line();
  const proceed = await promptYesNo({
    question: 'Run brief + open Claude Design now?',
    defaultYes: true,
  });
  if (!proceed) {
    hint('Aborted. Nothing was written.');
    return;
  }

  // Acquire the lock just before we start touching the browser. Doing it
  // late means the wizard's interactive Q&A doesn't lock out a sibling
  // shell that's about to run a no-browser command (apply, pull).
  let lock;
  try {
    lock = acquireLock(loopsRootOf(args), { command: 'wizard:new' });
  } catch (err) {
    if (err instanceof LockHeldError) {
      error(err.message);
      return;
    }
    throw err;
  }

  try {
    section('Capturing the route');
    const brief = await runBrief({
      config: args.config,
      rootDir: args.rootDir,
      route,
      intent: intent || undefined,
      designSystem,
    });
    success(`Brief written: ${brief.briefPath}`);

    section('Driving Claude Design');
    await runSubmit({
      config: args.config,
      rootDir: args.rootDir,
      loopId: brief.loopId,
      headed: args.headed,
      projectName,
      // `submit` will print its own merge handoff once a [f]etch lands.
    });
  } finally {
    lock.release();
  }
}

// ────────────────────────────────────────────────────────────────────────
// RESUME flow
// ────────────────────────────────────────────────────────────────────────

interface ResumeFlowArgs {
  config: DesignLoopConfig;
  rootDir: string;
  headed: boolean;
  resumable: ResumableLoop[];
}

async function runResumeFlow(args: ResumeFlowArgs): Promise<void> {
  if (args.resumable.length === 0) {
    warn('No in-progress designs to resume.');
    return;
  }

  section('Pick a design to resume');
  const items: PromptListItem<ResumableLoop>[] = args.resumable.map((r) => ({
    label: `${colors.bold(r.manifest.route)}  ${colors.dim(r.id)}`,
    hint: `${formatAge(r.manifest.createdAt)} · ${r.manifest.designSystem.name}`,
    value: r,
  }));
  const choice = await promptList({
    question: 'Which loop?',
    items,
    defaultIndex: 0,
  });

  const proceed = await promptYesNo({
    question: `Re-open ${colors.bold(choice.manifest.route)} in Claude Design?`,
    defaultYes: true,
  });
  if (!proceed) {
    hint('Aborted.');
    return;
  }

  let lock;
  try {
    lock = acquireLock(loopsRootOf(args), {
      command: 'wizard:resume',
      loopId: choice.id,
    });
  } catch (err) {
    if (err instanceof LockHeldError) {
      error(err.message);
      return;
    }
    throw err;
  }

  try {
    await runResume({
      config: args.config,
      rootDir: args.rootDir,
      loopId: choice.id,
      headed: args.headed,
    });
  } finally {
    lock.release();
  }
}

// ────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────

async function pickRoute(
  config: DesignLoopConfig,
  rootDir: string,
): Promise<string | null> {
  const adapter = getAdapter(config.framework);
  const routesDir = resolve(rootDir, config.routesDir);
  let discovered: DiscoveredRoute[] = [];
  try {
    discovered = await adapter.discoverRoutes({
      routesDir,
      exclude: config.excludeRoutes ?? [],
    });
  } catch (err) {
    warn(`Route discovery failed: ${(err as Error).message}`);
  }

  if (discovered.length === 0) {
    hint('No routes auto-discovered. Type the route path manually.');
    const typed = await promptText({
      question: 'Route',
      default: '/',
    });
    return typed || '/';
  }

  // Add a "type my own" escape hatch at the bottom.
  const items: PromptListItem<string>[] = [
    ...discovered.map((r) => ({
      label: r.path,
      hint: r.dynamic ? colors.yellow('dynamic — needs a real value') : undefined,
      value: r.path,
    })),
    { label: colors.dim('Type a custom route…'), value: '__custom__' },
  ];
  const picked = await promptList({
    question: 'Routes (default = first):',
    items,
    defaultIndex: 0,
  });
  if (picked !== '__custom__') return picked;
  const typed = await promptText({
    question: 'Custom route',
    default: '/',
    hint: 'e.g. /canonical/abc123 — fill in dynamic params',
  });
  return typed || '/';
}

async function pickDesignSystem(config: DesignLoopConfig): Promise<DesignSystemRef> {
  const systems = getDesignSystems(config);
  let chosen: DesignSystemRef;
  if (systems.length === 1) {
    chosen = systems[0]!;
    bullet(`Using ${colors.bold(chosen.name)} (only design system in config)`);
  } else {
    const items: PromptListItem<DesignSystemRef>[] = systems.map((s) => ({
      label: s.name,
      hint: s.id
        ? colors.dim(s.id)
        : colors.yellow('no id — pick to look it up'),
      value: s,
    }));
    chosen = await promptList({
      question: 'Design system (default = first):',
      items,
      defaultIndex: 0,
    });
  }

  if (chosen.id) return chosen;

  // No id on the chosen entry. Offer to scrape it from claude.ai/design
  // right now. Cheaper and friendlier than failing later in submit.
  warn(`"${chosen.name}" has no id in config.`);
  const lookup = await promptYesNo({
    question: 'Look up the id from claude.ai/design now?',
    defaultYes: true,
  });
  if (!lookup) {
    throw new Error(
      `Cannot submit without a design-system id. Add an \`id\` for "${chosen.name}" in your .design-loop.config.ts (or run \`design-loop systems\` to see all available ids).`,
    );
  }
  bullet('Opening claude.ai/design to scrape design-system ids…');
  const discovered = await listDesignSystems({ authPaths: defaultAuthPaths(), headed: false });
  const match = discovered.find(
    (d) => d.name.toLowerCase() === chosen.name.toLowerCase(),
  );
  if (!match) {
    throw new Error(
      `No design system named "${chosen.name}" exists on your claude.ai/design account.\n` +
        `  Available: ${discovered.map((d) => `"${d.name}"`).join(', ')}\n` +
        `  Fix: edit .design-loop.config.ts to use one of the names above (and its id), or remove this entry.\n` +
        `  Tip: \`design-loop systems\` shows the full list with ids.`,
    );
  }
  success(`Resolved "${match.name}" → ${colors.cyan(match.id)}`);
  hint(
    `Tip: paste this id into your .design-loop.config.ts so future runs skip the lookup.`,
  );
  return { ...chosen, id: match.id };
}

async function ensureNoActiveSession(loopsRoot: string): Promise<void> {
  const status = checkLock(loopsRoot);
  if (!status.active) return;
  if (!status.alive) {
    // Stale lock — silently OK, acquireLock will overwrite.
    return;
  }
  warn('Another design-loop session is already running:');
  printLockInfo(status.info);
  line();
  const force = await promptYesNo({
    question: 'Force-unlock and continue anyway?',
    defaultYes: false,
  });
  if (!force) {
    hint('Exiting. Wait for the other session to finish, or kill it first.');
    process.exit(1);
  }
  warn('Continuing despite active lock — hope you know what you\'re doing.');
}

function printLockInfo(info?: LockInfo): void {
  if (!info) {
    hint('  (lock file unreadable — likely garbage)');
    return;
  }
  kvBlock([
    ['pid', info.pid],
    ['started', info.startedAt],
    ['command', info.command],
    info.loopId ? ['loop', info.loopId] : null,
  ]);
}

interface ResumableLoop {
  id: string;
  paths: LoopPaths;
  manifest: LoopManifest;
}

function listResumableLoops(loopsRoot: string): ResumableLoop[] {
  if (!existsSync(loopsRoot)) return [];
  const out: ResumableLoop[] = [];
  for (const entry of readdirSync(loopsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith('.')) continue;
    const paths = loopPaths(loopsRoot, entry.name);
    if (!existsSync(paths.manifestPath)) continue;
    let manifest: LoopManifest;
    try {
      manifest = JSON.parse(readFileSync(paths.manifestPath, 'utf8'));
    } catch {
      continue;
    }
    // "Resumable" = has a Claude Design URL but hasn't been applied yet.
    if (!manifest.claudeProjectUrl) continue;
    if (manifest.apply) continue;
    out.push({ id: entry.name, paths, manifest });
  }
  // Newest first.
  out.sort((a, b) => b.manifest.createdAt.localeCompare(a.manifest.createdAt));
  return out;
}

function formatAge(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return iso;
  const diffMs = Date.now() - then;
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function loopsRootOf(args: { config: DesignLoopConfig; rootDir: string }): string {
  const config = withDefaults(args.config);
  return resolve(args.rootDir, config.loopsDir);
}

