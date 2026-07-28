import { app } from 'electron'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

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
