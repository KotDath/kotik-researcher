import { defineConfig } from '@playwright/test'

// Один конфиг, два проекта (design.md, решение 3): e2e — пользовательские
// сценарии на реальном Electron, visual — скриншотные регрессии.
// E2E_RENDERER_URL задаётся скриптом test:e2e:quick — тогда Playwright
// поднимает renderer dev-server, а fixture пробрасывает URL в Electron.
const rendererUrl = process.env.E2E_RENDERER_URL

// Отдельный renderer dev-server (порт 5199) для visual-тестов состояний,
// которые в реальном main недетерминированы (вечная загрузка, карточка ошибки
// с точным текстом, богатая история чата) — renderer берёт моковый window.api
// из ?mockApi=… (src/renderer/src/mock-api.ts).
const MOCK_RENDERER_URL = 'http://localhost:5199'

export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  webServer: [
    ...(rendererUrl
      ? [
          {
            command: 'pnpm dev:renderer',
            url: rendererUrl,
            reuseExistingServer: true,
            timeout: 30_000
          }
        ]
      : []),
    {
      command: 'pnpm exec vite --config vite.renderer.config.ts --port 5199 --strictPort',
      url: MOCK_RENDERER_URL,
      reuseExistingServer: true,
      timeout: 30_000
    }
  ],
  projects: [
    {
      name: 'e2e',
      testDir: './tests/e2e'
    },
    {
      name: 'visual',
      testDir: './tests/visual',
      snapshotPathTemplate: '{testDir}/__screenshots__/{testFileName}/{arg}{ext}'
    }
  ]
})
