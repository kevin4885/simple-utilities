import { describe, it, expect, vi } from 'vitest'
import {
  SSEClientTransport,
  SUPPORTED_PROTOCOL_VERSIONS,
  SdkErrorCode,
  SdkHttpError,
  StreamableHTTPClientTransport,
  UnauthorizedError,
  type Transport,
} from '@modelcontextprotocol/client'
import { createFakeServer, type FakeServer, type FakeServerOptions } from '../testing/fakeServer'
import { createSession, McpSession } from './session'
import type { ClientFeatureSetup, ConnectionConfig, LogEntryInput, SessionOptions, SessionState, TransportKind } from './types'

type Rpc = Extract<LogEntryInput, { kind: 'rpc' }>
type Evt = Extract<LogEntryInput, { kind: 'event' }>
type Http = Extract<LogEntryInput, { kind: 'http' }>

function cfg(over: Partial<ConnectionConfig> = {}): ConnectionConfig {
  return { url: 'https://mcp.test/mcp', transport: 'streamable-http', headers: [], protocolVersion: null, ...over }
}

interface Harness {
  session: McpSession
  logs: LogEntryInput[]
  states: SessionState[]
  rpc: () => Rpc[]
  events: () => Evt[]
  http: () => Http[]
}

function harness(opts: Partial<SessionOptions> & { config?: ConnectionConfig } = {}): Harness {
  const logs: LogEntryInput[] = []
  const states: SessionState[] = []
  const session = createSession({
    config: cfg(),
    onLog: (e) => logs.push(e),
    onState: (s) => states.push(s),
    ...opts,
  })
  return {
    session,
    logs,
    states,
    rpc: () => logs.filter((l): l is Rpc => l.kind === 'rpc'),
    events: () => logs.filter((l): l is Evt => l.kind === 'event'),
    http: () => logs.filter((l): l is Http => l.kind === 'http'),
  }
}

type TransportWithSession = Transport & { sessionId?: string; terminateSession?: () => Promise<void> }

/** Session wired to a fake server through the transportFactory seam. */
function withFake(
  fakeOpts: FakeServerOptions = {},
  over: { sessionId?: string; terminate?: () => Promise<void>; clientSetup?: ClientFeatureSetup; config?: ConnectionConfig } = {},
) {
  const fake = createFakeServer({ ...fakeOpts, ...(over.sessionId ? { sessionId: over.sessionId } : {}) })
  const transport = fake.clientTransport as TransportWithSession
  if (over.terminate) transport.terminateSession = over.terminate
  const factoryKinds: TransportKind[] = []
  const h = harness({
    config: over.config ?? cfg(),
    clientSetup: over.clientSetup,
    transportFactory: (kind) => {
      factoryKinds.push(kind)
      return transport
    },
  })
  return { ...h, fake, transport, factoryKinds }
}

function json(body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json', ...headers } })
}

/** Minimal Streamable-HTTP MCP server behind a fetch stub. */
function mcpHttpStub(o: { deleteStatus?: number; echoSecretIn401?: string } = {}) {
  const calls: { method: string; url: string; headers: Record<string, string>; body: { method?: string; id?: unknown } | undefined }[] = []
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers: Record<string, string> = {}
    new Headers(init?.headers).forEach((v, k) => (headers[k] = v))
    const method = init?.method ?? 'GET'
    const body = init?.body ? (JSON.parse(String(init.body)) as { method?: string; id?: unknown }) : undefined
    calls.push({ method, url: String(input), headers, body })
    if (o.echoSecretIn401) return new Response(`bad credentials: ${o.echoSecretIn401}`, { status: 500 })
    if (method === 'DELETE') return new Response(null, { status: o.deleteStatus ?? 200 })
    if (method === 'GET') return new Response(null, { status: 405 })
    if (body?.method === 'server/discover') return json({ jsonrpc: '2.0', id: body.id, error: { code: -32601, message: 'Method not found' } })
    if (body?.method === 'initialize') {
      return json(
        {
          jsonrpc: '2.0',
          id: body.id,
          result: { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'http-stub', version: '2.0.0' } },
        },
        { 'mcp-session-id': 'sess-http-1' },
      )
    }
    if (body?.id === undefined) return new Response(null, { status: 202 })
    return json({ jsonrpc: '2.0', id: body.id, result: {} })
  }) as typeof fetch
  return { fetchImpl, calls }
}

function realFactory(kinds: TransportKind[]): NonNullable<SessionOptions['transportFactory']> {
  return (kind, ctx) => {
    kinds.push(kind)
    const o = { fetch: ctx.fetch, requestInit: { headers: ctx.headers }, authProvider: ctx.authProvider }
    return kind === 'sse' ? new SSEClientTransport(ctx.url, o) : new StreamableHTTPClientTransport(ctx.url, o)
  }
}

describe('McpSession happy path (fake server)', () => {
  it('connects and returns server info; initial state is disconnected', async () => {
    const t = withFake({
      serverInfo: { name: 'acme', version: '3.1.4', title: 'Acme MCP' },
      capabilities: { tools: { listChanged: true }, logging: {} },
      instructions: 'Use me wisely',
    })
    expect(t.session.getState()).toEqual({ status: 'disconnected' })
    expect(() => t.session.client).toThrow('not connected')
    const state = await t.session.connect()
    expect(state.status).toBe('connected')
    if (state.status !== 'connected') return
    expect(state.info.serverName).toBe('acme')
    expect(state.info.serverVersion).toBe('3.1.4')
    expect(state.info.title).toBe('Acme MCP')
    expect(SUPPORTED_PROTOCOL_VERSIONS).toContain(state.info.protocolVersion)
    expect(state.info.capabilities).toEqual({ tools: { listChanged: true }, logging: {} })
    expect(state.info.instructions).toBe('Use me wisely')
    expect(state.info.transport).toBe('streamable-http')
    expect(state.info.sessionId).toBeNull()
    expect(t.session.getState()).toBe(state)
    expect(t.session.client.getServerVersion()?.name).toBe('acme')
    await t.session.disconnect()
  })

  it('instructions are null when the server sends none; session id is surfaced when present', async () => {
    const t = withFake({}, { sessionId: 'sess-42' })
    const state = await t.session.connect()
    if (state.status !== 'connected') throw new Error('not connected')
    expect(state.info.instructions).toBeNull()
    expect(state.info.sessionId).toBe('sess-42')
    await t.session.disconnect()
  })

  it('logs initialize out/in with the same rpcId, integer durationMs, and notifications/initialized with rpcId null', async () => {
    const t = withFake()
    await t.session.connect()
    const init = t.rpc().find((e) => e.direction === 'out' && e.method === 'initialize')
    expect(init).toBeDefined()
    expect(init?.rpcId).not.toBeNull()
    expect(init?.durationMs).toBeNull()
    const res = t.rpc().find((e) => e.direction === 'in' && e.method === null && e.rpcId === init?.rpcId)
    expect(res).toBeDefined()
    expect(Number.isInteger(res?.durationMs)).toBe(true)
    expect(res?.durationMs).toBeGreaterThanOrEqual(0)
    const initialized = t.rpc().find((e) => e.direction === 'out' && e.method === 'notifications/initialized')
    expect(initialized?.rpcId).toBeNull()
    for (const e of t.rpc().filter((r) => r.direction === 'out')) expect(e.durationMs).toBeNull()
    await t.session.disconnect()
  })

  it('verified SDK behaviour: auto mode probes server/discover, the fake answers -32601, the client falls back to initialize', async () => {
    const t = withFake()
    await t.session.connect()
    const methods = t.fake.received.map((m) => (m as { method?: string }).method)
    expect(methods.indexOf('server/discover')).toBeGreaterThanOrEqual(0)
    expect(methods.indexOf('initialize')).toBeGreaterThan(methods.indexOf('server/discover'))
    expect(t.session.getState().status).toBe('connected')
    await t.session.disconnect()
  })

  it('a legacy protocolVersion pin skips the probe and offers exactly that version', async () => {
    const t = withFake({}, { config: cfg({ protocolVersion: '2025-03-26' }) })
    const state = await t.session.connect()
    const methods = t.fake.received.map((m) => (m as { method?: string }).method)
    expect(methods).not.toContain('server/discover')
    const init = t.fake.received.find((m) => (m as { method?: string }).method === 'initialize') as unknown as { params: { protocolVersion: string } }
    expect(init.params.protocolVersion).toBe('2025-03-26')
    expect(state.status === 'connected' && state.info.protocolVersion).toBe('2025-03-26')
    await t.session.disconnect()
  })

  it('a modern pin against a legacy server ends in error (no throw)', async () => {
    const t = withFake({}, { config: cfg({ protocolVersion: '2026-07-28' }) })
    const state = await t.session.connect()
    expect(state.status).toBe('error')
  })

  it('rebuilds the client on every connect and a second connect() while connecting shares the promise', async () => {
    const fakes: FakeServer[] = []
    const h = harness({
      transportFactory: () => {
        const f = createFakeServer()
        fakes.push(f)
        return f.clientTransport
      },
    })
    const [a, b] = await Promise.all([h.session.connect(), h.session.connect()])
    expect(a).toBe(b)
    expect(fakes).toHaveLength(1)
    const first = h.session.client
    await h.session.disconnect()
    await h.session.connect()
    expect(fakes).toHaveLength(2)
    expect(h.session.client).not.toBe(first)
    await h.session.disconnect()
  })

  it('goes to disconnected when the server closes the connection', async () => {
    const t = withFake()
    await t.session.connect()
    await t.fake.close()
    await vi.waitFor(() => expect(t.session.getState()).toEqual({ status: 'disconnected' }))
    expect(() => t.session.client).toThrow('not connected')
  })

  it('forwards messages unmodified: rpc entries deep-equal what the fake saw and sent', async () => {
    const t = withFake({ capabilities: { logging: {} } })
    await t.session.connect()
    await t.session.rawRequest('ping')
    await t.fake.sendNotification('notifications/message', { level: 'info', data: 'hello' })
    await vi.waitFor(() => expect(t.rpc().some((e) => e.direction === 'in' && e.method === 'notifications/message')).toBe(true))

    const outPing = t.rpc().find((e) => e.direction === 'out' && e.method === 'ping')
    const seenPing = t.fake.received.find((m) => (m as { method?: string }).method === 'ping')
    expect(outPing?.message).toEqual(seenPing)

    const inNote = t.rpc().find((e) => e.direction === 'in' && e.method === 'notifications/message')
    expect(inNote?.message).toEqual({ jsonrpc: '2.0', method: 'notifications/message', params: { level: 'info', data: 'hello' } })
    await t.session.disconnect()
  })
})

describe('connect() error handling (never throws)', () => {
  it('network TypeError from the factory -> error/cors-or-network; onState starts with connecting', async () => {
    const h = harness({
      transportFactory: () => {
        throw new TypeError('Failed to fetch')
      },
    })
    const state = await h.session.connect()
    expect(state.status).toBe('error')
    if (state.status === 'error') expect(state.diagnosis.code).toBe('cors-or-network')
    expect(h.states[0]).toEqual({ status: 'connecting' })
    expect(h.states[h.states.length - 1]).toBe(state)
    expect(h.events().some((e) => e.level === 'error')).toBe(true)
  })

  it('UnauthorizedError -> auth-required (not error)', async () => {
    const h = harness({
      transportFactory: () => {
        throw new UnauthorizedError()
      },
    })
    expect(await h.session.connect()).toEqual({ status: 'auth-required' })
    expect(h.states[0]).toEqual({ status: 'connecting' })
  })

  it('initialize answered with a JSON-RPC error -> error/protocol', async () => {
    const t = withFake({ rejectMethods: { initialize: { code: -32600, message: 'go away' } } })
    const state = await t.session.connect()
    expect(state.status).toBe('error')
    if (state.status === 'error') {
      expect(state.diagnosis.code).toBe('protocol')
      expect(state.diagnosis.detail).toContain('go away')
    }
    expect(t.states[0]).toEqual({ status: 'connecting' })
  })

  it('an invalid URL is reported as error without building a transport', async () => {
    const factory = vi.fn()
    const h = harness({ config: cfg({ url: 'https://user:pw@mcp.test/' }), transportFactory: factory })
    const state = await h.session.connect()
    expect(state.status).toBe('error')
    expect(factory).not.toHaveBeenCalled()
  })

  it('a thrown non-Error value is still turned into an error state', async () => {
    const h = harness({
      transportFactory: () => {
        throw 'plain string failure'
      },
    })
    const state = await h.session.connect()
    expect(state.status).toBe('error')
    if (state.status === 'error') expect(state.diagnosis.detail).toContain('plain string failure')
  })

  it('a server that never answers can be cancelled with disconnect()', async () => {
    const t = withFake({ onRequest: () => 'no-response' })
    const connecting = t.session.connect()
    await vi.waitFor(() => expect(t.fake.received.length).toBeGreaterThan(0))
    await t.session.disconnect()
    const final = await connecting
    expect(final.status).toBe('disconnected')
    expect(t.session.getState()).toEqual({ status: 'disconnected' })
  })
})

describe('transport: auto fallback', () => {
  const run = async (status: number | 'network', config = cfg({ transport: 'auto' })) => {
    const kinds: TransportKind[] = []
    const fetchImpl = (async () => {
      if (status === 'network') throw new TypeError('Failed to fetch')
      return new Response('nope', { status })
    }) as unknown as typeof fetch
    const h = harness({ config, fetchImpl, transportFactory: realFactory(kinds) })
    const state = await h.session.connect()
    return { kinds, state, h }
  }

  it('404 -> tries streamable-http then sse and logs a "falling back" warning', async () => {
    const { kinds, state, h } = await run(404)
    expect(kinds).toEqual(['streamable-http', 'sse'])
    const warn = h.events().find((e) => e.level === 'warn')
    expect(warn?.text).toContain('falling back')
    expect(warn?.text).toContain('404')
    expect(state.status).toBe('error')
  })

  it.each([400, 405])('%i also falls back', async (status) => {
    const { kinds } = await run(status)
    expect(kinds).toEqual(['streamable-http', 'sse'])
  })

  it.each([401, 403, 500, 502])('%i never falls back', async (status) => {
    const { kinds, state, h } = await run(status)
    expect(kinds).toEqual(['streamable-http'])
    expect(h.events().some((e) => e.text.includes('falling back'))).toBe(false)
    expect(state.status).toBe('error')
    if (state.status === 'error') {
      expect(state.diagnosis.code).toBe(status === 401 ? 'unauthorized' : status === 403 ? 'forbidden' : 'http-status')
      expect(state.diagnosis.httpStatus).toBe(status)
    }
  })

  it('a network TypeError never falls back', async () => {
    const { kinds, state } = await run('network')
    expect(kinds).toEqual(['streamable-http'])
    expect(state.status === 'error' && state.diagnosis.code).toBe('cors-or-network')
  })

  it("transport 'sse' uses only sse and 'streamable-http' only streamable-http", async () => {
    expect((await run(404, cfg({ transport: 'sse' }))).kinds).toEqual(['sse'])
    expect((await run(404, cfg({ transport: 'streamable-http' }))).kinds).toEqual(['streamable-http'])
  })

  it('a successful fallback ends connected on the sse transport', async () => {
    const fake = createFakeServer()
    const kinds: TransportKind[] = []
    const h = harness({
      config: cfg({ transport: 'auto' }),
      transportFactory: (kind) => {
        kinds.push(kind)
        if (kind === 'streamable-http') {
          const t = {
            onmessage: undefined,
            start: async () => undefined,
            close: async () => undefined,
            send: async () => {
              throw new SdkHttpError(SdkErrorCode.ClientHttpNotImplemented, 'Error POSTing to endpoint: Not Found', { status: 404 })
            },
          }
          return t as unknown as Transport
        }
        return fake.clientTransport
      },
    })
    const state = await h.session.connect()
    expect(kinds).toEqual(['streamable-http', 'sse'])
    expect(state.status === 'connected' && state.info.transport).toBe('sse')
    await h.session.disconnect()
  })
})

describe('credentials never reach the log', () => {
  it('no LogEntryInput contains the configured secret (happy path, disconnect, raw calls)', async () => {
    const stub = mcpHttpStub()
    const h = harness({
      config: cfg({
        headers: [
          { name: 'Authorization', value: 'Bearer SECRET123' },
          { name: 'X-Tenant', value: 'TENANT-SECRET-456' },
        ],
      }),
      fetchImpl: stub.fetchImpl,
      transportFactory: realFactory([]),
    })
    const state = await h.session.connect()
    expect(state.status).toBe('connected')
    await h.session.rawRequest('ping')
    await h.session.disconnect()

    // the secret really was sent to the server...
    expect(stub.calls.length).toBeGreaterThan(2)
    expect(stub.calls.every((c) => c.headers['authorization'] === 'Bearer SECRET123')).toBe(true)
    // ...but never logged anywhere
    const dump = JSON.stringify(h.logs)
    expect(dump).not.toContain('SECRET123')
    expect(dump).not.toContain('TENANT-SECRET-456')
    const httpEntries = h.http()
    expect(httpEntries.length).toBeGreaterThan(2)
    expect(httpEntries[0].requestHeaders['authorization'] ?? httpEntries[0].requestHeaders['Authorization']).toBe('[redacted]')
  })

  it('secrets echoed back in an error body do not reach the diagnosis, events or logs', async () => {
    const stub = mcpHttpStub({ echoSecretIn401: 'Bearer SECRET123' })
    // A legacy pin skips the server/discover probe, so the POST error text (which embeds the response body) is what surfaces.
    const h = harness({
      config: cfg({ protocolVersion: '2025-06-18', headers: [{ name: 'Authorization', value: 'Bearer SECRET123' }] }),
      fetchImpl: stub.fetchImpl,
      transportFactory: realFactory([]),
    })
    const state = await h.session.connect()
    expect(state.status).toBe('error')
    if (state.status === 'error') expect(state.diagnosis.detail).toContain('bad credentials')
    expect(JSON.stringify(state)).not.toContain('SECRET123')
    expect(JSON.stringify(h.logs)).not.toContain('SECRET123')
  })

  it('secret-named query parameters in the server URL are redacted in the diagnosis', async () => {
    const h = harness({
      config: cfg({ url: 'https://mcp.test/mcp?api_key=URLSECRET789&x=1' }),
      transportFactory: () => {
        throw new TypeError('Failed to fetch')
      },
    })
    const state = await h.session.connect()
    expect(state.status).toBe('error')
    expect(JSON.stringify(state)).not.toContain('URLSECRET789')
    expect(JSON.stringify(h.logs)).not.toContain('URLSECRET789')
  })

  it('transport errors carrying the secret are scrubbed from the event log', async () => {
    const h = harness({
      config: cfg({ headers: [{ name: 'Authorization', value: 'Bearer SECRET123' }] }),
      transportFactory: () => {
        throw new Error('rejected token SECRET123')
      },
    })
    const state = await h.session.connect()
    expect(state.status).toBe('error')
    expect(JSON.stringify(state)).not.toContain('SECRET123')
    expect(JSON.stringify(h.logs)).not.toContain('SECRET123')
  })

  it('does not send user-configured headers to a different origin (e.g. an OAuth authorization server)', async () => {
    const calls: { url: string; headers: Record<string, string> }[] = []
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), headers: { ...(init?.headers as Record<string, string>) } })
      return new Response('{}', { status: 200 })
    }) as typeof fetch
    const h = harness({
      config: cfg({ headers: [{ name: 'X-Api-Key', value: 'KEY-VALUE-1' }] }),
      fetchImpl,
      transportFactory: (_kind, ctx) => {
        void ctx.fetch('https://auth.other.test/token', { method: 'POST', headers: { ...ctx.headers, 'Content-Type': 'x' } })
        void ctx.fetch('https://mcp.test/mcp', { method: 'POST', headers: { ...ctx.headers } })
        throw new Error('stop')
      },
    })
    await h.session.connect()
    await vi.waitFor(() => expect(calls).toHaveLength(2))
    expect(calls[0].headers).toEqual({ 'Content-Type': 'x' })
    expect(calls[1].headers).toEqual({ 'X-Api-Key': 'KEY-VALUE-1' })
  })

  it('applies configured headers on every request and lets the SDK-managed headers win', async () => {
    const stub = mcpHttpStub()
    const h = harness({
      config: cfg({
        headers: [
          { name: 'X-Custom', value: 'one' },
          { name: 'Mcp-Session-Id', value: 'user-supplied' },
        ],
      }),
      fetchImpl: stub.fetchImpl,
      transportFactory: realFactory([]),
    })
    await h.session.connect()
    await h.session.rawRequest('ping')
    expect(stub.calls.every((c) => c.headers['x-custom'] === 'one')).toBe(true)
    const afterInit = stub.calls.filter((c) => c.body?.method === 'ping')
    expect(afterInit[0].headers['mcp-session-id']).toBe('sess-http-1')
    await h.session.disconnect()
  })
})

describe('rawRequest / rawNotification', () => {
  it('returns the result with integer durationMs', async () => {
    const t = withFake()
    await t.session.connect()
    const r = await t.session.rawRequest('ping')
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.result).toEqual({})
      expect(Number.isInteger(r.durationMs)).toBe(true)
    }
    await t.session.disconnect()
  })

  it('returns server errors as values (no throw), including data', async () => {
    const t = withFake({ rejectMethods: { 'x/y': { code: -32001, message: 'custom', data: { a: 1 } } } })
    await t.session.connect()
    const missing = await t.session.rawRequest('does/not/exist', { a: 1 })
    expect(missing).toMatchObject({ ok: false, error: { code: -32601 } })
    const custom = await t.session.rawRequest('x/y')
    expect(custom).toMatchObject({ ok: false, error: { code: -32001, message: 'custom', data: { a: 1 } } })
    await t.session.disconnect()
  })

  it('passes params through unchanged', async () => {
    const t = withFake({ tools: [{ name: 't', inputSchema: { type: 'object' } }], capabilities: { tools: {} } })
    await t.session.connect()
    const r = await t.session.rawRequest('tools/list', { cursor: 'cursor-0' })
    expect(r.ok).toBe(true)
    const sent = t.fake.received.filter((m) => (m as { method?: string }).method === 'tools/list')
    expect((sent[0] as { params: unknown }).params).toEqual({ cursor: 'cursor-0' })
    await t.session.disconnect()
  })

  it('times out locally with code null and a "timed out" message', async () => {
    const t = withFake({ onRequest: ({ method }) => (method === 'slow/one' ? 'no-response' : undefined) })
    await t.session.connect()
    const r = await t.session.rawRequest('slow/one', undefined, { timeoutMs: 50 })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error.code).toBeNull()
      expect(r.error.message).toMatch(/timed out/i)
    }
    await t.session.disconnect()
  })

  it('reports an abort mid-flight and an already aborted signal as local "abort" failures', async () => {
    const t = withFake({ onRequest: ({ method }) => (method === 'slow/one' ? 'no-response' : undefined) })
    await t.session.connect()
    const ctl = new AbortController()
    const pending = t.session.rawRequest('slow/one', undefined, { signal: ctl.signal, timeoutMs: 5000 })
    setTimeout(() => ctl.abort(), 10)
    const mid = await pending
    expect(mid.ok === false && mid.error.code).toBeNull()
    expect(mid.ok === false && mid.error.message).toMatch(/abort/i)

    const already = new AbortController()
    already.abort()
    const pre = await t.session.rawRequest('slow/one', undefined, { signal: already.signal })
    expect(pre.ok === false && pre.error.message).toMatch(/abort/i)
    await t.session.disconnect()
  })

  it('fails locally when not connected', async () => {
    const h = harness()
    const r = await h.session.rawRequest('ping')
    expect(r).toMatchObject({ ok: false, error: { code: null, message: 'Not connected' } })
    expect(await h.session.rawNotification('x')).toEqual({ ok: false, message: 'Not connected' })
  })

  it('rawNotification logs an rpc/out entry with rpcId null and resolves ok', async () => {
    const t = withFake()
    await t.session.connect()
    expect(await t.session.rawNotification('custom/ping', { a: 1 })).toEqual({ ok: true })
    const e = t.rpc().find((r) => r.direction === 'out' && r.method === 'custom/ping')
    expect(e).toMatchObject({ rpcId: null, durationMs: null })
    expect(e?.message).toMatchObject({ method: 'custom/ping', params: { a: 1 } })
    expect(t.fake.received.some((m) => (m as { method?: string }).method === 'custom/ping')).toBe(true)
    await t.session.disconnect()
  })
})

describe('disconnect()', () => {
  it('ends disconnected, is idempotent, and disposes the client setup exactly once', async () => {
    const setup: ClientFeatureSetup = { capabilities: {}, configure: vi.fn(), dispose: vi.fn() }
    const t = withFake({}, { clientSetup: setup })
    await t.session.connect()
    expect(setup.configure).toHaveBeenCalledTimes(1)
    await t.session.disconnect()
    expect(t.session.getState()).toEqual({ status: 'disconnected' })
    expect(setup.dispose).toHaveBeenCalledTimes(1)
    const statesAfterFirst = t.states.length
    await t.session.disconnect()
    expect(setup.dispose).toHaveBeenCalledTimes(1)
    expect(t.states).toHaveLength(statesAfterFirst)
    expect(t.states.some((s) => s.status === 'error')).toBe(false)
    expect(() => t.session.client).toThrow('not connected')
  })

  it('declares the clientSetup capabilities on the client', async () => {
    const setup: ClientFeatureSetup = { capabilities: { roots: {} }, configure: vi.fn(), dispose: vi.fn() }
    const t = withFake({}, { clientSetup: setup })
    await t.session.connect()
    const init = t.fake.received.find((m) => (m as { method?: string }).method === 'initialize') as unknown as { params: { capabilities: unknown } }
    expect(init.params.capabilities).toEqual({ roots: {} })
    await t.session.disconnect()
  })

  it('calls terminateSession only when a sessionId exists', async () => {
    const terminate = vi.fn(async () => undefined)
    const withId = withFake({}, { sessionId: 'sess-1', terminate })
    await withId.session.connect()
    await withId.session.disconnect()
    expect(terminate).toHaveBeenCalledTimes(1)

    const terminate2 = vi.fn(async () => undefined)
    const noId = withFake({}, { terminate: terminate2 })
    await noId.session.connect()
    await noId.session.disconnect()
    expect(terminate2).not.toHaveBeenCalled()
  })

  it('swallows a 405 from terminateSession silently, but warns about other failures', async () => {
    const t405 = withFake(
      {},
      {
        sessionId: 's',
        terminate: async () => {
          throw new SdkHttpError(SdkErrorCode.ClientHttpFailedToTerminateSession, 'Failed to terminate session', { status: 405 })
        },
      },
    )
    await t405.session.connect()
    await t405.session.disconnect()
    expect(t405.session.getState()).toEqual({ status: 'disconnected' })
    expect(t405.events().filter((e) => e.level !== 'info')).toHaveLength(0)

    const t500 = withFake(
      {},
      {
        sessionId: 's',
        terminate: async () => {
          throw new SdkHttpError(SdkErrorCode.ClientHttpFailedToTerminateSession, 'Failed to terminate session', { status: 500 })
        },
      },
    )
    await t500.session.connect()
    await t500.session.disconnect()
    expect(t500.session.getState()).toEqual({ status: 'disconnected' })
    expect(t500.events().some((e) => e.level === 'warn' && e.text.includes('termination'))).toBe(true)
  })

  it('sends a real DELETE with the session id over HTTP, and a 405 from the server is not an error', async () => {
    const stub = mcpHttpStub({ deleteStatus: 405 })
    const h = harness({ fetchImpl: stub.fetchImpl, transportFactory: realFactory([]) })
    const state = await h.session.connect()
    expect(state.status === 'connected' && state.info.sessionId).toBe('sess-http-1')
    await h.session.disconnect()
    const del = stub.calls.find((c) => c.method === 'DELETE')
    expect(del?.headers['mcp-session-id']).toBe('sess-http-1')
    expect(h.session.getState()).toEqual({ status: 'disconnected' })
    expect(h.events().filter((e) => e.level !== 'info')).toHaveLength(0)
  })

  it('can be called before any connect', async () => {
    const h = harness()
    await h.session.disconnect()
    expect(h.session.getState()).toEqual({ status: 'disconnected' })
  })
})

describe('connect/disconnect lifecycle', () => {
  /** A transport whose start() never settles (an SSE server that never sends the `endpoint` event). */
  function stuckTransport(): Transport & { closed: number } {
    const t = {
      closed: 0,
      onmessage: undefined,
      start: () => new Promise<void>(() => undefined),
      close: async () => {
        t.closed++
      },
      send: async () => undefined,
    }
    return t as unknown as Transport & { closed: number }
  }

  it('disconnect() releases a connect() whose transport start() never settles, and the session can connect again', async () => {
    const stuck = stuckTransport()
    let n = 0
    const fake = createFakeServer()
    const h = harness({ transportFactory: () => (n++ === 0 ? stuck : fake.clientTransport) })
    const first = h.session.connect()
    await vi.waitFor(() => expect(n).toBe(1))
    await h.session.disconnect()
    expect((await first).status).toBe('disconnected')
    expect(stuck.closed).toBeGreaterThan(0)
    expect(h.session.getState()).toEqual({ status: 'disconnected' })
    const again = await h.session.connect()
    expect(again.status).toBe('connected')
    await h.session.disconnect()
  })

  it('connect() right after disconnect() starts a NEW connection instead of returning the cancelled promise', async () => {
    const stuck = stuckTransport()
    let n = 0
    const fake = createFakeServer()
    const h = harness({ transportFactory: () => (n++ === 0 ? stuck : fake.clientTransport) })
    const first = h.session.connect()
    await vi.waitFor(() => expect(n).toBe(1))
    const disconnecting = h.session.disconnect() // NOT awaited
    const second = h.session.connect()
    expect(second).not.toBe(first)
    expect((await second).status).toBe('connected')
    await disconnecting
    expect((await first).status).toBe('disconnected')
    expect(h.session.getState().status).toBe('connected') // the late disconnect must not clobber the new connection
    await h.session.disconnect()
    expect(h.session.getState()).toEqual({ status: 'disconnected' })
  })

  it('a slow terminateSession() in disconnect() does not overwrite the state of a connect() started meanwhile', async () => {
    let releaseTerminate: () => void = () => undefined
    let terminateStarted = false
    const slow = createFakeServer({ sessionId: 'old-session' })
    ;(slow.clientTransport as TransportWithSession).terminateSession = () =>
      new Promise<void>((r) => {
        terminateStarted = true
        releaseTerminate = r
      })
    const fresh = createFakeServer()
    let n = 0
    const h = harness({ transportFactory: () => (n++ === 0 ? slow.clientTransport : fresh.clientTransport) })
    expect((await h.session.connect()).status).toBe('connected')
    const disconnecting = h.session.disconnect()
    await vi.waitFor(() => expect(terminateStarted).toBe(true))
    const reconnecting = h.session.connect() // must wait for the termination, then connect
    releaseTerminate()
    await disconnecting
    expect((await reconnecting).status).toBe('connected')
    expect(h.session.getState().status).toBe('connected')
    expect(h.states.filter((s) => s.status === 'connected')).toHaveLength(2)
    await h.session.disconnect()
  })

  it('disconnect() during a failing streamable-http attempt does not start the SSE fallback', async () => {
    const kinds: TransportKind[] = []
    let release: () => void = () => undefined
    const gate = new Promise<void>((r) => (release = r))
    const fetchImpl = (async () => {
      await gate
      return new Response('nope', { status: 404 })
    }) as unknown as typeof fetch
    const h = harness({ config: cfg({ transport: 'auto' }), fetchImpl, transportFactory: realFactory(kinds) })
    const connecting = h.session.connect()
    await vi.waitFor(() => expect(kinds).toEqual(['streamable-http']))
    const disconnecting = h.session.disconnect()
    release()
    await disconnecting
    expect((await connecting).status).toBe('disconnected')
    expect(kinds).toEqual(['streamable-http'])
    expect(h.events().some((e) => e.text.includes('falling back'))).toBe(false)
    expect(h.session.getState()).toEqual({ status: 'disconnected' })
  })

  it('a cancelled connect() emits no error state and no error event', async () => {
    const h = harness({ transportFactory: () => stuckTransport() })
    const connecting = h.session.connect()
    await vi.waitFor(() => expect(h.states[0]).toEqual({ status: 'connecting' }))
    await h.session.disconnect()
    await connecting
    expect(h.states.some((s) => s.status === 'error')).toBe(false)
    expect(h.events().some((e) => e.level === 'error')).toBe(false)
  })

  it('disposes the client setup when a connect attempt fails after configure()', async () => {
    const setup: ClientFeatureSetup = { capabilities: {}, configure: vi.fn(), dispose: vi.fn() }
    const t = withFake({ rejectMethods: { initialize: { code: -32600, message: 'no' } } }, { clientSetup: setup })
    expect((await t.session.connect()).status).toBe('error')
    expect(setup.configure).toHaveBeenCalledTimes(1)
    expect(setup.dispose).toHaveBeenCalledTimes(1)
  })

  it('a session-terminating DELETE the server never answers cannot pin disconnect() or later connects', async () => {
    vi.useFakeTimers()
    try {
      const hung = createFakeServer({ sessionId: 'hung-session' })
      ;(hung.clientTransport as TransportWithSession).terminateSession = () => new Promise<void>(() => undefined)
      const fresh = createFakeServer()
      let n = 0
      const h = harness({ transportFactory: () => (n++ === 0 ? hung.clientTransport : fresh.clientTransport) })
      const connecting = h.session.connect()
      await vi.advanceTimersByTimeAsync(10)
      expect((await connecting).status).toBe('connected')

      const disconnecting = h.session.disconnect()
      const reconnecting = h.session.connect() // queued behind the (stuck) termination
      await vi.advanceTimersByTimeAsync(3500)
      await disconnecting
      expect(h.events().some((e) => e.level === 'warn' && e.text.includes('timed out'))).toBe(true)
      expect((await reconnecting).status).toBe('connected')
      expect(h.session.getState().status).toBe('connected')
      await h.session.disconnect()
      expect(h.session.getState()).toEqual({ status: 'disconnected' })
    } finally {
      vi.useRealTimers()
    }
  })

  it('a throwing onState listener does not break connect() or disconnect()', async () => {
    const fake = createFakeServer()
    const session = createSession({
      config: cfg(),
      onLog: () => undefined,
      onState: () => {
        throw new Error('listener bug')
      },
      transportFactory: () => fake.clientTransport,
    })
    expect((await session.connect()).status).toBe('connected')
    await expect(session.disconnect()).resolves.toBeUndefined()
    expect(session.getState()).toEqual({ status: 'disconnected' })
  })

  it('a second disconnect() while the first is running shares it and still disposes once', async () => {
    const setup: ClientFeatureSetup = { capabilities: {}, configure: vi.fn(), dispose: vi.fn() }
    const t = withFake({}, { clientSetup: setup })
    await t.session.connect()
    await Promise.all([t.session.disconnect(), t.session.disconnect()])
    expect(setup.dispose).toHaveBeenCalledTimes(1)
    expect(t.session.getState()).toEqual({ status: 'disconnected' })
  })
})
describe('notification observers', () => {
  it('onNotification receives inbound params AND the SDK handler still sees the notification; unsubscribe stops delivery', async () => {
    const t = withFake({ capabilities: { logging: {} } })
    await t.session.connect()
    const sdkSeen: unknown[] = []
    t.session.client.setNotificationHandler('notifications/message', (n) => {
      sdkSeen.push(n.params)
    })
    const observed: unknown[] = []
    const off = t.session.onNotification('notifications/message', (p) => observed.push(p))

    await t.fake.sendNotification('notifications/message', { level: 'info', data: 'one' })
    await vi.waitFor(() => expect(observed).toHaveLength(1))
    expect(observed[0]).toEqual({ level: 'info', data: 'one' })
    await vi.waitFor(() => expect(sdkSeen).toHaveLength(1))
    expect(sdkSeen[0]).toMatchObject({ level: 'info', data: 'one' })

    off()
    await t.fake.sendNotification('notifications/message', { level: 'info', data: 'two' })
    await vi.waitFor(() => expect(sdkSeen).toHaveLength(2))
    expect(observed).toHaveLength(1)
    await t.session.disconnect()
  })

  it('a throwing observer does not stop other observers or the SDK', async () => {
    const t = withFake({ capabilities: { logging: {} } })
    await t.session.connect()
    const sdkSeen: unknown[] = []
    t.session.client.setNotificationHandler('notifications/message', (n) => {
      sdkSeen.push(n.params)
    })
    const good: unknown[] = []
    t.session.onNotification('notifications/message', () => {
      throw new Error('bad observer')
    })
    t.session.onNotification('notifications/message', (p) => good.push(p))
    await t.fake.sendNotification('notifications/message', { level: 'info', data: 'x' })
    await vi.waitFor(() => expect(good).toHaveLength(1))
    await vi.waitFor(() => expect(sdkSeen).toHaveLength(1))
    await t.session.disconnect()
  })

  it('ignores a server REQUEST that happens to share a notification method name', async () => {
    const t = withFake()
    await t.session.connect()
    const observed: unknown[] = []
    t.session.onNotification('custom/thing', (p) => observed.push(p))
    await t.fake.sendRequest('custom/thing', { a: 1 })
    expect(observed).toHaveLength(0)
    await t.session.disconnect()
  })

  it('onListChanged fires the right kind for each list_changed notification, and unsubscribes', async () => {
    const t = withFake({ capabilities: { tools: { listChanged: true }, prompts: { listChanged: true }, resources: { listChanged: true } } })
    await t.session.connect()
    const kinds: string[] = []
    const off = t.session.onListChanged((k) => kinds.push(k))
    await t.fake.sendNotification('notifications/tools/list_changed')
    await t.fake.sendNotification('notifications/prompts/list_changed')
    await t.fake.sendNotification('notifications/resources/list_changed')
    await vi.waitFor(() => expect(kinds).toEqual(['tools', 'prompts', 'resources']))
    off()
    await t.fake.sendNotification('notifications/tools/list_changed')
    await new Promise((r) => setTimeout(r, 20))
    expect(kinds).toHaveLength(3)
    await t.session.disconnect()
  })
})

describe('finishAuth()', () => {
  it('works on a fresh, never-connected session by building a transport and calling its finishAuth', async () => {
    const finishAuth = vi.fn(async () => undefined)
    const h = harness({
      transportFactory: () => ({ finishAuth, start: async () => undefined, close: async () => undefined, send: async () => undefined }) as unknown as Transport,
    })
    await h.session.finishAuth('the-code')
    expect(finishAuth).toHaveBeenCalledWith('the-code', undefined)
  })

  it('passes the RFC 9207 iss through to the transport unchanged', async () => {
    const finishAuth = vi.fn(async () => undefined)
    const h = harness({
      transportFactory: () => ({ finishAuth, start: async () => undefined, close: async () => undefined, send: async () => undefined }) as unknown as Transport,
    })
    await h.session.finishAuth('the-code', 'https://as.test')
    expect(finishAuth).toHaveBeenCalledWith('the-code', 'https://as.test')
  })

  it('after auth-required it reuses the transport of the failed attempt', async () => {
    const finishAuth = vi.fn(async () => undefined)
    const built: unknown[] = []
    const h = harness({
      transportFactory: () => {
        const t = {
          finishAuth,
          onmessage: undefined,
          start: async () => undefined,
          close: async () => undefined,
          send: async () => {
            throw new UnauthorizedError()
          },
        }
        built.push(t)
        return t as unknown as Transport
      },
    })
    expect(await h.session.connect()).toEqual({ status: 'auth-required' })
    await h.session.finishAuth('abc')
    expect(built).toHaveLength(1)
    expect(finishAuth).toHaveBeenCalledWith('abc', undefined)
  })

  it('rejects with an Error (message scrubbed of secrets) when finishing fails, and when unsupported', async () => {
    const h = harness({
      config: cfg({ headers: [{ name: 'Authorization', value: 'Bearer SECRET123' }] }),
      transportFactory: () =>
        ({
          finishAuth: async () => {
            throw new Error('exchange failed for SECRET123')
          },
        }) as unknown as Transport,
    })
    const err = await h.session.finishAuth('c').then(
      () => null,
      (e: unknown) => e,
    )
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).message).not.toContain('SECRET123')

    const plain = harness({ transportFactory: () => ({}) as unknown as Transport })
    await expect(plain.session.finishAuth('c')).rejects.toThrow(/does not support/i)
    const badUrl = harness({ config: cfg({ url: 'nope' }) })
    await expect(badUrl.session.finishAuth('c')).rejects.toThrow()
  })
})
