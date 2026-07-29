import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { launchApp, stabilizeWindow } from '../e2e/fixtures/electron.fixture'
import { makeTempDir, mockOpenDialog, openProjectViaDialog } from '../e2e/helpers'

// Мок-renderer для состояний, недетерминированных в реальном main
// (playwright.config.ts поднимает его на :5199 как webServer). Это renderer-only
// сценарии — гоняем их в обычном Chromium: preload в Electron экспонирует
// read-only window.api, мок его не подменит.
const MOCK_URL = 'http://localhost:5199'

const SHOT = {
  maxDiffPixelRatio: 0.001,
  animations: 'disabled',
  caret: 'hide'
} as const

async function withRealApp(
  run: (window: Page, electronApp: ElectronApplication) => Promise<void>
): Promise<void> {
  const userDataDir = mkdtempSync(join(tmpdir(), 'kotik-visual-'))
  const { electronApp } = await launchApp(userDataDir)
  try {
    const window = await electronApp.firstWindow()
    await stabilizeWindow(window)
    await run(window, electronApp)
  } finally {
    await electronApp.close()
    rmSync(userDataDir, { recursive: true, force: true })
  }
}

async function withMockApp(mode: 'loading' | 'demo' | 'error', run: (window: Page) => Promise<void>): Promise<void> {
  const browser = await chromium.launch()
  try {
    const window = await browser.newPage({ viewport: { width: 1280, height: 800 } })
    await window.goto(`${MOCK_URL}/?mockApi=${mode}`)
    await window.evaluate(async () => {
      await document.fonts.ready
    })
    await window.addStyleTag({
      content:
        '*, *::before, *::after { animation-duration: 0s !important; ' +
        'animation-delay: 0s !important; transition-duration: 0s !important; ' +
        'caret-color: transparent !important; }'
    })
    await run(window)
  } finally {
    await browser.close()
  }
}

// Фиксированные имена проектов: mkdtemp-суффикс дал бы динамический регион
// в заголовке сайдбара на каждом прогоне.
function fixedProjectDir(name: string): string {
  const dir = join(tmpdir(), name)
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  return dir
}

test('5.1 главное окно: layout с пустым чатом', async () => {
  await withRealApp(async (window, electronApp) => {
    await openProjectViaDialog(electronApp, window, fixedProjectDir('kotik-visual-demo-project'))
    await expect(window.getByTestId('chat-placeholder')).toBeVisible()
    await expect(window).toHaveScreenshot('main-window.png', {
      ...SHOT,
      mask: [window.getByTestId('chat-list-date')]
    })
  })
})

test('5.2 чат с историей сообщений (user / thinking / tool / assistant)', async () => {
  await withMockApp('demo', async (window) => {
    await expect(window.getByTestId('message-assistant')).toBeVisible()
    await expect(window).toHaveScreenshot('chat-history.png', {
      ...SHOT,
      mask: [window.getByTestId('chat-list-date')]
    })
  })
})

test('5.3 экран настроек', async () => {
  await withRealApp(async (window) => {
    await window.getByTestId('picker-settings-button').click()
    await expect(window.getByTestId('settings-loading')).toBeHidden({ timeout: 45_000 })
    await expect(window.getByTestId('providers-section')).toBeVisible()
    await expect(window).toHaveScreenshot('settings.png', SHOT)
  })
})

test('5.4 модальная форма создания проекта', async () => {
  await withRealApp(async (window, electronApp) => {
    await mockOpenDialog(electronApp, [makeTempDir('kotik-visual-parent-')])
    await window.getByTestId('create-project-button').click()
    await expect(window.getByTestId('create-project-form')).toBeVisible()
    await window.getByTestId('project-name-input').fill('visual-demo')
    await expect(window).toHaveScreenshot('create-project-modal.png', {
      ...SHOT,
      // путь родительской папки содержит mkdtemp-суффикс — динамический регион
      mask: [window.locator('.picker-create-parent')]
    })
  })
})

test('5.5 состояние загрузки приложения', async () => {
  await withMockApp('loading', async (window) => {
    await expect(window.getByTestId('app-loading')).toBeVisible()
    await expect(window).toHaveScreenshot('app-loading.png', SHOT)
  })
})

test('5.6 карточка ошибки в чате', async () => {
  await withMockApp('error', async (window) => {
    await expect(window.getByTestId('message-error')).toBeVisible()
    await expect(window).toHaveScreenshot('chat-error.png', {
      ...SHOT,
      mask: [window.getByTestId('chat-list-date')]
    })
  })
})

test('5.7 пустое состояние: поиск чатов без совпадений', async () => {
  await withRealApp(async (window, electronApp) => {
    await openProjectViaDialog(electronApp, window, fixedProjectDir('kotik-visual-empty-project'))
    await expect(window.getByTestId('chat-list-item')).toHaveCount(1)
    // «Чатов нет» через удаление недостижимо: удаление последнего активного чата
    // в main автоматически создаёт новый (deleteChat → createChatInternal)
    await window.getByTestId('chat-search-input').fill('zzz-no-match')
    await expect(window.getByTestId('chat-list-empty')).toBeVisible()
    await expect(window).toHaveScreenshot('empty-state.png', {
      ...SHOT,
      mask: [window.getByTestId('chat-list-date')]
    })
  })
})
