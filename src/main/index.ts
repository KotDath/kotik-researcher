// paths.ts должен выполняться первым: задаёт PI_CODING_AGENT_DIR до вызовов pi SDK.
import { dataPaths, ensureDataDirs } from './paths'
import { join } from 'node:path'
import { app, BrowserWindow, shell } from 'electron'
import { ChatManager } from './pi/chat-manager'
import { RecentProjectsStore } from './recent-projects'
import { SettingsStore } from './settings-store'
import { registerIpc } from './ipc'
import { runChatManagerSpike, runSpike, runThinkingSpike } from './spike'
import { IpcChannels, type ChatEvent, type CurrentProject } from '../shared/ipc'

const isSpike = Boolean(process.env.SPIKE_HEADLESS)

if (isSpike) {
  app.commandLine.appendSwitch('no-sandbox')
  app.commandLine.appendSwitch('disable-gpu')
  app.commandLine.appendSwitch('ozone-platform', 'headless')
}

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
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

  if (isSpike) {
    const spike =
      process.env.SPIKE_HEADLESS === 'thinking'
        ? runThinkingSpike()
        : process.env.SPIKE_HEADLESS === 'chatmanager'
          ? runChatManagerSpike()
          : runSpike()
    const code = await spike
    app.exit(code)
    return
  }

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
