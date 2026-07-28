import { useEffect, useRef, useState } from 'react'
import type { FeedItem } from '../../../shared/ipc'

type ThinkingItem = Extract<FeedItem, { kind: 'thinking' }>

function formatDuration(ms: number): string {
  return `${Math.max(0, Math.round(ms / 1000))}s`
}

function ReasoningBlock({ item }: { item: ThinkingItem }): React.JSX.Element {
  const [open, setOpen] = useState(item.streaming)
  const [now, setNow] = useState(() => Date.now())
  const prevStreaming = useRef(item.streaming)

  // развёрнут при стриминге, auto-collapse по завершении порции;
  // ручной клик после этого работает как обычно
  useEffect(() => {
    if (item.streaming !== prevStreaming.current) {
      setOpen(item.streaming)
      prevStreaming.current = item.streaming
    }
  }, [item.streaming])

  // длительность тикает вживую, пока порция стримится
  useEffect(() => {
    if (!item.streaming) return
    const timer = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(timer)
  }, [item.streaming])

  const durationMs = item.streaming ? now - item.startedAt : item.durationMs

  return (
    <div className="thinking-block">
      {/* во время стриминга блок развёрнут принудительно: ручное сворачивание
          запрещено, ручное управление — после завершения порции */}
      <button className="thinking-header" onClick={() => setOpen(!open)} disabled={item.streaming}>
        <span className="thinking-chevron">{open ? '▾' : '▸'}</span>
        <span className="thinking-label">
          💡 Thinking{durationMs !== undefined && ` · ${formatDuration(durationMs)}`}
        </span>
      </button>
      {open && <div className="thinking-body">{item.text}</div>}
    </div>
  )
}

export default ReasoningBlock
