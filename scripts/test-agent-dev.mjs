// Быстрый режим агентской UI-верификации (design.md, решение A):
// electron-vite dev (main из исходников с HMR + renderer из vite dev-server)
// с CDP-портом 9222. Тот же MCP-сервер playwright, та же изоляция и сид-данные,
// что в полном режиме; отличие только в том, ЧТО запущено на порту 9222.
//
// electron-vite читает REMOTE_DEBUGGING_PORT и ELECTRON_CLI_ARGS
// (chunks/lib: startElectron) — флагов командной строки для electron нет.
import { spawn } from 'node:child_process'
import {
  CDP_PORT,
  USER_DATA_DIR,
  buildEnv,
  ensurePortFree,
  seedDemoData
} from './lib-agent.mjs'

ensurePortFree(launch)

function launch() {
  seedDemoData()
  const child = spawn('pnpm', ['exec', 'electron-vite', 'dev'], {
    stdio: 'inherit',
    env: buildEnv({
      NODE_ENV: 'development',
      REMOTE_DEBUGGING_PORT: String(CDP_PORT),
      ELECTRON_CLI_ARGS: JSON.stringify(['--e2e'])
    })
  })
  child.on('error', (err) => {
    console.error(`[test:agent:dev] не удалось запустить electron-vite dev: ${err.message}`)
    process.exit(1)
  })
  child.on('exit', (code) => process.exit(code ?? 0))
  console.log(
    `[test:agent:dev] electron-vite dev запущен ИЗОЛИРОВАННО (userData: ${USER_DATA_DIR}),\n` +
      `CDP на http://127.0.0.1:${CDP_PORT}. Main из исходников с HMR, renderer из dev-server.\n` +
      'Сид-данные: проект «kotik-ui-review-project» в недавних, чат с историей.\n' +
      'Окно скрыто (режим --e2e). Инструменты — MCP-сервер playwright (playwright_*).'
  )
}
