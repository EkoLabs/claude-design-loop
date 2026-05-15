import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { nextjsAdapter } from '../src/adapters/nextjs.ts';

let tmp: string;

function touch(path: string, contents = 'export default function P() { return null }\n'): void {
  mkdirSync(resolve(path, '..'), { recursive: true });
  writeFileSync(path, contents, 'utf8');
}

beforeEach(() => {
  tmp = mkdtempSync(resolve(tmpdir(), 'cdl-next-test-'));
});

afterEach(() => {
  try {
    rmSync(tmp, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

describe('nextjsAdapter.discoverRoutes — App Router', () => {
  it('returns an empty list when routesDir does not exist', async () => {
    const routes = await nextjsAdapter.discoverRoutes({
      routesDir: join(tmp, 'does/not/exist'),
    });
    expect(routes).toEqual([]);
  });

  it('discovers `page.tsx` files at every level', async () => {
    const routesDir = join(tmp, 'src/app');
    touch(join(routesDir, 'page.tsx'));
    touch(join(routesDir, 'about/page.tsx'));
    touch(join(routesDir, 'blog/[slug]/page.tsx'));
    touch(join(routesDir, 'blog/[...slug]/page.tsx'));

    const routes = await nextjsAdapter.discoverRoutes({ routesDir });
    const paths = routes.map((r) => r.path).sort();
    expect(paths).toEqual([
      '/',
      '/about',
      '/blog/[...slug]',
      '/blog/[slug]',
    ]);

    const dyn = routes.find((r) => r.path === '/blog/[slug]');
    expect(dyn?.dynamic).toBe(true);
    const root = routes.find((r) => r.path === '/');
    expect(root?.dynamic).toBe(false);
  });

  it('accepts every App Router page extension', async () => {
    const routesDir = join(tmp, 'src/app');
    touch(join(routesDir, 'a/page.tsx'));
    touch(join(routesDir, 'b/page.jsx'));
    touch(join(routesDir, 'c/page.ts'));
    touch(join(routesDir, 'd/page.js'));

    const routes = await nextjsAdapter.discoverRoutes({ routesDir });
    expect(routes.map((r) => r.path).sort()).toEqual(['/a', '/b', '/c', '/d']);
  });

  it('strips route groups `(group)` from the route path', async () => {
    const routesDir = join(tmp, 'src/app');
    touch(join(routesDir, '(marketing)/about/page.tsx'));
    touch(join(routesDir, '(app)/dashboard/page.tsx'));

    const routes = await nextjsAdapter.discoverRoutes({ routesDir });
    expect(routes.map((r) => r.path).sort()).toEqual(['/about', '/dashboard']);
  });

  it('strips parallel-route slot folders `@slot` from the route path', async () => {
    const routesDir = join(tmp, 'src/app');
    touch(join(routesDir, 'page.tsx'));
    touch(join(routesDir, '@modal/page.tsx'));
    touch(join(routesDir, 'dashboard/@analytics/page.tsx'));

    const routes = await nextjsAdapter.discoverRoutes({ routesDir });
    const paths = routes.map((r) => r.path).sort();
    // @modal/page.tsx becomes a slot view of `/` (path = `/`).
    // dashboard/@analytics/page.tsx becomes a slot view of `/dashboard`.
    expect(paths).toContain('/');
    expect(paths).toContain('/dashboard');
  });

  it('skips private folders `_components`', async () => {
    const routesDir = join(tmp, 'src/app');
    touch(join(routesDir, 'page.tsx'));
    touch(join(routesDir, '_components/page.tsx'));
    touch(join(routesDir, '_lib/page.tsx'));

    const routes = await nextjsAdapter.discoverRoutes({ routesDir });
    expect(routes.map((r) => r.path)).toEqual(['/']);
  });

  it('skips intercepting routes `(.)foo`, `(..)foo`, `(...)foo`', async () => {
    const routesDir = join(tmp, 'src/app');
    touch(join(routesDir, 'feed/page.tsx'));
    touch(join(routesDir, 'feed/(..)photo/[id]/page.tsx'));
    touch(join(routesDir, '(.)photo/[id]/page.tsx'));
    touch(join(routesDir, '(...)photo/[id]/page.tsx'));

    const routes = await nextjsAdapter.discoverRoutes({ routesDir });
    expect(routes.map((r) => r.path).sort()).toEqual(['/feed']);
  });

  it('honors the exclude list', async () => {
    const routesDir = join(tmp, 'src/app');
    touch(join(routesDir, 'page.tsx'));
    touch(join(routesDir, 'admin/page.tsx'));
    touch(join(routesDir, 'public/page.tsx'));

    const routes = await nextjsAdapter.discoverRoutes({
      routesDir,
      exclude: ['/admin'],
    });
    expect(routes.map((r) => r.path).sort()).toEqual(['/', '/public']);
  });
});

describe('nextjsAdapter.discoverRoutes — Pages Router', () => {
  it('treats every non-reserved file as a route', async () => {
    const routesDir = join(tmp, 'src/pages');
    touch(join(routesDir, 'index.tsx'));
    touch(join(routesDir, 'about.tsx'));
    touch(join(routesDir, 'blog/[slug].tsx'));
    touch(join(routesDir, 'blog/index.tsx'));

    const routes = await nextjsAdapter.discoverRoutes({ routesDir });
    expect(routes.map((r) => r.path).sort()).toEqual([
      '/',
      '/about',
      '/blog',
      '/blog/[slug]',
    ]);
  });

  it('skips reserved Pages Router files', async () => {
    const routesDir = join(tmp, 'src/pages');
    touch(join(routesDir, 'index.tsx'));
    touch(join(routesDir, '_app.tsx'));
    touch(join(routesDir, '_document.tsx'));
    touch(join(routesDir, '_error.tsx'));
    touch(join(routesDir, '404.tsx'));
    touch(join(routesDir, '500.tsx'));
    touch(join(routesDir, 'middleware.ts'));

    const routes = await nextjsAdapter.discoverRoutes({ routesDir });
    expect(routes.map((r) => r.path)).toEqual(['/']);
  });

  it('skips the `api/` folder (server routes)', async () => {
    const routesDir = join(tmp, 'src/pages');
    touch(join(routesDir, 'index.tsx'));
    touch(join(routesDir, 'api/users.ts'));
    touch(join(routesDir, 'api/users/[id].ts'));

    const routes = await nextjsAdapter.discoverRoutes({ routesDir });
    expect(routes.map((r) => r.path)).toEqual(['/']);
  });

  it('returns routes sorted alphabetically', async () => {
    const routesDir = join(tmp, 'src/pages');
    touch(join(routesDir, 'zeta.tsx'));
    touch(join(routesDir, 'alpha.tsx'));
    touch(join(routesDir, 'middle.tsx'));

    const routes = await nextjsAdapter.discoverRoutes({ routesDir });
    expect(routes.map((r) => r.path)).toEqual(['/alpha', '/middle', '/zeta']);
  });
});
