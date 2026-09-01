import { open, stat } from 'node:fs/promises'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { extname, join, normalize, resolve, sep } from 'node:path'
import type { AddressInfo } from 'node:net'
import { pipeline } from 'node:stream/promises'
import {
  AgentRuntime,
  InMemorySessionRepository,
  SessionBusyError,
  SessionCapacityError,
  SessionNotFoundError,
  type ModelDelta,
} from '@kotik/agent'
import { DeepSeekProvider } from '@kotik/deepseek'
import { isRecord, type Session, type TurnStreamEvent } from '@kotik/protocol'

const MAX_REQUEST_SIZE = 64 << 10

export interface ApplicationServerOptions {
  runtime: AgentRuntime
  host?: string
  port?: number
  webRoot?: string
  accessToken?: string
  logger?: Pick<Console, 'error' | 'info'>
}

export interface RunningApplicationServer {
  url: string
  close(): Promise<void>
}

export function createRuntimeFromEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): AgentRuntime {
  const apiKey = environment.DEEPSEEK_API_KEY?.trim()
  if (!apiKey) {
    throw new Error('DEEPSEEK_API_KEY is not set')
  }
  return new AgentRuntime(
    new DeepSeekProvider({ apiKey }),
    new InMemorySessionRepository(),
  )
}

export async function startApplicationServer(
  options: ApplicationServerOptions,
): Promise<RunningApplicationServer> {
  const host = options.host ?? '127.0.0.1'
  if (!isLoopbackHost(host)) {
    throw new Error(`Listen host ${JSON.stringify(host)} must be a loopback host`)
  }

  const handler = createApplicationHandler(options)
  const server = createServer(handler)
  server.headersTimeout = 5_000
  server.requestTimeout = 30_000
  server.keepAliveTimeout = 60_000
  server.maxRequestsPerSocket = 100
  await new Promise<void>((resolveListening, reject) => {
    server.once('error', reject)
    server.listen(options.port ?? 0, host, () => {
      server.off('error', reject)
      resolveListening()
    })
  })

  const address = server.address() as AddressInfo
  const url = `http://${formatURLHost(address.address)}:${address.port}`
  return {
    url,
    close: () =>
      new Promise<void>((resolveClose, reject) => {
        server.close((error) => (error ? reject(error) : resolveClose()))
        server.closeAllConnections()
      }),
  }
}

export function createApplicationHandler(
  options: ApplicationServerOptions,
): (request: IncomingMessage, response: ServerResponse) => void {
  const logger = options.logger ?? console
  const ephemeralSessions = new EphemeralSessionTracker(options.runtime)
  return (request, response) => {
    void handleRequest(request, response, options, ephemeralSessions).catch((error: unknown) => {
      if (error instanceof HTTPError && !response.headersSent) {
        writeJSON(response, error.status, { error: error.message })
        return
      }
      logger.error('Unhandled application server error:', error)
      if (!response.headersSent) {
        writeJSON(response, 500, { error: 'Internal server error' })
      } else if (!response.writableEnded) {
        response.destroy()
      }
    })
  }
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  options: ApplicationServerOptions,
  ephemeralSessions: EphemeralSessionTracker,
): Promise<void> {
  const url = new URL(request.url ?? '/', 'http://localhost')

  if (url.pathname.startsWith('/api/')) {
    if (request.method === 'OPTIONS') {
      if (!authorizeOrigin(request, response)) {
        return
      }
      writeCorsPreflight(request, response)
      return
    }
    if (!authorizeAPIRequest(request, response, options.accessToken)) {
      return
    }
    applyCorsHeader(request, response)
    await handleAPIRequest(
      request,
      response,
      url.pathname,
      options.runtime,
      ephemeralSessions,
      options.logger ?? console,
    )
    return
  }

  await serveWeb(request, response, url.pathname, options.webRoot)
}

async function handleAPIRequest(
  request: IncomingMessage,
  response: ServerResponse,
  path: string,
  runtime: AgentRuntime,
  ephemeralSessions: EphemeralSessionTracker,
  logger: Pick<Console, 'error' | 'info'>,
): Promise<void> {
  if (path === '/api/health') {
    if (request.method !== 'GET') {
      writeMethodNotAllowed(response, ['GET'])
      return
    }
    writeJSON(response, 200, { status: 'ok' })
    return
  }

  if (path === '/api/sessions') {
    if (request.method !== 'POST') {
      writeMethodNotAllowed(response, ['POST'])
      return
    }
    requireJSONContentType(request)
    const body = await readJSONBody(request)
    if (
      !isRecord(body) ||
      Object.keys(body).some((key) => key !== 'ephemeral') ||
      (body.ephemeral !== undefined && typeof body.ephemeral !== 'boolean')
    ) {
      writeJSON(response, 400, { error: 'Request body may contain only an ephemeral boolean' })
      return
    }
    try {
      const session = await runtime.createSession()
      if (body.ephemeral === true) {
        ephemeralSessions.mark(session.id)
      }
      writeJSON(response, 201, { session: toProtocolSession(session) })
    } catch (error) {
      writeRuntimeError(response, error)
    }
    return
  }

  const sessionRoute = /^\/api\/sessions\/([^/]+)$/.exec(path)
  if (sessionRoute) {
    const sessionId = decodePathSegment(sessionRoute[1])
    if (request.method === 'DELETE') {
      ephemeralSessions.forget(sessionId)
      try {
        await runtime.deleteSession(sessionId)
        response.writeHead(204)
        response.end()
      } catch (error) {
        writeRuntimeError(response, error)
      }
      return
    }
    if (request.method !== 'GET') {
      writeMethodNotAllowed(response, ['GET', 'DELETE'])
      return
    }
    try {
      const session = await runtime.getSession(sessionId)
      writeJSON(response, 200, { session: toProtocolSession(session) })
    } catch (error) {
      writeRuntimeError(response, error)
    }
    return
  }

  const turnRoute = /^\/api\/sessions\/([^/]+)\/turns$/.exec(path)
  if (turnRoute) {
    if (request.method !== 'POST') {
      writeMethodNotAllowed(response, ['POST'])
      return
    }
    requireJSONContentType(request)
    const body = await readJSONBody(request)
    if (!isRecord(body) || Object.keys(body).length !== 1 || typeof body.message !== 'string') {
      writeJSON(response, 400, { error: 'Request body must contain only a message string' })
      return
    }
    const message = body.message.trim()
    if (!message) {
      writeJSON(response, 400, { error: 'message is required' })
      return
    }
    const sessionId = decodePathSegment(turnRoute[1])
    const ephemeral = ephemeralSessions.claim(sessionId)
    try {
      await streamTurn(request, response, runtime, sessionId, message, logger)
    } finally {
      if (ephemeral) {
        await ephemeralSessions.delete(sessionId)
      }
    }
    return
  }

  const cancelRoute = /^\/api\/sessions\/([^/]+)\/cancel$/.exec(path)
  if (cancelRoute) {
    if (request.method !== 'POST') {
      writeMethodNotAllowed(response, ['POST'])
      return
    }
    requireJSONContentType(request)
    const sessionId = decodePathSegment(cancelRoute[1])
    try {
      await runtime.getSession(sessionId)
      writeJSON(response, 200, { cancelled: runtime.cancelTurn(sessionId) })
    } catch (error) {
      writeRuntimeError(response, error)
    }
    return
  }

  writeJSON(response, 404, { error: 'Not found' })
}

async function streamTurn(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: AgentRuntime,
  sessionId: string,
  message: string,
  logger: Pick<Console, 'error' | 'info'>,
): Promise<void> {
  const requestController = new AbortController()
  const abortRequest = () => requestController.abort()
  const handleResponseClose = () => {
    if (!response.writableEnded) {
      abortRequest()
    }
  }
  const socket = request.socket
  request.once('aborted', abortRequest)
  response.once('close', handleResponseClose)
  socket.once('close', abortRequest)
  const removeAbortListeners = () => {
    request.off('aborted', abortRequest)
    response.off('close', handleResponseClose)
    socket.off('close', abortRequest)
  }
  if (request.aborted || (request.destroyed && !request.complete) || response.destroyed) {
    abortRequest()
  }

  try {
    await runtime.getSession(sessionId)
  } catch (error) {
    try {
      writeRuntimeError(response, error)
    } finally {
      removeAbortListeners()
    }
    return
  }

  if (requestController.signal.aborted) {
    removeAbortListeners()
    return
  }

  const iterator = runtime.runTurn(sessionId, message, requestController.signal)[Symbol.asyncIterator]()
  let started = false
  try {
    while (true) {
      const item = await iterator.next()
      if (item.done) {
        break
      }
      if (!started) {
        startEventStream(response)
        started = true
      }
      writeEvent(response, toProtocolEvent(item.value))
    }
    if (!started) {
      startEventStream(response)
    }
    writeEvent(response, { type: 'turn.completed' })
    response.end()
  } catch (error) {
    if (requestController.signal.aborted) {
      return
    }
    logger.error('Agent turn failed:', error)
    if (!started) {
      if (error instanceof SessionBusyError) {
        writeJSON(response, 409, { error: error.message })
      } else {
        writeJSON(response, 502, { error: 'Agent request failed' })
      }
      return
    }
    writeEvent(response, { type: 'turn.failed', message: 'Agent request failed' })
    response.end()
  } finally {
    try {
      await iterator.return?.()
    } finally {
      removeAbortListeners()
    }
  }
}

function toProtocolEvent(delta: ModelDelta): TurnStreamEvent {
  return delta.type === 'reasoning'
    ? { type: 'reasoning.delta', delta: delta.delta }
    : { type: 'answer.delta', delta: delta.delta }
}

function toProtocolSession(session: {
  id: string
  createdAt: string
  messages: Array<{ role: 'user' | 'assistant'; content: string }>
}): Session {
  return {
    id: session.id,
    createdAt: session.createdAt,
    messages: session.messages.map((message) => ({ ...message })),
  }
}

function startEventStream(response: ServerResponse): void {
  response.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  })
  response.flushHeaders()
}

function writeEvent(response: ServerResponse, event: TurnStreamEvent): void {
  response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
}

function authorizeAPIRequest(
  request: IncomingMessage,
  response: ServerResponse,
  accessToken?: string,
): boolean {
  if (!authorizeOrigin(request, response)) {
    return false
  }
  if (accessToken && request.headers.authorization !== `Bearer ${accessToken}`) {
    writeJSON(response, 401, { error: 'Invalid application access token' })
    return false
  }
  return true
}

function authorizeOrigin(request: IncomingMessage, response: ServerResponse): boolean {
  const origin = request.headers.origin
  if (request.headers['sec-fetch-site'] === 'cross-site' || (origin && !isLoopbackOrigin(origin))) {
    writeJSON(response, 403, { error: 'Request origin must be local' })
    return false
  }
  return true
}

function applyCorsHeader(request: IncomingMessage, response: ServerResponse): void {
  if (request.headers.origin && isLoopbackOrigin(request.headers.origin)) {
    response.setHeader('Access-Control-Allow-Origin', request.headers.origin)
    response.setHeader('Vary', 'Origin')
  }
}

function writeCorsPreflight(request: IncomingMessage, response: ServerResponse): void {
  applyCorsHeader(request, response)
  response.writeHead(204, {
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '600',
  })
  response.end()
}

function requireJSONContentType(request: IncomingMessage): void {
  const contentType = request.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase()
  if (contentType !== 'application/json') {
    throw new HTTPError(415, 'Content-Type must be application/json')
  }
}

async function readJSONBody(request: IncomingMessage): Promise<unknown> {
  let size = 0
  const chunks: Buffer[] = []
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > MAX_REQUEST_SIZE) {
      throw new HTTPError(413, 'Request body is too large')
    }
    chunks.push(buffer)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch (error) {
    throw new HTTPError(400, 'Request body must be valid JSON', { cause: error })
  }
}

async function serveWeb(
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
  webRoot?: string,
): Promise<void> {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    writeMethodNotAllowed(response, ['GET', 'HEAD'])
    return
  }
  if (!webRoot) {
    writeJSON(response, 404, { error: 'Web application is not available in development server mode' })
    return
  }

  const root = resolve(webRoot)
  const relativePath = normalize(decodePath(pathname)).replace(/^[/\\]+/, '')
  const candidate = resolve(root, relativePath || 'index.html')
  const safeCandidate = candidate === root || candidate.startsWith(`${root}${sep}`)
  const filePath = safeCandidate && (await isFile(candidate)) ? candidate : join(root, 'index.html')

  let file
  try {
    file = await open(filePath, 'r')
  } catch {
    writeJSON(response, 404, { error: 'Web application has not been built' })
    return
  }

  const headers = {
    'Content-Type': contentTypeFor(filePath),
    'Content-Security-Policy':
      "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
  }
  if (request.method === 'HEAD') {
    await file.close()
    response.writeHead(200, headers)
    response.end()
    return
  }
  response.writeHead(200, headers)
  await pipeline(file.createReadStream(), response)
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}

function contentTypeFor(path: string): string {
  const types: Record<string, string> = {
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
  }
  return types[extname(path)] ?? 'application/octet-stream'
}

function writeRuntimeError(response: ServerResponse, error: unknown): void {
  if (error instanceof SessionNotFoundError) {
    writeJSON(response, 404, { error: error.message })
  } else if (error instanceof SessionBusyError) {
    writeJSON(response, 409, { error: error.message })
  } else if (error instanceof SessionCapacityError) {
    writeJSON(response, 503, { error: error.message })
  } else {
    throw error
  }
}

function writeJSON(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  response.end(`${JSON.stringify(body)}\n`)
}

function writeMethodNotAllowed(response: ServerResponse, methods: string[]): void {
  response.setHeader('Allow', methods.join(', '))
  writeJSON(response, 405, { error: 'Method not allowed' })
}

function isLoopbackOrigin(origin: string): boolean {
  try {
    return isLoopbackHost(new URL(origin).hostname)
  } catch {
    return false
  }
}

function isLoopbackHost(host: string): boolean {
  return host === 'localhost' || host === '127.0.0.1' || host === '::1'
}

function formatURLHost(host: string): string {
  return host.includes(':') ? `[${host}]` : host
}

function decodePathSegment(segment: string): string {
  try {
    return decodeURIComponent(segment)
  } catch (error) {
    throw new HTTPError(400, 'Request path contains invalid percent encoding', { cause: error })
  }
}

function decodePath(path: string): string {
  return path
    .split('/')
    .map((segment) => decodePathSegment(segment))
    .join('/')
}

class HTTPError extends Error {
  constructor(
    readonly status: number,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'HTTPError'
  }
}

class EphemeralSessionTracker {
  static readonly cleanupDelayMs = 10 * 60_000
  readonly #timers = new Map<string, NodeJS.Timeout>()

  constructor(readonly runtime: AgentRuntime) {}

  mark(sessionId: string, delay = EphemeralSessionTracker.cleanupDelayMs): void {
    this.forget(sessionId)
    const timer = setTimeout(() => void this.delete(sessionId), delay)
    timer.unref()
    this.#timers.set(sessionId, timer)
  }

  claim(sessionId: string): boolean {
    const marked = this.#timers.has(sessionId)
    this.forget(sessionId)
    return marked
  }

  forget(sessionId: string): void {
    const timer = this.#timers.get(sessionId)
    if (timer) {
      clearTimeout(timer)
      this.#timers.delete(sessionId)
    }
  }

  async delete(sessionId: string): Promise<void> {
    this.forget(sessionId)
    try {
      await this.runtime.deleteSession(sessionId)
    } catch (error) {
      if (error instanceof SessionBusyError) {
        this.mark(sessionId, 1_000)
      } else if (!(error instanceof SessionNotFoundError)) {
        throw error
      }
    }
  }
}
