import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { svelteAdapter } from '../src/adapters/svelte.ts';

let tmp: string;

function touch(path: string): void {
  mkdirSync(resolve(path, '..'), { recursive: true });
  writeFileSync(path, '<script></script>\n', 'utf8');
}

beforeEach(() => {
  tmp = mkdtempSync(resolve(tmpdir(), 'cdl-svelte-test-'));
});

afterEach(() => {
  try {
    rmSync(tmp, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

describe('svelteAdapter.discoverRoutes', () => {
  it('returns an empty list when routesDir does not exist', async () => {
    const routes = await svelteAdapter.discoverRoutes({
      routesDir: join(tmp, 'does/not/exist'),
    });
    expect(routes).toEqual([]);
  });

  it('discovers `+page.svelte` files and maps them to routes', async () => {
    const routesDir = join(tmp, 'src/routes');
    touch(join(routesDir, '+page.svelte'));
    touch(join(routesDir, 'about/+page.svelte'));
    touch(join(routesDir, 'blog/[slug]/+page.svelte'));

    const routes = await svelteAdapter.discoverRoutes({
      routesDir,
    });

    const paths = routes.map((r) => r.path);
    expect(paths).toContain('/');
    expect(paths).toContain('/about');
    expect(paths).toContain('/blog/[slug]');
    expect(paths).toHaveLength(3);

    const dynamic = routes.find((r) => r.path === '/blog/[slug]');
    expect(dynamic?.dynamic).toBe(true);
    const root = routes.find((r) => r.path === '/');
    expect(root?.dynamic).toBe(false);
  });

  it('strips SvelteKit grouping folders from the route path', async () => {
    const routesDir = join(tmp, 'src/routes');
    touch(join(routesDir, '(marketing)/about/+page.svelte'));
    touch(join(routesDir, '(app)/dashboard/+page.svelte'));

    const routes = await svelteAdapter.discoverRoutes({
      routesDir,
    });
    const paths = routes.map((r) => r.path).sort();
    expect(paths).toEqual(['/about', '/dashboard']);
  });

  it('skips private (`_underscore`) folders', async () => {
    const routesDir = join(tmp, 'src/routes');
    touch(join(routesDir, 'public/+page.svelte'));
    touch(join(routesDir, '_internal/+page.svelte'));
    touch(join(routesDir, '_archive/old/+page.svelte'));

    const routes = await svelteAdapter.discoverRoutes({
      routesDir,
    });
    expect(routes.map((r) => r.path)).toEqual(['/public']);
  });

  it('honors the exclude list', async () => {
    const routesDir = join(tmp, 'src/routes');
    touch(join(routesDir, '+page.svelte'));
    touch(join(routesDir, 'admin/+page.svelte'));
    touch(join(routesDir, 'public/+page.svelte'));

    const routes = await svelteAdapter.discoverRoutes({
      routesDir,
      exclude: ['/admin'],
    });
    expect(routes.map((r) => r.path).sort()).toEqual(['/', '/public']);
  });

  it('returns routes sorted alphabetically for stable picker UX', async () => {
    const routesDir = join(tmp, 'src/routes');
    touch(join(routesDir, 'zeta/+page.svelte'));
    touch(join(routesDir, 'alpha/+page.svelte'));
    touch(join(routesDir, 'middle/+page.svelte'));

    const routes = await svelteAdapter.discoverRoutes({
      routesDir,
    });
    expect(routes.map((r) => r.path)).toEqual(['/alpha', '/middle', '/zeta']);
  });
});
