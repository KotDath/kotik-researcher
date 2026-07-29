import { createMockApi, type MockMode } from '../../preload/mock-api'

export type { MockMode }

/**
 * Установка мокового window.api в renderer-only режиме (`pnpm dev:renderer`
 * или ?mockApi=…), где preload отсутствует. Реализация — та же, что у
 * preload-мока (src/preload/mock-api.ts), чтобы быстрый агентский режим и
 * visual-тесты смотрели на идентичные состояния.
 */
export function installMockApi(mode: MockMode = 'demo'): void {
  const api = createMockApi(mode)
  if (api) window.api = api
}
