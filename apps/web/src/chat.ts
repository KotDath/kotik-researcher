export interface ChatStreamHandlers {
  onReasoning(delta: string): void
  onAnswer(delta: string): void
}

export async function streamChat(
  question: string,
  signal: AbortSignal,
  handlers: ChatStreamHandlers,
): Promise<void> {
  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question }),
    signal,
  })

  if (!response.ok) {
    throw new Error(await readResponseError(response))
  }
  if (!response.body) {
    throw new Error('Сервер не вернул поток данных')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let eventName = ''
  let dataLines: string[] = []

  const dispatch = (): boolean => {
    if (!eventName && dataLines.length === 0) {
      return false
    }

    const payload = parsePayload(dataLines.join('\n'))
    const currentEvent = eventName
    eventName = ''
    dataLines = []

    if (currentEvent === 'done') {
      return true
    }
    if (currentEvent === 'error') {
      throw new Error(readString(payload, 'message') ?? 'Ошибка потока DeepSeek')
    }

    const delta = readString(payload, 'delta')
    if (delta && currentEvent === 'reasoning') {
      handlers.onReasoning(delta)
    } else if (delta && currentEvent === 'answer') {
      handlers.onAnswer(delta)
    }
    return false
  }

  const processLine = (line: string): boolean => {
    if (line === '') {
      return dispatch()
    }
    if (line.startsWith('event:')) {
      eventName = line.slice('event:'.length).trim()
    } else if (line.startsWith('data:')) {
      dataLines.push(line.slice('data:'.length).trimStart())
    }
    return false
  }

  try {
    while (true) {
      const { done, value } = await reader.read()
      buffer += decoder.decode(value, { stream: !done })

      let newline = buffer.indexOf('\n')
      while (newline !== -1) {
        const line = buffer.slice(0, newline).replace(/\r$/, '')
        buffer = buffer.slice(newline + 1)
        if (processLine(line)) {
          return
        }
        newline = buffer.indexOf('\n')
      }

      if (done) {
        if (buffer && processLine(buffer.replace(/\r$/, ''))) {
          return
        }
        if (dispatch()) {
          return
        }
        throw new Error('Поток DeepSeek завершился без события done')
      }
    }
  } finally {
    reader.releaseLock()
  }
}

async function readResponseError(response: Response): Promise<string> {
  try {
    const payload: unknown = await response.json()
    if (isRecord(payload)) {
      const message = readString(payload, 'error')
      if (message) {
        return message
      }
    }
  } catch {
    // Fall back to a status-based error when the server response is not JSON.
  }
  return `Запрос завершился с кодом ${response.status}`
}

function parsePayload(data: string): Record<string, unknown> {
  let payload: unknown
  try {
    payload = JSON.parse(data)
  } catch {
    throw new Error('Сервер вернул повреждённое событие')
  }
  if (!isRecord(payload)) {
    throw new Error('Сервер вернул событие неверного формата')
  }
  return payload
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function readString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key]
  return typeof value === 'string' ? value : null
}
