#!/usr/bin/env node
/**
 * design-loop CLI — entry point invoked by the bin shim.
 *
 * Default (no subcommand): launches the interactive wizard. Subcommands
 * remain available for CI / scripts / power users:
 *
 *   design-loop                              # interactive wizard
 *   design-loop brief  <route>               # capture only
 *   design-loop submit <loopId> [--headed]
 *   design-loop fetch  <loopId>
 *   design-loop pull   <loopId> --bundle-url=<url> | --bundle-path=<file>
 *   design-loop apply  <loopId>
 *   design-loop verify <loopId>
 *   design-loop loop   <route>               # brief + submit, no wizard
 *   design-loop login
 *   design-loop init
 */

// Silence Node 24's `MODULE_TYPELESS_PACKAGE_JSON` warning. We dynamic-
// import the consumer's `.design-loop.config.ts`; if their package.json
// has no `"type": "module"` (typical for Next.js apps), Node prints a
// noisy reparsing warning. The reparse is a no-op for one tiny file, so
// hide the warning rather than make every consumer edit their
// package.json. All other warnings still flow through.
{
  const originalEmit = process.emit.bind(process);
  // @ts-expect-error - process.emit overload signature
  process.emit = function patchedEmit(event: string, value: unknown, ...rest: unknown[]) {
    if (
      event === 'warning' &&
      value &&
      typeof value === 'object' &&
      'code' in (value as Record<string, unknown>) &&
      (value as { code?: string }).code === 'MODULE_TYPELESS_PACKAGE_JSON'
    ) {
      return false;
    }
    // @ts-expect-error - forwarding args verbatim
    return originalEmit(event, value, ...rest);
  };
}

import { Command } from 'commander';
import { existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadConfig } from './config.ts';
import { ensureRootGitignoreEntry } from './lib/gitignore.ts';
import { runApply } from './lib/apply.ts';
import { runBrief } from './lib/brief.ts';
import {
  defaultAuthPaths,
  listDesignSystems,
  loginInteractive,
} from './lib/claude-design.ts';
import { getDesignSystems } from './config.ts';
import { runFetch } from './lib/fetch.ts';
import { closePromptIO } from './lib/prompt.ts';
import { runPull } from './lib/pull.ts';
import { runResume } from './lib/resume.ts';
import { runSubmit } from './lib/submit.ts';
import * as ui from './lib/ui.ts';
import { runVerify } from './lib/verify.ts';
import { runWizard } from './lib/wizard.ts';

const program = new Command();
program
  .name('design-loop')
  .description('Round-trip design loop between your IDE and claude.ai/design')
  .version('0.2.3');

// Default action: when no subcommand is supplied, drop into the wizard.
program
  .option('--headed', 'show the browser window (default for the wizard)', true)
  .option('--no-headed', 'run the browser headless (CI / quick smoke tests)')
  .action(async (opts: { headed?: boolean }) => {
    const { config, rootDir } = await loadConfig();
    await runWizard({ config, rootDir, headed: opts.headed !== false });
    // Wizard finished cleanly — close any pending readline so we exit.
    closePromptIO();
  });

program
  .command('brief')
  .description('Capture a route and write a short design brief')
  .argument('<route>', 'route path, e.g. / or /canonical')
  .option(
    '--breakpoints <list>',
    'comma-separated viewport widths in px',
  )
  .option(
    '--intent <text>',
    'optional one-line intent for this round (e.g. "make this faster to scan")',
  )
  .action(async (route: string, opts: { breakpoints?: string; intent?: string }) => {
    const { config, rootDir } = await loadConfig();
    const breakpoints = opts.breakpoints
      ? opts.breakpoints.split(',').map((s) => Number(s.trim())).filter(Boolean)
      : undefined;
    await runBrief({ config, rootDir, route, breakpoints, intent: opts.intent });
  });

program
  .command('submit')
  .description(
    'Drive claude.ai/design end-to-end for an existing loop: open project, attach screenshots, send brief, wait for the first design pass, then hand control to an interactive terminal prompt for review/iterate/fetch.',
  )
  .argument('<loopId>', 'loop id (the directory name under design-loops/)')
  .option('--headed', 'show the browser window (recommended for review)')
  .option(
    '--fidelity <fidelity>',
    'wireframe | high-fidelity (default: high-fidelity)',
  )
  .option('--project-name <name>', 'override the new project name (default: loop id)')
  .option(
    '--no-interactive',
    'skip the terminal review prompt — exit after the first design settle (CI-friendly)',
  )
  .option(
    '--no-apply',
    'skip the auto-translate-to-scaffolds step that runs after [f]etch (default: chained)',
  )
  .action(
    async (
      loopId: string,
      opts: {
        headed?: boolean;
        fidelity?: string;
        projectName?: string;
        interactive?: boolean;
        apply?: boolean;
      },
    ) => {
      const { config, rootDir } = await loadConfig();
      const fidelity = opts.fidelity
        ? assertFidelity(opts.fidelity)
        : undefined;
      await runSubmit({
        config,
        rootDir,
        loopId,
        headed: opts.headed,
        fidelity,
        projectName: opts.projectName,
        // commander flips opts.interactive=false when --no-interactive is set
        noInteractive: opts.interactive === false,
        noApply: opts.apply === false,
      });
    },
  );

program
  .command('resume')
  .description(
    'Re-open an existing Claude Design project for an existing loop. Same interactive review prompt as `submit`, but skips the create+attach+send phase \u2014 use after a `submit --headed` got interrupted (browser closed, terminal killed) so you don\'t lose in-flight design work.',
  )
  .argument('<loopId>', 'loop id')
  .option(
    '--project-url <url>',
    'override the manifest-saved project URL (claude.ai/design/p/...)',
  )
  .option('--headed', 'show the browser window (recommended)')
  .option(
    '--no-interactive',
    'skip the terminal review prompt \u2014 exit after the first settle',
  )
  .option(
    '--no-apply',
    'skip the auto-translate-to-scaffolds step that runs after [f]etch',
  )
  .action(
    async (
      loopId: string,
      opts: {
        projectUrl?: string;
        headed?: boolean;
        interactive?: boolean;
        apply?: boolean;
      },
    ) => {
      const { config, rootDir } = await loadConfig();
      await runResume({
        config,
        rootDir,
        loopId,
        projectUrl: opts.projectUrl,
        headed: opts.headed,
        noInteractive: opts.interactive === false,
        noApply: opts.apply === false,
      });
    },
  );

program
  .command('fetch')
  .description(
    'Bring a finished design back into the repo. Opens the saved project URL, drives Share \u2192 Handoff to Claude Code, captures the bundle URL, and runs `pull` to expand it.',
  )
  .argument('<loopId>', 'loop id')
  .option(
    '--project-url <url>',
    'override the manifest-saved project URL (claude.ai/design/p/...)',
  )
  .option('--headed', 'show the browser window')
  .option(
    '--no-pull',
    'just capture the bundle URL, don\'t auto-pull (you\'ll need to run pull yourself)',
  )
  .option(
    '--no-apply',
    'skip the auto-translate-to-scaffolds step that runs after pull',
  )
  .action(
    async (
      loopId: string,
      opts: {
        projectUrl?: string;
        headed?: boolean;
        pull?: boolean;
        apply?: boolean;
      },
    ) => {
      const { config, rootDir } = await loadConfig();
      // commander's --no-pull flips opts.pull to false; we keep our internal
      // option named noPull for clarity at the call site.
      await runFetch({
        config,
        rootDir,
        loopId,
        projectUrl: opts.projectUrl,
        headed: opts.headed,
        noPull: opts.pull === false,
        noApply: opts.apply === false,
      });
    },
  );

program
  .command('pull')
  .description('Expand a Claude Design handoff bundle into a loop')
  .argument('<loopId>', 'loop id')
  .option('--bundle-url <url>', 'handoff bundle URL (api.anthropic.com/v1/design/h/...)')
  .option('--bundle-path <path>', 'path to a downloaded bundle .zip')
  .action(
    async (
      loopId: string,
      opts: { bundleUrl?: string; bundlePath?: string },
    ) => {
      const source = opts.bundleUrl ?? opts.bundlePath;
      if (!source) {
        throw new Error('Provide --bundle-url <url> or --bundle-path <file.zip>.');
      }
      const { config, rootDir } = await loadConfig();
      await runPull({ config, rootDir, loopId, bundleSource: source });
    },
  );

program
  .command('apply')
  .description('Translate the bundle into framework-native scaffolds')
  .argument('<loopId>', 'loop id')
  .option(
    '--no-interactive',
    'skip the "copy prompt to clipboard?" question (CI / scripts)',
  )
  .action(async (loopId: string, opts: { interactive?: boolean }) => {
    const { config, rootDir } = await loadConfig();
    await runApply({
      config,
      rootDir,
      loopId,
      interactive: opts.interactive !== false,
    });
  });

program
  .command('verify')
  .description('Re-capture the route after apply and write a comparison report')
  .argument('<loopId>', 'loop id')
  .action(async (loopId: string) => {
    const { config, rootDir } = await loadConfig();
    await runVerify({ config, rootDir, loopId });
  });

program
  .command('login')
  .description('One-time interactive login to claude.ai/design')
  .action(async () => {
    const authPaths = defaultAuthPaths();
    await loginInteractive(authPaths);
  });

program
  .command('systems')
  .description(
    'List every design system available on claude.ai/design with its UUID. Use the printed ids to fill in any `id`-less entries in your `.design-loop.config.ts` `designSystem` array.',
  )
  .option('--headed', 'show the browser window (default true; --no-headed to hide)', true)
  .option('--no-headed', 'run the browser headless')
  .action(async (opts: { headed?: boolean }) => {
    const { config } = await loadConfig();
    const authPaths = defaultAuthPaths();
    ui.section('Discovering design systems on claude.ai/design');
    const systems = await listDesignSystems({ authPaths, headed: opts.headed !== false });
    if (!systems.length) {
      ui.warn('No design systems found. Are you logged in? Try `design-loop login`.');
      closePromptIO();
      return;
    }
    const configured = getDesignSystems(config);
    const configuredByName = new Map(
      configured.map((s) => [s.name.toLowerCase(), s] as const),
    );
    const discoveredByName = new Map(
      systems.map((s) => [s.name.toLowerCase(), s] as const),
    );

    ui.section('On claude.ai/design');
    for (const s of systems) {
      const inConfig = configuredByName.get(s.name.toLowerCase());
      const status = !inConfig
        ? ui.colors.dim('not in your config')
        : inConfig.id === s.id
          ? ui.colors.green('matches config')
          : inConfig.id
            ? ui.colors.yellow(`config has different id: ${inConfig.id}`)
            : ui.colors.yellow('config entry missing id — paste this');
      console.log(`  ${ui.colors.bold(s.name)}`);
      console.log(`    id:     ${ui.colors.cyan(s.id)}`);
      console.log(`    status: ${status}`);
    }

    // Loud section for config entries whose names don't match anything
    // on claude.ai/design — those will fail when picked.
    const orphaned = configured.filter(
      (c) => !discoveredByName.has(c.name.toLowerCase()),
    );
    if (orphaned.length) {
      ui.section('In your config but NOT on claude.ai/design');
      for (const o of orphaned) {
        ui.warn(`"${o.name}"${o.id ? ` (id: ${o.id})` : ''}`);
        ui.hint(
          `  Either rename to one of [${systems.map((s) => `"${s.name}"`).join(', ')}], or remove this entry.`,
        );
      }
    }

    const missingId = configured.filter(
      (c) => !c.id && discoveredByName.has(c.name.toLowerCase()),
    );
    if (missingId.length) {
      ui.section('Next step');
      ui.hint(
        `Open your \`.design-loop.config.ts\` and paste the printed id for: ${missingId.map((m) => `"${m.name}"`).join(', ')}.`,
      );
    }
    closePromptIO();
  });

program
  .command('loop')
  .description(
    'Convenience: brief + submit (with interactive review) in one command. After the first design pass, the terminal prompts you to fetch/wait/quit.',
  )
  .argument('<route>', 'route path, e.g. / or /canonical')
  .option('--breakpoints <list>', 'comma-separated viewport widths in px')
  .option('--intent <text>', 'optional one-line intent for this round')
  .option('--headed', 'show the browser window')
  .option('--fidelity <fidelity>', 'wireframe | high-fidelity (default: high-fidelity)')
  .option(
    '--no-interactive',
    'skip the terminal review prompt — exit after the first design settle',
  )
  .option(
    '--no-apply',
    'skip the auto-translate-to-scaffolds step that runs after [f]etch',
  )
  .action(
    async (
      route: string,
      opts: {
        breakpoints?: string;
        intent?: string;
        headed?: boolean;
        fidelity?: string;
        interactive?: boolean;
        apply?: boolean;
      },
    ) => {
      const { config, rootDir } = await loadConfig();
      const breakpoints = opts.breakpoints
        ? opts.breakpoints.split(',').map((s) => Number(s.trim())).filter(Boolean)
        : undefined;
      const brief = await runBrief({
        config,
        rootDir,
        route,
        breakpoints,
        intent: opts.intent,
      });
      const fidelity = opts.fidelity ? assertFidelity(opts.fidelity) : undefined;
      await runSubmit({
        config,
        rootDir,
        loopId: brief.loopId,
        headed: opts.headed,
        fidelity,
        noInteractive: opts.interactive === false,
        noApply: opts.apply === false,
      });
    },
  );

program
  .command('init')
  .description('Bootstrap a .design-loop.config.ts in the current directory')
  .action(async () => {
    const dest = resolve(process.cwd(), '.design-loop.config.ts');
    if (existsSync(dest)) {
      console.log(`Config already exists at ${dest}. Skipping.`);
      return;
    }
    const stub = `import { defineConfig } from '@ekolabs/claude-design-loop';

export default defineConfig({
  // Framework adapter. Currently supported:
  //   - 'svelte'  (SvelteKit; +page.svelte route discovery)
  //   - 'react'   (Next.js App Router or Pages Router)
  //   - 'html'    (static HTML projects)
  framework: 'svelte',

  // URL of your running dev server. The wizard captures screenshots from
  // \`\${devUrl}\${route}\` for each breakpoint.
  devUrl: 'http://localhost:5173',

  // Where the wizard scans for routable files.
  //   - SvelteKit:                 'src/routes'
  //   - Next.js App Router:        'src/app' (or 'app' if no src dir)
  //   - Next.js Pages Router:      'src/pages' (or 'pages' if no src dir)
  routesDir: 'src/routes',

  // Routes you NEVER want surfaced in the wizard's route picker.
  excludeRoutes: [],

  // Single ref OR an array (first = default; the wizard shows a picker
  // when there are multiple). The id is the UUID of the design system in
  // claude.ai/design's New Project picker — run \`design-loop systems\`
  // after \`design-loop login\` to discover available ids on your account.
  designSystem: {
    name: 'Your Design System',
    id: '',
  },

  // Where loop directories are written. Created on first run.
  loopsDir: 'design-loops',

  // Viewport widths captured for each brief (px).
  breakpoints: [1280, 768, 375],
});
`;
    writeFileSync(dest, stub, 'utf8');
    console.log(`Wrote ${dest}.`);

    // Also keep the consumer's repo-level .gitignore current so loop run
    // artifacts (bundles, screenshots, scaffolds, lockfile) are never
    // accidentally committed. Default loopsDir matches the stub above.
    const gi = ensureRootGitignoreEntry(process.cwd(), 'design-loops');
    const rule = `${gi.entries[0]} (with \`${gi.entries[1]}\`)`;
    if (gi.action === 'created') {
      console.log(`Created ${gi.path} with \`${rule}\`.`);
    } else if (gi.action === 'appended') {
      console.log(`Added \`${rule}\` to ${gi.path}.`);
    }

    console.log(`Next: \`design-loop login\`, then \`design-loop\` for the wizard.`);
  });

function assertFidelity(value: string): 'wireframe' | 'high-fidelity' {
  if (value === 'wireframe' || value === 'high-fidelity') return value;
  throw new Error(`Invalid fidelity \`${value}\`. Use \`wireframe\` or \`high-fidelity\`.`);
}

program.parseAsync().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
