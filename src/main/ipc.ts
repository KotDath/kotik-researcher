import { BrowserWindow, dialog, ipcMain } from 'electron'
import { existsSync, mkdirSync, statSync } from 'node:fs'
import { basename, join, resolve, sep } from 'node:path'
import type { ChatManager } from './pi/chat-manager'
import type { RecentProjectsStore } from './recent-projects'
import type { SettingsStore } from './settings-store'
import {
  err,
  IpcChannels,
  ok,
  okVoid,
  type AppSettings,
  type ChatSnapshot,
  type ChatSummary,
  type CurrentProject,
  type RecentProject,
  type Result,
  type SettingsView
} from '../shared/ipc'

interface IpcDeps {
  chatManager: ChatManager
  recentProjects: RecentProjectsStore
  settingsStore: SettingsStore
  getWindow: () => BrowserWindow | null
  onProjectOpened: (path: string) => void
}

export function registerIpc(deps: IpcDeps): void {
  const { chatManager, recentProjects, settingsStore } = deps

  // ---------------------------------------------------------------- projects

  ipcMain.handle(IpcChannels.projectsList, (): RecentProject[] => recentProjects.list())

  ipcMain.handle(IpcChannels.projectsGetCurrent, (): CurrentProject | null => {
    const path = chatManager.currentProjectPath()
    return path ? { path, name: basename(path) } : null
  })

  ipcMain.handle(IpcChannels.projectsOpenDialog, async (): Promise<Result<string | null>> => {
    const win = deps.getWindow()
    if (!win) return err('Окно недоступно')
    const result = await dialog.showOpenDialog(win, {
      title: 'Открыть проект',
      properties: ['openDirectory']
    })
    if (result.canceled || result.filePaths.length === 0) return ok(null)
    return openProject(deps, result.filePaths[0])
  })

  ipcMain.handle(IpcChannels.projectsPickParent, async (): Promise<string | null> => {
    const win = deps.getWindow()
    if (!win) return null
    const result = await dialog.showOpenDialog(win, {
      title: 'Выберите родительскую папку для нового проекта',
      properties: ['openDirectory', 'createDirectory']
    })
    return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0]
  })

  ipcMain.handle(
    IpcChannels.projectsCreate,
    async (_e, parent: string, name: string): Promise<Result<string>> => {
      const trimmed = name.trim()
      if (!trimmed) return err('Имя проекта не может быть пустым')
      if (trimmed.includes('/') || trimmed.includes('\\') || trimmed === '.' || trimmed === '..') {
        return err('Имя проекта содержит недопустимые символы')
      }
      const parentResolved = resolve(parent)
      const target = join(parentResolved, trimmed)
      if (resolve(target) !== join(parentResolved, trimmed) || !target.startsWith(parentResolved + sep)) {
        return err('Недопустимый путь проекта')
      }
      if (existsSync(target)) {
        return err(`Директория «${trimmed}» уже существует в выбранной папке`)
      }
      try {
        mkdirSync(target)
      } catch (e) {
        return err(`Не удалось создать директорию: ${e instanceof Error ? e.message : e}`)
      }
      return openProject(deps, target)
    }
  )

  ipcMain.handle(IpcChannels.projectsOpen, (_e, path: string) => openProject(deps, path))

  ipcMain.handle(IpcChannels.projectsRemoveFromList, (_e, path: string): RecentProject[] => {
    recentProjects.remove(path)
    return recentProjects.list()
  })

  // ------------------------------------------------------------------- chats

  ipcMain.handle(IpcChannels.chatsList, (): Promise<ChatSummary[]> => chatManager.listChats())

  ipcMain.handle(
    IpcChannels.chatsSearch,
    async (_e, query: string): Promise<ChatSummary[]> => {
      const all = await chatManager.listChats()
      const q = query.trim().toLowerCase()
      return q ? all.filter((c) => c.name.toLowerCase().includes(q)) : all
    }
  )

  ipcMain.handle(IpcChannels.chatsCreate, (): Promise<ChatSummary> => chatManager.createChat())

  ipcMain.handle(IpcChannels.chatsSelect, async (_e, file: string): Promise<Result<null>> => {
    try {
      await chatManager.selectChat(file)
      return okVoid()
    } catch (e) {
      return err(e instanceof Error ? e.message : String(e))
    }
  })

  ipcMain.handle(IpcChannels.chatsGetActive, (): string | null => chatManager.getActiveChatFile())

  ipcMain.handle(
    IpcChannels.chatsRename,
    async (_e, file: string, name: string): Promise<Result<null>> => {
      const trimmed = name.trim()
      if (!trimmed) return err('Имя чата не может быть пустым')
      try {
        await chatManager.renameChat(file, trimmed)
        return okVoid()
      } catch (e) {
        return err(e instanceof Error ? e.message : String(e))
      }
    }
  )

  ipcMain.handle(IpcChannels.chatsDelete, async (_e, file: string): Promise<Result<null>> => {
    try {
      await chatManager.deleteChat(file)
      return okVoid()
    } catch (e) {
      return err(e instanceof Error ? e.message : String(e))
    }
  })

  ipcMain.handle(IpcChannels.chatsSnapshot, (_e, file: string): ChatSnapshot | null =>
    chatManager.snapshot(file)
  )

  // ---------------------------------------------------------------- messages

  ipcMain.handle(IpcChannels.messagesSend, async (_e, text: string): Promise<Result<null>> => {
    const trimmed = text.trim()
    if (!trimmed) return err('Пустое сообщение')
    try {
      await chatManager.sendMessage(trimmed)
      return okVoid()
    } catch (e) {
      return err(e instanceof Error ? e.message : String(e))
    }
  })

  ipcMain.handle(IpcChannels.messagesRetry, async (): Promise<Result<null>> => {
    try {
      await chatManager.retryMessage()
      return okVoid()
    } catch (e) {
      return err(e instanceof Error ? e.message : String(e))
    }
  })

  ipcMain.handle(IpcChannels.messagesAbort, async (): Promise<void> => chatManager.abort())

  // ---------------------------------------------------------------- settings

  ipcMain.handle(IpcChannels.settingsGet, async (): Promise<SettingsView> => {
    return {
      settings: settingsStore.get(),
      encryptionAvailable: settingsStore.isEncryptionAvailable(),
      providers: await chatManager.listProviders()
    }
  })

  ipcMain.handle(IpcChannels.settingsSet, async (_e, next: AppSettings): Promise<Result<null>> => {
    try {
      settingsStore.set(next)
      await chatManager.applySettings(next)
      return okVoid()
    } catch (e) {
      return err(e instanceof Error ? e.message : String(e))
    }
  })
}

async function openProject(deps: IpcDeps, path: string): Promise<Result<string>> {
  if (!existsSync(path)) {
    return err('Директория проекта недоступна (удалена или перемещена)')
  }
  if (!statSync(path).isDirectory()) {
    return err('Путь проекта не является директорией')
  }
  try {
    await deps.chatManager.openProject(path)
  } catch (e) {
    return err(`Не удалось открыть проект: ${e instanceof Error ? e.message : e}`)
  }
  deps.recentProjects.touch(path)
  deps.onProjectOpened(path)
  return ok(path)
}
