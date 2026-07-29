// paths.ts должен выполняться первым: задаёт PI_CODING_AGENT_DIR до вызовов pi SDK.
import { dataPaths, ensureDataDirs } from './paths'
import { join } from 'node:path'
import { app, BrowserWindow, shell } from 'electron'
import { ChatManager } from './pi/chat-manager'
import { RecentProjectsStore } from './recent-projects'
import { SettingsStore } from './settings-store'
import { registerIpc } from './ipc'
import { IpcChannels, type ChatEvent, type CurrentProject } from '../shared/ipc'

let mainWindow: BrowserWindow | null = null

// Тестовые и агентские прогоны (--e2e): окно не показывается и не крадёт фокус,
// но renderer продолжает отрисовку (backgroundThrottling: false) — скриншоты
// CDP Page.captureScreenshot берутся из композитора независимо от видимости.
const isE2E = process.argv.includes('--e2e')

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.js'),
      sandbox: false,
      backgroundThrottling: !isE2E
    }
  })

  mainWindow.on('ready-to-show', () => {
    if (!isE2E) mainWindow?.show()
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(import.meta.dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(async () => {
  ensureDataDirs()
  console.log(`[main] pi data dir: ${dataPaths.agentDir}`)

  const settingsStore = new SettingsStore()
  const recentProjects = new RecentProjectsStore()
  const chatManager = new ChatManager(settingsStore, (event: ChatEvent) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IpcChannels.eventChat, event)
    }
  })

  registerIpc({
    chatManager,
    recentProjects,
    settingsStore,
    getWindow: () => mainWindow,
    onProjectOpened: (path: string) => {
      const project: CurrentProject = { path, name: path.split('/').filter(Boolean).pop() ?? path }
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(IpcChannels.eventProjectChanged, project)
      }
    }
  })

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })

  app.on('before-quit', () => {
    void chatManager.disposeAll()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
