import { app } from 'electron'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { createAgentSession, ModelRuntime, SessionManager } from '@earendil-works/pi-coding-agent'
import { dataPaths } from './paths'

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
