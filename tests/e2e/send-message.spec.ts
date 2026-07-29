import { test, expect } from './fixtures/electron.fixture'
import { makeTempDir, openProjectViaDialog } from './helpers'

// Тестовый env — allowlist без credentials (fixture), реальный сетевой вызов
// LLM исключён: детерминированный исход — карточка ошибки провайдера.
test('отправка сообщения: пузырь пользователя и карточка ошибки провайдера', async ({
  electronApp,
  appWindow
}) => {
  const projectDir = makeTempDir('kotik-e2e-send-')
  await openProjectViaDialog(electronApp, appWindow, projectDir)

  await appWindow.getByTestId('chat-input').fill('Привет, это smoke-тест')
  await appWindow.getByTestId('send-button').click()

  await expect(appWindow.getByTestId('message-user')).toHaveText('Привет, это smoke-тест')
  await expect(appWindow.getByTestId('message-error')).toBeVisible({ timeout: 45_000 })
})
