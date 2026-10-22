import { describe, it, expect, vi } from 'vitest'
import { Client, ResourceNotFoundError } from '@modelcontextprotocol/client'
import { createFakeServer } from './fakeServer'

const tool = (name: string) => ({ name, description: `tool ${name}`, inputSchema: { type: 'object', properties: {} } })

async function connect(server: ReturnType<typeof createFakeServer>, capabilities = {}) {
  const client = new Client({ name: 'test', version: '0' }, { capabilities })
  await client.connect(server.clientTransport)
  return client
}

describe('createFakeServer', () => {
  it('answers initialize with the configured identity, capabilities and instructions', async () => {
    const server = createFakeServer({
      serverInfo: { name: 'acme', version: '9.9.9' },
      capabilities: { tools: {} },
      instructions: 'be nice',
    })
    const client = await connect(server)
    expect(client.getServerVersion()).toMatchObject({ name: 'acme', version: '9.9.9' })
    expect(client.getServerCapabilities()).toEqual({ tools: {} })
    expect(client.getInstructions()).toBe('be nice')
    await client.close()
  })

  it('pages tools/list with pageSize 2 and 5 tools into 3 pages linked by nextCursor', async () => {
    const server = createFakeServer({ tools: ['a', 'b', 'c', 'd', 'e'].map(tool), pageSize: 2 })
    const client = await connect(server)
    // client.listTools() with no cursor auto-aggregates every page; client.request() is the raw single-page call.
    const page = (cursor?: string) =>
      client.request({ method: 'tools/list', params: cursor ? { cursor } : {} }) as Promise<{ tools: { name: string }[]; nextCursor?: string }>
    const p1 = await page()
    expect(p1.tools.map((t) => t.name)).toEqual(['a', 'b'])
    expect(p1.nextCursor).toBeTruthy()
    const p2 = await page(p1.nextCursor)
    expect(p2.tools.map((t) => t.name)).toEqual(['c', 'd'])
    expect(p2.nextCursor).toBeTruthy()
    const p3 = await page(p2.nextCursor)
    expect(p3.tools.map((t) => t.name)).toEqual(['e'])
    expect(p3.nextCursor).toBeUndefined()
    await client.close()
  })

  it('the SDK auto-aggregates all pages when listTools has no cursor', async () => {
    const server = createFakeServer({ tools: ['a', 'b', 'c', 'd', 'e'].map(tool), pageSize: 2 })
    const client = await connect(server)
    const all = await client.listTools({})
    expect(all.tools.map((t) => t.name)).toEqual(['a', 'b', 'c', 'd', 'e'])
    expect(server.received.filter((m) => (m as { method?: string }).method === 'tools/list')).toHaveLength(3)
    await client.close()
  })

  it('returns everything on one page without pageSize', async () => {
    const server = createFakeServer({ tools: ['a', 'b', 'c'].map(tool) })
    const client = await connect(server)
    const r = (await client.listTools({})) as { tools: unknown[]; nextCursor?: string }
    expect(r.tools).toHaveLength(3)
    expect(r.nextCursor).toBeUndefined()
    await client.close()
  })

  it('returns the configured error for rejectMethods and -32601 for unknown methods', async () => {
    const server = createFakeServer({
      capabilities: { tools: {} },
      rejectMethods: { 'tools/list': { code: -32000, message: 'nope', data: { why: 'test' } } },
    })
    const client = await connect(server)
    await expect(client.listTools({})).rejects.toMatchObject({ code: -32000, message: 'nope', data: { why: 'test' } })
    await expect(client.request({ method: 'custom/unknown' }, { '~standard': { version: 1, vendor: 't', validate: (v: unknown) => ({ value: v }) } })).rejects.toMatchObject({
      code: -32601,
    })
    await client.close()
  })

  it('runs tool handlers and turns thrown rpc errors into error responses', async () => {
    const server = createFakeServer({
      capabilities: { tools: {} },
      tools: [tool('echo'), tool('bad')],
      toolHandlers: {
        echo: (args) => ({ content: [{ type: 'text', text: String(args.msg) }] }),
        bad: () => {
          throw { code: -32602, message: 'invalid' }
        },
      },
    })
    const client = await connect(server)
    expect(await client.callTool({ name: 'echo', arguments: { msg: 'hi' } })).toMatchObject({ content: [{ type: 'text', text: 'hi' }] })
    await expect(client.callTool({ name: 'bad', arguments: {} })).rejects.toMatchObject({ code: -32602 })
    await expect(client.callTool({ name: 'missing', arguments: {} })).rejects.toMatchObject({ code: -32602 })
    await client.close()
  })

  it('serves resources, templates, resource contents and prompts', async () => {
    const server = createFakeServer({
      resources: [{ uri: 'mem://a', name: 'a' }],
      resourceTemplates: [{ uriTemplate: 'mem://{x}', name: 't' }],
      resourceContents: { 'mem://a': [{ uri: 'mem://a', text: 'hello' }] },
      prompts: [{ name: 'p' }],
      promptHandlers: { p: (args) => ({ messages: [{ role: 'user', content: { type: 'text', text: args.who ?? '' } }] }) },
    })
    const client = await connect(server)
    expect((await client.listResources({})).resources).toHaveLength(1)
    expect((await client.listResourceTemplates({})).resourceTemplates).toHaveLength(1)
    expect((await client.readResource({ uri: 'mem://a' })).contents[0]).toMatchObject({ text: 'hello' })
    await expect(client.readResource({ uri: 'mem://zzz' })).rejects.toBeInstanceOf(ResourceNotFoundError)
    expect((await client.listPrompts({})).prompts).toHaveLength(1)
    expect((await client.getPrompt({ name: 'p', arguments: { who: 'me' } })).messages).toHaveLength(1)
    await client.close()
  })

  it('records every client message in `received` and lets onRequest observe or override', async () => {
    const seen: string[] = []
    const server = createFakeServer({
      onRequest: ({ method }) => {
        seen.push(method)
        if (method === 'ping') return { error: { code: -32099, message: 'overridden' } }
      },
    })
    const client = await connect(server)
    await expect(client.ping()).rejects.toMatchObject({ code: -32099 })
    expect(seen).toContain('initialize')
    const methods = server.received.map((m) => (m as { method?: string }).method)
    expect(methods).toContain('initialize')
    expect(methods).toContain('notifications/initialized')
    expect(methods).toContain('ping')
    await client.close()
  })

  it('does not answer when onRequest returns no-response', async () => {
    const server = createFakeServer({ onRequest: ({ method }) => (method === 'ping' ? 'no-response' : undefined) })
    const client = await connect(server)
    await expect(client.ping({ timeout: 40 })).rejects.toThrow(/timed out/i)
    await client.close()
  })

  it('delays responses by latencyMs', async () => {
    const server = createFakeServer({ latencyMs: 30 })
    const t0 = Date.now()
    const client = await connect(server)
    expect(Date.now() - t0).toBeGreaterThanOrEqual(25)
    await client.close()
  })

  it('delivers server notifications to the client', async () => {
    const server = createFakeServer({ capabilities: { tools: { listChanged: true } } })
    const client = await connect(server)
    const got: unknown[] = []
    client.fallbackNotificationHandler = async (n) => {
      got.push(n)
    }
    await server.sendNotification('notifications/custom', { a: 1 })
    await vi.waitFor(() => expect(got).toHaveLength(1))
    expect(got[0]).toMatchObject({ method: 'notifications/custom', params: { a: 1 } })
    await client.close()
  })

  it('sendRequest delivers a server-to-client request and resolves with the client reply', async () => {
    const server = createFakeServer()
    const client = await connect(server, { roots: {} })
    client.setRequestHandler('roots/list', () => ({ roots: [{ uri: 'file:///work', name: 'work' }] }))
    const reply = await server.sendRequest('roots/list')
    expect(reply).toEqual({ result: { roots: [{ uri: 'file:///work', name: 'work' }] } })
    await client.close()
  })

  it('sendRequest resolves with an error reply when the client has no handler', async () => {
    const server = createFakeServer()
    const client = await connect(server)
    const reply = await server.sendRequest('roots/list')
    expect('error' in reply && reply.error.code).toBe(-32601)
    await client.close()
  })
})
