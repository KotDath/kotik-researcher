import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launchApp, stabilizeWindow } from './fixtures/electron.fixture'
import { expect, test } from '@playwright/test'
import { makeTempDir, openProjectViaDialog } from './helpers'

// Два запуска приложения на одном userData: проект переживает перезапуск.
test('восстановление: проект в списке недавних после перезапуска', async () => {
  const userDataDir = mkdtempSync(join(tmpdir(), 'kotik-e2e-restart-'))
  const projectDir = makeTempDir('kotik-e2e-recent-')
  try {
    const first = await launchApp(userDataDir)
    const firstWindow = await first.electronApp.firstWindow()
    await stabilizeWindow(firstWindow)
    await openProjectViaDialog(first.electronApp, firstWindow, projectDir)
    await first.electronApp.close()

    const second = await launchApp(userDataDir)
    const secondWindow = await second.electronApp.firstWindow()
    await stabilizeWindow(secondWindow)

    // текущий проект не персистится — стартуем с picker, где есть недавние
    await expect(secondWindow.getByTestId('project-picker')).toBeVisible()
    const recentItem = secondWindow.getByTestId('recent-project-item')
    await expect(recentItem).toHaveCount(1)

    await recentItem.getByTestId('recent-project-open').click()
    await expect(secondWindow.getByTestId('main-layout')).toBeVisible()
    await second.electronApp.close()
  } finally {
    rmSync(userDataDir, { recursive: true, force: true })
    rmSync(projectDir, { recursive: true, force: true })
  }
})
