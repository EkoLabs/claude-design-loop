# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

## [0.2.0] - 2026-05-15

### Added
- **Next.js adapter** (`framework: 'react'`) — full route discovery for both
  App Router (`page.{tsx,jsx,ts,js}` under `src/app` or `app`) and Pages
  Router (`src/pages` or `pages`), respecting Next.js conventions: route
  groups `(group)`, parallel routes `@slot`, private folders `_*`,
  intercepting routes, and reserved files (`_app`, `_document`, `_error`,
  `404`, `500`, `api/`). Apply emits `.tsx` component scaffolds with CSS
  Modules and copies sibling assets, mirroring the Svelte adapter's shape.
- Validated end-to-end against a real Next.js 14 App Router project
  (`eko-file-editor`).

### Changed
- `design-loop init` stub now documents the `react` framework option
  alongside `svelte` and `html`, and lists conventional `routesDir` values
  for each.

### Fixed
- Suppress Node 24's `MODULE_TYPELESS_PACKAGE_JSON` warning when loading
  the consumer's `.design-loop.config.ts`. The warning fired on every run
  in any consumer whose `package.json` lacked `"type": "module"` (typical
  for Next.js apps). The reparsing it warned about is a no-op for one
  small config file, so we filter just this warning at CLI startup.

## [0.1.0] - 2026-05-15

Initial extraction from `product-media-pipeline`.

### Added
- Interactive wizard (`design-loop`) — pick action, route, design system, intent, project name, confirm.
- Per-repo concurrency lockfile (`<loopsDir>/.lock.json`) with stale-detection and force-unlock prompt.
- `design-loop systems` — scrape design-system UUIDs from claude.ai/design's New Project picker.
- Auto-lookup of missing design-system ids during the wizard (offers to scrape on the fly).
- Resume flow — re-attach to an in-progress claude.ai/design project after an interrupted submit.
- Chained `[f]etch` → `pull` → `apply` after the first design pass; `--no-apply` and `--no-pull` escape hatches.
- `CURSOR_PROMPT.md` generation + opt-in clipboard copy on macOS (`pbcopy`).
- Svelte adapter with `discoverRoutes` (SvelteKit `+page.svelte`, group folders, dynamic params).
- Static HTML adapter for non-framework projects.
- TTY list prompts with arrow-key navigation, number jumps, Home/End, Page Up/Down.
