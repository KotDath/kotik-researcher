import { test, expect } from './fixtures/electron.fixture'
import { makeTempDir, openProjectViaDialog } from './helpers'

test('навигация по чатам: создание и переключение', async ({ electronApp, appWindow }) => {
  const projectDir = makeTempDir('kotik-e2e-chats-')
  await openProjectViaDialog(electronApp, appWindow, projectDir)

  // первый чат создан автоматически; пустой чат живёт только в памяти
  // (disposeIfIdle при переключении), поэтому сначала пишем в него сообщение —
  // сессия сохраняется на диск, и чат закрепляется в списке
  const items = appWindow.getByTestId('chat-list-item')
  await expect(items).toHaveCount(1)
  await appWindow.getByTestId('chat-input').fill('первое сообщение')
  await appWindow.getByTestId('send-button').click()
  const outcome = appWindow
    .getByTestId('message-error')
    .or(appWindow.getByTestId('message-assistant'))
  await expect(outcome.first()).toBeVisible({ timeout: 45_000 })

  await appWindow.getByTestId('new-chat-button').click()
  await expect(items).toHaveCount(2)

  // новый чат стал активным; переключаемся на первый и обратно
  const first = items.nth(0)
  const second = items.nth(1)
  await expect(first).toHaveClass(/active/)

  await second.getByTestId('chat-item-select').click()
  await expect(second).toHaveClass(/active/)
  await expect(appWindow.getByTestId('chat-area')).toBeVisible()

  await first.getByTestId('chat-item-select').click()
  await expect(first).toHaveClass(/active/)
})
