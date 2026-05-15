/**
 * HTML adapter — pass-through. Useful when the consuming "framework" is just
 * static HTML, or when you want to inspect raw bundle content without any
 * translation step.
 */

import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import type {
  Adapter,
  ApplyContext,
  ApplyResult,
  DiscoverOptions,
  DiscoveredRoute,
} from './types.ts';

export const htmlAdapter: Adapter = {
  name: 'html',
  async discoverRoutes(opts: DiscoverOptions): Promise<DiscoveredRoute[]> {
    const found: DiscoveredRoute[] = [];
    walk(opts.routesDir, (file) => {
      if (!file.endsWith('.html')) return;
      const rel = file.slice(opts.routesDir.length).replace(/^\/+/, '');
      const path = '/' + rel.replace(/(^|\/)index\.html$/, '').replace(/\.html$/, '');
      const normalized = path === '/' ? '/' : path.replace(/\/$/, '');
      if (opts.exclude?.includes(normalized)) return;
      found.push({ path: normalized, filePath: file, dynamic: false });
    });
    found.sort((a, b) => a.path.localeCompare(b.path));
    return found;
  },
  async apply(ctx: ApplyContext): Promise<ApplyResult> {
    const translatedDir = join(ctx.outputDir, 'translated');
    mkdirSync(translatedDir, { recursive: true });

    const translatedFiles: string[] = [];
    walk(ctx.bundleDir, (file) => {
      if (!file.endsWith('.html')) return;
      const dest = join(translatedDir, basename(file));
      copyFileSync(file, dest);
      translatedFiles.push(dest);
    });

    return {
      translatedFiles,
      candidateTargets: [],
      notes: ['HTML pass-through — files copied as-is, no translation performed.'],
    };
  },
};

function walk(dir: string, onFile: (path: string) => void): void {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, onFile);
    else onFile(full);
  }
}
