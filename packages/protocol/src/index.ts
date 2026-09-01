export interface SessionMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface Session {
  id: string
  createdAt: string
  messages: SessionMessage[]
}

export interface CreateSessionResponse {
  session: Session
}

export interface CreateSessionRequest {
  ephemeral?: boolean
}

export interface GetSessionResponse {
  session: Session
}

export interface SubmitTurnRequest {
  message: string
}

export type TurnStreamEvent =
  | { type: 'reasoning.delta'; delta: string }
  | { type: 'answer.delta'; delta: string }
  | { type: 'turn.completed' }
  | { type: 'turn.failed'; message: string }

export interface ErrorResponse {
  error: string
}

export function parseTurnStreamEvent(type: string, value: unknown): TurnStreamEvent {
  if (!isRecord(value)) {
    throw new Error('Server returned an invalid event payload')
  }
  if (type === 'reasoning.delta' || type === 'answer.delta') {
    const delta = value.delta
    if (typeof delta !== 'string') {
      throw new Error(`Server returned an invalid ${type} event`)
    }
    return { type, delta }
  }
  if (type === 'turn.completed') {
    return { type }
  }
  if (type === 'turn.failed') {
    const message = value.message
    if (typeof message !== 'string') {
      throw new Error('Server returned an invalid turn.failed event')
    }
    return { type, message }
  }
  throw new Error(`Server returned an unknown event type: ${type || '<empty>'}`)
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
