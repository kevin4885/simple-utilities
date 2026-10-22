import {
  Client,
  type OAuthClientProvider,
  ProtocolError,
  SdkError,
  SdkErrorCode,
  SSEClientTransport,
  StreamableHTTPClientTransport,
  type JSONRPCMessage,
  type StandardSchemaV1,
  type Transport,
} from '@modelcontextprotocol/client'
import {
  addFragments,
  classifyConnectionError,
  errorMessage,
  getHttpStatus,
  isUnauthorizedError,
  redactUrl,
  scrubSecrets,
  secretFragments,
  validateServerUrl,
  withSecretCapture,
} from './logic'
import { createFetchTap, TappedTransport } from './tap'
import {
  FIRST_MODERN_PROTOCOL_VERSION,
  type Diagnosis,
  LogEntryInput,
  RawResult,
  ServerSummary,
  SessionOptions,
  SessionState,
  TransportKind,
} from './types'

const CLIENT_INFO = { name: 'Simple Utilities MCP Inspector', version: '1.0.0' }
const DEFAULT_RAW_TIMEOUT_MS = 60000
/** Upper bound for the session-terminating DELETE on disconnect; a server that never answers must not pin the session. */
const TERMINATE_TIMEOUT_MS = 3000
/** `transport: 'auto'` falls back to legacy SSE only for these HTTP statuses (never 401/403/5xx). */
const SSE_FALLBACK_STATUSES = [400, 404, 405]

/** Accepts any result: raw requests must show whatever the server sent, not what a schema allows. */
const ANY_RESULT: StandardSchemaV1<unknown, unknown> = {
  '~standard': { version: 1, vendor: 'simple-utilities-mcp-inspector', validate: (value) => ({ value }) },
}

type LiveTransport = Transport & {
  terminateSession?: () => Promise<void>
  finishAuth?: (code: string, iss?: string) => Promise<void>
}

interface Attempt {
  client: Client
  inner: LiveTransport
  kind: TransportKind
}

type TransportFactoryCtx = Parameters<NonNullable<SessionOptions['transportFactory']>>[1]

function defaultTransportFactory(kind: TransportKind, ctx: TransportFactoryCtx): Transport {
  const requestInit: RequestInit = { headers: ctx.headers }
  if (kind === 'sse') {
    return new SSEClientTransport(ctx.url, { requestInit, fetch: ctx.fetch, authProvider: ctx.authProvider })
  }
  return new StreamableHTTPClientTransport(ctx.url, { requestInit, fetch: ctx.fetch, authProvider: ctx.authProvider })
}

class ConnectCancelled extends Error {
  constructor() {
    super('Connection cancelled')
    this.name = 'ConnectCancelled'
  }
}

/** One connect() attempt: an abort signal plus the closer of the transport currently being set up. */
class ConnectRun {
  private readonly controller = new AbortController()
  closer: (() => Promise<void>) | null = null
  get signal(): AbortSignal {
    return this.controller.signal
  }
  abort(): void {
    this.controller.abort()
  }
  /** Rejects with ConnectCancelled when aborted (already-aborted included). Always safe to race. */
  cancelled(): Promise<never> {
    return new Promise<never>((_, reject) => {
      if (this.signal.aborted) return reject(new ConnectCancelled())
      this.signal.addEventListener('abort', () => reject(new ConnectCancelled()), { once: true })
    })
  }
}

export function createSession(opts: SessionOptions): McpSession {
  return new McpSession(opts)
}

export class McpSession {
  private state: SessionState = { status: 'disconnected' }
  private liveClient: Client | null = null
  private liveInner: LiveTransport | null = null
  /** Transport kept after an auth-required failure so finishAuth() can complete the flow on it. */
  private authTransport: LiveTransport | null = null
  private lastInner: LiveTransport | null = null
  /** The connect() in flight. disconnect() aborts it; every await in doConnect/attempt races against it. */
  private run: ConnectRun | null = null
  private connecting: Promise<SessionState> | null = null
  private disconnecting: Promise<void> | null = null
  private readonly notificationObservers = new Map<string, Set<(params: unknown) => void>>()
  private readonly now: () => number
  /**
   * Literal secrets scrubbed from everything this session logs or reports. Starts with the configured
   * header values and GROWS at runtime with OAuth credentials (tokens, client secret, code, verifier);
   * the HTTP tap holds this same array, so additions apply to it immediately.
   */
  private readonly fragments: string[]
  /** The caller's OAuth provider wrapped so credentials passing through it join the fragments list. */
  private readonly authProvider: OAuthClientProvider | undefined

  constructor(private readonly opts: SessionOptions) {
    this.now = opts.now ?? Date.now
    // ConnectionConfig carries no per-header "secret" flag, so every configured value is scrubbed.
    this.fragments = secretFragments(opts.config.headers, true)
    this.authProvider = opts.authProvider
      ? withSecretCapture(opts.authProvider, (found) => addFragments(this.fragments, found))
      : undefined
  }

  getState(): SessionState {
    return this.state
  }

  get client(): Client {
    if (this.state.status !== 'connected' || !this.liveClient) throw new Error('not connected')
    return this.liveClient
  }

  // -------------------------------------------------------------------------
  // connect / disconnect
  // -------------------------------------------------------------------------

  connect(): Promise<SessionState> {
    if (this.connecting) return this.connecting
    const run = new ConnectRun()
    this.run = run
    const p = this.doConnect(run).finally(() => {
      if (this.connecting === p) this.connecting = null
      if (this.run === run) this.run = null
    })
    this.connecting = p
    return p
  }

  private async doConnect(run: ConnectRun): Promise<SessionState> {
    // Serialise behind a disconnect() that is still terminating the previous session.
    if (this.disconnecting) await this.disconnecting.catch(() => undefined)
    if (run.signal.aborted) return { status: 'disconnected' }
    try {
      await this.teardown()
    } catch {
      // teardown never needs to block a new connection
    }
    if (run.signal.aborted) return { status: 'disconnected' }
    this.authTransport = null
    this.setState({ status: 'connecting' })

    const cfg = this.opts.config
    const check = validateServerUrl(cfg.url)
    if (!check.ok) {
      return this.fail(run, undefined, {
        code: 'unknown',
        title: 'Invalid server URL',
        detail: check.reason,
        hints: [],
        httpStatus: null,
      })
    }

    const kinds: TransportKind[] = cfg.transport === 'auto' ? ['streamable-http', 'sse'] : [cfg.transport]
    this.event('info', `Connecting to ${this.safe(redactUrl(check.url))} (${cfg.transport})`)

    let lastError: unknown
    let live: Attempt | null = null
    for (let i = 0; i < kinds.length && !run.signal.aborted; i++) {
      try {
        live = await this.attempt(run, kinds[i], check.url)
        break
      } catch (e) {
        lastError = e
        if (run.signal.aborted) break
        const status = getHttpStatus(e)
        if (cfg.transport === 'auto' && i === 0 && status !== null && SSE_FALLBACK_STATUSES.includes(status)) {
          this.event('warn', `Streamable HTTP failed (${status}); falling back to legacy HTTP+SSE`)
          continue
        }
        break
      }
    }

    if (run.signal.aborted) {
      // disconnect() happened while we were connecting: release whatever was built and stay silent.
      if (live) {
        await live.client.close().catch(() => undefined)
        this.disposeSetup()
      }
      return { status: 'disconnected' }
    }

    if (!live) {
      if (isUnauthorizedError(lastError)) {
        this.authTransport = this.lastInner
        this.event('info', 'Authorization required')
        return this.setState({ status: 'auth-required' })
      }
      return this.fail(run, lastError)
    }

    this.liveClient = live.client
    this.liveInner = live.inner
    live.client.onclose = () => this.handleUnexpectedClose(live.client)
    const info = this.buildSummary(live)
    this.event('info', `Connected to ${info.serverName} ${info.serverVersion} (protocol ${info.protocolVersion}, ${info.transport})`)
    return this.setState({ status: 'connected', info })
  }

  private async attempt(run: ConnectRun, kind: TransportKind, url: string): Promise<Attempt> {
    if (run.signal.aborted) throw new ConnectCancelled()
    const cfg = this.opts.config
    const baseFetch: typeof fetch = this.opts.fetchImpl ?? ((input, init) => globalThis.fetch(input, init))
    const headerNames = cfg.headers.map((h) => h.name)
    const parsed = new URL(url)
    const tappedFetch = createFetchTap({
      fetch: baseFetch,
      onLog: (e) => this.log(e),
      now: this.now,
      // Every user-configured header value is treated as a credential in logs: the
      // ConnectionConfig does not carry the profile's "secret" flag.
      secretHeaderNames: headerNames,
      secretFragments: this.fragments,
      onLearn: (found) => addFragments(this.fragments, found),
      originGuard: { origin: parsed.origin, headerNames },
    })
    const headers: Record<string, string> = {}
    for (const h of cfg.headers) headers[h.name] = h.value

    const factory = this.opts.transportFactory ?? defaultTransportFactory
    this.lastInner = null
    const inner = factory(kind, {
      url: parsed,
      fetch: tappedFetch,
      headers,
      authProvider: this.authProvider,
      protocolVersion: cfg.protocolVersion,
    }) as LiveTransport
    this.lastInner = inner

    const tapped = new TappedTransport(inner, {
      onLog: (e) => this.log(e),
      now: this.now,
      onInbound: (m) => this.dispatchNotification(m),
    })
    const client = this.buildClient()
    // Client.close() is a no-op until the SDK has attached the transport (it probes first), so close both.
    const closer = async () => {
      await tapped.close().catch(() => undefined)
      await client.close().catch(() => undefined)
    }
    run.closer = closer
    client.onerror = (error) => {
      this.event('error', this.safe(`Transport error: ${errorMessage(error)}`))
    }
    let configured = false
    try {
      this.opts.clientSetup?.configure(client)
      configured = true
      // An SSE start() that never sees its `endpoint` event never settles on its own: race the cancel signal.
      await Promise.race([client.connect(tapped), run.cancelled()])
    } catch (e) {
      await closer()
      if (configured) this.disposeSetup()
      throw e
    } finally {
      if (run.closer === closer) run.closer = null
    }
    return { client, inner, kind }
  }
  private buildClient(): Client {
    const pin = this.opts.config.protocolVersion
    const modern = pin !== null && pin >= FIRST_MODERN_PROTOCOL_VERSION
    return new Client(CLIENT_INFO, {
      capabilities: this.opts.clientSetup?.capabilities ?? {},
      // null = auto: probe server/discover, fall back to legacy `initialize` (the SDK's own rule).
      // A legacy pin skips the probe and offers exactly that version; a modern pin is strict.
      versionNegotiation: pin === null ? { mode: 'auto' } : modern ? { mode: { pin } } : { mode: 'legacy' },
      supportedProtocolVersions: pin !== null && !modern ? [pin] : undefined,
    })
  }

  private buildSummary(live: Attempt): ServerSummary {
    const server = live.client.getServerVersion()
    return {
      serverName: server?.name || 'Unnamed server',
      serverVersion: server?.version || 'unknown',
      title: server?.title ?? null,
      protocolVersion: live.client.getNegotiatedProtocolVersion() ?? '',
      capabilities: (live.client.getServerCapabilities() ?? {}) as Record<string, unknown>,
      instructions: live.client.getInstructions() ?? null,
      transport: live.kind,
      sessionId: live.inner.sessionId ?? null,
    }
  }

  private fail(run: ConnectRun, error: unknown, preset?: Diagnosis): SessionState {
    if (run.signal.aborted) return { status: 'disconnected' }
    const base =
      preset ??
      classifyConnectionError(error, {
        // redacted: the URL ends up in the diagnosis text (which the UI can copy)
        url: redactUrl(this.opts.config.url),
        pageProtocol: globalThis.location?.protocol ?? 'http:',
      })
    const diagnosis: Diagnosis = {
      ...base,
      title: this.safe(base.title),
      detail: this.safe(base.detail),
      hints: base.hints.map((h) => this.safe(h)),
    }
    this.event('error', `Connection failed: ${diagnosis.title}`)
    return this.setState({ status: 'error', diagnosis })
  }

  disconnect(): Promise<void> {
    // Cancel a connect() in flight FIRST, even when a previous disconnect() is still running, so a
    // connect() started afterwards can never receive the cancelled run's promise.
    const run = this.run
    this.run = null
    this.connecting = null
    const closing = run?.closer?.()
    run?.abort()
    if (this.disconnecting) return this.disconnecting
    const p = this.doDisconnect(closing).finally(() => {
      this.disconnecting = null
    })
    this.disconnecting = p
    return p
  }

  private async doDisconnect(closingAttempt?: Promise<void>): Promise<void> {
    this.authTransport = null
    if (closingAttempt) await closingAttempt.catch(() => undefined)
    await this.teardown()
    // A connect() started while we were terminating owns the state now; do not overwrite it.
    if (this.connecting === null && this.state.status !== 'disconnected') this.setState({ status: 'disconnected' })
  }
  /** Closes the live client (terminating the HTTP session first). No state emission. */
  private async teardown(): Promise<void> {
    const client = this.liveClient
    const inner = this.liveInner
    this.liveClient = null
    this.liveInner = null
    if (!client) return
    if (inner && typeof inner.terminateSession === 'function' && inner.sessionId) {
      try {
        await this.withTimeout(inner.terminateSession(), TERMINATE_TIMEOUT_MS, 'Session termination')
      } catch (e) {
        // 405 means "server does not allow client termination" - expected, silent.
        if (getHttpStatus(e) !== 405) {
          this.event('warn', this.safe(`Session termination failed: ${errorMessage(e)}`))
        }
      }
    }
    // Closing aborts a still-pending DELETE; that abort is expected, so it must not surface as a transport error.
    client.onerror = undefined
    await client.close().catch(() => undefined)
    this.disposeSetup()
  }

  /** Rejects after `ms` so an unanswered request cannot block teardown; the later client.close() aborts it. */
  private withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${what} timed out after ${ms} ms`)), ms)
    })
    return Promise.race([p, timeout]).finally(() => clearTimeout(timer))
  }
  private disposeSetup(): void {
    try {
      this.opts.clientSetup?.dispose()
    } catch {
      // a failing dispose must not leave the session half torn down
    }
  }

  private handleUnexpectedClose(client: Client): void {
    if (this.liveClient !== client) return
    this.liveClient = null
    this.liveInner = null
    this.disposeSetup()
    this.event('warn', 'Connection closed by the server')
    this.setState({ status: 'disconnected' })
  }

  // -------------------------------------------------------------------------
  // OAuth
  // -------------------------------------------------------------------------

  async finishAuth(code: string, iss?: string): Promise<void> {
    let transport: LiveTransport | null = this.authTransport
    if (!transport) {
      // Fresh, never-connected session (page-reload fallback): build a transport only to reach finishAuth().
      const cfg = this.opts.config
      const kind: TransportKind = cfg.transport === 'sse' ? 'sse' : 'streamable-http'
      const check = validateServerUrl(cfg.url)
      if (!check.ok) throw new Error(check.reason)
      const headers: Record<string, string> = {}
      for (const h of cfg.headers) headers[h.name] = h.value
      const baseFetch: typeof fetch = this.opts.fetchImpl ?? ((input, init) => globalThis.fetch(input, init))
      const parsed = new URL(check.url)
      const factory = this.opts.transportFactory ?? defaultTransportFactory
      transport = factory(kind, {
        url: parsed,
        fetch: createFetchTap({
          fetch: baseFetch,
          onLog: (e) => this.log(e),
          now: this.now,
          secretHeaderNames: cfg.headers.map((h) => h.name),
          secretFragments: this.fragments,
          onLearn: (found) => addFragments(this.fragments, found),
          originGuard: { origin: parsed.origin, headerNames: cfg.headers.map((h) => h.name) },
        }),
        headers,
        authProvider: this.authProvider,
        protocolVersion: cfg.protocolVersion,
      }) as LiveTransport
    }
    if (typeof transport.finishAuth !== 'function') {
      throw new Error('This transport does not support OAuth completion')
    }
    try {
      await transport.finishAuth(code, iss)
    } catch (e) {
      throw new Error(this.safe(errorMessage(e)))
    }
    this.authTransport = null
  }

  // -------------------------------------------------------------------------
  // raw access
  // -------------------------------------------------------------------------

  async rawRequest(
    method: string,
    params?: unknown,
    o: { timeoutMs?: number; signal?: AbortSignal } = {},
  ): Promise<RawResult> {
    const started = this.now()
    const elapsed = () => Math.max(0, Math.round(this.now() - started))
    const client = this.state.status === 'connected' ? this.liveClient : null
    if (!client) return { ok: false, error: { code: null, message: 'Not connected' }, durationMs: 0 }
    try {
      const result = await client.request(
        { method, params: params as Record<string, unknown> | undefined },
        ANY_RESULT,
        { timeout: o.timeoutMs ?? DEFAULT_RAW_TIMEOUT_MS, signal: o.signal },
      )
      return { ok: true, result, durationMs: elapsed() }
    } catch (e) {
      if (e instanceof ProtocolError) {
        return {
          ok: false,
          error: { code: e.code, message: e.message, ...(e.data !== undefined ? { data: e.data } : {}) },
          durationMs: elapsed(),
        }
      }
      const timedOut = e instanceof SdkError && e.code === SdkErrorCode.RequestTimeout && !o.signal?.aborted
      const message = o.signal?.aborted
        ? 'Request aborted'
        : timedOut
          ? `Request timed out after ${o.timeoutMs ?? DEFAULT_RAW_TIMEOUT_MS} ms`
          : this.safe(errorMessage(e))
      return { ok: false, error: { code: null, message }, durationMs: elapsed() }
    }
  }

  async rawNotification(method: string, params?: unknown): Promise<{ ok: true } | { ok: false; message: string }> {
    const client = this.state.status === 'connected' ? this.liveClient : null
    if (!client) return { ok: false, message: 'Not connected' }
    try {
      await client.notification({ method, params: params as Record<string, unknown> | undefined })
      return { ok: true }
    } catch (e) {
      return { ok: false, message: this.safe(errorMessage(e)) }
    }
  }

  // -------------------------------------------------------------------------
  // inbound notification observers
  // -------------------------------------------------------------------------

  onNotification(method: string, cb: (params: unknown) => void): () => void {
    let set = this.notificationObservers.get(method)
    if (!set) {
      set = new Set()
      this.notificationObservers.set(method, set)
    }
    set.add(cb)
    return () => {
      this.notificationObservers.get(method)?.delete(cb)
    }
  }

  onListChanged(cb: (kind: 'tools' | 'prompts' | 'resources') => void): () => void {
    const kinds = ['tools', 'prompts', 'resources'] as const
    const unsubs = kinds.map((kind) => this.onNotification(`notifications/${kind}/list_changed`, () => cb(kind)))
    return () => unsubs.forEach((u) => u())
  }

  private dispatchNotification(message: JSONRPCMessage): void {
    const m = message as { method?: unknown; id?: unknown; params?: unknown }
    if (typeof m.method !== 'string' || m.id !== undefined) return
    const observers = this.notificationObservers.get(m.method)
    if (!observers) return
    for (const cb of [...observers]) {
      try {
        cb(m.params)
      } catch {
        // a failing observer must not affect other observers or message delivery
      }
    }
  }

  // -------------------------------------------------------------------------
  // helpers
  // -------------------------------------------------------------------------

  private setState(s: SessionState): SessionState {
    this.state = s
    try {
      this.opts.onState(s)
    } catch {
      // a failing state listener must not break the session (connect() never throws)
    }
    return s
  }

  private event(level: 'info' | 'warn' | 'error', text: string): void {
    this.log({ kind: 'event', ts: this.now(), level, text })
  }

  private log(e: LogEntryInput): void {
    try {
      this.opts.onLog(e)
    } catch {
      // logging must never break the connection
    }
  }

  private safe(text: string): string {
    return scrubSecrets(text, this.fragments)
  }
}
