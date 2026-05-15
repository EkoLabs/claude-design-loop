/**
 * Next.js adapter (React, App Router + Pages Router).
 *
 * Strategy mirrors the Svelte adapter:
 *
 * - `discoverRoutes` walks the configured `routesDir` and yields a route
 *   per `page.{tsx,jsx,ts,js}` (App Router) or per non-private `.{tsx,jsx,ts,js}`
 *   file (Pages Router). Both routers are supported in one adapter — the
 *   detection is per-folder, so monorepos that mix old and new conventions
 *   still work.
 *
 * - `apply` translates a Claude Design handoff bundle into:
 *     - `<Name>.tsx`         — a `'use client'` component scaffold
 *     - `<Name>.module.css`  — CSS Modules styles extracted from <style> +
 *                              <link rel="stylesheet"> blocks
 *     - `sources/<Name>/`    — verbatim copies of the bundle's JSX/JS/CSS
 *                              files, used as the source of truth when the
 *                              bundle's <body> is a React mount point.
 *
 *   The output is a *scaffold*, not finished code. The expected workflow:
 *   open Cursor chat with `CURSOR_PROMPT.md`, point it at the scaffold +
 *   the live route, and let it merge.
 */

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import type {
  Adapter,
  ApplyContext,
  ApplyResult,
  DiscoverOptions,
  DiscoveredRoute,
} from './types.ts';

const APP_ROUTER_PAGE = /^page\.(tsx|jsx|ts|js)$/;
const PAGES_ROUTER_FILE = /\.(tsx|jsx|ts|js)$/;
// Pages Router files that are NOT routes.
const PAGES_ROUTER_RESERVED = new Set([
  '_app',
  '_document',
  '_error',
  '404',
  '500',
  'middleware',
]);

export const nextjsAdapter: Adapter = {
  name: 'nextjs',

  async discoverRoutes(opts: DiscoverOptions): Promise<DiscoveredRoute[]> {
    const root = resolve(opts.routesDir);
    if (!existsSync(root)) return [];
    const exclude = new Set((opts.exclude ?? []).map(normalizeRoute));

    // Decide router style by looking for App Router signal anywhere in the
    // tree. If we see at least one `page.{tsx,jsx,ts,js}`, treat the whole
    // tree as App Router (folder-per-route). Otherwise Pages Router (file-
    // per-route). Both can coexist in different folders, but conventionally
    // a Next.js project picks one and sticks with it.
    const hasAppRouterSignal = anyMatch(root, (name) =>
      APP_ROUTER_PAGE.test(name),
    );

    const found: DiscoveredRoute[] = [];

    if (hasAppRouterSignal) {
      walkAppRouter(root, root, found);
    } else {
      walkPagesRouter(root, root, found);
    }

    const filtered = found.filter((r) => !exclude.has(r.path));
    filtered.sort((a, b) => a.path.localeCompare(b.path));
    return filtered;
  },

  async apply(ctx: ApplyContext): Promise<ApplyResult> {
    const translatedDir = join(ctx.outputDir, 'translated');
    mkdirSync(translatedDir, { recursive: true });

    const htmlPages = findHtmlPages(ctx.bundleDir);
    if (!htmlPages.length) {
      return {
        translatedFiles: [],
        candidateTargets: [],
        notes: [
          'No standalone HTML pages found in bundle. Claude Design may have produced only chat output without committing a design to the canvas. Open the project URL and confirm the canvas has artifacts before retrying.',
        ],
      };
    }

    const translatedFiles: string[] = [];
    const adapterNotes: string[] = [];

    for (const htmlPath of htmlPages) {
      const html = readFileSync(htmlPath, 'utf8');
      const htmlDir = dirname(htmlPath);
      const { body, styles, linkedCss, externalScripts } = splitHtml(html);

      const inlinedCssBlocks: string[] = [];
      for (const cssHref of linkedCss) {
        const cssPath = join(htmlDir, cssHref);
        if (existsSync(cssPath) && statSync(cssPath).isFile()) {
          inlinedCssBlocks.push(
            `/* From bundle/${cssHref} */\n${readFileSync(cssPath, 'utf8')}`,
          );
        }
      }
      const allStyles = [styles, ...inlinedCssBlocks].filter(Boolean).join('\n\n');

      const componentName = toComponentName(basename(htmlPath, '.html'));
      const bodyIsEmpty = isEffectivelyEmpty(body);

      // Mirror Svelte adapter: surface JSX/JS/CSS source files when <body>
      // is a React mount point.
      const sourceFiles: string[] = [];
      if (bodyIsEmpty) {
        const sourcesDir = join(translatedDir, 'sources', componentName);
        mkdirSync(sourcesDir, { recursive: true });
        for (const sib of listSiblingAssets(htmlDir)) {
          copyFileSync(sib, join(sourcesDir, basename(sib)));
          sourceFiles.push(`sources/${componentName}/${basename(sib)}`);
        }
        if (sourceFiles.length) {
          adapterNotes.push(
            `${componentName}: <body> was empty (React mount point). Copied ${sourceFiles.length} reference files to ${relative(ctx.outputDir, sourcesDir)}/.`,
          );
        }
      }

      // Emit CSS Modules file alongside the .tsx so the scaffold can import it.
      const cssModulePath = join(translatedDir, `${componentName}.module.css`);
      if (allStyles) {
        writeFileSync(cssModulePath, allStyles + '\n', 'utf8');
        translatedFiles.push(cssModulePath);
      }

      const tsxSource = renderTsxScaffold(
        componentName,
        body,
        ctx,
        {
          bodyIsEmpty,
          sourceFiles,
          externalScripts,
          hasStyles: Boolean(allStyles),
        },
      );
      const outPath = join(translatedDir, `${componentName}.tsx`);
      writeFileSync(outPath, tsxSource, 'utf8');
      translatedFiles.push(outPath);
    }

    return {
      translatedFiles,
      candidateTargets: [],
      notes: [
        'Translated files are scaffolds, not finished components. Open Cursor chat and ask it to merge the scaffold into the live route, using the copied source files as the source of truth.',
        ...adapterNotes,
      ],
    };
  },
};

// ────────────────────────────────────────────────────────────────────────
// Route discovery
// ────────────────────────────────────────────────────────────────────────

function anyMatch(dir: string, predicate: (name: string) => boolean): boolean {
  if (!existsSync(dir)) return false;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (entry.name.startsWith('_') || entry.name.startsWith('.')) continue;
      if (anyMatch(join(dir, entry.name), predicate)) return true;
    } else if (predicate(entry.name)) {
      return true;
    }
  }
  return false;
}

function walkAppRouter(
  root: string,
  dir: string,
  acc: DiscoveredRoute[],
): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      // Skip private folders (`_components`, `_lib`).
      if (entry.name.startsWith('_')) continue;
      // Skip intercepting routes — they're rewrites, not new routes.
      if (
        entry.name.startsWith('(.)') ||
        entry.name.startsWith('(..)') ||
        entry.name.startsWith('(...)')
      ) {
        continue;
      }
      walkAppRouter(root, full, acc);
      continue;
    }
    if (!APP_ROUTER_PAGE.test(entry.name)) continue;
    const rel = relative(root, dir);
    const path = appRouterRouteFromRel(rel);
    acc.push({
      path,
      filePath: full,
      dynamic: /\[[^\]]+\]/.test(path),
    });
  }
}

function walkPagesRouter(
  root: string,
  dir: string,
  acc: DiscoveredRoute[],
): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      // Skip private folders, hidden, and `api` (server routes).
      if (entry.name.startsWith('_')) continue;
      if (entry.name.startsWith('.')) continue;
      if (relative(root, full) === 'api') continue;
      walkPagesRouter(root, full, acc);
      continue;
    }
    if (!PAGES_ROUTER_FILE.test(entry.name)) continue;
    const stem = entry.name.replace(PAGES_ROUTER_FILE, '');
    if (PAGES_ROUTER_RESERVED.has(stem)) continue;
    const relDir = relative(root, dir);
    const path = pagesRouterRouteFromRel(relDir, stem);
    acc.push({
      path,
      filePath: full,
      dynamic: /\[[^\]]+\]/.test(path),
    });
  }
}

function appRouterRouteFromRel(rel: string): string {
  if (!rel || rel === '.') return '/';
  // Strip route groups: `(marketing)/about` → `/about`.
  // Strip parallel-route slots: `@auth` are slots, not segments.
  const parts = rel
    .split(/[\\/]/)
    .filter(
      (p) =>
        !(p.startsWith('(') && p.endsWith(')')) && // route groups
        !p.startsWith('@'), // parallel route slots
    );
  return parts.length === 0 ? '/' : `/${parts.join('/')}`;
}

function pagesRouterRouteFromRel(relDir: string, stem: string): string {
  const dirParts = relDir && relDir !== '.' ? relDir.split(/[\\/]/) : [];
  const fileSegment = stem === 'index' ? '' : stem;
  const segments = [...dirParts, fileSegment].filter(Boolean);
  return segments.length === 0 ? '/' : `/${segments.join('/')}`;
}

function normalizeRoute(p: string): string {
  if (!p) return '/';
  if (p === '/') return '/';
  return p.startsWith('/') ? p : `/${p}`;
}

// ────────────────────────────────────────────────────────────────────────
// Apply helpers (shared shape with svelte.ts; duplicated to keep adapters
// independent — avoids cross-adapter coupling for ~50 lines).
// ────────────────────────────────────────────────────────────────────────

function findHtmlPages(bundleDir: string): string[] {
  const out: string[] = [];
  walk(bundleDir, (file) => {
    if (file.endsWith('.html')) out.push(file);
  });
  return out;
}

function walk(dir: string, onFile: (path: string) => void): void {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, onFile);
    else onFile(full);
  }
}

function splitHtml(html: string): {
  body: string;
  styles: string;
  linkedCss: string[];
  externalScripts: string[];
} {
  const styleMatches = Array.from(html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi));
  const styles = styleMatches.map((m) => m[1] ?? '').join('\n');
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  const body = bodyMatch?.[1] ?? html;

  const linkedCss: string[] = [];
  for (const m of html.matchAll(
    /<link[^>]*rel=["']stylesheet["'][^>]*href=["']([^"']+)["'][^>]*>/gi,
  )) {
    const href = m[1];
    if (href && !/^https?:\/\//i.test(href)) linkedCss.push(href);
  }

  const externalScripts: string[] = [];
  for (const m of html.matchAll(/<script[^>]*src=["']([^"']+)["'][^>]*>/gi)) {
    const src = m[1];
    if (src && !/^https?:\/\//i.test(src)) externalScripts.push(src);
  }

  return {
    body: body.trim(),
    styles: styles.trim(),
    linkedCss,
    externalScripts,
  };
}

function isEffectivelyEmpty(body: string): boolean {
  const stripped = body
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<div[^>]*id=["']root["'][^>]*>\s*<\/div>/gi, '')
    .replace(/\s+/g, '')
    .trim();
  return stripped.length === 0;
}

function listSiblingAssets(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    if (entry.name.endsWith('.html')) continue;
    out.push(join(dir, entry.name));
  }
  return out;
}

function toComponentName(slug: string): string {
  return (
    slug
      .split(/[^a-z0-9]+/i)
      .filter(Boolean)
      .map((part) => part[0]!.toUpperCase() + part.slice(1))
      .join('') || 'Page'
  );
}

function renderTsxScaffold(
  name: string,
  body: string,
  ctx: ApplyContext,
  meta: {
    bodyIsEmpty: boolean;
    sourceFiles: string[];
    externalScripts: string[];
    hasStyles: boolean;
  },
): string {
  const approvedSection = ctx.approvedItems.length
    ? `\n  Approved items from review-checklist.md:\n${ctx.approvedItems.map((it) => `    - ${it}`).join('\n')}\n`
    : '';
  const rejectedSection = ctx.rejectedItems.length
    ? `\n  Rejected:\n${ctx.rejectedItems.map((it) => `    - ${it}`).join('\n')}\n`
    : '';

  const sourcesNote = meta.bodyIsEmpty
    ? `
  ⚠ The bundle's <body> was just a React mount point — the real UI lives
  in the JSX/JS source files copied to ./sources/${name}/. To finish:

    1. Open Cursor chat in this scaffold.
    2. Ask: "Translate sources/${name}/*.jsx into a Next.js Client
       Component (TSX, hooks, idiomatic), using the data shape from the
       live route's loader/data fetcher."
    3. Move the styles in ${name}.module.css into the live route's
       existing CSS Modules / Tailwind / global stylesheet, whichever
       convention the route uses.

  Reference files copied:
${meta.sourceFiles.map((f) => `    - ${f}`).join('\n')}
`
    : '';

  // We translate the body 1:1 into JSX. This is *naive* — real translation
  // (class -> className, self-closing tags, inline event handlers, etc.)
  // happens when Cursor merges the scaffold into the live route. Callers
  // who want a faithful conversion can run a JSX codemod on the output.
  const placeholderMarkup = meta.bodyIsEmpty
    ? `<div className="exploration-v2">
        {/* TODO: translate from sources/${name}/*.jsx
            Likely entry point: ${meta.externalScripts.find((s) => /app\.jsx?$/i.test(s)) ?? 'app.jsx'} */}
      </div>`
    : `<div\n        className=""\n        dangerouslySetInnerHTML={{\n          __html: \`${escapeBackticks(body)}\`,\n        }}\n      />`;

  const styleImport = meta.hasStyles
    ? `import styles from './${name}.module.css';\n\n`
    : '';

  return `/*
  Auto-generated scaffold from design-loop apply (${name})
  Loop: ${ctx.loopId}${approvedSection}${rejectedSection}${sourcesNote}
  This is NOT finished code. Merge into the live route by hand or with a
  follow-up agent prompt (see CURSOR_PROMPT.md alongside this file).
*/

'use client';

${styleImport}export default function ${name}() {
  return (
    <>
      ${placeholderMarkup}
    </>
  );
}
`;
}

function escapeBackticks(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
}
