import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { launchApp, stabilizeWindow } from '../e2e/fixtures/electron.fixture'
import { makeTempDir, mockOpenDialog, openProjectViaDialog } from '../e2e/helpers'

// Все visual-тесты — внутри Electron через общий fixture (_electron.launch +
// стабилизация), включая мок-состояния: preload подменяет window.api по env
// E2E_MOCK_API (src/preload/index.ts), поэтому read-only contextBridge-мост
// не мешает.
const SHOT = {
  maxDiffPixelRatio: 0.001,
  animations: 'disabled',
  caret: 'hide'
} as const

type MockMode = 'loading' | 'demo' | 'error'

async function withApp(
  extraEnv: Record<string, string>,
  run: (window: Page, electronApp: ElectronApplication) => Promise<void>
): Promise<void> {
  const userDataDir = mkdtempSync(join(tmpdir(), 'kotik-visual-'))
  const { electronApp } = await launchApp(userDataDir, extraEnv)
  try {
    const window = await electronApp.firstWindow()
    await stabilizeWindow(window)
    await run(window, electronApp)
  } finally {
    await electronApp.close().catch(() => {})
    rmSync(userDataDir, { recursive: true, force: true })
  }
}

const withRealApp = (run: (window: Page, electronApp: ElectronApplication) => Promise<void>) =>
  withApp({}, run)

const withMockApp = (mode: MockMode, run: (window: Page) => Promise<void>) =>
  withApp({ E2E_MOCK_API: mode }, (window) => run(window))

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
      mask: [window.getByTestId('create-form-parent')]
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

test('5.7 пустое состояние: стартовый экран без проектов', async () => {
  // изолированный userData без recent-projects.json — настоящее состояние
  // «нет проектов»: действия есть, истории нет
  await withRealApp(async (window) => {
    await expect(window.getByTestId('project-picker')).toBeVisible()
    await expect(window.getByTestId('recent-projects-list')).toBeHidden()
    await expect(window).toHaveScreenshot('empty-state.png', SHOT)
  })
})

test('5.8 пустой список чатов: поиск без совпадений', async () => {
  // «Чатов нет» через удаление недостижимо: удаление последнего активного чата
  // в main автоматически создаёт новый (deleteChat → createChatInternal)
  await withRealApp(async (window, electronApp) => {
    await openProjectViaDialog(electronApp, window, fixedProjectDir('kotik-visual-empty-project'))
    await expect(window.getByTestId('chat-list-item')).toHaveCount(1)
    await window.getByTestId('chat-search-input').fill('zzz-no-match')
    await expect(window.getByTestId('chat-list-empty')).toBeVisible()
    await expect(window).toHaveScreenshot('empty-search.png', {
      ...SHOT,
      mask: [window.getByTestId('chat-list-date')]
    })
  })
})
