/**
 * Adapter interface. The only framework-coupled surface in the package.
 *
 * Implementations live in `src/adapters/<framework>.ts` and are wired up in
 * `src/adapters/index.ts`. Adding a new framework = one new adapter.
 */

import type { DesignLoopConfig } from '../config.ts';

export interface ApplyContext {
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

export interface ApplyResult {
  /** Files written to `outputDir/translated/`. */
  translatedFiles: string[];
  /** Files in the live codebase the agent should consider editing. */
  candidateTargets: string[];
  /** Free-form notes the adapter wants the human / next agent to read. */
  notes: string[];
}

export interface DiscoveredRoute {
  /** URL path as it appears in the running app, e.g. `/`, `/canonical`. */
  path: string;
  /** Filesystem path to the file that defines this route. */
  filePath: string;
  /** True if the route contains dynamic segments like `[id]`. The wizard
   * surfaces these but warns the user — Claude Design needs a real value. */
  dynamic: boolean;
}

export interface DiscoverOptions {
  routesDir: string;
  /** Routes to filter out (compared as path strings, e.g. `/mockup`). */
  exclude?: string[];
}

export interface Adapter {
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
