# Contributing

Internal Eko Labs project. PRs from team members welcome.

## Development setup

```bash
git clone git@github.com:EkoLabs/claude-design-loop.git
cd claude-design-loop
pnpm install
pnpm exec playwright install chromium   # one-time browser binary download
```

## Day-to-day commands

| Command | What it does |
|---|---|
| `pnpm build` | Compile `src/` → `dist/` via tsup (ESM + .d.ts). |
| `pnpm typecheck` | Run `tsc --noEmit` over the source tree. |
| `pnpm test` | Run the vitest smoke tests. |
| `pnpm test:watch` | Re-run tests on change. |
| `pnpm design-loop ...` | Run the CLI directly from source via tsx (no rebuild). |

## Project layout

```
src/
├── adapters/                # Per-framework integrations
│   ├── types.ts             # Adapter interface (discoverRoutes, capture, translate)
│   ├── svelte.ts            # SvelteKit adapter
│   ├── html.ts              # Static HTML fallback
│   └── index.ts             # Registry
├── lib/
│   ├── brief.ts             # `brief` command
│   ├── submit.ts            # `submit` command (drives claude.ai/design)
│   ├── resume.ts            # `resume` command
│   ├── fetch.ts             # `fetch` command (Share → Handoff)
│   ├── pull.ts              # `pull` command (expand handoff bundle)
│   ├── apply.ts             # `apply` command (translate to scaffolds)
│   ├── verify.ts            # `verify` command (re-capture + diff)
│   ├── wizard.ts            # The interactive `design-loop` (no subcommand) entry
│   ├── claude-design.ts     # All Playwright-driven claude.ai/design interaction
│   ├── prompt.ts            # Terminal prompt helpers (TTY + piped)
│   ├── ui.ts                # picocolors-based formatting helpers
│   ├── lock.ts              # Per-repo concurrency guard
│   ├── loops.ts             # Manifest + path helpers for loop directories
│   └── cursor-prompt.ts     # Generates CURSOR_PROMPT.md after `apply`
├── config.ts                # `defineConfig`, `loadConfig`, helpers
├── cli.ts                   # commander setup
└── index.ts                 # Public API exports
bin/
└── design-loop.js           # bin shim — imports dist/cli.js
tests/                       # Vitest suites
examples/                    # Sample consumer projects
```

## Adding a new framework adapter

The adapter contract lives in `src/adapters/types.ts`. A minimal new adapter looks like:

```ts
import type { Adapter, DiscoveredRoute } from './types.ts';

export const myFrameworkAdapter: Adapter = {
  name: 'myFramework',

  async discoverRoutes({ rootDir, config }) {
    // Walk config.routesDir and return a DiscoveredRoute[] with
    // { route: '/...', filePath: 'absolute/path/to/source-file' }
  },

  async capture({ /* ... */ }) {
    // Use the bundled Playwright capture helpers — most adapters
    // just delegate to the default capture pipeline.
  },

  async translate({ /* ... */ }) {
    // Translate the Claude Design bundle (HTML/CSS/JSX) into
    // framework-native scaffolds. See svelte.ts for a worked example.
  },
};
```

Then register it in `src/adapters/index.ts`. Add a fixture-based test under `tests/adapters/<name>.test.ts`.

## Releasing

1. Bump `version` in `package.json`.
2. Update `CHANGELOG.md` (Keep a Changelog format).
3. Tag the commit: `git tag v0.x.y && git push --tags`.
4. The `prepare` lifecycle script builds on install, so consumers using `pnpm add github:EkoLabs/claude-design-loop#v0.x.y` will get a freshly built copy.

## Style

- Module imports use `.ts` extensions (TypeScript 5+ feature). tsup handles them transparently at build time.
- Prefer named exports over default exports for the public API.
- Prefer composition over inheritance for adapters.
- Keep each `src/lib/*.ts` file scoped to a single command or a single concern. New commands → new file.
- All Playwright calls are isolated in `src/lib/claude-design.ts` so the rest of the codebase stays unit-testable.
