// src/adapters/svelte.ts
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync
} from "fs";
import { basename, dirname, join, relative, resolve } from "path";
var svelteAdapter = {
  name: "svelte",
  async discoverRoutes(opts) {
    const root = resolve(opts.routesDir);
    if (!existsSync(root)) return [];
    const exclude = new Set((opts.exclude ?? []).map(normalizeRoute));
    const found = [];
    function visit(dir) {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name.startsWith("_")) continue;
          visit(full);
          continue;
        }
        if (entry.name !== "+page.svelte") continue;
        const rel = relative(root, dirname(full));
        const path = svelteRouteFromRel(rel);
        if (exclude.has(path)) continue;
        found.push({
          path,
          filePath: full,
          dynamic: /\[[^\]]+\]/.test(path)
        });
      }
    }
    visit(root);
    found.sort((a, b) => a.path.localeCompare(b.path));
    return found;
  },
  async apply(ctx) {
    const translatedDir = join(ctx.outputDir, "translated");
    mkdirSync(translatedDir, { recursive: true });
    const htmlPages = findHtmlPages(ctx.bundleDir);
    if (!htmlPages.length) {
      return {
        translatedFiles: [],
        candidateTargets: [],
        notes: [
          "No standalone HTML pages found in bundle. Claude Design may have produced only chat output without committing a design to the canvas. Open the project URL and confirm the canvas has artifacts before retrying."
        ]
      };
    }
    const translatedFiles = [];
    const adapterNotes = [];
    for (const htmlPath of htmlPages) {
      const html = readFileSync(htmlPath, "utf8");
      const htmlDir = dirname(htmlPath);
      const { body, styles, linkedCss, externalScripts } = splitHtml(html);
      const inlinedCssBlocks = [];
      for (const cssHref of linkedCss) {
        const cssPath = join(htmlDir, cssHref);
        if (existsSync(cssPath) && statSync(cssPath).isFile()) {
          inlinedCssBlocks.push(
            `/* From bundle/${cssHref} */
${readFileSync(cssPath, "utf8")}`
          );
        }
      }
      const allStyles = [styles, ...inlinedCssBlocks].filter(Boolean).join("\n\n");
      const bodyIsEmpty = isEffectivelyEmpty(body);
      const sourceFiles = [];
      if (bodyIsEmpty) {
        const componentName2 = toComponentName(basename(htmlPath, ".html"));
        const sourcesDir = join(translatedDir, "sources", componentName2);
        mkdirSync(sourcesDir, { recursive: true });
        for (const sib of listSiblingAssets(htmlDir)) {
          copyFileSync(sib, join(sourcesDir, basename(sib)));
          sourceFiles.push(`sources/${componentName2}/${basename(sib)}`);
        }
        if (sourceFiles.length) {
          adapterNotes.push(
            `${componentName2}: <body> was empty (React mount point). Copied ${sourceFiles.length} reference files to ${relative(ctx.outputDir, sourcesDir)}/.`
          );
        }
      }
      const componentName = toComponentName(basename(htmlPath, ".html"));
      const svelteSource = renderSvelteScaffold(
        componentName,
        body,
        allStyles,
        ctx,
        { bodyIsEmpty, sourceFiles, externalScripts }
      );
      const outPath = join(translatedDir, `${componentName}.svelte`);
      writeFileSync(outPath, svelteSource, "utf8");
      translatedFiles.push(outPath);
    }
    return {
      translatedFiles,
      candidateTargets: [],
      notes: [
        "Translated files are scaffolds, not finished components. Open Cursor chat and ask it to merge the scaffold into the live route, using the copied source files as the source of truth.",
        ...adapterNotes
      ]
    };
  }
};
function findHtmlPages(bundleDir) {
  const out = [];
  walk(bundleDir, (file) => {
    if (file.endsWith(".html")) out.push(file);
  });
  return out;
}
function walk(dir, onFile) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, onFile);
    else onFile(full);
  }
}
function splitHtml(html) {
  const styleMatches = Array.from(html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi));
  const styles = styleMatches.map((m) => m[1] ?? "").join("\n");
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  const body = bodyMatch?.[1] ?? html;
  const linkedCss = [];
  for (const m of html.matchAll(
    /<link[^>]*rel=["']stylesheet["'][^>]*href=["']([^"']+)["'][^>]*>/gi
  )) {
    const href = m[1];
    if (href && !/^https?:\/\//i.test(href)) linkedCss.push(href);
  }
  const externalScripts = [];
  for (const m of html.matchAll(/<script[^>]*src=["']([^"']+)["'][^>]*>/gi)) {
    const src = m[1];
    if (src && !/^https?:\/\//i.test(src)) externalScripts.push(src);
  }
  return {
    body: body.trim(),
    styles: styles.trim(),
    linkedCss,
    externalScripts
  };
}
function isEffectivelyEmpty(body) {
  const stripped = body.replace(/<!--[\s\S]*?-->/g, "").replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<div[^>]*id=["']root["'][^>]*>\s*<\/div>/gi, "").replace(/\s+/g, "").trim();
  return stripped.length === 0;
}
function svelteRouteFromRel(rel) {
  if (!rel || rel === ".") return "/";
  const parts = rel.split(/[\\/]/).filter((p) => !(p.startsWith("(") && p.endsWith(")")));
  return parts.length === 0 ? "/" : `/${parts.join("/")}`;
}
function normalizeRoute(p) {
  if (!p) return "/";
  if (p === "/") return "/";
  return p.startsWith("/") ? p : `/${p}`;
}
function listSiblingAssets(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    if (entry.name.endsWith(".html")) continue;
    out.push(join(dir, entry.name));
  }
  return out;
}
function toComponentName(slug) {
  return slug.split(/[^a-z0-9]+/i).filter(Boolean).map((part) => part[0].toUpperCase() + part.slice(1)).join("") || "Page";
}
function renderSvelteScaffold(name, body, styles, ctx, meta) {
  const approvedSection = ctx.approvedItems.length ? `
  Approved items from review-checklist.md:
${ctx.approvedItems.map((it) => `    - ${it}`).join("\n")}
` : "";
  const rejectedSection = ctx.rejectedItems.length ? `
  Rejected:
${ctx.rejectedItems.map((it) => `    - ${it}`).join("\n")}
` : "";
  const sourcesNote = meta.bodyIsEmpty ? `
  \u26A0 The bundle's <body> was just a React mount point \u2014 the real UI lives
  in the JSX/JS source files copied to ./sources/${name}/. To finish:

    1. Open Cursor chat in this scaffold.
    2. Ask: "Translate sources/${name}/*.jsx into Svelte 5 runes-based
       markup inside the <div class="exploration-v2"> below, using the
       data shape from the live route."
    3. The CSS in <style> below is the bundle's design system \u2014 keep it
       as-is or extract to a shared stylesheet.

  Reference files copied:
${meta.sourceFiles.map((f) => `    - ${f}`).join("\n")}
` : "";
  const placeholderMarkup = meta.bodyIsEmpty ? `<div class="exploration-v2">
  <!-- TODO: translate from sources/${name}/*.jsx
       Likely entry point: ${meta.externalScripts.find((s) => /app\.jsx?$/i.test(s)) ?? "app.jsx"} -->
</div>` : body;
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

${styles ? `<style>
${styles}
</style>
` : ""}`;
}

// src/adapters/html.ts
import { copyFileSync as copyFileSync2, existsSync as existsSync2, mkdirSync as mkdirSync2, readdirSync as readdirSync2 } from "fs";
import { basename as basename2, join as join2 } from "path";
var htmlAdapter = {
  name: "html",
  async discoverRoutes(opts) {
    const found = [];
    walk2(opts.routesDir, (file) => {
      if (!file.endsWith(".html")) return;
      const rel = file.slice(opts.routesDir.length).replace(/^\/+/, "");
      const path = "/" + rel.replace(/(^|\/)index\.html$/, "").replace(/\.html$/, "");
      const normalized = path === "/" ? "/" : path.replace(/\/$/, "");
      if (opts.exclude?.includes(normalized)) return;
      found.push({ path: normalized, filePath: file, dynamic: false });
    });
    found.sort((a, b) => a.path.localeCompare(b.path));
    return found;
  },
  async apply(ctx) {
    const translatedDir = join2(ctx.outputDir, "translated");
    mkdirSync2(translatedDir, { recursive: true });
    const translatedFiles = [];
    walk2(ctx.bundleDir, (file) => {
      if (!file.endsWith(".html")) return;
      const dest = join2(translatedDir, basename2(file));
      copyFileSync2(file, dest);
      translatedFiles.push(dest);
    });
    return {
      translatedFiles,
      candidateTargets: [],
      notes: ["HTML pass-through \u2014 files copied as-is, no translation performed."]
    };
  }
};
function walk2(dir, onFile) {
  if (!existsSync2(dir)) return;
  for (const entry of readdirSync2(dir, { withFileTypes: true })) {
    const full = join2(dir, entry.name);
    if (entry.isDirectory()) walk2(full, onFile);
    else onFile(full);
  }
}

// src/adapters/nextjs.ts
import {
  copyFileSync as copyFileSync3,
  existsSync as existsSync3,
  mkdirSync as mkdirSync3,
  readFileSync as readFileSync2,
  readdirSync as readdirSync3,
  statSync as statSync2,
  writeFileSync as writeFileSync2
} from "fs";
import { basename as basename3, dirname as dirname2, join as join3, relative as relative2, resolve as resolve2 } from "path";
var APP_ROUTER_PAGE = /^page\.(tsx|jsx|ts|js)$/;
var PAGES_ROUTER_FILE = /\.(tsx|jsx|ts|js)$/;
var PAGES_ROUTER_RESERVED = /* @__PURE__ */ new Set([
  "_app",
  "_document",
  "_error",
  "404",
  "500",
  "middleware"
]);
var nextjsAdapter = {
  name: "nextjs",
  async discoverRoutes(opts) {
    const root = resolve2(opts.routesDir);
    if (!existsSync3(root)) return [];
    const exclude = new Set((opts.exclude ?? []).map(normalizeRoute2));
    const hasAppRouterSignal = anyMatch(
      root,
      (name) => APP_ROUTER_PAGE.test(name)
    );
    const found = [];
    if (hasAppRouterSignal) {
      walkAppRouter(root, root, found);
    } else {
      walkPagesRouter(root, root, found);
    }
    const filtered = found.filter((r) => !exclude.has(r.path));
    filtered.sort((a, b) => a.path.localeCompare(b.path));
    return filtered;
  },
  async apply(ctx) {
    const translatedDir = join3(ctx.outputDir, "translated");
    mkdirSync3(translatedDir, { recursive: true });
    const htmlPages = findHtmlPages2(ctx.bundleDir);
    if (!htmlPages.length) {
      return {
        translatedFiles: [],
        candidateTargets: [],
        notes: [
          "No standalone HTML pages found in bundle. Claude Design may have produced only chat output without committing a design to the canvas. Open the project URL and confirm the canvas has artifacts before retrying."
        ]
      };
    }
    const translatedFiles = [];
    const adapterNotes = [];
    for (const htmlPath of htmlPages) {
      const html = readFileSync2(htmlPath, "utf8");
      const htmlDir = dirname2(htmlPath);
      const { body, styles, linkedCss, externalScripts } = splitHtml2(html);
      const inlinedCssBlocks = [];
      for (const cssHref of linkedCss) {
        const cssPath = join3(htmlDir, cssHref);
        if (existsSync3(cssPath) && statSync2(cssPath).isFile()) {
          inlinedCssBlocks.push(
            `/* From bundle/${cssHref} */
${readFileSync2(cssPath, "utf8")}`
          );
        }
      }
      const allStyles = [styles, ...inlinedCssBlocks].filter(Boolean).join("\n\n");
      const componentName = toComponentName2(basename3(htmlPath, ".html"));
      const bodyIsEmpty = isEffectivelyEmpty2(body);
      const sourceFiles = [];
      if (bodyIsEmpty) {
        const sourcesDir = join3(translatedDir, "sources", componentName);
        mkdirSync3(sourcesDir, { recursive: true });
        for (const sib of listSiblingAssets2(htmlDir)) {
          copyFileSync3(sib, join3(sourcesDir, basename3(sib)));
          sourceFiles.push(`sources/${componentName}/${basename3(sib)}`);
        }
        if (sourceFiles.length) {
          adapterNotes.push(
            `${componentName}: <body> was empty (React mount point). Copied ${sourceFiles.length} reference files to ${relative2(ctx.outputDir, sourcesDir)}/.`
          );
        }
      }
      const cssModulePath = join3(translatedDir, `${componentName}.module.css`);
      if (allStyles) {
        writeFileSync2(cssModulePath, allStyles + "\n", "utf8");
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
          hasStyles: Boolean(allStyles)
        }
      );
      const outPath = join3(translatedDir, `${componentName}.tsx`);
      writeFileSync2(outPath, tsxSource, "utf8");
      translatedFiles.push(outPath);
    }
    return {
      translatedFiles,
      candidateTargets: [],
      notes: [
        "Translated files are scaffolds, not finished components. Open Cursor chat and ask it to merge the scaffold into the live route, using the copied source files as the source of truth.",
        ...adapterNotes
      ]
    };
  }
};
function anyMatch(dir, predicate) {
  if (!existsSync3(dir)) return false;
  for (const entry of readdirSync3(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (entry.name.startsWith("_") || entry.name.startsWith(".")) continue;
      if (anyMatch(join3(dir, entry.name), predicate)) return true;
    } else if (predicate(entry.name)) {
      return true;
    }
  }
  return false;
}
function walkAppRouter(root, dir, acc) {
  for (const entry of readdirSync3(dir, { withFileTypes: true })) {
    const full = join3(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name.startsWith("_")) continue;
      if (entry.name.startsWith("(.)") || entry.name.startsWith("(..)") || entry.name.startsWith("(...)")) {
        continue;
      }
      walkAppRouter(root, full, acc);
      continue;
    }
    if (!APP_ROUTER_PAGE.test(entry.name)) continue;
    const rel = relative2(root, dir);
    const path = appRouterRouteFromRel(rel);
    acc.push({
      path,
      filePath: full,
      dynamic: /\[[^\]]+\]/.test(path)
    });
  }
}
function walkPagesRouter(root, dir, acc) {
  for (const entry of readdirSync3(dir, { withFileTypes: true })) {
    const full = join3(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name.startsWith("_")) continue;
      if (entry.name.startsWith(".")) continue;
      if (relative2(root, full) === "api") continue;
      walkPagesRouter(root, full, acc);
      continue;
    }
    if (!PAGES_ROUTER_FILE.test(entry.name)) continue;
    const stem = entry.name.replace(PAGES_ROUTER_FILE, "");
    if (PAGES_ROUTER_RESERVED.has(stem)) continue;
    const relDir = relative2(root, dir);
    const path = pagesRouterRouteFromRel(relDir, stem);
    acc.push({
      path,
      filePath: full,
      dynamic: /\[[^\]]+\]/.test(path)
    });
  }
}
function appRouterRouteFromRel(rel) {
  if (!rel || rel === ".") return "/";
  const parts = rel.split(/[\\/]/).filter(
    (p) => !(p.startsWith("(") && p.endsWith(")")) && // route groups
    !p.startsWith("@")
    // parallel route slots
  );
  return parts.length === 0 ? "/" : `/${parts.join("/")}`;
}
function pagesRouterRouteFromRel(relDir, stem) {
  const dirParts = relDir && relDir !== "." ? relDir.split(/[\\/]/) : [];
  const fileSegment = stem === "index" ? "" : stem;
  const segments = [...dirParts, fileSegment].filter(Boolean);
  return segments.length === 0 ? "/" : `/${segments.join("/")}`;
}
function normalizeRoute2(p) {
  if (!p) return "/";
  if (p === "/") return "/";
  return p.startsWith("/") ? p : `/${p}`;
}
function findHtmlPages2(bundleDir) {
  const out = [];
  walk3(bundleDir, (file) => {
    if (file.endsWith(".html")) out.push(file);
  });
  return out;
}
function walk3(dir, onFile) {
  if (!existsSync3(dir)) return;
  for (const entry of readdirSync3(dir, { withFileTypes: true })) {
    const full = join3(dir, entry.name);
    if (entry.isDirectory()) walk3(full, onFile);
    else onFile(full);
  }
}
function splitHtml2(html) {
  const styleMatches = Array.from(html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi));
  const styles = styleMatches.map((m) => m[1] ?? "").join("\n");
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  const body = bodyMatch?.[1] ?? html;
  const linkedCss = [];
  for (const m of html.matchAll(
    /<link[^>]*rel=["']stylesheet["'][^>]*href=["']([^"']+)["'][^>]*>/gi
  )) {
    const href = m[1];
    if (href && !/^https?:\/\//i.test(href)) linkedCss.push(href);
  }
  const externalScripts = [];
  for (const m of html.matchAll(/<script[^>]*src=["']([^"']+)["'][^>]*>/gi)) {
    const src = m[1];
    if (src && !/^https?:\/\//i.test(src)) externalScripts.push(src);
  }
  return {
    body: body.trim(),
    styles: styles.trim(),
    linkedCss,
    externalScripts
  };
}
function isEffectivelyEmpty2(body) {
  const stripped = body.replace(/<!--[\s\S]*?-->/g, "").replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<div[^>]*id=["']root["'][^>]*>\s*<\/div>/gi, "").replace(/\s+/g, "").trim();
  return stripped.length === 0;
}
function listSiblingAssets2(dir) {
  if (!existsSync3(dir)) return [];
  const out = [];
  for (const entry of readdirSync3(dir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    if (entry.name.endsWith(".html")) continue;
    out.push(join3(dir, entry.name));
  }
  return out;
}
function toComponentName2(slug) {
  return slug.split(/[^a-z0-9]+/i).filter(Boolean).map((part) => part[0].toUpperCase() + part.slice(1)).join("") || "Page";
}
function renderTsxScaffold(name, body, ctx, meta) {
  const approvedSection = ctx.approvedItems.length ? `
  Approved items from review-checklist.md:
${ctx.approvedItems.map((it) => `    - ${it}`).join("\n")}
` : "";
  const rejectedSection = ctx.rejectedItems.length ? `
  Rejected:
${ctx.rejectedItems.map((it) => `    - ${it}`).join("\n")}
` : "";
  const sourcesNote = meta.bodyIsEmpty ? `
  \u26A0 The bundle's <body> was just a React mount point \u2014 the real UI lives
  in the JSX/JS source files copied to ./sources/${name}/. To finish:

    1. Open Cursor chat in this scaffold.
    2. Ask: "Translate sources/${name}/*.jsx into a Next.js Client
       Component (TSX, hooks, idiomatic), using the data shape from the
       live route's loader/data fetcher."
    3. Move the styles in ${name}.module.css into the live route's
       existing CSS Modules / Tailwind / global stylesheet, whichever
       convention the route uses.

  Reference files copied:
${meta.sourceFiles.map((f) => `    - ${f}`).join("\n")}
` : "";
  const placeholderMarkup = meta.bodyIsEmpty ? `<div className="exploration-v2">
        {/* TODO: translate from sources/${name}/*.jsx
            Likely entry point: ${meta.externalScripts.find((s) => /app\.jsx?$/i.test(s)) ?? "app.jsx"} */}
      </div>` : `<div
        className=""
        dangerouslySetInnerHTML={{
          __html: \`${escapeBackticks(body)}\`,
        }}
      />`;
  const styleImport = meta.hasStyles ? `import styles from './${name}.module.css';

` : "";
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
function escapeBackticks(s) {
  return s.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");
}

// src/adapters/index.ts
var stub = (name) => ({
  name,
  async apply() {
    throw new Error(
      `Adapter \`${name}\` is not implemented yet. Add src/adapters/${name}.ts and register it in adapters/index.ts.`
    );
  },
  async discoverRoutes() {
    throw new Error(
      `Route discovery is not implemented for the \`${name}\` adapter yet.`
    );
  }
});
var REGISTRY = {
  svelte: svelteAdapter,
  html: htmlAdapter,
  // `react` is the Next.js adapter — Next.js is the dominant React framework
  // we target. If we ever need a non-Next.js React adapter, add it as a new
  // framework key (e.g. `react-vite`) rather than splitting `react`.
  react: nextjsAdapter,
  vue: stub("vue")
};
function getAdapter(framework) {
  return REGISTRY[framework];
}
export {
  getAdapter
};
//# sourceMappingURL=index.js.map