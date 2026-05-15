# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

## [0.2.3] - 2026-05-15

### Fixed
- **`pnpm exec design-loop` crashed with `ERR_MODULE_NOT_FOUND` after a
  fresh `github:` install.** pnpm's git-install layout puts the commit
  SHA in the directory name (e.g. `.../claude-design-loop.git#<sha>/`).
  The bin shim was passing a raw absolute path to `await import()`,
  which Node converts to a `file://` URL — and treats the `#` as a URL
  fragment, truncating the path. Now goes through `pathToFileURL` so
  `#` (and any other special chars, e.g. spaces on Windows) are
  properly percent-encoded. Affected every consumer using
  `pnpm exec design-loop`, `pnpm design`, or any pnpm-driven invocation
  of the bin. `node node_modules/@ekolabs/.../dist/cli.js` was the
  workaround. npm / direct-`node` invocations were unaffected.

### Changed
- README: clarified that `pnpm install` / `npm install` does NOT
  re-fetch the latest commit when tracking `main`, because lockfiles
  pin GitHub deps to a SHA on first install. Teammates upgrading must
  explicitly `pnpm update @ekolabs/claude-design-loop` (or `npm update
  ...`). Documented prominently in the install section.

## [0.2.2] - 2026-05-15

### Changed
- README: install instructions now recommend tracking `main`
  (`github:EkoLabs/claude-design-loop`) as the default. Tag-pinned
  installs (`#vX.Y.Z`) are still documented as the recommended choice
  for shared CI/CD and any repo that needs reproducible installs.
- README: corrected stale spots that listed only `'svelte' | 'html'` as
  framework options — `'react'` (Next.js) is fully supported as of
  v0.2.0.
- Cursor handoff prompt (`CURSOR_PROMPT.md`) is now framework-aware:
  - `suggestComponentDir` now suggests `src/components` for Next.js
    projects (the dominant convention) instead of an awkward
    `src/app/_components`. SvelteKit's `lib/components` heuristic is
    preserved.
  - The "Don't carry React patterns over" instruction is now only
    emitted for Svelte/Vue targets — emitting it for React consumers
    was confusing because the bundle's source IS React.

## [0.2.1] - 2026-05-15

### Added
- **Automatic `.gitignore` management** so loop run artifacts (bundles,
  screenshots, scaffolds, manifests, lockfile) can never be accidentally
  committed:
  - `design-loop init` appends a two-line rule to the consumer's root
    `.gitignore`:

    ```
    design-loops/*
    !design-loops/.gitignore
    ```

    The first line ignores loop run output; the second line propagates
    the sub-`.gitignore` to teammates via normal git workflow.
    Idempotent — recognises any pre-existing rule that already covers
    `loopsDir` (`design-loops`, `design-loops/`, `design-loops/*`) and
    refuses to clobber existing entries.
  - Every loop run plants a sub-`.gitignore` inside `<loopsDir>/` with
    `*\n!.gitignore\n` as a second-layer defense — protects even if
    the root rule is removed/edited. Customised sub-gitignores are
    preserved.
- README: new "Loop artifacts & cleanup" section explaining what lives
  under `loopsDir/`, the two-layer gitignore strategy, manual cleanup
  recipes, and where the persistent auth state lives (outside the repo).

### Changed
- README: clarified that `framework: 'react'` is supported (Next.js
  App Router and Pages Router) — the docs were stale from the v0.2.0
  adapter addition.

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
