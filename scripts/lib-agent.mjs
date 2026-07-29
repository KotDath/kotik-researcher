// Общие утилиты агентских прогонов (test:agent:dev / test:agent:electron):
// изоляция userData + сид-данные + проверка CDP-порта.
import { createServer } from 'node:net'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

export const CDP_PORT = 9222
export const USER_DATA_DIR = join(tmpdir(), 'kotik-ui-review-userdata')
export const DEMO_PROJECT_DIR = join(tmpdir(), 'kotik-ui-review-project')

// Как в E2E fixture: только то, что нужно Electron на linux-десктопе.
// Credentials сюда не попадают — реальные API-ключи агенту недоступны.
export const ENV_ALLOWLIST = [
  'PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'LANG', 'LC_ALL', 'LC_CTYPE',
  'TERM', 'TMPDIR', 'DISPLAY', 'WAYLAND_DISPLAY', 'XAUTHORITY',
  'XDG_RUNTIME_DIR', 'XDG_SESSION_TYPE', 'DBUS_SESSION_BUS_ADDRESS'
]

export function buildEnv(extra = {}) {
  const env = {}
  for (const key of ENV_ALLOWLIST) {
    if (process.env[key] !== undefined) env[key] = process.env[key]
  }
  env.NODE_ENV = 'test'
  env.E2E_USER_DATA_DIR = USER_DATA_DIR
  return { ...env, ...extra }
}

export function seedDemoData() {
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

/** Проверяет, что CDP-порт свободен; иначе понятная ошибка и exit 1. */
export function ensurePortFree(onFree) {
  const probe = createServer()
  probe.once('error', () => {
    console.error(
      `[test:agent] порт ${CDP_PORT} уже занят другим процессом.\n` +
        'Завершите процесс, использующий порт (например, предыдущий агентский прогон), и повторите.'
    )
    process.exit(1)
  })
  probe.once('listening', () => {
    probe.close(() => onFree())
  })
  probe.listen(CDP_PORT, '127.0.0.1')
}
