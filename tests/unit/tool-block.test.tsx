import { describe, expect, it } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import ToolBlock from '@renderer/components/ToolBlock'
import type { FeedItem } from '../../src/shared/ipc'

type ToolItem = Extract<FeedItem, { kind: 'tool' }>

const item: ToolItem = {
  kind: 'tool',
  id: 't1',
  toolCallId: 'tc-1',
  toolName: 'bash',
  status: 'done',
  argsPreview: '{"command":"ls -la"}',
  resultPreview: 'total 42'
}

describe('ToolBlock', () => {
  it('рендерит имя инструмента, summary из args и статус', () => {
    render(<ToolBlock item={item} />)
    expect(screen.getByText('🔧 bash')).toBeInTheDocument()
    expect(screen.getByText('ls -la')).toBeInTheDocument()
    expect(screen.getByText('завершён')).toBeInTheDocument()
  })

  it('свёрнут по умолчанию, раскрывается и сворачивается по клику', () => {
    render(<ToolBlock item={item} />)
    expect(screen.queryByText('Аргументы')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByText('Аргументы')).toBeInTheDocument()
    expect(screen.getByText('Результат')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button'))
    expect(screen.queryByText('Аргументы')).not.toBeInTheDocument()
  })

  it('статус running показывает «выполняется…»', () => {
    render(<ToolBlock item={{ ...item, status: 'running' }} />)
    expect(screen.getByText('выполняется…')).toBeInTheDocument()
  })
})
