import { resolve } from 'node:path'
import { defineWorkspace } from 'vitest/config'
import react from '@vitejs/plugin-react'

// Два проекта (design.md, решение 2): node — main-логика (tsconfig.node.json),
// web — renderer-компоненты (tsconfig.web.json, jsdom, алиас @renderer).
export default defineWorkspace([
  {
    test: {
      name: 'node',
      environment: 'node',
      include: ['tests/unit/**/*.test.ts']
    }
  },
  {
    plugins: [react()],
    resolve: {
      alias: { '@renderer': resolve(__dirname, 'src/renderer/src') }
    },
    test: {
      name: 'web',
      environment: 'jsdom',
      include: ['tests/unit/**/*.test.tsx'],
      setupFiles: ['tests/unit/setup.ts']
    }
  }
])
