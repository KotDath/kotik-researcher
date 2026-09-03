import { randomBytes } from 'node:crypto'
import { join, resolve } from 'node:path'
import { app, BrowserWindow, dialog, ipcMain, type IpcMainEvent } from 'electron'
import {
  createRuntimeFromEnvironment,
  startApplicationServer,
  type RunningApplicationServer,
} from '@kotik/server'

let applicationServer: RunningApplicationServer | undefined
let gatewayConfig: { baseUrl: string; accessToken: string } | undefined

async function createWindow(): Promise<void> {
  const accessToken = randomBytes(32).toString('base64url')
  const rendererURL = app.isPackaged ? undefined : 'http://127.0.0.1:5173'
  const webRoot = app.isPackaged
    ? join(process.resourcesPath, 'web')
    : resolve(app.getAppPath(), 'apps/web/dist')

  applicationServer = await startApplicationServer({
    runtime: createRuntimeFromEnvironment(),
    host: '127.0.0.1',
    port: 0,
    webRoot,
    accessToken,
  })
  gatewayConfig = { baseUrl: applicationServer.url, accessToken }

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

  const applicationURL = rendererURL ?? applicationServer.url
  const allowedOrigins = new Set([new URL(applicationURL).origin, new URL(applicationServer.url).origin])
  window.webContents.on('will-navigate', (event, targetURL) => {
    if (!allowedOrigins.has(new URL(targetURL).origin)) {
      event.preventDefault()
    }
  })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  await window.loadURL(applicationURL)
}

function provideGatewayConfig(event: IpcMainEvent): void {
  event.returnValue = gatewayConfig
}

app.whenReady().then(createWindow).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  dialog.showErrorBox('kotik-researcher could not start', message)
  app.quit()
})

app.on('window-all-closed', () => app.quit())
app.on('before-quit', () => {
  ipcMain.off('kotik:get-gateway-config', provideGatewayConfig)
  if (applicationServer) {
    void applicationServer.close()
    applicationServer = undefined
  }
})
