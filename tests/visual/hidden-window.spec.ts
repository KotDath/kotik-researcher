import { expect } from '@playwright/test'
import { test } from '../e2e/fixtures/electron.fixture'

// Доказательство решения B: в режиме --e2e окно скрыто (не крадёт фокус
// пользователя), но рендер полон — CDP Page.captureScreenshot берёт кадр из
// композитора независимо от видимости окна.
test(
  'скрытое окно: isVisible() === false, скриншот содержит полный рендер',
  async ({ electronApp, appWindow }) => {
    const handle = await electronApp.browserWindow(appWindow)
    expect(await handle.evaluate((bw) => bw.isVisible())).toBe(false)

    await expect(appWindow.getByTestId('project-picker')).toBeVisible()
    await expect(appWindow).toHaveScreenshot('hidden-window.png', {
      maxDiffPixelRatio: 0.001,
      animations: 'disabled',
      caret: 'hide'
    })
  }
)
