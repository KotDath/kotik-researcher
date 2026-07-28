// Shared IPC contract between main, preload and renderer (design.md, решение 4).

export const IpcChannels = {
  projectsList: 'projects:list',
  projectsOpenDialog: 'projects:open-dialog',
  projectsPickParent: 'projects:pick-parent',
  projectsCreate: 'projects:create',
  projectsOpen: 'projects:open',
  projectsRemoveFromList: 'projects:remove-from-list',
  projectsGetCurrent: 'projects:get-current',
  chatsList: 'chats:list',
  chatsCreate: 'chats:create',
  chatsRename: 'chats:rename',
  chatsDelete: 'chats:delete',
  chatsSelect: 'chats:select',
  chatsSearch: 'chats:search',
  chatsGetActive: 'chats:get-active',
  chatsSnapshot: 'chats:snapshot',
  messagesSend: 'messages:send',
  messagesRetry: 'messages:retry',
  messagesAbort: 'messages:abort',
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  // main -> renderer events
  eventChat: 'event:chat',
  eventProjectChanged: 'event:project-changed'
} as const

export interface RecentProject {
  path: string
  name: string
  lastOpenedAt: number
  available: boolean
}

export interface CurrentProject {
  path: string
  name: string
}

export interface ChatSummary {
  /** Session file path — stable chat identity. */
  file: string
  name: string
  lastActivity: number
  messageCount: number
  isGenerating: boolean
}

export type FeedItem =
  | { kind: 'user'; id: string; text: string }
  | { kind: 'assistant'; id: string; text: string; streaming: boolean }
  | {
      kind: 'tool'
      id: string
      toolCallId: string
      toolName: string
      status: 'running' | 'done' | 'error'
      argsPreview: string
      resultPreview?: string
    }
  | {
      kind: 'thinking'
      id: string
      text: string
      streaming: boolean
      startedAt: number
      durationMs?: number
    }
  | { kind: 'error'; id: string; message: string }

export interface RetryState {
  attempt: number
  maxAttempts: number
  errorMessage: string
}

export interface ChatSnapshot {
  file: string
  generating: boolean
  lastSeq: number
  retrying: RetryState | null
  items: FeedItem[]
}

/** Streaming events, main -> renderer. `seq` is per-chat monotonic — renderer
 * drops events with seq <= snapshot.lastSeq to avoid duplicates (design.md). */
export type ChatEvent =
  | { type: 'agent_start'; file: string; seq: number }
  | { type: 'text_delta'; file: string; seq: number; delta: string }
  | {
      type: 'thinking_start'
      file: string
      seq: number
      contentIndex: number
      startedAt: number
    }
  | {
      type: 'thinking_delta'
      file: string
      seq: number
      contentIndex: number
      delta: string
    }
  | {
      type: 'thinking_end'
      file: string
      seq: number
      contentIndex: number
      durationMs: number
    }
  | {
      type: 'message_end'
      file: string
      seq: number
      role: 'user' | 'assistant'
      stopReason?: string
    }
  | {
      type: 'tool_start'
      file: string
      seq: number
      toolCallId: string
      toolName: string
      argsPreview: string
    }
  | {
      type: 'tool_end'
      file: string
      seq: number
      toolCallId: string
      toolName: string
      isError: boolean
      resultPreview: string
    }
  | {
      type: 'tool_update'
      file: string
      seq: number
      toolCallId: string
      resultPreview: string
    }
  | { type: 'auto_retry'; file: string; seq: number; retrying: RetryState }
  | { type: 'auto_retry_done'; file: string; seq: number }
  | { type: 'agent_end'; file: string; seq: number }
  | { type: 'error'; file: string; seq: number; message: string }

export interface ProviderSettings {
  apiKey?: string
  baseUrl?: string
}

/** Уровни thinking pi SDK (pi-agent-core ThinkingLevel, включая 'off'). */
export type ThinkingLevelSetting =
  | 'off'
  | 'minimal'
  | 'low'
  | 'medium'
  | 'high'
  | 'xhigh'
  | 'max'

export interface CustomProviderModel {
  id: string
  name?: string
}

export interface CustomProviderSettings {
  id: string
  name: string
  baseUrl: string
  apiKey?: string
  models: CustomProviderModel[]
}

export interface AppSettings {
  providers: Record<string, ProviderSettings>
  customProviders: CustomProviderSettings[]
  defaultModel?: { providerId: string; modelId: string }
  /** Уровень thinking per provider; отсутствие записи = дефолт (включённый уровень). */
  thinkingLevels?: Record<string, ThinkingLevelSetting>
}

export interface ProviderModelInfo {
  id: string
  name: string
}

export interface ProviderInfo {
  id: string
  name: string
  hasAuth: boolean
  isCustom: boolean
  models: ProviderModelInfo[]
  /** Уровни thinking текущей модели провайдера по SDK (может включать 'off'). */
  availableThinkingLevels: ThinkingLevelSetting[]
}

export interface SettingsView {
  settings: AppSettings
  encryptionAvailable: boolean
  providers: ProviderInfo[]
}

export type Result<T = null> = { ok: true; value: T } | { ok: false; error: string }

export type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never

export function ok<T>(value: T): Result<T> {
  return { ok: true, value }
}

export function okVoid(): Result<null> {
  return { ok: true, value: null }
}

export function err(error: string): Result<never> {
  return { ok: false, error }
}
