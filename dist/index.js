// src/config.ts
import { existsSync } from "fs";
import { dirname, resolve } from "path";
import { pathToFileURL } from "url";
function defineConfig(config) {
  return config;
}
function getDesignSystems(config) {
  const ds = config.designSystem;
  return Array.isArray(ds) ? ds : [ds];
}
function getDefaultDesignSystem(config) {
  return getDesignSystems(config)[0];
}
var DEFAULTS = {
  loopsDir: "design-loops",
  breakpoints: [1280, 768, 375],
  settleMs: 3e3,
  excludeRoutes: [],
  contextSources: []
};
function withDefaults(config) {
  return {
    ...DEFAULTS,
    ...config,
    excludeRoutes: config.excludeRoutes ?? [...DEFAULTS.excludeRoutes],
    contextSources: config.contextSources ?? [...DEFAULTS.contextSources],
    breakpoints: config.breakpoints ?? [...DEFAULTS.breakpoints]
  };
}
var CONFIG_FILENAMES = [
  ".design-loop.config.ts",
  ".design-loop.config.mts",
  ".design-loop.config.mjs",
  ".design-loop.config.js",
  "design-loop.config.ts",
  "design-loop.config.mts",
  "design-loop.config.mjs",
  "design-loop.config.js"
];
async function loadConfig(startDir = process.cwd()) {
  let dir = resolve(startDir);
  while (true) {
    for (const name of CONFIG_FILENAMES) {
      const candidate = resolve(dir, name);
      if (existsSync(candidate)) {
        const mod = await import(pathToFileURL(candidate).href);
        const config = mod.default ?? mod.config;
        if (!config) {
          throw new Error(
            `${candidate} does not export a default config. Use \`export default defineConfig({...})\`.`
          );
        }
        return { config, rootDir: dir, configPath: candidate };
      }
    }
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error(
        `No design-loop config found in ${startDir} or any parent. Create a \`.design-loop.config.ts\` at your repo root.`
      );
    }
    dir = parent;
  }
}

// src/lib/brief.ts
import { writeFileSync as writeFileSync4 } from "fs";
import { resolve as resolve4 } from "path";

// src/lib/browser.ts
import { writeFileSync } from "fs";
import { join } from "path";
import { chromium } from "playwright";
async function captureRoute(opts) {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({
      storageState: opts.storageState,
      deviceScaleFactor: 1
    });
    return await captureWithContext(context, opts);
  } finally {
    await browser.close();
  }
}
async function captureWithContext(context, opts) {
  const screenshots = [];
  let pageTitle = "";
  let domSnapshot = "";
  let classFrequency = {};
  for (const width of opts.breakpoints) {
    const page = await context.newPage();
    await page.setViewportSize({ width, height: heightFor(width) });
    await page.goto(opts.url, { waitUntil: "networkidle", timeout: 3e4 });
    await applyWaitFor(page, opts.waitFor);
    await page.waitForTimeout(opts.settleMs);
    const screenshotPath = join(opts.outDir, `screenshot-${width}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true });
    screenshots.push({ width, path: screenshotPath });
    if (width === opts.breakpoints[0]) {
      pageTitle = await page.title();
      domSnapshot = await captureA11yTree(page);
      classFrequency = await captureClassFrequency(page);
    }
    await page.close();
  }
  const domSnapshotPath = join(opts.outDir, "dom.yaml");
  writeFileSync(domSnapshotPath, domSnapshot, "utf8");
  const classFrequencyPath = join(opts.outDir, "class-frequency.json");
  writeFileSync(
    classFrequencyPath,
    JSON.stringify(classFrequency, null, 2) + "\n",
    "utf8"
  );
  return {
    screenshots,
    domSnapshotPath,
    classFrequencyPath,
    pageTitle
  };
}
function heightFor(width) {
  if (width >= 1280) return 900;
  if (width >= 768) return 1024;
  return 812;
}
async function applyWaitFor(page, waitFor) {
  if (!waitFor) return;
  const timeout = waitFor.timeoutMs ?? 15e3;
  if (waitFor.visible) {
    await page.locator(waitFor.visible).first().waitFor({ state: "visible", timeout });
  }
  if (waitFor.hidden) {
    await page.locator(waitFor.hidden).first().waitFor({ state: "hidden", timeout });
  }
}
async function captureA11yTree(page) {
  try {
    return await page.locator("body").ariaSnapshot();
  } catch (err) {
    return `(ariaSnapshot failed: ${err instanceof Error ? err.message : String(err)})
`;
  }
}
async function captureClassFrequency(page) {
  return page.evaluate(() => {
    const freq = /* @__PURE__ */ new Map();
    const els = document.querySelectorAll("[class]");
    els.forEach((el) => {
      const classes = el.className;
      if (typeof classes !== "string") return;
      classes.split(/\s+/).forEach((cls) => {
        if (!cls) return;
        freq.set(cls, (freq.get(cls) ?? 0) + 1);
      });
    });
    const result = {};
    Array.from(freq.entries()).sort((a, b) => b[1] - a[1]).slice(0, 200).forEach(([cls, n]) => {
      result[cls] = n;
    });
    return result;
  });
}

// src/lib/loops.ts
import { mkdirSync as mkdirSync2, readFileSync as readFileSync2, writeFileSync as writeFileSync3 } from "fs";
import { dirname as dirname2, join as join2, resolve as resolve3 } from "path";

// src/lib/gitignore.ts
import { existsSync as existsSync2, readFileSync, writeFileSync as writeFileSync2, mkdirSync } from "fs";
import { resolve as resolve2 } from "path";
var SUB_GITIGNORE_CONTENT = "# Auto-managed by @ekolabs/claude-design-loop. All loop run output\n# is local working state and should never be committed. The only\n# thing checked in here is this .gitignore itself.\n*\n!.gitignore\n";
function ensureLoopsRootGitignore(loopsRoot) {
  mkdirSync(loopsRoot, { recursive: true });
  const path = resolve2(loopsRoot, ".gitignore");
  if (!existsSync2(path)) {
    writeFileSync2(path, SUB_GITIGNORE_CONTENT, "utf8");
    return { path, action: "created" };
  }
  const current = readFileSync(path, "utf8");
  if (current === SUB_GITIGNORE_CONTENT) {
    return { path, action: "unchanged" };
  }
  return { path, action: "preserved-custom" };
}

// src/lib/loops.ts
function slugifyRoute(route) {
  const trimmed = route.replace(/^\/+|\/+$/g, "");
  if (!trimmed) return "root";
  return trimmed.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
}
function makeLoopId(route, when = /* @__PURE__ */ new Date()) {
  const iso = when.toISOString().replace(/[:.]/g, "-").replace("Z", "");
  return `${iso}-${slugifyRoute(route)}`;
}
function prettyProjectName(route, when = /* @__PURE__ */ new Date()) {
  const yyyy = when.getFullYear();
  const mm = String(when.getMonth() + 1).padStart(2, "0");
  const dd = String(when.getDate()).padStart(2, "0");
  const hh = String(when.getHours()).padStart(2, "0");
  const mi = String(when.getMinutes()).padStart(2, "0");
  return `${route} \u2014 ${yyyy}-${mm}-${dd} ${hh}:${mi}`;
}
function loopPaths(loopsRoot, id) {
  const root = resolve3(loopsRoot, id);
  return {
    id,
    root,
    inputsDir: join2(root, "inputs"),
    bundleDir: join2(root, "bundle"),
    outputDir: join2(root, "output"),
    briefPath: join2(root, "brief.md"),
    manifestPath: join2(root, "manifest.json"),
    reviewChecklistPath: join2(root, "review-checklist.md"),
    verifyReportPath: join2(root, "verify-report.md")
  };
}
function ensureLoopDirs(paths) {
  ensureLoopsRootGitignore(dirname2(paths.root));
  mkdirSync2(paths.root, { recursive: true });
  mkdirSync2(paths.inputsDir, { recursive: true });
}
function writeManifest(paths, manifest) {
  writeFileSync3(paths.manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");
}
function readManifest(paths) {
  return JSON.parse(readFileSync2(paths.manifestPath, "utf8"));
}

// src/lib/templates.ts
function renderBrief(inputs) {
  const parts = [
    renderHeader(inputs),
    renderBody(inputs),
    renderTechConstraints(inputs),
    renderHandoffNote()
  ];
  return parts.join("\n\n");
}
function renderHeader(i) {
  return [
    `# Redesign brief \u2014 ${i.route}`,
    "",
    `**Page:** ${i.pageTitle || "(no title)"}`,
    `**Route:** \`${i.route}\` in our ${i.framework} app`,
    `**Design system:** ${i.designSystemName}`,
    `**Captured at:** ${i.breakpoints.join("px, ")}px`
  ].join("\n");
}
function renderBody(i) {
  const intentLine = i.intent ? `

**Specific intent for this round:** ${i.intent}` : "";
  return `
## What we're showing you

The attached screenshots are the **current state** of this screen at the
listed breakpoints. They are not a wireframe to redraw 1:1 \u2014 treat them as
the starting point. Understand what the screen is trying to do, then design
a better version.${intentLine}

## What we want

Look at the screenshots. Decide what's working, what isn't, and **redesign
this screen** in the canvas using the **${i.designSystemName}**. You're
free to:

- Suggest UX improvements, not just visual polish.
- Restructure the page if hierarchy or grouping is wrong.
- Drop or merge sections that don't earn their space.
- Add affordances (CTAs, filters, status, empty states) the current screen lacks.
- Disagree with the existing design where you think you know better \u2014 explain
  briefly in chat why, then design accordingly.

You're a design partner here, not a render farm. If you have a strong opinion
about the page's purpose or audience, factor it in.
`.trim();
}
function renderTechConstraints(i) {
  return `
## Tech constraints (so the design lands cleanly when we implement)

- **Framework:** ${i.framework}. Don't propose patterns from a different one.
- **Styling:** Tailwind 4 utility classes \u2014 no CSS-in-JS solutions.
- **Icons:** \`lucide-svelte\` (don't introduce a new icon set).
- **Components:** real **${i.designSystemName}** components and tokens.
- **Out of scope:** any route the team has marked as excluded (e.g. one-off
  motion / 3D experiences). Stick to the screen shown in the screenshots.
`.trim();
}
function renderHandoffNote() {
  return `
## After you're done

Leave the result in the canvas. We'll review and iterate with you in
claude.ai/design directly. When we're happy, we'll click **Share \u2192 Handoff
to Claude Code** to bring the design into our repo.
`.trim();
}

// src/lib/brief.ts
async function runBrief(args) {
  const config = withDefaults(args.config);
  if (config.excludeRoutes.includes(args.route)) {
    throw new Error(
      `Route \`${args.route}\` is excluded by config (\`excludeRoutes\`). Refusing to run.`
    );
  }
  const breakpoints = args.breakpoints ?? config.breakpoints;
  const id = makeLoopId(args.route);
  const paths = loopPaths(resolve4(args.rootDir, config.loopsDir), id);
  ensureLoopDirs(paths);
  const url = joinUrl(config.devUrl, args.route);
  console.log(`[brief] capturing ${url} at [${breakpoints.join(", ")}]px ...`);
  const capture = await captureRoute({
    url,
    outDir: paths.inputsDir,
    breakpoints,
    settleMs: config.settleMs,
    storageState: config.storageState,
    waitFor: config.waitFor
  });
  const designSystem = args.designSystem ?? getDefaultDesignSystem(args.config);
  const briefMarkdown = renderBrief({
    framework: config.framework,
    route: args.route,
    pageTitle: capture.pageTitle,
    designSystemName: designSystem.name,
    intent: args.intent,
    breakpoints
  });
  writeFileSync4(paths.briefPath, briefMarkdown, "utf8");
  const manifest = {
    id,
    createdAt: (/* @__PURE__ */ new Date()).toISOString(),
    route: args.route,
    framework: config.framework,
    devUrl: config.devUrl,
    designSystem,
    breakpoints
  };
  writeManifest(paths, manifest);
  console.log(`[brief] wrote ${paths.briefPath}`);
  console.log(`[brief] loop id: ${id}`);
  console.log(
    `[brief] inputs/ has ${capture.screenshots.length} screenshot(s). Edit brief.md if you want to add a one-line intent before submit.`
  );
  return {
    loopId: id,
    briefPath: paths.briefPath,
    inputsDir: paths.inputsDir,
    manifestPath: paths.manifestPath
  };
}
function joinUrl(base, route) {
  const b = base.replace(/\/+$/, "");
  const r = route.startsWith("/") ? route : `/${route}`;
  return `${b}${r}`;
}

// src/lib/pull.ts
import {
  existsSync as existsSync3,
  mkdirSync as mkdirSync3,
  openSync,
  readFileSync as readFileSync3,
  readSync,
  closeSync,
  readdirSync,
  unlinkSync,
  writeFileSync as writeFileSync5
} from "fs";
import { extname, join as join3, resolve as resolve5 } from "path";
async function runPull(args) {
  const loopsRoot = resolve5(args.rootDir, args.config.loopsDir ?? "design-loops");
  const paths = loopPaths(loopsRoot, args.loopId);
  if (!existsSync3(paths.root)) {
    throw new Error(
      `Loop ${args.loopId} not found at ${paths.root}. Did you run \`brief\` first?`
    );
  }
  mkdirSync3(paths.bundleDir, { recursive: true });
  console.log(`[pull] expanding bundle into ${paths.bundleDir} ...`);
  const sourceUrl = await materializeBundle(args.bundleSource, paths.bundleDir);
  const files = walkFiles(paths.bundleDir).map(
    (p) => p.slice(paths.bundleDir.length + 1)
  );
  const recDestPath = join3(paths.root, "RECOMMENDATIONS.md");
  const recPath = surfaceRecommendations(paths.bundleDir, recDestPath);
  const checklistPath = writeReviewChecklist(
    paths.reviewChecklistPath,
    recPath ? readFileSync3(recPath, "utf8") : null,
    args.loopId
  );
  const manifest = readManifest(paths);
  manifest.bundle = {
    sourceUrl,
    fetchedAt: (/* @__PURE__ */ new Date()).toISOString(),
    files
  };
  writeManifest(paths, manifest);
  if (recPath) {
    console.log(`[pull] surfaced ${recPath}`);
  }
  console.log(`[pull] expanded ${files.length} files into ${paths.bundleDir}`);
  console.log(`[pull] review checklist: ${checklistPath}`);
  return {
    bundleDir: paths.bundleDir,
    recommendationsPath: recPath,
    reviewChecklistPath: checklistPath,
    files
  };
}
async function materializeBundle(source, destDir) {
  if (/^https?:\/\//i.test(source)) {
    const tmp = join3(destDir, ".bundle.archive");
    await downloadToFile(source, tmp);
    await extractArchive(tmp, destDir);
    try {
      unlinkSync(tmp);
    } catch {
    }
    return source;
  }
  const abs = resolve5(source);
  if (!existsSync3(abs)) {
    throw new Error(`Bundle source ${source} does not exist.`);
  }
  await extractArchive(abs, destDir);
  return abs;
}
async function downloadToFile(url, dest) {
  const res = await fetch(url);
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      throw new Error(
        `Bundle URL returned ${res.status}. The handoff endpoint may require an authenticated browser session.
Workaround: download the bundle manually from claude.ai/design and rerun \`design-loop pull <loopId> --bundle-path=<file>\`.`
      );
    }
    throw new Error(`Bundle URL returned ${res.status}: ${res.statusText}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync5(dest, buf);
}
async function extractArchive(archivePath, destDir) {
  const fmt = detectArchiveFormat(archivePath);
  if (fmt === "tar.gz") return extractTarGz(archivePath, destDir);
  if (fmt === "zip") return extractZip(archivePath, destDir);
  throw new Error(
    `Unrecognized bundle archive at ${archivePath} (magic bytes don't match gzip or zip). Inspect the file and report \u2014 Claude Design's handoff format may have changed.`
  );
}
function detectArchiveFormat(path) {
  const fd = openSync(path, "r");
  try {
    const buf = Buffer.alloc(4);
    readSync(fd, buf, 0, 4, 0);
    if (buf[0] === 31 && buf[1] === 139) return "tar.gz";
    if (buf[0] === 80 && buf[1] === 75) return "zip";
    const ext = extname(path).toLowerCase();
    if (ext === ".zip") return "zip";
    if (ext === ".gz" || ext === ".tgz" || ext === ".tar") return "tar.gz";
    return "unknown";
  } finally {
    closeSync(fd);
  }
}
async function extractTarGz(archivePath, destDir) {
  const { spawnSync } = await import("child_process");
  const result = spawnSync("tar", ["-xzf", archivePath, "-C", destDir], {
    stdio: "inherit"
  });
  if (result.status !== 0) {
    throw new Error(
      `tar -xzf failed (exit ${result.status}). Is GNU/BSD tar on PATH?`
    );
  }
}
async function extractZip(zipPath, destDir) {
  const { spawnSync } = await import("child_process");
  const result = spawnSync("unzip", ["-o", zipPath, "-d", destDir], {
    stdio: "inherit"
  });
  if (result.status !== 0) {
    throw new Error(`unzip failed (exit ${result.status}). Is unzip on PATH?`);
  }
}
function surfaceRecommendations(bundleDir, destPath) {
  const found = findFile(bundleDir, /^recommendations\.md$/i);
  if (!found) return null;
  const content = readFileSync3(found, "utf8");
  writeFileSync5(destPath, content, "utf8");
  return destPath;
}
function findFile(dir, match) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join3(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = findFile(full, match);
      if (nested) return nested;
    } else if (match.test(entry.name)) {
      return full;
    }
  }
  return null;
}
function walkFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join3(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkFiles(full));
    } else {
      out.push(full);
    }
  }
  return out;
}
function writeReviewChecklist(destPath, recommendationsMd, loopId) {
  const items = recommendationsMd ? extractChecklistItems(recommendationsMd) : [];
  const body = [
    `# Review checklist \u2014 ${loopId}`,
    "",
    "Tick items you want to implement. Items left unchecked will be skipped",
    "by `design-loop apply`. Items marked with \u2717 will be explicitly excluded.",
    "",
    items.length ? items.map((it) => `- [ ] ${it}`).join("\n") : "- [ ] Review `RECOMMENDATIONS.md` and add items here manually.",
    "",
    "## Notes",
    "",
    "_(free-form notes for the agent \u2014 anything you want it to know)_",
    ""
  ].join("\n");
  writeFileSync5(destPath, body, "utf8");
  return destPath;
}
function extractChecklistItems(md) {
  const lines = md.split("\n");
  const items = [];
  let inRelevantSection = false;
  const relevant = /^##\s*(ux\s*issues|proposed\s*changes|approved\s*changes|implementation)/i;
  for (const line2 of lines) {
    if (/^##\s/.test(line2)) {
      inRelevantSection = relevant.test(line2);
      continue;
    }
    if (!inRelevantSection) continue;
    const numbered = line2.match(/^\s*\d+\.\s+(.*)/);
    if (numbered && numbered[1]) {
      items.push(numbered[1].trim().slice(0, 200));
    }
  }
  return items;
}

// src/lib/apply.ts
import { existsSync as existsSync8, mkdirSync as mkdirSync7, readFileSync as readFileSync6, writeFileSync as writeFileSync9 } from "fs";
import { resolve as resolve9 } from "path";

// src/adapters/svelte.ts
import {
  copyFileSync,
  existsSync as existsSync4,
  mkdirSync as mkdirSync4,
  readFileSync as readFileSync4,
  readdirSync as readdirSync2,
  statSync,
  writeFileSync as writeFileSync6
} from "fs";
import { basename, dirname as dirname3, join as join4, relative, resolve as resolve6 } from "path";
var svelteAdapter = {
  name: "svelte",
  async discoverRoutes(opts) {
    const root = resolve6(opts.routesDir);
    if (!existsSync4(root)) return [];
    const exclude = new Set((opts.exclude ?? []).map(normalizeRoute));
    const found = [];
    function visit(dir) {
      for (const entry of readdirSync2(dir, { withFileTypes: true })) {
        const full = join4(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name.startsWith("_")) continue;
          visit(full);
          continue;
        }
        if (entry.name !== "+page.svelte") continue;
        const rel = relative(root, dirname3(full));
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
    const translatedDir = join4(ctx.outputDir, "translated");
    mkdirSync4(translatedDir, { recursive: true });
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
      const html = readFileSync4(htmlPath, "utf8");
      const htmlDir = dirname3(htmlPath);
      const { body, styles, linkedCss, externalScripts } = splitHtml(html);
      const inlinedCssBlocks = [];
      for (const cssHref of linkedCss) {
        const cssPath = join4(htmlDir, cssHref);
        if (existsSync4(cssPath) && statSync(cssPath).isFile()) {
          inlinedCssBlocks.push(
            `/* From bundle/${cssHref} */
${readFileSync4(cssPath, "utf8")}`
          );
        }
      }
      const allStyles = [styles, ...inlinedCssBlocks].filter(Boolean).join("\n\n");
      const bodyIsEmpty = isEffectivelyEmpty(body);
      const sourceFiles = [];
      if (bodyIsEmpty) {
        const componentName2 = toComponentName(basename(htmlPath, ".html"));
        const sourcesDir = join4(translatedDir, "sources", componentName2);
        mkdirSync4(sourcesDir, { recursive: true });
        for (const sib of listSiblingAssets(htmlDir)) {
          copyFileSync(sib, join4(sourcesDir, basename(sib)));
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
      const outPath = join4(translatedDir, `${componentName}.svelte`);
      writeFileSync6(outPath, svelteSource, "utf8");
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
  if (!existsSync4(dir)) return;
  for (const entry of readdirSync2(dir, { withFileTypes: true })) {
    const full = join4(dir, entry.name);
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
  if (!existsSync4(dir)) return [];
  const out = [];
  for (const entry of readdirSync2(dir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    if (entry.name.endsWith(".html")) continue;
    out.push(join4(dir, entry.name));
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
import { copyFileSync as copyFileSync2, existsSync as existsSync5, mkdirSync as mkdirSync5, readdirSync as readdirSync3 } from "fs";
import { basename as basename2, join as join5 } from "path";
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
    const translatedDir = join5(ctx.outputDir, "translated");
    mkdirSync5(translatedDir, { recursive: true });
    const translatedFiles = [];
    walk2(ctx.bundleDir, (file) => {
      if (!file.endsWith(".html")) return;
      const dest = join5(translatedDir, basename2(file));
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
  if (!existsSync5(dir)) return;
  for (const entry of readdirSync3(dir, { withFileTypes: true })) {
    const full = join5(dir, entry.name);
    if (entry.isDirectory()) walk2(full, onFile);
    else onFile(full);
  }
}

// src/adapters/nextjs.ts
import {
  copyFileSync as copyFileSync3,
  existsSync as existsSync6,
  mkdirSync as mkdirSync6,
  readFileSync as readFileSync5,
  readdirSync as readdirSync4,
  statSync as statSync2,
  writeFileSync as writeFileSync7
} from "fs";
import { basename as basename3, dirname as dirname4, join as join6, relative as relative2, resolve as resolve7 } from "path";
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
    const root = resolve7(opts.routesDir);
    if (!existsSync6(root)) return [];
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
    const translatedDir = join6(ctx.outputDir, "translated");
    mkdirSync6(translatedDir, { recursive: true });
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
      const html = readFileSync5(htmlPath, "utf8");
      const htmlDir = dirname4(htmlPath);
      const { body, styles, linkedCss, externalScripts } = splitHtml2(html);
      const inlinedCssBlocks = [];
      for (const cssHref of linkedCss) {
        const cssPath = join6(htmlDir, cssHref);
        if (existsSync6(cssPath) && statSync2(cssPath).isFile()) {
          inlinedCssBlocks.push(
            `/* From bundle/${cssHref} */
${readFileSync5(cssPath, "utf8")}`
          );
        }
      }
      const allStyles = [styles, ...inlinedCssBlocks].filter(Boolean).join("\n\n");
      const componentName = toComponentName2(basename3(htmlPath, ".html"));
      const bodyIsEmpty = isEffectivelyEmpty2(body);
      const sourceFiles = [];
      if (bodyIsEmpty) {
        const sourcesDir = join6(translatedDir, "sources", componentName);
        mkdirSync6(sourcesDir, { recursive: true });
        for (const sib of listSiblingAssets2(htmlDir)) {
          copyFileSync3(sib, join6(sourcesDir, basename3(sib)));
          sourceFiles.push(`sources/${componentName}/${basename3(sib)}`);
        }
        if (sourceFiles.length) {
          adapterNotes.push(
            `${componentName}: <body> was empty (React mount point). Copied ${sourceFiles.length} reference files to ${relative2(ctx.outputDir, sourcesDir)}/.`
          );
        }
      }
      const cssModulePath = join6(translatedDir, `${componentName}.module.css`);
      if (allStyles) {
        writeFileSync7(cssModulePath, allStyles + "\n", "utf8");
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
      const outPath = join6(translatedDir, `${componentName}.tsx`);
      writeFileSync7(outPath, tsxSource, "utf8");
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
  if (!existsSync6(dir)) return false;
  for (const entry of readdirSync4(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (entry.name.startsWith("_") || entry.name.startsWith(".")) continue;
      if (anyMatch(join6(dir, entry.name), predicate)) return true;
    } else if (predicate(entry.name)) {
      return true;
    }
  }
  return false;
}
function walkAppRouter(root, dir, acc) {
  for (const entry of readdirSync4(dir, { withFileTypes: true })) {
    const full = join6(dir, entry.name);
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
  for (const entry of readdirSync4(dir, { withFileTypes: true })) {
    const full = join6(dir, entry.name);
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
  if (!existsSync6(dir)) return;
  for (const entry of readdirSync4(dir, { withFileTypes: true })) {
    const full = join6(dir, entry.name);
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
  if (!existsSync6(dir)) return [];
  const out = [];
  for (const entry of readdirSync4(dir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    if (entry.name.endsWith(".html")) continue;
    out.push(join6(dir, entry.name));
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

// src/lib/cursor-prompt.ts
import { spawn } from "child_process";
import { existsSync as existsSync7, readdirSync as readdirSync5, statSync as statSync3, writeFileSync as writeFileSync8 } from "fs";
import { basename as basename4, relative as relative3, resolve as resolve8 } from "path";

// src/lib/prompt.ts
import * as readline from "readline";

// src/lib/ui.ts
import pc from "picocolors";
var COLOR = process.stdout.isTTY === true;
var wrap = (fn) => (s) => COLOR ? fn(s) : s;
var colors = {
  bold: wrap(pc.bold),
  dim: wrap(pc.dim),
  green: wrap(pc.green),
  red: wrap(pc.red),
  yellow: wrap(pc.yellow),
  cyan: wrap(pc.cyan),
  magenta: wrap(pc.magenta),
  blue: wrap(pc.blue),
  gray: wrap(pc.gray)
};
var RULE_CHAR = "\u2500";
var TARGET_WIDTH = 64;
function banner(title, subtitle) {
  const line2 = colors.dim(RULE_CHAR.repeat(TARGET_WIDTH));
  console.log("");
  console.log(line2);
  console.log(`  ${colors.bold(title)}${subtitle ? "  " + colors.dim(subtitle) : ""}`);
  console.log(line2);
  console.log("");
}
function section(label) {
  const padded = ` ${label} `;
  const remaining = Math.max(2, TARGET_WIDTH - padded.length - 2);
  const left = RULE_CHAR.repeat(2);
  const right = RULE_CHAR.repeat(remaining);
  console.log("");
  console.log(colors.dim(left) + colors.bold(padded) + colors.dim(right));
}
function kv(key, value, keyWidth = 16) {
  const padded = `${key}:`.padEnd(keyWidth);
  console.log(`  ${colors.dim(padded)} ${value}`);
}
function kvBlock(entries) {
  const live = entries.filter((e) => Array.isArray(e));
  const width = Math.min(
    24,
    Math.max(8, ...live.map(([k]) => k.length + 1))
  );
  for (const [k, v] of live) kv(k, v, width);
}
function bullet(text) {
  console.log(`  ${colors.cyan("\u2726")} ${text}`);
}
function success(text) {
  console.log(`  ${colors.green("\u2713")} ${text}`);
}
function warn(text) {
  console.log(`  ${colors.yellow("\u26A0")} ${text}`);
}
function error(text) {
  console.log(`  ${colors.red("\u2717")} ${text}`);
}
function hint(text) {
  console.log(`  ${colors.dim(text)}`);
}
function line(text = "") {
  if (!text) console.log("");
  else console.log(`  ${text}`);
}
var symbols = {
  arrow: COLOR ? colors.cyan("\u2192") : "->",
  check: COLOR ? colors.green("\u2713") : "OK",
  cross: COLOR ? colors.red("\u2717") : "X",
  star: COLOR ? colors.cyan("\u2726") : "*",
  warn: COLOR ? colors.yellow("\u26A0") : "!"
};

// src/lib/prompt.ts
var sharedRl = null;
var lineBuffer = [];
var lineWaiters = [];
var stdinEnded = false;
function ensureRl() {
  if (sharedRl) return sharedRl;
  sharedRl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: process.stdin.isTTY === true
  });
  sharedRl.on("line", (line2) => {
    const waiter = lineWaiters.shift();
    if (waiter) waiter(line2);
    else lineBuffer.push(line2);
  });
  sharedRl.on("close", () => {
    stdinEnded = true;
    while (lineWaiters.length) lineWaiters.shift()("");
  });
  return sharedRl;
}
function readLine() {
  ensureRl();
  if (lineBuffer.length) return Promise.resolve(lineBuffer.shift());
  if (stdinEnded) return Promise.resolve("");
  return new Promise((resolve16) => lineWaiters.push(resolve16));
}
function closePromptIO() {
  if (sharedRl) {
    sharedRl.close();
    sharedRl = null;
  }
}
function shutdownSharedRl() {
  if (!sharedRl) return;
  while (lineWaiters.length) lineWaiters.shift()("");
  lineBuffer.length = 0;
  stdinEnded = false;
  try {
    sharedRl.removeAllListeners("close");
    sharedRl.removeAllListeners("line");
    sharedRl.close();
  } catch {
  }
  sharedRl = null;
}
process.once("exit", closePromptIO);
async function promptChoice(opts) {
  const choices = opts.choices.map((c) => ({ ...c, key: c.key.toLowerCase() }));
  const defaultKey = opts.defaultKey?.toLowerCase();
  if (process.stdin.isTTY) {
    return promptChoiceTTY(opts.question, choices, defaultKey);
  }
  return promptChoiceLineBased(opts.question, choices, defaultKey);
}
function renderPrompt(question, choices, defaultKey) {
  process.stdout.write(`
${colors.bold(question)}
`);
  for (const c of choices) {
    const isDefault = c.key === defaultKey;
    const keyStr = isDefault ? colors.bold(c.key.toUpperCase()) : c.key;
    process.stdout.write(`  [${keyStr}] ${c.label}
`);
  }
  const hint2 = defaultKey ? colors.dim(` (Enter = ${defaultKey})`) : "";
  process.stdout.write(`${colors.cyan(">")}${hint2} `);
}
async function promptChoiceTTY(question, choices, defaultKey) {
  return new Promise((resolve16, reject) => {
    renderPrompt(question, choices, defaultKey);
    const stdin = process.stdin;
    const wasRaw = stdin.isRaw === true;
    shutdownSharedRl();
    try {
      stdin.setRawMode(true);
    } catch {
      promptChoiceLineBased(question, choices, defaultKey).then(resolve16, reject);
      return;
    }
    stdin.resume();
    stdin.setEncoding("utf8");
    const cleanup = () => {
      stdin.off("data", onData);
      try {
        stdin.setRawMode(wasRaw);
      } catch {
      }
      stdin.pause();
    };
    function onData(chunk) {
      const ch = typeof chunk === "string" ? chunk : chunk.toString("utf8");
      if (ch === "") {
        cleanup();
        process.exit(130);
      }
      if (ch === "\r" || ch === "\n") {
        if (!defaultKey) return;
        const def = choices.find((c) => c.key === defaultKey);
        if (!def) return;
        process.stdout.write(`${def.key}
`);
        cleanup();
        resolve16(def.key);
        return;
      }
      const key = ch.toLowerCase();
      const match = choices.find((c) => c.key === key);
      if (!match) return;
      process.stdout.write(`${match.key}
`);
      cleanup();
      resolve16(match.key);
    }
    stdin.on("data", onData);
  });
}
async function promptChoiceLineBased(question, choices, defaultKey) {
  while (true) {
    renderPrompt(question, choices, defaultKey);
    const line2 = await readLine();
    const trimmed = line2.trim();
    if (!trimmed && defaultKey) {
      const def = choices.find((c) => c.key === defaultKey);
      if (def) return def.key;
    }
    const key = trimmed.toLowerCase().slice(0, 1);
    const match = choices.find((c) => c.key === key);
    if (match) return match.key;
    process.stdout.write(`(unrecognized: \`${trimmed}\` \u2014 try again)
`);
  }
}
async function promptYesNo(opts) {
  const defaultKey = opts.defaultYes ? "y" : "n";
  const answer = await promptChoice({
    question: opts.question,
    choices: [
      { key: "y", label: "yes" },
      { key: "n", label: "no" }
    ],
    defaultKey
  });
  return answer === "y";
}
async function promptText(opts) {
  while (true) {
    process.stdout.write(`
${colors.bold(opts.question)}
`);
    if (opts.hint) process.stdout.write(`  ${colors.dim(opts.hint)}
`);
    const def = opts.default ? ` ${colors.dim(`[${opts.default}]`)}` : "";
    process.stdout.write(`${colors.cyan(">")}${def} `);
    const line2 = await readLine();
    const value = line2.trim() || opts.default || "";
    const err = opts.validate?.(value) ?? null;
    if (err) {
      process.stdout.write(`  ${colors.yellow("\u26A0")} ${err}
`);
      continue;
    }
    return value;
  }
}
async function promptList(opts) {
  const items = opts.items;
  if (items.length === 0) {
    throw new Error("promptList: at least one item required");
  }
  const defaultIndex = Math.min(
    Math.max(0, opts.defaultIndex ?? 0),
    items.length - 1
  );
  if (process.stdin.isTTY) {
    return promptListTTY(opts.question, items, defaultIndex);
  }
  return promptListLineBased(opts.question, items, defaultIndex);
}
function renderListItems(items, selected) {
  items.forEach((item, i) => {
    const num = `${i + 1}`.padStart(2);
    const isSelected = i === selected;
    const marker = isSelected ? colors.cyan("\u25B8") : " ";
    const label = isSelected ? colors.bold(item.label) : item.label;
    const itemHint = item.hint ? `  ${colors.dim(item.hint)}` : "";
    process.stdout.write(`  ${marker} ${num}. ${label}${itemHint}
`);
  });
}
async function promptListTTY(question, items, defaultIndex) {
  let selected = defaultIndex;
  process.stdout.write(`
${colors.bold(question)}
`);
  renderListItems(items, selected);
  process.stdout.write(
    `${colors.dim(`  \u2191/\u2193 to move \xB7 number to jump \xB7 Enter to pick \xB7 Ctrl+C to abort`)}
`
  );
  const stdin = process.stdin;
  const wasRaw = stdin.isRaw === true;
  shutdownSharedRl();
  try {
    stdin.setRawMode(true);
  } catch {
    return promptListLineBased(question, items, defaultIndex);
  }
  stdin.resume();
  stdin.setEncoding("utf8");
  return new Promise((resolve16) => {
    const cleanup = () => {
      stdin.off("data", onData);
      try {
        stdin.setRawMode(wasRaw);
      } catch {
      }
      stdin.pause();
    };
    const redraw = () => {
      readline.moveCursor(process.stdout, -process.stdout.columns, -(items.length + 1));
      readline.clearScreenDown(process.stdout);
      renderListItems(items, selected);
      process.stdout.write(
        `${colors.dim(`  \u2191/\u2193 to move \xB7 number to jump \xB7 Enter to pick \xB7 Ctrl+C to abort`)}
`
      );
    };
    function onData(chunk) {
      const ch = typeof chunk === "string" ? chunk : chunk.toString("utf8");
      if (ch === "") {
        cleanup();
        process.exit(130);
      }
      if (ch === "\r" || ch === "\n") {
        cleanup();
        resolve16(items[selected].value);
        return;
      }
      if (ch === "\x1B[A" || ch === "\x1BOA") {
        selected = (selected - 1 + items.length) % items.length;
        redraw();
        return;
      }
      if (ch === "\x1B[B" || ch === "\x1BOB") {
        selected = (selected + 1) % items.length;
        redraw();
        return;
      }
      if (ch === "\x1B[H" || ch === "\x1B[5~") {
        selected = 0;
        redraw();
        return;
      }
      if (ch === "\x1B[F" || ch === "\x1B[6~") {
        selected = items.length - 1;
        redraw();
        return;
      }
      if (ch >= "1" && ch <= "9") {
        const idx = Number.parseInt(ch, 10) - 1;
        if (idx < items.length) {
          selected = idx;
          redraw();
        }
        return;
      }
    }
    stdin.on("data", onData);
  });
}
async function promptListLineBased(question, items, defaultIndex) {
  while (true) {
    process.stdout.write(`
${colors.bold(question)}
`);
    renderListItems(items, defaultIndex);
    const def = colors.dim(` (Enter = ${defaultIndex + 1})`);
    process.stdout.write(`${colors.cyan(">")}${def} `);
    const line2 = await readLine();
    const trimmed = line2.trim();
    if (!trimmed) return items[defaultIndex].value;
    const parsed = Number.parseInt(trimmed, 10);
    if (Number.isNaN(parsed) || parsed < 1 || parsed > items.length) {
      process.stdout.write(
        `  ${colors.yellow("\u26A0")} Pick a number 1\u2013${items.length}.
`
      );
      continue;
    }
    return items[parsed - 1].value;
  }
}

// src/lib/cursor-prompt.ts
async function writeCursorPrompt(args) {
  const loopsRoot = resolve8(args.rootDir, args.config.loopsDir ?? "design-loops");
  const paths = loopPaths(loopsRoot, args.loopId);
  const manifest = readManifest(paths);
  const prompt = buildCursorPrompt({
    rootDir: args.rootDir,
    loopId: args.loopId,
    route: manifest.route,
    framework: manifest.framework,
    designSystem: manifest.designSystem.name,
    routesDir: args.config.routesDir,
    translatedFiles: args.translatedFiles,
    sourcesDir: pickSourcesDir(args.translatedFiles)
  });
  const promptPath = resolve8(paths.outputDir, "CURSOR_PROMPT.md");
  writeFileSync8(promptPath, prompt, "utf8");
  return { promptPath, prompt };
}
async function offerClipboardCopy(result, opts = {}) {
  console.log(`  ${colors.cyan("\u{1F4CB}")} ${colors.bold("Cursor merge prompt ready:")}`);
  console.log(`     ${colors.dim(result.promptPath)}`);
  const interactive = opts.interactive !== false && !!process.stdin.isTTY;
  if (!interactive) {
    hint("Open the file, copy its contents, paste into a new Cursor chat.");
    return { copied: false, asked: false };
  }
  const yes = await promptYesNo({
    question: "Copy the prompt to your clipboard?",
    defaultYes: true
  });
  if (!yes) {
    hint("Clipboard untouched. Grab the prompt from the file when ready.");
    return { copied: false, asked: true };
  }
  const ok = await copyToClipboard(result.prompt);
  if (ok) {
    success(`Copied. Open a new Cursor chat in this repo and paste (${colors.bold("\u2318V")}).`);
  } else {
    warn("Clipboard copy failed (no `pbcopy` on this system?).");
    hint(`Open and copy manually: ${result.promptPath}`);
  }
  return { copied: ok, asked: true };
}
function buildCursorPrompt(opts) {
  const scaffolds = opts.translatedFiles.map((abs) => describeScaffold(abs, opts.rootDir));
  const targetRoute = mapRouteToFile(opts.route, opts.framework, opts.routesDir, opts.rootDir);
  const lines = [];
  lines.push(
    `Merge the Claude Design output for the \`${opts.route}\` route into the live codebase.`
  );
  lines.push("");
  lines.push(`**Loop**: \`${opts.loopId}\``);
  lines.push(`**Design system**: ${opts.designSystem}`);
  lines.push(`**Framework**: ${opts.framework}`);
  lines.push("");
  lines.push("## Files to read");
  lines.push("");
  for (const s of scaffolds) {
    lines.push(`- **Scaffold (target shape + design tokens)**: \`${s.scaffoldRel}\``);
    if (s.sourcesRel) {
      lines.push(`- **JSX sources (the real UI lives here)**: \`${s.sourcesRel}/\``);
      const entry = s.sourceFiles.find((f) => /^app\.jsx?$/i.test(f));
      const others = s.sourceFiles.filter((f) => f !== entry);
      if (entry) lines.push(`  - Entry: \`${entry}\``);
      if (others.length) {
        lines.push(`  - Other files: ${others.map((f) => `\`${f}\``).join(", ")}`);
      }
    }
  }
  lines.push(`- **Live route to update**: \`${targetRoute}\``);
  lines.push("");
  lines.push("## What to do");
  lines.push("");
  lines.push(
    "1. Read the JSX files in the sources directory. Build a mental model of the component tree, props, and layout."
  );
  lines.push(
    `2. Translate the JSX into ${formatHint(opts.framework)} markup inside the live route file (or factor large sections into \`${suggestComponentDir(opts.routesDir, opts.framework)}/\`).`
  );
  lines.push(
    "3. Wire data from the route's existing loader. If the design needs fields the loader doesn't return, propose the loader patch \u2014 don't invent mock data."
  );
  lines.push(
    "4. Keep the CSS from the scaffold's `<style>` block intact (those are the design tokens). Inline it on the route or extract to a shared stylesheet \u2014 your judgement."
  );
  lines.push(`5. Use ${idiomHint(opts.framework)}.${opts.framework === "svelte" || opts.framework === "vue" ? " Don't carry React patterns over." : ""}`);
  lines.push("6. Don't add dependencies that aren't already in the project's `package.json`.");
  lines.push(
    "7. After the merge, run the dev server and confirm the route renders without console errors."
  );
  lines.push("");
  lines.push(
    "> Skip the design-loop CLI for this step \u2014 the round-trip ends here. Just merge the files above."
  );
  lines.push("");
  return lines.join("\n");
}
function describeScaffold(absScaffold, rootDir) {
  const componentName = basename4(absScaffold).replace(/\.[^.]+$/, "");
  const scaffoldRel = relative3(rootDir, absScaffold);
  const sourcesAbs = resolve8(absScaffold, "..", "sources", componentName);
  let sourcesRel = null;
  let sourceFiles = [];
  if (existsSync7(sourcesAbs) && statSync3(sourcesAbs).isDirectory()) {
    sourcesRel = relative3(rootDir, sourcesAbs);
    sourceFiles = readdirSync5(sourcesAbs).filter((n) => !n.startsWith(".")).sort();
  }
  return { componentName, scaffoldRel, sourcesRel, sourceFiles };
}
function pickSourcesDir(translatedFiles) {
  const first = translatedFiles[0];
  if (!first) return null;
  return resolve8(first, "..", "sources");
}
function mapRouteToFile(route, framework, routesDir, rootDir) {
  const trimmed = route.replace(/^\/+|\/+$/g, "");
  const rel = relative3(rootDir, routesDir);
  if (framework === "svelte") {
    const segment = trimmed ? `/${trimmed}` : "";
    return `${rel}${segment}/+page.svelte`;
  }
  if (framework === "react") {
    const segment = trimmed ? `/${trimmed}` : "";
    return `${rel}${segment}/page.tsx (Next.js) or equivalent`;
  }
  return `${rel}${trimmed ? `/${trimmed}` : ""} (the file rendering this route)`;
}
function suggestComponentDir(routesDir, framework) {
  const trimmed = routesDir.replace(/\/+$/, "");
  if (framework === "svelte") {
    const guess = trimmed.replace(/\/routes$/, "/lib/components");
    if (guess !== trimmed) return guess;
    return `${trimmed}/_components`;
  }
  if (framework === "react") {
    const guess = trimmed.replace(/\/(app|pages)$/, "/components");
    if (guess !== trimmed) return guess;
    return `${trimmed}/_components`;
  }
  return `${trimmed}/_components`;
}
function formatHint(framework) {
  if (framework === "svelte") return "Svelte 5 runes-based";
  if (framework === "react") return "React (TSX)";
  if (framework === "vue") return "Vue 3 SFC";
  return framework;
}
function idiomHint(framework) {
  if (framework === "svelte") return "Svelte 5 idioms (`$state`, `$derived`, `$props`, `{#if}`, `{#each}`)";
  if (framework === "react") return "React idioms (functional components, hooks)";
  if (framework === "vue") return "Vue 3 Composition API idioms";
  return `${framework} idioms`;
}
async function copyToClipboard(text) {
  if (process.platform !== "darwin") return false;
  return new Promise((resolveP) => {
    try {
      const child = spawn("pbcopy");
      child.on("error", () => resolveP(false));
      child.on("close", (code) => resolveP(code === 0));
      child.stdin.end(text, "utf8");
    } catch {
      resolveP(false);
    }
  });
}

// src/lib/apply.ts
async function runApply(args) {
  const loopsRoot = resolve9(args.rootDir, args.config.loopsDir ?? "design-loops");
  const paths = loopPaths(loopsRoot, args.loopId);
  if (!existsSync8(paths.bundleDir)) {
    throw new Error(
      `Bundle directory missing for ${args.loopId}. Run \`design-loop pull\` first.`
    );
  }
  mkdirSync7(paths.outputDir, { recursive: true });
  const checklist = parseChecklist(paths.reviewChecklistPath);
  const adapter = getAdapter(args.config.framework);
  console.log(
    `[apply] adapter=${adapter.name} approved=${checklist.approved.length} rejected=${checklist.rejected.length}`
  );
  const result = await adapter.apply({
    config: args.config,
    rootDir: args.rootDir,
    loopId: args.loopId,
    loopRoot: paths.root,
    bundleDir: paths.bundleDir,
    outputDir: paths.outputDir,
    approvedItems: checklist.approved,
    rejectedItems: checklist.rejected,
    notes: checklist.notes
  });
  const summary = [
    `# Apply summary \u2014 ${args.loopId}`,
    "",
    `Adapter: \`${adapter.name}\``,
    `Approved items: ${checklist.approved.length}`,
    `Rejected items: ${checklist.rejected.length}`,
    "",
    "## Translated files",
    result.translatedFiles.length ? result.translatedFiles.map((f) => `- \`${f}\``).join("\n") : "- (none)",
    "",
    "## Adapter notes",
    result.notes.map((n) => `- ${n}`).join("\n"),
    "",
    "## Next step",
    "",
    `Run \`design-loop verify ${args.loopId}\` once the translated scaffolds are merged into the live route.`,
    ""
  ].join("\n");
  const summaryPath = resolve9(paths.outputDir, "APPLY_SUMMARY.md");
  writeFileSync9(summaryPath, summary, "utf8");
  console.log(`[apply] wrote ${summaryPath}`);
  const manifest = readManifest(paths);
  manifest.apply = {
    appliedAt: (/* @__PURE__ */ new Date()).toISOString(),
    targetFiles: result.translatedFiles,
    skippedItems: checklist.rejected
  };
  writeManifest(paths, manifest);
  let promptResult = null;
  if (result.translatedFiles.length) {
    try {
      promptResult = await writeCursorPrompt({
        config: args.config,
        rootDir: args.rootDir,
        loopId: args.loopId,
        translatedFiles: result.translatedFiles
      });
      if (!args.silent) {
        console.log("");
        await offerClipboardCopy(promptResult, { interactive: args.interactive });
        console.log("");
      }
    } catch (err) {
      console.warn(`[apply] could not build Cursor prompt: ${err.message}`);
    }
  }
  return {
    outputDir: paths.outputDir,
    translatedFiles: result.translatedFiles,
    notes: result.notes,
    promptResult
  };
}
function parseChecklist(path) {
  if (!existsSync8(path)) {
    return { approved: [], rejected: [], notes: "" };
  }
  const md = readFileSync6(path, "utf8");
  const lines = md.split("\n");
  const approved = [];
  const rejected = [];
  const noteLines = [];
  let inNotes = false;
  for (const line2 of lines) {
    if (/^##\s*notes/i.test(line2)) {
      inNotes = true;
      continue;
    }
    if (/^##\s/.test(line2)) {
      inNotes = false;
      continue;
    }
    if (inNotes) {
      noteLines.push(line2);
      continue;
    }
    const checked = line2.match(/^\s*-\s*\[(x|X)\]\s+(.+)/);
    if (checked && checked[2]) {
      approved.push(checked[2].trim());
      continue;
    }
    const rejectedItem = line2.match(/^\s*-\s*\[(✗|x✗)\]\s+(.+)/);
    if (rejectedItem && rejectedItem[2]) {
      rejected.push(rejectedItem[2].trim());
    }
  }
  return {
    approved,
    rejected,
    notes: noteLines.join("\n").trim()
  };
}

// src/lib/verify.ts
import { existsSync as existsSync9, mkdirSync as mkdirSync8, readFileSync as readFileSync7, writeFileSync as writeFileSync10 } from "fs";
import { join as join7, relative as relative4, resolve as resolve10 } from "path";
async function runVerify(args) {
  const config = withDefaults(args.config);
  const loopsRoot = resolve10(args.rootDir, config.loopsDir);
  const paths = loopPaths(loopsRoot, args.loopId);
  if (!existsSync9(paths.root)) {
    throw new Error(`Loop ${args.loopId} not found.`);
  }
  const manifest = readManifest(paths);
  const afterDir = join7(paths.outputDir, "after");
  mkdirSync8(afterDir, { recursive: true });
  const url = joinUrl2(manifest.devUrl, manifest.route);
  console.log(`[verify] re-capturing ${url} ...`);
  const capture = await captureRoute({
    url,
    outDir: afterDir,
    breakpoints: manifest.breakpoints,
    settleMs: config.settleMs,
    storageState: config.storageState,
    waitFor: config.waitFor
  });
  const beforeRefs = manifest.breakpoints.map((bp) => ({
    width: bp,
    path: relative4(paths.root, join7(paths.inputsDir, `screenshot-${bp}.png`))
  }));
  const afterRefs = capture.screenshots.map((s) => ({
    width: s.width,
    path: relative4(paths.root, s.path)
  }));
  const checklist = readChecklistItems(paths.reviewChecklistPath);
  const md = [
    `# Verify report \u2014 ${args.loopId}`,
    "",
    `Route: \`${manifest.route}\``,
    `Captured at: ${(/* @__PURE__ */ new Date()).toISOString()}`,
    "",
    "## Before / after screenshots",
    "",
    "| Breakpoint | Before | After |",
    "|---|---|---|",
    ...manifest.breakpoints.map((bp) => {
      const before = beforeRefs.find((b) => b.width === bp)?.path ?? "\u2014";
      const after = afterRefs.find((a) => a.width === bp)?.path ?? "\u2014";
      return `| ${bp}px | \`${before}\` | \`${after}\` |`;
    }),
    "",
    "## Review checklist items",
    checklist.length ? checklist.map((it) => `- [ ] confirm in render: ${it}`).join("\n") : "_(no items in the checklist \u2014 generate one with `design:pull` first)_",
    "",
    "## Next step",
    "",
    "Open the after-screenshots side-by-side with the before-screenshots and the",
    "Claude Design canvas. Tick the items above that the rendered output actually",
    "reflects. Anything not ticked = either not implemented or implemented incorrectly.",
    ""
  ].join("\n");
  writeFileSync10(paths.verifyReportPath, md, "utf8");
  console.log(`[verify] wrote ${paths.verifyReportPath}`);
  return {
    reportPath: paths.verifyReportPath,
    afterScreenshots: capture.screenshots.map((s) => s.path)
  };
}
function joinUrl2(base, route) {
  const b = base.replace(/\/+$/, "");
  const r = route.startsWith("/") ? route : `/${route}`;
  return `${b}${r}`;
}
function readChecklistItems(path) {
  if (!existsSync9(path)) return [];
  const md = readFileSync7(path, "utf8");
  const items = [];
  for (const line2 of md.split("\n")) {
    const m = line2.match(/^\s*-\s*\[(x|X)\]\s+(.+)/);
    if (m && m[2]) items.push(m[2].trim());
  }
  return items;
}

// src/lib/submit.ts
import { existsSync as existsSync11, readdirSync as readdirSync6 } from "fs";
import { join as join9, resolve as resolve12 } from "path";

// src/lib/claude-design.ts
import { mkdirSync as mkdirSync9, writeFileSync as writeFileSync11 } from "fs";
import { dirname as dirname5 } from "path";
import { homedir } from "os";
import { join as join8 } from "path";
import {
  chromium as chromium2
} from "playwright";
var DESIGN_HOME = "https://claude.ai/design";
var HANDOFF_URL_PATTERN = /https:\/\/api\.anthropic\.com\/v1\/design\/h\/[A-Za-z0-9_-]+(?:\?open_file=[^\s)"<]+)?/;
function defaultAuthPaths() {
  const root = join8(homedir(), ".config", "design-loop");
  return {
    storageState: join8(root, "auth.json"),
    profileDir: join8(root, "chromium-profile")
  };
}
function ensureDir(path) {
  mkdirSync9(dirname5(path), { recursive: true });
}
async function dumpFailureState(page, label) {
  try {
    const root = join8(homedir(), ".config", "design-loop", "failures");
    mkdirSync9(root, { recursive: true });
    const stamp = (/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-");
    const slug = label.replace(/[^a-z0-9-]+/gi, "_").slice(0, 40);
    const base = join8(root, `${stamp}-${slug}`);
    const aria = await page.locator("body").ariaSnapshot().catch(() => "<aria snapshot failed>");
    writeFileSync11(`${base}.aria.yaml`, aria, "utf8");
    writeFileSync11(`${base}.url.txt`, page.url(), "utf8");
    await page.screenshot({ path: `${base}.png`, fullPage: false }).catch(() => {
    });
    console.error(`[submit] dumped failure state to ${base}.{aria.yaml,png,url.txt}`);
  } catch {
  }
}
async function withFailureDump(page, label, fn) {
  try {
    return await fn();
  } catch (err) {
    await dumpFailureState(page, label);
    throw err;
  }
}
async function loginInteractive(authPaths) {
  ensureDir(authPaths.storageState);
  mkdirSync9(authPaths.profileDir, { recursive: true });
  const context = await chromium2.launchPersistentContext(authPaths.profileDir, {
    headless: false,
    viewport: { width: 1280, height: 900 },
    args: ["--disable-blink-features=AutomationControlled"]
  });
  try {
    const page = context.pages()[0] ?? await context.newPage();
    await page.goto(DESIGN_HOME, { waitUntil: "domcontentloaded" });
    console.log("[login] log in to claude.ai in the browser window.");
    console.log("[login] once you see the Claude Design project picker, return here.");
    console.log(
      '[login] waiting for "Design system" combobox or "Designs" tab to appear (timeout 5min)...'
    );
    await Promise.any([
      page.getByRole("combobox", { name: "Design system" }).waitFor({ timeout: 3e5 }),
      page.getByRole("tab", { name: "Designs", exact: true }).waitFor({ timeout: 3e5 })
    ]);
    await context.storageState({ path: authPaths.storageState });
    console.log(`[login] saved storage state to ${authPaths.storageState}`);
  } finally {
    await context.close();
  }
}
async function submitToClaudeDesign(opts) {
  const headless = !opts.headed;
  mkdirSync9(opts.authPaths.profileDir, { recursive: true });
  const context = await chromium2.launchPersistentContext(opts.authPaths.profileDir, {
    headless,
    viewport: { width: 1280, height: 900 },
    args: ["--disable-blink-features=AutomationControlled"]
  });
  try {
    return await driveSubmit(context, opts);
  } finally {
    await context.close();
  }
}
async function driveSubmit(context, opts) {
  const existing = context.pages()[0];
  const page = existing ?? await context.newPage();
  const networkUrls = /* @__PURE__ */ new Set();
  page.on("request", (req) => {
    if (HANDOFF_URL_PATTERN.test(req.url())) networkUrls.add(req.url());
  });
  page.on("response", (res) => {
    if (HANDOFF_URL_PATTERN.test(res.url())) networkUrls.add(res.url());
  });
  console.log("[submit] opening claude.ai/design ...");
  await page.goto(DESIGN_HOME, { waitUntil: "domcontentloaded" });
  await withFailureDump(
    page,
    "assert-logged-in",
    () => assertLoggedIn(page, opts.headed === true)
  );
  await withFailureDump(
    page,
    "fill-new-project",
    () => fillNewProject(page, opts)
  );
  await withFailureDump(
    page,
    "upload-attachments",
    () => uploadAttachments(page, opts.attachmentPaths)
  );
  await withFailureDump(
    page,
    "send-brief",
    () => sendBrief(page, opts.briefPath)
  );
  const projectUrl = page.url();
  console.log(`[submit] design in flight at ${projectUrl}`);
  console.log("[submit] waiting for Claude to start designing ...");
  const started = await waitForFirstActivity(page);
  if (!started) {
    if (!opts.review) {
      throw new Error(
        `Claude Design did not start working within 90s of sending the brief. No activity verbs (${ACTIVITY_VERBS.slice(0, 5).join(", ")}, ...) appeared. The submission may have been rejected (rate limit, file size, model pick).`
      );
    }
    console.warn(
      "[submit] no activity verbs detected in 90s. The browser is still open \u2014 check the page and decide."
    );
  }
  const bundleUrl = await runSettleReviewLoop(page, networkUrls, opts.review);
  return { projectUrl, bundleUrl };
}
async function runSettleReviewLoop(page, networkUrls, review, options = {}) {
  let bundleUrl = null;
  let settleCount = 0;
  let isFirst = true;
  while (true) {
    let claudeBusy = false;
    if (isFirst && options.skipFirstSettle) {
      const probeText = await page.locator("body").innerText().catch(() => "") ?? "";
      claudeBusy = findLatestActivity(probeText) !== null;
      if (claudeBusy) {
        console.log("[claude] activity in flight \u2014 prompting anyway (resume).");
      } else {
        console.log("[claude] no activity detected \u2014 design appears settled.");
      }
    } else {
      const settled = await waitForActivitySettle(page);
      if (!settled) break;
    }
    isFirst = false;
    settleCount += 1;
    if (!review) {
      console.log(`[submit] design ready. Review/iterate here: ${page.url()}`);
      break;
    }
    const decision = await review({
      projectUrl: page.url(),
      settleCount,
      claudeBusy
    });
    if (decision.action === "quit") break;
    if (decision.action === "fetch") {
      console.log("[submit] driving Share \u2192 Handoff to Claude Code in-session ...");
      bundleUrl = await withFailureDump(
        page,
        "in-session-handoff",
        () => triggerHandoff(page, networkUrls)
      );
      break;
    }
    console.log("[submit] watching for more activity. Iterate in the browser as much as you want.");
  }
  return bundleUrl;
}
async function resumeReview(opts) {
  const headless = !opts.headed;
  mkdirSync9(opts.authPaths.profileDir, { recursive: true });
  const context = await chromium2.launchPersistentContext(opts.authPaths.profileDir, {
    headless,
    viewport: { width: 1280, height: 900 },
    args: ["--disable-blink-features=AutomationControlled"]
  });
  try {
    const existing = context.pages()[0];
    const page = existing ?? await context.newPage();
    const networkUrls = /* @__PURE__ */ new Set();
    page.on("request", (req) => {
      if (HANDOFF_URL_PATTERN.test(req.url())) networkUrls.add(req.url());
    });
    page.on("response", (res) => {
      if (HANDOFF_URL_PATTERN.test(res.url())) networkUrls.add(res.url());
    });
    console.log(`[resume] opening ${opts.projectUrl} ...`);
    await page.goto(opts.projectUrl, { waitUntil: "domcontentloaded" });
    await withFailureDump(page, "resume-canvas-ready", async () => {
      await Promise.any([
        page.getByRole("textbox", { name: /describe what you want to create/i }).waitFor({ timeout: 3e4 }),
        page.getByRole("button", { name: "Share" }).waitFor({ timeout: 3e4 })
      ]);
    });
    console.log("[resume] project ready. Prompting immediately ...");
    const bundleUrl = await runSettleReviewLoop(
      page,
      networkUrls,
      opts.review,
      { skipFirstSettle: true }
    );
    return { projectUrl: page.url(), bundleUrl };
  } finally {
    await context.close();
  }
}
async function listDesignSystems(opts) {
  const headless = !opts.headed;
  mkdirSync9(opts.authPaths.profileDir, { recursive: true });
  const context = await chromium2.launchPersistentContext(opts.authPaths.profileDir, {
    headless,
    viewport: { width: 1280, height: 900 },
    args: ["--disable-blink-features=AutomationControlled"]
  });
  try {
    const page = context.pages()[0] ?? await context.newPage();
    await page.goto(DESIGN_HOME, { waitUntil: "domcontentloaded" });
    await assertLoggedIn(page, opts.headed === true);
    return await scrapeDesignSystems(page);
  } finally {
    await context.close();
  }
}
async function scrapeDesignSystems(page) {
  const combo = page.getByRole("combobox", { name: "Design system" });
  await combo.waitFor({ timeout: 3e4 });
  const native = await combo.evaluate((el) => {
    if (!(el instanceof HTMLSelectElement)) return null;
    return Array.from(el.options).map((o) => ({
      name: o.label || o.textContent?.trim() || "",
      id: o.value
    }));
  });
  if (native && native.length) {
    return native.filter((s) => s.id);
  }
  await combo.click();
  const options = page.locator("[role=option]");
  await options.first().waitFor({ timeout: 5e3 });
  const count = await options.count();
  const out = [];
  for (let i = 0; i < count; i++) {
    const opt = options.nth(i);
    const id = await opt.getAttribute("data-value") ?? await opt.getAttribute("value") ?? "";
    const name = (await opt.innerText()).trim();
    if (id && name) out.push({ name, id });
  }
  await page.keyboard.press("Escape").catch(() => {
  });
  return out;
}
async function fetchHandoffBundleUrl(opts) {
  const headless = !opts.headed;
  mkdirSync9(opts.authPaths.profileDir, { recursive: true });
  const context = await chromium2.launchPersistentContext(opts.authPaths.profileDir, {
    headless,
    viewport: { width: 1280, height: 900 },
    args: ["--disable-blink-features=AutomationControlled"]
  });
  try {
    const existing = context.pages()[0];
    const page = existing ?? await context.newPage();
    const networkUrls = /* @__PURE__ */ new Set();
    page.on("request", (req) => {
      if (HANDOFF_URL_PATTERN.test(req.url())) networkUrls.add(req.url());
    });
    page.on("response", (res) => {
      if (HANDOFF_URL_PATTERN.test(res.url())) networkUrls.add(res.url());
    });
    await page.goto(opts.projectUrl, { waitUntil: "domcontentloaded" });
    await withFailureDump(page, "fetch-assert-canvas", async () => {
      await Promise.any([
        page.getByRole("textbox", { name: /describe what you want to create/i }).waitFor({ timeout: 3e4 }),
        page.getByRole("button", { name: "Share" }).waitFor({ timeout: 3e4 })
      ]);
    });
    const url = await withFailureDump(
      page,
      "fetch-handoff",
      () => triggerHandoff(page, networkUrls)
    );
    if (!url) {
      throw new Error(
        `Couldn't capture a handoff bundle URL from ${opts.projectUrl}. The Share menu opened but no api.anthropic.com/v1/design/h/... URL appeared in 90s. Run again with --headed and copy the URL manually from Share \u2192 Handoff to Claude Code.`
      );
    }
    return url;
  } finally {
    await context.close();
  }
}
async function assertLoggedIn(page, headed) {
  const timeout = headed ? 3e5 : 3e4;
  if (headed) {
    console.log(
      "[submit] waiting for project picker (up to 5 min). If you see a verification challenge, solve it in the browser \u2014 the script will continue automatically."
    );
  }
  try {
    await page.getByRole("combobox", { name: "Design system" }).waitFor({ timeout });
  } catch {
    throw new Error(
      "Couldn't find the Claude Design project picker. Either you're not logged in, the saved session expired, or a verification challenge wasn't solved in time.\n\nFix: rerun with `--headed` and solve any prompts, or run `design-loop login` to refresh auth."
    );
  }
}
async function fillNewProject(page, opts) {
  console.log(`[submit] creating project "${opts.projectName}" ...`);
  await dismissOnboardingOverlay(page);
  const nameBox = page.getByRole("textbox", { name: "Project name" });
  await nameBox.fill(opts.projectName);
  await pickDesignSystem(page, opts.designSystemId);
  await ensureFidelitySelected(page, opts.fidelity);
  const createBtn = createButtonLocator(page);
  await createBtn.click({ timeout: 1e4 });
  await page.waitForURL(/\/design\/p\//, { timeout: 3e4 });
  await waitForChatInput(page);
  const projectUrl = page.url();
  console.log(`[submit] canvas opened: ${projectUrl}`);
  if (opts.onCanvasOpened) {
    try {
      await opts.onCanvasOpened(projectUrl);
    } catch (err) {
      console.warn(
        `[submit] onCanvasOpened callback threw (continuing anyway): ${err.message}`
      );
    }
  }
}
function createButtonLocator(page) {
  return page.locator('[data-testid="create-project-button"]');
}
async function dismissOnboardingOverlay(page) {
  const candidates = [
    page.getByRole("button", { name: /^Skip intro$/i }),
    page.getByRole("button", { name: /^Skip$/i }),
    page.locator('button:has-text("Skip intro")')
  ];
  for (const locator of candidates) {
    try {
      await locator.first().waitFor({ state: "visible", timeout: 1500 });
      console.log("[submit] dismissing onboarding overlay");
      await locator.first().click({ timeout: 2e3 });
      await page.waitForTimeout(400);
      return;
    } catch {
    }
  }
}
function fidelityButtonLocator(page, fidelity) {
  const name = fidelity === "wireframe" ? "Wireframe" : "High fidelity";
  return page.getByRole("button", { name }).first();
}
async function ensureFidelitySelected(page, fidelity) {
  const createBtn = createButtonLocator(page);
  await page.waitForTimeout(250);
  if (fidelity === "high-fidelity") {
    if (await createBtn.isEnabled().catch(() => false)) return;
    await fidelityButtonLocator(page, "high-fidelity").click();
    await page.waitForTimeout(250);
    if (await createBtn.isEnabled().catch(() => false)) return;
    throw new Error(
      "Create stayed disabled after selecting High fidelity. The new-project form may require an additional field, or the fidelity buttons changed."
    );
  }
  await fidelityButtonLocator(page, "wireframe").click();
  await page.waitForTimeout(250);
  if (await createBtn.isEnabled().catch(() => false)) return;
  await fidelityButtonLocator(page, "wireframe").click();
  await page.waitForTimeout(250);
  if (await createBtn.isEnabled().catch(() => false)) return;
  throw new Error(
    "Create stayed disabled after selecting Wireframe. The new-project form may require an additional field, or the fidelity buttons changed."
  );
}
async function pickDesignSystem(page, designSystemId) {
  const combo = page.getByRole("combobox", { name: "Design system" });
  try {
    await combo.selectOption({ value: designSystemId });
    return;
  } catch {
  }
  await combo.click();
  const optionByValue = page.locator(`[role=option][data-value="${designSystemId}"]`).first();
  if (await optionByValue.count()) {
    await optionByValue.click();
    return;
  }
  const optionElement = page.locator(`option[value="${designSystemId}"]`).first();
  if (await optionElement.count()) {
    await optionElement.click();
    return;
  }
  throw new Error(
    `Couldn't pick design system ${designSystemId}. Either the dropdown is custom and we need a selector tweak, or the id is wrong.
Inspect the dropdown in claude.ai/design and adjust pickDesignSystem in claude-design.ts.`
  );
}
async function waitForChatInput(page) {
  const primary = page.getByRole("textbox", {
    name: /describe what you want to create/i
  });
  try {
    await primary.waitFor({ state: "visible", timeout: 15e3 });
    return primary;
  } catch {
  }
  const fallbacks = [
    page.getByRole("textbox", { name: /describe|prompt|message|reply|how/i }),
    page.locator('[contenteditable="true"]').first(),
    page.locator("textarea").first()
  ];
  const start = Date.now();
  while (Date.now() - start < 15e3) {
    for (const c of fallbacks) {
      try {
        await c.waitFor({ state: "visible", timeout: 2e3 });
        return c;
      } catch {
      }
    }
  }
  throw new Error(
    "Couldn't find the Claude Design chat input within 30s. Expected accessible name: 'Describe what you want to create...'. Adjust waitForChatInput in claude-design.ts if the UI changed."
  );
}
async function uploadAttachments(page, paths) {
  if (!paths.length) return;
  console.log(`[submit] attaching ${paths.length} file(s) ...`);
  const addToChatByRole = page.getByRole("button", { name: "Add to chat" });
  const importBtnByTestId = page.locator('[data-testid="composer-import-button"]');
  const importBtn = await addToChatByRole.count() ? addToChatByRole.first() : importBtnByTestId.first();
  try {
    await importBtn.waitFor({ state: "visible", timeout: 15e3 });
  } catch {
    throw new Error(
      "Couldn't find the composer's '+' button (Add to chat). The composer UI may have changed."
    );
  }
  await importBtn.click();
  const attachItem = page.getByRole("button", { name: "Attach file" }).first();
  try {
    await attachItem.waitFor({ state: "visible", timeout: 5e3 });
  } catch {
    throw new Error(
      "Composer menu opened but no 'Attach file' option was visible. The menu items may have been renamed."
    );
  }
  const fileChooserPromise = page.waitForEvent("filechooser", { timeout: 1e4 });
  await attachItem.click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles(paths);
  await page.waitForTimeout(4e3);
  const errorToast = page.getByText(
    /couldn'?t upload|failed to upload|upload failed/i
  );
  if (await errorToast.first().isVisible().catch(() => false)) {
    const msg = await errorToast.first().innerText().catch(() => "");
    throw new Error(
      `Claude Design rejected the upload: "${msg.trim()}". Likely an unsupported file type. Allowed types: png/jpg/webp/gif/pdf. Attempted: ${paths.map((p) => p.split("/").pop()).join(", ")}`
    );
  }
}
async function sendBrief(page, briefPath) {
  const { readFileSync: readFileSync10 } = await import("fs");
  const briefMarkdown = readFileSync10(briefPath, "utf8");
  const input = await waitForChatInput(page);
  await input.click();
  try {
    await input.fill(briefMarkdown);
  } catch {
    await input.type(briefMarkdown, { delay: 0 });
  }
  await page.waitForTimeout(500);
  const sendBtn = page.getByRole("button", { name: "Send" }).first();
  try {
    await sendBtn.click({ timeout: 5e3 });
  } catch {
    await page.keyboard.press("Enter");
  }
  console.log("[submit] brief sent \u2014 waiting for response.");
}
var ACTIVITY_VERBS = [
  "Writing",
  "Viewing",
  "Reading",
  "Thinking",
  "Searching",
  "Generating",
  "Creating",
  "Designing",
  "Drafting",
  "Composing",
  "Sketching",
  "Implementing",
  "Building",
  "Analyzing",
  "Processing",
  "Listing"
];
var ACTIVITY_REGEX = new RegExp(
  `\\b(${ACTIVITY_VERBS.join("|")})\\b[^.\\n]{0,80}`
  // case-sensitive on purpose — see JSDoc above
);
function findLatestActivity(text) {
  const globalRe = new RegExp(ACTIVITY_REGEX.source, "g");
  let last = null;
  let match;
  while ((match = globalRe.exec(text)) !== null) {
    last = match;
  }
  if (!last) return null;
  return last[0].replace(/\s+/g, " ").trim().slice(0, 80);
}
async function pollActivity(page, state) {
  const text = await page.locator("body").innerText().catch(() => "") ?? "";
  const fragment = findLatestActivity(text);
  if (!fragment) return false;
  if (fragment === state.lastSeenVerb) {
    return false;
  }
  state.lastActivityAt = Date.now();
  state.lastSeenVerb = fragment;
  console.log(`[claude] ${fragment}`);
  return true;
}
async function waitForFirstActivity(page, graceMs = 9e4, pollMs = 2e3) {
  const start = Date.now();
  const state = { lastSeenVerb: null, lastActivityAt: Date.now() };
  while (Date.now() - start < graceMs) {
    if (await pollActivity(page, state)) return true;
    if (page.isClosed()) return false;
    await page.waitForTimeout(pollMs);
  }
  return false;
}
async function waitForActivitySettle(page, idleMs = 6e4, pollMs = 2e3) {
  const state = { lastSeenVerb: null, lastActivityAt: Date.now() };
  await pollActivity(page, state);
  while (true) {
    if (page.isClosed()) return false;
    const active = await pollActivity(page, state);
    if (!active && Date.now() - state.lastActivityAt > idleMs) {
      const idleSec = Math.round((Date.now() - state.lastActivityAt) / 1e3);
      console.log(`[claude] quiet for ${idleSec}s \u2014 design has settled.`);
      return true;
    }
    await page.waitForTimeout(pollMs);
  }
}
async function triggerHandoff(page, bundleUrls) {
  const shareBtn = page.getByRole("button", { name: "Share" }).first();
  if (!await shareBtn.count()) {
    console.warn("[submit] no Share button visible \u2014 skipping handoff capture.");
    return null;
  }
  await shareBtn.click();
  await page.waitForTimeout(400);
  const handoffItem = page.getByRole("button", { name: /handoff to claude code/i }).first();
  try {
    await handoffItem.waitFor({ state: "visible", timeout: 5e3 });
  } catch {
    throw new Error(
      "Share menu opened but 'Handoff to Claude Code\u2026' wasn't visible. The export menu items may have been renamed."
    );
  }
  await handoffItem.click();
  await page.waitForTimeout(800);
  const start = Date.now();
  while (Date.now() - start < 9e4) {
    const visibleUrl = await scrapeVisibleHandoffUrl(page);
    if (visibleUrl) return visibleUrl;
    const fromNetwork = Array.from(bundleUrls).find(
      (u) => HANDOFF_URL_PATTERN.test(u)
    );
    if (fromNetwork) return fromNetwork;
    await page.waitForTimeout(1e3);
  }
  console.warn("[submit] handoff modal opened but no bundle URL captured within 90s.");
  return null;
}
async function scrapeVisibleHandoffUrl(page) {
  const dialog = page.getByRole("dialog").first();
  const haystack = await dialog.count() ? await dialog.innerText().catch(() => "") : await page.locator("body").innerText().catch(() => "");
  const m = haystack?.match(HANDOFF_URL_PATTERN);
  return m ? m[0] : null;
}

// src/lib/lock.ts
import {
  existsSync as existsSync10,
  readFileSync as readFileSync8,
  unlinkSync as unlinkSync2,
  writeFileSync as writeFileSync12
} from "fs";
import { resolve as resolve11 } from "path";
var LOCK_FILE = ".lock.json";
function lockPath(loopsRoot) {
  return resolve11(loopsRoot, LOCK_FILE);
}
function checkLock(loopsRoot) {
  const path = lockPath(loopsRoot);
  if (!existsSync10(path)) return { active: false, alive: false };
  let info;
  try {
    info = JSON.parse(readFileSync8(path, "utf8"));
  } catch {
    return { active: true, alive: false };
  }
  return { active: true, alive: isProcessAlive(info.pid), info };
}
var NOOP_LOCK = { release: () => {
} };
function acquireLock(loopsRoot, opts) {
  ensureLoopsRootGitignore(loopsRoot);
  const path = lockPath(loopsRoot);
  const existing = checkLock(loopsRoot);
  if (existing.active && existing.info?.pid === process.pid) {
    return NOOP_LOCK;
  }
  if (existing.active && existing.alive && !opts.force) {
    const info2 = existing.info;
    const detail = info2 ? `pid=${info2.pid}, started=${info2.startedAt}, command=${info2.command}${info2.loopId ? `, loop=${info2.loopId}` : ""}` : "(unreadable lock file)";
    throw new LockHeldError(
      `Another design-loop session is running (${detail}). Wait for it to finish, or run with the wizard's force-unlock option once you're sure it's safe.`,
      info2
    );
  }
  const info = {
    pid: process.pid,
    startedAt: (/* @__PURE__ */ new Date()).toISOString(),
    command: opts.command,
    loopId: opts.loopId
  };
  writeFileSync12(path, JSON.stringify(info, null, 2) + "\n", "utf8");
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    try {
      const current = checkLock(loopsRoot);
      if (current.info && current.info.pid === process.pid) unlinkSync2(path);
    } catch {
    }
  };
  process.once("exit", release);
  process.once("SIGINT", () => {
    release();
    process.exit(130);
  });
  process.once("SIGTERM", () => {
    release();
    process.exit(143);
  });
  return { release };
}
var LockHeldError = class extends Error {
  constructor(message, info) {
    super(message);
    this.info = info;
    this.name = "LockHeldError";
  }
  info;
};
function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === "EPERM";
  }
}

// src/lib/submit.ts
async function runSubmit(args) {
  const config = withDefaults(args.config);
  const loopsRoot = resolve12(args.rootDir, config.loopsDir);
  const paths = loopPaths(loopsRoot, args.loopId);
  const lock = acquireLock(loopsRoot, {
    command: "submit",
    loopId: args.loopId
  });
  try {
    return await runSubmitInner(args, config, paths);
  } finally {
    lock.release();
  }
}
async function runSubmitInner(args, config, paths) {
  if (!existsSync11(paths.briefPath)) {
    throw new Error(`Loop ${args.loopId} not found at ${paths.root} or has no brief.md.`);
  }
  const authPaths = resolveAuthPaths(config);
  if (!existsSync11(authPaths.storageState)) {
    throw new Error(
      `No saved Claude Design auth at ${authPaths.storageState}. Run \`design-loop login\` first.`
    );
  }
  const manifest = readManifest(paths);
  if (!manifest.designSystem.id) {
    throw new Error(
      `Loop ${args.loopId} was created without a design-system id. Re-run \`design-loop brief ${args.loopId}\` with a design system that has \`id\` set in config.`
    );
  }
  const fidelity = args.fidelity ?? "high-fidelity";
  const projectName = args.projectName ?? args.loopId;
  const attachmentPaths = collectAttachments(paths.inputsDir);
  const wantInteractive = !args.noInteractive && process.stdin.isTTY === true && args.headed === true;
  console.log(
    `[submit] loop=${args.loopId} fidelity=${fidelity} attachments=${attachmentPaths.length} interactive=${wantInteractive}`
  );
  if (args.noInteractive !== true && args.headed !== true) {
    console.log(
      "[submit] --headed not set; running non-interactive (exits after first design settle)."
    );
  }
  const result = await submitToClaudeDesign({
    authPaths,
    designSystemId: manifest.designSystem.id,
    projectName,
    briefPath: paths.briefPath,
    attachmentPaths,
    fidelity,
    headed: args.headed,
    review: wantInteractive ? buildReviewHook() : void 0,
    // Persist the project URL the moment the canvas opens, so a later
    // `design-loop resume <loopId>` works even if the user kills the
    // process during the long review phase.
    onCanvasOpened: (url) => {
      manifest.claudeProjectUrl = url;
      writeManifest(paths, manifest);
      console.log(`[submit] project URL saved to manifest (resume-safe).`);
    }
  });
  if (manifest.claudeProjectUrl !== result.projectUrl) {
    manifest.claudeProjectUrl = result.projectUrl;
    writeManifest(paths, manifest);
  }
  let pulled = false;
  let applied = false;
  let translatedFiles = [];
  if (result.bundleUrl) {
    console.log(`[submit] bundle URL: ${result.bundleUrl}`);
    console.log("[submit] expanding bundle locally ...");
    await runPull({
      config: args.config,
      rootDir: args.rootDir,
      loopId: args.loopId,
      bundleSource: result.bundleUrl
    });
    pulled = true;
    if (!args.noApply) {
      try {
        console.log("[submit] translating bundle to framework scaffolds ...");
        const applyResult = await runApply({
          config: args.config,
          rootDir: args.rootDir,
          loopId: args.loopId,
          silent: true
        });
        applied = true;
        translatedFiles = applyResult.translatedFiles;
      } catch (err) {
        console.warn(
          `[submit] apply step failed (continuing \u2014 bundle is still pulled): ${err.message}`
        );
      }
    }
  }
  let promptResult = null;
  if (applied && translatedFiles.length) {
    try {
      promptResult = await writeCursorPrompt({
        config: args.config,
        rootDir: args.rootDir,
        loopId: args.loopId,
        translatedFiles
      });
    } catch (err) {
      console.warn(`[submit] could not build Cursor prompt: ${err.message}`);
    }
  }
  await printNextSteps(
    args.loopId,
    result.projectUrl,
    pulled,
    applied,
    translatedFiles,
    promptResult,
    !args.noInteractive
  );
  return {
    projectUrl: result.projectUrl,
    bundleUrl: result.bundleUrl,
    pulled,
    applied,
    translatedFiles
  };
}
function buildReviewHook() {
  return async (ctx) => {
    if (ctx.settleCount === 1) {
      console.log("");
      console.log("  \u2726 Design ready for review.");
      console.log(`  \u2726 Project URL: ${ctx.projectUrl}`);
      console.log("  \u2726 Iterate with Claude in the open browser as much as you like.");
      console.log("  \u2726 When you're happy, come back here and pick [f] to bring it home.");
    } else {
      console.log("");
      console.log(`  \u2726 Round ${ctx.settleCount} settled. What now?`);
    }
    while (true) {
      const key = await promptChoice({
        question: "What next?",
        choices: [
          { key: "f", label: "Fetch \u2014 Share \u2192 Handoff in this browser, then pull bundle" },
          { key: "w", label: "Wait \u2014 keep iterating in Claude Design (no timeout)" },
          { key: "u", label: "URL \u2014 print the project URL again" },
          { key: "q", label: "Quit \u2014 close browser without fetching" }
        ]
      });
      if (key === "u") {
        console.log(`  Project URL: ${ctx.projectUrl}`);
        continue;
      }
      if (key === "f" || key === "w" || key === "q") {
        return { action: key === "f" ? "fetch" : key === "w" ? "wait" : "quit" };
      }
    }
  };
}
async function printNextSteps(loopId, projectUrl, pulled, applied, translatedFiles, promptResult, interactive) {
  console.log("");
  if (applied) {
    await printMergeHandoff(loopId, translatedFiles, promptResult, interactive);
  } else if (pulled) {
    console.log("  Bundle pulled (apply skipped or failed). Inspect at:");
    console.log(`    design-loops/${loopId}/bundle/`);
    console.log("  Re-run apply manually:");
    console.log(`    design-loop apply ${loopId}`);
  } else {
    console.log("  Design left open in Claude Design:");
    console.log(`    ${projectUrl}`);
    console.log("  Pick up where you left off:");
    console.log(`    design-loop resume ${loopId} --headed              # re-open + interactive prompt`);
    console.log(`    design-loop fetch  ${loopId}                       # auto-handoff, no prompting`);
    console.log(`    design-loop pull   ${loopId} --bundle-url=<url>    # manual bundle URL paste`);
  }
  console.log("");
}
async function printMergeHandoff(loopId, translatedFiles, promptResult, interactive) {
  console.log("  \u2726 Done. Bundle pulled, scaffolds written:");
  for (const f of translatedFiles) console.log(`      ${f}`);
  console.log("");
  if (promptResult) {
    await offerClipboardCopy(promptResult, { interactive });
  } else {
    console.log("  Next: open Cursor chat and ask it to merge the scaffold into the live route.");
  }
  console.log("");
  console.log(`  Verify: design-loop verify ${loopId}`);
}
function resolveAuthPaths(config) {
  const fallback = defaultAuthPaths();
  if (!config.storageState) return fallback;
  return {
    storageState: config.storageState,
    profileDir: fallback.profileDir
  };
}
function collectAttachments(inputsDir) {
  if (!existsSync11(inputsDir)) return [];
  return readdirSync6(inputsDir).filter((name) => /\.(png|jpe?g|webp|gif|pdf)$/i.test(name)).map((name) => join9(inputsDir, name));
}

// src/lib/resume.ts
import { existsSync as existsSync12 } from "fs";
import { resolve as resolve13 } from "path";
async function runResume(args) {
  const config = withDefaults(args.config);
  const loopsRoot = resolve13(args.rootDir, config.loopsDir);
  const paths = loopPaths(loopsRoot, args.loopId);
  if (!existsSync12(paths.manifestPath)) {
    throw new Error(`Loop ${args.loopId} not found at ${paths.root}.`);
  }
  const lock = acquireLock(loopsRoot, {
    command: "resume",
    loopId: args.loopId
  });
  try {
    return await runResumeInner(args, config, paths);
  } finally {
    lock.release();
  }
}
async function runResumeInner(args, config, paths) {
  const manifest = readManifest(paths);
  const projectUrl = args.projectUrl ?? manifest.claudeProjectUrl;
  if (!projectUrl) {
    throw new Error(
      `No Claude Design project URL on record for ${args.loopId}. Pass --project-url=<url>, or run \`design-loop submit ${args.loopId}\` if you haven't started a session yet.`
    );
  }
  const authPaths = resolveAuthPaths2(config);
  if (!existsSync12(authPaths.storageState)) {
    throw new Error(
      `No saved Claude Design auth at ${authPaths.storageState}. Run \`design-loop login\` first.`
    );
  }
  const wantInteractive = !args.noInteractive && process.stdin.isTTY === true && args.headed === true;
  console.log(`[resume] loop=${args.loopId} interactive=${wantInteractive}`);
  if (args.noInteractive !== true && args.headed !== true) {
    console.log(
      "[resume] --headed not set; running non-interactive (exits after first design settle)."
    );
  }
  const result = await resumeReview({
    authPaths,
    projectUrl,
    headed: args.headed,
    review: wantInteractive ? buildReviewHook2() : void 0
  });
  if (result.projectUrl !== manifest.claudeProjectUrl) {
    manifest.claudeProjectUrl = result.projectUrl;
    writeManifest(paths, manifest);
  }
  let pulled = false;
  let applied = false;
  let translatedFiles = [];
  if (result.bundleUrl) {
    console.log(`[resume] bundle URL: ${result.bundleUrl}`);
    console.log("[resume] expanding bundle locally ...");
    await runPull({
      config: args.config,
      rootDir: args.rootDir,
      loopId: args.loopId,
      bundleSource: result.bundleUrl
    });
    pulled = true;
    if (!args.noApply) {
      try {
        console.log("[resume] translating bundle to framework scaffolds ...");
        const applyResult = await runApply({
          config: args.config,
          rootDir: args.rootDir,
          loopId: args.loopId,
          silent: true
        });
        applied = true;
        translatedFiles = applyResult.translatedFiles;
      } catch (err) {
        console.warn(
          `[resume] apply step failed (continuing \u2014 bundle is still pulled): ${err.message}`
        );
      }
    }
  }
  let promptResult = null;
  if (applied && translatedFiles.length) {
    try {
      promptResult = await writeCursorPrompt({
        config: args.config,
        rootDir: args.rootDir,
        loopId: args.loopId,
        translatedFiles
      });
    } catch (err) {
      console.warn(`[resume] could not build Cursor prompt: ${err.message}`);
    }
  }
  await printNextSteps2(
    args.loopId,
    result.projectUrl,
    pulled,
    applied,
    translatedFiles,
    promptResult,
    !args.noInteractive
  );
  return {
    projectUrl: result.projectUrl,
    bundleUrl: result.bundleUrl,
    pulled,
    applied,
    translatedFiles
  };
}
function buildReviewHook2() {
  return async (ctx) => {
    if (ctx.settleCount === 1) {
      console.log("");
      console.log("  \u2726 Resumed Claude Design session.");
      console.log(`  \u2726 Project URL: ${ctx.projectUrl}`);
      if (ctx.claudeBusy) {
        console.log("  \u26A0 Claude appears to be actively working right now.");
        console.log("  \u26A0 Pick [w] to wait for it to finish before fetching,");
        console.log("  \u26A0 or [f] now to grab whatever is currently in the canvas.");
      } else {
        console.log("  \u2726 Design appears settled \u2014 pick [f] to bring it home,");
        console.log("  \u2726 or [w] to keep iterating with Claude in the browser.");
      }
    } else {
      console.log("");
      console.log(`  \u2726 Round ${ctx.settleCount} settled. What now?`);
    }
    while (true) {
      const key = await promptChoice({
        question: "What next?",
        choices: [
          { key: "f", label: "Fetch \u2014 Share \u2192 Handoff in this browser, then pull bundle" },
          { key: "w", label: "Wait \u2014 keep iterating in Claude Design (no timeout)" },
          { key: "u", label: "URL \u2014 print the project URL again" },
          { key: "q", label: "Quit \u2014 close browser without fetching" }
        ]
      });
      if (key === "u") {
        console.log(`  Project URL: ${ctx.projectUrl}`);
        continue;
      }
      if (key === "f" || key === "w" || key === "q") {
        return { action: key === "f" ? "fetch" : key === "w" ? "wait" : "quit" };
      }
    }
  };
}
async function printNextSteps2(loopId, projectUrl, pulled, applied, translatedFiles, promptResult, interactive) {
  console.log("");
  if (applied) {
    console.log("  \u2726 Done. Bundle pulled, scaffolds written:");
    for (const f of translatedFiles) console.log(`      ${f}`);
    console.log("");
    if (promptResult) {
      await offerClipboardCopy(promptResult, { interactive });
    } else {
      console.log("  Next: open Cursor chat and ask it to merge the scaffold into the live route.");
    }
    console.log("");
    console.log(`  Verify: design-loop verify ${loopId}`);
  } else if (pulled) {
    console.log("  Bundle pulled (apply skipped or failed). Inspect at:");
    console.log(`    design-loops/${loopId}/bundle/`);
    console.log("  Re-run apply manually:");
    console.log(`    design-loop apply ${loopId}`);
  } else {
    console.log("  Project still alive on Anthropic's side:");
    console.log(`    ${projectUrl}`);
    console.log(`    design-loop resume ${loopId} --headed   # to come back later`);
    console.log(`    design-loop fetch  ${loopId}            # to auto-handoff without iterating`);
  }
  console.log("");
}
function resolveAuthPaths2(config) {
  const fallback = defaultAuthPaths();
  if (!config.storageState) return fallback;
  return {
    storageState: config.storageState,
    profileDir: fallback.profileDir
  };
}

// src/lib/fetch.ts
import { existsSync as existsSync13 } from "fs";
import { resolve as resolve14 } from "path";
async function runFetch(args) {
  const config = withDefaults(args.config);
  const loopsRoot = resolve14(args.rootDir, config.loopsDir);
  const paths = loopPaths(loopsRoot, args.loopId);
  if (!existsSync13(paths.manifestPath)) {
    throw new Error(`Loop ${args.loopId} not found at ${paths.root}.`);
  }
  const lock = acquireLock(loopsRoot, {
    command: "fetch",
    loopId: args.loopId
  });
  try {
    return await runFetchInner(args, config, paths);
  } finally {
    lock.release();
  }
}
async function runFetchInner(args, config, paths) {
  const manifest = readManifest(paths);
  const projectUrl = args.projectUrl ?? manifest.claudeProjectUrl;
  if (!projectUrl) {
    throw new Error(
      `No Claude Design project URL on record for ${args.loopId}. Pass --project-url=<url>, or run \`design-loop submit ${args.loopId}\` first to create + save the project.`
    );
  }
  const authPaths = resolveAuthPaths3(config);
  if (!existsSync13(authPaths.storageState)) {
    throw new Error(
      `No saved Claude Design auth at ${authPaths.storageState}. Run \`design-loop login\` first.`
    );
  }
  console.log(`[fetch] opening ${projectUrl} ...`);
  const bundleUrl = await fetchHandoffBundleUrl({
    authPaths,
    projectUrl,
    headed: args.headed
  });
  console.log(`[fetch] captured handoff bundle: ${bundleUrl}`);
  if (args.noPull) {
    console.log(`[fetch] --no-pull set. Run pull manually:`);
    console.log(`    design-loop pull ${args.loopId} --bundle-url=${bundleUrl}`);
    return {
      projectUrl,
      bundleUrl,
      pulled: false,
      applied: false,
      translatedFiles: []
    };
  }
  await runPull({
    config: args.config,
    rootDir: args.rootDir,
    loopId: args.loopId,
    bundleSource: bundleUrl
  });
  let applied = false;
  let translatedFiles = [];
  if (!args.noApply) {
    try {
      console.log("[fetch] translating bundle to framework scaffolds ...");
      const applyResult = await runApply({
        config: args.config,
        rootDir: args.rootDir,
        loopId: args.loopId,
        silent: true
      });
      applied = true;
      translatedFiles = applyResult.translatedFiles;
    } catch (err) {
      console.warn(
        `[fetch] apply step failed (continuing \u2014 bundle is still pulled): ${err.message}`
      );
    }
  }
  console.log("");
  if (applied) {
    console.log("  \u2726 Done. Bundle pulled, scaffolds written:");
    for (const f of translatedFiles) console.log(`      ${f}`);
    let promptResult = null;
    try {
      promptResult = await writeCursorPrompt({
        config: args.config,
        rootDir: args.rootDir,
        loopId: args.loopId,
        translatedFiles
      });
    } catch (err) {
      console.warn(`[fetch] could not build Cursor prompt: ${err.message}`);
    }
    console.log("");
    if (promptResult) {
      await offerClipboardCopy(promptResult, { interactive: true });
    } else {
      console.log("  Next: open Cursor chat and ask it to merge the scaffold into the live route.");
    }
    console.log("");
    console.log(`  Verify: design-loop verify ${args.loopId}`);
  } else {
    console.log("  Bundle pulled. Re-run apply manually if needed:");
    console.log(`      design-loop apply ${args.loopId}`);
  }
  console.log("");
  return { projectUrl, bundleUrl, pulled: true, applied, translatedFiles };
}
function resolveAuthPaths3(config) {
  const fallback = defaultAuthPaths();
  if (!config.storageState) return fallback;
  return {
    storageState: config.storageState,
    profileDir: fallback.profileDir
  };
}

// src/lib/wizard.ts
import { existsSync as existsSync14, readFileSync as readFileSync9, readdirSync as readdirSync7 } from "fs";
import { resolve as resolve15 } from "path";
async function runWizard(args) {
  const config = withDefaults(args.config);
  const loopsRoot = resolve15(args.rootDir, config.loopsDir);
  banner("design-loop", "Cursor \u21C4 Claude Design");
  await ensureNoActiveSession(loopsRoot);
  const resumable = listResumableLoops(loopsRoot);
  let mode = "new";
  if (resumable.length > 0) {
    section("What are we doing?");
    mode = await promptList({
      question: "Pick an action:",
      items: [
        { label: "Start a new design", value: "new" },
        {
          label: `Resume an in-progress design`,
          hint: `${resumable.length} saved`,
          value: "resume"
        }
      ],
      defaultIndex: 0
    });
  }
  if (mode === "resume") {
    await runResumeFlow({
      config: args.config,
      rootDir: args.rootDir,
      headed: args.headed ?? true,
      resumable
    });
    return;
  }
  await runNewFlow({
    config: args.config,
    rootDir: args.rootDir,
    headed: args.headed ?? true
  });
}
async function runNewFlow(args) {
  const config = withDefaults(args.config);
  section("Pick a route");
  const route = await pickRoute(args.config, args.rootDir);
  if (!route) {
    warn("No routes found. Check `routesDir` in your design-loop config.");
    return;
  }
  section("Pick a design system");
  const designSystem = await pickDesignSystem2(args.config);
  section("Set the intent (optional)");
  hint("One short line about what you're optimizing for. Press Enter to skip.");
  const intent = await promptText({
    question: "Intent",
    default: ""
  });
  section("Name the Claude Design project");
  const defaultName = prettyProjectName(route);
  const projectName = await promptText({
    question: "Project name",
    default: defaultName,
    hint: "Press Enter to accept the default."
  });
  section("Ready to go");
  kvBlock([
    ["Route", route],
    ["Design system", designSystem.name],
    intent ? ["Intent", intent] : null,
    ["Project name", projectName],
    ["Design system id", designSystem.id ?? colors.yellow("(missing \u2014 submit will fail)")],
    ["Framework", config.framework],
    ["Dev URL", `${config.devUrl}${route === "/" ? "" : route}`]
  ]);
  line();
  const proceed = await promptYesNo({
    question: "Run brief + open Claude Design now?",
    defaultYes: true
  });
  if (!proceed) {
    hint("Aborted. Nothing was written.");
    return;
  }
  let lock;
  try {
    lock = acquireLock(loopsRootOf(args), { command: "wizard:new" });
  } catch (err) {
    if (err instanceof LockHeldError) {
      error(err.message);
      return;
    }
    throw err;
  }
  try {
    section("Capturing the route");
    const brief = await runBrief({
      config: args.config,
      rootDir: args.rootDir,
      route,
      intent: intent || void 0,
      designSystem
    });
    success(`Brief written: ${brief.briefPath}`);
    section("Driving Claude Design");
    await runSubmit({
      config: args.config,
      rootDir: args.rootDir,
      loopId: brief.loopId,
      headed: args.headed,
      projectName
      // `submit` will print its own merge handoff once a [f]etch lands.
    });
  } finally {
    lock.release();
  }
}
async function runResumeFlow(args) {
  if (args.resumable.length === 0) {
    warn("No in-progress designs to resume.");
    return;
  }
  section("Pick a design to resume");
  const items = args.resumable.map((r) => ({
    label: `${colors.bold(r.manifest.route)}  ${colors.dim(r.id)}`,
    hint: `${formatAge(r.manifest.createdAt)} \xB7 ${r.manifest.designSystem.name}`,
    value: r
  }));
  const choice = await promptList({
    question: "Which loop?",
    items,
    defaultIndex: 0
  });
  const proceed = await promptYesNo({
    question: `Re-open ${colors.bold(choice.manifest.route)} in Claude Design?`,
    defaultYes: true
  });
  if (!proceed) {
    hint("Aborted.");
    return;
  }
  let lock;
  try {
    lock = acquireLock(loopsRootOf(args), {
      command: "wizard:resume",
      loopId: choice.id
    });
  } catch (err) {
    if (err instanceof LockHeldError) {
      error(err.message);
      return;
    }
    throw err;
  }
  try {
    await runResume({
      config: args.config,
      rootDir: args.rootDir,
      loopId: choice.id,
      headed: args.headed
    });
  } finally {
    lock.release();
  }
}
async function pickRoute(config, rootDir) {
  const adapter = getAdapter(config.framework);
  const routesDir = resolve15(rootDir, config.routesDir);
  let discovered = [];
  try {
    discovered = await adapter.discoverRoutes({
      routesDir,
      exclude: config.excludeRoutes ?? []
    });
  } catch (err) {
    warn(`Route discovery failed: ${err.message}`);
  }
  if (discovered.length === 0) {
    hint("No routes auto-discovered. Type the route path manually.");
    const typed2 = await promptText({
      question: "Route",
      default: "/"
    });
    return typed2 || "/";
  }
  const items = [
    ...discovered.map((r) => ({
      label: r.path,
      hint: r.dynamic ? colors.yellow("dynamic \u2014 needs a real value") : void 0,
      value: r.path
    })),
    { label: colors.dim("Type a custom route\u2026"), value: "__custom__" }
  ];
  const picked = await promptList({
    question: "Routes (default = first):",
    items,
    defaultIndex: 0
  });
  if (picked !== "__custom__") return picked;
  const typed = await promptText({
    question: "Custom route",
    default: "/",
    hint: "e.g. /canonical/abc123 \u2014 fill in dynamic params"
  });
  return typed || "/";
}
async function pickDesignSystem2(config) {
  const systems = getDesignSystems(config);
  let chosen;
  if (systems.length === 1) {
    chosen = systems[0];
    bullet(`Using ${colors.bold(chosen.name)} (only design system in config)`);
  } else {
    const items = systems.map((s) => ({
      label: s.name,
      hint: s.id ? colors.dim(s.id) : colors.yellow("no id \u2014 pick to look it up"),
      value: s
    }));
    chosen = await promptList({
      question: "Design system (default = first):",
      items,
      defaultIndex: 0
    });
  }
  if (chosen.id) return chosen;
  warn(`"${chosen.name}" has no id in config.`);
  const lookup = await promptYesNo({
    question: "Look up the id from claude.ai/design now?",
    defaultYes: true
  });
  if (!lookup) {
    throw new Error(
      `Cannot submit without a design-system id. Add an \`id\` for "${chosen.name}" in your .design-loop.config.ts (or run \`design-loop systems\` to see all available ids).`
    );
  }
  bullet("Opening claude.ai/design to scrape design-system ids\u2026");
  const discovered = await listDesignSystems({ authPaths: defaultAuthPaths(), headed: false });
  const match = discovered.find(
    (d) => d.name.toLowerCase() === chosen.name.toLowerCase()
  );
  if (!match) {
    throw new Error(
      `No design system named "${chosen.name}" exists on your claude.ai/design account.
  Available: ${discovered.map((d) => `"${d.name}"`).join(", ")}
  Fix: edit .design-loop.config.ts to use one of the names above (and its id), or remove this entry.
  Tip: \`design-loop systems\` shows the full list with ids.`
    );
  }
  success(`Resolved "${match.name}" \u2192 ${colors.cyan(match.id)}`);
  hint(
    `Tip: paste this id into your .design-loop.config.ts so future runs skip the lookup.`
  );
  return { ...chosen, id: match.id };
}
async function ensureNoActiveSession(loopsRoot) {
  const status = checkLock(loopsRoot);
  if (!status.active) return;
  if (!status.alive) {
    return;
  }
  warn("Another design-loop session is already running:");
  printLockInfo(status.info);
  line();
  const force = await promptYesNo({
    question: "Force-unlock and continue anyway?",
    defaultYes: false
  });
  if (!force) {
    hint("Exiting. Wait for the other session to finish, or kill it first.");
    process.exit(1);
  }
  warn("Continuing despite active lock \u2014 hope you know what you're doing.");
}
function printLockInfo(info) {
  if (!info) {
    hint("  (lock file unreadable \u2014 likely garbage)");
    return;
  }
  kvBlock([
    ["pid", info.pid],
    ["started", info.startedAt],
    ["command", info.command],
    info.loopId ? ["loop", info.loopId] : null
  ]);
}
function listResumableLoops(loopsRoot) {
  if (!existsSync14(loopsRoot)) return [];
  const out = [];
  for (const entry of readdirSync7(loopsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith(".")) continue;
    const paths = loopPaths(loopsRoot, entry.name);
    if (!existsSync14(paths.manifestPath)) continue;
    let manifest;
    try {
      manifest = JSON.parse(readFileSync9(paths.manifestPath, "utf8"));
    } catch {
      continue;
    }
    if (!manifest.claudeProjectUrl) continue;
    if (manifest.apply) continue;
    out.push({ id: entry.name, paths, manifest });
  }
  out.sort((a, b) => b.manifest.createdAt.localeCompare(a.manifest.createdAt));
  return out;
}
function formatAge(iso) {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return iso;
  const diffMs = Date.now() - then;
  const mins = Math.floor(diffMs / 6e4);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
function loopsRootOf(args) {
  const config = withDefaults(args.config);
  return resolve15(args.rootDir, config.loopsDir);
}
export {
  defaultAuthPaths,
  defineConfig,
  getDefaultDesignSystem,
  getDesignSystems,
  listDesignSystems,
  loadConfig,
  loginInteractive,
  runApply,
  runBrief,
  runFetch,
  runPull,
  runResume,
  runSubmit,
  runVerify,
  runWizard
};
//# sourceMappingURL=index.js.map