import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { molcajete: 'src/cli.ts' },
  format: ['esm'],
  splitting: false,
  banner: { js: '#!/usr/bin/env node' },
  platform: 'node',
  outExtension: () => ({ js: '.mjs' }),
  target: 'node20',
  clean: true,
  outDir: 'dist',
});
