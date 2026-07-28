import { useCallback, useEffect, useMemo, useState } from 'react'
import type {
  AppSettings,
  CustomProviderSettings,
  ProviderInfo,
  SettingsView as SettingsViewData,
  ThinkingLevelSetting
} from '../../../shared/ipc'

interface Props {
  onClose: () => void
}

function slugifyProviderId(name: string, existing: Set<string>): string {
  let id = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  if (!id) id = 'custom'
  if (/^[0-9]/.test(id)) id = `p-${id}`
  let candidate = id
  let n = 2
  while (existing.has(candidate)) {
    candidate = `${id}-${n}`
    n += 1
  }
  return candidate
}

/** Rejection ipcRenderer.invoke несёт технический префикс канала — срезаем его. */
function describeError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e)
  return msg.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}

function SettingsView({ onClose }: Props): React.JSX.Element {
  const [data, setData] = useState<SettingsViewData | null>(null)
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [addProviderId, setAddProviderId] = useState('')
  const [modelFilter, setModelFilter] = useState('')
  const [status, setStatus] = useState<string | null>(null)
  const [customDraft, setCustomDraft] = useState({ name: '', baseUrl: '', apiKey: '', models: '' })

  const load = useCallback(async (): Promise<void> => {
    setLoadError(null)
    try {
      const d = await window.api.settings.get()
      setData(d)
      setSettings(d.settings)
    } catch (e) {
      // ModelRuntime.create в main не кэширует неудачу — «Повторить» делает новую попытку
      setLoadError(describeError(e))
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const configuredProviderIds = useMemo(
    () =>
      new Set([
        ...Object.keys(settings?.providers ?? {}),
        ...(settings?.customProviders ?? []).map((c) => c.id)
      ]),
    [settings]
  )

  // встроенные id тоже заняты: custom endpoint с id встроенного провайдера
  // перезаписал бы его в models.json
  const takenProviderIds = useMemo(
    () => new Set([...configuredProviderIds, ...(data?.providers ?? []).map((p) => p.id)]),
    [configuredProviderIds, data]
  )

  if (loadError) {
    return (
      <div className="settings-overlay">
        <div className="settings">
          <div className="settings-header">
            <h2>Настройки</h2>
            <button className="btn btn-ghost" onClick={onClose}>
              ✕
            </button>
          </div>
          <div className="settings-warning">Не удалось загрузить настройки: {loadError}</div>
          <div className="settings-footer">
            <button className="btn" onClick={onClose}>
              Закрыть
            </button>
            <button className="btn btn-primary" onClick={() => void load()}>
              Повторить
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (!data || !settings) {
    return (
      <div className="settings-overlay">
        <div className="settings">Загрузка…</div>
      </div>
    )
  }

  const updateProvider = (providerId: string, patch: { apiKey?: string; baseUrl?: string }): void => {
    setSettings((s) =>
      s && {
        ...s,
        providers: {
          ...s.providers,
          [providerId]: { ...s.providers[providerId], ...patch }
        }
      }
    )
  }

  const removeProviderConfig = (providerId: string): void => {
    setSettings((s) => {
      if (!s) return s
      const providers = { ...s.providers }
      delete providers[providerId]
      const defaultModel =
        s.defaultModel?.providerId === providerId ? undefined : s.defaultModel
      return { ...s, providers, defaultModel }
    })
  }

  const addProvider = (): void => {
    if (!addProviderId) return
    updateProvider(addProviderId, {})
    setAddProviderId('')
  }

  const addCustomProvider = (): void => {
    const name = customDraft.name.trim()
    const baseUrl = customDraft.baseUrl.trim()
    const models = customDraft.models
      .split(',')
      .map((m) => m.trim())
      .filter(Boolean)
      .map((id) => ({ id }))
    if (!name || !baseUrl || models.length === 0) return
    const id = slugifyProviderId(name, takenProviderIds)
    const custom: CustomProviderSettings = {
      id,
      name,
      baseUrl,
      apiKey: customDraft.apiKey.trim() || undefined,
      models
    }
    setSettings((s) => s && { ...s, customProviders: [...s.customProviders, custom] })
    setCustomDraft({ name: '', baseUrl: '', apiKey: '', models: '' })
  }

  const removeCustomProvider = (id: string): void => {
    setSettings((s) =>
      s && {
        ...s,
        customProviders: s.customProviders.filter((c) => c.id !== id),
        defaultModel: s.defaultModel?.providerId === id ? undefined : s.defaultModel
      }
    )
  }

  const save = async (): Promise<void> => {
    setStatus(null)
    const res = await window.api.settings.set(settings)
    if (res.ok) {
      setStatus('Сохранено — применено к работающему приложению')
      try {
        setData(await window.api.settings.get())
      } catch {
        // настройки сохранены; список провайдеров перечитается при следующем открытии
      }
    } else {
      setStatus(`Ошибка сохранения: ${res.error}`)
    }
  }

  const builtinProviders = data.providers.filter((p) => !p.isCustom)
  const customProviderInfos = data.providers.filter((p) => p.isCustom)
  const modelProviders: ProviderInfo[] = [...customProviderInfos, ...builtinProviders].filter(
    (p) => p.models.length > 0
  )
  const filter = modelFilter.trim().toLowerCase()

  /** Селектор уровня thinking per provider: СТРОГО off + уровни текущей модели
   * (настройка видна всегда, в т.ч. для модели без поддержки thinking). */
  const renderThinkingLevelField = (providerId: string): React.JSX.Element => {
    const info = data.providers.find((p) => p.id === providerId)
    const saved = settings.thinkingLevels?.[providerId]
    // список — только возможности текущей модели; сохранённый уровень, которого
    // нет в списке (смена модели), показываем выключенной помеченной опцией —
    // SDK клампит его при применении (decisions.md)
    const levels = [
      ...new Set<ThinkingLevelSetting>([
        'off',
        ...((info?.availableThinkingLevels ?? []) as ThinkingLevelSetting[])
      ])
    ]
    const savedStale = saved !== undefined && !levels.includes(saved)
    // без сохранённого выбора показываем тот же дефолт, что применит main-side
    // resolveThinkingLevel: первый из low/medium, иначе первый не-off
    const effective =
      saved ??
      (levels.find((l) => l === 'low' || l === 'medium') ??
        levels.find((l) => l !== 'off') ??
        'off')
    return (
      <label className="settings-field">
        <span>Уровень thinking</span>
        <select
          className="input"
          value={effective}
          onChange={(e) => {
            const value = e.target.value as ThinkingLevelSetting
            setSettings(
              (s) =>
                s && { ...s, thinkingLevels: { ...s.thinkingLevels, [providerId]: value } }
            )
          }}
        >
          {levels.map((level) => (
            <option key={level} value={level}>
              {level}
            </option>
          ))}
          {savedStale && (
            <option value={saved} disabled>
              {saved} (не поддерживается моделью)
            </option>
          )}
        </select>
      </label>
    )
  }

  return (
    <div className="settings-overlay">
      <div className="settings">
        <div className="settings-header">
          <h2>Настройки</h2>
          <button className="btn btn-ghost" onClick={onClose}>
            ✕
          </button>
        </div>

        {!data.encryptionAvailable && (
          <div className="settings-warning">
            ⚠ Шифрование недоступно в этой ОС (нет системного keyring). API-ключи будут
            храниться в файле без шифрования (доступ только для владельца, 0600).
          </div>
        )}

        <section className="settings-section">
          <h3>Провайдеры LLM</h3>
          {[...configuredProviderIds].map((providerId) => {
            const info = data.providers.find((p) => p.id === providerId)
            if (!info || info.isCustom) return null
            const cfg = settings.providers[providerId] ?? {}
            return (
              <div key={providerId} className="settings-provider">
                <div className="settings-provider-head">
                  <strong>{info.name}</strong>
                  <code>{providerId}</code>
                  <button
                    className="btn btn-ghost btn-sm"
                    title="Убрать ключ и base-url"
                    onClick={() => removeProviderConfig(providerId)}
                  >
                    ✕
                  </button>
                </div>
                <label className="settings-field">
                  <span>API-ключ</span>
                  <input
                    className="input"
                    type="password"
                    placeholder="sk-…"
                    value={cfg.apiKey ?? ''}
                    onChange={(e) =>
                      updateProvider(providerId, { apiKey: e.target.value || undefined })
                    }
                  />
                </label>
                <label className="settings-field">
                  <span>Base URL (необязательно)</span>
                  <input
                    className="input"
                    placeholder="https://…"
                    value={cfg.baseUrl ?? ''}
                    onChange={(e) =>
                      updateProvider(providerId, { baseUrl: e.target.value || undefined })
                    }
                  />
                </label>
                {renderThinkingLevelField(providerId)}
              </div>
            )
          })}
          <div className="settings-add-provider">
            <select
              className="input"
              value={addProviderId}
              onChange={(e) => setAddProviderId(e.target.value)}
            >
              <option value="">Добавить провайдера…</option>
              {builtinProviders
                .filter((p) => !configuredProviderIds.has(p.id))
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.id})
                  </option>
                ))}
            </select>
            <button className="btn" onClick={addProvider} disabled={!addProviderId}>
              Добавить
            </button>
          </div>
        </section>

        <section className="settings-section">
          <h3>Свои endpoints (OpenAI-compatible)</h3>
          {settings.customProviders.map((cp) => (
            <div key={cp.id} className="settings-provider">
              <div className="settings-provider-head">
                <strong>{cp.name}</strong>
                <code>{cp.id}</code>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => removeCustomProvider(cp.id)}
                >
                  ✕
                </button>
              </div>
              <div className="settings-custom-summary">
                {cp.baseUrl} · модели: {cp.models.map((m) => m.id).join(', ')}
                {cp.apiKey ? ' · ключ задан' : ''}
              </div>
              {renderThinkingLevelField(cp.id)}
            </div>
          ))}
          <div className="settings-custom-form">
            <input
              className="input"
              placeholder="Название (например, Ollama)"
              value={customDraft.name}
              onChange={(e) => setCustomDraft({ ...customDraft, name: e.target.value })}
            />
            <input
              className="input"
              placeholder="Base URL (http://localhost:11434/v1)"
              value={customDraft.baseUrl}
              onChange={(e) => setCustomDraft({ ...customDraft, baseUrl: e.target.value })}
            />
            <input
              className="input"
              type="password"
              placeholder="API-ключ (необязательно)"
              value={customDraft.apiKey}
              onChange={(e) => setCustomDraft({ ...customDraft, apiKey: e.target.value })}
            />
            <input
              className="input"
              placeholder="Модели через запятую (qwen3:8b, llama3.1)"
              value={customDraft.models}
              onChange={(e) => setCustomDraft({ ...customDraft, models: e.target.value })}
            />
            <button className="btn" onClick={addCustomProvider}>
              Добавить endpoint
            </button>
          </div>
        </section>

        <section className="settings-section">
          <h3>Модель по умолчанию</h3>
          <input
            className="input"
            placeholder="Фильтр моделей…"
            value={modelFilter}
            onChange={(e) => setModelFilter(e.target.value)}
          />
          <select
            className="input settings-model-select"
            value={settings.defaultModel ? `${settings.defaultModel.providerId}/${settings.defaultModel.modelId}` : ''}
            onChange={(e) => {
              const value = e.target.value
              setSettings((s) => {
                if (!s) return s
                if (!value) return { ...s, defaultModel: undefined }
                const [providerId, modelId] = value.split('/')
                return { ...s, defaultModel: { providerId, modelId } }
              })
            }}
          >
            <option value="">Автоматически (первая доступная)</option>
            {modelProviders.map((p) => {
              const models = filter
                ? p.models.filter((m) => `${m.id} ${m.name}`.toLowerCase().includes(filter))
                : p.models
              if (models.length === 0) return null
              return (
                <optgroup key={p.id} label={`${p.name} (${p.id})`}>
                  {models.map((m) => (
                    <option key={m.id} value={`${p.id}/${m.id}`}>
                      {m.name}
                    </option>
                  ))}
                </optgroup>
              )
            })}
          </select>
        </section>

        <div className="settings-footer">
          {status && <span className="settings-status">{status}</span>}
          <button className="btn" onClick={onClose}>
            Закрыть
          </button>
          <button className="btn btn-primary" onClick={() => void save()}>
            Сохранить
          </button>
        </div>
      </div>
    </div>
  )
}

export default SettingsView
