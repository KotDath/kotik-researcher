import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'

import {
  collectUsage,
  loadPricing,
  parseArgs,
  priceUsage,
  renderReport,
  usageFromMessage
} from './usage-report.mjs'

const PROJECT = '/fixture/kotik-researcher'
const NOW = Date.UTC(2026, 6, 29, 12)
const DAY = 86_400_000

function assistant({
  agent,
  provider = 'fixture',
  model = 'flash',
  input = 0,
  output = 0,
  reasoning = 0,
  cacheRead = 0,
  cacheWrite = 0,
  total,
  cost = 0
}) {
  return JSON.stringify({
    role: 'assistant',
    agent,
    providerID: provider,
    modelID: model,
    cost,
    tokens: {
      input,
      output,
      reasoning,
      cache: { read: cacheRead, write: cacheWrite },
      total: total ?? input + output + reasoning + cacheRead + cacheWrite
    }
  })
}

function createFixture() {
  const directory = mkdtempSync(join(tmpdir(), 'kotik-usage-'))
  const dbPath = join(directory, 'opencode.db')
  const db = new DatabaseSync(dbPath)
  db.exec(`
    CREATE TABLE session (
      id TEXT PRIMARY KEY,
      parent_id TEXT,
      directory TEXT NOT NULL,
      title TEXT NOT NULL,
      agent TEXT,
      time_created INTEGER NOT NULL,
      time_updated INTEGER NOT NULL
    );
    CREATE TABLE message (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      time_created INTEGER NOT NULL,
      data TEXT NOT NULL
    );
  `)

  const insertSession = db.prepare(`
    INSERT INTO session
      (id, parent_id, directory, title, agent, time_created, time_updated)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `)
  const sessions = [
    ['root', null, PROJECT, 'Main session', 'orchestrator', NOW - 3 * DAY, NOW],
    ['idea', 'root', PROJECT, 'Vision', 'ideator-deep', NOW - 2 * DAY, NOW],
    ['review', 'root', PROJECT, 'Review', 'reviewer', NOW - 2 * DAY, NOW],
    ['review-explore', 'review', PROJECT, 'Review lookup', 'explore', NOW - DAY, NOW],
    ['direct-explore', 'root', PROJECT, 'General lookup', 'explore', NOW - DAY, NOW],
    ['impl', 'root', PROJECT, 'Implementation', 'implementer', NOW - DAY, NOW],
    ['legacy-spec', 'root', PROJECT, 'Legacy spec', 'spec-writer', NOW - DAY, NOW],
    ['unknown', 'root', PROJECT, 'Odd role', 'custom-agent', NOW - DAY, NOW],
    ['other-root', null, PROJECT, 'Older root', 'orchestrator', NOW - 20 * DAY, NOW - 10 * DAY],
    ['elsewhere', null, '/fixture/elsewhere', 'Elsewhere', 'orchestrator', NOW, NOW]
  ]
  for (const session of sessions) insertSession.run(...session)

  const insertMessage = db.prepare(`
    INSERT INTO message (id, session_id, time_created, data)
    VALUES (?, ?, ?, ?)
  `)
  const messages = [
    ['m-root', 'root', NOW - 2 * DAY, assistant({ agent: 'orchestrator', model: 'k3', input: 10, output: 2 })],
    ['m-idea', 'idea', NOW - DAY, assistant({ agent: 'ideator-deep', model: 'pro', input: 20, output: 4 })],
    ['m-review', 'review', NOW - DAY, assistant({ agent: 'reviewer', provider: 'openai', model: 'gpt-5.6-sol', input: 30, reasoning: 5, output: 6, cost: 0.25 })],
    ['m-review-explore', 'review-explore', NOW - DAY, assistant({ agent: 'explore', input: 7, output: 1 })],
    ['m-direct-explore', 'direct-explore', NOW - DAY, assistant({ agent: 'explore', input: 8, output: 1 })],
    ['m-impl-flash', 'impl', NOW - DAY, assistant({ agent: 'implementer', model: 'flash', input: 40, cacheRead: 20, output: 8 })],
    ['m-impl-pro', 'impl', NOW - DAY, assistant({ agent: 'implementer', model: 'pro', input: 3, output: 2 })],
    ['m-spec', 'legacy-spec', NOW - DAY, assistant({ agent: 'spec-writer', model: 'pro', input: 11, output: 2 })],
    ['m-unknown', 'unknown', NOW - DAY, assistant({ agent: 'custom-agent', input: 5, output: 1 })],
    ['m-user', 'root', NOW, JSON.stringify({ role: 'user', content: 'ignored' })],
    ['m-broken', 'root', NOW, '{broken'],
    ['m-old-tree', 'other-root', NOW - 10 * DAY, assistant({ agent: 'orchestrator', model: 'k3', input: 100, output: 10 })],
    ['m-elsewhere', 'elsewhere', NOW, assistant({ agent: 'orchestrator', input: 999 })]
  ]
  for (const message of messages) insertMessage.run(...message)
  db.close()

  return {
    dbPath,
    cleanup: () => rmSync(directory, { recursive: true, force: true })
  }
}

test('argument parsing validates mutually exclusive scopes and top', () => {
  assert.deepEqual(parseArgs(['session-1', '--top', '3']).sessionId, 'session-1')
  assert.equal(parseArgs(['--days', '2']).days, 2)
  assert.throws(() => parseArgs(['one', '--session', 'two']), /не оба/)
  assert.throws(() => parseArgs(['--session', 'one', '--days', '2']), /взаимоисключающие/)
  assert.throws(() => parseArgs(['--top', '0']), /положительным целым/)
  assert.throws(() => parseArgs(['--session']), /требует значение/)
  assert.throws(() => parseArgs(['--days', '--top', '2']), /требует значение/)
})

test('token buckets preserve provider total remainder', () => {
  assert.deepEqual(
    usageFromMessage({
      cost: 0.5,
      tokens: {
        input: 2,
        output: 3,
        reasoning: 4,
        cache: { read: 5, write: 6 },
        total: 25
      }
    }),
    {
      messages: 1,
      input: 2,
      output: 3,
      reasoning: 4,
      cacheRead: 5,
      cacheWrite: 6,
      other: 5,
      total: 25,
      cost: 0.5,
      reportedCost: 0.5,
      inputCost: 0,
      cacheReadCost: 0,
      outputCost: 0,
      pricedMessages: 0
    }
  )
})

test('Kimi K3 uses Moonshot list pricing without losing reported cost', () => {
  const usage = usageFromMessage({
    cost: 0,
    tokens: {
      input: 1_000_000,
      output: 1_000_000,
      reasoning: 100_000,
      cache: { read: 1_000_000, write: 100_000 },
      total: 3_200_000
    }
  })

  const pricing = loadPricing().byModel
  const priced = priceUsage(usage, 'kimi-for-coding', 'k3', pricing)
  assert.equal(priced.cost, 20.1)
  assert.equal(priced.inputCost, 3.3)
  assert.equal(priced.cacheReadCost, 0.3)
  assert.equal(priced.outputCost, 16.5)
  assert.equal(priced.reportedCost, 0)
  assert.equal(priceUsage(usage, 'other', 'k3', pricing).cost, 0)
})

test('GPT-5.6 applies long-context multipliers per message', () => {
  const usage = usageFromMessage({
    tokens: {
      input: 200_000,
      output: 10_000,
      reasoning: 10_000,
      cache: { read: 100_000, write: 0 },
      total: 320_000
    }
  })

  const priced = priceUsage(usage, 'openai', 'gpt-5.6-sol', loadPricing().byModel)
  assert.equal(priced.inputCost, 2)
  assert.equal(priced.cacheReadCost, 0.1)
  assert.equal(priced.outputCost, 0.9)
  assert.equal(priced.cost, 3)
})

test('pricing config loads with unique source links per URL', () => {
  const pricing = loadPricing()
  assert.ok(pricing.asOf)
  assert.ok(pricing.byModel.has('kimi-for-coding/k3'))
  const urls = pricing.sources.map((source) => source.url)
  assert.equal(new Set(urls).size, urls.length, 'source URLs must be deduplicated')
  assert.throws(() => loadPricing('/nonexistent/pricing.json'), /не найден/)
})

test('current root report aggregates agents and multiple models', () => {
  const fixture = createFixture()
  try {
    const report = collectUsage({
      dbPath: fixture.dbPath,
      directory: PROJECT,
      now: NOW,
      top: 2
    })

    assert.equal(report.selectedSessionCount, 8)
    assert.equal(report.rootCount, 1)
    assert.equal(report.malformed, 1)
    assert.equal(report.total.messages, 9)
    assert.equal(report.total.total, 186)
    assert.equal(report.byAgent.get('orchestrator').total, 12)
    assert.equal(report.byAgent.get('reviewer').total, 41)
    assert.equal(report.byAgent.get('explore').total, 17)
    assert.equal(report.byAgent.get('implementer').total, 73)
    assert.equal(report.byAgent.get('spec-writer').total, 13)
    assert.equal(report.byAgent.get('custom-agent').total, 6)
    assert.equal(report.byModel.get('fixture/flash').messages, 4)
    assert.equal(report.byModel.get('fixture/pro').messages, 3)
    assert.equal(report.byAgentModel.get('implementer fixture/flash').total, 68)
    assert.equal(report.byAgentModel.get('implementer fixture/pro').total, 5)
    assert.equal(report.bySession.get('impl').models.size, 2)

    const markdown = renderReport(report)
    assert.match(markdown, /## По агентам и моделям/)
    assert.match(markdown, /\| Агент \| Модель \| Cache miss, токены \| Cache miss, цена/)
    assert.match(markdown, /Cache hit, токены \| Cache hit, цена/)
    assert.match(markdown, /Output, токены \| Output, цена \| Суммарная цена/)
    assert.match(markdown, /## По моделям/)
    assert.match(
      markdown,
      /\| Модель \| Cache miss, токены \| Cache miss, цена \| Cache hit, токены/
    )
    assert.doesNotMatch(markdown, /Этап/, 'stage grouping must be gone')
    assert.match(markdown, /Input miss/)
    assert.match(markdown, /Input hit \(cache read\)/)
    assert.match(markdown, /обычные входные токены вне cache read/)
    assert.match(markdown, /публичным API-тарифам/)
    assert.match(markdown, /openai\/gpt-5\.6-sol/)
    assert.match(markdown, /reported cost OpenCode\/provider/)
    assert.match(markdown, /пропущено повреждённых сообщений: 1/)
  } finally {
    fixture.cleanup()
  }
})

test('--days filters messages by timestamp across root trees', () => {
  const fixture = createFixture()
  try {
    const report = collectUsage({
      dbPath: fixture.dbPath,
      directory: PROJECT,
      days: 2,
      now: NOW
    })

    assert.equal(report.total.messages, 9)
    assert.equal(report.total.total, 186)
    assert.equal(report.rootCount, 1)
    assert.equal(report.byAgent.get('orchestrator').total, 12)
    assert.equal(report.total.total < 296, true, 'old root must be excluded by message timestamp')
  } finally {
    fixture.cleanup()
  }
})

test('incompatible database fails with an actionable error', () => {
  const directory = mkdtempSync(join(tmpdir(), 'kotik-usage-invalid-'))
  const dbPath = join(directory, 'invalid.db')
  const db = new DatabaseSync(dbPath)
  db.exec('CREATE TABLE session (id TEXT)')
  db.close()
  try {
    assert.throws(
      () => collectUsage({ dbPath, directory: PROJECT }),
      /session не содержит/
    )
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
