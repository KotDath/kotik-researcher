// Детерминированные тесты lifecycle controller'а (node:test).
//
// Без реального Electron: CDP мокается node:http сервером на порту 9222,
// фейковые child-процессы — реальные node-процессы (нужен настоящий pid в
// /proc для проверки идентичности и PID-safety). Тесты идут последовательно
// и освобождают порт 9222 в finally.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync } from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import test from 'node:test'

import { DEMO_PROJECT_DIR, USER_DATA_DIR } from './lib-agent.mjs'
import {
  APP_TITLE,
  CDP_PORT,
  STARTUP_WINDOW_MS,
  buildStartPlan,
  classifyStatus,
  cmdLogs,
  findRunProcesses,
  isPortFree,
  main,
  processInfo,
  start,
  status,
  stop,
  writeState
} from './agent-lifecycle.mjs'

function tmpPaths() {
  const dir = mkdtempSync(join(tmpdir(), 'agent-lifecycle-'))
  return { dir, statePath: join(dir, 'state.json'), logPath: join(dir, 'app.log') }
}

function nodePlan(script) {
  return { command: 'node', args: ['-e', script], env: { ...process.env } }
}

/** Фейковый «настоящий» child: detached → собственный pgrp (= pid). */
function liveChild() {
  return spawn('node', ['-e', 'setInterval(() => {}, 1000)'], {
    env: { ...process.env },
    stdio: 'ignore',
    detached: true
  })
}

async function identityOf(pid) {
  const deadline = Date.now() + 2_000
  while (Date.now() < deadline) {
    const info = processInfo(pid)
    if (info && info.cmdline) return info
    await sleep(25)
  }
  return processInfo(pid)
}

function bindNet(port) {
  return new Promise((resolve) => {
    const server = net.createServer()
    server.on('error', () => {})
    server.listen(port, '127.0.0.1', () => resolve(server))
  })
}

function closeNet(server) {
  return new Promise((resolve) => server.close(() => resolve()))
}

function cdpMock({ targets }) {
  const server = http.createServer((req, res) => {
    if (req.url === '/json/version') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(
        JSON.stringify({
          Browser: 'mock-chromium',
          'Protocol-Version': '1.3',
          webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/browser/mock'
        })
      )
    } else if (req.url === '/json/list') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(targets()))
    } else {
      res.writeHead(404)
      res.end()
    }
  })
  return new Promise((resolve) => server.listen(CDP_PORT, '127.0.0.1', () => resolve(server)))
}

function closeHttp(server) {
  return new Promise((resolve) => server.close(() => resolve()))
}

test('buildStartPlan: dev сохраняет dev-изоляцию (--e2e passthrough, CDP env)', () => {
  const plan = buildStartPlan('dev')
  assert.equal(plan.command, 'pnpm')
  assert.deepEqual(plan.args, ['exec', 'electron-vite', 'dev', '--', '--e2e'])
  assert.equal(plan.env.REMOTE_DEBUGGING_PORT, String(CDP_PORT))
  assert.equal(plan.env.NODE_ENV, 'development')
  assert.equal(plan.mode, 'dev')
})

test('buildStartPlan: неизвестный режим — понятная ошибка', () => {
  assert.throws(() => buildStartPlan('bogus'), /dev \| prod/)
})

test('start: занятый порт 9222 — понятная ошибка, чужой процесс не тронут', async () => {
  const foreign = await bindNet(CDP_PORT)
  try {
    const { statePath, logPath } = tmpPaths()
    const result = await start('dev', { plan: nodePlan('setInterval(() => {}, 1000)'), statePath, logPath })
    assert.equal(result.ok, false)
    assert.match(result.error, /9222/)
    assert.match(result.error, /Чужие процессы не трогаем/)
    assert.equal(existsSync(statePath), false, 'state при ошибке не создаётся')
    assert.equal(await isPortFree(CDP_PORT), false, 'чужой процесс на порту жив')
  } finally {
    await closeNet(foreign)
  }
})

test('start: повторный start при живом state — ошибка, текущий не тронут', async () => {
  const { statePath, logPath } = tmpPaths()
  const first = await start('dev', { plan: nodePlan('setInterval(() => {}, 1000)'), statePath, logPath })
  assert.equal(first.ok, true)
  try {
    const second = await start('dev', { plan: nodePlan('setInterval(() => {}, 1000)'), statePath, logPath })
    assert.equal(second.ok, false)
    assert.match(second.error, /уже запущен/)
    const st = await status({ statePath })
    assert.equal(st.status, 'STARTING', 'записанная группа жива и классифицируется')
  } finally {
    await stop({ statePath })
  }
})

test('start: создаёт сид-данные в изолированном userData (реальный seed)', async () => {
  const { statePath, logPath } = tmpPaths()
  const started = await start('dev', { plan: nodePlan('setInterval(() => {}, 1000)'), statePath, logPath })
  assert.equal(started.ok, true)
  assert.equal(existsSync(join(USER_DATA_DIR, 'recent-projects.json')), true, 'recent-projects посеяны')
  assert.equal(existsSync(join(DEMO_PROJECT_DIR, 'README.md')), true, 'демо-проект посеян')
  await stop({ statePath })
})

test('start: seed после preflight и до spawn; при провале preflight — не вызывается', async () => {
  const { statePath, logPath } = tmpPaths()
  const order = []
  // preflight failure (порт занят) → seed НЕ вызывается (не затирает данные зря)
  const foreign = await bindNet(CDP_PORT)
  try {
    const failed = await start('dev', {
      plan: nodePlan('setInterval(() => {}, 1000)'),
      statePath,
      logPath,
      seedImpl: () => order.push('seed')
    })
    assert.equal(failed.ok, false)
    assert.deepEqual(order, [], 'seed не вызван при провале preflight')
  } finally {
    await closeNet(foreign)
  }
  // успешный start → seed строго до spawn
  const spawnImpl = (cmd, args, opts) => {
    order.push('spawn')
    return spawn(cmd, args, opts)
  }
  const ok = await start('dev', {
    plan: nodePlan('setInterval(() => {}, 1000)'),
    statePath,
    logPath,
    seedImpl: () => order.push('seed'),
    spawnImpl
  })
  assert.equal(ok.ok, true)
  assert.deepEqual(order, ['seed', 'spawn'], 'seed выполнен после preflight и до spawn')
  await stop({ statePath })
})

test('start: новый прогон очищает лог (второй лог не содержит строк первого)', async () => {
  const { statePath, logPath } = tmpPaths()
  const first = await start('dev', { plan: nodePlan('console.log("run-one-marker")'), statePath, logPath })
  assert.equal(first.ok, true)
  await sleep(400)
  assert.match(cmdLogs({ logPath }).content, /run-one-marker/)
  await stop({ statePath })
  const second = await start('dev', { plan: nodePlan('console.log("run-two-marker")'), statePath, logPath })
  assert.equal(second.ok, true)
  await sleep(400)
  const content = cmdLogs({ logPath }).content
  assert.match(content, /run-two-marker/)
  assert.doesNotMatch(content, /run-one-marker/, 'лог очищен новым прогоном')
  await stop({ statePath })
})

test('status: child exit до readiness → STOPPED + очистка state', async () => {
  const { statePath, logPath } = tmpPaths()
  const result = await start('dev', { plan: nodePlan('console.log("bye")'), statePath, logPath })
  assert.equal(result.ok, true)
  await sleep(400)
  const st = await status({ statePath })
  assert.equal(st.status, 'STOPPED')
  assert.equal(existsSync(statePath), false, 'stale state очищен')
})

test('status/classify: STARTING → CDP_UNAVAILABLE → PAGE_MISSING → READY → TARGET_CHANGED', async () => {
  const child = liveChild()
  const info = await identityOf(child.pid)
  assert.ok(info, 'предусловие: живой процесс с идентичностью')
  const now = Date.now()
  const state = {
    pid: child.pid,
    pgid: child.pid,
    mode: 'dev',
    startedAtMs: now,
    starttime: info.starttime,
    cmdline: info.cmdline,
    pageTargetId: null,
    logPath: '/tmp/unused.log'
  }
  try {
    // CDP не отвечает: внутри окна — STARTING, после окна — CDP_UNAVAILABLE
    assert.equal(classifyStatus({ state, now: now + 1_000, cdpAlive: false, targets: [] }).status, 'STARTING')
    assert.equal(
      classifyStatus({ state, now: now + STARTUP_WINDOW_MS + 1, cdpAlive: false, targets: [] }).status,
      'CDP_UNAVAILABLE'
    )
    // CDP жив, но страницы нет
    assert.equal(classifyStatus({ state, now, cdpAlive: true, targets: [] }).status, 'PAGE_MISSING')
    assert.equal(
      classifyStatus({ state, now, cdpAlive: true, targets: [{ id: 'other', type: 'page', title: 'Not Ours' }] }).status,
      'PAGE_MISSING'
    )
    // READY (запись pageTargetId происходит в status(), здесь — классификация)
    const targetA = { id: 'target-A', type: 'page', title: APP_TITLE }
    assert.equal(classifyStatus({ state, now, cdpAlive: true, targets: [targetA] }).status, 'READY')
    // смена target относительно записанного → TARGET_CHANGED
    state.pageTargetId = 'target-A'
    const targetB = { id: 'target-B', type: 'page', title: APP_TITLE }
    assert.equal(classifyStatus({ state, now, cdpAlive: true, targets: [targetB] }).status, 'TARGET_CHANGED')
    // тот же target → по-прежнему READY
    assert.equal(classifyStatus({ state, now, cdpAlive: true, targets: [targetA] }).status, 'READY')
  } finally {
    process.kill(child.pid)
  }
})

test('status: смена page target → TARGET_CHANGED (интеграция через CDP-мок)', async () => {
  const { statePath, logPath } = tmpPaths()
  const started = await start('dev', { plan: nodePlan('setInterval(() => {}, 1000)'), statePath, logPath })
  assert.equal(started.ok, true)
  let current = [{ id: 'target-A', type: 'page', title: APP_TITLE }]
  const mock = await cdpMock({ targets: () => current })
  try {
    const st1 = await status({ statePath })
    assert.equal(st1.status, 'READY')
    assert.equal(st1.recordedTargetId, 'target-A')
    current = [{ id: 'target-B', type: 'page', title: APP_TITLE }]
    const st2 = await status({ statePath })
    assert.equal(st2.status, 'TARGET_CHANGED')
  } finally {
    await closeHttp(mock)
    await stop({ statePath })
  }
})

test('status: pid мёртв → STOPPED, state очищен', async () => {
  const { statePath } = tmpPaths()
  const ghost = spawn('node', ['-e', 'process.exit(0)'], { env: { ...process.env }, stdio: 'ignore' })
  const deadPid = ghost.pid
  await sleep(300)
  assert.equal(processInfo(deadPid), null, 'предусловие: процесс уже мёртв')
  writeState(
    { pid: deadPid, pgid: deadPid, mode: 'dev', startedAtMs: Date.now() - 60_000, starttime: '1', cmdline: 'ghost' },
    statePath
  )
  const st = await status({ statePath })
  assert.equal(st.status, 'STOPPED')
  assert.equal(existsSync(statePath), false, 'state очищен')
})

test('stop: PID safety — не убивает процесс вне state (переиспользованный pid)', async () => {
  const { statePath } = tmpPaths()
  const foreign = liveChild()
  try {
    writeState(
      { pid: foreign.pid, pgid: foreign.pid, mode: 'dev', startedAtMs: Date.now(), starttime: '999999', cmdline: 'wrong-cmdline', pageTargetId: null },
      statePath
    )
    const r = await stop({ statePath })
    assert.equal(r.ok, true)
    assert.equal(r.stale, true, 'записанная идентичность не совпала — stale')
    assert.equal(foreign.exitCode, null, 'чужой процесс НЕ убит')
    assert.equal(existsSync(statePath), false, 'state очищен')
    assert.equal(r.portFree, true)
  } finally {
    process.kill(foreign.pid)
  }
})

test('stop: mismatched pgrp в state → сигнал НЕ посылается чужой группе', async () => {
  const { statePath } = tmpPaths()
  const leader = liveChild() // detached: фактический pgrp = собственный pid
  const foreignGroup = liveChild() // чужая живая группа
  const info = await identityOf(leader.pid)
  assert.ok(info, 'предусловие: живой leader с идентичностью')
  try {
    writeState(
      {
        pid: leader.pid,
        pgid: foreignGroup.pid, // повреждённый state: pgid ≠ фактическому pgrp leader'а
        mode: 'dev',
        startedAtMs: Date.now(),
        starttime: info.starttime, // starttime совпадает — спасает только проверка pgrp
        cmdline: info.cmdline,
        pageTargetId: null
      },
      statePath
    )
    const r = await stop({ statePath })
    assert.equal(r.ok, true)
    assert.equal(r.stale, true, 'identity не подтверждена (pgrp mismatch) — stale')
    assert.equal(leader.exitCode, null, 'записанный pid жив (не тронут)')
    assert.equal(foreignGroup.exitCode, null, 'чужая группа НЕ получила сигнал (доказательство: kill не послан)')
    assert.equal(existsSync(statePath), false, 'state очищен')
  } finally {
    process.kill(leader.pid)
    process.kill(foreignGroup.pid)
  }
})

test('status/stop: leader мёртв, потомок жив → state не теряется, stop добивает только свой run', async () => {
  const { statePath, logPath } = tmpPaths()
  const plan = nodePlan(`
    const { spawn } = require('node:child_process')
    spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })
    process.exit(0)
  `)
  const started = await start('dev', { plan, statePath, logPath })
  assert.equal(started.ok, true)
  const leaderPid = started.pid
  await sleep(600) // leader вышел, потомок (с тем же run id) жив
  assert.equal(processInfo(leaderPid), null, 'предусловие: leader мёртв')
  assert.equal(findRunProcesses(started.state.runId).length > 0, true, 'предусловие: потомок жив')
  const st = await status({ statePath })
  assert.notEqual(st.status, 'STOPPED', 'state не теряется при живых потомках')
  assert.equal(existsSync(statePath), true, 'state сохранён')
  const r = await stop({ statePath })
  assert.equal(r.ok, true)
  assert.equal(r.status, 'STOPPED')
  assert.equal(existsSync(statePath), false, 'state очищен после успешного stop')
  assert.equal(findRunProcesses(started.state.runId).length, 0, 'потомки run добиты и только они')
})

test('stop: группа не умерла вовремя → STOP_FAILED, state на месте, повторный stop работает', async () => {
  const { statePath, logPath } = tmpPaths()
  const started = await start('dev', { plan: nodePlan('setInterval(() => {}, 1000)'), statePath, logPath })
  assert.equal(started.ok, true)
  const r1 = await stop({ statePath, waitDeath: async () => false })
  assert.equal(r1.ok, false, 'STOP_FAILED → ok=false (CLI даст ненулевой exit)')
  assert.equal(r1.status, 'STOP_FAILED')
  assert.equal(existsSync(statePath), true, 'state сохраняется при сбое')
  const r2 = await stop({ statePath })
  assert.equal(r2.ok, true, 'повторный stop работает')
  assert.equal(existsSync(statePath), false, 'state очищен после успешного повторного stop')
})

test('CLI: STOP_FAILED → ненулевой exit, state на месте, повторный stop возможен', async () => {
  const { statePath, logPath } = tmpPaths()
  process.env.KOTIK_LIFECYCLE_STATE = statePath
  process.env.KOTIK_LIFECYCLE_LOG = logPath
  const prevExitCode = process.exitCode
  try {
    const started = await start('dev', { plan: nodePlan('setInterval(() => {}, 1000)'), statePath, logPath })
    assert.equal(started.ok, true)
    const fakeStop = (opts) => stop({ ...opts, waitDeath: async () => false })
    await main(['stop'], { stop: fakeStop })
    assert.equal(process.exitCode, 1, 'STOP_FAILED → exit code 1')
    assert.equal(existsSync(statePath), true, 'state на месте после неудачи')
    process.exitCode = prevExitCode
    await main(['stop'])
    assert.equal(existsSync(statePath), false, 'повторный stop (реальный) очищает state')
    process.exitCode = prevExitCode
  } finally {
    delete process.env.KOTIK_LIFECYCLE_STATE
    delete process.env.KOTIK_LIFECYCLE_LOG
    process.exitCode = prevExitCode
    await stop({ statePath })
  }
})

test('stop: idempotent (два подряд — успех)', async () => {
  const { statePath } = tmpPaths()
  const r1 = await stop({ statePath })
  assert.equal(r1.ok, true)
  assert.equal(r1.status, 'STOPPED')
  assert.equal(r1.idempotent, true)
  const r2 = await stop({ statePath })
  assert.equal(r2.ok, true)
  assert.equal(r2.status, 'STOPPED')
  assert.equal(r2.idempotent, true)
})

test('stop: завершает записанную process group и освобождает порт', async () => {
  const { statePath, logPath } = tmpPaths()
  const started = await start('dev', { plan: nodePlan('setInterval(() => {}, 1000)'), statePath, logPath })
  assert.equal(started.ok, true)
  const st1 = await status({ statePath })
  assert.equal(st1.status, 'STARTING', 'группа жива, CDP ещё не поднялся')
  const r = await stop({ statePath })
  assert.equal(r.ok, true)
  assert.equal(r.status, 'STOPPED')
  assert.equal(r.portFree, true)
  assert.equal(existsSync(statePath), false)
  const st2 = await status({ statePath })
  assert.equal(st2.status, 'STOPPED')
})

test('logs: читает хвост stdout/stderr child', async () => {
  const { statePath, logPath } = tmpPaths()
  const started = await start('dev', { plan: nodePlan('console.log("hello-from-child")'), statePath, logPath })
  assert.equal(started.ok, true)
  await sleep(400)
  const logs = cmdLogs({ logPath })
  assert.equal(logs.ok, true)
  assert.match(logs.content, /hello-from-child/)
})
