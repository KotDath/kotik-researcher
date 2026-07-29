// Полный режим агентской UI-верификации (design.md, решение 5):
// собранное приложение с CDP-портом 9222, к которому агент подключается
// через MCP-сервер playwright-cdp (opencode.json).
//
// Безопасность (review-fix): приложение запускается ИЗОЛИРОВАННО от реальных
// данных пользователя (--e2e + E2E_USER_DATA_DIR, env-allowlist без
// credentials) — действия агента и скриншоты не касаются живых проектов,
// настроек и API-ключей. Чтобы было что проверять, в изолированный userData
// сеются демо-данные: recent-projects.json и проект с одним чатом.
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

const CDP_PORT = 9222
const MAIN_ENTRY = './out/main/index.mjs'
const USER_DATA_DIR = join(tmpdir(), 'kotik-ui-review-userdata')
const DEMO_PROJECT_DIR = join(tmpdir(), 'kotik-ui-review-project')

// Как в E2E fixture: только то, что нужно Electron на linux-десктопе.
const ENV_ALLOWLIST = [
  'PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'LANG', 'LC_ALL', 'LC_CTYPE',
  'TERM', 'TMPDIR', 'DISPLAY', 'WAYLAND_DISPLAY', 'XAUTHORITY',
  'XDG_RUNTIME_DIR', 'XDG_SESSION_TYPE', 'DBUS_SESSION_BUS_ADDRESS'
]

function buildEnv() {
  const env = {}
  for (const key of ENV_ALLOWLIST) {
    if (process.env[key] !== undefined) env[key] = process.env[key]
  }
  env.NODE_ENV = 'test'
  env.E2E_USER_DATA_DIR = USER_DATA_DIR
  return env
}

function seedDemoData() {
  rmSync(USER_DATA_DIR, { recursive: true, force: true })
  mkdirSync(USER_DATA_DIR, { recursive: true })

  // демо-проект с содержимым — агенту есть что открыть и читать
  rmSync(DEMO_PROJECT_DIR, { recursive: true, force: true })
  mkdirSync(join(DEMO_PROJECT_DIR, 'notes'), { recursive: true })
  writeFileSync(join(DEMO_PROJECT_DIR, 'README.md'), '# UI Review demo project\n')
  writeFileSync(join(DEMO_PROJECT_DIR, 'notes', 'topic.md'), '# Тема исследования\n')

  writeFileSync(
    join(USER_DATA_DIR, 'recent-projects.json'),
    JSON.stringify({
      version: 1,
      projects: [{ path: DEMO_PROJECT_DIR, lastOpenedAt: Date.now() }]
    })
  )

  // один готовый чат (формат pi session v3): без LLM сессия на диск не
  // пишется, поэтому сеем файл напрямую — как tests/e2e/helpers.ts
  const safePath = `--${DEMO_PROJECT_DIR.replace(/^[/\\]/, '').replace(/[/\\:]/g, '-')}--`
  const sessionsDir = join(USER_DATA_DIR, 'pi-agent', 'sessions', safePath)
  mkdirSync(sessionsDir, { recursive: true })
  const iso = new Date().toISOString()
  const sessionId = randomUUID()
  const entries = [
    { type: 'session', version: 3, id: sessionId, timestamp: iso, cwd: DEMO_PROJECT_DIR },
    {
      type: 'message', id: 'seed0001', parentId: null, timestamp: iso,
      message: { role: 'user', content: [{ type: 'text', text: 'Привет! Расскажи о проекте.' }], timestamp: Date.now() }
    },
    {
      type: 'message', id: 'seed0002', parentId: 'seed0001', timestamp: iso,
      message: { role: 'assistant', content: [{ type: 'text', text: 'Это демо-проект для UI-верификации. Данные изолированы от реальных.' }], timestamp: Date.now(), stopReason: 'stop' }
    }
  ]
  writeFileSync(
    join(sessionsDir, `${iso.replace(/[:.]/g, '-')}_${sessionId}.jsonl`),
    entries.map((e) => JSON.stringify(e)).join('\n') + '\n'
  )
}

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
    `[test:agent:electron] приложение запущено ИЗОЛИРОВАННО (userData: ${USER_DATA_DIR}),\n` +
      `CDP на http://127.0.0.1:${CDP_PORT}. Сид-данные: проект «kotik-ui-review-project»\n` +
      'в списке недавних, один чат с историей. API-ключи и реальные данные недоступны.\n' +
      'Инструменты — через MCP-сервер playwright-cdp (уже настроен в opencode.json).'
  )
}
