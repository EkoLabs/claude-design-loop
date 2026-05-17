import { D as DesignLoopConfig, a as DesignSystemRef } from './types-CtrgrBZ8.js';
export { A as Adapter, b as DiscoveredRoute, F as Framework, d as defineConfig, g as getDefaultDesignSystem, c as getDesignSystems, l as loadConfig } from './types-CtrgrBZ8.js';

/**
 * `design-loop brief` — the outbound half of the loop.
 *
 * Captures the current state of a route (screenshots + DOM snapshot) and
 * writes a short brief.md the user (or `submit`) sends to Claude Design.
 *
 * The brief is intentionally short. The job here is to capture **the visual
 * truth** (screenshots) and let Claude Design do the design work. We don't
 * inline 10kb of project docs into the prompt anymore — that biases Claude
 * toward "implement this exactly as described" instead of "redesign this".
 */

interface BriefArgs {
    config: DesignLoopConfig;
    rootDir: string;
    route: string;
    /** Override config breakpoints. */
    breakpoints?: number[];
    /** Optional one-line intent passed through to the brief template. */
    intent?: string;
    /** Override the design system. Default: first entry from `config.designSystem`. */
    designSystem?: DesignSystemRef;
}
interface BriefResult {
    loopId: string;
    briefPath: string;
    inputsDir: string;
    manifestPath: string;
}
declare function runBrief(args: BriefArgs): Promise<BriefResult>;

/**
 * `design-loop pull` — the inbound half of the loop.
 *
 * Takes a Claude Design handoff bundle URL (or a path to a downloaded .zip)
 * and a loop id. Expands the bundle into the loop dir. If Claude happens
 * to have produced a `RECOMMENDATIONS.md` artifact (rare in the new flow,
 * but supported), it gets surfaced at the loop root for easy review.
 *
 * If the URL points at `api.anthropic.com/v1/design/h/<id>`, the package
 * tries an unauthenticated fetch first. If that returns 401/403, it falls
 * back to a "manual mode" where the user is told to download the bundle
 * themselves and pass `--bundle-path=...`.
 */

interface PullArgs {
    config: DesignLoopConfig;
    rootDir: string;
    loopId: string;
    /** Either a URL (preferred) or a path to a downloaded bundle .zip. */
    bundleSource: string;
}
interface PullResult {
    bundleDir: string;
    recommendationsPath: string | null;
    reviewChecklistPath: string;
    files: string[];
}
declare function runPull(args: PullArgs): Promise<PullResult>;

/**
 * Build a ready-to-paste prompt the user can drop straight into Cursor chat
 * to finish the design-loop round-trip (merge scaffold + JSX sources into
 * the live route).
 *
 * The prompt is also written to `output/CURSOR_PROMPT.md` and, on macOS,
 * piped through `pbcopy` so the user gets a "✓ copied to clipboard" signal
 * and the merge step is one cmd+v away.
 */

interface PromptResult {
    /** Absolute path to the markdown file holding the prompt. */
    promptPath: string;
    /** The full prompt text — handy for tests + for the caller to print. */
    prompt: string;
}

/**
 * `design-loop apply` — translation step.
 *
 * Reads the human-edited `review-checklist.md`, loads the framework adapter,
 * and asks the adapter to translate the bundle's standalone HTML into
 * framework-native scaffolds in `output/translated/`. Does NOT modify the
 * live codebase — that's a deliberate manual / agent step, because merging
 * into existing routes is a judgement call the package shouldn't make.
 */

interface ApplyArgs {
    config: DesignLoopConfig;
    rootDir: string;
    loopId: string;
    /** When true, suppress the standalone Cursor-prompt handoff banner.
     * Used by `submit`/`resume`/`fetch` which print their own consolidated
     * next-steps message. Default false (so standalone `apply` still asks). */
    silent?: boolean;
    /** When false, skip the "copy to clipboard?" question even on a TTY.
     * Default true. */
    interactive?: boolean;
}
interface ApplyResult {
    outputDir: string;
    translatedFiles: string[];
    notes: string[];
    promptResult: PromptResult | null;
}
declare function runApply(args: ApplyArgs): Promise<ApplyResult>;

/**
 * `design-loop verify` — re-capture the live route after apply, and write a
 * report comparing it to the original input screenshots and (if present) the
 * design canvas screenshots from the bundle. Visual diffing is intentionally
 * minimal: side-by-side file references for a human or agent to interpret.
 * The report cross-references which approved checklist items the verifier
 * could (or could not) confirm in the rendered output.
 */

interface VerifyArgs {
    config: DesignLoopConfig;
    rootDir: string;
    loopId: string;
}
interface VerifyResult {
    reportPath: string;
    afterScreenshots: string[];
}
declare function runVerify(args: VerifyArgs): Promise<VerifyResult>;

/**
 * `design-loop submit <loopId>` — drive claude.ai/design end-to-end.
 *
 * Opens Claude Design, creates a project, attaches the screenshots, sends
 * the brief, and waits for Claude to finish the first design pass. After
 * that, hands control to an **interactive review loop** in the terminal:
 * the user iterates with Claude in the browser as much as they want, and
 * comes back to the terminal to choose:
 *
 *   - `[f]etch` — drive Share → Handoff in the same browser session, get
 *                 the bundle URL, expand it locally with `pull`.
 *   - `[w]ait`  — keep iterating in claude.ai/design. The browser stays
 *                 open. Whenever Claude works again and goes quiet, the
 *                 prompt re-appears.
 *   - `[u]rl`   — print the project URL again (in case it scrolled off).
 *   - `[q]uit`  — close the browser without fetching. Use the standalone
 *                 `design-loop fetch <loopId>` later if you change your
 *                 mind.
 *
 * There's no timeout on the review phase — the human controls lifetime.
 */

interface SubmitArgs {
    config: DesignLoopConfig;
    rootDir: string;
    loopId: string;
    /** Show the browser window. Required to engage the interactive prompt. */
    headed?: boolean;
    /** Override the project name. Default: derived from loop id. */
    projectName?: string;
    /** Override fidelity. Default: high-fidelity. */
    fidelity?: 'wireframe' | 'high-fidelity';
    /** Disable the interactive review prompt (treat first settle as done).
     * Useful for CI or background runs. Default: prompt iff stdin is a TTY. */
    noInteractive?: boolean;
    /** Skip the auto-apply step that runs after a successful fetch. Default
     * is to chain pull → apply so `[f]` produces ready-to-merge scaffolds. */
    noApply?: boolean;
}
interface SubmitOutcome {
    projectUrl: string;
    bundleUrl: string | null;
    pulled: boolean;
    applied: boolean;
    translatedFiles: string[];
}
declare function runSubmit(args: SubmitArgs): Promise<SubmitOutcome>;

/**
 * `design-loop resume <loopId>` — pick up an existing Claude Design
 * session without losing in-flight design work.
 *
 * Use cases:
 *   - You ran `submit --headed`, started designing, then the browser
 *     window got closed (you multi-tasked, terminal got SIGTERM, the
 *     laptop slept too long, etc). The Claude Design project is still
 *     alive on the server, and you don't want to re-submit the brief.
 *   - You came back the next day and want to keep iterating with
 *     Claude on a previous design.
 *
 * Reuses the same interactive review prompt as `submit`. If Claude was
 * mid-generation when the prior session was interrupted, we'll watch
 * activity and only prompt once it goes quiet; if it was already settled,
 * you get prompted immediately.
 */

interface ResumeArgs {
    config: DesignLoopConfig;
    rootDir: string;
    loopId: string;
    /** Override the manifest-saved project URL. */
    projectUrl?: string;
    /** Show the browser window. Required for the interactive prompt to be
     * meaningful — you can't iterate on a design you can't see. */
    headed?: boolean;
    /** Skip the interactive prompt (e.g. for CI / scripts). */
    noInteractive?: boolean;
    /** Skip the auto-apply step that runs after a successful fetch. */
    noApply?: boolean;
}
interface ResumeOutcome {
    projectUrl: string;
    bundleUrl: string | null;
    pulled: boolean;
    applied: boolean;
    translatedFiles: string[];
}
declare function runResume(args: ResumeArgs): Promise<ResumeOutcome>;

/**
 * `design-loop fetch <loopId>` — bring a finished design back into the repo.
 *
 * Workflow:
 *   1. Read the loop's manifest to find the saved Claude Design project URL
 *      (or accept --project-url to override).
 *   2. Open the project, click Share → Handoff to Claude Code, scrape the
 *      bundle URL from the modal.
 *   3. Hand off to `runPull` which downloads + expands the bundle.
 *
 * Run this when you've reviewed the design in Claude Design and you're
 * happy with it. Until then, `submit` only leaves the project running and
 * doesn't pull anything down — so iteration in claude.ai/design doesn't
 * fight with our local artifact storage.
 */

interface FetchArgs {
    config: DesignLoopConfig;
    rootDir: string;
    loopId: string;
    /** Override the project URL stored in the manifest. */
    projectUrl?: string;
    /** Show the browser window. */
    headed?: boolean;
    /** Skip the pull step (just print the bundle URL). */
    noPull?: boolean;
    /** Skip the auto-apply step that runs after pull. */
    noApply?: boolean;
}
interface FetchOutcome {
    projectUrl: string;
    bundleUrl: string;
    pulled: boolean;
    applied: boolean;
    translatedFiles: string[];
}
declare function runFetch(args: FetchArgs): Promise<FetchOutcome>;

/**
 * `design-loop` (no subcommand) — the interactive wizard.
 *
 * Guides the user end-to-end with sensible defaults at every step:
 *   1. acquire repo-wide concurrency lock (refuses if another session is live)
 *   2. ask "new design or resume in-progress?" if any resumable loops exist
 *   3. (NEW) pick route → pick design system → optional intent → project name
 *   4. show summary, confirm, then chain brief → submit (with the existing
 *      [f]/[w]/[u]/[q] review prompt + auto-pull/apply on [f])
 *   5. (RESUME) pick a saved loop, then re-attach to its Claude Design canvas
 *
 * The wizard composes existing pieces — runBrief, runSubmit, runResume,
 * runApply — rather than duplicating their logic. Subcommands stay as
 * escape hatches for CI / power users.
 */

interface WizardArgs {
    config: DesignLoopConfig;
    rootDir: string;
    /** Default true. Set false in tests / CI. */
    headed?: boolean;
}
declare function runWizard(args: WizardArgs): Promise<void>;

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
interface AuthPaths {
    storageState: string;
    /** Persistent profile dir for headed-mode logins. */
    profileDir: string;
}
declare function defaultAuthPaths(): AuthPaths;
/**
 * Open a headed browser, navigate to claude.ai/design, wait for the user to
 * log in and reach the project picker. Then save storage state.
 */
declare function loginInteractive(authPaths: AuthPaths): Promise<void>;
/**
 * Read every design system available to the logged-in user, with both
 * display name and UUID. Drives the same project picker used by `submit`,
 * just expands the design-system combobox and scrapes its options.
 *
 * Used by `design-loop systems` to fill in `id`s for design systems the
 * user pasted into config without one (or just to discover what's
 * available).
 */
interface ListDesignSystemsOptions {
    authPaths: AuthPaths;
    headed?: boolean;
}
interface DiscoveredDesignSystem {
    name: string;
    id: string;
}
declare function listDesignSystems(opts: ListDesignSystemsOptions): Promise<DiscoveredDesignSystem[]>;

export { DesignLoopConfig, DesignSystemRef, type DiscoveredDesignSystem, defaultAuthPaths, listDesignSystems, loginInteractive, runApply, runBrief, runFetch, runPull, runResume, runSubmit, runVerify, runWizard };
