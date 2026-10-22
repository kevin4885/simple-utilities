import type { JSONRPCMessage, MessageExtraInfo, Transport, TransportSendOptions } from '@modelcontextprotocol/client'
import { errorMessage, redactHeaders, redactUrl, scrubSecrets } from './logic'
import type { LogEntryInput } from './types'

// The two log taps. Both are thin decorators: they forward everything unmodified and
// only report what passed through. Credential redaction happens HERE so that an
// unredacted secret can never reach `onLog`.

// ---------------------------------------------------------------------------
// HTTP tap (wraps `fetch`)
// ---------------------------------------------------------------------------

export interface FetchTapOptions {
  fetch: typeof fetch
  onLog: (e: LogEntryInput) => void
  now: () => number
  /** Header names (any case) whose values are always redacted, in addition to isSecretHeaderName. */
  secretHeaderNames?: string[]
  /** Literal secret strings scrubbed out of error text. */
  secretFragments?: string[]
  /**
   * Custom (user-configured) header names. They are removed from requests that leave the
   * MCP server's origin (OAuth discovery / token endpoints), so credentials typed for the
   * server are never sent to a third-party authorization server.
   */
  originGuard?: { origin: string; headerNames: string[] }
}

function headersToRecord(h: HeadersInit | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  if (!h) return out
  // Duck-typed: Headers may come from a different realm than the global (jsdom vs undici).
  if (typeof (h as Headers).forEach === 'function' && !Array.isArray(h)) {
    ;(h as Headers).forEach((value, name) => {
      out[name] = value
    })
  } else if (Array.isArray(h)) {
    for (const [name, value] of h) out[name] = value
  } else {
    for (const [name, value] of Object.entries(h as Record<string, string>)) out[name] = String(value)
  }
  return out
}

function responseHeadersToRecord(res: Response): Record<string, string> | null {
  const h = res.headers as Headers | undefined
  if (!h || typeof h.forEach !== 'function') return null
  const out: Record<string, string> = {}
  h.forEach((value, name) => {
    out[name] = value
  })
  return out
}

function requestInputHeaders(input: RequestInfo | URL): Headers | undefined {
  return typeof Request !== 'undefined' && input instanceof Request ? input.headers : undefined
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.href
  return input.url
}

function requestMethod(input: RequestInfo | URL, init: RequestInit | undefined): string {
  if (init?.method) return init.method.toUpperCase()
  if (typeof Request !== 'undefined' && input instanceof Request) return input.method.toUpperCase()
  return 'GET'
}

export function createFetchTap(o: FetchTapOptions): typeof fetch {
  const secretNames = o.secretHeaderNames ?? []
  const fragments = o.secretFragments ?? []
  const guardNames = new Set((o.originGuard?.headerNames ?? []).map((n) => n.toLowerCase()))

  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = requestUrl(input)
    const method = requestMethod(input, init)
    let sendInput = input
    let sendInit = init

    if (o.originGuard && guardNames.size > 0) {
      let origin: string | null = null
      try {
        origin = new URL(url).origin
      } catch {
        origin = null
      }
      if (origin !== o.originGuard.origin) {
        const strip = (h: HeadersInit | undefined) => {
          const kept: Record<string, string> = {}
          for (const [name, value] of Object.entries(headersToRecord(h))) {
            if (!guardNames.has(name.toLowerCase())) kept[name] = value
          }
          return kept
        }
        if (init?.headers) sendInit = { ...init, headers: strip(init.headers) }
        // A Request object carries its own headers; rebuild it without the guarded ones.
        if (typeof Request !== 'undefined' && input instanceof Request) {
          sendInput = new Request(input, { headers: strip(input.headers) })
        }
      }
    }

    const requestHeaders = redactHeaders(headersToRecord(sendInit?.headers ?? requestInputHeaders(sendInput)), secretNames)
    const loggedUrl = scrubSecrets(redactUrl(url), fragments)
    const start = o.now()
    try {
      const response = await o.fetch(sendInput, sendInit)
      o.onLog({
        ts: o.now(),
        kind: 'http',
        method,
        url: loggedUrl,
        status: response.status,
        requestHeaders,
        responseHeaders: redactResponseHeaders(response, secretNames),
        durationMs: Math.max(0, Math.round(o.now() - start)),
        error: null,
      })
      return response
    } catch (e) {
      o.onLog({
        ts: o.now(),
        kind: 'http',
        method,
        url: loggedUrl,
        status: null,
        requestHeaders,
        responseHeaders: null,
        durationMs: Math.max(0, Math.round(o.now() - start)),
        error: scrubSecrets(errorMessage(e), fragments),
      })
      throw e
    }
  }
}

function redactResponseHeaders(res: Response, secretNames: string[]): Record<string, string> | null {
  const raw = responseHeadersToRecord(res)
  return raw ? redactHeaders(raw, secretNames) : null
}

// ---------------------------------------------------------------------------
// JSON-RPC tap (decorator Transport)
// ---------------------------------------------------------------------------

export interface RpcTapOptions {
  onLog: (e: LogEntryInput) => void
  now: () => number
  /** Called for every inbound message AFTER the SDK handler has been given it. Errors are swallowed. */
  onInbound?: (message: JSONRPCMessage) => void
}

function describe(message: JSONRPCMessage): {
  method: string | null
  rpcId: string | number | null
  isResponse: boolean
  isRequest: boolean
} {
  const m = message as { method?: unknown; id?: unknown }
  const method = typeof m.method === 'string' ? m.method : null
  const id = typeof m.id === 'string' || typeof m.id === 'number' ? m.id : null
  return { method, rpcId: id, isResponse: method === null && id !== null, isRequest: method !== null && id !== null }
}

export class TappedTransport implements Transport {
  private onmessageHandler: Transport['onmessage']
  private oncloseHandler: Transport['onclose']
  private onerrorHandler: Transport['onerror']
  /** Outbound client requests awaiting a response: id -> send timestamp. */
  private readonly pending = new Map<string | number, number>()

  constructor(
    readonly inner: Transport,
    private readonly opts: RpcTapOptions,
  ) {
    inner.onmessage = (message, extra) => this.handleInbound(message, extra)
    inner.onclose = () => this.oncloseHandler?.()
    inner.onerror = (error) => this.onerrorHandler?.(error)
  }

  get onmessage(): Transport['onmessage'] {
    return this.onmessageHandler
  }
  set onmessage(handler: Transport['onmessage']) {
    this.onmessageHandler = handler
  }
  get onclose(): Transport['onclose'] {
    return this.oncloseHandler
  }
  set onclose(handler: Transport['onclose']) {
    this.oncloseHandler = handler
  }
  get onerror(): Transport['onerror'] {
    return this.onerrorHandler
  }
  set onerror(handler: Transport['onerror']) {
    this.onerrorHandler = handler
  }

  get sessionId(): string | undefined {
    return this.inner.sessionId
  }
  get hasPerRequestStream(): boolean | undefined {
    return this.inner.hasPerRequestStream
  }

  setProtocolVersion(version: string): void {
    this.inner.setProtocolVersion?.(version)
  }
  setSupportedProtocolVersions(versions: string[]): void {
    this.inner.setSupportedProtocolVersions?.(versions)
  }

  start(): Promise<void> {
    return this.inner.start()
  }

  close(): Promise<void> {
    return this.inner.close()
  }

  async send(message: JSONRPCMessage, options?: TransportSendOptions): Promise<void> {
    const d = describe(message)
    if (d.isRequest && d.rpcId !== null) this.pending.set(d.rpcId, this.opts.now())
    this.opts.onLog({
      ts: this.opts.now(),
      kind: 'rpc',
      direction: 'out',
      message,
      method: d.method,
      rpcId: d.rpcId,
      durationMs: null,
    })
    try {
      await this.inner.send(message, options)
    } catch (e) {
      if (d.rpcId !== null) this.pending.delete(d.rpcId)
      throw e
    }
  }

  private handleInbound(message: JSONRPCMessage, extra?: MessageExtraInfo): void {
    const d = describe(message)
    let durationMs: number | null = null
    if (d.isResponse && d.rpcId !== null) {
      const startedAt = this.pending.get(d.rpcId)
      if (startedAt !== undefined) {
        durationMs = Math.max(0, Math.round(this.opts.now() - startedAt))
        this.pending.delete(d.rpcId)
      }
    }
    this.opts.onLog({
      ts: this.opts.now(),
      kind: 'rpc',
      direction: 'in',
      message,
      method: d.method,
      rpcId: d.rpcId,
      durationMs,
    })
    try {
      this.onmessageHandler?.(message, extra)
    } finally {
      try {
        this.opts.onInbound?.(message)
      } catch {
        // observers must never break message delivery
      }
    }
  }
}
