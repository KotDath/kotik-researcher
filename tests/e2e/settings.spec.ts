import { test, expect } from './fixtures/electron.fixture'

test('экран настроек: поля API-ключей и выбор модели', async ({ appWindow }) => {
  await appWindow.getByTestId('picker-settings-button').click()
  await expect(appWindow.getByTestId('settings-view')).toBeVisible()

  // настройки подгружаются из main (список провайдеров может занять время)
  await expect(appWindow.getByTestId('settings-loading')).toBeHidden({ timeout: 45_000 })
  await expect(appWindow.getByTestId('providers-section')).toBeVisible()

  // поле API-ключа встроенного провайдера: добавляем первого из каталога
  const addSelect = appWindow.getByTestId('add-provider-select')
  const firstOption = appWindow.getByTestId('add-provider-option').first()
  if ((await firstOption.count()) > 0) {
    await addSelect.selectOption(await firstOption.getAttribute('value'))
    await appWindow.getByTestId('add-provider-button').click()
    await expect(appWindow.getByTestId('api-key-input').first()).toBeVisible()
  }

  // поле API-ключа custom endpoint видно всегда + селект модели по умолчанию
  await expect(appWindow.getByTestId('custom-endpoint-apikey-input')).toBeVisible()
  await expect(appWindow.getByTestId('default-model-select')).toBeVisible()

  await appWindow.getByTestId('settings-close-footer-button').click()
  await expect(appWindow.getByTestId('settings-view')).toBeHidden()
})
