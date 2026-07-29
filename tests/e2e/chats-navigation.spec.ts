import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launchApp, stabilizeWindow } from './fixtures/electron.fixture'
import { expect, test } from '@playwright/test'
import { makeTempDir, openProjectViaDialog, seedChatSession } from './helpers'

// Без LLM сессия на диск не пишется (SDK _persist требует assistant-сообщение),
// а незаписанный чат исчезает из списка при переключении (disposeIfIdle).
// Поэтому детерминированная навигация — по двум посеянным сессиям.
test('навигация по чатам: список и переключение между двумя чатами', async () => {
  const userDataDir = mkdtempSync(join(tmpdir(), 'kotik-e2e-chats-'))
  const projectDir = makeTempDir('kotik-e2e-chats-project-')
  try {
    seedChatSession(userDataDir, projectDir, {
      userText: 'Старый вопрос',
      assistantText: 'Старый ответ',
      modifiedAt: Date.now() - 3_600_000
    })
    seedChatSession(userDataDir, projectDir, {
      userText: 'Новый вопрос',
      assistantText: 'Новый ответ',
      modifiedAt: Date.now()
    })

    const { electronApp } = await launchApp(userDataDir)
    try {
      const window = await electronApp.firstWindow()
      await stabilizeWindow(window)
      await openProjectViaDialog(electronApp, window, projectDir)

      // список отсортирован по активности: новее — выше; openProject делает
      // активным первый (свежий) чат
      const items = window.getByTestId('chat-list-item')
      await expect(items).toHaveCount(2)
      await expect(items.nth(0)).toContainText('Новый вопрос')
      await expect(items.nth(1)).toContainText('Старый вопрос')

      // наблюдаемый контракт активности — aria-current, не внутренний CSS-класс
      const first = items.nth(0).getByTestId('chat-item-select')
      const second = items.nth(1).getByTestId('chat-item-select')
      await expect(first).toHaveAttribute('aria-current', 'true')

      await second.click()
      await expect(second).toHaveAttribute('aria-current', 'true')
      await expect(window.getByTestId('chat-area')).toBeVisible()
      await expect(window.getByTestId('message-user')).toHaveText('Старый вопрос')

      await first.click()
      await expect(first).toHaveAttribute('aria-current', 'true')
      await expect(window.getByTestId('message-user')).toHaveText('Новый вопрос')
    } finally {
      await electronApp.close().catch(() => {})
    }
  } finally {
    rmSync(userDataDir, { recursive: true, force: true })
    rmSync(projectDir, { recursive: true, force: true })
  }
})
