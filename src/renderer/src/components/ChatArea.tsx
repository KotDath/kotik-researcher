import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChatEvent, FeedItem, RetryState } from '../../../shared/ipc'
import ReasoningBlock from './ReasoningBlock'
import ToolBlock from './ToolBlock'

interface Props {
  file: string
  registerListener: (listener: (e: ChatEvent) => void) => () => void
  onFeedChanged: () => void
}

let localId = 0
const nextLocalId = (): string => `local-${localId++}`

function appendDelta(items: FeedItem[], delta: string): FeedItem[] {
  // провайдеры шлёт пустые text_delta (OpenAI-чанки content:'' при tool_calls) —
  // пустой assistant-пузырь с бордером в ленте не нужен
  if (!delta) return items
  const last = items[items.length - 1]
  if (last?.kind === 'assistant' && last.streaming) {
    return [...items.slice(0, -1), { ...last, text: last.text + delta }]
  }
  return [...items, { kind: 'assistant', id: nextLocalId(), text: delta, streaming: true }]
}

function closeStreaming(items: FeedItem[]): FeedItem[] {
  const last = items[items.length - 1]
  if (last?.kind === 'assistant' && last.streaming) {
    // пузырь, не получивший текста (только пустые дельты), удаляем, а не закрываем
    if (!last.text) return items.slice(0, -1)
    return [...items.slice(0, -1), { ...last, streaming: false }]
  }
  return items
}

/** Незакрытая порция reasoning в ленте (логически одна): ищем сканированием,
 * а не «последний item» — после message_end или текста новой попытки retry
 * блок может оказаться не последним (LRN-20260728-002, review-fix). */
function findStreamingThinkingIndex(items: FeedItem[]): number {
  for (let i = items.length - 1; i >= 0; i--) {
    if (items[i].kind === 'thinking' && (items[i] as { streaming: boolean }).streaming) return i
  }
  return -1
}

function startThinking(items: FeedItem[], startedAt: number): FeedItem[] {
  const open = findStreamingThinkingIndex(items)
  // обрыв + auto-retry: новый start заменяет незакрытый блок в той же позиции,
  // дублей в ленте нет (LRN-20260728-002)
  if (open >= 0) {
    const item = items[open] as Extract<FeedItem, { kind: 'thinking' }>
    return [
      ...items.slice(0, open),
      { ...item, text: '', startedAt, durationMs: undefined },
      ...items.slice(open + 1)
    ]
  }
  return [
    ...items,
    { kind: 'thinking', id: nextLocalId(), text: '', streaming: true, startedAt }
  ]
}

function appendThinkingDelta(items: FeedItem[], delta: string): FeedItem[] {
  const open = findStreamingThinkingIndex(items)
  if (open >= 0) {
    const item = items[open] as Extract<FeedItem, { kind: 'thinking' }>
    return [...items.slice(0, open), { ...item, text: item.text + delta }, ...items.slice(open + 1)]
  }
  return items
}

/** Закрывает streaming-блок; пустая порция (redacted/без delta) удаляется —
 * пустых хедеров в ленте быть не должно (design.md). */
function closeThinking(items: FeedItem[], durationMs?: number): FeedItem[] {
  const open = findStreamingThinkingIndex(items)
  if (open < 0) return items
  const item = items[open] as Extract<FeedItem, { kind: 'thinking' }>
  if (!item.text.trim()) {
    return [...items.slice(0, open), ...items.slice(open + 1)]
  }
  return [
    ...items.slice(0, open),
    { ...item, streaming: false, durationMs: durationMs ?? Date.now() - item.startedAt },
    ...items.slice(open + 1)
  ]
}

function ChatArea({ file, registerListener, onFeedChanged }: Props): React.JSX.Element {
  const [items, setItems] = useState<FeedItem[]>([])
  const [generating, setGenerating] = useState(false)
  const [retrying, setRetrying] = useState<RetryState | null>(null)
  const [input, setInput] = useState('')
  const [sendError, setSendError] = useState<string | null>(null)
  const lastSeqRef = useRef(0)
  const feedRef = useRef<HTMLDivElement>(null)
  // auto-scroll прилипает к низу, только пока пользователь сам у низа;
  // иначе thinking_delta пинят ленту и ручная прокрутка «залипает»
  const stickToBottomRef = useRef(true)
  // гонка snapshot/event (review-fix цикла 3): события, пришедшие, пока IPC-запрос
  // snapshot в полёте, буферизуются и применяются поверх snapshot по seq —
  // иначе callback snapshot перезаписал бы их старым состоянием (вариант «б»
  // в decisions.md)
  const snapPendingRef = useRef(false)
  const eventBufferRef = useRef<ChatEvent[]>([])

  const applyEvent = useCallback(
    (e: ChatEvent): void => {
      if (e.seq <= lastSeqRef.current) return // дедупликация против снапшота (design.md)
      lastSeqRef.current = e.seq
      switch (e.type) {
        case 'agent_start':
          setGenerating(true)
          setSendError(null)
          break
        case 'text_delta':
          setItems((prev) => appendDelta(prev, e.delta))
          break
        case 'thinking_start':
          setItems((prev) => startThinking(prev, e.startedAt))
          break
        case 'thinking_delta':
          setItems((prev) => appendThinkingDelta(prev, e.delta))
          break
        case 'thinking_end':
          setItems((prev) => closeThinking(prev, e.durationMs))
          break
        case 'message_end':
          // stopReason error/aborted: порция оборвана — НЕ закрываем блок, чтобы
          // thinking_start следующей попытки (auto-retry) заменил его, а не
          // продублировал; закроет финальный agent_end/error (review-fix, находка 2)
          if (e.role === 'assistant') {
            setItems((prev) => {
              const closedText = closeStreaming(prev)
              return e.stopReason === 'error' || e.stopReason === 'aborted'
                ? closedText
                : closeThinking(closedText)
            })
          }
          break
        case 'tool_start':
          setItems((prev) => [
            ...prev,
            {
              kind: 'tool',
              id: nextLocalId(),
              toolCallId: e.toolCallId,
              toolName: e.toolName,
              status: 'running',
              argsPreview: e.argsPreview
            }
          ])
          break
        case 'tool_update':
          setItems((prev) =>
            prev.map((item) =>
              item.kind === 'tool' && item.toolCallId === e.toolCallId && item.status === 'running'
                ? { ...item, resultPreview: e.resultPreview }
                : item
            )
          )
          break
        case 'tool_end':
          setItems((prev) =>
            prev.map((item) =>
              item.kind === 'tool' && item.toolCallId === e.toolCallId && item.status === 'running'
                ? { ...item, status: e.isError ? 'error' : 'done', resultPreview: e.resultPreview }
                : item
            )
          )
          break
        case 'auto_retry':
          setRetrying(e.retrying)
          break
        case 'auto_retry_done':
          setRetrying(null)
          break
        case 'agent_end':
          setGenerating(false)
          setRetrying(null)
          setItems((prev) => closeThinking(closeStreaming(prev)))
          onFeedChanged()
          break
        case 'error':
          setRetrying(null)
          setGenerating(false)
          setItems((prev) => {
            const closed = closeThinking(closeStreaming(prev))
            const last = closed[closed.length - 1]
            const withoutEmpty =
              last?.kind === 'assistant' && last.text === '' ? closed.slice(0, -1) : closed
            return [
              ...withoutEmpty,
              { kind: 'error', id: nextLocalId(), message: e.message }
            ]
          })
          onFeedChanged()
          break
      }
    },
    [onFeedChanged]
  )

  useEffect(() => {
    let alive = true
    snapPendingRef.current = true
    eventBufferRef.current = []
    void window.api.chats.snapshot(file).then((snap) => {
      if (!alive) return
      snapPendingRef.current = false
      if (!snap) {
        eventBufferRef.current = []
        return
      }
      lastSeqRef.current = snap.lastSeq
      setItems(snap.items)
      setGenerating(snap.generating)
      setRetrying(snap.retrying)
      // события, пришедшие за время запроса: применяем поверх snapshot;
      // уже учтённые в нём отсекаются по seq внутри applyEvent
      for (const e of eventBufferRef.current) applyEvent(e)
      eventBufferRef.current = []
    })
    return () => {
      alive = false
      snapPendingRef.current = false
      eventBufferRef.current = []
    }
  }, [file, applyEvent])

  useEffect(() => {
    return registerListener((e) => {
      if (e.file !== file) return
      if (snapPendingRef.current) {
        eventBufferRef.current.push(e)
        return
      }
      applyEvent(e)
    })
  }, [file, registerListener, applyEvent])

  useEffect(() => {
    if (stickToBottomRef.current) {
      feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight })
    }
  }, [items, retrying])

  const send = useCallback(async (): Promise<void> => {
    const text = input.trim()
    if (!text) return
    setInput('')
    setSendError(null)
    stickToBottomRef.current = true
    // оптимистичный пузырь: сообщение видно сразу, в т.ч. когда встаёт в очередь (followUp)
    setItems((prev) => [...prev, { kind: 'user', id: nextLocalId(), text }])
    const res = await window.api.messages.send(text)
    if (!res.ok) {
      setItems((prev) => [...prev, { kind: 'error', id: nextLocalId(), message: res.error }])
    }
  }, [input])

  const retry = useCallback(async (): Promise<void> => {
    setItems((prev) => {
      const last = prev[prev.length - 1]
      return last?.kind === 'error' ? prev.slice(0, -1) : prev
    })
    const res = await window.api.messages.retry()
    if (!res.ok) setSendError(res.error)
  }, [])

  return (
    <main className="chat">
      <div
        className="chat-feed"
        ref={feedRef}
        onScroll={(e) => {
          const el = e.currentTarget
          stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
        }}
      >
        {items.length === 0 && (
          <div className="chat-placeholder">Напишите сообщение, чтобы начать диалог</div>
        )}
        {items.map((item) => {
          switch (item.kind) {
            case 'user':
              return (
                <div key={item.id} className="msg msg-user">
                  {item.text}
                </div>
              )
            case 'assistant':
              return (
                <div key={item.id} className="msg msg-assistant">
                  {item.text}
                  {item.streaming && <span className="cursor">▍</span>}
                </div>
              )
            case 'tool':
              return <ToolBlock key={item.id} item={item} />
            case 'thinking':
              return <ReasoningBlock key={item.id} item={item} />
            case 'error':
              return (
                <div key={item.id} className="msg msg-error">
                  <div className="msg-error-title">Ошибка</div>
                  <div className="msg-error-text">{item.message}</div>
                  <button className="btn btn-sm" onClick={() => void retry()}>
                    Повторить
                  </button>
                </div>
              )
          }
        })}
        {retrying && (
          <div className="retry-banner">
            Ошибка провайдера, повторная попытка {retrying.attempt}/{retrying.maxAttempts}:{' '}
            {retrying.errorMessage}
          </div>
        )}
      </div>

      {sendError && <div className="send-error">{sendError}</div>}

      <div className="chat-input-row">
        <textarea
          className="input chat-input"
          placeholder="Сообщение агенту… (Enter — отправить, Shift+Enter — новая строка)"
          value={input}
          rows={3}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              void send()
            }
          }}
        />
        <div className="chat-input-buttons">
          {generating && (
            <button className="btn" onClick={() => void window.api.messages.abort()}>
              Стоп
            </button>
          )}
          <button className="btn btn-primary" onClick={() => void send()} disabled={!input.trim()}>
            Отправить
          </button>
        </div>
      </div>
    </main>
  )
}

export default ChatArea
