export type AgentRole = 'user' | 'assistant'

export interface AgentMessage {
  role: AgentRole
  content: string
}

export type ModelDelta =
  | { type: 'reasoning'; delta: string }
  | { type: 'answer'; delta: string }

export interface ModelProvider {
  stream(messages: readonly AgentMessage[], signal: AbortSignal): AsyncIterable<ModelDelta>
}

export interface AgentSession {
  id: string
  createdAt: string
  messages: AgentMessage[]
}

export interface SessionRepository {
  create(session: AgentSession): Promise<void>
  get(id: string): Promise<AgentSession | undefined>
  save(session: AgentSession): Promise<void>
  delete(id: string): Promise<void>
}

export class InMemorySessionRepository implements SessionRepository {
  readonly #sessions = new Map<string, AgentSession>()

  constructor(readonly maxSessions = 1_000) {
    if (!Number.isSafeInteger(maxSessions) || maxSessions < 1) {
      throw new Error('maxSessions must be a positive integer')
    }
  }

  async create(session: AgentSession): Promise<void> {
    if (!this.#sessions.has(session.id) && this.#sessions.size >= this.maxSessions) {
      throw new SessionCapacityError(this.maxSessions)
    }
    this.#sessions.set(session.id, cloneSession(session))
  }

  async get(id: string): Promise<AgentSession | undefined> {
    const session = this.#sessions.get(id)
    return session ? cloneSession(session) : undefined
  }

  async save(session: AgentSession): Promise<void> {
    if (!this.#sessions.has(session.id) && this.#sessions.size >= this.maxSessions) {
      throw new SessionCapacityError(this.maxSessions)
    }
    this.#sessions.set(session.id, cloneSession(session))
  }

  async delete(id: string): Promise<void> {
    this.#sessions.delete(id)
  }

}

export class SessionNotFoundError extends Error {
  constructor(id: string) {
    super(`Session ${id} was not found`)
    this.name = 'SessionNotFoundError'
  }
}

export class SessionBusyError extends Error {
  constructor(id: string) {
    super(`Session ${id} already has an active turn`)
    this.name = 'SessionBusyError'
  }
}

export class SessionCapacityError extends Error {
  constructor(limit: number) {
    super(`Session capacity of ${limit} has been reached`)
    this.name = 'SessionCapacityError'
  }
}

export interface AgentRuntimeOptions {
  idFactory?: () => string
  now?: () => Date
}

export class AgentRuntime {
  readonly #sessionOperations = new Map<string, AbortController | 'deleting'>()
  readonly #idFactory: () => string
  readonly #now: () => Date

  constructor(
    readonly provider: ModelProvider,
    readonly sessions: SessionRepository,
    options: AgentRuntimeOptions = {},
  ) {
    this.#idFactory = options.idFactory ?? (() => globalThis.crypto.randomUUID())
    this.#now = options.now ?? (() => new Date())
  }

  async createSession(): Promise<AgentSession> {
    const session: AgentSession = {
      id: this.#idFactory(),
      createdAt: this.#now().toISOString(),
      messages: [],
    }
    await this.sessions.create(session)
    return cloneSession(session)
  }

  async getSession(id: string): Promise<AgentSession> {
    const session = await this.sessions.get(id)
    if (!session) {
      throw new SessionNotFoundError(id)
    }
    return session
  }

  async deleteSession(id: string): Promise<void> {
    if (this.#sessionOperations.has(id)) {
      throw new SessionBusyError(id)
    }
    this.#sessionOperations.set(id, 'deleting')
    try {
      await this.getSession(id)
      await this.sessions.delete(id)
    } finally {
      this.#sessionOperations.delete(id)
    }
  }

  async *runTurn(
    sessionId: string,
    message: string,
    requestSignal: AbortSignal,
  ): AsyncIterable<ModelDelta> {
    if (this.#sessionOperations.has(sessionId)) {
      throw new SessionBusyError(sessionId)
    }
    const turnController = new AbortController()
    this.#sessionOperations.set(sessionId, turnController)
    const signal = AbortSignal.any([requestSignal, turnController.signal])

    try {
      const session = await this.getSession(sessionId)
      signal.throwIfAborted()
      const input: AgentMessage = { role: 'user', content: message }
      let answer = ''
      for await (const delta of this.provider.stream([...session.messages, input], signal)) {
        if (delta.type === 'answer') {
          answer += delta.delta
        }
        yield delta
      }
      if (!answer) {
        throw new Error('Model completion did not contain a final answer')
      }
      session.messages.push(input, { role: 'assistant', content: answer })
      await this.sessions.save(session)
    } finally {
      this.#sessionOperations.delete(sessionId)
    }
  }

  cancelTurn(sessionId: string): boolean {
    const operation = this.#sessionOperations.get(sessionId)
    if (!(operation instanceof AbortController)) {
      return false
    }
    operation.abort()
    return true
  }
}

function cloneSession(session: AgentSession): AgentSession {
  return {
    ...session,
    messages: session.messages.map((message) => ({ ...message })),
  }
}
