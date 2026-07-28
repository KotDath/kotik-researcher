import { writeJsonFileAtomic } from '../json-file'
import type { AppSettings } from '../../shared/ipc'

interface ModelsJsonProvider {
  name?: string
  baseUrl?: string
  api?: string
  models?: Array<{
    id: string
    name?: string
    contextWindow?: number
    maxTokens?: number
  }>
}

/**
 * Пересобирает models.json для pi из настроек приложения (design.md, решение 3):
 * base-url для встроенных провайдеров и custom OpenAI-compatible endpoints.
 * Ключи сюда НЕ пишем — они пробрасываются через setRuntimeApiKey.
 */
export function writeModelsJson(modelsPath: string, settings: AppSettings): void {
  const providers: Record<string, ModelsJsonProvider> = {}

  for (const [providerId, p] of Object.entries(settings.providers)) {
    if (p.baseUrl) {
      providers[providerId] = { ...providers[providerId], baseUrl: p.baseUrl }
    }
  }

  for (const cp of settings.customProviders) {
    providers[cp.id] = {
      name: cp.name,
      baseUrl: cp.baseUrl,
      api: 'openai-completions',
      models: cp.models.map((m) => ({
        id: m.id,
        name: m.name ?? m.id,
        // дефолты для локальных моделей; неверная оценка окна всплывёт ошибкой провайдера
        contextWindow: 32768,
        maxTokens: 8192
      }))
    }
  }

  writeJsonFileAtomic(modelsPath, { providers })
}
