import { useState } from 'react'
import type { FeedItem } from '../../../shared/ipc'

type ToolItem = Extract<FeedItem, { kind: 'tool' }>

const STATUS_LABEL: Record<ToolItem['status'], string> = {
  running: 'выполняется…',
  done: 'завершён',
  error: 'ошибка'
}

function ToolBlock({ item }: { item: ToolItem }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  return (
    <div className={`tool-block tool-${item.status}`}>
      <button className="tool-header" onClick={() => setOpen(!open)}>
        <span className="tool-chevron">{open ? '▾' : '▸'}</span>
        <span className="tool-name">🔧 {item.toolName}</span>
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
