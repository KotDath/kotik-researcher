// Полный режим агентской UI-верификации (design.md, решение A):
// собранное prod-приложение с CDP-портом 9222, MCP-сервер playwright
// (единственный, opencode.json) подключён к этому порту.
//
// Изоляция (design.md): отдельный userData с сид-данными, env-allowlist без
// credentials — действия агента и скриншоты не касаются реальных проектов,
// настроек и API-ключей.
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import {
  CDP_PORT,
  USER_DATA_DIR,
  buildEnv,
  ensurePortFree,
  seedDemoData
} from './lib-agent.mjs'

const MAIN_ENTRY = './out/main/index.mjs'

if (!existsSync(MAIN_ENTRY)) {
  console.error(
    `[test:agent:electron] ${MAIN_ENTRY} не найден.\n` +
      'Сначала выполните "pnpm build", затем повторите.'
  )
  process.exit(1)
}

ensurePortFree(launch)

function launch() {
  seedDemoData()
  const electronBinary = createRequire(import.meta.url)('electron')
  const child = spawn(
    electronBinary,
    [MAIN_ENTRY, '--e2e', `--remote-debugging-port=${CDP_PORT}`],
    { stdio: 'inherit', env: buildEnv() }
  )
  child.on('error', (err) => {
    console.error(`[test:agent:electron] не удалось запустить Electron: ${err.message}`)
    process.exit(1)
  })
  child.on('exit', (code) => process.exit(code ?? 0))
  console.log(
    `[test:agent:electron] prod-сборка запущена ИЗОЛИРОВАННО (userData: ${USER_DATA_DIR}),\n` +
      `CDP на http://127.0.0.1:${CDP_PORT}. Сид-данные: проект «kotik-ui-review-project»\n` +
      'в списке недавних, один чат с историей. Окно скрыто (режим --e2e).\n' +
      'Инструменты — через MCP-сервер playwright (префикс playwright_*).'
  )
}
