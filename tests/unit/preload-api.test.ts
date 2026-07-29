import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IpcChannels } from '../../src/shared/ipc'

const electronMock = vi.hoisted(() => {
  const exposed: { name?: string; api?: Record<string, unknown> } = {}
  return {
    exposed,
    contextBridge: {
      exposeInMainWorld: (name: string, api: Record<string, unknown>) => {
        exposed.name = name
        exposed.api = api
      }
    },
    ipcRenderer: {
      invoke: vi.fn<(channel: string, ...args: unknown[]) => Promise<unknown>>(),
      on: vi.fn(),
      removeListener: vi.fn()
    }
  }
})

vi.mock('electron', () => electronMock)

// preload при импорте экспонирует api — побочный эффект модуля
await import('../../src/preload/index')

type Api = Record<string, Record<string, (...args: unknown[]) => unknown>>

function exposedApi(): Api {
  expect(electronMock.exposed.name).toBe('api')
  return electronMock.exposed.api as Api
}

describe('preload window.api: проброс каналов', () => {
  beforeEach(() => {
    electronMock.ipcRenderer.invoke.mockReset()
    electronMock.ipcRenderer.invoke.mockResolvedValue({ ok: true })
    electronMock.ipcRenderer.on.mockClear()
    electronMock.ipcRenderer.removeListener.mockClear()
  })

  const cases: Array<[string, unknown[], string]> = [
    ['projects.list', [], IpcChannels.projectsList],
    ['projects.openDialog', [], IpcChannels.projectsOpenDialog],
    ['projects.pickParent', [], IpcChannels.projectsPickParent],
    ['projects.create', ['/tmp', 'name'], IpcChannels.projectsCreate],
    ['projects.open', ['/tmp/p'], IpcChannels.projectsOpen],
    ['projects.removeFromList', ['/tmp/p'], IpcChannels.projectsRemoveFromList],
    ['projects.getCurrent', [], IpcChannels.projectsGetCurrent],
    ['chats.list', [], IpcChannels.chatsList],
    ['chats.create', [], IpcChannels.chatsCreate],
    ['chats.rename', ['f.jsonl', 'name'], IpcChannels.chatsRename],
    ['chats.delete', ['f.jsonl'], IpcChannels.chatsDelete],
    ['chats.select', ['f.jsonl'], IpcChannels.chatsSelect],
    ['chats.search', ['query'], IpcChannels.chatsSearch],
    ['chats.getActive', [], IpcChannels.chatsGetActive],
    ['chats.snapshot', ['f.jsonl'], IpcChannels.chatsSnapshot],
    ['messages.send', ['hello'], IpcChannels.messagesSend],
    ['messages.retry', [], IpcChannels.messagesRetry],
    ['messages.abort', [], IpcChannels.messagesAbort],
    ['settings.get', [], IpcChannels.settingsGet],
    ['settings.set', [{ providers: {} }], IpcChannels.settingsSet]
  ]

  it.each(cases)('%s → %s', async (path, args, channel) => {
    const [group, method] = path.split('.')
    await exposedApi()[group][method](...args)
    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith(channel, ...args)
  })

  it('events.onChatEvent подписывается на event:chat и отписывается', () => {
    const unsubscribe = exposedApi().events.onChatEvent(() => {}) as () => void
    expect(electronMock.ipcRenderer.on).toHaveBeenCalledWith(
      IpcChannels.eventChat,
      expect.any(Function)
    )
    const [, wrapped] = electronMock.ipcRenderer.on.mock.calls[0]
    unsubscribe()
    expect(electronMock.ipcRenderer.removeListener).toHaveBeenCalledWith(
      IpcChannels.eventChat,
      wrapped
    )
  })

  it('events.onProjectChanged подписывается на event:project-changed', () => {
    exposedApi().events.onProjectChanged(() => {})
    expect(electronMock.ipcRenderer.on).toHaveBeenCalledWith(
      IpcChannels.eventProjectChanged,
      expect.any(Function)
    )
  })
})
