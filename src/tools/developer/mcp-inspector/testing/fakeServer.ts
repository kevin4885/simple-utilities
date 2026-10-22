import { InMemoryTransport, SUPPORTED_PROTOCOL_VERSIONS, type JSONRPCMessage, type Transport } from '@modelcontextprotocol/client'
import { FIRST_MODERN_PROTOCOL_VERSION } from '../connection/types'

// A hand-written JSON-RPC responder behind an in-memory Transport, shared by every phase's tests.
// It is deliberately not built on the SDK server package: it answers exactly what the options say
// and nothing else, so a test can model a compliant OR a deliberately non-compliant server.

export interface FakeRpcError {
  code: number
  message: string
  data?: unknown
}

export type FakeOverride = { result: unknown } | { error: FakeRpcError } | 'no-response'

export interface FakeServerOptions {
  serverInfo?: { name: string; version: string; title?: string }
  /** Protocol version the server answers `initialize` with. Default: the version the client asked for. */
  protocolVersion?: string
  /** Session id exposed on the client transport AFTER `initialize` is answered (like a real HTTP server). */
  sessionId?: string
  capabilities?: Record<string, unknown>
  instructions?: string
  tools?: Record<string, unknown>[]
  /** Called for `tools/call`; the return value is the result. Throw a FakeRpcError-shaped object to fail. */
  toolHandlers?: Record<string, (args: Record<string, unknown>) => unknown | Promise<unknown>>
  resources?: Record<string, unknown>[]
  resourceTemplates?: Record<string, unknown>[]
  /** uri -> `contents` array returned by `resources/read`. */
  resourceContents?: Record<string, unknown[]>
  prompts?: Record<string, unknown>[]
  promptHandlers?: Record<string, (args: Record<string, string>) => unknown | Promise<unknown>>
  /** Items per page for the four list methods. Default: everything on one page. */
  pageSize?: number
  /** Delay before every response. */
  latencyMs?: number
  /** method -> JSON-RPC error answered instead of normal handling. */
  rejectMethods?: Record<string, FakeRpcError>
  /** Observe every request; return an override to replace the normal answer ('no-response' = never answer). */
  onRequest?: (req: { method: string; params: unknown; id: string | number }) => FakeOverride | void
}

export type FakeReply = { result: unknown } | { error: FakeRpcError }

export interface FakeServer {
  /** Hand this to the SDK Client (or wrap it in a transportFactory). */
  clientTransport: Transport & { sessionId?: string }
  /** Every message the client sent, in order, exactly as received. */
  received: JSONRPCMessage[]
  sendNotification(method: string, params?: unknown): Promise<void>
  /** Server-to-client request; resolves with the client's raw reply. */
  sendRequest(method: string, params?: unknown): Promise<FakeReply>
  close(): Promise<void>
}

// Revisions answered through the legacy `initialize` handshake (this fake does not speak the modern era).
const SUPPORTED = SUPPORTED_PROTOCOL_VERSIONS.filter((v) => v < FIRST_MODERN_PROTOCOL_VERSION)

function paginate<T>(items: T[], cursor: unknown, pageSize: number | undefined, key: string) {
  const start = typeof cursor === 'string' && cursor.startsWith('cursor-') ? Number(cursor.slice(7)) : 0
  if (!pageSize || pageSize <= 0) return { [key]: items.slice(start) }
  const end = start + pageSize
  return { [key]: items.slice(start, end), ...(end < items.length ? { nextCursor: `cursor-${end}` } : {}) }
}

function isRpcErrorLike(e: unknown): e is FakeRpcError {
  return typeof e === 'object' && e !== null && typeof (e as FakeRpcError).code === 'number' && typeof (e as FakeRpcError).message === 'string'
}

export function createFakeServer(options: FakeServerOptions = {}): FakeServer {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const received: JSONRPCMessage[] = []
  const pendingServerRequests = new Map<string | number, (reply: FakeReply) => void>()
  let nextServerRequestId = 1
  let closed = false
  let initialized = false
  Object.defineProperty(clientTransport, 'sessionId', {
    configurable: true,
    get: () => (initialized ? options.sessionId : undefined),
    set: () => undefined,
  })

  const capabilities =
    options.capabilities ??
    ({
      ...(options.tools ? { tools: { listChanged: true } } : {}),
      ...(options.resources || options.resourceTemplates ? { resources: { subscribe: true, listChanged: true } } : {}),
      ...(options.prompts ? { prompts: { listChanged: true } } : {}),
    } as Record<string, unknown>)

  async function handle(method: string, params: Record<string, unknown> | undefined): Promise<FakeReply> {
    switch (method) {
      case 'initialize': {
        const asked = typeof params?.protocolVersion === 'string' ? params.protocolVersion : undefined
        const protocolVersion = options.protocolVersion ?? (asked && SUPPORTED.includes(asked) ? asked : SUPPORTED[0])
        initialized = true
        return {
          result: {
            protocolVersion,
            capabilities,
            serverInfo: options.serverInfo ?? { name: 'fake-server', version: '1.0.0' },
            ...(options.instructions !== undefined ? { instructions: options.instructions } : {}),
          },
        }
      }
      case 'ping':
      case 'logging/setLevel':
      case 'resources/subscribe':
      case 'resources/unsubscribe':
        return { result: {} }
      case 'tools/list':
        return { result: paginate(options.tools ?? [], params?.cursor, options.pageSize, 'tools') }
      case 'resources/list':
        return { result: paginate(options.resources ?? [], params?.cursor, options.pageSize, 'resources') }
      case 'resources/templates/list':
        return { result: paginate(options.resourceTemplates ?? [], params?.cursor, options.pageSize, 'resourceTemplates') }
      case 'prompts/list':
        return { result: paginate(options.prompts ?? [], params?.cursor, options.pageSize, 'prompts') }
      case 'tools/call': {
        const name = typeof params?.name === 'string' ? params.name : ''
        const handler = options.toolHandlers?.[name]
        if (!handler) return { error: { code: -32602, message: `Unknown tool: ${name}` } }
        const args = (params?.arguments ?? {}) as Record<string, unknown>
        try {
          return { result: await handler(args) }
        } catch (e) {
          if (isRpcErrorLike(e)) return { error: e }
          return { error: { code: -32603, message: e instanceof Error ? e.message : String(e) } }
        }
      }
      case 'resources/read': {
        const uri = typeof params?.uri === 'string' ? params.uri : ''
        const contents = options.resourceContents?.[uri]
        if (!contents) return { error: { code: -32002, message: `Resource not found: ${uri}`, data: { uri } } }
        return { result: { contents } }
      }
      case 'prompts/get': {
        const name = typeof params?.name === 'string' ? params.name : ''
        const handler = options.promptHandlers?.[name]
        if (!handler) return { error: { code: -32602, message: `Unknown prompt: ${name}` } }
        try {
          return { result: await handler((params?.arguments ?? {}) as Record<string, string>) }
        } catch (e) {
          if (isRpcErrorLike(e)) return { error: e }
          return { error: { code: -32603, message: e instanceof Error ? e.message : String(e) } }
        }
      }
      case 'completion/complete':
        return { result: { completion: { values: [] } } }
      default:
        return { error: { code: -32601, message: `Method not found: ${method}` } }
    }
  }

  async function onClientMessage(message: JSONRPCMessage): Promise<void> {
    received.push(message)
    const m = message as { method?: string; id?: string | number; params?: unknown; result?: unknown; error?: FakeRpcError }

    if (m.method === undefined && m.id !== undefined) {
      // a response to a server-to-client request
      const resolve = pendingServerRequests.get(m.id)
      if (resolve) {
        pendingServerRequests.delete(m.id)
        resolve(m.error ? { error: m.error } : { result: m.result })
      }
      return
    }
    if (m.method === undefined || m.id === undefined) return // client notification: recorded only

    const method = m.method
    const id = m.id
    const params = m.params as Record<string, unknown> | undefined
    if (options.latencyMs) await new Promise((r) => setTimeout(r, options.latencyMs))
    if (closed) return

    const override = options.onRequest?.({ method, params, id })
    if (override === 'no-response') return

    let reply: FakeReply
    if (override) reply = override
    else if (options.rejectMethods?.[method]) reply = { error: options.rejectMethods[method] }
    else reply = await handle(method, params)

    if (closed) return
    const response =
      'error' in reply
        ? { jsonrpc: '2.0' as const, id, error: reply.error }
        : { jsonrpc: '2.0' as const, id, result: reply.result }
    await serverTransport.send(response as JSONRPCMessage).catch(() => undefined)
  }

  serverTransport.onmessage = (message) => {
    void onClientMessage(message)
  }
  void serverTransport.start()

  return {
    clientTransport,
    received,
    async sendNotification(method, params) {
      await serverTransport.send({ jsonrpc: '2.0', method, ...(params !== undefined ? { params } : {}) } as JSONRPCMessage)
    },
    sendRequest(method, params) {
      const id = `srv-${nextServerRequestId++}`
      return new Promise<FakeReply>((resolve, reject) => {
        pendingServerRequests.set(id, resolve)
        serverTransport
          .send({ jsonrpc: '2.0', id, method, ...(params !== undefined ? { params } : {}) } as JSONRPCMessage)
          .catch((e) => {
            pendingServerRequests.delete(id)
            reject(e)
          })
      })
    },
    async close() {
      closed = true
      await serverTransport.close().catch(() => undefined)
    },
  }
}
