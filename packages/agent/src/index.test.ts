import { describe, expect, it } from 'vitest'
import {
  AgentRuntime,
  InMemorySessionRepository,
  SessionBusyError,
  SessionCapacityError,
  type AgentSession,
  type AgentMessage,
  type ModelDelta,
  type ModelProvider,
  type SessionRepository,
} from './index.ts'

describe('AgentRuntime', () => {
  it('persists a completed turn and supplies history to the provider', async () => {
    const receivedMessages: AgentMessage[][] = []
    const provider: ModelProvider = {
      async *stream(messages) {
        receivedMessages.push(messages.map((message) => ({ ...message })))
        yield { type: 'reasoning', delta: 'think' }
        yield { type: 'answer', delta: 'answer' }
      },
    }
    const runtime = new AgentRuntime(provider, new InMemorySessionRepository(), {
      idFactory: () => 'session-1',
      now: () => new Date('2026-09-01T12:00:00.000Z'),
    })

    const session = await runtime.createSession()
    const events = await collect(runtime.runTurn(session.id, 'question', new AbortController().signal))

    expect(events).toEqual([
      { type: 'reasoning', delta: 'think' },
      { type: 'answer', delta: 'answer' },
    ])
    expect(receivedMessages).toEqual([[{ role: 'user', content: 'question' }]])
    await expect(runtime.getSession(session.id)).resolves.toMatchObject({
      messages: [
        { role: 'user', content: 'question' },
        { role: 'assistant', content: 'answer' },
      ],
    })
  })

  it('rejects concurrent turns and can cancel the active turn', async () => {
    let markProviderStarted: (() => void) | undefined
    const providerStarted = new Promise<void>((resolve) => {
      markProviderStarted = resolve
    })
    const provider: ModelProvider = {
      async *stream(_messages, signal) {
        markProviderStarted?.()
        await new Promise<void>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true })
        })
        yield { type: 'answer', delta: 'unreachable' }
      },
    }
    const runtime = new AgentRuntime(provider, new InMemorySessionRepository(), {
      idFactory: () => 'session-1',
    })
    const session = await runtime.createSession()
    const firstTurn = runtime
      .runTurn(session.id, 'first', new AbortController().signal)
      [Symbol.asyncIterator]()
    const firstResult = firstTurn.next()
    await providerStarted

    await expect(
      runtime
        .runTurn(session.id, 'second', new AbortController().signal)
        [Symbol.asyncIterator]()
        .next(),
    ).rejects.toBeInstanceOf(SessionBusyError)
    expect(runtime.cancelTurn(session.id)).toBe(true)
    await expect(firstResult).rejects.toBeDefined()
    expect(runtime.cancelTurn(session.id)).toBe(false)
  })

  it('does not persist an incomplete turn', async () => {
    const provider: ModelProvider = {
      async *stream() {
        yield { type: 'reasoning', delta: 'partial' }
        throw new Error('upstream failed')
      },
    }
    const runtime = new AgentRuntime(provider, new InMemorySessionRepository(), {
      idFactory: () => 'session-1',
    })
    const session = await runtime.createSession()

    await expect(
      collect(runtime.runTurn(session.id, 'question', new AbortController().signal)),
    ).rejects.toThrow('upstream failed')
    await expect(runtime.getSession(session.id)).resolves.toMatchObject({ messages: [] })
  })

  it('deletes completed sessions and rejects excess in-memory retention', async () => {
    const provider: ModelProvider = {
      async *stream() {
        yield { type: 'answer', delta: 'answer' }
      },
    }
    const repository = new InMemorySessionRepository(1)
    let nextId = 0
    const runtime = new AgentRuntime(provider, repository, {
      idFactory: () => `session-${++nextId}`,
    })

    const first = await runtime.createSession()
    await expect(runtime.createSession()).rejects.toBeInstanceOf(SessionCapacityError)
    await runtime.deleteSession(first.id)
    const second = await runtime.createSession()
    await runtime.deleteSession(second.id)
    await expect(runtime.getSession(second.id)).rejects.toThrow('was not found')
  })

  it('serializes turn startup and session deletion', async () => {
    const repository = new DelayedSessionRepository()
    const provider: ModelProvider = {
      async *stream() {
        yield { type: 'answer', delta: 'answer' }
      },
    }
    const runtime = new AgentRuntime(provider, repository, { idFactory: () => 'session-1' })
    const session = await runtime.createSession()
    const lookup = repository.delayNextGet()
    const turn = runtime
      .runTurn(session.id, 'question', new AbortController().signal)
      [Symbol.asyncIterator]()
    const turnResult = turn.next()
    await lookup.started

    await expect(runtime.deleteSession(session.id)).rejects.toBeInstanceOf(SessionBusyError)
    lookup.release()
    await expect(turnResult).resolves.toEqual({
      done: false,
      value: { type: 'answer', delta: 'answer' },
    })
    await turn.next()
    await runtime.deleteSession(session.id)
    await expect(runtime.getSession(session.id)).rejects.toThrow('was not found')
  })
})

async function collect(iterable: AsyncIterable<ModelDelta>): Promise<ModelDelta[]> {
  const values: ModelDelta[] = []
  for await (const value of iterable) {
    values.push(value)
  }
  return values
}

class DelayedSessionRepository implements SessionRepository {
  readonly #repository = new InMemorySessionRepository()
  #nextGet:
    | {
        started: () => void
        wait: Promise<void>
      }
    | undefined

  delayNextGet(): { started: Promise<void>; release(): void } {
    let markStarted: (() => void) | undefined
    let release: (() => void) | undefined
    const started = new Promise<void>((resolve) => {
      markStarted = resolve
    })
    const wait = new Promise<void>((resolve) => {
      release = resolve
    })
    this.#nextGet = { started: () => markStarted?.(), wait }
    return { started, release: () => release?.() }
  }

  create(session: AgentSession): Promise<void> {
    return this.#repository.create(session)
  }

  async get(id: string): Promise<AgentSession | undefined> {
    const delayed = this.#nextGet
    this.#nextGet = undefined
    if (delayed) {
      delayed.started()
      await delayed.wait
    }
    return this.#repository.get(id)
  }

  save(session: AgentSession): Promise<void> {
    return this.#repository.save(session)
  }

  delete(id: string): Promise<void> {
    return this.#repository.delete(id)
  }
}
