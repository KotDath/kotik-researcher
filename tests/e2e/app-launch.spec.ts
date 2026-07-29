import { test, expect } from './fixtures/electron.fixture'
import { makeTempDir, openProjectViaDialog } from './helpers'

test.describe('запуск приложения', () => {
  test('показывает заголовок и welcome-экран выбора проекта', async ({ appWindow }) => {
    await expect(appWindow).toHaveTitle('Kotik Researcher')
    await expect(appWindow.getByTestId('project-picker')).toBeVisible()
  })

  test('после открытия проекта показывает главный layout', async ({
    electronApp,
    appWindow
  }) => {
    const projectDir = makeTempDir('kotik-e2e-project-')
    await openProjectViaDialog(electronApp, appWindow, projectDir)
    await expect(appWindow.getByTestId('main-layout')).toBeVisible()
    await expect(appWindow.getByTestId('sidebar')).toBeVisible()
  })
})
