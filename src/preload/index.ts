import { contextBridge, ipcRenderer } from 'electron'
import {
  IpcChannels,
  type AppSettings,
  type ChatEvent,
  type ChatSnapshot,
  type ChatSummary,
  type CurrentProject,
  type RecentProject,
  type Result,
  type SettingsView
} from '../shared/ipc'

function on<T>(channel: string, listener: (payload: T) => void): () => void {
  const wrapped = (_: Electron.IpcRendererEvent, payload: T): void => listener(payload)
  ipcRenderer.on(channel, wrapped)
  return () => ipcRenderer.removeListener(channel, wrapped)
}

const api = {
  projects: {
    list: (): Promise<RecentProject[]> => ipcRenderer.invoke(IpcChannels.projectsList),
    openDialog: (): Promise<Result<string | null>> =>
      ipcRenderer.invoke(IpcChannels.projectsOpenDialog),
    pickParent: (): Promise<string | null> => ipcRenderer.invoke(IpcChannels.projectsPickParent),
    create: (parent: string, name: string): Promise<Result<string>> =>
      ipcRenderer.invoke(IpcChannels.projectsCreate, parent, name),
    open: (path: string): Promise<Result<string>> =>
      ipcRenderer.invoke(IpcChannels.projectsOpen, path),
    removeFromList: (path: string): Promise<RecentProject[]> =>
      ipcRenderer.invoke(IpcChannels.projectsRemoveFromList, path),
    getCurrent: (): Promise<CurrentProject | null> =>
      ipcRenderer.invoke(IpcChannels.projectsGetCurrent)
  },
  chats: {
    list: (): Promise<ChatSummary[]> => ipcRenderer.invoke(IpcChannels.chatsList),
    create: (): Promise<ChatSummary> => ipcRenderer.invoke(IpcChannels.chatsCreate),
    rename: (file: string, name: string): Promise<Result<null>> =>
      ipcRenderer.invoke(IpcChannels.chatsRename, file, name),
    delete: (file: string): Promise<Result<null>> =>
      ipcRenderer.invoke(IpcChannels.chatsDelete, file),
    select: (file: string): Promise<Result<null>> =>
      ipcRenderer.invoke(IpcChannels.chatsSelect, file),
    search: (query: string): Promise<ChatSummary[]> =>
      ipcRenderer.invoke(IpcChannels.chatsSearch, query),
    getActive: (): Promise<string | null> => ipcRenderer.invoke(IpcChannels.chatsGetActive),
    snapshot: (file: string): Promise<ChatSnapshot | null> =>
      ipcRenderer.invoke(IpcChannels.chatsSnapshot, file)
  },
  messages: {
    send: (text: string): Promise<Result<null>> =>
      ipcRenderer.invoke(IpcChannels.messagesSend, text),
    retry: (): Promise<Result<null>> => ipcRenderer.invoke(IpcChannels.messagesRetry),
    abort: (): Promise<void> => ipcRenderer.invoke(IpcChannels.messagesAbort)
  },
  settings: {
    get: (): Promise<SettingsView> => ipcRenderer.invoke(IpcChannels.settingsGet),
    set: (settings: AppSettings): Promise<Result<null>> =>
      ipcRenderer.invoke(IpcChannels.settingsSet, settings)
  },
  events: {
    onChatEvent: (listener: (event: ChatEvent) => void): (() => void) =>
      on(IpcChannels.eventChat, listener),
    onProjectChanged: (listener: (project: CurrentProject) => void): (() => void) =>
      on(IpcChannels.eventProjectChanged, listener)
  }
}

export type Api = typeof api

contextBridge.exposeInMainWorld('api', api)
