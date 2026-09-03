import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/main.ts', 'src/preload.ts'],
  format: ['cjs'],
  platform: 'node',
  target: 'node22',
  outDir: 'dist',
  clean: true,
  external: ['electron'],
  noExternal: ['@kotik/server', '@kotik/agent', '@kotik/deepseek', '@kotik/protocol'],
  outExtension: () => ({ js: '.cjs' }),
})
