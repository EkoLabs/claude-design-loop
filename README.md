# `@ekolabs/claude-design-loop`

> Round-trip design loop between your IDE and [claude.ai/design](https://claude.ai/design). Capture a route, send a brief, iterate visually with Claude, fetch the handoff bundle, translate it into framework-native scaffolds, and verify the result.

`claude-design-loop` automates the boring parts of design iteration with Claude:

- 📸 captures screenshots of a running route at multiple breakpoints,
- ✍️  drafts a short brief and uploads it + the screenshots into a fresh `claude.ai/design` project,
- 🪄  hands the canvas off to **you** for visual iteration (no time limit),
- 📦  on a single keypress, drives **Share → Handoff to Claude Code**, downloads the bundle, translates it into your framework's component shape, and prints a ready-to-paste prompt for your IDE,
- 🔁  resumes cleanly if the browser or terminal got killed mid-session.

Designed for teams that already use Cursor/Claude Code as their IDE and Claude Design as their UX surface — but the only hard dependency is Claude Design itself.

> **TL;DR**: do the [first-time setup](#first-time-setup) once. After that, **daily use is one command**: `pnpm design`. Follow the wizard.

---

## First-time setup

You only do these steps once per project (and once per machine for the auth + browser binary).

### 1. Install the package + Playwright

```bash
pnpm add -D github:EkoLabs/claude-design-loop playwright
pnpm exec playwright install chromium    # ~150MB, one-time per machine
```

`playwright` is a **peer dependency** — installed at the project level so you control the browser version. The package itself ships pre-built (the `prepare` lifecycle script runs `tsup` on install, so consumers always get a freshly built `dist/`).

### 2. Drop a config stub in your repo root

```bash
pnpm exec design-loop init
```

This writes a `.design-loop.config.ts` with sensible defaults. Open it and fill in:

- `framework` — `'svelte'` or `'html'`
- `devUrl` — your dev-server URL (e.g. `http://localhost:5173`)
- `routesDir` — where the wizard scans for routable files

Leave `designSystem.id` as an empty string for now — you'll fill it in step 4.

### 3. Sign in to `claude.ai/design`

```bash
pnpm exec design-loop login
```

A Chromium window opens. Log in normally, then close the window when prompted. Your session is persisted to `~/.config/design-loop/chromium-profile/` and reused on every subsequent run — the same Anthropic session you'd use in your normal browser is what's saved. No credentials are stored or transmitted by us. **Once per machine.**

### 4. Discover your team's design-system UUIDs

```bash
pnpm exec design-loop systems
```

This scrapes the New Project picker on `claude.ai/design` and prints every design system available to your account, with its UUID and a diff against your config. Paste the right ones into your `.design-loop.config.ts`'s `designSystem` array.

### 5. Add a script alias (recommended)

In your project's `package.json`:

```jsonc
"scripts": {
  "design": "design-loop"
}
```

Now you can run `pnpm design` instead of `pnpm exec design-loop`.

---

## Daily use

Make sure your dev server is running, then:

```bash
pnpm design
```

That's it. The interactive wizard:

1. checks for in-progress designs (offers to **resume** if any exist),
2. otherwise scans your `routesDir` and asks **which route** to send to Claude,
3. asks **which design system** if you have more than one,
4. takes an optional one-line **intent** (e.g. *"compress the header, surface stats first"*),
5. suggests a **project name**, captures screenshots, opens `claude.ai/design`, attaches everything, and sends the brief.

After the first design pass lands in the browser, your terminal becomes the controller:

```
What next?
  [f] Fetch — Share → Handoff in this browser, then pull bundle
  [w] Wait — keep iterating in Claude Design (no timeout)
  [u] URL — print the project URL again
  [q] Quit — close browser without fetching
>
```

Pick `[w]` to keep designing in the browser. Pick `[f]` when you're happy — the bundle is fetched, translated to framework-native scaffolds, and a `CURSOR_PROMPT.md` is dropped into the loop directory ready to paste into your IDE chat.

> **Got disconnected mid-session?** Just run `pnpm design` again. The wizard will offer to resume the in-flight design rather than starting fresh.

---

## Installation details

### Pinning a version

```bash
pnpm add -D github:EkoLabs/claude-design-loop#v0.1.0
```

Pin to a tag in shared environments to avoid surprise updates.

### Global install

If you want the bin available globally so you can drop the `pnpm exec` prefix:

```bash
pnpm add -g github:EkoLabs/claude-design-loop
design-loop --help
```

---

## Configuration

Drop a `.design-loop.config.ts` (or `.js` / `.mjs` / `.mts`) at your repo root:

```ts
import { defineConfig } from '@ekolabs/claude-design-loop';

export default defineConfig({
  framework: 'svelte',          // 'svelte' | 'html'
  devUrl: 'http://localhost:5173',
  routesDir: 'src/routes',
  excludeRoutes: ['/admin'],

  // Single ref OR an array (first = default; the wizard shows a picker
  // when there's more than one).
  designSystem: [
    { name: 'Eko Customer Tools Design System', id: 'e40685d3-...' },
    { name: 'Eko Design System',                id: '2d44a08e-...' },
  ],

  // Optional — paths to repo files attached as additional context to every
  // brief (markdown rendered + screenshotted). Use sparingly.
  contextSources: ['docs/DESIGN_SYSTEM.md'],

  loopsDir: 'design-loops',
  breakpoints: [1280, 768, 375],

  // Optional — wait for a selector to disappear before screenshotting
  // (e.g. a "Checking auth…" overlay).
  waitFor: {
    hidden: 'text=Checking auth',
    timeoutMs: 20_000,
  },
});
```

| Key | Required | Default | Notes |
|---|---|---|---|
| `framework` | yes | — | `'svelte'` or `'html'`. New adapters: see [`CONTRIBUTING.md`](./CONTRIBUTING.md). |
| `devUrl` | yes | — | URL of your running dev server. Routes are appended to it for capture. |
| `routesDir` | yes | — | Where the wizard scans for routable files. |
| `excludeRoutes` | no | `[]` | Hide these from the route picker. Prefix matches: `'/admin'` hides `/admin/*`. |
| `designSystem` | yes | — | Single `{ name, id }` or an array. The id is a UUID from `claude.ai/design`. Run `design-loop systems` to discover ids. |
| `loopsDir` | no | `'design-loops'` | Where loop folders are written. |
| `breakpoints` | no | `[1280, 768, 375]` | Viewport widths captured for each brief (px). |
| `waitFor.hidden` | no | — | CSS / Playwright text selector that must disappear before capturing. |
| `waitFor.timeoutMs` | no | `20000` | How long to wait for the above selector. |
| `contextSources` | no | `[]` | Repo files attached as extra context. |

---

## CLI reference

| Command | What it does |
|---|---|
| `design-loop` *(no args)* | Interactive wizard. Recommended entry point. |
| `design-loop init` | Drop a `.design-loop.config.ts` stub in the current directory. |
| `design-loop login` | Open `claude.ai/design` so you can log in once. Session is persisted. |
| `design-loop systems` | List every design system on your account with its UUID + diff against your config. |
| `design-loop brief <route>` | Capture a route's screenshots + write a brief. No browser automation. |
| `design-loop submit <loopId> [--headed]` | Open a fresh project in `claude.ai/design`, attach screenshots, send the brief, and hand control to the interactive `[f]/[w]/[u]/[q]` review prompt. |
| `design-loop resume <loopId>` | Re-attach to an in-progress project (e.g. after a crash). Same review prompt. |
| `design-loop fetch <loopId>` | Drive Share → Handoff for a finished project, capture the bundle URL, run `pull`, then `apply`. |
| `design-loop pull <loopId> --bundle-url=<url>` | Expand a handoff bundle into the loop folder. |
| `design-loop apply <loopId>` | Translate the bundle into framework-native scaffolds. |
| `design-loop verify <loopId>` | Re-capture the route after apply and diff against the bundle. |
| `design-loop loop <route>` | Convenience: `brief` + `submit`, no wizard. Good for scripting. |

Most commands accept `--no-interactive` for CI usage. See `design-loop <cmd> --help` for full per-command flags.

---

## Concurrency

Every browser-driving command (`submit`, `resume`, `fetch`, the wizard) holds a per-repo lock at `<loopsDir>/.lock.json` while it's running. The lock records the pid, start time, and command. If you start a second session while one is live, you'll get a clear error pointing at the running pid. Stale locks (process gone) are cleaned up automatically. The wizard offers a force-unlock prompt for the rare case where the lock survives an unclean shutdown.

This guard exists because all sessions share **one** Chromium profile (so auth state survives between runs) — running two at once corrupts the profile and fights over auth.

---

## Loop directory layout

Each `brief` run creates one folder under `loopsDir/`:

```
design-loops/2026-05-15T14-16-34-489-root/
├── brief.md              ← short prose, sent to Claude Design
├── manifest.json         ← saves the project URL after submit (resume-safe)
├── inputs/
│   ├── screenshot-1280.png
│   ├── screenshot-768.png
│   ├── screenshot-375.png
│   └── dom.yaml          ← informational, not uploaded
├── bundle/               ← after `fetch` / `pull`
├── review-checklist.md   ← human ticks ✅/✗ here
└── output/               ← after `apply`
    ├── translated/       ← framework-native scaffolds
    ├── after/            ← after `verify`
    ├── CURSOR_PROMPT.md  ← ready-to-paste IDE prompt
    └── APPLY_SUMMARY.md  ← what was generated and why
```

---

## Programmatic API

You can drive the same primitives from your own scripts:

```ts
import {
  loadConfig,
  runBrief,
  runSubmit,
  runFetch,
  runApply,
} from '@ekolabs/claude-design-loop';

const { config, rootDir } = await loadConfig();

const { loopId } = await runBrief({
  config,
  rootDir,
  route: '/dashboard',
  intent: 'compress the header, show stats first',
});

await runSubmit({ config, rootDir, loopId, headed: true });
// User iterates in the browser, then quits via [q]
await runFetch({ config, rootDir, loopId });
await runApply({ config, rootDir, loopId });
```

Full type signatures live in [`dist/index.d.ts`](./dist/index.d.ts) (built; not committed) — or read [`src/index.ts`](./src/index.ts) directly.

---

## Troubleshooting

**"No saved Claude Design auth"** — run `design-loop login`. The browser will open to `claude.ai/design`; log in, then close the window when prompted.

**"Couldn't find the project picker"** — your saved session expired or Anthropic served a verification challenge. Rerun the failing command with `--headed` and solve any challenges manually; the script will continue once it sees the New Project form.

**"Another design-loop session is running (pid=…)"** — the lockfile says someone else is driving the browser. If you're sure that pid is dead, the wizard offers a force-unlock prompt (`y` to take over). Or delete `<loopsDir>/.lock.json` manually.

**"No design system named X exists on your claude.ai/design account"** — your config has a name that doesn't match anything Anthropic has published for your account. Run `design-loop systems` to see the actual names + ids and update your config.

**Bundle bundle is empty / `apply` produces nothing** — Anthropic's handoff sometimes ships only CSS + JSX with an empty `<body>`. The Svelte adapter handles this case (inlines CSS, copies JSX with a hint for the next agent). If you see truly empty output, open the bundle folder manually — `bundle/canvas.html` is the source of truth.

---

## License

Proprietary — Eko Labs internal use only. See [`LICENSE`](./LICENSE).
