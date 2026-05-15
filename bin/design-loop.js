#!/usr/bin/env node
// Thin shim: import the built CLI from dist/. tsup emits ESM with a top-level
// program.parseAsync() that runs on import, so a bare import is enough.
//
// IMPORTANT: pnpm's `github:` install layout puts a `#<sha>` segment in the
// `node_modules/.pnpm/...` directory name (e.g. `...claude-design-loop.git
// #ca4380c_<hash>/...`). When passing a raw filesystem path to `await
// import()`, Node converts it to a `file://` URL and treats the `#` as a
// URL fragment — truncating the path mid-way and throwing
// `ERR_MODULE_NOT_FOUND`. Always go through `pathToFileURL` so the `#`
// (and any other special chars, e.g. spaces on Windows) are properly
// percent-encoded.
import { fileURLToPath, pathToFileURL } from 'node:url';
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

await import(pathToFileURL(dist).href);
