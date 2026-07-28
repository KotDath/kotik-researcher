import {
  createAgentSession,
  ModelRuntime,
  SessionManager,
  type AgentSession,
  type AgentSessionEvent,
  type CreateAgentSessionOptions
} from '@earendil-works/pi-coding-agent'
import { shell } from 'electron'
import { existsSync } from 'node:fs'
import { unlink } from 'node:fs/promises'
import { dataPaths } from '../paths'
import type { SettingsStore } from '../settings-store'
import { writeModelsJson } from './models-config'
import type {
  AppSettings,
  ChatEvent,
  ChatSnapshot,
  ChatSummary,
  DistributiveOmit,
  FeedItem,
  ProviderInfo,
  RetryState
} from '../../shared/ipc'

type AnyModel = NonNullable<CreateAgentSessionOptions['model']>
type SessionMessage = AgentSession['messages'][number]

interface ChatHandle {
  /** Путь к session-файлу — стабильный идентификатор чата. */
  file: string
  session: AgentSession
  generating: boolean
  /** Проект закрыт, но генерация идёт — dispose отложен до agent_end (design.md). */
  retired: boolean
  seq: number
  retrying: RetryState | null
  lastPromptText: string | null
  errorSentForRun: boolean
}

const PREVIEW_LIMIT = 4000

function preview(value: unknown): string {
  let text: string
  if (typeof value === 'string') {
    text = value
  } else {
    try {
      text = JSON.stringify(value, null, 2) ?? String(value)
    } catch {
      text = String(value)
    }
  }
  return text.length > PREVIEW_LIMIT ? `${text.slice(0, PREVIEW_LIMIT)}\n… (обрезано)` : text
}

function extractText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .filter((p): p is { type: 'text'; text: string } => p?.type === 'text')
    .map((p) => p.text)
    .join('')
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/** Собирает ленту чата из истории сообщений сессии pi. */
export function buildFeedItems(messages: readonly SessionMessage[], generating: boolean): FeedItem[] {
  const items: FeedItem[] = []
  const toolItems = new Map<string, Extract<FeedItem, { kind: 'tool' }>>()
  let n = 0
  const nextId = (): string => `m${n++}`

  for (const msg of messages) {
    if (msg.role === 'user') {
      const text = extractText(msg.content)
      if (text) items.push({ kind: 'user', id: nextId(), text })
    } else if (msg.role === 'assistant') {
      let text = ''
      for (const part of msg.content) {
        if (part.type === 'text') {
          text += part.text
        } else if (part.type === 'toolCall') {
          const item: Extract<FeedItem, { kind: 'tool' }> = {
            kind: 'tool',
            id: nextId(),
            toolCallId: part.id,
            toolName: part.name,
            status: 'running',
            argsPreview: preview(part.arguments)
          }
          items.push(item)
          toolItems.set(part.id, item)
        }
      }
      if (text) items.push({ kind: 'assistant', id: nextId(), text, streaming: false })
      if (msg.stopReason === 'error') {
        items.push({ kind: 'error', id: nextId(), message: msg.errorMessage || 'Ошибка провайдера' })
      }
    } else if (msg.role === 'toolResult') {
      const item = toolItems.get(msg.toolCallId)
      if (item) {
        item.status = msg.isError ? 'error' : 'done'
        item.resultPreview = preview(msg.content)
      }
    }
    // custom / bashExecution сообщения в MVP-ленте не отображаем
  }

  if (generating) {
    for (let i = items.length - 1; i >= 0; i--) {
      if (items[i].kind === 'assistant') {
        ;(items[i] as { streaming: boolean }).streaming = true
        break
      }
    }
  }
  return items
}

/**
 * Управляет pi-сессиями активного проекта.
 *
 * Ключевое ограничение SDK: session.dispose() вызывает agent.abort(), а
 * AgentSessionRuntime.switchSession() всегда диспозит текущую сессию. Поэтому
 * вместо одного runtime на проект — по сессии на чат (createAgentSession),
 * чтобы генерация продолжалась в фоне при навигации (требование «Фоновая
 * генерация при навигации»). Загружены одновременно: активный чат + чаты с
 * незавершённой генерацией.
 */
export class ChatManager {
  private modelRuntimePromise: Promise<ModelRuntime> | null = null
  private projectPath: string | null = null
  private chats = new Map<string, ChatHandle>()
  private retired: ChatHandle[] = []
  private activeChatFile: string | null = null
  private runtimeKeys = new Set<string>()
  /** Сериализация select/create/delete, чтобы не гонять создание сессий параллельно. */
  private queue: Promise<unknown> = Promise.resolve()

  constructor(
    private readonly settingsStore: SettingsStore,
    private readonly emitChatEvent: (event: ChatEvent) => void
  ) {}

  private enqueue<T>(op: () => Promise<T>): Promise<T> {
    const next = this.queue.then(op, op)
    this.queue = next.catch(() => {})
    return next
  }

  // ---------------------------------------------------------------- project

  async openProject(projectPath: string): Promise<void> {
    return this.enqueue(async () => {
      this.closeProjectInternal()
      this.projectPath = projectPath
      this.adoptRetired(projectPath)
      const list = await this.listChatsInternal()
      if (list.length === 0) {
        await this.createChatInternal()
      } else {
        await this.selectChatInternal(list[0].file)
      }
    })
  }

  private closeProjectInternal(): void {
    for (const handle of this.chats.values()) {
      if (handle.generating || !handle.session.isIdle) {
        handle.retired = true
        this.retired.push(handle)
      } else {
        handle.session.dispose()
      }
    }
    this.chats.clear()
    this.activeChatFile = null
    this.projectPath = null
  }

  /** Возвращаем фоновые сессии проекта, если пользователь вернулся в него до
   * окончания генерации — иначе создались бы два AgentSession на один jsonl. */
  private adoptRetired(projectPath: string): void {
    const remaining: ChatHandle[] = []
    for (const handle of this.retired) {
      if (handle.session.sessionManager.getCwd() === projectPath) {
        handle.retired = false
        this.chats.set(handle.file, handle)
      } else {
        remaining.push(handle)
      }
    }
    this.retired = remaining
  }

  currentProjectPath(): string | null {
    return this.projectPath
  }

  // ------------------------------------------------------------------ chats

  async listChats(): Promise<ChatSummary[]> {
    return this.enqueue(async () => this.listChatsInternal())
  }

  private async listChatsInternal(): Promise<ChatSummary[]> {
    if (!this.projectPath) return []
    const infos = await SessionManager.list(this.projectPath)
    const byFile = new Map(infos.map((i) => [i.path, i]))
    // в список добавляем загруженные, но ещё не записанные на диск чаты (пустые новые)
    for (const handle of this.chats.values()) {
      if (!byFile.has(handle.file)) {
        byFile.set(handle.file, {
          path: handle.file,
          id: handle.session.sessionId,
          cwd: this.projectPath,
          created: new Date(),
          modified: new Date(),
          messageCount: 0,
          firstMessage: '',
          allMessagesText: ''
        })
      }
    }
    return [...byFile.values()]
      .map((info) => ({
        file: info.path,
        name: this.chatName(info.path, info.name, info.firstMessage),
        lastActivity: info.modified.getTime(),
        messageCount: info.messageCount,
        isGenerating: this.chats.get(info.path)?.generating ?? false
      }))
      .sort((a, b) => b.lastActivity - a.lastActivity)
  }

  private chatName(file: string, name: string | undefined, firstMessage: string): string {
    if (name) return name
    const handle = this.chats.get(file)
    const sessionName = handle?.session.sessionName
    if (sessionName) return sessionName
    const first = firstMessage.trim().split('\n')[0]
    if (first) return first.length > 60 ? `${first.slice(0, 60)}…` : first
    return 'Новый чат'
  }

  getActiveChatFile(): string | null {
    return this.activeChatFile
  }

  async createChat(): Promise<ChatSummary> {
    return this.enqueue(async () => {
      const handle = await this.createChatInternal()
      return {
        file: handle.file,
        name: 'Новый чат',
        lastActivity: Date.now(),
        messageCount: 0,
        isGenerating: false
      }
    })
  }

  private async createChatInternal(): Promise<ChatHandle> {
    if (!this.projectPath) throw new Error('Проект не открыт')
    const previous = this.activeChatFile ? this.chats.get(this.activeChatFile) : undefined
    const handle = await this.createChatHandle(null)
    this.chats.set(handle.file, handle)
    this.activeChatFile = handle.file
    this.disposeIfIdle(previous)
    return handle
  }

  async selectChat(file: string): Promise<void> {
    return this.enqueue(async () => this.selectChatInternal(file))
  }

  private async selectChatInternal(file: string): Promise<void> {
    if (!this.projectPath) throw new Error('Проект не открыт')
    if (this.activeChatFile === file) return
    const previous = this.activeChatFile ? this.chats.get(this.activeChatFile) : undefined
    if (!this.chats.has(file)) {
      const handle = await this.createChatHandle(file)
      this.chats.set(handle.file, handle)
    }
    this.activeChatFile = file
    this.disposeIfIdle(previous)
  }

  private disposeIfIdle(handle: ChatHandle | undefined): void {
    if (!handle) return
    if (handle.generating || !handle.session.isIdle) return // фоновая генерация продолжается
    handle.session.dispose()
    this.chats.delete(handle.file)
  }

  async renameChat(file: string, name: string): Promise<void> {
    return this.enqueue(async () => {
      const handle = await this.ensureLoaded(file)
      handle.session.sessionManager.appendSessionInfo(name)
    })
  }

  async deleteChat(file: string): Promise<void> {
    return this.enqueue(async () => {
      if (!this.projectPath) throw new Error('Проект не открыт')
      const handle = this.chats.get(file)
      const wasActive = this.activeChatFile === file
      if (handle) {
        if (handle.generating || !handle.session.isIdle) {
          await handle.session.abort().catch(() => {})
        }
        handle.session.dispose()
        this.chats.delete(file)
      }
      if (existsSync(file)) {
        try {
          await shell.trashItem(file)
        } catch (trashError) {
          try {
            await unlink(file)
          } catch (unlinkError) {
            // файл остался на диске: возвращаем удалённый из памяти чат (сессия уже
            // выгружена по design.md), чтобы активный чат не указывал на мёртвый handle
            if (wasActive) {
              this.activeChatFile = null
              await this.selectChatInternal(file).catch(() => {})
            }
            throw new Error(
              `Не удалось удалить файл чата: ${errorMessage(unlinkError)} ` +
                `(корзина недоступна: ${errorMessage(trashError)})`,
              { cause: unlinkError }
            )
          }
        }
      }
      if (wasActive) {
        this.activeChatFile = null
        const remaining = await this.listChatsInternal()
        if (remaining.length > 0) {
          await this.selectChatInternal(remaining[0].file)
        } else {
          await this.createChatInternal()
        }
      }
    })
  }

  snapshot(file: string): ChatSnapshot | null {
    const handle = this.chats.get(file) ?? this.retired.find((h) => h.file === file)
    if (!handle) return null
    return {
      file,
      generating: handle.generating,
      lastSeq: handle.seq,
      retrying: handle.retrying,
      items: buildFeedItems(handle.session.messages, handle.generating)
    }
  }

  // --------------------------------------------------------------- messages

  async sendMessage(text: string): Promise<void> {
    const handle = this.activeHandle()
    if (!handle) throw new Error('Нет активного чата')
    handle.lastPromptText = text
    this.prompt(handle, text)
  }

  async retryMessage(): Promise<void> {
    const handle = this.activeHandle()
    if (!handle) throw new Error('Нет активного чата')
    if (!handle.lastPromptText) throw new Error('Нечего повторять')
    this.prompt(handle, handle.lastPromptText)
  }

  async abort(): Promise<void> {
    const handle = this.activeHandle()
    if (handle) await handle.session.abort()
  }

  private prompt(handle: ChatHandle, text: string): void {
    // каждый prompt — новый логический прогон: сбрасываем дедуп-флаг до старта,
    // т.к. preflight-rejection (нет модели/ключа) происходит без agent_start
    handle.errorSentForRun = false
    // prompt() резолвится по завершении всего прогона — не await, события летят через subscribe.
    // Ошибки preflight (нет модели/ключа) приходят rejection'ом — превращаем в карточку ошибки.
    const p = handle.session.isStreaming
      ? handle.session.prompt(text, { streamingBehavior: 'followUp' })
      : handle.session.prompt(text)
    p.catch((e) => {
      handle.generating = false
      this.emitErrorOnce(handle, errorMessage(e))
    })
  }

  /** Одна карточка ошибки на логический сбой прогона: SDK эмитит финальный
   * agent_end (willRetry=false) до auto_retry_end(success:false), а prompt()
   * может реджектиться уже после старта — без флага было бы две карточки. */
  private emitErrorOnce(handle: ChatHandle, message: string): void {
    if (handle.errorSentForRun) return
    handle.errorSentForRun = true
    this.emit(handle, { type: 'error', message })
  }

  // --------------------------------------------------------------- settings

  /** Применение настроек без перезапуска: models.json, ключи в runtime, модель. */
  async applySettings(settings: AppSettings): Promise<void> {
    writeModelsJson(dataPaths.modelsPath, settings)
    const rt = await this.getModelRuntime()
    await rt.refresh({ allowNetwork: false }).catch(() => {})
    await this.applyApiKeys(rt, settings)
    const model = this.resolveModel(rt, settings)
    if (model) {
      for (const handle of [...this.chats.values(), ...this.retired]) {
        await handle.session.setModel(model).catch(() => {})
      }
    }
  }

  private getModelRuntime(): Promise<ModelRuntime> {
    if (!this.modelRuntimePromise) {
      // единый lazy-промис: getModelRuntime зовётся и из enqueue-цепочки, и вне её
      // (applySettings, listProviders) — без него параллельный первый вызов создал бы
      // два runtime, и сессии на «проигравшем» остались бы без ключей
      const p = (async () => {
        // authPath внутри нашего каталога — SDK не ходит в ~/.pi/agent/auth.json
        const rt = await ModelRuntime.create({
          authPath: dataPaths.authPath,
          modelsPath: dataPaths.modelsPath
        })
        writeModelsJson(dataPaths.modelsPath, this.settingsStore.get())
        await rt.refresh({ allowNetwork: false }).catch(() => {})
        await this.applyApiKeys(rt, this.settingsStore.get())
        return rt
      })()
      p.catch(() => {
        // не кэшируем неудачу — следующий вызов попробует создать runtime снова
        if (this.modelRuntimePromise === p) this.modelRuntimePromise = null
      })
      this.modelRuntimePromise = p
    }
    return this.modelRuntimePromise
  }

  private async applyApiKeys(rt: ModelRuntime, settings: AppSettings): Promise<void> {
    const wanted = new Set<string>()
    for (const [providerId, p] of Object.entries(settings.providers)) {
      if (p.apiKey) {
        wanted.add(providerId)
        await rt.setRuntimeApiKey(providerId, p.apiKey).catch(() => {})
      }
    }
    for (const cp of settings.customProviders) {
      if (cp.apiKey) {
        wanted.add(cp.id)
        await rt.setRuntimeApiKey(cp.id, cp.apiKey).catch(() => {})
      }
    }
    for (const providerId of this.runtimeKeys) {
      if (!wanted.has(providerId)) {
        await rt.removeRuntimeApiKey(providerId).catch(() => {})
      }
    }
    this.runtimeKeys = wanted
  }

  private resolveModel(rt: ModelRuntime, settings: AppSettings): AnyModel | undefined {
    const dm = settings.defaultModel
    if (dm) {
      const m = rt.getModel(dm.providerId, dm.modelId)
      if (m) return m as AnyModel
    }
    return rt.getAvailableSnapshot()[0] as AnyModel | undefined
  }

  async listProviders(): Promise<ProviderInfo[]> {
    const rt = await this.getModelRuntime()
    const customIds = new Set(this.settingsStore.get().customProviders.map((c) => c.id))
    return rt.getProviders().map((p) => ({
      id: p.id,
      name: p.name,
      hasAuth: rt.hasConfiguredAuth(p.id),
      isCustom: customIds.has(p.id),
      models: rt.getModels(p.id).map((m) => ({ id: m.id, name: m.name }))
    }))
  }

  // ---------------------------------------------------------------- private

  private activeHandle(): ChatHandle | undefined {
    return this.activeChatFile ? this.chats.get(this.activeChatFile) : undefined
  }

  private async ensureLoaded(file: string): Promise<ChatHandle> {
    let handle = this.chats.get(file)
    if (!handle) {
      if (!this.projectPath) throw new Error('Проект не открыт')
      handle = await this.createChatHandle(file)
      this.chats.set(file, handle)
    }
    return handle
  }

  private async createChatHandle(file: string | null): Promise<ChatHandle> {
    const projectPath = this.projectPath
    if (!projectPath) throw new Error('Проект не открыт')
    const rt = await this.getModelRuntime()
    const sessionManager = file ? SessionManager.open(file) : SessionManager.create(projectPath)
    const model = this.resolveModel(rt, this.settingsStore.get())
    const options: CreateAgentSessionOptions = {
      cwd: projectPath,
      agentDir: dataPaths.agentDir,
      modelRuntime: rt,
      sessionManager
    }
    let session: AgentSession
    try {
      ;({ session } = await createAgentSession(model ? { ...options, model } : options))
    } catch {
      // модель без настроенной авторизации — создаём без неё; ошибка придёт карточкой при отправке
      ;({ session } = await createAgentSession(options))
    }
    const sessionFile = session.sessionFile
    if (!sessionFile) throw new Error('Не удалось создать session-файл')
    // восстанавливаем последний промпт из истории — иначе «Повторить» на карточке
    // ошибки, доставшейся из прошлого запуска приложения, нечего отправлять
    const lastUser = [...session.messages].reverse().find((m) => m.role === 'user')
    const lastPromptText =
      lastUser && lastUser.role === 'user' ? extractText(lastUser.content) || null : null
    const handle: ChatHandle = {
      file: sessionFile,
      session,
      generating: false,
      retired: false,
      seq: 0,
      retrying: null,
      lastPromptText,
      errorSentForRun: false
    }
    session.subscribe((event) => this.onSessionEvent(handle, event))
    return handle
  }

  private emit(handle: ChatHandle, event: DistributiveOmit<ChatEvent, 'file' | 'seq'>): void {
    handle.seq += 1
    this.emitChatEvent({ ...event, file: handle.file, seq: handle.seq } as ChatEvent)
  }

  private onSessionEvent(handle: ChatHandle, event: AgentSessionEvent): void {
    switch (event.type) {
      case 'agent_start':
        handle.generating = true
        handle.errorSentForRun = false
        handle.retrying = null
        this.emit(handle, { type: 'agent_start' })
        break
      case 'message_update': {
        const ev = event.assistantMessageEvent
        if (ev.type === 'text_delta') {
          this.emit(handle, { type: 'text_delta', delta: ev.delta })
        }
        break
      }
      case 'message_end': {
        const msg = event.message
        if (msg.role === 'user' || msg.role === 'assistant') {
          this.emit(handle, {
            type: 'message_end',
            role: msg.role,
            stopReason: msg.role === 'assistant' ? msg.stopReason : undefined
          })
        }
        break
      }
      case 'tool_execution_start':
        this.emit(handle, {
          type: 'tool_start',
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          argsPreview: preview(event.args)
        })
        break
      case 'tool_execution_update':
        this.emit(handle, {
          type: 'tool_update',
          toolCallId: event.toolCallId,
          resultPreview: preview(event.partialResult)
        })
        break
      case 'tool_execution_end':
        this.emit(handle, {
          type: 'tool_end',
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          isError: event.isError,
          resultPreview: preview(event.result)
        })
        break
      case 'auto_retry_start':
        handle.retrying = {
          attempt: event.attempt,
          maxAttempts: event.maxAttempts,
          errorMessage: event.errorMessage
        }
        this.emit(handle, { type: 'auto_retry', retrying: handle.retrying })
        break
      case 'auto_retry_end':
        handle.retrying = null
        if (event.success) {
          this.emit(handle, { type: 'auto_retry_done' })
        } else {
          this.emitErrorOnce(
            handle,
            event.finalError || 'Ошибка провайдера после повторных попыток'
          )
        }
        break
      case 'agent_end': {
        handle.retrying = null
        if (event.willRetry) break // авто-ретрай продолжит генерацию
        handle.generating = false
        const lastAssistant = [...event.messages].reverse().find((m) => m.role === 'assistant')
        if (lastAssistant && lastAssistant.role === 'assistant' && lastAssistant.stopReason === 'error') {
          this.emitErrorOnce(handle, lastAssistant.errorMessage || 'Ошибка провайдера')
        }
        this.emit(handle, { type: 'agent_end' })
        if (handle.retired) this.disposeRetired(handle)
        break
      }
      default:
        break
    }
  }

  private disposeRetired(handle: ChatHandle): void {
    handle.session.dispose()
    this.retired = this.retired.filter((h) => h !== handle)
  }

  async disposeAll(): Promise<void> {
    for (const handle of this.chats.values()) {
      handle.session.dispose()
    }
    this.chats.clear()
    for (const handle of this.retired) {
      handle.session.dispose()
    }
    this.retired = []
  }
}
