import { describe, expect, it, vi } from 'vitest'
import type { ModelDelta } from '@kotik/agent'
import { DeepSeekProvider } from './index.ts'

describe('DeepSeekProvider', () => {
  it('sends conversation history and emits normalized deltas', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      sseResponse([
        'data: {"choices":[{"delta":{"reasoning_content":"think "}}]}\n\n',
        'data: {"choices":[{"delta":{"reasoning_content":"carefully"}}]}\n\n',
        'data: {"choices":[{"finish_reason":"stop","delta":{"content":"answer"}}]}\n\n',
        'data: [DONE]\n\n',
      ]),
    )
    const provider = new DeepSeekProvider({ apiKey: 'test-key', fetch: fetchMock })

    const deltas = await collect(
      provider.stream(
        [
          { role: 'user', content: 'earlier' },
          { role: 'assistant', content: 'context' },
          { role: 'user', content: 'question' },
        ],
        new AbortController().signal,
      ),
    )

    expect(deltas).toEqual([
      { type: 'reasoning', delta: 'think ' },
      { type: 'reasoning', delta: 'carefully' },
      { type: 'answer', delta: 'answer' },
    ])
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.deepseek.com/chat/completions')
    expect(init?.headers).toMatchObject({ Authorization: 'Bearer test-key' })
    expect(JSON.parse(String(init?.body))).toMatchObject({
      model: 'deepseek-v4-flash',
      messages: [
        { role: 'user', content: 'earlier' },
        { role: 'assistant', content: 'context' },
        { role: 'user', content: 'question' },
      ],
      thinking: { type: 'enabled' },
      reasoning_effort: 'high',
      max_tokens: 4096,
      stream: true,
    })
  })

  it('returns a typed upstream API error', async () => {
    const provider = new DeepSeekProvider({
      apiKey: 'test-key',
      fetch: vi.fn<typeof fetch>().mockResolvedValue(
        new Response('{"error":{"message":"invalid key"}}', {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    })

    const result = collect(provider.stream([], new AbortController().signal))
    await expect(result).rejects.toMatchObject({
      statusCode: 401,
      apiMessage: 'invalid key',
    })
  })

  it.each([
    ['malformed chunk', ['data: not-json\n\n'], 'decode DeepSeek stream chunk'],
    ['missing done marker', ['data: {"choices":[]}\n\n'], 'before [DONE]'],
    [
      'non-stop finish reason',
      [
        'data: {"choices":[{"finish_reason":"length","delta":{"content":"partial"}}]}\n\n',
        'data: [DONE]\n\n',
      ],
      'reason "length"',
    ],
  ])('rejects an incomplete stream: %s', async (_name, chunks, message) => {
    const provider = new DeepSeekProvider({
      apiKey: 'test-key',
      fetch: vi.fn<typeof fetch>().mockResolvedValue(sseResponse(chunks)),
    })
    await expect(collect(provider.stream([], new AbortController().signal))).rejects.toThrow(message)
  })

  it('bounds the size of a multiline SSE event', async () => {
    const oversized = `data: ${'x'.repeat((1 << 20) / 2)}\n`.repeat(3)
    const provider = new DeepSeekProvider({
      apiKey: 'test-key',
      fetch: vi.fn<typeof fetch>().mockResolvedValue(sseResponse([oversized])),
    })

    await expect(collect(provider.stream([], new AbortController().signal))).rejects.toThrow(
      'exceeded the size limit',
    )
  })
})

function sseResponse(chunks: string[]): Response {
  const encoder = new TextEncoder()
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(chunk))
        }
        controller.close()
      },
    }),
    { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
  )
}

async function collect(iterable: AsyncIterable<ModelDelta>): Promise<ModelDelta[]> {
  const values: ModelDelta[] = []
  for await (const value of iterable) {
    values.push(value)
  }
  return values
}
