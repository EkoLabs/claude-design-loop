import { defineConfig } from '@ekolabs/claude-design-loop';

/**
 * Example config for a SvelteKit app.
 *
 * Copy to your repo root as `.design-loop.config.ts`, then:
 *   1. Adjust `devUrl` to whatever port your dev server uses.
 *   2. Adjust `routesDir` if your project uses a non-default routes dir.
 *   3. Run `design-loop login`, then `design-loop systems` to discover the
 *      UUIDs of design systems available on your claude.ai/design account.
 *   4. Paste the UUIDs into the `designSystem` array below.
 */
export default defineConfig({
  framework: 'svelte',
  devUrl: 'http://localhost:5173',
  routesDir: 'src/routes',

  // Routes you don't want surfaced in the wizard's picker. Prefix-matched.
  excludeRoutes: ['/admin', '/internal'],

  // Single ref, OR an array (first = default). The wizard shows a picker
  // when there's more than one. Run `design-loop systems` to discover ids.
  designSystem: [
    {
      name: 'Your Customer-Facing Design System',
      id: '00000000-0000-0000-0000-000000000000',
    },
  ],

  loopsDir: 'design-loops',
  breakpoints: [1280, 768, 375],

  // Optional: wait for an auth/loading overlay to disappear before screenshotting.
  // waitFor: {
  //   hidden: 'text=Loading',
  //   timeoutMs: 20_000,
  // },
});
