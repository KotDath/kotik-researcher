// Lifecycle controller агентских прогонов (test:agent:lifecycle).
//
// Отвечает за детерминированный жизненный цикл изолированного Electron
// (dev/prod) на CDP-порту 9222. В отличие от foreground-скриптов
// (test:agent:dev / test:agent:electron) управляет процессом извне:
//
//   start dev|prod — detached process group (child в своей группе через
//     setsid), state/pid/log — ТОЛЬКО в /tmp/opencode; родитель завершается
//     сразу, приложение живёт дальше. Сид-данные (seedDemoData) создаются
//     ПОСЛЕ preflight-проверок и ДО spawn.
//   status         — ровно одна классификация:
//     READY / STARTING / STOPPED / CDP_UNAVAILABLE / PAGE_MISSING / TARGET_CHANGED
//   stop           — завершает ТОЛЬКО процессы, идентифицированные как наши
//     (верифицированный leader по starttime+pgrp → kill -pgid; иначе живые
//     члены прогона по run id в environ → kill по pid). Никогда чужие
//     процессы; idempotent; защита от PID reuse; при неудаче state
//     сохраняется (повторный stop возможен).
//   logs           — хвост stdout/stderr запущенного child.
//
// Безопасность stop: идентичность НЕ строится только на произвольных полях
// state. Leader проверяется по /proc/<pid>/stat (starttime + фактический
// pgrp против state.pgid). Если leader мёртв или не совпал — живые члены
// прогона находятся по уникальному run id (KOTIK_AGENT_RUN_ID) в environ
// процессов: повреждённый state не направляет сигнал на чужую группу.
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  openSync,
  closeSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import http from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { pathToFileURL } from 'node:url'
import {
  CDP_PORT,
  MAIN_ENTRY,
  devLaunchSpec,
  isPortFree,
  prodLaunchSpec,
  seedDemoData
} from './lib-agent.mjs'

export { CDP_PORT, isPortFree }

export const APP_TITLE = 'Kotik Researcher'
export const RUN_ID_ENV = 'KOTIK_AGENT_RUN_ID'
export const STARTUP_WINDOW_MS = 30_000
export const KILL_TIMEOUT_MS = 8_000
export const PORT_FREE_TIMEOUT_MS = 5_000

// State/log живут только в /tmp/opencode. Пути читаются лениво (не на
// import) — тесты и CLI могут переопределить через env KOTIK_LIFECYCLE_STATE
// / KOTIK_LIFECYCLE_LOG.
export function defaultStatePath() {
  return process.env.KOTIK_LIFECYCLE_STATE ?? join(tmpdir(), 'opencode', 'agent-lifecycle-state.json')
}

export function defaultLogPath() {
  return process.env.KOTIK_LIFECYCLE_LOG ?? join(tmpdir(), 'opencode', 'agent-lifecycle.log')
}

// ---------------------------------------------------------------------------
// State (диск)

export function readState(statePath = defaultStatePath()) {
  try {
    return JSON.parse(readFileSync(statePath, 'utf8'))
  } catch {
    return null
  }
}

export function writeState(state, statePath = defaultStatePath()) {
  mkdirSync(dirname(statePath), { recursive: true })
  writeFileSync(statePath, JSON.stringify(state, null, 2) + '\n')
}

export function clearState(statePath = defaultStatePath()) {
  try {
    rmSync(statePath, { force: true })
  } catch {
    /* уже нет — не важно */
  }
}

// ---------------------------------------------------------------------------
// Идентичность процесса (защита от PID reuse и чужих групп)

/** Читает /proc/<pid>/stat (starttime, pgrp) и /proc/<pid>/cmdline. */
export function processInfo(pid) {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8')
    // comm может содержать пробелы/скобки — поля считаем после последней ')'
    const after = stat.slice(stat.lastIndexOf(')') + 2).split(' ')
    // after[0]=state(3), after[2]=pgrp(5), after[19]=starttime(22)
    let cmdline = ''
    try {
      cmdline = readFileSync(`/proc/${pid}/cmdline`, 'utf8').replace(/\0/g, ' ').trim()
    } catch {
      cmdline = ''
    }
    return { starttime: after[19], pgrp: after[2], cmdline }
  } catch {
    return null
  }
}

/** Записи environ процесса (массив KEY=VALUE) или null, если недоступно. */
export function readProcessEnv(pid) {
  try {
    return readFileSync(`/proc/${pid}/environ`, 'utf8').split('\0').filter(Boolean)
  } catch {
    return null
  }
}

/** Живые процессы нашего прогона: в environ есть RUN_ID_ENV=<runId>. */
export function findRunProcesses(runId) {
  if (!runId) return []
  const marker = `${RUN_ID_ENV}=${runId}`
  const members = []
  try {
    for (const name of readdirSync('/proc')) {
      if (!/^\d+$/.test(name)) continue
      const env = readProcessEnv(Number(name))
      if (env && env.includes(marker)) members.push(Number(name))
    }
  } catch {
    /* /proc недоступен — членов не видно */
  }
  return members
}

/**
 * Проверяет, что процессы из state — действительно наши.
 *
 * 1. Leader-путь: pid жив, starttime совпадает (pid не переиспользован) И
 *    фактический pgrp совпадает с state.pgid (повреждённый state.pgid не
 *    направляет stop на чужую группу). cmdline не используется: Electron/
 *    Chromium переписывает свой argv при старте.
 * 2. Fallback (leader мёртв или не совпал): живые члены прогона ищутся по
 *    уникальному run id в environ — state не теряется, когда leader умер,
 *    а потомки живы, и stop добивает только их.
 */
export function verifyGroup(state) {
  if (!state?.pid || !state?.pgid) {
    return { alive: false, identity: false, leaderVerified: false, members: [] }
  }
  const leader = processInfo(state.pid)
  if (leader) {
    const leaderOk =
      String(leader.starttime) === String(state.starttime) &&
      String(leader.pgrp) === String(state.pgid)
    if (leaderOk) {
      return { alive: true, identity: true, leaderVerified: true, members: [], info: leader }
    }
  }
  const members = findRunProcesses(state.runId)
  if (members.length > 0) {
    return { alive: true, identity: true, leaderVerified: false, members }
  }
  return { alive: false, identity: false, leaderVerified: false, members: [] }
}

/** Жив ли хоть один процесс в process group (по /proc). */
export function groupExists(pgid) {
  try {
    for (const name of readdirSync('/proc')) {
      if (!/^\d+$/.test(name)) continue
      const info = processInfo(Number(name))
      if (info && Number(info.pgrp) === Number(pgid)) return true
    }
    return false
  } catch {
    // /proc недоступен — консервативно считаем группу живой
    return true
  }
}

export function killGroup(pgid, signal = 'SIGTERM') {
  try {
    process.kill(-pgid, signal)
    return true
  } catch {
    return false
  }
}

export function killPid(pid, signal = 'SIGTERM') {
  try {
    process.kill(pid, signal)
    return true
  } catch {
    return false
  }
}

export async function waitForGroupDeath(pgid, timeoutMs = KILL_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (!groupExists(pgid)) return true
    await sleep(100)
  }
  return false
}

export async function waitForRunDeath(runId, timeoutMs = KILL_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (findRunProcesses(runId).length === 0) return true
    await sleep(100)
  }
  return false
}

/** Куда шлём сигналы: группа (верифицированный leader) или run-члены. */
export function killTargetsFor(state, group) {
  if (group.leaderVerified) return { kind: 'group', pgid: state.pgid }
  return { kind: 'run', runId: state.runId }
}

export function killTargets(target, signal) {
  if (target.kind === 'group') return killGroup(target.pgid, signal)
  let any = false
  for (const pid of findRunProcesses(target.runId)) any = killPid(pid, signal) || any
  return any
}

export async function waitTargetsDead(target, timeoutMs = KILL_TIMEOUT_MS) {
  if (target.kind === 'group') return waitForGroupDeath(target.pgid, timeoutMs)
  return waitForRunDeath(target.runId, timeoutMs)
}

// ---------------------------------------------------------------------------
// CDP-запросы

export function httpGetJson(url, timeoutMs = 2_000) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      let data = ''
      res.on('data', (chunk) => (data += chunk))
      res.on('end', () => {
        try {
          resolve(JSON.parse(data))
        } catch {
          resolve(null)
        }
      })
    })
    req.on('timeout', () => {
      req.destroy()
      resolve(null)
    })
    req.on('error', () => resolve(null))
  })
}

export async function cdpVersion(port = CDP_PORT) {
  return httpGetJson(`http://127.0.0.1:${port}/json/version`)
}

export async function cdpTargets(port = CDP_PORT) {
  return httpGetJson(`http://127.0.0.1:${port}/json/list`)
}

export function findAppTarget(targets) {
  if (!Array.isArray(targets)) return null
  return targets.find((t) => t.type === 'page' && t.title === APP_TITLE) ?? null
}

// ---------------------------------------------------------------------------
// Классификация (чистая функция — тестируется напрямую)

export function classifyStatus({ state, now = Date.now(), cdpAlive, targets }) {
  const group = verifyGroup(state)
  if (!group.alive || !group.identity) return { status: 'STOPPED', group }
  if (!cdpAlive) {
    const elapsed = now - (state.startedAtMs ?? now)
    return {
      status: elapsed < STARTUP_WINDOW_MS ? 'STARTING' : 'CDP_UNAVAILABLE',
      group
    }
  }
  const target = findAppTarget(targets)
  if (!target) return { status: 'PAGE_MISSING', group }
  if (state.pageTargetId && state.pageTargetId !== target.id) {
    return { status: 'TARGET_CHANGED', group, target }
  }
  return { status: 'READY', group, target }
}

// ---------------------------------------------------------------------------
// Команды

export function buildStartPlan(mode) {
  if (mode === 'dev') return { mode, ...devLaunchSpec() }
  if (mode === 'prod') {
    if (!existsSync(MAIN_ENTRY)) {
      throw new Error(
        `[test:agent:lifecycle] ${MAIN_ENTRY} не найден.\n` +
          'Сначала выполните "pnpm build", затем повторите.'
      )
    }
    return { mode, ...prodLaunchSpec() }
  }
  throw new Error(`[test:agent:lifecycle] неизвестный режим "${mode}": используйте dev | prod`)
}

/** Дочитывает starttime после spawn (короткий retry на появление /proc). */
async function recordIdentity(pid, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const info = processInfo(pid)
    if (info) return info
    await sleep(50)
  }
  return processInfo(pid)
}

export async function start(
  mode,
  { plan, spawnImpl = spawn, seedImpl = seedDemoData, statePath = defaultStatePath(), logPath = defaultLogPath() } = {}
) {
  const resolvedPlan = plan ?? buildStartPlan(mode)

  // PREFLIGHT: порт свободен и нет живого state. Сид-данные вызываются ТОЛЬКО
  // после успешного preflight (провал не затирает данные зря) и ДО spawn.
  if (!(await isPortFree(CDP_PORT))) {
    return {
      ok: false,
      error: `[test:agent:lifecycle] порт ${CDP_PORT} уже занят другим процессом. ` +
        'Чужие процессы не трогаем — завершите процесс на порту вручную или через stop.'
    }
  }

  const existing = readState(statePath)
  if (existing && verifyGroup(existing).identity) {
    return {
      ok: false,
      error: `[test:agent:lifecycle] агентский прогон уже запущен ` +
        `(mode=${existing.mode}, pid=${existing.pid}). Сначала "stop".`
    }
  }
  if (existing) clearState(statePath)

  seedImpl()

  const runId = randomUUID()
  const env = { ...resolvedPlan.env, [RUN_ID_ENV]: runId }

  // Лог очищается на каждый прогон ('w'), чтобы прогоны не смешивались.
  mkdirSync(dirname(logPath), { recursive: true })
  const logFd = openSync(logPath, 'w')
  let child
  try {
    child = spawnImpl(resolvedPlan.command, resolvedPlan.args, {
      detached: true,
      stdio: ['ignore', logFd, logFd],
      env
    })
  } catch (err) {
    closeSync(logFd)
    return { ok: false, error: `[test:agent:lifecycle] не удалось запустить: ${err.message}` }
  }
  closeSync(logFd)

  if (!child.pid) {
    child.on?.('error', () => {})
    return { ok: false, error: `[test:agent:lifecycle] не удалось запустить ${resolvedPlan.command}` }
  }
  child.on?.('error', (err) => {
    // процесс мог уже стартовать; async-ошибка exec — вне контроля controller'а
    console.error(`[test:agent:lifecycle] spawn warning: ${err.message}`)
  })
  child.unref?.()

  const identity = await recordIdentity(child.pid)
  const startedAtMs = Date.now()
  const state = {
    pid: child.pid,
    pgid: child.pid, // detached => setsid => process group leader
    runId,
    mode,
    startedAtMs,
    startedAt: new Date(startedAtMs).toISOString(),
    starttime: identity?.starttime,
    cmdline: identity?.cmdline,
    pageTargetId: null,
    logPath
  }
  writeState(state, statePath)
  return { ok: true, pid: child.pid, pgid: child.pid, mode, logPath, state }
}

export async function status({ statePath = defaultStatePath(), port = CDP_PORT } = {}) {
  const state = readState(statePath)
  const version = await cdpVersion(port)
  const cdpAlive = Boolean(version && typeof version.webSocketDebuggerUrl === 'string')
  const targets = cdpAlive ? await cdpTargets(port) : []
  const { status: classification, target } = classifyStatus({
    state,
    now: Date.now(),
    cdpAlive,
    targets
  })

  if (classification === 'READY' && state && !state.pageTargetId && target) {
    state.pageTargetId = target.id
    writeState(state, statePath)
  }
  if (classification === 'STOPPED' && state) {
    clearState(statePath)
  }
  return {
    status: classification,
    cdpAlive,
    pageTarget: target ? { id: target.id, title: target.title } : null,
    recordedTargetId: state?.pageTargetId ?? null,
    pid: state?.pid ?? null
  }
}

async function waitPortFree(port, timeoutMs = PORT_FREE_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await isPortFree(port)) return true
    await sleep(100)
  }
  return false
}

export async function stop({
  statePath = defaultStatePath(),
  port = CDP_PORT,
  killTimeoutMs = KILL_TIMEOUT_MS,
  waitDeath
} = {}) {
  const state = readState(statePath)
  if (!state) {
    const portFree = await isPortFree(port)
    return {
      ok: true,
      status: 'STOPPED',
      idempotent: true,
      portFree,
      note: portFree ? '' : `порт ${port} занят процессом вне state (не тронут)`
    }
  }

  const group = verifyGroup(state)
  if (!group.identity) {
    clearState(statePath)
    const portFree = await isPortFree(port)
    return {
      ok: true,
      status: 'STOPPED',
      stale: true,
      portFree,
      note: portFree
        ? 'записанный процесс не жив (stale state очищен)'
        : `записанный процесс не жив, но порт ${port} занят посторонним процессом (не тронут)`
    }
  }

  const target = killTargetsFor(state, group)
  const wait = waitDeath ?? ((t) => waitTargetsDead(t, killTimeoutMs))

  killTargets(target, 'SIGTERM')
  let dead = await wait(target)
  if (!dead) {
    killTargets(target, 'SIGKILL')
    dead = await wait(target)
  }

  if (!dead) {
    // state НЕ очищается: повторный stop возможен; CLI вернёт ненулевой exit.
    return {
      ok: false,
      status: 'STOP_FAILED',
      statePreserved: true,
      target,
      note:
        target.kind === 'group'
          ? `не удалось завершить process group ${target.pgid} (pid ${state.pid})`
          : `не удалось завершить run ${target.runId} (pid ${state.pid})`
    }
  }

  clearState(statePath)
  const portFree = await waitPortFree(port)
  return {
    ok: true,
    status: 'STOPPED',
    portFree,
    note: portFree ? '' : `процессы остановлены, но порт ${port} занят посторонним процессом (не тронут)`
  }
}

export function cmdLogs({ logPath = defaultLogPath(), tail = 200 } = {}) {
  if (!existsSync(logPath)) return { ok: true, content: '(лог пуст)' }
  const lines = readFileSync(logPath, 'utf8').split('\n')
  return { ok: true, content: lines.slice(-tail).join('\n') }
}

// ---------------------------------------------------------------------------
// CLI

function printStatus(result) {
  const detail = result.pageTarget
    ? `page target: ${result.pageTarget.title} (${result.pageTarget.id})`
    : result.pid
      ? `pid: ${result.pid}`
      : ''
  console.log(`STATUS: ${result.status}${detail ? ` — ${detail}` : ''}`)
  if (result.status === 'STARTING') {
    console.log(`  CDP ещё не поднялся (окно готовности ${STARTUP_WINDOW_MS / 1000}s) — подожди и опроси снова.`)
  }
  if (result.status === 'CDP_UNAVAILABLE') {
    console.log('  CDP не отвечает дольше окна готовности — сбой запуска, один restart по протоколу.')
  }
  if (result.status === 'PAGE_MISSING') {
    console.log(`  CDP жив, но page target с title "${APP_TITLE}" не найден.`)
  }
  if (result.status === 'TARGET_CHANGED') {
    console.log(`  записанная группа жива, но page target сменился (был ${result.recordedTargetId}).`)
  }
}

function usage() {
  console.log(
    'Usage: node scripts/agent-lifecycle.mjs <start dev|prod | status | stop | logs [--tail N]>'
  )
  process.exitCode = 1
}

export async function main(
  argv = process.argv.slice(2),
  { start: startImpl = start, status: statusImpl = status, stop: stopImpl = stop } = {}
) {
  const [cmd, arg] = argv
  switch (cmd) {
    case 'start': {
      const mode = arg ?? 'dev'
      let plan
      try {
        plan = buildStartPlan(mode)
      } catch (err) {
        console.error(err.message)
        process.exitCode = 1
        return
      }
      const result = await startImpl(mode, { plan })
      if (!result.ok) {
        console.error(result.error)
        process.exitCode = 1
        return
      }
      console.log(
        `[test:agent:lifecycle] ${result.mode} запущен detached (pid ${result.pid}, pgid ${result.pgid}).\n` +
          `state: ${defaultStatePath()}\nlog: ${defaultLogPath()}\n` +
          `Далее: "status" (READY/STARTING/…), по завершении — обязательный "stop".`
      )
      return
    }
    case 'status':
      printStatus(await statusImpl())
      return
    case 'stop': {
      const result = await stopImpl()
      if (result.status === 'STOP_FAILED') {
        console.error(`STOP_FAILED: ${result.note ?? 'не удалось завершить процесс'}`)
        process.exitCode = 1
        return
      }
      console.log(`STOPPED${result.stale ? ' (stale state)' : ''}${result.idempotent ? ' (не было запущено)' : ''}`)
      if (result.note) console.log(`  ${result.note}`)
      return
    }
    case 'logs': {
      const tailIdx = argv.indexOf('--tail')
      const tail = tailIdx >= 0 ? Number(argv[tailIdx + 1]) || 200 : 200
      const result = cmdLogs({ tail })
      if (!result.ok) {
        console.error(result.content)
        process.exitCode = 1
        return
      }
      console.log(result.content)
      return
    }
    default:
      usage()
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main()
}
