import { afterEach, describe, expect, it, vi } from 'vitest'
import { StreamableHTTPClientTransport, SSEClientTransport, UnauthorizedError, type OAuthClientProvider } from '@modelcontextprotocol/client'
import { createFakeServer, type FakeServer, type FakeServerOptions } from '../testing/fakeServer'
import { createSession, type McpSession } from '../connection/session'
import type { ConnectionConfig, LogEntryInput, ServerSummary, SessionOptions, TransportKind } from '../connection/types'
import { CALL_SMOKE_LABEL, CHECKS, UNKNOWN_METHOD, UNKNOWN_TOOL_NAME, defaultSelection, getCheck, groupChecks } from './checks'
import { runChecks } from './runner'
import type { CheckContext, CheckOutcome } from './types'

const EXPECTED_IDS = [
  'handshake.initialize-valid',
  'handshake.ping',
  'capabilities.list-matches',
  'tools.unique-names',
  'tools.input-schema-valid',
  'tools.output-schema-valid',
  'tools.descriptions-present',
  'tools.unknown-tool-errors',
  'errors.unknown-method',
  'errors.invalid-params',
  'pagination.terminates',
  'pagination.no-duplicates',
  'resources.shape',
  'resources.read-matches',
  'prompts.shape',
  'prompts.missing-required-arg',
  'http.notification-202',
  'http.session-delete',
  'perf.ping-latency',
  'tools.call-smoke',
]

function cfg(over: Partial<ConnectionConfig> = {}): ConnectionConfig {
  return { url: 'https://mcp.test/mcp', transport: 'streamable-http', headers: [], protocolVersion: null, ...over }
}

const open: McpSession[] = []
const fakes: FakeServer[] = []
afterEach(async () => {
  vi.unstubAllGlobals()
  for (const s of open.splice(0)) await s.disconnect().catch(() => undefined)
  for (const f of fakes.splice(0)) await f.close().catch(() => undefined)
})

interface Env {
  ctx: CheckContext
  fake: FakeServer
  logs: LogEntryInput[]
  run(id: string): Promise<CheckOutcome>
  calls(method: string): { method?: string; params?: Record<string, unknown> }[]
}

/** A connected session against the in-memory fake, plus the context a check receives. */
async function connectFake(opts: FakeServerOptions, config: ConnectionConfig = cfg()): Promise<Env> {
  const fake = createFakeServer(opts)
  fakes.push(fake)
  const logs: LogEntryInput[] = []
  const base: Omit<SessionOptions, 'onLog' | 'onState'> = { config, transportFactory: () => fake.clientTransport }
  const session = createSession({ ...base, onLog: (e) => logs.push(e), onState: () => undefined })
  open.push(session)
  const state = await session.connect()
  if (state.status !== 'connected') throw new Error(`fake did not connect: ${JSON.stringify(state)}`)
  const ctx: CheckContext = {
    session,
    info: state.info,
    sessionOptions: base,
    signal: new AbortController().signal,
    cache: new Map(),
  }
  return {
    ctx,
    fake,
    logs,
    run: (id) => {
      const check = getCheck(id)
      if (!check) throw new Error(`no such check ${id}`)
      return check.run(ctx)
    },
    calls: (method) => fake.received.filter((m) => (m as { method?: string }).method === method) as never,
  }
}

function compliant(extra: FakeServerOptions = {}): FakeServerOptions {
  return {
    capabilities: { tools: {}, resources: {}, prompts: {} },
    tools: [
      {
        name: 'echo',
        description: 'Echo text',
        inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
        outputSchema: { type: 'object', properties: { text: { type: 'string' } } },
      },
      { name: 'now', description: 'Current time', inputSchema: { type: 'object' }, annotations: { readOnlyHint: true } },
      { name: 'wipe', description: 'Delete everything', inputSchema: { type: 'object' }, annotations: { destructiveHint: true } },
    ],
    toolHandlers: {
      now: () => ({ content: [{ type: 'text', text: 'noon' }] }),
      echo: (a) => ({ content: [{ type: 'text', text: String(a.text) }] }),
      wipe: () => {
        throw new Error('wipe must never be called by a conformance check')
      },
    },
    resources: [{ uri: 'file:///a.txt', name: 'a' }],
    resourceTemplates: [{ uriTemplate: 'file:///{x}', name: 't' }],
    resourceContents: { 'file:///a.txt': [{ uri: 'file:///a.txt', text: 'hello' }] },
    prompts: [{ name: 'greet', arguments: [{ name: 'who', required: true }] }],
    promptHandlers: {
      greet: (args) => {
        if (!args.who) throw { code: -32602, message: 'who is required' }
        return { messages: [] }
      },
    },
    ...extra,
  }
}

describe('catalogue', () => {
  it('contains exactly the specified ids, each with title, one-line spec, group', () => {
    expect(CHECKS.map((c) => c.id).sort()).toEqual([...EXPECTED_IDS].sort())
    expect(new Set(CHECKS.map((c) => c.id)).size).toBe(CHECKS.length)
    for (const c of CHECKS) {
      expect(c.title.length).toBeGreaterThan(0)
      expect(c.spec.length).toBeGreaterThan(10)
      expect(c.spec).not.toContain('\n')
      expect(c.group.length).toBeGreaterThan(0)
    }
  })

  it('only tools.call-smoke is off by default', () => {
    expect(CHECKS.filter((c) => !c.defaultOn).map((c) => c.id)).toEqual(['tools.call-smoke'])
    expect(defaultSelection().has('tools.call-smoke')).toBe(false)
    expect(defaultSelection().size).toBe(CHECKS.length - 1)
    expect(CALL_SMOKE_LABEL).toBe('Calls read-only tools that need no arguments')
  })

  it('groupChecks keeps every check exactly once', () => {
    expect(groupChecks().flatMap((g) => g.checks).length).toBe(CHECKS.length)
  })
})

describe('compliant fake: every default check passes (or is informational)', () => {
  it('runs the whole default selection through the runner with no fail/warn', async () => {
    // Everything except the two http checks, which need a real HTTP transport (covered below).
    const env = await connectFake(compliant())
    const selected = CHECKS.filter((c) => c.defaultOn && !c.id.startsWith('http.'))
    const results = await runChecks(selected, { session: env.ctx.session, info: env.ctx.info, sessionOptions: env.ctx.sessionOptions })
    const bad = results.filter((r) => r.status === 'fail' || r.status === 'warn')
    expect(bad).toEqual([])
    expect(results.find((r) => r.id === 'perf.ping-latency')?.status).toBe('info')
    expect(results.find((r) => r.id === 'tools.output-schema-valid')?.status).toBe('pass')
  })

  it('never calls a tool: only the nonexistent name and a name-less tools/call are sent by default checks', async () => {
    const env = await connectFake(compliant())
    const selected = CHECKS.filter((c) => c.defaultOn && !c.id.startsWith('http.'))
    await runChecks(selected, { session: env.ctx.session, info: env.ctx.info, sessionOptions: env.ctx.sessionOptions })
    const names = env.calls('tools/call').map((m) => m.params?.name)
    expect(names.length).toBeGreaterThan(0)
    expect(names.every((n) => n === UNKNOWN_TOOL_NAME || n === undefined)).toBe(true)
  })
})

describe('handshake.initialize-valid', () => {
  it('passes against a compliant fake', async () => {
    const env = await connectFake(compliant())
    expect((await env.run('handshake.initialize-valid')).status).toBe('pass')
  })

  it('fails for empty serverName / serverVersion', async () => {
    const env = await connectFake(compliant({ serverInfo: { name: '', version: '' } }))
    const r = await env.run('handshake.initialize-valid')
    expect(r.status).toBe('fail')
    expect(r.message).toContain('serverInfo.name')
    expect(r.message).toContain('serverInfo.version')
  })

  it('fails for an unsupported negotiated version and non-object capabilities', async () => {
    const client = { getServerVersion: () => ({ name: 'x', version: '1' }), getServerCapabilities: () => 'nope' }
    const ctx = { session: { client }, info: { protocolVersion: '1999-01-01' }, sessionOptions: { config: cfg() } } as unknown as CheckContext
    const r = await getCheck('handshake.initialize-valid')!.run(ctx)
    expect(r.status).toBe('fail')
    expect(r.message).toContain('1999-01-01')
    expect(r.message).toContain('capabilities is not an object')
  })
})

describe('handshake.ping', () => {
  it('passes for {}', async () => {
    const env = await connectFake(compliant())
    expect((await env.run('handshake.ping')).status).toBe('pass')
  })
  it('fails for a non-empty result and for an error', async () => {
    const a = await connectFake(compliant({ onRequest: (r) => (r.method === 'ping' ? { result: { pong: true } } : undefined) }))
    expect((await a.run('handshake.ping')).status).toBe('fail')
    const b = await connectFake(compliant({ rejectMethods: { ping: { code: -32603, message: 'down' } } }))
    const r = await b.run('handshake.ping')
    expect(r.status).toBe('fail')
    expect(r.message).toContain('down')
  })
})

describe('capabilities.list-matches', () => {
  it('passes when advertised lists work and unadvertised ones answer -32601', async () => {
    const env = await connectFake(
      compliant({
        capabilities: { tools: {} },
        rejectMethods: {
          'resources/list': { code: -32601, message: 'nope' },
          'resources/templates/list': { code: -32601, message: 'nope' },
          'prompts/list': { code: -32601, message: 'nope' },
        },
      }),
    )
    expect((await env.run('capabilities.list-matches')).status).toBe('pass')
  })

  it('warns "works but is not advertised" when an unadvertised list succeeds', async () => {
    const env = await connectFake(compliant({ capabilities: { tools: {}, resources: {} } }))
    const r = await env.run('capabilities.list-matches')
    expect(r.status).toBe('warn')
    expect(r.message).toContain('works but is not advertised')
    expect(r.message).toContain('prompts/list')
  })

  it('fails when an advertised list fails, or an unadvertised one errors with another code', async () => {
    const a = await connectFake(compliant({ rejectMethods: { 'tools/list': { code: -32603, message: 'broken' } } }))
    const ra = await a.run('capabilities.list-matches')
    expect(ra.status).toBe('fail')
    expect(ra.message).toContain('tools/list is advertised but failed')
    const b = await connectFake(compliant({ capabilities: { tools: {}, resources: {} }, rejectMethods: { 'prompts/list': { code: -32603, message: 'x' } } }))
    expect((await b.run('capabilities.list-matches')).status).toBe('fail')
  })

  it('tolerates a missing resources/templates/list (optional) with a warning only', async () => {
    const env = await connectFake(compliant({ rejectMethods: { 'resources/templates/list': { code: -32601, message: 'nope' } } }))
    const r = await env.run('capabilities.list-matches')
    expect(r.status).toBe('warn')
    expect(r.message).toContain('resources/templates/list')
  })
})

describe('tools.* schema and naming checks', () => {
  it('unique-names: pass vs fail on duplicates (also across pages)', async () => {
    const ok = await connectFake(compliant({ pageSize: 2 }))
    expect((await ok.run('tools.unique-names')).status).toBe('pass')
    const dup = await connectFake(
      compliant({
        pageSize: 1,
        tools: [
          { name: 'a', description: 'd', inputSchema: { type: 'object' } },
          { name: 'a', description: 'd', inputSchema: { type: 'object' } },
        ],
      }),
    )
    const r = await dup.run('tools.unique-names')
    expect(r.status).toBe('fail')
    expect(r.message).toContain('a')
  })

  it('input-schema-valid: pass vs fail for wrong type, missing schema, and lint issues', async () => {
    const ok = await connectFake(compliant())
    expect((await ok.run('tools.input-schema-valid')).status).toBe('pass')
    const bad = await connectFake(
      compliant({
        tools: [
          { name: 'wrongtype', description: 'd', inputSchema: { type: 'string' } },
          { name: 'lint', description: 'd', inputSchema: { type: 'object', properties: { a: { type: 'strng' } } } },
          { name: 'missing', description: 'd' },
        ],
      }),
    )
    const r = await bad.run('tools.input-schema-valid')
    expect(r.status).toBe('fail')
    for (const n of ['wrongtype', 'lint', 'missing']) expect(r.message).toContain(n)
  })

  it('output-schema-valid: pass, skip when no tool has one, fail on a broken one', async () => {
    const ok = await connectFake(compliant())
    expect((await ok.run('tools.output-schema-valid')).status).toBe('pass')
    const none = await connectFake(compliant({ tools: [{ name: 'a', description: 'd', inputSchema: { type: 'object' } }] }))
    expect((await none.run('tools.output-schema-valid')).status).toBe('skip')
    const bad = await connectFake(
      compliant({ tools: [{ name: 'a', description: 'd', inputSchema: { type: 'object' }, outputSchema: { type: 'object', properties: 5 } }] }),
    )
    const r = await bad.run('tools.output-schema-valid')
    expect(r.status).toBe('fail')
    expect(r.message).toContain('a')
  })

  it('descriptions-present: pass vs warn', async () => {
    const ok = await connectFake(compliant())
    expect((await ok.run('tools.descriptions-present')).status).toBe('pass')
    const bad = await connectFake(
      compliant({ tools: [{ name: 'quiet', inputSchema: { type: 'object' } }, { name: 'blank', description: '  ', inputSchema: { type: 'object' } }] }),
    )
    const r = await bad.run('tools.descriptions-present')
    expect(r.status).toBe('warn')
    expect(r.message).toContain('quiet')
    expect(r.message).toContain('blank')
  })

  it('skip when the server has no tools capability', async () => {
    const env = await connectFake({ capabilities: {} })
    for (const id of ['tools.unique-names', 'tools.input-schema-valid', 'tools.output-schema-valid', 'tools.descriptions-present', 'tools.unknown-tool-errors', 'tools.call-smoke']) {
      expect((await env.run(id)).status).toBe('skip')
    }
  })
})

describe('tools.unknown-tool-errors', () => {
  it('passes on a JSON-RPC error and on isError:true; sends the reserved nonexistent name', async () => {
    const a = await connectFake(compliant())
    expect((await a.run('tools.unknown-tool-errors')).status).toBe('pass')
    expect(a.calls('tools/call')[0].params?.name).toBe(UNKNOWN_TOOL_NAME)
    const b = await connectFake(compliant({ onRequest: (r) => (r.method === 'tools/call' ? { result: { isError: true, content: [] } } : undefined) }))
    const r = await b.run('tools.unknown-tool-errors')
    expect(r.status).toBe('pass')
    expect(r.message).toContain('isError')
  })

  it('fails when the call cleanly succeeds', async () => {
    const env = await connectFake(compliant({ onRequest: (r) => (r.method === 'tools/call' ? { result: { content: [] } } : undefined) }))
    expect((await env.run('tools.unknown-tool-errors')).status).toBe('fail')
  })
})

describe('errors.*', () => {
  it('unknown-method: -32601 pass, other code warn, success fail', async () => {
    const ok = await connectFake(compliant())
    expect((await ok.run('errors.unknown-method')).status).toBe('pass')
    expect(ok.calls(UNKNOWN_METHOD).length).toBe(1)
    const other = await connectFake(compliant({ rejectMethods: { [UNKNOWN_METHOD]: { code: -32603, message: 'internal' } } }))
    expect((await other.run('errors.unknown-method')).status).toBe('warn')
    const succeeds = await connectFake(compliant({ onRequest: (r) => (r.method === UNKNOWN_METHOD ? { result: {} } : undefined) }))
    expect((await succeeds.run('errors.unknown-method')).status).toBe('fail')
  })

  it('invalid-params: tools/call with {} -> -32602 pass, other code warn, success fail', async () => {
    const ok = await connectFake(compliant())
    expect((await ok.run('errors.invalid-params')).status).toBe('pass')
    expect(ok.calls('tools/call')[0].params).toEqual({})
    const other = await connectFake(compliant({ rejectMethods: { 'tools/call': { code: -32603, message: 'internal' } } }))
    expect((await other.run('errors.invalid-params')).status).toBe('warn')
    const succeeds = await connectFake(compliant({ onRequest: (r) => (r.method === 'tools/call' ? { result: { content: [] } } : undefined) }))
    expect((await succeeds.run('errors.invalid-params')).status).toBe('fail')
  })
})

describe('pagination.*', () => {
  it('terminates + no-duplicates pass over multi-page lists', async () => {
    const tools = Array.from({ length: 5 }, (_, i) => ({ name: `t${i}`, description: 'd', inputSchema: { type: 'object' } }))
    const env = await connectFake(compliant({ tools, pageSize: 2 }))
    const t = await env.run('pagination.terminates')
    expect(t.status).toBe('pass')
    expect(t.message).toContain('5 tools')
    expect((await env.run('pagination.no-duplicates')).status).toBe('pass')
  })

  it('terminates: a repeated cursor fails (loop)', async () => {
    const env = await connectFake(
      compliant({ onRequest: (r) => (r.method === 'tools/list' ? { result: { tools: [], nextCursor: 'same' } } : undefined) }),
    )
    const r = await env.run('pagination.terminates')
    expect(r.status).toBe('fail')
    expect(r.message).toContain('loop')
  })

  it('terminates: an endless sequence of fresh cursors fails at the page limit', async () => {
    let n = 0
    const env = await connectFake(
      compliant({ onRequest: (r) => (r.method === 'prompts/list' ? { result: { prompts: [], nextCursor: `c${n++}` } } : undefined) }),
    )
    const r = await env.run('pagination.terminates')
    expect(r.status).toBe('fail')
    expect(r.message).toContain('prompts/list')
    expect(r.message).toContain('page limit')
  })

  it('no-duplicates: a name repeated across pages fails; duplicate resource uri fails', async () => {
    const dupTools = await connectFake(
      compliant({
        pageSize: 1,
        tools: [
          { name: 'x', description: 'd', inputSchema: { type: 'object' } },
          { name: 'x', description: 'd', inputSchema: { type: 'object' } },
        ],
      }),
    )
    const a = await dupTools.run('pagination.no-duplicates')
    expect(a.status).toBe('fail')
    expect(a.message).toContain('tools/list')
    const dupRes = await connectFake(compliant({ resources: [{ uri: 'u://1', name: 'a' }, { uri: 'u://1', name: 'b' }] }))
    const b = await dupRes.run('pagination.no-duplicates')
    expect(b.status).toBe('fail')
    expect(b.message).toContain('u://1')
  })

  it('skips when no list capability is advertised', async () => {
    const env = await connectFake({ capabilities: {} })
    expect((await env.run('pagination.terminates')).status).toBe('skip')
    expect((await env.run('pagination.no-duplicates')).status).toBe('skip')
  })
})

describe('resources.* and prompts.*', () => {
  it('resources.shape: pass vs fail', async () => {
    const ok = await connectFake(compliant())
    expect((await ok.run('resources.shape')).status).toBe('pass')
    const bad = await connectFake(compliant({ resources: [{ uri: 'u://1' }, { name: 'n' }, { uri: 'u://3', name: 'ok' }] }))
    const r = await bad.run('resources.shape')
    expect(r.status).toBe('fail')
    expect(r.message).toContain('u://1')
  })

  it('resources.read-matches: pass; skip with none; fail on bad contents', async () => {
    const ok = await connectFake(compliant())
    expect((await ok.run('resources.read-matches')).status).toBe('pass')
    expect(ok.calls('resources/read')).toHaveLength(1)
    const none = await connectFake(compliant({ resources: [] }))
    expect((await none.run('resources.read-matches')).status).toBe('skip')
    const both = await connectFake(compliant({ resourceContents: { 'file:///a.txt': [{ uri: 'file:///a.txt', text: 't', blob: 'Zg==' }] } }))
    expect((await both.run('resources.read-matches')).status).toBe('fail')
    const neither = await connectFake(compliant({ resourceContents: { 'file:///a.txt': [{ uri: 'file:///a.txt' }] } }))
    expect((await neither.run('resources.read-matches')).status).toBe('fail')
    const noUri = await connectFake(compliant({ resourceContents: { 'file:///a.txt': [{ text: 't' }] } }))
    const r = await noUri.run('resources.read-matches')
    expect(r.status).toBe('fail')
    expect(r.message).toContain('uri')
    const readErr = await connectFake(compliant({ resourceContents: {} }))
    expect((await readErr.run('resources.read-matches')).status).toBe('fail')
  })

  it('prompts.shape: pass vs fail', async () => {
    const ok = await connectFake(compliant())
    expect((await ok.run('prompts.shape')).status).toBe('pass')
    const bad = await connectFake(compliant({ prompts: [{ name: 'a' }, { description: 'nameless' }] }))
    expect((await bad.run('prompts.shape')).status).toBe('fail')
  })

  it('prompts.missing-required-arg: error passes, success fails, no required arg skips', async () => {
    const ok = await connectFake(compliant())
    expect((await ok.run('prompts.missing-required-arg')).status).toBe('pass')
    expect((ok.calls('prompts/get')[0].params as { arguments: unknown }).arguments).toEqual({})
    const lax = await connectFake(compliant({ promptHandlers: { greet: () => ({ messages: [] }) } }))
    expect((await lax.run('prompts.missing-required-arg')).status).toBe('fail')
    const none = await connectFake(compliant({ prompts: [{ name: 'plain' }] }))
    expect((await none.run('prompts.missing-required-arg')).status).toBe('skip')
  })

  it('skip when the capability is absent', async () => {
    const env = await connectFake({ capabilities: {} })
    for (const id of ['resources.shape', 'resources.read-matches', 'prompts.shape', 'prompts.missing-required-arg']) {
      expect((await env.run(id)).status).toBe('skip')
    }
  })
})

describe('perf.ping-latency', () => {
  it('sends 5 sequential pings and reports min/median/max as info', async () => {
    const env = await connectFake(compliant())
    const before = env.calls('ping').length
    const r = await env.run('perf.ping-latency')
    expect(env.calls('ping').length - before).toBe(5)
    expect(r.status).toBe('info')
    expect(r.message).toMatch(/min \d+ ms \/ median \d+ ms \/ max \d+ ms/)
  })

  it('warns when the median is over 2000 ms, fails when a ping fails', async () => {
    const times = [10, 3000, 2500, 20, 4000]
    let i = 0
    const slow = { session: { rawRequest: async () => ({ ok: true, result: {}, durationMs: times[i++] }) }, info: {}, sessionOptions: { config: cfg() } } as unknown as CheckContext
    const r = await getCheck('perf.ping-latency')!.run(slow)
    expect(r.status).toBe('warn')
    expect(r.message).toContain('median 2500 ms')
    const failing = { session: { rawRequest: async () => ({ ok: false, error: { code: -1, message: 'x' }, durationMs: 1 }) }, info: {}, sessionOptions: { config: cfg() } } as unknown as CheckContext
    expect((await getCheck('perf.ping-latency')!.run(failing)).status).toBe('fail')
  })
})

describe('tools.call-smoke (opt-in)', () => {
  it('calls only read-only tools without required args and passes on content', async () => {
    const env = await connectFake(compliant())
    const r = await env.run('tools.call-smoke')
    expect(r.status).toBe('pass')
    expect(env.calls('tools/call').map((m) => m.params?.name)).toEqual(['now']) // not echo (required arg), not wipe (destructive)
  })

  it('fails when a result has neither content nor structuredContent, or the call errors', async () => {
    const empty = await connectFake(compliant({ toolHandlers: { now: () => ({ foo: 1 }) } }))
    expect((await empty.run('tools.call-smoke')).status).toBe('fail')
    const err = await connectFake(compliant({ toolHandlers: {} }))
    expect((await err.run('tools.call-smoke')).status).toBe('fail')
    const structured = await connectFake(compliant({ toolHandlers: { now: () => ({ structuredContent: { t: 1 } }) } }))
    expect((await structured.run('tools.call-smoke')).status).toBe('pass')
  })

  it('skips when nothing is eligible, and calls nothing', async () => {
    const env = await connectFake(
      compliant({ tools: [{ name: 'echo', description: 'd', inputSchema: { type: 'object', required: ['a'] }, annotations: { readOnlyHint: true } }, { name: 'w', description: 'd', inputSchema: { type: 'object' } }] }),
    )
    expect((await env.run('tools.call-smoke')).status).toBe('skip')
    expect(env.calls('tools/call')).toHaveLength(0)
  })
})

describe('result messages never carry configured secrets', () => {
  it('scrubs a header token that a server-controlled name echoes into a message', async () => {
    const config = cfg({ headers: [{ name: 'Authorization', value: 'Bearer SECRET-TOKEN-1' }] })
    const env = await connectFake(compliant({ tools: [{ name: 'SECRET-TOKEN-1', inputSchema: { type: 'object' } }] }), config)
    const r = await env.run('tools.descriptions-present')
    expect(r.status).toBe('warn')
    expect(r.message).not.toContain('SECRET-TOKEN-1')
    expect(r.message).toContain('[redacted]')
  })
})

// ---------------------------------------------------------------------------
// http.* checks run against a fetch stub behind the real Streamable HTTP transport
// ---------------------------------------------------------------------------

interface HttpCall {
  method: string
  headers: Record<string, string>
  body?: { method?: string; id?: unknown }
}

function httpStub(o: { notificationStatus?: number; deleteStatus?: number; deadSessionStatus?: number; noSession?: boolean } = {}) {
  const calls: HttpCall[] = []
  const dead = new Set<string>()
  let next = 1
  const json = (body: unknown, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json', ...headers } })
  const fetchImpl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const headers: Record<string, string> = {}
    new Headers(init?.headers).forEach((v, k) => (headers[k] = v))
    const method = init?.method ?? 'GET'
    const body = init?.body ? (JSON.parse(String(init.body)) as HttpCall['body']) : undefined
    calls.push({ method, headers, body })
    const sid = headers['mcp-session-id']
    if (method === 'DELETE') {
      if (sid && (o.deleteStatus ?? 200) < 300) dead.add(sid)
      return new Response(null, { status: o.deleteStatus ?? 200 })
    }
    if (method === 'GET') return new Response(null, { status: 405 })
    if (body?.method === 'server/discover') return json({ jsonrpc: '2.0', id: body.id, error: { code: -32601, message: 'nope' } })
    if (body?.method === 'initialize') {
      return json(
        { jsonrpc: '2.0', id: body.id, result: { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'http-stub', version: '1.0.0' } } },
        o.noSession ? {} : { 'mcp-session-id': `sess-${next++}` },
      )
    }
    if (sid && dead.has(sid)) return new Response('session gone', { status: o.deadSessionStatus ?? 404 })
    if (body?.id === undefined) return new Response(null, { status: o.notificationStatus ?? 202 })
    return json({ jsonrpc: '2.0', id: body.id, result: {} })
  }) as typeof fetch
  return { fetchImpl, calls, dead }
}

function realFactory(kinds: TransportKind[] = []): NonNullable<SessionOptions['transportFactory']> {
  return (kind, c) => {
    kinds.push(kind)
    const o = { fetch: c.fetch, requestInit: { headers: c.headers }, authProvider: c.authProvider }
    return kind === 'sse' ? new SSEClientTransport(c.url, o) : new StreamableHTTPClientTransport(c.url, o)
  }
}

async function connectHttp(
  stub: ReturnType<typeof httpStub>,
  extra: Partial<Omit<SessionOptions, 'onLog' | 'onState'>> = {},
  config: ConnectionConfig = cfg({ headers: [{ name: 'Authorization', value: 'Bearer SECRET-TOKEN-1' }] }),
) {
  const base: Omit<SessionOptions, 'onLog' | 'onState'> = { config, fetchImpl: stub.fetchImpl, transportFactory: realFactory(), ...extra }
  const session = createSession({ ...base, onLog: () => undefined, onState: () => undefined })
  open.push(session)
  const state = await session.connect()
  if (state.status !== 'connected') throw new Error(`http stub did not connect: ${JSON.stringify(state)}`)
  const ctx: CheckContext = { session, info: state.info, sessionOptions: base, signal: new AbortController().signal, cache: new Map() }
  return { ctx, session, info: state.info as ServerSummary, run: (id: string) => getCheck(id)!.run(ctx) }
}

describe('http.notification-202', () => {
  it('passes on 202, sending notifications/initialized with the session headers', async () => {
    const stub = httpStub()
    const env = await connectHttp(stub)
    const before = stub.calls.length
    const r = await env.run('http.notification-202')
    expect(r.status).toBe('pass')
    const call = stub.calls.slice(before).find((c) => c.body?.method === 'notifications/initialized')!
    expect(call.method).toBe('POST')
    expect(call.headers['mcp-session-id']).toBe(env.info.sessionId)
    expect(call.headers.authorization).toBe('Bearer SECRET-TOKEN-1')
  })

  it('warns on 200 or 204, fails on anything else', async () => {
    for (const status of [200, 204]) {
      const stub = httpStub()
      const env = await connectHttp(stub)
      const lax = httpStub({ notificationStatus: status })
      const r = await getCheck('http.notification-202')!.run({ ...env.ctx, sessionOptions: { ...env.ctx.sessionOptions, fetchImpl: lax.fetchImpl } })
      expect(r.status).toBe('warn')
      expect(r.message).toContain(String(status))
    }
  })

  it('skips for SSE, for OAuth profiles, without a session id, and without fetch', async () => {
    const env = await connectHttp(httpStub())
    const sse = { ...env.ctx, info: { ...env.ctx.info, transport: 'sse' as const } }
    const r1 = await getCheck('http.notification-202')!.run(sse)
    expect(r1.status).toBe('skip')
    expect(r1.message).toContain('Streamable HTTP')
    const oauth = { ...env.ctx, sessionOptions: { ...env.ctx.sessionOptions, authProvider: {} as OAuthClientProvider } }
    const r2 = await getCheck('http.notification-202')!.run(oauth)
    expect(r2.status).toBe('skip')
    expect(r2.message).toContain('OAuth')
    const noSession = await connectHttp(httpStub({ noSession: true }))
    const r3 = await noSession.run('http.notification-202')
    expect(r3.status).toBe('skip')
    expect(r3.message).toContain('session id')
    vi.stubGlobal('fetch', undefined)
    const noFetch = { ...env.ctx, sessionOptions: { ...env.ctx.sessionOptions, fetchImpl: undefined } }
    const r4 = await getCheck('http.notification-202')!.run(noFetch)
    expect(r4.status).toBe('skip')
    expect(r4.message).toContain('fetch')
  })

  it('fails when the notification POST is rejected', async () => {
    const stub = httpStub()
    const env = await connectHttp(stub)
    const failing = httpStub({ notificationStatus: 400 })
    const ctx = { ...env.ctx, sessionOptions: { ...env.ctx.sessionOptions, fetchImpl: failing.fetchImpl } }
    const r = await getCheck('http.notification-202')!.run(ctx)
    expect(r.status).toBe('fail')
    expect(r.message).toContain('400')
  })
})

describe('http.session-delete', () => {
  it('passes with a throwaway session: DELETE 200 then the dead id is rejected with 404', async () => {
    const stub = httpStub()
    const env = await connectHttp(stub)
    const mainId = env.info.sessionId
    const r = await env.run('http.session-delete')
    expect(r.status).toBe('pass')
    expect(r.message).toContain('404')
    const deletes = stub.calls.filter((c) => c.method === 'DELETE')
    expect(deletes.length).toBeGreaterThan(0)
    expect(deletes.every((d) => d.headers['mcp-session-id'] !== mainId)).toBe(true) // the main session is never terminated
    expect(stub.dead.has(mainId!)).toBe(false)
    expect(env.session.getState().status).toBe('connected')
    expect(r.message).not.toContain(mainId!)
  })

  it('DELETE 405 -> pass "Server does not allow client session termination"', async () => {
    const env = await connectHttp(httpStub({ deleteStatus: 405 }))
    const r = await env.run('http.session-delete')
    expect(r.status).toBe('pass')
    expect(r.message).toBe('Server does not allow client session termination')
  })

  it('other DELETE status -> fail; a live dead-session id (not 404) -> warn', async () => {
    const bad = await connectHttp(httpStub({ deleteStatus: 500 }))
    const f = await bad.run('http.session-delete')
    expect(f.status).toBe('fail')
    expect(f.message).toContain('500')
    const lenient = await connectHttp(httpStub({ deadSessionStatus: 400 }))
    const w = await lenient.run('http.session-delete')
    expect(w.status).toBe('warn')
    expect(w.message).toContain('400')
  })

  it('skips for SSE, OAuth profiles, and servers without session ids', async () => {
    const env = await connectHttp(httpStub())
    expect((await getCheck('http.session-delete')!.run({ ...env.ctx, info: { ...env.ctx.info, transport: 'sse' } })).status).toBe('skip')
    const oauth = { ...env.ctx, sessionOptions: { ...env.ctx.sessionOptions, authProvider: {} as OAuthClientProvider } }
    expect((await getCheck('http.session-delete')!.run(oauth)).status).toBe('skip')
    const none = await connectHttp(httpStub({ noSession: true }))
    const r = await none.run('http.session-delete')
    expect(r.status).toBe('skip')
    expect(r.message).toContain('session id')
  })

  it('fails (not throws) when the throwaway session cannot connect', async () => {
    const env = await connectHttp(httpStub())
    const broken: CheckContext = {
      ...env.ctx,
      sessionOptions: {
        ...env.ctx.sessionOptions,
        transportFactory: () => {
          throw new UnauthorizedError()
        },
      },
    }
    const r = await getCheck('http.session-delete')!.run(broken)
    expect(r.status).toBe('fail')
    expect(r.message).toContain('throwaway')
  })

  it('forwards probe traffic to ctx.onLog with the Authorization header redacted', async () => {
    const stub = httpStub()
    const env = await connectHttp(stub)
    const logs: LogEntryInput[] = []
    await getCheck('http.notification-202')!.run({ ...env.ctx, onLog: (e) => logs.push(e) })
    const text = JSON.stringify(logs)
    expect(logs.some((l) => l.kind === 'http')).toBe(true)
    expect(text).not.toContain('SECRET-TOKEN-1')
  })
})
