import type { AgentMessage, ModelDelta, ModelProvider } from '@kotik/agent'

const DEFAULT_ENDPOINT = 'https://api.deepseek.com/chat/completions'
const DEFAULT_MODEL = 'deepseek-v4-flash'
const MAX_ERROR_BODY = 1 << 20
const MAX_STREAM_BUFFER = 1 << 20

export interface DeepSeekProviderOptions {
  apiKey: string
  endpoint?: string
  fetch?: typeof globalThis.fetch
  timeoutMs?: number
}

export class DeepSeekAPIError extends Error {
  constructor(
    readonly statusCode: number,
    readonly apiMessage = '',
  ) {
    super(
      apiMessage
        ? `DeepSeek API returned status ${statusCode}: ${apiMessage}`
        : `DeepSeek API returned status ${statusCode}`,
    )
    this.name = 'DeepSeekAPIError'
  }
}

export class DeepSeekProvider implements ModelProvider {
  readonly #apiKey: string
  readonly #endpoint: string
  readonly #fetch: typeof globalThis.fetch
  readonly #timeoutMs: number

  constructor(options: DeepSeekProviderOptions) {
    this.#apiKey = options.apiKey
    this.#endpoint = options.endpoint ?? DEFAULT_ENDPOINT
    this.#fetch = options.fetch ?? globalThis.fetch
    this.#timeoutMs = options.timeoutMs ?? 5 * 60_000
  }

  async *stream(messages: readonly AgentMessage[], signal: AbortSignal): AsyncIterable<ModelDelta> {
    const response = await this.#fetch(this.#endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.#apiKey}`,
        Accept: 'text/event-stream',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        messages,
        thinking: { type: 'enabled' },
        reasoning_effort: 'high',
        max_tokens: 4096,
        stream: true,
      }),
      signal: AbortSignal.any([signal, AbortSignal.timeout(this.#timeoutMs)]),
    })

    if (!response.ok) {
      throw await decodeAPIError(response)
    }
    if (!response.body) {
      throw new Error('DeepSeek API returned an empty response body')
    }

    let finishReason = ''
    let receivedAnswer = false
    let receivedDone = false

    for await (const data of readSseData(response.body)) {
      if (data === '[DONE]') {
        receivedDone = true
        break
      }

      const chunk = parseChunk(data)
      for (const choice of chunk.choices) {
        if (typeof choice.finish_reason === 'string' && choice.finish_reason) {
          finishReason = choice.finish_reason
        }
        const reasoning = choice.delta?.reasoning_content
        if (typeof reasoning === 'string' && reasoning) {
          yield { type: 'reasoning', delta: reasoning }
        }
        const answer = choice.delta?.content
        if (typeof answer === 'string' && answer) {
          receivedAnswer = true
          yield { type: 'answer', delta: answer }
        }
      }
    }

    if (!receivedDone) {
      throw new Error('DeepSeek stream ended before [DONE]')
    }
    if (finishReason !== 'stop') {
      throw new Error(
        finishReason
          ? `DeepSeek completion stopped with reason ${JSON.stringify(finishReason)}`
          : 'DeepSeek stream ended without a finish reason',
      )
    }
    if (!receivedAnswer) {
      throw new Error('DeepSeek completion did not contain a final answer')
    }
  }
}

interface StreamChunk {
  choices: Array<{
    finish_reason?: unknown
    delta?: {
      reasoning_content?: unknown
      content?: unknown
    }
  }>
}

function parseChunk(data: string): StreamChunk {
  let value: unknown
  try {
    value = JSON.parse(data)
  } catch (error) {
    throw new Error('Could not decode DeepSeek stream chunk', { cause: error })
  }
  if (!isRecord(value) || !Array.isArray(value.choices)) {
    throw new Error('DeepSeek stream chunk has an invalid shape')
  }
  return value as unknown as StreamChunk
}

async function* readSseData(stream: ReadableStream<Uint8Array>): AsyncIterable<string> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let dataLines: string[] = []
  let eventSize = 0
  let reachedEnd = false

  const processLine = (line: string): string | undefined => {
    eventSize += line.length + 1
    if (eventSize > MAX_STREAM_BUFFER) {
      throw new Error('DeepSeek stream event exceeded the size limit')
    }
    if (line === '') {
      const data = dataLines.length > 0 ? dataLines.join('\n') : undefined
      dataLines = []
      eventSize = 0
      return data
    }
    if (line.startsWith('data:')) {
      const data = line.slice(5).trimStart()
      dataLines.push(data)
    }
    return undefined
  }

  try {
    while (true) {
      const { done, value } = await reader.read()
      buffer += decoder.decode(value, { stream: !done })
      if (buffer.length > MAX_STREAM_BUFFER) {
        throw new Error('DeepSeek stream event exceeded the size limit')
      }

      let newline = buffer.indexOf('\n')
      while (newline !== -1) {
        const data = processLine(buffer.slice(0, newline).replace(/\r$/, ''))
        buffer = buffer.slice(newline + 1)
        if (data !== undefined) {
          yield data
        }
        newline = buffer.indexOf('\n')
      }

      if (done) {
        reachedEnd = true
        if (buffer) {
          const data = processLine(buffer.replace(/\r$/, ''))
          if (data !== undefined) {
            yield data
          }
        }
        if (dataLines.length > 0) {
          yield dataLines.join('\n')
        }
        return
      }
    }
  } finally {
    if (!reachedEnd) {
      await reader.cancel().catch(() => undefined)
    }
    reader.releaseLock()
  }
}

async function decodeAPIError(response: Response): Promise<DeepSeekAPIError> {
  let message = ''
  try {
    const value: unknown = JSON.parse(await readLimitedText(response, MAX_ERROR_BODY))
    if (isRecord(value) && isRecord(value.error) && typeof value.error.message === 'string') {
      message = value.error.message
    }
  } catch {
    // A status-only error is still useful when the upstream body is not JSON.
  }
  return new DeepSeekAPIError(response.status, message)
}

async function readLimitedText(response: Response, limit: number): Promise<string> {
  if (!response.body) {
    return ''
  }
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let result = ''
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) {
        return result + decoder.decode()
      }
      size += value.byteLength
      if (size > limit) {
        await reader.cancel('response body exceeded the size limit')
        throw new Error('DeepSeek error response exceeded the size limit')
      }
      result += decoder.decode(value, { stream: true })
    }
  } finally {
    reader.releaseLock()
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
