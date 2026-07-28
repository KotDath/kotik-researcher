import { app } from 'electron'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  createAgentSession,
  ModelRuntime,
  SessionManager
} from '@earendil-works/pi-coding-agent'
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
