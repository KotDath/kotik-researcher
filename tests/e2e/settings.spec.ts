import { test, expect } from './fixtures/electron.fixture'

test('экран настроек: поля API-ключей и выбор модели', async ({ appWindow }) => {
  await appWindow.getByTestId('picker-settings-button').click()
  await expect(appWindow.getByTestId('settings-view')).toBeVisible()

  // настройки подгружаются из main (список провайдеров может занять время)
  await expect(appWindow.getByTestId('settings-loading')).toBeHidden({ timeout: 45_000 })
  await expect(appWindow.getByTestId('providers-section')).toBeVisible()

  // поле API-ключа встроенного провайдера: добавляем первого из каталога
  const addSelect = appWindow.getByTestId('providers-section').locator('select').first()
  const firstProvider = addSelect.locator('option').nth(1)
  if ((await firstProvider.count()) > 0) {
    await addSelect.selectOption({ index: 1 })
    await appWindow.getByRole('button', { name: 'Добавить', exact: true }).click()
    await expect(appWindow.getByTestId('api-key-input').first()).toBeVisible()
  }

  // поле API-ключа custom endpoint видно всегда + селект модели по умолчанию
  await expect(appWindow.locator('input[type="password"]').first()).toBeVisible()
  await expect(appWindow.getByTestId('default-model-select')).toBeVisible()

  await appWindow.getByRole('button', { name: 'Закрыть', exact: true }).click()
  await expect(appWindow.getByTestId('settings-view')).toBeHidden()
})
