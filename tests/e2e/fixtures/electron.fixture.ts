import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  _electron as electron,
  test as base,
  type ElectronApplication,
  type Page
} from '@playwright/test'

const MAIN_ENTRY = './out/main/index.mjs'

// Тестовый env без API-ключей: smoke-тест отправки сообщения обязан
// детерминированно завершаться карточкой ошибки, а не сетевым вызовом LLM.
function testEnv(userDataDir: string): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined || /_API_KEY$/.test(key)) continue
    env[key] = value
  }
  env.NODE_ENV = 'test'
  env.E2E_USER_DATA_DIR = userDataDir
  if (process.env.E2E_RENDERER_URL) {
    env.ELECTRON_RENDERER_URL = process.env.E2E_RENDERER_URL
  }
  return env
}

/**
 * Запуск приложения с изолированным userData (main читает --e2e и
 * E2E_USER_DATA_DIR в paths.ts). Возвращает и userDataDir — сценариям
 * «перезапуск» нужно переиспользовать ту же директорию.
 */
export async function launchApp(
  userDataDir: string = mkdtempSync(join(tmpdir(), 'kotik-e2e-'))
): Promise<{ electronApp: ElectronApplication; userDataDir: string }> {
  if (!existsSync(MAIN_ENTRY)) {
    throw new Error(
      `${MAIN_ENTRY} не найден. Сначала выполните "pnpm build" (полный цикл: "pnpm test:e2e") ` +
        'или запустите "pnpm dev", чтобы electron-vite собрал main/preload в out/.'
    )
  }
  const electronApp = await electron.launch({
    args: [MAIN_ENTRY, '--e2e'],
    env: testEnv(userDataDir)
  })
  return { electronApp, userDataDir }
}

/** Стабилизация рендера (design.md, решение 9): шрифты, анимации, размер окна. */
export async function stabilizeWindow(window: Page): Promise<void> {
  await window.waitForLoadState('domcontentloaded')
  await window.evaluate(async () => {
    await document.fonts.ready
  })
  await window.addStyleTag({
    content:
      '*, *::before, *::after { animation-duration: 0s !important; ' +
      'animation-delay: 0s !important; transition-duration: 0s !important; ' +
      'caret-color: transparent !important; }'
  })
  await window.setViewportSize({ width: 1280, height: 800 })
}

export const test = base.extend<{ electronApp: ElectronApplication; appWindow: Page }>({
  electronApp: async (_fixtures, use) => {
    const { electronApp, userDataDir } = await launchApp()
    await use(electronApp)
    await electronApp.close()
    rmSync(userDataDir, { recursive: true, force: true })
  },
  appWindow: async ({ electronApp }, use) => {
    const window = await electronApp.firstWindow()
    await stabilizeWindow(window)
    await use(window)
  }
})

export { expect } from '@playwright/test'
