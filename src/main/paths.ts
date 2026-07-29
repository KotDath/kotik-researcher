import { app } from 'electron'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

// Тестовый режим Playwright (tasks 3.3): --e2e + E2E_USER_DATA_DIR изолируют
// userData, чтобы E2E-тесты не трогали реальные данные пользователя.
// Должно выполняться до первого app.getPath('userData').
if (process.argv.includes('--e2e') && process.env.E2E_USER_DATA_DIR) {
  app.setPath('userData', process.env.E2E_USER_DATA_DIR)
}

// Изоляция от пользовательского ~/.pi (требование «Автономность от установленного
// pi CLI»): pi читает PI_CODING_AGENT_DIR в getAgentDir() — все его пути (auth.json,
// models.json, sessions/, settings.json) оказываются внутри наших данных.
// Должно выполняться до любых вызовов pi SDK.
const userData = app.getPath('userData')
const agentDir = join(userData, 'pi-agent')
process.env.PI_CODING_AGENT_DIR = agentDir

export const dataPaths = {
  userData,
  agentDir,
  authPath: join(agentDir, 'auth.json'),
  modelsPath: join(agentDir, 'models.json'),
  recentProjectsPath: join(userData, 'recent-projects.json'),
  settingsPath: join(userData, 'settings.json')
}

export function ensureDataDirs(): void {
  mkdirSync(agentDir, { recursive: true })
}
