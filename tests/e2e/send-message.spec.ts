import { test, expect } from './fixtures/electron.fixture'
import { makeTempDir, openProjectViaDialog } from './helpers'

// В тестовом env API-ключи вырезаны (fixture), поэтому детерминированный исход —
// карточка ошибки; ответ ассистента тоже валиден, если ключи всё же настроены.
test('отправка сообщения: пузырь пользователя и ответ или карточка ошибки', async ({
  electronApp,
  appWindow
}) => {
  const projectDir = makeTempDir('kotik-e2e-send-')
  await openProjectViaDialog(electronApp, appWindow, projectDir)

  await appWindow.getByTestId('chat-input').fill('Привет, это smoke-тест')
  await appWindow.getByTestId('send-button').click()

  await expect(appWindow.getByTestId('message-user')).toHaveText('Привет, это smoke-тест')
  const outcome = appWindow
    .getByTestId('message-error')
    .or(appWindow.getByTestId('message-assistant'))
  await expect(outcome.first()).toBeVisible({ timeout: 45_000 })
})
