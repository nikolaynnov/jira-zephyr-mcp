import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  target: 'es2022',
  clean: true,
  // Inject the CLI shebang into the bundle directly so the build works on every
  // platform (the previous shell-based cat/mv/chmod pipeline was Unix-only).
  banner: {
    js: '#!/usr/bin/env node',
  },
});
