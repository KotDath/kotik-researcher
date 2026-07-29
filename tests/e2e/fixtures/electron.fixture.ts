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

// Тестовый env — allowlist, а не denylist (review-fix): denylist *_API_KEY
// пропускал бы *_TOKEN/*_SECRET/AWS-креды к реальному SDK → сетевые вызовы.
// Передаём только то, что нужно Electron для запуска на linux-десктопе.
const ENV_ALLOWLIST = [
  'PATH',
  'HOME',
  'USER',
  'LOGNAME',
  'SHELL',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'TERM',
  'TMPDIR',
  'DISPLAY',
  'WAYLAND_DISPLAY',
  'XAUTHORITY',
  'XDG_RUNTIME_DIR',
  'XDG_SESSION_TYPE',
  'DBUS_SESSION_BUS_ADDRESS'
]

function testEnv(userDataDir: string, extraEnv: Record<string, string> = {}): Record<string, string> {
  const env: Record<string, string> = {}
  for (const key of ENV_ALLOWLIST) {
    const value = process.env[key]
    if (value !== undefined) env[key] = value
  }
  env.NODE_ENV = 'test'
  env.E2E_USER_DATA_DIR = userDataDir
  if (process.env.E2E_RENDERER_URL) {
    env.ELECTRON_RENDERER_URL = process.env.E2E_RENDERER_URL
  }
  return { ...env, ...extraEnv }
}

/**
 * Запуск приложения с изолированным userData (main читает --e2e и
 * E2E_USER_DATA_DIR в paths.ts). Возвращает и userDataDir — сценариям
 * «перезапуск» нужно переиспользовать ту же директорию. extraEnv — для
 * visual-тестов состояний (E2E_MOCK_API, preload читает его и подменяет api).
 */
export async function launchApp(
  userDataDir: string = mkdtempSync(join(tmpdir(), 'kotik-e2e-')),
  extraEnv: Record<string, string> = {}
): Promise<{ electronApp: ElectronApplication; userDataDir: string }> {
  if (!existsSync(MAIN_ENTRY)) {
    throw new Error(
      `${MAIN_ENTRY} не найден. Сначала выполните "pnpm build" (полный цикл: "pnpm test:e2e") ` +
        'или запустите "pnpm dev", чтобы electron-vite собрал main/preload в out/.'
    )
  }
  const electronApp = await electron.launch({
    args: [MAIN_ENTRY, '--e2e'],
    env: testEnv(userDataDir, extraEnv)
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
  // eslint-disable-next-line no-empty-pattern -- Playwright требует деструктуризацию первого аргумента fixture
  electronApp: async ({}, use) => {
    const { electronApp, userDataDir } = await launchApp()
    try {
      await use(electronApp)
    } finally {
      await electronApp.close().catch(() => {})
      rmSync(userDataDir, { recursive: true, force: true })
    }
  },
  appWindow: async ({ electronApp }, use) => {
    const window = await electronApp.firstWindow()
    await stabilizeWindow(window)
    await use(window)
  }
})

export { expect } from '@playwright/test'
