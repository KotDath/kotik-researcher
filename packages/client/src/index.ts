import {
  isRecord,
  parseTurnStreamEvent,
  type CreateSessionRequest,
  type CreateSessionResponse,
  type GetSessionResponse,
  type Session,
  type TurnStreamEvent,
} from '@kotik/protocol'

export interface KotikClientOptions {
  baseUrl?: string
  accessToken?: string
  fetch?: typeof globalThis.fetch
}

export interface CreateSessionOptions {
  ephemeral?: boolean
  signal?: AbortSignal
}

export class KotikClient {
  readonly #baseUrl: string
  readonly #accessToken?: string
  readonly #fetch: typeof globalThis.fetch

  constructor(options: KotikClientOptions = {}) {
    this.#baseUrl = (options.baseUrl ?? '').replace(/\/$/, '')
    this.#accessToken = options.accessToken
    const fetchImplementation = options.fetch ?? globalThis.fetch
    this.#fetch = (input, init) => fetchImplementation.call(globalThis, input, init)
  }

  async createSession(options: CreateSessionOptions = {}): Promise<Session> {
    const request: CreateSessionRequest = { ephemeral: options.ephemeral }
    const response = await this.#fetch(`${this.#baseUrl}/api/sessions`, {
      method: 'POST',
      headers: this.#headers(),
      body: JSON.stringify(request),
      signal: options.signal,
    })
    const payload = await readJsonResponse<CreateSessionResponse>(response)
    return payload.session
  }

  async getSession(sessionId: string, signal?: AbortSignal): Promise<Session> {
    const response = await this.#fetch(
      `${this.#baseUrl}/api/sessions/${encodeURIComponent(sessionId)}`,
      { headers: this.#headers(false), signal },
    )
    const payload = await readJsonResponse<GetSessionResponse>(response)
    return payload.session
  }

  async *streamTurn(
    sessionId: string,
    message: string,
    signal: AbortSignal,
  ): AsyncIterable<TurnStreamEvent> {
    const response = await this.#fetch(
      `${this.#baseUrl}/api/sessions/${encodeURIComponent(sessionId)}/turns`,
      {
        method: 'POST',
        headers: this.#headers(),
        body: JSON.stringify({ message }),
        signal,
      },
    )
    if (!response.ok) {
      throw new Error(await readResponseError(response))
    }
    if (!response.body) {
      throw new Error('Server did not return a response stream')
    }

    let completed = false
    for await (const event of readSseEvents(response.body)) {
      const parsed = parseTurnStreamEvent(event.type, event.payload)
      if (parsed.type === 'turn.failed') {
        throw new Error(parsed.message)
      }
      yield parsed
      if (parsed.type === 'turn.completed') {
        completed = true
        break
      }
    }
    if (!completed) {
      throw new Error('Server stream ended before turn.completed')
    }
  }

  async cancelTurn(sessionId: string): Promise<boolean> {
    const response = await this.#fetch(
      `${this.#baseUrl}/api/sessions/${encodeURIComponent(sessionId)}/cancel`,
      { method: 'POST', headers: this.#headers() },
    )
    const payload = await readJsonResponse<{ cancelled: boolean }>(response)
    return payload.cancelled
  }

  async deleteSession(sessionId: string): Promise<void> {
    const response = await this.#fetch(
      `${this.#baseUrl}/api/sessions/${encodeURIComponent(sessionId)}`,
      { method: 'DELETE', headers: this.#headers(false) },
    )
    if (!response.ok) {
      throw new Error(await readResponseError(response))
    }
  }

  #headers(json = true): HeadersInit {
    const headers: Record<string, string> = {}
    if (json) {
      headers['Content-Type'] = 'application/json'
    }
    if (this.#accessToken) {
      headers.Authorization = `Bearer ${this.#accessToken}`
    }
    return headers
  }
}

interface RawSseEvent {
  type: string
  payload: unknown
}

async function* readSseEvents(stream: ReadableStream<Uint8Array>): AsyncIterable<RawSseEvent> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let eventType = ''
  let dataLines: string[] = []

  const dispatch = (): RawSseEvent | undefined => {
    if (!eventType && dataLines.length === 0) {
      return undefined
    }
    let payload: unknown
    try {
      payload = JSON.parse(dataLines.join('\n'))
    } catch (error) {
      throw new Error('Server returned a malformed event', { cause: error })
    }
    const event = { type: eventType, payload }
    eventType = ''
    dataLines = []
    return event
  }

  try {
    while (true) {
      const { done, value } = await reader.read()
      buffer += decoder.decode(value, { stream: !done })
      let newline = buffer.indexOf('\n')
      while (newline !== -1) {
        const line = buffer.slice(0, newline).replace(/\r$/, '')
        buffer = buffer.slice(newline + 1)
        if (line === '') {
          const event = dispatch()
          if (event) {
            yield event
          }
        } else if (line.startsWith('event:')) {
          eventType = line.slice(6).trim()
        } else if (line.startsWith('data:')) {
          dataLines.push(line.slice(5).trimStart())
        }
        newline = buffer.indexOf('\n')
      }
      if (done) {
        if (buffer.startsWith('data:')) {
          dataLines.push(buffer.slice(5).trimStart())
        }
        const event = dispatch()
        if (event) {
          yield event
        }
        return
      }
    }
  } finally {
    reader.releaseLock()
  }
}

async function readJsonResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    throw new Error(await readResponseError(response))
  }
  return (await response.json()) as T
}

async function readResponseError(response: Response): Promise<string> {
  try {
    const payload: unknown = await response.json()
    if (isRecord(payload) && typeof payload.error === 'string' && payload.error) {
      return payload.error
    }
  } catch {
    // Fall back to a status-based message for non-JSON server responses.
  }
  return `Request failed with status ${response.status}`
}
