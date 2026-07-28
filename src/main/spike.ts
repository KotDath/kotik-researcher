import { app } from 'electron'
import { mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createAgentSession, ModelRuntime, SessionManager } from '@earendil-works/pi-coding-agent'
import { dataPaths } from './paths'
import { ChatManager } from './pi/chat-manager'
import type { SettingsStore } from './settings-store'
import type { AppSettings, ChatEvent } from '../shared/ipc'

/**
 * Спайк (tasks 1.3/1.6): изолированный каталог данных pi, сессия в тестовой
 * директории, один prompt → ответ LLM. Запуск: SPIKE_HEADLESS=1 (+ ключ
 * провайдера в env, например DEEPSEEK_API_KEY). Работает и в dev, и в
 * упакованной сборке — это критерий приёмки нативного риска.
 */
export async function runSpike(): Promise<number> {
  const log = (msg: string): void => console.log(`[spike] ${msg}`)
  try {
    const testDir = join(app.getPath('userData'), 'spike-project')
    mkdirSync(testDir, { recursive: true })
    log(`agentDir=${dataPaths.agentDir}`)
    log(`cwd=${testDir}`)

    const modelRuntime = await ModelRuntime.create({
      authPath: dataPaths.authPath,
      modelsPath: dataPaths.modelsPath
    })

    const envKey = process.env.DEEPSEEK_API_KEY
    if (!envKey) {
      log('SPIKE FAIL: DEEPSEEK_API_KEY не задан в окружении')
      return 2
    }
    await modelRuntime.setRuntimeApiKey('deepseek', envKey)

    const model = modelRuntime.getModel('deepseek', 'deepseek-v4-flash')
    if (!model) {
      log('SPIKE FAIL: модель deepseek/deepseek-v4-flash не найдена в каталоге')
      return 2
    }

    const sessionManager = SessionManager.create(testDir)
    const { session } = await createAgentSession({
      cwd: testDir,
      agentDir: dataPaths.agentDir,
      modelRuntime,
      sessionManager,
      model
    })
    log(`sessionFile=${session.sessionFile ?? '<none>'}`)

    let text = ''
    let failed: string | null = null
    session.subscribe((event) => {
      if (event.type === 'message_update' && event.assistantMessageEvent.type === 'text_delta') {
        text += event.assistantMessageEvent.delta
      }
      if (event.type === 'tool_execution_start') {
        log(`tool: ${event.toolName}`)
      }
      if (event.type === 'agent_end' && !event.willRetry) {
        const last = [...event.messages].reverse().find((m) => m.role === 'assistant')
        if (last && last.role === 'assistant' && last.stopReason === 'error') {
          failed = last.errorMessage ?? 'provider error'
        }
      }
    })

    await session.prompt('Reply with exactly: SPIKE_OK')
    session.dispose()

    if (failed) {
      log(`SPIKE FAIL: ${failed}`)
      return 1
    }
    log(`ответ LLM: ${JSON.stringify(text)}`)
    log(text.includes('SPIKE_OK') ? 'SPIKE SUCCESS' : 'SPIKE UNCERTAIN (ответ без маркера)')
    return text.includes('SPIKE_OK') ? 0 : 3
  } catch (e) {
    console.error(`[spike] SPIKE FAIL: ${e instanceof Error ? (e.stack ?? e.message) : e}`)
    return 1
  }
}

/**
 * Спайк chat-reasoning-stream (tasks 1.1/1.2): проверка thinking-API pi SDK
 * на живой сессии с текущей моделью. Запуск: SPIKE_HEADLESS=thinking.
 */
export async function runThinkingSpike(): Promise<number> {
  const log = (msg: string): void => console.log(`[spike-thinking] ${msg}`)
  try {
    const testDir = join(app.getPath('userData'), 'spike-thinking-project')
    mkdirSync(testDir, { recursive: true })

    const modelRuntime = await ModelRuntime.create({
      authPath: dataPaths.authPath,
      modelsPath: dataPaths.modelsPath
    })
    const envKey = process.env.DEEPSEEK_API_KEY
    if (!envKey) {
      log('SPIKE FAIL: DEEPSEEK_API_KEY не задан в окружении')
      return 2
    }
    await modelRuntime.setRuntimeApiKey('deepseek', envKey)

    // task 1.2: уровни для задействованных моделей deepseek
    for (const modelId of ['deepseek-v4-pro', 'deepseek-v4-flash']) {
      const m = modelRuntime.getModel('deepseek', modelId)
      if (!m) {
        log(`model deepseek/${modelId}: не найдена в каталоге`)
        continue
      }
      const sm = SessionManager.create(testDir)
      const { session } = await createAgentSession({
        cwd: testDir,
        agentDir: dataPaths.agentDir,
        modelRuntime,
        sessionManager: sm,
        model: m
      })
      log(
        `model deepseek/${modelId}: supportsThinking=${session.supportsThinking()} ` +
          `available=${JSON.stringify(session.getAvailableThinkingLevels())} ` +
          `current=${session.thinkingLevel}`
      )
      session.dispose()
    }

    // task 1.1: setThinkingLevel + prompt на текущей модели (deepseek-v4-pro)
    const model = modelRuntime.getModel('deepseek', 'deepseek-v4-pro')
    if (!model) {
      log('SPIKE FAIL: модель deepseek/deepseek-v4-pro не найдена')
      return 2
    }
    const sessionManager = SessionManager.create(testDir)
    const { session } = await createAgentSession({
      cwd: testDir,
      agentDir: dataPaths.agentDir,
      modelRuntime,
      sessionManager,
      model
    })
    session.setThinkingLevel('low')
    log(`после setThinkingLevel('low'): current=${session.thinkingLevel}`)

    let thinkingStarts = 0
    let thinkingEnds = 0
    let thinkingChars = 0
    let firstStartAt = 0
    let lastEndAt = 0
    let text = ''
    let failed: string | null = null
    const indexes = new Set<number>()
    session.subscribe((event) => {
      if (event.type !== 'message_update') {
        if (event.type === 'agent_end' && !event.willRetry) {
          const last = [...event.messages].reverse().find((m) => m.role === 'assistant')
          if (last && last.role === 'assistant' && last.stopReason === 'error') {
            failed = last.errorMessage ?? 'provider error'
          }
        }
        return
      }
      const ev = event.assistantMessageEvent
      if (ev.type === 'thinking_start') {
        thinkingStarts += 1
        indexes.add(ev.contentIndex)
        if (!firstStartAt) firstStartAt = Date.now()
        log(`thinking_start contentIndex=${ev.contentIndex}`)
      } else if (ev.type === 'thinking_delta') {
        thinkingChars += ev.delta.length
      } else if (ev.type === 'thinking_end') {
        thinkingEnds += 1
        lastEndAt = Date.now()
        log(`thinking_end contentIndex=${ev.contentIndex}`)
      } else if (ev.type === 'text_delta') {
        text += ev.delta
      }
    })

    await session.prompt('Кратко объясни, почему небо голубое. Ответь по-русски.')

    const assistant = [...session.messages].reverse().find((m) => m.role === 'assistant')
    const contentTypes =
      assistant && assistant.role === 'assistant'
        ? assistant.content.map((p) => p.type).join(',')
        : '<нет assistant-сообщения>'
    const thinkingParts =
      assistant && assistant.role === 'assistant'
        ? assistant.content.filter((p) => p.type === 'thinking')
        : []
    session.dispose()

    log(
      `итог: starts=${thinkingStarts} ends=${thinkingEnds} chars=${thinkingChars} ` +
        `indexes=${JSON.stringify([...indexes])} durationMs=${lastEndAt - firstStartAt}`
    )
    log(`content в истории: [${contentTypes}]`)
    log(`thinking-частей в истории: ${thinkingParts.length}`)
    log(`текст ответа: ${JSON.stringify(text.slice(0, 120))}`)
    if (failed) {
      log(`SPIKE FAIL: ${failed}`)
      return 1
    }
    log(thinkingStarts > 0 ? 'THINKING SPIKE: события thinking_* ПРИХОДЯТ' : 'THINKING SPIKE: событий thinking_* НЕТ (молчаливый режим)')
    return 0
  } catch (e) {
    console.error(`[spike-thinking] SPIKE FAIL: ${e instanceof Error ? (e.stack ?? e.message) : e}`)
    return 1
  }
}

/**
 * Интеграционный спайк chat-reasoning-stream (группы 3–5): прогон через
 * реальный ChatManager — проброс thinking_* в ChatEvent, sidecar-длительность,
 * snapshot с thinking-блоком, живое применение уровня (off глушит reasoning
 * со следующего запроса). Запуск: SPIKE_HEADLESS=chatmanager.
 */
export async function runChatManagerSpike(): Promise<number> {
  const log = (msg: string): void => console.log(`[spike-cm] ${msg}`)
  const envKey = process.env.DEEPSEEK_API_KEY
  if (!envKey) {
    log('SPIKE FAIL: DEEPSEEK_API_KEY не задан в окружении')
    return 2
  }
  const settings: AppSettings = {
    providers: { deepseek: { apiKey: envKey } },
    customProviders: [],
    defaultModel: { providerId: 'deepseek', modelId: 'deepseek-v4-pro' }
  }
  // ChatManager читает только get() — подменяем стор, реальный settings.json не трогаем
  const fakeStore = { get: () => structuredClone(settings) } as unknown as SettingsStore

  const events: ChatEvent[] = []
  let onAgentEnd: (() => void) | null = null
  const chatManager = new ChatManager(fakeStore, (e) => {
    events.push(e)
    if (e.type === 'agent_end' || e.type === 'error') onAgentEnd?.()
  })

  const waitRun = (): Promise<void> =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('таймаут прогона 120с')), 120_000)
      onAgentEnd = () => {
        clearTimeout(timer)
        resolve()
      }
    })

  try {
    const dir = join(app.getPath('userData'), 'spike-cm-project')
    mkdirSync(dir, { recursive: true })
    await chatManager.openProject(dir)
    const file = chatManager.getActiveChatFile()
    log(`chat file: ${file ?? '<none>'}`)
    if (!file) return 1

    // listProviders: доступные уровни для рендера списка в Settings (5.3)
    const providers = await chatManager.listProviders()
    const deepseek = providers.find((p) => p.id === 'deepseek')
    log(`listProviders deepseek levels: ${JSON.stringify(deepseek?.availableThinkingLevels)}`)
    if (!deepseek || deepseek.availableThinkingLevels.length === 0) {
      log('SPIKE FAIL: listProviders не вернул доступные уровни thinking')
      return 1
    }

    // прогон 1: дефолтный (включённый) уровень — reasoning должен прийти
    const firstRun = waitRun()
    await chatManager.sendMessage('Кратко объясни, почему небо голубое. Ответь по-русски.')
    await firstRun

    const starts = events.filter((e) => e.type === 'thinking_start').length
    const deltas = events.filter((e) => e.type === 'thinking_delta').length
    const ends = events.filter((e) => e.type === 'thinking_end')
    log(`прогон 1: thinking_start=${starts} delta=${deltas} end=${ends.length}`)
    if (starts === 0 || ends.length === 0) {
      log('SPIKE FAIL: thinking-события не дошли через ChatManager')
      return 1
    }
    const durationMs = ends[0].type === 'thinking_end' ? ends[0].durationMs : -1
    log(`прогон 1: durationMs=${durationMs}`)

    // sidecar: запись (sessionFile, contentIndex) → durationMs
    const sidecar = JSON.parse(
      readFileSync(join(dataPaths.userData, 'thinking-durations.json'), 'utf-8')
    ) as Record<string, Record<string, number>>
    const sidecarEntry = sidecar[file]
    log(`sidecar[file]: ${JSON.stringify(sidecarEntry)}`)
    if (!sidecarEntry || sidecarEntry['0'] === undefined) {
      log('SPIKE FAIL: sidecar-длительность не записана')
      return 1
    }

    // snapshot: thinking-блок перед текстом, с длительностью
    const snap = chatManager.snapshot(file)
    const kinds = snap?.items.map((i) => i.kind).join(',')
    const thinkingItem = snap?.items.find((i) => i.kind === 'thinking')
    log(`snapshot items: [${kinds}]`)
    log(
      `snapshot thinking: durationMs=${thinkingItem?.kind === 'thinking' ? thinkingItem.durationMs : '<нет>'} ` +
        `chars=${thinkingItem?.kind === 'thinking' ? thinkingItem.text.length : 0}`
    )
    if (!thinkingItem || thinkingItem.kind !== 'thinking' || thinkingItem.durationMs === undefined) {
      log('SPIKE FAIL: в snapshot нет thinking-блока с длительностью')
      return 1
    }
    if (snap && snap.items.findIndex((i) => i.kind === 'thinking') > snap.items.findIndex((i) => i.kind === 'assistant')) {
      log('SPIKE FAIL: thinking-блок не перед текстом ответа')
      return 1
    }

    // прогон 2: живое применение уровня off — reasoning глушится со следующего запроса
    settings.thinkingLevels = { deepseek: 'off' }
    await chatManager.applySettings(settings)
    events.length = 0
    const secondRun = waitRun()
    await chatManager.sendMessage('Сколько будет 2+2? Ответь одним числом.')
    await secondRun
    const starts2 = events.filter((e) => e.type === 'thinking_start').length
    log(`прогон 2 (уровень off): thinking_start=${starts2}`)
    if (starts2 !== 0) {
      log('SPIKE FAIL: уровень off не применился живьём')
      return 1
    }

    await chatManager.disposeAll()
    log('CHATMANAGER SPIKE SUCCESS')
    return 0
  } catch (e) {
    console.error(`[spike-cm] SPIKE FAIL: ${e instanceof Error ? (e.stack ?? e.message) : e}`)
    return 1
  }
}
