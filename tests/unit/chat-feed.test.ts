import { describe, expect, it, vi } from 'vitest'
import type { FeedItem } from '../../src/shared/ipc'

// chat-manager при импорте дёргает electron и paths — мокаем, как в других
// unit-тестах main-логики. pi SDK импортируется как обычный node-модуль.
vi.mock('electron', () => ({ shell: { trashItem: async () => {} } }))
vi.mock('../../src/main/paths', () => ({
  dataPaths: {
    agentDir: '/tmp/kotik-unit-agent',
    authPath: '/tmp/kotik-unit-agent/auth.json',
    modelsPath: '/tmp/kotik-unit-agent/models.json',
    recentProjectsPath: '/tmp/kotik-unit-agent/recent-projects.json',
    settingsPath: '/tmp/kotik-unit-agent/settings.json'
  }
}))

const { buildFeedItems } = await import('../../src/main/pi/chat-manager')

type SessionMessage = Parameters<typeof buildFeedItems>[0][number]

function msg(partial: Record<string, unknown>): SessionMessage {
  return { timestamp: 1000, ...partial } as SessionMessage
}

/** Логика, которую проверял runChatManagerSpike: snapshot отдаёт thinking-блоки
 * с длительностью, в правильном порядке, без оборванных порций. */
describe('buildFeedItems', () => {
  it('user и assistant-сообщения становятся пузырями ленты', () => {
    const items = buildFeedItems(
      [
        msg({ role: 'user', content: 'вопрос' }),
        msg({ role: 'assistant', content: [{ type: 'text', text: 'ответ' }] })
      ],
      false
    )
    expect(items).toEqual([
      { kind: 'user', id: 'm0', text: 'вопрос' },
      { kind: 'assistant', id: 'm1', text: 'ответ', streaming: false }
    ])
  })

  it('thinking-блок в snapshot идёт перед текстом ответа и несёт длительность из sidecar', () => {
    const items = buildFeedItems(
      [
        msg({
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: 'рассуждение' },
            { type: 'text', text: 'ответ' }
          ]
        })
      ],
      false,
      (timestamp, contentIndex) => (timestamp === 1000 && contentIndex === 0 ? 4200 : undefined)
    )
    expect(items.map((i) => i.kind)).toEqual(['thinking', 'assistant'])
    const thinking = items[0] as Extract<FeedItem, { kind: 'thinking' }>
    expect(thinking.durationMs).toBe(4200)
    expect(thinking.streaming).toBe(false)
    expect(thinking.startedAt).toBe(1000)
  })

  it('оборванное сообщение (stopReason error/aborted): reasoning в ленту не попадает', () => {
    const items = buildFeedItems(
      [
        msg({
          role: 'assistant',
          stopReason: 'error',
          errorMessage: 'provider down',
          content: [
            { type: 'thinking', thinking: 'оборванное рассуждение' },
            { type: 'text', text: 'частичный ответ' }
          ]
        })
      ],
      false
    )
    expect(items.map((i) => i.kind)).toEqual(['assistant', 'error'])
    expect((items[1] as Extract<FeedItem, { kind: 'error' }>).message).toBe('provider down')
  })

  it('redacted и пустой reasoning пропускаются', () => {
    const items = buildFeedItems(
      [
        msg({
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: 'скрыто', redacted: true },
            { type: 'thinking', thinking: '   ' },
            { type: 'text', text: 'ответ' }
          ]
        })
      ],
      false
    )
    expect(items.map((i) => i.kind)).toEqual(['assistant'])
  })

  it('toolCall + toolResult сшиваются в один блок со статусом и результатом', () => {
    const items = buildFeedItems(
      [
        msg({
          role: 'assistant',
          content: [{ type: 'toolCall', id: 'tc1', name: 'bash', arguments: { command: 'ls' } }]
        }),
        msg({ role: 'toolResult', toolCallId: 'tc1', isError: false, content: 'ok' })
      ],
      false
    )
    expect(items).toHaveLength(1)
    const tool = items[0] as Extract<FeedItem, { kind: 'tool' }>
    expect(tool.status).toBe('done')
    expect(tool.resultPreview).toBe('ok')
    expect(tool.toolName).toBe('bash')
  })

  it('generating помечает последний assistant-блок стримингом', () => {
    const items = buildFeedItems(
      [msg({ role: 'assistant', content: [{ type: 'text', text: 'пишет…' }] })],
      true
    )
    expect((items[0] as Extract<FeedItem, { kind: 'assistant' }>).streaming).toBe(true)
  })
})
