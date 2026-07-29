import type {
  ChatEvent,
  ChatSnapshot,
  ChatSummary,
  CurrentProject,
  DistributiveOmit,
  FeedItem,
  RecentProject
} from '../../shared/ipc'

// Тип Api берём через глобальный Window (src/preload/index.d.ts) — прямой
// импорт src/preload/index.ts тащит electron-зависимости в web-конфиг.
type Api = Window['api']

/**
 * Моковый window.api для режимов без main-процесса:
 * - `pnpm dev:renderer` (быстрый UI-чек агента через Playwright MCP);
 * - visual-тесты состояний (?mockApi=loading|demo|error), где реальный main
 *   не может дать детерминированное состояние (design.md, решение 9).
 *
 * Активируется в main.tsx, когда preload отсутствует или в URL есть ?mockApi.
 */

export type MockMode = 'demo' | 'loading' | 'error'

const DEMO_PROJECT: CurrentProject = { path: '/home/user/research/demo-project', name: 'demo-project' }
const DEMO_CHAT_FILE = '/mock/sessions/demo-chat.jsonl'

const DEMO_RECENT: RecentProject[] = [
  { path: DEMO_PROJECT.path, name: DEMO_PROJECT.name, lastOpenedAt: Date.now(), available: true },
  {
    path: '/home/user/research/battery-chemistry',
    name: 'battery-chemistry',
    lastOpenedAt: Date.now() - 86_400_000,
    available: true
  }
]

const DEMO_ITEMS: FeedItem[] = [
  { kind: 'user', id: 'mock-1', text: 'Собери обзор по perovskite solar cells за 2025 год' },
  {
    kind: 'thinking',
    id: 'mock-2',
    text: 'Нужно разбить запрос на подтемы: эффективность, стабильность, tandem-структуры. Начну с поиска свежих обзоров.',
    streaming: false,
    startedAt: Date.now() - 60_000,
    durationMs: 4200
  },
  {
    kind: 'tool',
    id: 'mock-3',
    toolCallId: 'tc-1',
    toolName: 'web_search',
    status: 'done',
    argsPreview: 'query: "perovskite solar cells 2025 review efficiency"',
    resultPreview: '12 результатов: Nature Energy, Joule, ACS Energy Letters…'
  },
  {
    kind: 'assistant',
    id: 'mock-4',
    text: 'Нашёл 12 релевантных публикаций. Ключевые направления: рекордная эффективность 27.3% у tandem-ячеек, стабилизация через 2D/3D-гетероструктуры. Продолжить с деталями по каждой группе?',
    streaming: false
  }
]

const ERROR_ITEMS: FeedItem[] = [
  { kind: 'user', id: 'mock-e1', text: 'Продолжи анализ' },
  {
    kind: 'error',
    id: 'mock-e2',
    message: 'Ошибка провайдера: DEEPSEEK_API_KEY не задан. Добавьте ключ в Настройках.'
  }
]

function demoChats(): ChatSummary[] {
  return [
    {
      file: DEMO_CHAT_FILE,
      name: 'Perovskite обзор',
      lastActivity: Date.now() - 3_600_000,
      messageCount: 4,
      isGenerating: false
    },
    {
      file: '/mock/sessions/literature.jsonl',
      name: 'Литература по катализу',
      lastActivity: Date.now() - 86_400_000,
      messageCount: 12,
      isGenerating: false
    }
  ]
}

export function installMockApi(mode: MockMode = 'demo'): void {
  const chatListeners = new Set<(e: ChatEvent) => void>()
  const projectListeners = new Set<(p: CurrentProject) => void>()
  let seq = 0
  let project: CurrentProject | null = mode === 'demo' || mode === 'error' ? DEMO_PROJECT : null

  const snapshotItems = mode === 'error' ? ERROR_ITEMS : DEMO_ITEMS

  const api: Api = {
    projects: {
      list: async () => DEMO_RECENT,
      openDialog: async () => ({ ok: true, value: DEMO_PROJECT.path }),
      pickParent: async () => '/home/user/research',
      create: async (parent, name) => ({ ok: true, value: `${parent}/${name}` }),
      open: async (path) => {
        project = { path, name: path.split('/').filter(Boolean).pop() ?? path }
        for (const l of projectListeners) l(project)
        return { ok: true, value: path }
      },
      removeFromList: async () => DEMO_RECENT.slice(1),
      getCurrent: () =>
        mode === 'loading'
          ? new Promise<CurrentProject | null>(() => {}) // вечная загрузка
          : Promise.resolve(project)
    },
    chats: {
      list: async () => demoChats(),
      create: async () => ({
        file: '/mock/sessions/new-chat.jsonl',
        name: 'Новый чат',
        lastActivity: Date.now(),
        messageCount: 0,
        isGenerating: false
      }),
      rename: async () => ({ ok: true, value: null }),
      delete: async () => ({ ok: true, value: null }),
      select: async () => ({ ok: true, value: null }),
      search: async (query) =>
        demoChats().filter((c) => c.name.toLowerCase().includes(query.toLowerCase())),
      getActive: async () => DEMO_CHAT_FILE,
      snapshot: async (file): Promise<ChatSnapshot | null> => ({
        file,
        generating: false,
        lastSeq: seq,
        retrying: null,
        items: file === DEMO_CHAT_FILE ? snapshotItems : []
      })
    },
    messages: {
      send: async (text) => {
        // эхо-ответ через события — быстрый режим показывает живой стриминг
        const file = DEMO_CHAT_FILE
        const emit = (e: DistributiveOmit<ChatEvent, 'file' | 'seq'>): void => {
          seq += 1
          const event = { ...e, file, seq } as ChatEvent
          queueMicrotask(() => {
            for (const l of chatListeners) l(event)
          })
        }
        emit({ type: 'agent_start' })
        emit({ type: 'text_delta', delta: `Мок-ответ на: «${text}». ` })
        emit({ type: 'text_delta', delta: 'В режиме dev:renderer main-процесс не подключён.' })
        emit({ type: 'message_end', role: 'assistant' })
        emit({ type: 'agent_end' })
        return { ok: true, value: null }
      },
      retry: async () => ({ ok: true, value: null }),
      abort: async () => undefined
    },
    settings: {
      get: async () => ({
        settings: {
          providers: { deepseek: {} },
          customProviders: [],
          defaultModel: { providerId: 'deepseek', modelId: 'deepseek-v4-pro' }
        },
        encryptionAvailable: true,
        providers: [
          {
            id: 'deepseek',
            name: 'DeepSeek',
            hasAuth: false,
            isCustom: false,
            models: [
              { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro' },
              { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash' }
            ],
            availableThinkingLevels: ['off', 'low', 'medium', 'high']
          }
        ]
      }),
      set: async () => ({ ok: true, value: null })
    },
    events: {
      onChatEvent: (listener) => {
        chatListeners.add(listener)
        return () => chatListeners.delete(listener)
      },
      onProjectChanged: (listener) => {
        projectListeners.add(listener)
        return () => projectListeners.delete(listener)
      }
    }
  }

  window.api = api
}
