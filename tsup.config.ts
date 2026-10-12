import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs', 'esm'],
  platform: 'neutral',
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  treeshake: true,
  minify: false,
  name: 'ld',
  target: 'node18',
  metafile: true,
  external: ['dayjs', 'msrcrypto'],
  banner: {
    js: '// © 2026 typeof (Scolup) | Licensed under AGPL 3.0',
  },
  footer: {
    js: '// © 2026 typeof (Scolup) | Licensed under AGPL 3.0',
  },
});
