/**
 * Thin Playwright wrapper. The package is intentionally agnostic to the calling
 * agent (Cursor, Claude Code, plain CLI/CI), so all browser work happens here
 * via headless Chromium.
 *
 * Captures, per breakpoint:
 *   - full-page screenshot (PNG)
 *   - accessibility tree (YAML-ish text)
 *   - innerText of <body>
 *   - tailwind class frequency map (best-effort; framework-agnostic)
 */

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Browser, type BrowserContext } from 'playwright';

export interface CaptureOptions {
  url: string;
  outDir: string;
  breakpoints: number[];
  settleMs: number;
  storageState?: string;
  waitFor?: {
    visible?: string;
    hidden?: string;
    timeoutMs?: number;
  };
}

export interface CaptureResult {
  screenshots: { width: number; path: string }[];
  domSnapshotPath: string;
  classFrequencyPath: string;
  /** Topmost route title from <title>. */
  pageTitle: string;
}

export async function captureRoute(opts: CaptureOptions): Promise<CaptureResult> {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({
      storageState: opts.storageState,
      deviceScaleFactor: 1,
    });
    return await captureWithContext(context, opts);
  } finally {
    await browser.close();
  }
}

async function captureWithContext(
  context: BrowserContext,
  opts: CaptureOptions,
): Promise<CaptureResult> {
  const screenshots: CaptureResult['screenshots'] = [];
  let pageTitle = '';
  let domSnapshot = '';
  let classFrequency: Record<string, number> = {};

  for (const width of opts.breakpoints) {
    const page = await context.newPage();
    await page.setViewportSize({ width, height: heightFor(width) });
    await page.goto(opts.url, { waitUntil: 'networkidle', timeout: 30_000 });
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

  const domSnapshotPath = join(opts.outDir, 'dom.yaml');
  writeFileSync(domSnapshotPath, domSnapshot, 'utf8');

  const classFrequencyPath = join(opts.outDir, 'class-frequency.json');
  writeFileSync(
    classFrequencyPath,
    JSON.stringify(classFrequency, null, 2) + '\n',
    'utf8',
  );

  return {
    screenshots,
    domSnapshotPath,
    classFrequencyPath,
    pageTitle,
  };
}

function heightFor(width: number): number {
  if (width >= 1280) return 900;
  if (width >= 768) return 1024;
  return 812;
}

async function applyWaitFor(
  page: import('playwright').Page,
  waitFor: CaptureOptions['waitFor'],
): Promise<void> {
  if (!waitFor) return;
  const timeout = waitFor.timeoutMs ?? 15_000;
  if (waitFor.visible) {
    await page.locator(waitFor.visible).first().waitFor({ state: 'visible', timeout });
  }
  if (waitFor.hidden) {
    await page.locator(waitFor.hidden).first().waitFor({ state: 'hidden', timeout });
  }
}

async function captureA11yTree(page: import('playwright').Page): Promise<string> {
  // Playwright 1.50+ replaced `page.accessibility.snapshot()` with locator
  // ariaSnapshot which returns a YAML-shaped tree — same idea, simpler API,
  // and conveniently the same format Cursor's browser MCP emits, so callers
  // see consistent output regardless of which side captured the snapshot.
  try {
    return await page.locator('body').ariaSnapshot();
  } catch (err) {
    return `(ariaSnapshot failed: ${err instanceof Error ? err.message : String(err)})\n`;
  }
}

async function captureClassFrequency(
  page: import('playwright').Page,
): Promise<Record<string, number>> {
  return page.evaluate(() => {
    const freq = new Map<string, number>();
    const els = document.querySelectorAll<HTMLElement>('[class]');
    els.forEach((el) => {
      const classes = el.className;
      if (typeof classes !== 'string') return;
      classes.split(/\s+/).forEach((cls) => {
        if (!cls) return;
        freq.set(cls, (freq.get(cls) ?? 0) + 1);
      });
    });
    const result: Record<string, number> = {};
    Array.from(freq.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 200)
      .forEach(([cls, n]) => {
        result[cls] = n;
      });
    return result;
  });
}
