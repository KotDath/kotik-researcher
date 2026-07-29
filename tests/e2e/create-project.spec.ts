import { test, expect } from './fixtures/electron.fixture'
import { createProjectViaDialog, makeTempDir } from './helpers'

test('создание нового проекта через диалог выбора родительской папки', async ({
  electronApp,
  appWindow
}) => {
  const parentDir = makeTempDir('kotik-e2e-parent-')
  await createProjectViaDialog(electronApp, appWindow, parentDir, 'e2e-project')

  await expect(appWindow.getByTestId('project-name')).toHaveText('e2e-project')
  // openProject создаёт первый чат автоматически
  await expect(appWindow.getByTestId('chat-list-item').first()).toBeVisible()
  await expect(appWindow.getByTestId('chat-area')).toBeVisible()
})
