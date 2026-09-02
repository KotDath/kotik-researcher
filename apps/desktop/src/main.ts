import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { join, resolve } from 'node:path'
import { app, BrowserWindow, dialog, ipcMain, type IpcMainEvent } from 'electron'

let agentProcess: ChildProcessWithoutNullStreams | undefined
let gatewayConfig: { baseUrl: string; accessToken: string } | undefined
let quitting = false
let quitAfterAgentStops = false
let stoppingAgent: Promise<void> | undefined

async function createWindow(): Promise<void> {
  const accessToken = randomBytes(32).toString('base64url')
  const rendererURL = app.isPackaged ? undefined : 'http://127.0.0.1:5173'
  const baseUrl = await startAgent(accessToken)
  gatewayConfig = { baseUrl, accessToken }

  ipcMain.on('kotik:get-gateway-config', provideGatewayConfig)
  const window = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 760,
    minHeight: 640,
    backgroundColor: '#11100f',
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  const applicationURL = rendererURL ?? baseUrl
  const allowedOrigins = new Set([new URL(applicationURL).origin, new URL(baseUrl).origin])
  window.webContents.on('will-navigate', (event, targetURL) => {
    if (!allowedOrigins.has(new URL(targetURL).origin)) {
      event.preventDefault()
    }
  })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  await window.loadURL(applicationURL)
}

async function startAgent(accessToken: string): Promise<string> {
  const executableName = process.platform === 'win32' ? 'kotik-agent.exe' : 'kotik-agent'
  const executable = app.isPackaged
    ? join(process.resourcesPath, 'bin', executableName)
    : resolve(app.getAppPath(), 'apps/desktop/bin', executableName)
  const arguments_ = ['--addr=127.0.0.1:0', '--open=false', '--token-stdin=true']
  if (app.isPackaged) {
    arguments_.push(`--web-root=${join(process.resourcesPath, 'web')}`)
  } else {
    arguments_.push('--allowed-origin=http://127.0.0.1:5173')
  }

  const child = spawn(executable, arguments_, {
    cwd: app.isPackaged ? process.resourcesPath : app.getAppPath(),
    env: process.env,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  })
  agentProcess = child
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (data: string) => console.error(data.trimEnd()))

  return new Promise<string>((resolveReady, rejectReady) => {
    let settled = false
    let ready = false
    let stdout = ''
    const timeout = setTimeout(() => finish(new Error('Go agent did not become ready in time')), 15_000)

    const finish = (error?: Error, url?: string) => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timeout)
      if (error) {
        child.kill()
        rejectReady(error)
      } else if (url) {
        ready = true
        resolveReady(url)
      }
    }

    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (data: string) => {
      stdout += data
      const newline = stdout.indexOf('\n')
      if (newline === -1) {
        if (stdout.length > 64 << 10) {
          finish(new Error('Go agent readiness message is too large'))
        }
        return
      }
      const line = stdout.slice(0, newline)
      try {
        const message: unknown = JSON.parse(line)
        if (!isReadyMessage(message)) {
          throw new Error('Go agent returned an invalid readiness message')
        }
        const url = new URL(message.url)
        if (url.protocol !== 'http:' || (url.hostname !== '127.0.0.1' && url.hostname !== '::1')) {
          throw new Error('Go agent returned a non-loopback URL')
        }
        finish(undefined, url.toString().replace(/\/$/, ''))
      } catch (error) {
        finish(error instanceof Error ? error : new Error(String(error)))
      }
    })
    child.once('error', (error) => finish(error))
    child.once('exit', (code, signal) => {
      if (agentProcess === child) {
        agentProcess = undefined
      }
      const error = new Error(`Go agent exited with code ${String(code)} and signal ${String(signal)}`)
      if (!settled) {
        finish(error)
      } else if (ready && !quitting) {
        dialog.showErrorBox('kotik-researcher agent stopped', error.message)
        app.quit()
      }
    })
    child.stdin.once('error', (error) => finish(error))
    child.stdin.end(`${accessToken}\n`)
  })
}

function isReadyMessage(value: unknown): value is { type: 'ready'; url: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    value.type === 'ready' &&
    'url' in value &&
    typeof value.url === 'string'
  )
}

function provideGatewayConfig(event: IpcMainEvent): void {
  event.returnValue = gatewayConfig
}

function stopAgent(): Promise<void> {
  if (stoppingAgent) {
    return stoppingAgent
  }
  const child = agentProcess
  agentProcess = undefined
  if (!child || child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve()
  }

  stoppingAgent = new Promise<void>((resolveStopped) => {
    let finalTimer: ReturnType<typeof setTimeout> | undefined
    let stopped = false
    const finish = () => {
      if (stopped) {
        return
      }
      stopped = true
      clearTimeout(forceTimer)
      if (finalTimer) {
        clearTimeout(finalTimer)
      }
      resolveStopped()
    }
    const forceTimer = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) {
        if (!child.kill('SIGKILL')) {
          finish()
          return
        }
        finalTimer = setTimeout(finish, 2_000)
      }
    }, 3_000)
    child.once('exit', finish)
    if (!child.kill('SIGTERM')) {
      finish()
    }
  }).finally(() => {
    stoppingAgent = undefined
  })
  return stoppingAgent
}

app.whenReady().then(createWindow).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  dialog.showErrorBox('kotik-researcher could not start', message)
  app.quit()
})

app.on('window-all-closed', () => app.quit())
app.on('before-quit', (event) => {
  if (quitAfterAgentStops) {
    return
  }
  event.preventDefault()
  if (quitting) {
    return
  }
  quitting = true
  ipcMain.off('kotik:get-gateway-config', provideGatewayConfig)
  void stopAgent().finally(() => {
    quitAfterAgentStops = true
    app.quit()
  })
})
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => app.quit())
}
