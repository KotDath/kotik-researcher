import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Renderer-only dev server для быстрого режима агентской UI-верификации
// (pnpm dev:renderer → http://localhost:5173). Без Electron/preload — renderer
// работает на моковом window.api (src/renderer/src/mock-api.ts).
export default defineConfig({
  root: 'src/renderer',
  resolve: {
    alias: { '@renderer': resolve('src/renderer/src') }
  },
  plugins: [react()],
  server: { port: 5173, strictPort: true }
})
