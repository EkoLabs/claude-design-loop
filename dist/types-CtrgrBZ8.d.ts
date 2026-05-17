/**
 * Per-repo configuration. A repo declares its specifics here; the engine stays
 * untouched. Resolved by walking up from the cwd looking for
 * `.design-loop.config.ts` (or `.js`/`.mjs`).
 */
type Framework = 'svelte' | 'react' | 'vue' | 'html';
interface DesignSystemRef {
    /** Display name in claude.ai/design (used to instruct the human). */
    name: string;
    /** Optional UUID, captured from the design system picker. */
    id?: string;
}
interface DesignLoopConfig {
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
declare function defineConfig(config: DesignLoopConfig): DesignLoopConfig;
/** Normalize `config.designSystem` to a non-empty array. The first entry
 * is always the default. */
declare function getDesignSystems(config: DesignLoopConfig): DesignSystemRef[];
/** Convenience: the default design system (first entry). */
declare function getDefaultDesignSystem(config: DesignLoopConfig): DesignSystemRef;
interface LoadedConfig {
    config: DesignLoopConfig;
    /** Directory containing the config file — used as the project root. */
    rootDir: string;
    configPath: string;
}
/**
 * Walk up from `startDir` until a config file is found. Throws if none exists.
 */
declare function loadConfig(startDir?: string): Promise<LoadedConfig>;

/**
 * Adapter interface. The only framework-coupled surface in the package.
 *
 * Implementations live in `src/adapters/<framework>.ts` and are wired up in
 * `src/adapters/index.ts`. Adding a new framework = one new adapter.
 */

interface ApplyContext {
    config: DesignLoopConfig;
    rootDir: string;
    loopId: string;
    loopRoot: string;
    bundleDir: string;
    outputDir: string;
    /** Items the human ticked in `review-checklist.md`. */
    approvedItems: string[];
    /** Items the human explicitly excluded (✗). */
    rejectedItems: string[];
    /** Free-form notes from the bottom of the checklist. */
    notes: string;
}
interface ApplyResult {
    /** Files written to `outputDir/translated/`. */
    translatedFiles: string[];
    /** Files in the live codebase the agent should consider editing. */
    candidateTargets: string[];
    /** Free-form notes the adapter wants the human / next agent to read. */
    notes: string[];
}
interface DiscoveredRoute {
    /** URL path as it appears in the running app, e.g. `/`, `/canonical`. */
    path: string;
    /** Filesystem path to the file that defines this route. */
    filePath: string;
    /** True if the route contains dynamic segments like `[id]`. The wizard
     * surfaces these but warns the user — Claude Design needs a real value. */
    dynamic: boolean;
}
interface DiscoverOptions {
    routesDir: string;
    /** Routes to filter out (compared as path strings, e.g. `/mockup`). */
    exclude?: string[];
}
interface Adapter {
    /** Display name (used in logs). */
    name: string;
    /**
     * Translate the bundle's standalone HTML/CSS into framework-native source.
     * Writes to `outputDir/translated/`. Does NOT modify the live codebase.
     * That step is a separate, agent-driven decision.
     */
    apply(ctx: ApplyContext): Promise<ApplyResult>;
    /**
     * Walk `routesDir` and return every URL path the framework exposes.
     * Implementations should respect `exclude`. Used by the wizard to give
     * the user a route picker without requiring them to remember paths.
     */
    discoverRoutes(opts: DiscoverOptions): Promise<DiscoveredRoute[]>;
}

export { type Adapter as A, type DesignLoopConfig as D, type Framework as F, type DesignSystemRef as a, type DiscoveredRoute as b, getDesignSystems as c, defineConfig as d, getDefaultDesignSystem as g, loadConfig as l };
