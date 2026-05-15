# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

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
