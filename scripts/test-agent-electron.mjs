// Полный режим агентской UI-верификации (design.md, решение 5):
// собранное приложение с CDP-портом 9222, к которому агент подключается
// через Playwright MCP с --cdp-endpoint http://127.0.0.1:9222.
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'

const CDP_PORT = 9222
const MAIN_ENTRY = './out/main/index.mjs'

if (!existsSync(MAIN_ENTRY)) {
  console.error(
    `[test:agent:electron] ${MAIN_ENTRY} не найден.\n` +
      'Сначала выполните "pnpm build", затем повторите.'
  )
  process.exit(1)
}

const probe = createServer()
probe.once('error', () => {
  console.error(
    `[test:agent:electron] порт ${CDP_PORT} уже занят другим процессом.\n` +
      'Завершите процесс, использующий порт (например, предыдущий запуск этого скрипта), и повторите.'
  )
  process.exit(1)
})
probe.once('listening', () => {
  probe.close(() => launch())
})
probe.listen(CDP_PORT, '127.0.0.1')

function launch() {
  const electronBinary = createRequire(import.meta.url)('electron')
  const child = spawn(
    electronBinary,
    [MAIN_ENTRY, `--remote-debugging-port=${CDP_PORT}`],
    { stdio: 'inherit', env: process.env }
  )
  child.on('error', (err) => {
    console.error(`[test:agent:electron] не удалось запустить Electron: ${err.message}`)
    process.exit(1)
  })
  child.on('exit', (code) => process.exit(code ?? 0))
  console.log(
    `[test:agent:electron] приложение запущено, CDP на http://127.0.0.1:${CDP_PORT}\n` +
      'Подключите Playwright MCP: npx -y @playwright/mcp@latest --cdp-endpoint http://127.0.0.1:9222'
  )
}
