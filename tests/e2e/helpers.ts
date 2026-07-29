import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
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
 * Сид session-файла pi SDK в изолированный userData. Без LLM сессия на диск
 * не пишется вообще (SDK _persist требует assistant-сообщение), поэтому
 * сценариям «несколько чатов» нужен готовый файл. Формат — pi
 * CURRENT_SESSION_VERSION=3: header {type:'session'} + message-записи.
 */
export function seedChatSession(
  userDataDir: string,
  projectDir: string,
  seed: { userText: string; assistantText: string; modifiedAt: number }
): void {
  const safePath = `--${projectDir.replace(/^[/\\]/, '').replace(/[/\\:]/g, '-')}--`
  const dir = join(userDataDir, 'pi-agent', 'sessions', safePath)
  mkdirSync(dir, { recursive: true })
  const iso = new Date(seed.modifiedAt).toISOString()
  const sessionId = randomUUID()
  const file = join(dir, `${iso.replace(/[:.]/g, '-')}_${sessionId}.jsonl`)
  const entries = [
    { type: 'session', version: 3, id: sessionId, timestamp: iso, cwd: projectDir },
    {
      type: 'message',
      id: 'seed0001',
      parentId: null,
      timestamp: iso,
      message: {
        role: 'user',
        content: [{ type: 'text', text: seed.userText }],
        timestamp: seed.modifiedAt
      }
    },
    {
      type: 'message',
      id: 'seed0002',
      parentId: 'seed0001',
      timestamp: iso,
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: seed.assistantText }],
        timestamp: seed.modifiedAt,
        stopReason: 'stop'
      }
    }
  ]
  writeFileSync(file, entries.map((e) => JSON.stringify(e)).join('\n') + '\n')
  const mtime = new Date(seed.modifiedAt)
  utimesSync(file, mtime, mtime)
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
