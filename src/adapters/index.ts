/**
 * Adapter registry. To add a framework: write `<name>.ts` exporting an
 * Adapter, then add it to the registry below.
 */

import type { Framework } from '../config.ts';
import type { Adapter } from './types.ts';
import { svelteAdapter } from './svelte.ts';
import { htmlAdapter } from './html.ts';

const stub = (name: string): Adapter => ({
  name,
  async apply() {
    throw new Error(
      `Adapter \`${name}\` is not implemented yet. Add packages/design-loop/src/adapters/${name}.ts and register it in adapters/index.ts.`,
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
  react: stub('react'),
  vue: stub('vue'),
};

export function getAdapter(framework: Framework): Adapter {
  return REGISTRY[framework];
}

export type { Adapter } from './types.ts';
