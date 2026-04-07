import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: {
      molcajete: 'src/cli.ts',
      'registry-daemon': 'src/lib/registry-daemon.ts',
    },
    format: ['esm'],
    splitting: false,
    banner: { js: '#!/usr/bin/env node' },
    platform: 'node',
    outExtension: () => ({ js: '.mjs' }),
    target: 'node20',
    clean: true,
    outDir: 'dist',
  },
  {
    entry: { index: 'src/index.ts' },
    format: ['esm'],
    dts: true,
    outExtension: () => ({ js: '.mjs' }),
    platform: 'node',
    target: 'node20',
    outDir: 'dist',
  },
]);
