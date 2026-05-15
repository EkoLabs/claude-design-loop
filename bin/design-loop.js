#!/usr/bin/env node
// Thin shim: import the built CLI from dist/. tsup emits ESM with a top-level
// program.parseAsync() that runs on import, so a bare import is enough.
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { existsSync } from 'node:fs';

const here = dirname(fileURLToPath(import.meta.url));
const dist = resolve(here, '../dist/cli.js');

if (!existsSync(dist)) {
  console.error(
    '[design-loop] dist/cli.js not found. Run `pnpm build` from the package root, or reinstall (the `prepare` lifecycle script builds on install).',
  );
  process.exit(1);
}

await import(dist);
