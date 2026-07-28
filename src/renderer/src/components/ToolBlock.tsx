import { useState } from 'react'
import type { FeedItem } from '../../../shared/ipc'

type ToolItem = Extract<FeedItem, { kind: 'tool' }>

const STATUS_LABEL: Record<ToolItem['status'], string> = {
  running: 'выполняется…',
  done: 'завершён',
  error: 'ошибка'
}

/** Однострочная выдержка сути вызова для collapsed-хедера: команда/путь из
 * args, чтобы свёрнутый блок не выглядел пустой рамкой. */
function summarizeArgs(argsPreview: string): string {
  if (!argsPreview) return ''
  try {
    const parsed: unknown = JSON.parse(argsPreview)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      for (const key of ['command', 'path', 'file_path', 'filePath', 'pattern', 'query', 'url']) {
        const value = (parsed as Record<string, unknown>)[key]
        if (typeof value === 'string' && value) return value
      }
    }
  } catch {
    // усечённый preview — fallback на первую содержательную строку
  }
  const line = argsPreview
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l && l !== '{' && l !== '[')
  return (line ?? '').replace(/^"[^"]+":\s*/, '').replace(/^"|",?$/g, '')
}

function ToolBlock({ item }: { item: ToolItem }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const summary = summarizeArgs(item.argsPreview)
  return (
    <div className={`tool-block tool-${item.status}`}>
      <button className="tool-header" onClick={() => setOpen(!open)}>
        <span className="tool-chevron">{open ? '▾' : '▸'}</span>
        <span className="tool-name">🔧 {item.toolName}</span>
        {summary && <span className="tool-summary">{summary}</span>}
        <span className={`tool-status tool-status-${item.status}`}>
          {STATUS_LABEL[item.status]}
        </span>
      </button>
      {open && (
        <div className="tool-details">
          {item.argsPreview && (
            <div className="tool-section">
              <div className="tool-section-title">Аргументы</div>
              <pre className="tool-pre">{item.argsPreview}</pre>
            </div>
          )}
          {item.resultPreview && (
            <div className="tool-section">
              <div className="tool-section-title">Результат</div>
              <pre className="tool-pre">{item.resultPreview}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default ToolBlock
