/**
 * Per-repo configuration. A repo declares its specifics here; the engine stays
 * untouched. Resolved by walking up from the cwd looking for
 * `.design-loop.config.ts` (or `.js`/`.mjs`).
 */

import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export type Framework = 'svelte' | 'react' | 'vue' | 'html';

export interface DesignSystemRef {
  /** Display name in claude.ai/design (used to instruct the human). */
  name: string;
  /** Optional UUID, captured from the design system picker. */
  id?: string;
}

export interface DesignLoopConfig {
  /** Framework of the codebase. Drives the adapter used in `apply`. */
  framework: Framework;
  /** Local dev-server URL. Routes are appended to this. */
  devUrl: string;
  /** Filesystem path to the routes directory (used to resolve component paths). */
  routesDir: string;
  /** Routes never operated on (e.g. mockups, fullscreen experiments). */
  excludeRoutes?: string[];
  /** Design systems available in your Claude org. Pass a single ref for
   * a fixed default, or an array to let the wizard pick (first = default).
   * Whatever shape you supply, internal consumers normalize via
   * `getDesignSystems()`. */
  designSystem: DesignSystemRef | DesignSystemRef[];
  /** Markdown files whose contents are appended to every brief as context. */
  contextSources?: string[];
  /** Where loop runs are stored. Default: `design-loops/`. */
  loopsDir?: string;
  /** Viewport widths (px) to capture screenshots at. Default: [1280, 768, 375]. */
  breakpoints?: number[];
  /** Optional Playwright storageState path for a logged-in browser context. */
  storageState?: string;
  /** How long to wait after navigation before capturing. Default: 3000ms. */
  settleMs?: number;
  /**
   * Optional readiness check. Apps with auth gates, splash screens, or async
   * data hydration should set this so screenshots capture real content.
   * Selectors use Playwright locator syntax (`text=...`, `[data-test=foo]`,
   * etc.). All conditions must be met before capture begins.
   */
  waitFor?: {
    /** Must be visible before capture. */
    visible?: string;
    /** Must be hidden before capture. */
    hidden?: string;
    /** Per-condition timeout in ms. Default: 15000. */
    timeoutMs?: number;
  };
}

/**
 * Identity helper for typed configs. Repos call this in `.design-loop.config.ts`.
 *
 *   import { defineConfig } from '@ekolabs/claude-design-loop';
 *   export default defineConfig({ framework: 'svelte', ... });
 */
export function defineConfig(config: DesignLoopConfig): DesignLoopConfig {
  return config;
}

/** Normalize `config.designSystem` to a non-empty array. The first entry
 * is always the default. */
export function getDesignSystems(config: DesignLoopConfig): DesignSystemRef[] {
  const ds = config.designSystem;
  return Array.isArray(ds) ? ds : [ds];
}

/** Convenience: the default design system (first entry). */
export function getDefaultDesignSystem(config: DesignLoopConfig): DesignSystemRef {
  return getDesignSystems(config)[0]!;
}

const DEFAULTS = {
  loopsDir: 'design-loops',
  breakpoints: [1280, 768, 375],
  settleMs: 3000,
  excludeRoutes: [] as string[],
  contextSources: [] as string[],
} as const;

export type ResolvedConfig = Required<
  Omit<DesignLoopConfig, 'storageState' | 'designSystem' | 'waitFor'>
> &
  Pick<DesignLoopConfig, 'storageState' | 'designSystem' | 'waitFor'>;

export function withDefaults(config: DesignLoopConfig): ResolvedConfig {
  return {
    ...DEFAULTS,
    ...config,
    excludeRoutes: config.excludeRoutes ?? [...DEFAULTS.excludeRoutes],
    contextSources: config.contextSources ?? [...DEFAULTS.contextSources],
    breakpoints: config.breakpoints ?? [...DEFAULTS.breakpoints],
  };
}

const CONFIG_FILENAMES = [
  '.design-loop.config.ts',
  '.design-loop.config.mts',
  '.design-loop.config.mjs',
  '.design-loop.config.js',
  'design-loop.config.ts',
  'design-loop.config.mts',
  'design-loop.config.mjs',
  'design-loop.config.js',
];

export interface LoadedConfig {
  config: DesignLoopConfig;
  /** Directory containing the config file — used as the project root. */
  rootDir: string;
  configPath: string;
}

/**
 * Walk up from `startDir` until a config file is found. Throws if none exists.
 */
export async function loadConfig(startDir = process.cwd()): Promise<LoadedConfig> {
  let dir = resolve(startDir);
  while (true) {
    for (const name of CONFIG_FILENAMES) {
      const candidate = resolve(dir, name);
      if (existsSync(candidate)) {
        const mod = await import(pathToFileURL(candidate).href);
        const config = (mod.default ?? mod.config) as DesignLoopConfig | undefined;
        if (!config) {
          throw new Error(
            `${candidate} does not export a default config. Use \`export default defineConfig({...})\`.`,
          );
        }
        return { config, rootDir: dir, configPath: candidate };
      }
    }
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error(
        `No design-loop config found in ${startDir} or any parent. Create a \`.design-loop.config.ts\` at your repo root.`,
      );
    }
    dir = parent;
  }
}
