// Быстрый режим агентской UI-верификации (design.md, решение A):
// electron-vite dev (main из исходников с HMR + renderer из vite dev-server)
// с CDP-портом 9222. Тот же MCP-сервер playwright, та же изоляция и сид-данные,
// что в полном режиме; отличие только в том, ЧТО запущено на порту 9222.
//
// electron-vite читает REMOTE_DEBUGGING_PORT и ELECTRON_CLI_ARGS
// (chunks/lib: startElectron) — флагов командной строки для electron нет.
// ВАЖНО: electron-vite 5.0.0 сам затирает env ELECTRON_CLI_ARGS при старте
// (cli.js: cac всегда кладёт options['--'] = [] — пустой массив truthy — и
// перезаписывает ELECTRON_CLI_ARGS на '[]'). Поэтому --e2e передаём через
// официальный passthrough "electron-vite dev -- --e2e", а не через env.
import { spawn } from 'node:child_process'
import {
  CDP_PORT,
  USER_DATA_DIR,
  devLaunchSpec,
  ensurePortFree,
  seedDemoData
} from './lib-agent.mjs'

ensurePortFree(launch)

function launch() {
  seedDemoData()
  const spec = devLaunchSpec()
  const child = spawn(spec.command, spec.args, {
    stdio: 'inherit',
    env: spec.env
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
