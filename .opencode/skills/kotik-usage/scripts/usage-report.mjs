#!/usr/bin/env node
// usage-report.mjs — read-only отчёт по токенам/стоимости OpenCode.
//
// Конфигурация (данные, а не код):
//   - тарифы моделей: pricing.json рядом со скриптом (или --pricing <path>)
//   - БД OpenCode:    --db <path> или env OPENCODE_DB

import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const DEFAULT_DB_PATH = join(homedir(), '.local/share/opencode/opencode.db')
const DEFAULT_PRICING_PATH = join(SCRIPT_DIR, '..', 'pricing.json')
const DEFAULT_TOP = 12
const TOKENS_PER_MILLION = 1_000_000

function fail(message) {
  throw new Error(message)
}

/// Загружает тарифы из pricing.json: { asOf, byModel: Map, sources: [{label, url}] }.
export function loadPricing(pricingPath = DEFAULT_PRICING_PATH) {
  if (!existsSync(pricingPath)) fail(`Файл тарифов не найден: ${pricingPath}`)
  let raw
  try {
    raw = JSON.parse(readFileSync(pricingPath, 'utf8'))
  } catch (error) {
    fail(`Файл тарифов повреждён (${pricingPath}): ${error.message}`)
  }
  if (!raw || typeof raw !== 'object' || typeof raw.asOf !== 'string' || !raw.models) {
    fail(`Файл тарифов ${pricingPath} должен содержать поля asOf и models`)
  }

  const byModel = new Map(Object.entries(raw.models))
  // Источники для футера: дедупликация по URL — у нескольких моделей
  // может быть одна страница документации (берём ярлык первой).
  const sources = []
  const seenUrls = new Set()
  for (const pricing of byModel.values()) {
    if (!pricing.label || seenUrls.has(pricing.source)) continue
    seenUrls.add(pricing.source)
    sources.push({ label: pricing.label, url: pricing.source })
  }
  return { asOf: raw.asOf, byModel, sources }
}

export function parseArgs(argv, env = process.env) {
  const args = {
    sessionId: null,
    days: null,
    top: DEFAULT_TOP,
    dbPath: env.OPENCODE_DB || DEFAULT_DB_PATH,
    pricingPath: DEFAULT_PRICING_PATH,
    help: false
  }
  let positional = null
  const valueAfter = (index, option) => {
    const value = argv[index + 1]
    if (!value || value.startsWith('--')) fail(`${option} требует значение`)
    return value
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--session') args.sessionId = valueAfter(index++, arg)
    else if (arg === '--days') args.days = Number(valueAfter(index++, arg))
    else if (arg === '--top') args.top = Number(valueAfter(index++, arg))
    else if (arg === '--db') args.dbPath = valueAfter(index++, arg)
    else if (arg === '--pricing') args.pricingPath = valueAfter(index++, arg)
    else if (arg === '--help' || arg === '-h') args.help = true
    else if (arg.startsWith('--')) fail(`Неизвестный аргумент: ${arg}`)
    else if (positional) fail('Разрешён только один позиционный session ID')
    else positional = arg
  }

  if (positional && args.sessionId) fail('Используйте позиционный ID или --session, но не оба')
  if (positional) args.sessionId = positional
  if (args.sessionId && args.days !== null) fail('--session и --days взаимоисключающие')
  if (args.days !== null && (!Number.isFinite(args.days) || args.days <= 0)) {
    fail('--days должен быть положительным числом')
  }
  if (!Number.isInteger(args.top) || args.top <= 0) fail('--top должен быть положительным целым')
  return args
}

function assertSchema(db) {
  const required = {
    session: ['id', 'parent_id', 'directory', 'title', 'agent', 'time_created', 'time_updated'],
    message: ['id', 'session_id', 'time_created', 'data']
  }

  for (const [table, columns] of Object.entries(required)) {
    const actual = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name))
    if (actual.size === 0) fail(`Несовместимая БД OpenCode: таблица ${table} отсутствует`)
    const missing = columns.filter((column) => !actual.has(column))
    if (missing.length) {
      fail(`Несовместимая БД OpenCode: ${table} не содержит ${missing.join(', ')}`)
    }
  }
}

function loadProjectSessions(db, directory) {
  return db
    .prepare(
      `SELECT id, parent_id, directory, title, agent, time_created, time_updated
       FROM session
       WHERE directory = ?
       ORDER BY time_created, id`
    )
    .all(directory)
}

function selectSubtree(sessions, rootId) {
  const byId = new Map(sessions.map((session) => [session.id, session]))
  if (!byId.has(rootId)) return []
  const selected = new Set([rootId])
  let changed = true
  while (changed) {
    changed = false
    for (const session of sessions) {
      if (session.parent_id && selected.has(session.parent_id) && !selected.has(session.id)) {
        selected.add(session.id)
        changed = true
      }
    }
  }
  return sessions.filter((session) => selected.has(session.id))
}

function latestRoot(sessions) {
  return sessions
    .filter((session) => !session.parent_id)
    .sort((left, right) => right.time_updated - left.time_updated)[0]
}

function loadMessages(db, directory, sessionIds, since) {
  if (sessionIds.size === 0) return []
  const rows = db
    .prepare(
      `SELECT m.id, m.session_id, m.time_created, m.data
       FROM message m
       JOIN session s ON s.id = m.session_id
       WHERE s.directory = ?
       ORDER BY m.time_created, m.id`
    )
    .all(directory)
  return rows.filter(
    (row) => sessionIds.has(row.session_id) && (since === null || row.time_created >= since)
  )
}

function number(value) {
  return Number.isFinite(value) ? value : 0
}

export function usageFromMessage(data) {
  const tokens = data?.tokens ?? {}
  const input = number(tokens.input)
  const output = number(tokens.output)
  const reasoning = number(tokens.reasoning)
  const cacheRead = number(tokens.cache?.read)
  const cacheWrite = number(tokens.cache?.write)
  const classified = input + output + reasoning + cacheRead + cacheWrite
  const reportedTotal = number(tokens.total)
  const other = Math.max(0, reportedTotal - classified)
  return {
    messages: 1,
    input,
    output,
    reasoning,
    cacheRead,
    cacheWrite,
    other,
    total: classified + other,
    cost: number(data?.cost),
    reportedCost: number(data?.cost),
    inputCost: 0,
    cacheReadCost: 0,
    outputCost: 0,
    pricedMessages: 0
  }
}

export function priceUsage(usage, provider, modelId, pricingByModel) {
  const pricing = pricingByModel.get(`${provider}/${modelId}`)
  if (!pricing) return usage

  const inputTokens = usage.input + usage.cacheRead + usage.cacheWrite
  const longContext =
    pricing.longContextThreshold !== undefined && inputTokens > pricing.longContextThreshold
  const inputMultiplier = longContext ? pricing.longContextInputMultiplier : 1
  const outputMultiplier = longContext ? pricing.longContextOutputMultiplier : 1
  const inputCost =
    ((usage.input + usage.cacheWrite) * pricing.inputMiss * inputMultiplier) /
    TOKENS_PER_MILLION
  const cacheReadCost =
    (usage.cacheRead * pricing.inputHit * inputMultiplier) / TOKENS_PER_MILLION
  const outputCost =
    ((usage.output + usage.reasoning) * pricing.output * outputMultiplier) /
    TOKENS_PER_MILLION

  return {
    ...usage,
    cost: inputCost + cacheReadCost + outputCost,
    inputCost,
    cacheReadCost,
    outputCost,
    pricedMessages: usage.messages
  }
}

function emptyUsage() {
  return {
    messages: 0,
    input: 0,
    output: 0,
    reasoning: 0,
    cacheRead: 0,
    cacheWrite: 0,
    other: 0,
    total: 0,
    cost: 0,
    reportedCost: 0,
    inputCost: 0,
    cacheReadCost: 0,
    outputCost: 0,
    pricedMessages: 0
  }
}

function addUsage(target, source) {
  for (const key of Object.keys(emptyUsage())) target[key] += source[key]
  return target
}

function aggregate(map, key, usage) {
  const current = map.get(key) ?? emptyUsage()
  addUsage(current, usage)
  map.set(key, current)
}

function parseAssistantMessages(rows) {
  const parsed = []
  let malformed = 0
  for (const row of rows) {
    try {
      const data = JSON.parse(row.data)
      if (data.role === 'assistant') parsed.push({ ...row, data })
    } catch {
      malformed += 1
    }
  }
  return { parsed, malformed }
}

function rootIdFor(sessionId, sessionsById) {
  let current = sessionsById.get(sessionId)
  const seen = new Set()
  while (current?.parent_id && !seen.has(current.id)) {
    seen.add(current.id)
    const parent = sessionsById.get(current.parent_id)
    if (!parent) break
    current = parent
  }
  return current?.id ?? sessionId
}

export function collectUsage({
  dbPath = DEFAULT_DB_PATH,
  directory = process.cwd(),
  sessionId = null,
  days = null,
  top = DEFAULT_TOP,
  pricing = loadPricing(),
  now = Date.now()
} = {}) {
  if (!existsSync(dbPath)) fail(`БД OpenCode не найдена: ${dbPath}`)
  const db = new DatabaseSync(dbPath, { readOnly: true })

  try {
    assertSchema(db)

    let projectSessions = loadProjectSessions(db, directory)
    if (sessionId && !projectSessions.some((session) => session.id === sessionId)) {
      const explicit = db
        .prepare(
          `SELECT id, parent_id, directory, title, agent, time_created, time_updated
           FROM session WHERE id = ?`
        )
        .get(sessionId)
      if (!explicit) fail(`Сессия не найдена: ${sessionId}`)
      directory = explicit.directory
      projectSessions = loadProjectSessions(db, directory)
    }
    if (projectSessions.length === 0) fail(`Сессии OpenCode для ${directory} не найдены`)

    let selectedSessions
    let scope
    let since = null

    if (days !== null) {
      since = now - days * 86_400_000
      selectedSessions = projectSessions
      scope = `последние ${days} дн. · ${directory}`
    } else {
      const root = sessionId
        ? projectSessions.find((session) => session.id === sessionId)
        : latestRoot(projectSessions)
      if (!root) fail(`Корневая сессия для ${directory} не найдена`)
      selectedSessions = selectSubtree(projectSessions, root.id)
      scope = `${root.title} · ${root.id}`
    }

    const selectedIds = new Set(selectedSessions.map((session) => session.id))
    const rows = loadMessages(db, directory, selectedIds, since)
    const { parsed: messages, malformed } = parseAssistantMessages(rows)
    const sessionsWithMessages = new Set(messages.map((message) => message.session_id))
    const sessions = selectedSessions.filter((session) => sessionsWithMessages.has(session.id))
    const sessionsById = new Map(projectSessions.map((session) => [session.id, session]))

    const total = emptyUsage()
    const byAgent = new Map()
    const byModel = new Map()
    const byAgentModel = new Map()
    const bySession = new Map()
    const roots = new Set()

    for (const message of messages) {
      const session = sessionsById.get(message.session_id)
      const agent = message.data.agent ?? session?.agent ?? 'unknown'
      const provider = message.data.providerID ?? 'unknown'
      const modelId = message.data.modelID ?? 'unknown'
      const model = `${provider}/${modelId}`
      const usage = priceUsage(usageFromMessage(message.data), provider, modelId, pricing.byModel)

      addUsage(total, usage)
      aggregate(byAgent, agent, usage)
      aggregate(byModel, model, usage)
      aggregate(byAgentModel, `${agent} ${model}`, usage)

      const sessionUsage = bySession.get(message.session_id) ?? {
        id: message.session_id,
        title: session?.title ?? '(без названия)',
        agent: session?.agent ?? agent,
        models: new Set(),
        usage: emptyUsage()
      }
      sessionUsage.models.add(model)
      addUsage(sessionUsage.usage, usage)
      bySession.set(message.session_id, sessionUsage)
      roots.add(rootIdFor(message.session_id, sessionsById))
    }

    return {
      scope,
      directory,
      since,
      generatedAt: now,
      selectedSessionCount: sessions.length,
      rootCount: roots.size,
      malformed,
      total,
      byAgent,
      byModel,
      byAgentModel,
      bySession,
      pricingAsOf: pricing.asOf,
      pricingSources: pricing.sources,
      top
    }
  } finally {
    db.close()
  }
}

const tokenFormat = new Intl.NumberFormat('en-US')

function token(value) {
  return tokenFormat.format(Math.round(value))
}

function money(value) {
  return `$${value.toFixed(4)}`
}

function ratio(usage) {
  const context = usage.input + usage.cacheRead
  return context === 0 ? '—' : `${((usage.cacheRead / context) * 100).toFixed(1)}%`
}

function escapeCell(value) {
  return String(value).replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim()
}

function componentMoney(usage, key) {
  return usage.pricedMessages === usage.messages ? money(usage[key]) : '—'
}

function pricedBreakdownCells(usage) {
  return [
    token(usage.input + usage.cacheWrite),
    componentMoney(usage, 'inputCost'),
    token(usage.cacheRead),
    componentMoney(usage, 'cacheReadCost'),
    token(usage.output + usage.reasoning),
    componentMoney(usage, 'outputCost'),
    money(usage.cost)
  ]
}

function pricedBreakdownRow(first, second, usage) {
  return [escapeCell(first), escapeCell(second), ...pricedBreakdownCells(usage)]
}

function table(headers, rows) {
  const head = `| ${headers.join(' | ')} |`
  const separator = `| ${headers.map(() => '---').join(' | ')} |`
  return [head, separator, ...rows.map((row) => `| ${row.join(' | ')} |`)].join('\n')
}

function sortedUsageEntries(map) {
  return [...map.entries()].sort(
    ([leftKey, left], [rightKey, right]) =>
      right.total - left.total || leftKey.localeCompare(rightKey)
  )
}

export function renderReport(report) {
  const pricingLinks = report.pricingSources
    .map((source) => `[${source.label}](${source.url})`)
    .join(', ')

  const lines = [
    '# Отчёт об использовании OpenCode',
    '',
    `- Охват: ${report.scope}`,
    `- Снимок: ${new Date(report.generatedAt).toISOString()}`,
    `- Сессий с usage: ${report.selectedSessionCount}`,
    `- Корневых деревьев: ${report.rootCount}`,
    '- Текущий ответ ещё не входит в этот снимок.',
    '',
    '## Итого',
    '',
    table(
      ['Ответов', 'Input miss', 'Input hit (cache read)', 'Cache write', 'Output', 'Reasoning', 'Other', 'Всего', 'Hit %', 'Cost*'],
      [[
        token(report.total.messages),
        token(report.total.input),
        token(report.total.cacheRead),
        token(report.total.cacheWrite),
        token(report.total.output),
        token(report.total.reasoning),
        token(report.total.other),
        token(report.total.total),
        ratio(report.total),
        money(report.total.cost)
      ]]
    ),
    '',
    '## По агентам и моделям',
    '',
    table(
      ['Агент', 'Модель', 'Cache miss, токены', 'Cache miss, цена', 'Cache hit, токены', 'Cache hit, цена', 'Output, токены', 'Output, цена', 'Суммарная цена'],
      sortedUsageEntries(report.byAgentModel).map(([key, usage]) => {
        const [agent, model] = key.split(' ')
        return pricedBreakdownRow(agent, model, usage)
      })
    ),
    '',
    '## По моделям',
    '',
    table(
      ['Модель', 'Cache miss, токены', 'Cache miss, цена', 'Cache hit, токены', 'Cache hit, цена', 'Output, токены', 'Output, цена', 'Суммарная цена'],
      sortedUsageEntries(report.byModel).map(([model, usage]) => [
        escapeCell(model),
        ...pricedBreakdownCells(usage)
      ])
    ),
    '',
    `## Топ-${report.top} сессий`,
    '',
    table(
      ['Сессия', 'Агент', 'Модели', 'Ответов', 'Input miss', 'Input hit', 'Cache W', 'Output', 'Reasoning', 'Other', 'Всего', 'Hit %', 'Cost*'],
      [...report.bySession.values()]
        .sort((left, right) => right.usage.total - left.usage.total || left.id.localeCompare(right.id))
        .slice(0, report.top)
        .map((session) => [
          escapeCell(`${session.title} (${session.id})`),
          escapeCell(session.agent),
          escapeCell([...session.models].sort().join(', ')),
          token(session.usage.messages),
          token(session.usage.input),
          token(session.usage.cacheRead),
          token(session.usage.cacheWrite),
          token(session.usage.output),
          token(session.usage.reasoning),
          token(session.usage.other),
          token(session.usage.total),
          ratio(session.usage),
          money(session.usage.cost)
        ])
    ),
    '',
    '> `Input miss` — обычные входные токены вне cache read; `Input hit` — токены, прочитанные из prompt cache. `Cache write`, `Output` и `Reasoning` показаны отдельно.',
    '',
    `> Стоимость рассчитана по публичным API-тарифам на ${report.pricingAsOf}: ${pricingLinks}. Для неизвестной модели цены компонентов показаны как \`—\`, а итог — reported cost OpenCode/provider.`,
    '',
    '> `Output, токены` для расчёта включает отдельно сообщённые reasoning-токены. Для моделей с настроенным порогом long-context (см. pricing.json) при превышении порога применяются множители. Все расчёты применяются к историческим токенам и не являются фактическим списанием или стоимостью подписки.'
  ]

  if (report.malformed) {
    lines.push('', `> Предупреждение: пропущено повреждённых сообщений: ${report.malformed}.`)
  }
  if (report.total.messages === 0) {
    lines.push('', '> В выбранном охвате не найдено ответов ассистентов с usage.')
  }
  return lines.join('\n')
}

function help() {
  return `Usage:
  node usage-report.mjs
  node usage-report.mjs <session-id>
  node usage-report.mjs --session <session-id>
  node usage-report.mjs --days <N>

Options:
  --top <N>       number of sessions in the final table (default: ${DEFAULT_TOP})
  --db <path>     alternate OpenCode SQLite database (env: OPENCODE_DB)
  --pricing <path> alternate pricing.json with model tariffs
  -h, --help      show this help`
}

async function main() {
  try {
    const args = parseArgs(process.argv.slice(2))
    if (args.help) {
      console.log(help())
      return
    }
    const report = collectUsage({
      dbPath: resolve(args.dbPath),
      directory: process.cwd(),
      sessionId: args.sessionId,
      days: args.days,
      top: args.top,
      pricing: loadPricing(args.pricingPath)
    })
    console.log(renderReport(report))
  } catch (error) {
    console.error(`usage-report: ${error.message}`)
    process.exitCode = 1
  }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) await main()
