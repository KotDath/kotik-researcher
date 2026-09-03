import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  AgentRuntime,
  InMemorySessionRepository,
  type AgentSession,
  type ModelProvider,
  type SessionRepository,
} from '@kotik/agent'
import { startApplicationServer, type RunningApplicationServer } from './index.ts'

let server: RunningApplicationServer | undefined

afterEach(async () => {
  await server?.close()
  server = undefined
})

describe('application server', () => {
  it('creates a session, streams a turn, and exposes saved history', async () => {
    server = await startApplicationServer({ runtime: createRuntime() })

    const createResponse = await step('create session', fetch(`${server.url}/api/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
      signal: AbortSignal.timeout(1_000),
    }))
    expect(createResponse.status).toBe(201)
    const created = (await createResponse.json()) as { session: { id: string } }

    const turnResponse = await step('start turn', fetch(`${server.url}/api/sessions/${created.session.id}/turns`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: '  question  ' }),
      signal: AbortSignal.timeout(1_000),
    }))
    expect(turnResponse.status).toBe(200)
    expect(await turnResponse.text()).toContain(
      'event: answer.delta\ndata: {"type":"answer.delta","delta":"answer"}',
    )

    const sessionResponse = await fetch(`${server.url}/api/sessions/${created.session.id}`)
    await expect(sessionResponse.json()).resolves.toMatchObject({
      session: {
        messages: [
          { role: 'user', content: 'question' },
          { role: 'assistant', content: 'answer' },
        ],
      },
    })

    const deleteResponse = await fetch(`${server.url}/api/sessions/${created.session.id}`, {
      method: 'DELETE',
    })
    expect(deleteResponse.status).toBe(204)
    expect((await fetch(`${server.url}/api/sessions/${created.session.id}`)).status).toBe(404)
  })

  it('enforces local origins and a configured Electron access token', async () => {
    server = await startApplicationServer({ runtime: createRuntime(), accessToken: 'secret' })

    const unauthorized = await fetch(`${server.url}/api/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    })
    expect(unauthorized.status).toBe(401)

    const remoteOrigin = await fetch(`${server.url}/api/sessions`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer secret',
        'Content-Type': 'application/json',
        Origin: 'https://example.com',
      },
      body: '{}',
    })
    expect(remoteOrigin.status).toBe(403)

    const authorized = await fetch(`${server.url}/api/sessions`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer secret',
        'Content-Type': 'application/json',
        Origin: 'http://127.0.0.1:5173',
      },
      body: '{}',
    })
    expect(authorized.status).toBe(201)
    expect(authorized.headers.get('Access-Control-Allow-Origin')).toBe('http://127.0.0.1:5173')

    const preflight = await fetch(`${server.url}/api/sessions/session-1`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://127.0.0.1:5173',
        'Access-Control-Request-Method': 'DELETE',
      },
    })
    expect(preflight.status).toBe(204)
    expect(preflight.headers.get('Access-Control-Allow-Methods')).toContain('DELETE')
  })

  it('serves built assets with SPA fallback', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'kotik-web-'))
    await writeFile(join(directory, 'index.html'), '<title>kotik-researcher</title>')
    try {
      server = await startApplicationServer({ runtime: createRuntime(), webRoot: directory })
      const response = await fetch(`${server.url}/research/session`)
      expect(response.status).toBe(200)
      expect(await response.text()).toContain('<title>kotik-researcher</title>')
      expect(response.headers.get('Content-Security-Policy')).toContain("default-src 'self'")
    } finally {
      await server?.close()
      server = undefined
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('reports malformed paths as bad requests', async () => {
    server = await startApplicationServer({ runtime: createRuntime() })
    const response = await fetch(`${server.url}/api/sessions/%E0%A4%A`)
    expect(response.status).toBe(400)
  })

  it('deletes ephemeral sessions after their turn', async () => {
    server = await startApplicationServer({ runtime: createRuntime() })
    const created = (await (
      await fetch(`${server.url}/api/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ephemeral: true }),
      })
    ).json()) as { session: { id: string } }

    const turn = await fetch(`${server.url}/api/sessions/${created.session.id}/turns`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'question' }),
    })
    expect(turn.status).toBe(200)
    await turn.text()
    expect((await fetch(`${server.url}/api/sessions/${created.session.id}`)).status).toBe(404)
  })

  it('does not start a provider after disconnecting during session lookup', async () => {
    const repository = new DelayedSessionRepository()
    let providerStarted = false
    const provider: ModelProvider = {
      async *stream() {
        providerStarted = true
        yield { type: 'answer', delta: 'answer' }
      },
    }
    const runtime = new AgentRuntime(provider, repository, { idFactory: () => 'session-1' })
    server = await startApplicationServer({ runtime })
    await fetch(`${server.url}/api/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    })

    const lookup = repository.delayNextGet()
    const controller = new AbortController()
    const turn = fetch(`${server.url}/api/sessions/session-1/turns`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'question' }),
      signal: controller.signal,
    })
    const turnError = turn.then(
      () => undefined,
      (error: unknown) => error,
    )
    await lookup.started
    controller.abort()
    await new Promise((resolve) => setTimeout(resolve, 10))
    lookup.release()
    await expect(turnError).resolves.toHaveProperty('name', 'AbortError')
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(providerStarted).toBe(false)
  })
})

function createRuntime(): AgentRuntime {
  const provider: ModelProvider = {
    async *stream() {
      yield { type: 'reasoning', delta: 'thinking' }
      yield { type: 'answer', delta: 'answer' }
    },
  }
  return new AgentRuntime(provider, new InMemorySessionRepository(), {
    idFactory: () => 'session-1',
  })
}

async function step<T>(name: string, promise: Promise<T>): Promise<T> {
  try {
    return await promise
  } catch (error) {
    throw new Error(`${name} failed`, { cause: error })
  }
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
