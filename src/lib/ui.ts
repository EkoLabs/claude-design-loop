/**
 * Terminal formatting helpers shared across the wizard, the per-command
 * next-steps printers, and the interactive review loops. Centralized so
 * the visual style of `design-loop` stays consistent everywhere.
 *
 * Color is applied via `picocolors` and only when stdout is a TTY — when
 * the output is piped (e.g. CI logs) we degrade to plain text so log files
 * stay readable.
 */

import pc from 'picocolors';

const COLOR = process.stdout.isTTY === true;

const wrap = (fn: (s: string) => string) => (s: string) => (COLOR ? fn(s) : s);

export const colors = {
  bold: wrap(pc.bold),
  dim: wrap(pc.dim),
  green: wrap(pc.green),
  red: wrap(pc.red),
  yellow: wrap(pc.yellow),
  cyan: wrap(pc.cyan),
  magenta: wrap(pc.magenta),
  blue: wrap(pc.blue),
  gray: wrap(pc.gray),
};

const RULE_CHAR = '─';
const TARGET_WIDTH = 64;

/** Top-level banner. Only used at the start of the wizard. */
export function banner(title: string, subtitle?: string): void {
  const line = colors.dim(RULE_CHAR.repeat(TARGET_WIDTH));
  console.log('');
  console.log(line);
  console.log(`  ${colors.bold(title)}${subtitle ? '  ' + colors.dim(subtitle) : ''}`);
  console.log(line);
  console.log('');
}

/** Section header inside a flow. Inset rule + label. */
export function section(label: string): void {
  const padded = ` ${label} `;
  const remaining = Math.max(2, TARGET_WIDTH - padded.length - 2);
  const left = RULE_CHAR.repeat(2);
  const right = RULE_CHAR.repeat(remaining);
  console.log('');
  console.log(colors.dim(left) + colors.bold(padded) + colors.dim(right));
}

/** Light divider with no label. */
export function rule(): void {
  console.log(colors.dim(RULE_CHAR.repeat(TARGET_WIDTH)));
}

/** Aligned key/value line. Pads the key to a sensible column. */
export function kv(key: string, value: string | number, keyWidth = 16): void {
  const padded = `${key}:`.padEnd(keyWidth);
  console.log(`  ${colors.dim(padded)} ${value}`);
}

/** Block of kv pairs with consistent alignment. */
export function kvBlock(entries: Array<[string, string | number] | null | undefined>): void {
  const live = entries.filter((e): e is [string, string | number] => Array.isArray(e));
  const width = Math.min(
    24,
    Math.max(8, ...live.map(([k]) => k.length + 1)),
  );
  for (const [k, v] of live) kv(k, v, width);
}

/** ✦-prefixed bullet for emphasized line items. */
export function bullet(text: string): void {
  console.log(`  ${colors.cyan('✦')} ${text}`);
}

/** Small dim bullet for secondary list items. */
export function listItem(text: string): void {
  console.log(`    ${colors.dim('•')} ${text}`);
}

/** ✓ green success line. */
export function success(text: string): void {
  console.log(`  ${colors.green('✓')} ${text}`);
}

/** ⚠ yellow warning line. */
export function warn(text: string): void {
  console.log(`  ${colors.yellow('⚠')} ${text}`);
}

/** ✗ red error line. */
export function error(text: string): void {
  console.log(`  ${colors.red('✗')} ${text}`);
}

/** Soft dim line, e.g. hints. */
export function hint(text: string): void {
  console.log(`  ${colors.dim(text)}`);
}

/** Plain indented line, no prefix. */
export function line(text = ''): void {
  if (!text) console.log('');
  else console.log(`  ${text}`);
}

/** Indented multi-line block with optional prefix per line. */
export function block(text: string, prefix = '  '): void {
  for (const ln of text.split('\n')) console.log(`${prefix}${ln}`);
}

export const symbols = {
  arrow: COLOR ? colors.cyan('→') : '->',
  check: COLOR ? colors.green('✓') : 'OK',
  cross: COLOR ? colors.red('✗') : 'X',
  star: COLOR ? colors.cyan('✦') : '*',
  warn: COLOR ? colors.yellow('⚠') : '!',
};
