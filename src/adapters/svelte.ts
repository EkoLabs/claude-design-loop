/**
 * Svelte adapter.
 *
 * Strategy: take the standalone `*.html` from the handoff bundle and scaffold
 * equivalent `.svelte` components in `output/translated/`. The bundle's
 * sibling assets (CSS, JSX, JS data files) are *also* surfaced — inlined for
 * CSS, copied alongside for JSX/JS — because Claude Design's bundles often
 * have an empty <body> with React-rendered content living entirely in JSX
 * files. The scaffold + sources/ together give Cursor everything it needs
 * to merge a real component without re-parsing the bundle.
 *
 * The output is intentionally a *scaffold*, not finished code. A Cursor-style
 * agent then takes the scaffold + the live route + the approved checklist
 * items and merges them into the real codebase.
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

export const svelteAdapter: Adapter = {
  name: 'svelte',
  async discoverRoutes(opts: DiscoverOptions): Promise<DiscoveredRoute[]> {
    const root = resolve(opts.routesDir);
    if (!existsSync(root)) return [];
    const exclude = new Set((opts.exclude ?? []).map(normalizeRoute));
    const found: DiscoveredRoute[] = [];

    function visit(dir: string): void {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          // Skip SvelteKit grouping/private folders we don't want to expose:
          //   (group)/  → grouping (parens)
          //   _whatever → private
          if (entry.name.startsWith('_')) continue;
          visit(full);
          continue;
        }
        if (entry.name !== '+page.svelte') continue;
        const rel = relative(root, dirname(full));
        const path = svelteRouteFromRel(rel);
        if (exclude.has(path)) continue;
        found.push({
          path,
          filePath: full,
          dynamic: /\[[^\]]+\]/.test(path),
        });
      }
    }
    visit(root);
    found.sort((a, b) => a.path.localeCompare(b.path));
    return found;
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

      // Inline any <link rel="stylesheet"> we can resolve in the bundle.
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

      // Surface bundle scripts (jsx/js/css/data) alongside the scaffold so
      // Cursor can read them as the source of truth for the actual UI when
      // <body> is just a React mount point.
      const bodyIsEmpty = isEffectivelyEmpty(body);
      const sourceFiles: string[] = [];
      if (bodyIsEmpty) {
        const componentName = toComponentName(basename(htmlPath, '.html'));
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

      const componentName = toComponentName(basename(htmlPath, '.html'));
      const svelteSource = renderSvelteScaffold(
        componentName,
        body,
        allStyles,
        ctx,
        { bodyIsEmpty, sourceFiles, externalScripts },
      );
      const outPath = join(translatedDir, `${componentName}.svelte`);
      writeFileSync(outPath, svelteSource, 'utf8');
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

  // <link rel="stylesheet" href="..."> — only relative refs (skip CDNs).
  const linkedCss: string[] = [];
  for (const m of html.matchAll(
    /<link[^>]*rel=["']stylesheet["'][^>]*href=["']([^"']+)["'][^>]*>/gi,
  )) {
    const href = m[1];
    if (href && !/^https?:\/\//i.test(href)) linkedCss.push(href);
  }

  // <script src="..."> — relative refs only, in order.
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
  // Strip comments, scripts, and the React mount root, then see if anything
  // semantic is left. If <body> is just `<div id="root"></div>` the actual
  // UI lives in JSX and we can't translate it directly.
  const stripped = body
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<div[^>]*id=["']root["'][^>]*>\s*<\/div>/gi, '')
    .replace(/\s+/g, '')
    .trim();
  return stripped.length === 0;
}

function svelteRouteFromRel(rel: string): string {
  if (!rel || rel === '.') return '/';
  // Strip SvelteKit grouping segments: `(marketing)/about` → `/about`
  const parts = rel
    .split(/[\\/]/)
    .filter((p) => !(p.startsWith('(') && p.endsWith(')')));
  return parts.length === 0 ? '/' : `/${parts.join('/')}`;
}

function normalizeRoute(p: string): string {
  if (!p) return '/';
  if (p === '/') return '/';
  return p.startsWith('/') ? p : `/${p}`;
}

function listSiblingAssets(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    if (entry.name.endsWith('.html')) continue; // scaffold already covers HTML
    out.push(join(dir, entry.name));
  }
  return out;
}

function toComponentName(slug: string): string {
  return slug
    .split(/[^a-z0-9]+/i)
    .filter(Boolean)
    .map((part) => part[0]!.toUpperCase() + part.slice(1))
    .join('') || 'Page';
}

function renderSvelteScaffold(
  name: string,
  body: string,
  styles: string,
  ctx: ApplyContext,
  meta: {
    bodyIsEmpty: boolean;
    sourceFiles: string[];
    externalScripts: string[];
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
    2. Ask: "Translate sources/${name}/*.jsx into Svelte 5 runes-based
       markup inside the <div class="exploration-v2"> below, using the
       data shape from the live route."
    3. The CSS in <style> below is the bundle's design system — keep it
       as-is or extract to a shared stylesheet.

  Reference files copied:
${meta.sourceFiles.map((f) => `    - ${f}`).join('\n')}
`
    : '';

  const placeholderMarkup = meta.bodyIsEmpty
    ? `<div class="exploration-v2">
  <!-- TODO: translate from sources/${name}/*.jsx
       Likely entry point: ${meta.externalScripts.find((s) => /app\.jsx?$/i.test(s)) ?? 'app.jsx'} -->
</div>`
    : body;

  return `<!--
  Auto-generated scaffold from design-loop apply (${name})
  Loop: ${ctx.loopId}${approvedSection}${rejectedSection}${sourcesNote}
  This is NOT finished code. Merge into the live route by hand or with a
  follow-up agent prompt.
-->

<script lang="ts">
  // TODO: wire data props / stores from the live route's loader.
</script>

${placeholderMarkup}

${styles ? `<style>\n${styles}\n</style>\n` : ''}`;
}
