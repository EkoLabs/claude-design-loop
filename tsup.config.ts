import { defineConfig } from 'tsup';

export default defineConfig({
  // Two entries: the public library API and the CLI. Both are bundled
  // separately so the bin shim can require dist/cli.js directly without
  // pulling in unused exports.
  entry: {
    index: 'src/index.ts',
    cli: 'src/cli.ts',
    'adapters/index': 'src/adapters/index.ts',
  },
  format: ['esm'],
  target: 'node20',
  dts: true,
  clean: true,
  sourcemap: true,
  splitting: false,
  shims: false,
  // Don't bundle node built-ins or peer/dep packages — keep them as bare
  // imports so consumers de-dupe them through their own lockfile.
  external: ['playwright', 'commander', 'picocolors'],
  // The CLI shebang gets stripped by esbuild; re-add it.
  banner({ format }) {
    return format === 'esm' ? { js: '' } : {};
  },
});
