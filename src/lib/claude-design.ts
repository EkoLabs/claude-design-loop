/**
 * claude.ai/design driver.
 *
 * Anthropic does not expose a public API for Claude Design. This module
 * drives the web UI with Playwright. It is intentionally selector-light —
 * everything goes through accessibility-tree roles + names, which are the
 * most stable surface across UI updates. When something does break, the
 * step that failed will throw a labeled error so the offending selector is
 * easy to find in this file.
 *
 * Important caveat: driving claude.ai with browser automation is TOS-adjacent.
 * Use this against your own account only, and don't run it at automation
 * scales. The package is meant for low-volume, single-user iteration loops.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  chromium,
  type BrowserContext,
  type Page,
} from 'playwright';

const DESIGN_HOME = 'https://claude.ai/design';
// Bundle URL Anthropic embeds in the Handoff-to-Claude-Code modal. The id is
// base64url-y; allow underscore + hyphen + alnum. We capture an optional
// `?open_file=<name>` so callers can resolve which file the bundle points at.
const HANDOFF_URL_PATTERN =
  /https:\/\/api\.anthropic\.com\/v1\/design\/h\/[A-Za-z0-9_-]+(?:\?open_file=[^\s)"<]+)?/;
// Fired by Claude Design when an artifact panel is open in the right pane.
const ARTIFACT_URL_PATTERN = /\?file=([^&]+\.(?:md|html|tsx|jsx|ts|js))/;

export interface AuthPaths {
  storageState: string;
  /** Persistent profile dir for headed-mode logins. */
  profileDir: string;
}

export function defaultAuthPaths(): AuthPaths {
  const root = join(homedir(), '.config', 'design-loop');
  return {
    storageState: join(root, 'auth.json'),
    profileDir: join(root, 'chromium-profile'),
  };
}

function ensureDir(path: string): void {
  mkdirSync(dirname(path), { recursive: true });
}

/**
 * Dump current page state to disk so a failed step can be diagnosed without
 * re-running the entire flow. Writes a screenshot + an aria snapshot to
 * `~/.config/design-loop/failures/`. Best-effort — never throws.
 *
 * The aria snapshot is the same shape Playwright uses internally and is the
 * most useful artifact for debugging selectors: it shows the full role+name
 * tree so we can pick a stable matcher without guessing at rendered HTML.
 */
async function dumpFailureState(page: Page, label: string): Promise<void> {
  try {
    const root = join(homedir(), '.config', 'design-loop', 'failures');
    mkdirSync(root, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const slug = label.replace(/[^a-z0-9-]+/gi, '_').slice(0, 40);
    const base = join(root, `${stamp}-${slug}`);
    const aria = await page.locator('body').ariaSnapshot().catch(() => '<aria snapshot failed>');
    writeFileSync(`${base}.aria.yaml`, aria, 'utf8');
    writeFileSync(`${base}.url.txt`, page.url(), 'utf8');
    await page.screenshot({ path: `${base}.png`, fullPage: false }).catch(() => {});
    console.error(`[submit] dumped failure state to ${base}.{aria.yaml,png,url.txt}`);
  } catch {
    // Never let the dump itself break the failure path.
  }
}

/**
 * Wrap a step so any thrown error gets a JIT DOM dump before it bubbles up.
 * The dump goes to `~/.config/design-loop/failures/` and includes the aria
 * snapshot, screenshot, and URL of the moment the step failed. Means we
 * never have to ask the user to paste DOM by hand again.
 */
async function withFailureDump<T>(
  page: Page,
  label: string,
  fn: () => Promise<T>,
): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    await dumpFailureState(page, label);
    throw err;
  }
}

/**
 * Open a headed browser, navigate to claude.ai/design, wait for the user to
 * log in and reach the project picker. Then save storage state.
 */
export async function loginInteractive(authPaths: AuthPaths): Promise<void> {
  ensureDir(authPaths.storageState);
  mkdirSync(authPaths.profileDir, { recursive: true });

  const context = await chromium.launchPersistentContext(authPaths.profileDir, {
    headless: false,
    viewport: { width: 1280, height: 900 },
    args: ['--disable-blink-features=AutomationControlled'],
  });
  try {
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto(DESIGN_HOME, { waitUntil: 'domcontentloaded' });
    console.log('[login] log in to claude.ai in the browser window.');
    console.log('[login] once you see the Claude Design project picker, return here.');
    console.log(
      '[login] waiting for "Design system" combobox or "Designs" tab to appear (timeout 5min)...',
    );
    // Use Promise.any so the first success wins, ignoring failures from the
    // other locator (e.g. "Designs" matching both "Designs" and "Your designs"
    // before exact:true narrowing). exact:true on the tab lookup avoids the
    // strict-mode collision.
    await Promise.any([
      page
        .getByRole('combobox', { name: 'Design system' })
        .waitFor({ timeout: 300_000 }),
      page
        .getByRole('tab', { name: 'Designs', exact: true })
        .waitFor({ timeout: 300_000 }),
    ]);
    await context.storageState({ path: authPaths.storageState });
    console.log(`[login] saved storage state to ${authPaths.storageState}`);
  } finally {
    await context.close();
  }
}

/**
 * Hook the caller can pass to `submitToClaudeDesign` to run an interactive
 * review loop while the browser is still open and the page is alive.
 *
 * The hook is invoked **after each "settle" event** — i.e. after Claude
 * has been quiet for a settle window long enough to consider the current
 * round done. The hook returns one of:
 *
 *   { action: 'wait' }    — we go back to monitoring; if Claude works
 *                           more (because the user prompted it from the
 *                           browser), the hook is invoked again on the
 *                           next settle. No timeout.
 *   { action: 'fetch' }   — we drive Share → Handoff in this same browser
 *                           context (more reliable than reopening the
 *                           project later) and return the bundle URL.
 *   { action: 'quit' }    — we close the browser without fetching.
 *
 * If no hook is provided (e.g. headless / CI), the function returns after
 * the first settle as before.
 */
export type ReviewAction = 'wait' | 'fetch' | 'quit';

export interface ReviewContext {
  projectUrl: string;
  /** 1 the first time the hook is invoked, increments on each re-settle. */
  settleCount: number;
  /**
   * `true` if activity verbs were visible at the moment we invoked the
   * hook. After a normal settle, this is always `false` (settle = no
   * activity for 60s). With `skipFirstSettle` (resume), this can be
   * `true` — letting the hook warn the user before they pick `[f]` and
   * get a partial bundle.
   */
  claudeBusy: boolean;
}

export type ReviewHook = (
  ctx: ReviewContext,
) => Promise<{ action: ReviewAction }>;

export interface SubmitOptions {
  authPaths: AuthPaths;
  /** UUID from the design-system combobox. Set in `.design-loop.config.ts`. */
  designSystemId: string;
  /** Display name for the project. Defaults to the loop id. */
  projectName: string;
  /** Path to brief.md — its content is pasted into the chat. */
  briefPath: string;
  /** Local files (screenshots, attachments) to upload alongside the prompt. */
  attachmentPaths: string[];
  /**
   * Wireframe is cheaper/faster but produces noticeably less useful output
   * for our review flow. We default to high-fidelity but allow override
   * for power users who want a quick sketch.
   */
  fidelity: 'wireframe' | 'high-fidelity';
  /** Run with a visible browser. Useful for first-time debugging. */
  headed?: boolean;
  /**
   * Optional interactive hook. See `ReviewHook` JSDoc above. When omitted,
   * the function exits after the first settle (suitable for headless runs).
   */
  review?: ReviewHook;
  /**
   * Called as soon as the canvas has loaded (`/design/p/<uuid>` URL is
   * known) — long before the design has rendered. Use this to persist
   * the project URL immediately so a later `resume` works even if the
   * user interrupts the review with Ctrl+C / browser-close / power loss.
   */
  onCanvasOpened?: (projectUrl: string) => void | Promise<void>;
}

export interface SubmitResult {
  /** URL of the project that was created — for human review/iteration. */
  projectUrl: string;
  /** Set if the interactive hook returned `{ action: 'fetch' }` and the
   * Share → Handoff flow succeeded in-session. */
  bundleUrl: string | null;
}

/**
 * Open Claude Design, create a project, attach screenshots, send the brief,
 * wait for the design to settle, then optionally hand control to a human
 * review hook (which can iterate further or trigger handoff). The hook
 * keeps the browser alive — there is no timeout on the review phase.
 *
 * If no review hook is provided, the function returns after the first
 * settle event.
 */
export async function submitToClaudeDesign(opts: SubmitOptions): Promise<SubmitResult> {
  const headless = !opts.headed;
  mkdirSync(opts.authPaths.profileDir, { recursive: true });
  const context = await chromium.launchPersistentContext(opts.authPaths.profileDir, {
    headless,
    viewport: { width: 1280, height: 900 },
    args: ['--disable-blink-features=AutomationControlled'],
  });
  try {
    return await driveSubmit(context, opts);
  } finally {
    await context.close();
  }
}

async function driveSubmit(
  context: BrowserContext,
  opts: SubmitOptions,
): Promise<SubmitResult> {
  const existing = context.pages()[0];
  const page = existing ?? (await context.newPage());

  // Watch for handoff URLs throughout the session — the modal sometimes
  // races and we want the listener installed before the click happens.
  const networkUrls = new Set<string>();
  page.on('request', (req) => {
    if (HANDOFF_URL_PATTERN.test(req.url())) networkUrls.add(req.url());
  });
  page.on('response', (res) => {
    if (HANDOFF_URL_PATTERN.test(res.url())) networkUrls.add(res.url());
  });

  console.log('[submit] opening claude.ai/design ...');
  await page.goto(DESIGN_HOME, { waitUntil: 'domcontentloaded' });

  await withFailureDump(page, 'assert-logged-in', () =>
    assertLoggedIn(page, opts.headed === true),
  );
  await withFailureDump(page, 'fill-new-project', () =>
    fillNewProject(page, opts),
  );
  await withFailureDump(page, 'upload-attachments', () =>
    uploadAttachments(page, opts.attachmentPaths),
  );
  await withFailureDump(page, 'send-brief', () =>
    sendBrief(page, opts.briefPath),
  );

  const projectUrl = page.url();
  console.log(`[submit] design in flight at ${projectUrl}`);

  // Phase 1: wait for first activity. Soft check — if we don't see any
  // verbs in 90s, warn but continue (in interactive mode the user can
  // see the browser and decide). In headless mode, throw.
  console.log('[submit] waiting for Claude to start designing ...');
  const started = await waitForFirstActivity(page);
  if (!started) {
    if (!opts.review) {
      throw new Error(
        `Claude Design did not start working within 90s of sending the brief. No activity verbs (${ACTIVITY_VERBS.slice(0, 5).join(', ')}, ...) appeared. The submission may have been rejected (rate limit, file size, model pick).`,
      );
    }
    console.warn(
      '[submit] no activity verbs detected in 90s. The browser is still open — check the page and decide.',
    );
  }

  // Phase 2: settle/review loop. Shared with `resumeReview` so picking up
  // an abandoned session reuses the exact same UX.
  const bundleUrl = await runSettleReviewLoop(page, networkUrls, opts.review);
  return { projectUrl, bundleUrl };
}

/**
 * Settle/review loop, extracted so both `submitToClaudeDesign` (fresh
 * project) and `resumeReview` (existing project) share identical UX.
 *
 * For each round Claude works → settles, we either:
 *   - call the review hook and act on its decision (fetch / wait / quit), or
 *   - exit immediately if no hook was provided (single-pass / non-interactive).
 *
 * `skipFirstSettle` is for the resume path: when picking up an existing
 * project, the design might already be done — there's no reason to wait
 * for an artificial settle window before prompting. We probe activity
 * once, hand the (possibly busy) state to the hook, and let the user
 * decide whether to fetch immediately or [w]ait for more iteration. On
 * subsequent rounds (after [w]), the normal settle flow applies.
 *
 * Returns the bundle URL when the user picked 'fetch' and the in-session
 * handoff succeeded, otherwise null.
 */
async function runSettleReviewLoop(
  page: Page,
  networkUrls: Set<string>,
  review: ReviewHook | undefined,
  options: { skipFirstSettle?: boolean } = {},
): Promise<string | null> {
  let bundleUrl: string | null = null;
  let settleCount = 0;
  let isFirst = true;

  while (true) {
    let claudeBusy = false;

    if (isFirst && options.skipFirstSettle) {
      // Skip the wait entirely — prompt now. Probe current state so the
      // hook knows whether Claude looks busy.
      const probeText =
        (await page.locator('body').innerText().catch(() => '')) ?? '';
      claudeBusy = findLatestActivity(probeText) !== null;
      if (claudeBusy) {
        console.log('[claude] activity in flight — prompting anyway (resume).');
      } else {
        console.log('[claude] no activity detected — design appears settled.');
      }
    } else {
      const settled = await waitForActivitySettle(page);
      if (!settled) break; // page closed underneath us
      // After waitForActivitySettle, by definition no activity is in flight.
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
      claudeBusy,
    });
    if (decision.action === 'quit') break;
    if (decision.action === 'fetch') {
      console.log('[submit] driving Share → Handoff to Claude Code in-session ...');
      bundleUrl = await withFailureDump(page, 'in-session-handoff', () =>
        triggerHandoff(page, networkUrls),
      );
      break;
    }
    // action === 'wait' — go back around. The next iteration will hit
    // waitForActivitySettle (regardless of skipFirstSettle), so the user
    // gets re-prompted only when there's something new to decide on.
    console.log('[submit] watching for more activity. Iterate in the browser as much as you want.');
  }

  return bundleUrl;
}

/**
 * Resume an existing Claude Design project — same interactive review UX
 * as a fresh submit, but without recreating the project / re-uploading /
 * re-sending the brief. Use this after `submit --headed` was interrupted
 * (browser closed, terminal closed, network blip, etc) and you don't want
 * to lose the design work that's already on the server.
 *
 * The flow:
 *   1. Open the persistent profile (same auth as submit).
 *   2. Navigate to the saved project URL.
 *   3. Wait for the canvas/chat to be ready.
 *   4. Enter the settle/review loop. If Claude was mid-generation when
 *      the previous session was killed, we'll observe activity and let it
 *      finish; if it was already settled, the user gets prompted right
 *      away.
 */
export interface ResumeOptions {
  authPaths: AuthPaths;
  projectUrl: string;
  headed?: boolean;
  review?: ReviewHook;
}

export interface ResumeResult {
  projectUrl: string;
  bundleUrl: string | null;
}

export async function resumeReview(opts: ResumeOptions): Promise<ResumeResult> {
  const headless = !opts.headed;
  mkdirSync(opts.authPaths.profileDir, { recursive: true });
  const context = await chromium.launchPersistentContext(opts.authPaths.profileDir, {
    headless,
    viewport: { width: 1280, height: 900 },
    args: ['--disable-blink-features=AutomationControlled'],
  });
  try {
    const existing = context.pages()[0];
    const page = existing ?? (await context.newPage());

    const networkUrls = new Set<string>();
    page.on('request', (req) => {
      if (HANDOFF_URL_PATTERN.test(req.url())) networkUrls.add(req.url());
    });
    page.on('response', (res) => {
      if (HANDOFF_URL_PATTERN.test(res.url())) networkUrls.add(res.url());
    });

    console.log(`[resume] opening ${opts.projectUrl} ...`);
    await page.goto(opts.projectUrl, { waitUntil: 'domcontentloaded' });

    await withFailureDump(page, 'resume-canvas-ready', async () => {
      // Either the chat input or the Share button confirms the project
      // canvas loaded. Whichever shows up first wins.
      await Promise.any([
        page
          .getByRole('textbox', { name: /describe what you want to create/i })
          .waitFor({ timeout: 30_000 }),
        page.getByRole('button', { name: 'Share' }).waitFor({ timeout: 30_000 }),
      ]);
    });

    console.log('[resume] project ready. Prompting immediately ...');
    // skipFirstSettle=true: when resuming, the design might already be
    // done; we shouldn't force a 60s settle wait before letting the user
    // pick [f]etch. The hook gets `claudeBusy` to warn the user if Claude
    // happens to still be working in the background.
    const bundleUrl = await runSettleReviewLoop(
      page,
      networkUrls,
      opts.review,
      { skipFirstSettle: true },
    );
    return { projectUrl: page.url(), bundleUrl };
  } finally {
    await context.close();
  }
}

/**
 * Read every design system available to the logged-in user, with both
 * display name and UUID. Drives the same project picker used by `submit`,
 * just expands the design-system combobox and scrapes its options.
 *
 * Used by `design-loop systems` to fill in `id`s for design systems the
 * user pasted into config without one (or just to discover what's
 * available).
 */
export interface ListDesignSystemsOptions {
  authPaths: AuthPaths;
  headed?: boolean;
}

export interface DiscoveredDesignSystem {
  name: string;
  id: string;
}

export async function listDesignSystems(
  opts: ListDesignSystemsOptions,
): Promise<DiscoveredDesignSystem[]> {
  const headless = !opts.headed;
  mkdirSync(opts.authPaths.profileDir, { recursive: true });
  const context = await chromium.launchPersistentContext(opts.authPaths.profileDir, {
    headless,
    viewport: { width: 1280, height: 900 },
    args: ['--disable-blink-features=AutomationControlled'],
  });
  try {
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto(DESIGN_HOME, { waitUntil: 'domcontentloaded' });
    await assertLoggedIn(page, opts.headed === true);
    return await scrapeDesignSystems(page);
  } finally {
    await context.close();
  }
}

async function scrapeDesignSystems(page: Page): Promise<DiscoveredDesignSystem[]> {
  const combo = page.getByRole('combobox', { name: 'Design system' });
  await combo.waitFor({ timeout: 30_000 });

  // Path 1: native <select>. Fastest + most reliable when it works.
  // We DOM-query because Playwright's evaluation context gives us
  // direct access to <option> nodes.
  const native = await combo.evaluate((el) => {
    if (!(el instanceof HTMLSelectElement)) return null;
    return Array.from(el.options).map((o) => ({
      name: o.label || o.textContent?.trim() || '',
      id: o.value,
    }));
  });
  if (native && native.length) {
    return native.filter((s) => s.id);
  }

  // Path 2: custom widget — open the menu, scrape role=option entries.
  await combo.click();
  // Anthropic uses a portal'd listbox; query globally.
  const options = page.locator('[role=option]');
  await options.first().waitFor({ timeout: 5_000 });
  const count = await options.count();
  const out: DiscoveredDesignSystem[] = [];
  for (let i = 0; i < count; i++) {
    const opt = options.nth(i);
    const id =
      (await opt.getAttribute('data-value')) ??
      (await opt.getAttribute('value')) ??
      '';
    const name = (await opt.innerText()).trim();
    if (id && name) out.push({ name, id });
  }
  // Close the menu so we leave the page in a clean state.
  await page.keyboard.press('Escape').catch(() => {});
  return out;
}

/**
 * Open an existing Claude Design project and capture the Handoff bundle URL
 * via Share → Handoff to Claude Code. Used by the `fetch` command after
 * the human has reviewed/iterated on the design and is ready to bring it
 * back into Cursor.
 */
export interface FetchHandoffOptions {
  authPaths: AuthPaths;
  /** Full project URL, e.g. https://claude.ai/design/p/<uuid> */
  projectUrl: string;
  headed?: boolean;
}

export async function fetchHandoffBundleUrl(
  opts: FetchHandoffOptions,
): Promise<string> {
  const headless = !opts.headed;
  mkdirSync(opts.authPaths.profileDir, { recursive: true });
  const context = await chromium.launchPersistentContext(opts.authPaths.profileDir, {
    headless,
    viewport: { width: 1280, height: 900 },
    args: ['--disable-blink-features=AutomationControlled'],
  });
  try {
    const existing = context.pages()[0];
    const page = existing ?? (await context.newPage());
    const networkUrls = new Set<string>();
    page.on('request', (req) => {
      if (HANDOFF_URL_PATTERN.test(req.url())) networkUrls.add(req.url());
    });
    page.on('response', (res) => {
      if (HANDOFF_URL_PATTERN.test(res.url())) networkUrls.add(res.url());
    });

    await page.goto(opts.projectUrl, { waitUntil: 'domcontentloaded' });
    await withFailureDump(page, 'fetch-assert-canvas', async () => {
      // Wait for either the canvas chat input or the artifact pane — both
      // confirm the project loaded correctly.
      await Promise.any([
        page
          .getByRole('textbox', { name: /describe what you want to create/i })
          .waitFor({ timeout: 30_000 }),
        page.getByRole('button', { name: 'Share' }).waitFor({ timeout: 30_000 }),
      ]);
    });

    const url = await withFailureDump(page, 'fetch-handoff', () =>
      triggerHandoff(page, networkUrls),
    );
    if (!url) {
      throw new Error(
        `Couldn't capture a handoff bundle URL from ${opts.projectUrl}. The Share menu opened but no api.anthropic.com/v1/design/h/... URL appeared in 90s. Run again with --headed and copy the URL manually from Share → Handoff to Claude Code.`,
      );
    }
    return url;
  } finally {
    await context.close();
  }
}

async function assertLoggedIn(page: Page, headed: boolean): Promise<void> {
  // The picker (logged in) shows a Design system combobox. The login wall
  // shows a Continue button or sign-in form. Anthropic also occasionally
  // throws up a human-verification challenge that takes a moment to resolve.
  // When running headed, give the user up to 5 minutes to handle that
  // manually. When headless, fail fast — no human is there to solve it.
  const timeout = headed ? 300_000 : 30_000;
  if (headed) {
    console.log(
      '[submit] waiting for project picker (up to 5 min). If you see a verification challenge, solve it in the browser — the script will continue automatically.',
    );
  }
  try {
    await page
      .getByRole('combobox', { name: 'Design system' })
      .waitFor({ timeout });
  } catch {
    throw new Error(
      "Couldn't find the Claude Design project picker. Either you're not logged in, the saved session expired, or a verification challenge wasn't solved in time.\n" +
        '\nFix: rerun with `--headed` and solve any prompts, or run `design-loop login` to refresh auth.',
    );
  }
}

async function fillNewProject(page: Page, opts: SubmitOptions): Promise<void> {
  console.log(`[submit] creating project "${opts.projectName}" ...`);
  const nameBox = page.getByRole('textbox', { name: 'Project name' });
  await nameBox.fill(opts.projectName);

  await pickDesignSystem(page, opts.designSystemId);

  await ensureFidelitySelected(page, opts.fidelity);

  const createBtn = createButtonLocator(page);
  // Wait for Create to become enabled — Playwright's auto-wait covers this,
  // but with a tighter timeout we get a clearer error if a step earlier
  // didn't take.
  await createBtn.click({ timeout: 10_000 });

  // Project URL becomes /design/p/<uuid> once the canvas is ready. This is a
  // more reliable readiness signal than waiting for the chat input alone,
  // because the picker shell stays mounted briefly while the canvas page
  // hydrates.
  await page.waitForURL(/\/design\/p\//, { timeout: 30_000 });
  await waitForChatInput(page);
  const projectUrl = page.url();
  console.log(`[submit] canvas opened: ${projectUrl}`);
  // Notify the caller as early as possible so a later `resume` can find
  // this project even if the run gets interrupted before the brief is
  // sent / before the design settles / before review completes.
  if (opts.onCanvasOpened) {
    try {
      await opts.onCanvasOpened(projectUrl);
    } catch (err) {
      console.warn(
        `[submit] onCanvasOpened callback threw (continuing anyway): ${(err as Error).message}`,
      );
    }
  }
}

/**
 * Locator for the new-project Create button. Anthropic ships a stable
 * data-testid here; we prefer it over role+name because the visible "+"
 * icon node and styled-components class hashes can confuse role-based
 * matchers across UI revisions.
 */
function createButtonLocator(page: Page): import('playwright').Locator {
  return page.locator('[data-testid="create-project-button"]');
}

/**
 * Locator for a fidelity card button. String matching is critical here —
 * the buttons render with an icon prefix that shows up as a leading space
 * in the raw accessible name (" Wireframe", " High fidelity"). Playwright
 * normalises whitespace for STRING names but anchored regexes break.
 */
function fidelityButtonLocator(
  page: Page,
  fidelity: 'wireframe' | 'high-fidelity',
): import('playwright').Locator {
  const name = fidelity === 'wireframe' ? 'Wireframe' : 'High fidelity';
  return page.getByRole('button', { name }).first();
}

/**
 * Fidelity selection. Observed behaviour of the new-project form
 * (May 2026): High fidelity is pre-selected as soon as the form mounts;
 * filling the project name + selecting a design system is enough to
 * enable Create. Clicking the already-selected fidelity DESELECTS it,
 * leaving Create disabled — that was the bug we kept hitting before.
 *
 * Strategy:
 *   - high-fidelity (default): no-op. Verify Create is enabled; if it's not,
 *     click High fidelity to select it.
 *   - wireframe: click Wireframe to switch from the Hi-Fi default. Verify.
 */
async function ensureFidelitySelected(
  page: Page,
  fidelity: 'wireframe' | 'high-fidelity',
): Promise<void> {
  const createBtn = createButtonLocator(page);

  // Give the form a beat to settle. Selecting the design system briefly
  // unmounts/remounts the fidelity row in some UI revisions.
  await page.waitForTimeout(250);

  if (fidelity === 'high-fidelity') {
    if (await createBtn.isEnabled().catch(() => false)) return;
    // Default wasn't applied for some reason — click to force-select.
    await fidelityButtonLocator(page, 'high-fidelity').click();
    await page.waitForTimeout(250);
    if (await createBtn.isEnabled().catch(() => false)) return;
    throw new Error(
      'Create stayed disabled after selecting High fidelity. The new-project form may require an additional field, or the fidelity buttons changed.',
    );
  }

  // Wireframe path: click to switch from the Hi-Fi default.
  await fidelityButtonLocator(page, 'wireframe').click();
  await page.waitForTimeout(250);
  if (await createBtn.isEnabled().catch(() => false)) return;
  // One re-click in case the button toggled off rather than swapped.
  await fidelityButtonLocator(page, 'wireframe').click();
  await page.waitForTimeout(250);
  if (await createBtn.isEnabled().catch(() => false)) return;
  throw new Error(
    'Create stayed disabled after selecting Wireframe. The new-project form may require an additional field, or the fidelity buttons changed.',
  );
}

/**
 * Select the configured design system. Tries the native <select> path first
 * (which is what the accessibility tree suggests), then falls back to a
 * custom-widget path: click to open, click the matching option.
 */
async function pickDesignSystem(page: Page, designSystemId: string): Promise<void> {
  const combo = page.getByRole('combobox', { name: 'Design system' });
  try {
    await combo.selectOption({ value: designSystemId });
    return;
  } catch {
    // Custom widget — open, then pick an option whose value attribute or text
    // contains the id. We can't easily match by id alone in a custom listbox,
    // so we look for an option whose accessible name corresponds to the id.
  }
  await combo.click();
  const optionByValue = page.locator(`[role=option][data-value="${designSystemId}"]`).first();
  if (await optionByValue.count()) {
    await optionByValue.click();
    return;
  }
  // Final fallback: open the menu, pick the first option whose value attribute
  // matches the id (some <select>-likes use <option value=...> directly).
  const optionElement = page.locator(`option[value="${designSystemId}"]`).first();
  if (await optionElement.count()) {
    await optionElement.click();
    return;
  }
  throw new Error(
    `Couldn't pick design system ${designSystemId}. Either the dropdown is custom and we need a selector tweak, or the id is wrong.\n` +
      `Inspect the dropdown in claude.ai/design and adjust pickDesignSystem in claude-design.ts.`,
  );
}

/**
 * Find the canvas chat composer. Confirmed accessible name on the Claude
 * Design canvas (May 2026): "Describe what you want to create...". The
 * artifact-comment box ("Add a comment...") is a different input we must
 * NOT match here, so we anchor on `describe`.
 *
 * Falls back to the contenteditable / textarea path if the name ever drifts.
 */
async function waitForChatInput(page: Page): Promise<import('playwright').Locator> {
  const primary = page.getByRole('textbox', {
    name: /describe what you want to create/i,
  });
  try {
    await primary.waitFor({ state: 'visible', timeout: 15_000 });
    return primary;
  } catch {
    // Fall through to permissive fallback.
  }
  const fallbacks = [
    page.getByRole('textbox', { name: /describe|prompt|message|reply|how/i }),
    page.locator('[contenteditable="true"]').first(),
    page.locator('textarea').first(),
  ];
  const start = Date.now();
  while (Date.now() - start < 15_000) {
    for (const c of fallbacks) {
      try {
        await c.waitFor({ state: 'visible', timeout: 2_000 });
        return c;
      } catch {
        // try next
      }
    }
  }
  throw new Error(
    "Couldn't find the Claude Design chat input within 30s. Expected accessible name: 'Describe what you want to create...'. Adjust waitForChatInput in claude-design.ts if the UI changed.",
  );
}

async function uploadAttachments(page: Page, paths: string[]): Promise<void> {
  if (!paths.length) return;
  console.log(`[submit] attaching ${paths.length} file(s) ...`);

  // The "+" button next to the chat input. Stable accessible name "Add to
  // chat" (May 2026); styled-components hashes its className, so the
  // role+name path is more reliable than the data-testid path.
  //
  // Important: Claude Design's icon library prefixes button labels with a
  // glyph that materialises as a leading space in the accessible name
  // (e.g. " Add to chat" instead of "Add to chat"). Use STRING matching for
  // exact-name lookups — Playwright whitespace-normalises strings; regex
  // anchors like /^add to chat$/i would fail against " Add to chat".
  const addToChatByRole = page.getByRole('button', { name: 'Add to chat' });
  const importBtnByTestId = page.locator('[data-testid="composer-import-button"]');
  const importBtn = (await addToChatByRole.count())
    ? addToChatByRole.first()
    : importBtnByTestId.first();
  try {
    await importBtn.waitFor({ state: 'visible', timeout: 15_000 });
  } catch {
    throw new Error(
      "Couldn't find the composer's '+' button (Add to chat). The composer UI may have changed.",
    );
  }
  await importBtn.click();

  // Composer menu: plain <button>s with icon + label. "Attach file" is the
  // local-files entry; the other items intentionally skipped:
  //   Upload .fig file (Figma-specific)
  //   Connect GitHub (repo link, not file upload)
  //   Grab web element (URL scraping)
  //   Link code folder (long-lived codebase context)
  //   Skills and design systems
  //   Reference another project
  const attachItem = page
    .getByRole('button', { name: 'Attach file' })
    .first();
  try {
    await attachItem.waitFor({ state: 'visible', timeout: 5_000 });
  } catch {
    throw new Error(
      "Composer menu opened but no 'Attach file' option was visible. The menu items may have been renamed.",
    );
  }

  const fileChooserPromise = page.waitForEvent('filechooser', { timeout: 10_000 });
  await attachItem.click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles(paths);

  // After upload, file chips render inside the composer. Wait briefly so the
  // network upload settles before we type / send. 4s is conservative; raise
  // here if larger files start failing to attach in time.
  await page.waitForTimeout(4_000);

  // Claude Design surfaces upload failures with a toast/alert containing
  // text like "Couldn't upload 6 files, please try again". When this fires,
  // setFiles() has already resolved successfully — Playwright sees the
  // browser-side dispatch but not the server-side rejection. Detect the
  // error explicitly so we don't proceed with a degraded run.
  const errorToast = page.getByText(
    /couldn'?t upload|failed to upload|upload failed/i,
  );
  if (await errorToast.first().isVisible().catch(() => false)) {
    const msg = await errorToast.first().innerText().catch(() => '');
    throw new Error(
      `Claude Design rejected the upload: "${msg.trim()}". Likely an unsupported file type. Allowed types: png/jpg/webp/gif/pdf. Attempted: ${paths.map((p) => p.split('/').pop()).join(', ')}`,
    );
  }
}

async function sendBrief(page: Page, briefPath: string): Promise<void> {
  const { readFileSync } = await import('node:fs');
  const briefMarkdown = readFileSync(briefPath, 'utf8');
  const input = await waitForChatInput(page);

  // The May-2026 composer accepts a single fill() of ~10kb markdown without
  // newline mangling. Confirmed by walkthrough. If a future revision swaps
  // back to a contenteditable that rejects fill(), the type() fallback
  // covers it.
  await input.click();
  try {
    await input.fill(briefMarkdown);
  } catch {
    await input.type(briefMarkdown, { delay: 0 });
  }
  await page.waitForTimeout(500);

  // Send. Use string-name matching so Playwright's whitespace normalization
  // handles the icon-induced leading space in the accessible name (the
  // composer button reads as " Send" in the raw aria tree). The button
  // name changes to "Send (Enter)" while generation is in flight; we only
  // match the idle "Send" pre-click, so the exact-string match is correct.
  const sendBtn = page.getByRole('button', { name: 'Send' }).first();
  try {
    await sendBtn.click({ timeout: 5_000 });
  } catch {
    // Composer also accepts Enter to submit; fall back if the button was
    // hidden behind a transient state.
    await page.keyboard.press('Enter');
  }
  console.log('[submit] brief sent — waiting for response.');
}

/**
 * Verbs Claude Design surfaces in the chat panel while it's working. Each
 * one renders as visible text on the page (e.g. "Writing RECOMMENDATIONS.md",
 * "Viewing screenshot-1280.png", "Designing Overview redesign", etc).
 *
 * These are the most reliable in-flight indicator we have, because the
 * top-of-canvas Stop button has NO accessible name during generation — its
 * label is icon-only — so we can't find it via getByRole(...). The verbs
 * are visible, in body innerText, throughout Claude's working phase.
 *
 * If Anthropic introduces a new working verb, append it here.
 */
/**
 * Verbs Claude Design surfaces in its status indicator while working.
 * Listed in the present-progressive form because that's what shows in
 * the live indicator. Past-tense forms ("Listed", "Read", "Viewed",
 * "Updated") are deliberately excluded — they appear too often in
 * prose / chat content and trigger false positives.
 *
 * Two CRITICAL invariants:
 *
 *   1. Match is **case-sensitive**. Claude's UI titlecases status
 *      verbs ("Viewing image"); ordinary prose lowercases them
 *      ("the listed breakpoints"). Without case-sensitivity the
 *      brief itself would match — and because the brief lives in
 *      the chat history forever, the activity-settle timer would
 *      reset on every poll and never fire.
 *
 *   2. Match doesn't cross **newlines or periods**. The brief is a
 *      multi-paragraph prose blob; activity indicators are short
 *      noun phrases without sentence punctuation (e.g. "Viewing
 *      image ×2", "Reading e40685d3-..."). Stopping at `.` and `\n`
 *      keeps prose from being mistaken for status.
 */
const ACTIVITY_VERBS = [
  'Writing',
  'Viewing',
  'Reading',
  'Thinking',
  'Searching',
  'Generating',
  'Creating',
  'Designing',
  'Drafting',
  'Composing',
  'Sketching',
  'Implementing',
  'Building',
  'Analyzing',
  'Processing',
  'Listing',
] as const;
const ACTIVITY_REGEX = new RegExp(
  `\\b(${ACTIVITY_VERBS.join('|')})\\b[^.\\n]{0,80}`,
  // case-sensitive on purpose — see JSDoc above
);

/**
 * Activity-aware wait helpers. The interactive submit loop calls these in
 * two phases:
 *
 *   Phase 1: `waitForFirstActivity(page, graceMs)`
 *     Waits until any activity verb is observed in body text. If we never
 *     see one within `graceMs`, returns `false` so the caller can decide
 *     what to do (warn-and-continue in interactive mode, throw in
 *     headless mode). Never throws.
 *
 *   Phase 2: `waitForActivitySettle(page, idleMs)`
 *     Returns when no activity verb has been visible for `idleMs`. While
 *     activity is happening, it logs verb transitions and resets the idle
 *     timer. Has no hard cap — the caller controls lifetime.
 *
 * Why split: interactive review wants to call settle multiple times (after
 * "wait for more iteration", we want to re-detect when Claude has finished
 * the next round). Settle has no concept of "done forever", just "quiet
 * for now".
 *
 * Background: the top-of-canvas Stop button is icon-only and exposes no
 * accessible name during generation, so a role+name match for "Stop"
 * finds nothing. The activity verbs ARE visible in body text throughout
 * generation, so we use them instead.
 */

interface ActivityState {
  lastSeenVerb: string | null;
  lastActivityAt: number;
}

/**
 * Find the LAST occurrence of an activity verb in body innerText. We
 * deliberately don't use `text.match(ACTIVITY_REGEX)` — that returns
 * the first match, which on a resumed project is Claude's historical
 * activity summary at the top of the chat. New live activity is always
 * lower on the page, so we walk all matches and take the one closest
 * to the bottom.
 */
function findLatestActivity(text: string): string | null {
  const globalRe = new RegExp(ACTIVITY_REGEX.source, 'g');
  let last: RegExpExecArray | null = null;
  let match: RegExpExecArray | null;
  while ((match = globalRe.exec(text)) !== null) {
    last = match;
  }
  if (!last) return null;
  return last[0].replace(/\s+/g, ' ').trim().slice(0, 80);
}

/**
 * One poll of body innerText for activity. Returns `true` ONLY when the
 * activity fragment is genuinely new — i.e., what Claude is doing right
 * now is different from what we observed last time.
 *
 * If the fragment is unchanged across polls, that's stale text (a
 * historical summary in the chat history, or a live indicator that
 * hasn't ticked yet). We don't reset the idle timer in that case,
 * letting `waitForActivitySettle` correctly decide that nothing new is
 * happening even though the regex is still matching SOMETHING.
 */
async function pollActivity(page: Page, state: ActivityState): Promise<boolean> {
  const text = (await page.locator('body').innerText().catch(() => '')) ?? '';
  const fragment = findLatestActivity(text);
  if (!fragment) return false;
  if (fragment === state.lastSeenVerb) {
    // Same as last poll — almost certainly a static historical summary
    // or an unchanged live indicator. Don't count this as fresh activity.
    return false;
  }
  state.lastActivityAt = Date.now();
  state.lastSeenVerb = fragment;
  console.log(`[claude] ${fragment}`);
  return true;
}

/**
 * Wait until the first activity verb appears. Returns `true` if seen
 * within the grace window, `false` if we timed out. NEVER throws — the
 * caller decides how to interpret a timeout.
 */
async function waitForFirstActivity(
  page: Page,
  graceMs = 90_000,
  pollMs = 2_000,
): Promise<boolean> {
  const start = Date.now();
  const state: ActivityState = { lastSeenVerb: null, lastActivityAt: Date.now() };
  while (Date.now() - start < graceMs) {
    if (await pollActivity(page, state)) return true;
    if (page.isClosed()) return false;
    await page.waitForTimeout(pollMs);
  }
  return false;
}

/**
 * Wait for an `idleMs` window of no activity. Resets the timer every time
 * a verb is observed. No hard cap — runs as long as the page lives or
 * until activity finally stops. Returns when settled, or `false` if the
 * page closes underneath us.
 *
 * Idle window is 60s by default. Empirically, Claude Design pauses
 * between sub-tasks (think → tool → think → write → think) and these
 * pauses can reach 30–45 seconds. A 25s window false-positives "done"
 * after a single early "Thinking" verb.
 */
async function waitForActivitySettle(
  page: Page,
  idleMs = 60_000,
  pollMs = 2_000,
): Promise<boolean> {
  const state: ActivityState = { lastSeenVerb: null, lastActivityAt: Date.now() };
  // Force an initial activity check so a long pause-before-first-poll
  // doesn't immediately satisfy the idle window.
  await pollActivity(page, state);
  while (true) {
    if (page.isClosed()) return false;
    const active = await pollActivity(page, state);
    if (!active && Date.now() - state.lastActivityAt > idleMs) {
      const idleSec = Math.round((Date.now() - state.lastActivityAt) / 1000);
      console.log(`[claude] quiet for ${idleSec}s — design has settled.`);
      return true;
    }
    await page.waitForTimeout(pollMs);
  }
}

/**
 * Capture RECOMMENDATIONS.md body. Confirmed in the May 2026 walkthrough:
 *
 *   - When an artifact is selected, Claude Design sets the URL to
 *     `?file=<filename>` and renders the artifact in the right pane.
 *   - The artifact body is exposed as a `role=textbox` whose `value`
 *     contains the full markdown. There is no aria-label on it; Playwright
 *     synthesises the accessible name from the first ~200 chars of content
 *     (so `getByRole('textbox', { name: /^# / })` finds it).
 *   - The chat composer ("Describe what you want to create...") and the
 *     artifact comment box ("Add a comment...") are sibling textboxes we
 *     must NOT match here.
 *
 * Strategy:
 *   1. If URL doesn't have `?file=*.md`, click the artifact card in the
 *      chat (label `RECOMMENDATIONS.md`) to open it.
 *   2. Read inputValue() from the artifact textbox.
 *   3. Fall back to clicking the toolbar Copy button + clipboard read.
 */
async function captureRecommendationsArtifact(page: Page): Promise<string | null> {
  // 1. Make sure an artifact is open. If `?file=` isn't already in the URL,
  // click the artifact card in the chat thread to open the panel.
  if (!ARTIFACT_URL_PATTERN.test(page.url())) {
    const card = page.getByText(/RECOMMENDATIONS\.md/i).first();
    try {
      await card.waitFor({ state: 'visible', timeout: 10_000 });
      await card.click({ delay: 50 });
      // Wait for the URL to flip — 5s is generous for a same-page nav.
      await page.waitForURL(ARTIFACT_URL_PATTERN, { timeout: 5_000 });
    } catch {
      // No artifact present at all.
      return null;
    }
  }

  // 2. Find the artifact textbox. Anchor on a markdown header in the name
  // (Playwright derives the accessible name from the visible content).
  // Exclude the composer + comment textboxes by name.
  const artifactBox = page
    .getByRole('textbox')
    .filter({
      hasNot: page.locator(
        '[placeholder^="Describe"], [placeholder^="Add a comment"]',
      ),
    })
    .filter({ hasText: /^#\s+/ })
    .first();
  const value = await artifactBox.inputValue().catch(() => '');
  if (value && value.length > 100) return value;

  // 3. Toolbar Copy button → clipboard. Useful when the textbox value isn't
  // exposed (e.g. read-only renderer that paints text outside an input).
  const copyBtn = page.getByRole('button', { name: 'Copy' }).first();
  if (await copyBtn.count()) {
    await copyBtn.click().catch(() => {});
    await page.waitForTimeout(500);
    const fromClipboard = await page
      .evaluate(() => navigator.clipboard.readText())
      .catch(() => null);
    if (fromClipboard && fromClipboard.length > 100) return fromClipboard;
  }

  // 4. Last-resort scrape.
  const visible = await page
    .locator('main, article, [role=region]')
    .filter({ hasText: /^#\s+/ })
    .first()
    .innerText()
    .catch(() => null);
  return visible && visible.length > 100 ? visible : null;
}

/**
 * Trigger Handoff-to-Claude-Code and return the bundle URL.
 *
 * Confirmed flow (May 2026):
 *   1. Click the top-right `Share` button. A menu opens with: Copy link,
 *      Duplicate project, Duplicate as template, Download project as .zip,
 *      Export as PDF/PPTX/HTML, Send to Canva, Handoff to Claude Code…
 *   2. Click `Handoff to Claude Code…`. A modal opens with two tabs:
 *      `Send to local coding agent` (default) and `Send to Claude Code Web`.
 *   3. The local-agent tab renders a terminal-styled command preview that
 *      includes the bundle URL as visible text. Form:
 *        https://api.anthropic.com/v1/design/h/<id>?open_file=<filename>
 *      We scrape that URL from the modal innerText. No need to actually
 *      click "Copy command" or read clipboard.
 *   4. Network listener is kept as a redundant capture path in case the
 *      modal renders the URL differently in a future revision.
 */
async function triggerHandoff(page: Page, bundleUrls: Set<string>): Promise<string | null> {
  const shareBtn = page.getByRole('button', { name: 'Share' }).first();
  if (!(await shareBtn.count())) {
    console.warn('[submit] no Share button visible — skipping handoff capture.');
    return null;
  }
  await shareBtn.click();
  await page.waitForTimeout(400);

  // The menu item label is "Handoff to Claude Code…" with an ellipsis. Match
  // permissively in case Anthropic drops or restyles the suffix.
  const handoffItem = page
    .getByRole('button', { name: /handoff to claude code/i })
    .first();
  try {
    await handoffItem.waitFor({ state: 'visible', timeout: 5_000 });
  } catch {
    throw new Error(
      "Share menu opened but 'Handoff to Claude Code…' wasn't visible. The export menu items may have been renamed.",
    );
  }
  await handoffItem.click();

  // The modal mounts asynchronously; wait for the command preview to render
  // before we start polling for the URL.
  await page.waitForTimeout(800);

  // Scrape from the modal innerText first (most reliable), then fall back
  // to the network listener.
  const start = Date.now();
  while (Date.now() - start < 90_000) {
    const visibleUrl = await scrapeVisibleHandoffUrl(page);
    if (visibleUrl) return visibleUrl;
    const fromNetwork = Array.from(bundleUrls).find((u) =>
      HANDOFF_URL_PATTERN.test(u),
    );
    if (fromNetwork) return fromNetwork;
    await page.waitForTimeout(1_000);
  }
  console.warn('[submit] handoff modal opened but no bundle URL captured within 90s.');
  return null;
}

async function scrapeVisibleHandoffUrl(page: Page): Promise<string | null> {
  // Restrict to dialog scope when present so we don't accidentally pick up
  // a URL from elsewhere on the page (e.g. an old chat message). Falls back
  // to body if the dialog has no role wrapper.
  const dialog = page.getByRole('dialog').first();
  const haystack = (await dialog.count())
    ? await dialog.innerText().catch(() => '')
    : await page.locator('body').innerText().catch(() => '');
  const m = haystack?.match(HANDOFF_URL_PATTERN);
  return m ? m[0] : null;
}
