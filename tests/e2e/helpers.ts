import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ElectronApplication, Page } from '@playwright/test'
import { expect } from '@playwright/test'

/** Playwright не перехватывает системные диалоги ОС — подменяем их в main-процессе. */
export async function mockOpenDialog(electronApp: ElectronApplication, filePaths: string[]): Promise<void> {
  await electronApp.evaluate(({ dialog }, paths) => {
    dialog.showOpenDialog = (() =>
      Promise.resolve({ canceled: false, filePaths: paths })) as typeof dialog.showOpenDialog
  }, filePaths)
}

export function makeTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

/**
 * Открывает существующую директорию как проект через замоканный диалог
 * и дожидается главного layout.
 */
export async function openProjectViaDialog(
  electronApp: ElectronApplication,
  window: Page,
  projectDir: string
): Promise<void> {
  await mockOpenDialog(electronApp, [projectDir])
  await window.getByTestId('open-project-button').click()
  await expect(window.getByTestId('main-layout')).toBeVisible()
}

/** Создаёт проект через UI (pickParent → форма → submit) и ждёт главный layout. */
export async function createProjectViaDialog(
  electronApp: ElectronApplication,
  window: Page,
  parentDir: string,
  name: string
): Promise<void> {
  await mockOpenDialog(electronApp, [parentDir])
  await window.getByTestId('create-project-button').click()
  await expect(window.getByTestId('create-project-form')).toBeVisible()
  await window.getByTestId('project-name-input').fill(name)
  await window.getByTestId('confirm-create-button').click()
  await expect(window.getByTestId('main-layout')).toBeVisible()
}
