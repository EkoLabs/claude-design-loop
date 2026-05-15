/**
 * Single-key terminal prompt. Used by the interactive review loop in
 * `submit` to ask the human "what next?" without yanking the cursor away
 * from the terminal or requiring Enter after every choice.
 *
 * Falls back to line-based readline when stdin isn't a TTY (CI, piped
 * stdin, etc) — in that case we just read a whole line and match the
 * first character.
 */

import * as readline from 'node:readline';
import { colors } from './ui.ts';

// Shared readline interface for the line-based prompts (promptText,
// promptList, and the line-mode fallback of promptChoice). Two reasons
// for a singleton:
//
//  1. Creating an rl per question means the previous close() can drop
//     bytes that were already buffered on stdin — fatal with piped
//     input.
//  2. When the input is a closed pipe (e.g. `printf "a\nb\n" | cmd`)
//     readline fires *all* 'line' events before our first `once('line')`
//     listener gets a chance to register the next one. That race makes
//     `once`-per-prompt drop every line after the first. The queue
//     below buffers extra lines so the next prompt picks them up.
let sharedRl: readline.Interface | null = null;
const lineBuffer: string[] = [];
const lineWaiters: Array<(line: string) => void> = [];
let stdinEnded = false;

function ensureRl(): readline.Interface {
  if (sharedRl) return sharedRl;
  sharedRl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: process.stdin.isTTY === true,
  });
  sharedRl.on('line', (line: string) => {
    const waiter = lineWaiters.shift();
    if (waiter) waiter(line);
    else lineBuffer.push(line);
  });
  sharedRl.on('close', () => {
    stdinEnded = true;
    // Anyone still waiting will never get a line. Wake them up so they
    // can fall back to defaults instead of hanging forever.
    while (lineWaiters.length) lineWaiters.shift()!('');
  });
  return sharedRl;
}

/** Read one line from stdin via the shared readline. Resolves with the
 * raw line (no trailing newline). When stdin has already ended, resolves
 * with an empty string so callers can fall back to defaults. */
function readLine(): Promise<string> {
  ensureRl();
  if (lineBuffer.length) return Promise.resolve(lineBuffer.shift()!);
  if (stdinEnded) return Promise.resolve('');
  return new Promise((resolve) => lineWaiters.push(resolve));
}

/** Tear down the shared readline. Call this when the CLI is about to exit
 * — leaving it open keeps the event loop alive and the process never
 * terminates. */
export function closePromptIO(): void {
  if (sharedRl) {
    sharedRl.close();
    sharedRl = null;
  }
}

/** Internal: tear down sharedRl just before a raw-mode prompt takes over
 * stdin. Pausing isn't enough — Node's readline stays attached to stdin
 * and races our raw onData listener, which has caused ERR_USE_AFTER_CLOSE
 * crashes when the prompt order goes text → text → choice (raw). Closing
 * is safe because ensureRl() will lazily recreate it on the next text
 * prompt that needs it. */
function shutdownSharedRl(): void {
  if (!sharedRl) return;
  // Wake any (theoretical) pending waiters with empty so we don't hang
  // — there shouldn't be any at this point since the previous text prompt
  // already awaited readLine() to completion before returning.
  while (lineWaiters.length) lineWaiters.shift()!('');
  // Drop buffered lines too — they belong to the previous prompt's
  // session, not the next one.
  lineBuffer.length = 0;
  stdinEnded = false;
  try {
    sharedRl.removeAllListeners('close');
    sharedRl.removeAllListeners('line');
    sharedRl.close();
  } catch {
    /* best effort */
  }
  sharedRl = null;
}

// Auto-close when the process exits so commands that don't explicitly
// call closePromptIO() still terminate cleanly.
process.once('exit', closePromptIO);

export interface ChoiceOption {
  /** Single letter, lowercase. Matched case-insensitively. */
  key: string;
  /** Shown alongside the letter in the prompt. */
  label: string;
}

export interface PromptChoiceOptions {
  question: string;
  choices: ChoiceOption[];
  /** Letter to select when the user just presses Enter. Must match one of
   * the `choices`. When unset, Enter is ignored and any non-matching key
   * is silently dropped. */
  defaultKey?: string;
}

/**
 * Render a numbered + lettered prompt and resolve when the user types one
 * of the offered keys. Ctrl+C exits the process with code 130 (the
 * conventional SIGINT exit) so the caller doesn't need to special-case it.
 */
export async function promptChoice(opts: PromptChoiceOptions): Promise<string> {
  const choices = opts.choices.map((c) => ({ ...c, key: c.key.toLowerCase() }));
  const defaultKey = opts.defaultKey?.toLowerCase();
  if (process.stdin.isTTY) {
    return promptChoiceTTY(opts.question, choices, defaultKey);
  }
  return promptChoiceLineBased(opts.question, choices, defaultKey);
}

function renderPrompt(
  question: string,
  choices: ChoiceOption[],
  defaultKey?: string,
): void {
  process.stdout.write(`\n${colors.bold(question)}\n`);
  for (const c of choices) {
    const isDefault = c.key === defaultKey;
    const keyStr = isDefault ? colors.bold(c.key.toUpperCase()) : c.key;
    process.stdout.write(`  [${keyStr}] ${c.label}\n`);
  }
  const hint = defaultKey ? colors.dim(` (Enter = ${defaultKey})`) : '';
  process.stdout.write(`${colors.cyan('>')}${hint} `);
}

async function promptChoiceTTY(
  question: string,
  choices: ChoiceOption[],
  defaultKey?: string,
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    renderPrompt(question, choices, defaultKey);

    const stdin = process.stdin;
    const wasRaw = stdin.isRaw === true;

    // Tear down any open shared readline before entering raw mode — pausing
    // alone races stdin and trips ERR_USE_AFTER_CLOSE on the next prompt.
    shutdownSharedRl();

    try {
      stdin.setRawMode(true);
    } catch {
      // setRawMode can throw on some terminals — fall back to line mode.
      promptChoiceLineBased(question, choices, defaultKey).then(resolve, reject);
      return;
    }
    stdin.resume();
    stdin.setEncoding('utf8');

    const cleanup = () => {
      stdin.off('data', onData);
      try {
        stdin.setRawMode(wasRaw);
      } catch {
        /* terminal might be closing */
      }
      stdin.pause();
    };

    function onData(chunk: string | Buffer): void {
      const ch = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      // Ctrl+C
      if (ch === '\u0003') {
        cleanup();
        process.exit(130);
      }
      // Enter — accept default if defined
      if (ch === '\r' || ch === '\n') {
        if (!defaultKey) return; // ignore Enter with no default
        const def = choices.find((c) => c.key === defaultKey);
        if (!def) return;
        process.stdout.write(`${def.key}\n`);
        cleanup();
        resolve(def.key);
        return;
      }
      const key = ch.toLowerCase();
      const match = choices.find((c) => c.key === key);
      if (!match) return;
      process.stdout.write(`${match.key}\n`);
      cleanup();
      resolve(match.key);
    }

    stdin.on('data', onData);
  });
}

async function promptChoiceLineBased(
  question: string,
  choices: ChoiceOption[],
  defaultKey?: string,
): Promise<string> {
  while (true) {
    renderPrompt(question, choices, defaultKey);
    const line = await readLine();
    const trimmed = line.trim();
    if (!trimmed && defaultKey) {
      const def = choices.find((c) => c.key === defaultKey);
      if (def) return def.key;
    }
    const key = trimmed.toLowerCase().slice(0, 1);
    const match = choices.find((c) => c.key === key);
    if (match) return match.key;
    process.stdout.write(`(unrecognized: \`${trimmed}\` — try again)\n`);
  }
}

// ---------------------------------------------------------------------------
// Higher-level prompts used by the wizard.
// ---------------------------------------------------------------------------

export interface PromptYesNoOptions {
  question: string;
  /** When true, Enter accepts "yes". When false, Enter accepts "no".
   * Default: false (the safer default for destructive actions). */
  defaultYes?: boolean;
}

/** y/n prompt with a clear default. Returns true on yes, false on no. */
export async function promptYesNo(opts: PromptYesNoOptions): Promise<boolean> {
  const defaultKey = opts.defaultYes ? 'y' : 'n';
  const answer = await promptChoice({
    question: opts.question,
    choices: [
      { key: 'y', label: 'yes' },
      { key: 'n', label: 'no' },
    ],
    defaultKey,
  });
  return answer === 'y';
}

export interface PromptTextOptions {
  question: string;
  /** Pre-filled value shown in brackets. Returned as-is when the user just
   * presses Enter. Use empty string for "skippable, no default". */
  default?: string;
  /** Optional one-line hint shown under the question (e.g. "Enter to skip"). */
  hint?: string;
  /** Validate the input. Return null on success, or an error string on
   * failure (which is shown to the user, who is then re-prompted). */
  validate?: (value: string) => string | null;
}

/** Free-text prompt with optional default + validation. Trims input. */
export async function promptText(opts: PromptTextOptions): Promise<string> {
  while (true) {
    process.stdout.write(`\n${colors.bold(opts.question)}\n`);
    if (opts.hint) process.stdout.write(`  ${colors.dim(opts.hint)}\n`);
    const def = opts.default ? ` ${colors.dim(`[${opts.default}]`)}` : '';
    process.stdout.write(`${colors.cyan('>')}${def} `);
    const line = await readLine();
    const value = line.trim() || opts.default || '';
    const err = opts.validate?.(value) ?? null;
    if (err) {
      process.stdout.write(`  ${colors.yellow('⚠')} ${err}\n`);
      continue;
    }
    return value;
  }
}

export interface PromptListItem<T> {
  /** Display label. */
  label: string;
  /** Optional dim sublabel shown after the label. */
  hint?: string;
  /** Returned to the caller when this item is chosen. */
  value: T;
}

export interface PromptListOptions<T> {
  question: string;
  items: PromptListItem<T>[];
  /** 0-based index of the default. Selected on Enter. Default: 0. */
  defaultIndex?: number;
}

/** List picker.
 *
 * In a TTY: arrow keys (↑/↓) move the caret, Enter confirms, number keys
 * jump directly. The list re-renders in place as the caret moves.
 *
 * Out of a TTY (CI / piped stdin): falls back to line-based number input. */
export async function promptList<T>(opts: PromptListOptions<T>): Promise<T> {
  const items = opts.items;
  if (items.length === 0) {
    throw new Error('promptList: at least one item required');
  }
  const defaultIndex = Math.min(
    Math.max(0, opts.defaultIndex ?? 0),
    items.length - 1,
  );

  if (process.stdin.isTTY) {
    return promptListTTY(opts.question, items, defaultIndex);
  }
  return promptListLineBased(opts.question, items, defaultIndex);
}

function renderListItems<T>(
  items: PromptListItem<T>[],
  selected: number,
): void {
  items.forEach((item, i) => {
    const num = `${i + 1}`.padStart(2);
    const isSelected = i === selected;
    const marker = isSelected ? colors.cyan('▸') : ' ';
    const label = isSelected ? colors.bold(item.label) : item.label;
    const itemHint = item.hint ? `  ${colors.dim(item.hint)}` : '';
    process.stdout.write(`  ${marker} ${num}. ${label}${itemHint}\n`);
  });
}

async function promptListTTY<T>(
  question: string,
  items: PromptListItem<T>[],
  defaultIndex: number,
): Promise<T> {
  let selected = defaultIndex;

  process.stdout.write(`\n${colors.bold(question)}\n`);
  renderListItems(items, selected);
  process.stdout.write(
    `${colors.dim(`  ↑/↓ to move · number to jump · Enter to pick · Ctrl+C to abort`)}\n`,
  );

  const stdin = process.stdin;
  const wasRaw = stdin.isRaw === true;

  // Tear down any open shared readline — see promptChoiceTTY for why.
  shutdownSharedRl();

  try {
    stdin.setRawMode(true);
  } catch {
    // setRawMode can fail on weird terminals — fall back to line mode.
    return promptListLineBased(question, items, defaultIndex);
  }
  stdin.resume();
  stdin.setEncoding('utf8');

  return new Promise<T>((resolve) => {
    const cleanup = () => {
      stdin.off('data', onData);
      try {
        stdin.setRawMode(wasRaw);
      } catch {
        /* terminal closing */
      }
      stdin.pause();
    };

    const redraw = () => {
      // Move cursor up over (items + hint) lines and clear to end of screen.
      readline.moveCursor(process.stdout, -process.stdout.columns, -(items.length + 1));
      readline.clearScreenDown(process.stdout);
      renderListItems(items, selected);
      process.stdout.write(
        `${colors.dim(`  ↑/↓ to move · number to jump · Enter to pick · Ctrl+C to abort`)}\n`,
      );
    };

    function onData(chunk: string | Buffer): void {
      const ch = typeof chunk === 'string' ? chunk : chunk.toString('utf8');

      // Ctrl+C
      if (ch === '\u0003') {
        cleanup();
        process.exit(130);
      }
      // Enter (CR or LF)
      if (ch === '\r' || ch === '\n') {
        cleanup();
        resolve(items[selected]!.value);
        return;
      }
      // Arrow keys (CSI sequences). Some terminals send them as a single
      // chunk like "\x1b[A"; others split — we handle the single-chunk
      // common case which covers macOS Terminal, iTerm2, Cursor, VS Code.
      if (ch === '\u001b[A' || ch === '\u001bOA') {
        // Up
        selected = (selected - 1 + items.length) % items.length;
        redraw();
        return;
      }
      if (ch === '\u001b[B' || ch === '\u001bOB') {
        // Down
        selected = (selected + 1) % items.length;
        redraw();
        return;
      }
      // Home / Page Up
      if (ch === '\u001b[H' || ch === '\u001b[5~') {
        selected = 0;
        redraw();
        return;
      }
      // End / Page Down
      if (ch === '\u001b[F' || ch === '\u001b[6~') {
        selected = items.length - 1;
        redraw();
        return;
      }
      // Number jump (1..9)
      if (ch >= '1' && ch <= '9') {
        const idx = Number.parseInt(ch, 10) - 1;
        if (idx < items.length) {
          selected = idx;
          redraw();
        }
        return;
      }
      // Anything else (including stray escape sequences) — ignore silently.
    }

    stdin.on('data', onData);
  });
}

async function promptListLineBased<T>(
  question: string,
  items: PromptListItem<T>[],
  defaultIndex: number,
): Promise<T> {
  while (true) {
    process.stdout.write(`\n${colors.bold(question)}\n`);
    renderListItems(items, defaultIndex);
    const def = colors.dim(` (Enter = ${defaultIndex + 1})`);
    process.stdout.write(`${colors.cyan('>')}${def} `);
    const line = await readLine();
    const trimmed = line.trim();
    if (!trimmed) return items[defaultIndex]!.value;
    const parsed = Number.parseInt(trimmed, 10);
    if (Number.isNaN(parsed) || parsed < 1 || parsed > items.length) {
      process.stdout.write(
        `  ${colors.yellow('⚠')} Pick a number 1\u2013${items.length}.\n`,
      );
      continue;
    }
    return items[parsed - 1]!.value;
  }
}
