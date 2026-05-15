/**
 * Adapter registry. To add a framework: write `<name>.ts` exporting an
 * Adapter, then add it to the registry below.
 */

import type { Framework } from '../config.ts';
import type { Adapter } from './types.ts';
import { svelteAdapter } from './svelte.ts';
import { htmlAdapter } from './html.ts';
import { nextjsAdapter } from './nextjs.ts';

const stub = (name: string): Adapter => ({
  name,
  async apply() {
    throw new Error(
      `Adapter \`${name}\` is not implemented yet. Add src/adapters/${name}.ts and register it in adapters/index.ts.`,
    );
  },
  async discoverRoutes() {
    throw new Error(
      `Route discovery is not implemented for the \`${name}\` adapter yet.`,
    );
  },
});

const REGISTRY: Record<Framework, Adapter> = {
  svelte: svelteAdapter,
  html: htmlAdapter,
  // `react` is the Next.js adapter — Next.js is the dominant React framework
  // we target. If we ever need a non-Next.js React adapter, add it as a new
  // framework key (e.g. `react-vite`) rather than splitting `react`.
  react: nextjsAdapter,
  vue: stub('vue'),
};

export function getAdapter(framework: Framework): Adapter {
  return REGISTRY[framework];
}

export type { Adapter } from './types.ts';
