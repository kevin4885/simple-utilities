import { describe, it, expect, vi } from 'vitest'
import type { JSONRPCMessage, Transport } from '@modelcontextprotocol/client'
import { createFetchTap, TappedTransport } from './tap'
import type { LogEntryInput } from './types'

function response(status: number, headers: Record<string, string> = {}): Response {
  return new Response(status === 204 ? null : '{}', { status, headers })
}

describe('createFetchTap', () => {
  it('also strips guarded headers carried by a Request object sent cross-origin, and logs them redacted', async () => {
    const logs: LogEntryInput[] = []
    const inner = vi.fn<typeof fetch>(async () => response(200))
    const tap = createFetchTap({
      fetch: inner,
      onLog: (e) => logs.push(e),
      now: () => 0,
      originGuard: { origin: 'https://mcp.test', headerNames: ['X-Api-Key'] },
    })
    await tap(new Request('https://auth.other.test/token', { method: 'POST', headers: { 'X-Api-Key': 'KEYVALUE9', Accept: 'a' } }))
    const sent = inner.mock.calls[0][0] as Request
    expect(sent.headers.get('x-api-key')).toBeNull()
    expect(sent.headers.get('accept')).toBe('a')
    expect(JSON.stringify(logs)).not.toContain('KEYVALUE9')
  })

  it('forwards the request unmodified and returns the response', async () => {
    const logs: LogEntryInput[] = []
    const inner = vi.fn<typeof fetch>(async () => response(200))
    const tap = createFetchTap({ fetch: inner, onLog: (e) => logs.push(e), now: () => 0 })
    const init = { method: 'POST', headers: { Accept: 'x' }, body: '{"a":1}' }
    const res = await tap('https://x.test/mcp', init)
    expect(res.status).toBe(200)
    expect(inner).toHaveBeenCalledWith('https://x.test/mcp', init)
  })

  it('redacts secret request/response headers, including user-configured names, and records timing', async () => {
    const logs: LogEntryInput[] = []
    let t = 1000
    const tap = createFetchTap({
      fetch: (async () => {
        t += 25
        return response(200, { 'Set-Cookie': 'sid=SECRETCOOKIE', 'Mcp-Session-Id': 'abc' })
      }) as unknown as typeof fetch,
      onLog: (e) => logs.push(e),
      now: () => t,
      secretHeaderNames: ['X-Tenant'],
    })
    await tap('https://x.test/mcp', {
      method: 'POST',
      headers: { Authorization: 'Bearer SECRET123', 'X-Tenant': 'acme', Accept: 'application/json' },
    })
    expect(logs).toHaveLength(1)
    const e = logs[0]
    if (e.kind !== 'http') throw new Error('expected http entry')
    expect(e.method).toBe('POST')
    expect(e.status).toBe(200)
    expect(e.durationMs).toBe(25)
    expect(e.error).toBeNull()
    expect(e.requestHeaders).toEqual({ Authorization: '[redacted]', 'X-Tenant': '[redacted]', Accept: 'application/json' })
    expect(e.responseHeaders?.['set-cookie']).toBe('[redacted]')
    expect(e.responseHeaders?.['mcp-session-id']).toBe('abc')
    expect(JSON.stringify(logs)).not.toContain('SECRET')
  })

  it('reads headers given as Headers or as pair arrays', async () => {
    const logs: LogEntryInput[] = []
    const tap = createFetchTap({ fetch: (async () => response(204)) as unknown as typeof fetch, onLog: (e) => logs.push(e), now: () => 0 })
    await tap('https://x.test/', { headers: new Headers({ Authorization: 'Bearer TOK', Accept: 'a' }) })
    await tap('https://x.test/', { headers: [['Authorization', 'Bearer TOK2']] })
    expect(JSON.stringify(logs)).not.toContain('TOK')
    expect(logs[0].kind === 'http' && logs[0].requestHeaders.accept).toBe('a')
  })

  it('logs a network failure with status null and rethrows the original error', async () => {
    const logs: LogEntryInput[] = []
    const boom = new TypeError('Failed to fetch')
    const tap = createFetchTap({
      fetch: (async () => {
        throw boom
      }) as unknown as typeof fetch,
      onLog: (e) => logs.push(e),
      now: () => 5,
    })
    await expect(tap('https://x.test/mcp', { method: 'GET' })).rejects.toBe(boom)
    const e = logs[0]
    if (e.kind !== 'http') throw new Error('expected http entry')
    expect(e.status).toBeNull()
    expect(e.responseHeaders).toBeNull()
    expect(e.error).toBe('Failed to fetch')
  })

  it('scrubs secrets out of logged URLs and error text', async () => {
    const logs: LogEntryInput[] = []
    const tap = createFetchTap({
      fetch: (async () => {
        throw new Error('bad token SECRET123 rejected')
      }) as unknown as typeof fetch,
      onLog: (e) => logs.push(e),
      now: () => 0,
      secretFragments: ['SECRET123'],
    })
    await expect(tap('https://x.test/mcp?api_key=SECRET123&x=1')).rejects.toThrow()
    expect(JSON.stringify(logs)).not.toContain('SECRET123')
  })

  describe('learning OAuth credentials (onLearn)', () => {
    const jsonResponse = (body: unknown, type = 'application/json') =>
      new Response(typeof body === 'string' ? body : JSON.stringify(body), { status: 200, headers: { 'content-type': type } })

    it('reports tokens from a JSON response BEFORE logging it, and still hands the SDK an unread body', async () => {
      const learned: string[][] = []
      const logs: LogEntryInput[] = []
      const tap = createFetchTap({
        fetch: (async () => jsonResponse({ access_token: 'ACCESS-TOKEN-1', refresh_token: 'REFRESH-TOKEN-1', token_type: 'Bearer' })) as unknown as typeof fetch,
        onLog: (e) => {
          expect(learned.length).toBeGreaterThan(0) // learned first
          logs.push(e)
        },
        now: () => 0,
        onLearn: (f) => learned.push(f),
      })
      const res = await tap('https://auth.test/token', { method: 'POST' })
      expect(learned.flat()).toEqual(['ACCESS-TOKEN-1', 'REFRESH-TOKEN-1'])
      expect((await res.json()).access_token).toBe('ACCESS-TOKEN-1')
      expect(logs).toHaveLength(1)
    })

    it('reports the code, verifier and client secret from a form-encoded request body', async () => {
      const learned: string[][] = []
      const tap = createFetchTap({
        fetch: (async () => jsonResponse({})) as unknown as typeof fetch,
        onLog: () => undefined,
        now: () => 0,
        onLearn: (f) => learned.push(f),
      })
      await tap('https://auth.test/token', {
        method: 'POST',
        body: new URLSearchParams({ grant_type: 'authorization_code', code: 'AUTH-CODE-1', code_verifier: 'VERIFIER-1', client_secret: 'CLIENT-SECRET-1', client_id: 'public' }),
      })
      expect(learned.flat().sort()).toEqual(['AUTH-CODE-1', 'CLIENT-SECRET-1', 'VERIFIER-1'])
    })

    it('reports a client secret from a JSON registration response', async () => {
      const learned: string[][] = []
      const tap = createFetchTap({
        fetch: (async () => jsonResponse({ client_id: 'c', client_secret: 'CLIENT-SECRET-2' })) as unknown as typeof fetch,
        onLog: () => undefined,
        now: () => 0,
        onLearn: (f) => learned.push(f),
      })
      await tap('https://auth.test/register', { method: 'POST', body: '{"redirect_uris":["https://a/cb"]}' })
      expect(learned.flat()).toEqual(['CLIENT-SECRET-2'])
    })

    it('never reads an event stream (it would block on a long-lived SSE response)', async () => {
      const learned: string[][] = []
      let read = false
      const sse = new Response(
        new ReadableStream(
          {
            pull() {
              read = true
            },
          },
          { highWaterMark: 0 }, // pull only when something actually reads
        ),
        { status: 200, headers: { 'content-type': 'text/event-stream' } },
      )
      const tap = createFetchTap({ fetch: (async () => sse) as unknown as typeof fetch, onLog: () => undefined, now: () => 0, onLearn: (f) => learned.push(f) })
      await tap('https://mcp.test/mcp')
      expect(read).toBe(false)
      expect(learned).toEqual([])
    })

    it('does nothing for ordinary bodies, binary content or when onLearn is not set', async () => {
      const learned: string[][] = []
      const tap = createFetchTap({
        fetch: (async (_i: unknown, init?: RequestInit) =>
          init?.method === 'GET' ? jsonResponse('{"tools":[]}') : new Response('access_token=nope', { status: 200, headers: { 'content-type': 'application/octet-stream' } })) as unknown as typeof fetch,
        onLog: () => undefined,
        now: () => 0,
        onLearn: (f) => learned.push(f),
      })
      await tap('https://mcp.test/mcp', { method: 'GET' })
      await tap('https://mcp.test/blob', { method: 'POST', body: 'hello' })
      expect(learned).toEqual([])
      const plain = createFetchTap({ fetch: (async () => jsonResponse({ access_token: 'ACCESS-TOKEN-9' })) as unknown as typeof fetch, onLog: () => undefined, now: () => 0 })
      expect((await (await plain('https://auth.test/token')).json()).access_token).toBe('ACCESS-TOKEN-9')
    })

    it('a read failure never breaks the request', async () => {
      const tap = createFetchTap({
        fetch: (async () => {
          const r = jsonResponse({ access_token: 'ACCESS-TOKEN-1' })
          r.clone = () => {
            throw new Error('clone failed')
          }
          return r
        }) as unknown as typeof fetch,
        onLog: () => undefined,
        now: () => 0,
        onLearn: () => undefined,
      })
      expect((await tap('https://auth.test/token')).status).toBe(200)
    })
  })

  it('strips configured custom headers from requests that leave the server origin', async () => {
    const logs: LogEntryInput[] = []
    const inner = vi.fn<typeof fetch>(async () => response(200))
    const tap = createFetchTap({
      fetch: inner,
      onLog: (e) => logs.push(e),
      now: () => 0,
      originGuard: { origin: 'https://mcp.test', headerNames: ['X-Api-Key'] },
    })
    await tap('https://auth.other.test/token', { method: 'POST', headers: { 'X-Api-Key': 'KEY', 'Content-Type': 'application/x-www-form-urlencoded' } })
    expect(inner.mock.calls[0][1]?.headers).toEqual({ 'Content-Type': 'application/x-www-form-urlencoded' })
    await tap('https://mcp.test/mcp', { method: 'POST', headers: { 'X-Api-Key': 'KEY' } })
    expect(inner.mock.calls[1][1]?.headers).toEqual({ 'X-Api-Key': 'KEY' })
  })
})

class StubTransport implements Transport {
  onmessage?: Transport['onmessage']
  onclose?: Transport['onclose']
  onerror?: Transport['onerror']
  sessionId = 'sess-1'
  sent: JSONRPCMessage[] = []
  failSend = false
  started = 0
  closed = 0
  protocolVersion: string | undefined
  async start() {
    this.started++
  }
  async close() {
    this.closed++
    this.onclose?.()
  }
  async send(m: JSONRPCMessage) {
    if (this.failSend) throw new Error('send failed')
    this.sent.push(m)
  }
  setProtocolVersion(v: string) {
    this.protocolVersion = v
  }
}

describe('TappedTransport', () => {
  const setup = (now = () => 0) => {
    const inner = new StubTransport()
    const logs: LogEntryInput[] = []
    const inbound: JSONRPCMessage[] = []
    const tapped = new TappedTransport(inner, { onLog: (e) => logs.push(e), now, onInbound: (m) => inbound.push(m) })
    const received: JSONRPCMessage[] = []
    tapped.onmessage = (m) => received.push(m)
    return { inner, logs, inbound, tapped, received }
  }
  const rpc = (e: LogEntryInput) => {
    if (e.kind !== 'rpc') throw new Error('expected rpc entry')
    return e
  }

  it('forwards outbound and inbound messages unmodified (same object) and logs them', async () => {
    const { inner, logs, tapped, received } = setup()
    const req = { jsonrpc: '2.0', id: 1, method: 'ping' } as JSONRPCMessage
    await tapped.send(req)
    expect(inner.sent[0]).toBe(req)
    const res = { jsonrpc: '2.0', id: 1, result: {} } as JSONRPCMessage
    inner.onmessage?.(res)
    expect(received[0]).toBe(res)
    expect(rpc(logs[0]).message).toBe(req)
    expect(rpc(logs[1]).message).toBe(res)
  })

  it('pairs a response with its request: rpcId equal, integer durationMs, requests have null', async () => {
    let t = 100
    const { inner, logs, tapped } = setup(() => t)
    await tapped.send({ jsonrpc: '2.0', id: 7, method: 'tools/list' } as JSONRPCMessage)
    t = 142
    inner.onmessage?.({ jsonrpc: '2.0', id: 7, result: { tools: [] } } as JSONRPCMessage)
    const out = rpc(logs[0])
    const inn = rpc(logs[1])
    expect(out).toMatchObject({ direction: 'out', method: 'tools/list', rpcId: 7, durationMs: null })
    expect(inn).toMatchObject({ direction: 'in', method: null, rpcId: 7, durationMs: 42 })
    expect(Number.isInteger(inn.durationMs)).toBe(true)
  })

  it('logs error responses with duration and notifications with rpcId null', async () => {
    let t = 0
    const { inner, logs, tapped } = setup(() => t)
    await tapped.send({ jsonrpc: '2.0', id: 'a', method: 'x' } as JSONRPCMessage)
    t = 3
    inner.onmessage?.({ jsonrpc: '2.0', id: 'a', error: { code: -32601, message: 'nope' } } as JSONRPCMessage)
    await tapped.send({ jsonrpc: '2.0', method: 'notifications/initialized' } as JSONRPCMessage)
    inner.onmessage?.({ jsonrpc: '2.0', method: 'notifications/message', params: { level: 'info' } } as JSONRPCMessage)
    expect(rpc(logs[1])).toMatchObject({ rpcId: 'a', durationMs: 3 })
    expect(rpc(logs[2])).toMatchObject({ direction: 'out', method: 'notifications/initialized', rpcId: null, durationMs: null })
    expect(rpc(logs[3])).toMatchObject({ direction: 'in', method: 'notifications/message', rpcId: null, durationMs: null })
  })

  it('an unmatched response and a server-to-client request have null duration', () => {
    const { inner, logs } = setup()
    inner.onmessage?.({ jsonrpc: '2.0', id: 99, result: {} } as JSONRPCMessage)
    inner.onmessage?.({ jsonrpc: '2.0', id: 's1', method: 'roots/list' } as JSONRPCMessage)
    expect(rpc(logs[0]).durationMs).toBeNull()
    expect(rpc(logs[1])).toMatchObject({ method: 'roots/list', rpcId: 's1', durationMs: null })
  })

  it('still logs the outbound message and rethrows when the inner send fails', async () => {
    const { inner, logs, tapped } = setup()
    inner.failSend = true
    await expect(tapped.send({ jsonrpc: '2.0', id: 1, method: 'ping' } as JSONRPCMessage)).rejects.toThrow('send failed')
    expect(logs).toHaveLength(1)
  })

  it('delivers to the SDK handler before observers, and observers cannot break delivery', () => {
    const order: string[] = []
    const inner = new StubTransport()
    const tapped = new TappedTransport(inner, {
      onLog: () => undefined,
      now: () => 0,
      onInbound: () => {
        order.push('observer')
        throw new Error('observer bug')
      },
    })
    tapped.onmessage = () => order.push('sdk')
    expect(() => inner.onmessage?.({ jsonrpc: '2.0', method: 'notifications/x' } as JSONRPCMessage)).not.toThrow()
    expect(order).toEqual(['sdk', 'observer'])
  })

  it('still runs observers when the SDK handler throws', () => {
    const inner = new StubTransport()
    const inbound: JSONRPCMessage[] = []
    const tapped = new TappedTransport(inner, { onLog: () => undefined, now: () => 0, onInbound: (m) => inbound.push(m) })
    tapped.onmessage = () => {
      throw new Error('sdk handler bug')
    }
    expect(() => inner.onmessage?.({ jsonrpc: '2.0', method: 'notifications/x' } as JSONRPCMessage)).toThrow('sdk handler bug')
    expect(inbound).toHaveLength(1)
  })

  it('proxies lifecycle, session id and protocol-version hooks', async () => {
    const { inner, tapped } = setup()
    const onclose = vi.fn()
    const onerror = vi.fn()
    tapped.onclose = onclose
    tapped.onerror = onerror
    await tapped.start()
    tapped.setProtocolVersion('2025-06-18')
    expect(inner.started).toBe(1)
    expect(inner.protocolVersion).toBe('2025-06-18')
    expect(tapped.sessionId).toBe('sess-1')
    const err = new Error('x')
    inner.onerror?.(err)
    expect(onerror).toHaveBeenCalledWith(err)
    await tapped.close()
    expect(inner.closed).toBe(1)
    expect(onclose).toHaveBeenCalledTimes(1)
  })
})
