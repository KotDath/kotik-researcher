import { basename } from 'node:path'
import { test, expect } from './fixtures/electron.fixture'
import { makeTempDir, openProjectViaDialog } from './helpers'

test('открытие существующего проекта через замоканный диалог', async ({
  electronApp,
  appWindow
}) => {
  const projectDir = makeTempDir('kotik-e2e-existing-')
  await openProjectViaDialog(electronApp, appWindow, projectDir)

  await expect(appWindow.getByTestId('project-name')).toHaveText(basename(projectDir))
  await expect(appWindow.getByTestId('chat-area')).toBeVisible()
})
