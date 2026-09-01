import { describe, expect, it, vi } from 'vitest'
import { KotikClient } from './index.ts'

describe('KotikClient', () => {
  it('creates a session and parses a streamed turn', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          session: { id: 'session-1', createdAt: '2026-09-01T12:00:00.000Z', messages: [] },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          [
            'event: reasoning.delta\ndata: {"type":"reasoning.delta","delta":"think"}\n\n',
            'event: answer.delta\ndata: {"type":"answer.delta","delta":"answer"}\n\n',
            'event: turn.completed\ndata: {"type":"turn.completed"}\n\n',
          ].join(''),
          { headers: { 'Content-Type': 'text/event-stream' } },
        ),
      )
    const client = new KotikClient({
      baseUrl: 'http://127.0.0.1:9000/',
      accessToken: 'desktop-token',
      fetch: fetchMock,
    })

    const session = await client.createSession()
    const events = []
    for await (const event of client.streamTurn(
      session.id,
      'question',
      new AbortController().signal,
    )) {
      events.push(event)
    }

    expect(events).toEqual([
      { type: 'reasoning.delta', delta: 'think' },
      { type: 'answer.delta', delta: 'answer' },
      { type: 'turn.completed' },
    ])
    expect(fetchMock.mock.calls[1][0]).toBe(
      'http://127.0.0.1:9000/api/sessions/session-1/turns',
    )
    expect(fetchMock.mock.calls[1][1]?.headers).toMatchObject({
      Authorization: 'Bearer desktop-token',
      'Content-Type': 'application/json',
    })
  })

  it('turns a streamed failure into an exception', async () => {
    const client = new KotikClient({
      fetch: vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
          'event: turn.failed\ndata: {"type":"turn.failed","message":"failed"}\n\n',
        ),
      ),
    })

    await expect(
      collect(client.streamTurn('session-1', 'question', new AbortController().signal)),
    ).rejects.toThrow('failed')
  })
})

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const values: T[] = []
  for await (const value of iterable) {
    values.push(value)
  }
  return values
}
