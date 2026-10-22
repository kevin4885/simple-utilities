import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Client } from '@modelcontextprotocol/client'
import { createFakeServer, type FakeServer } from '../testing/fakeServer'
import { createSession, type McpSession } from '../connection/session'
import type { ClientFeatureSetup, ConnectionConfig } from '../connection/types'
import { DEFAULT_SETTINGS, type ClientSettings } from './logic'
import { useClientPending } from './pendingStore'
import { clientFeatureSetup, createClientFeatureSetup } from './register'
import { useClientSettings } from './settingsStore'

const CONFIG: ConnectionConfig = { url: 'https://mcp.test/mcp', transport: 'streamable-http', headers: [], protocolVersion: null }

function setSettings(over: Partial<ClientSettings>) {
  useClientSettings.setState({ ...DEFAULT_SETTINGS, ...over })
}

beforeEach(() => {
  localStorage.clear()
  useClientSettings.setState({ ...DEFAULT_SETTINGS })
  useClientPending.getState().reset()
})

const open: { session?: McpSession; fake?: FakeServer }[] = []
afterEach(async () => {
  for (const o of open.splice(0)) {
    await o.session?.disconnect()
    await o.fake?.close()
  }
})

async function connected(setup: ClientFeatureSetup = createClientFeatureSetup()) {
  const fake = createFakeServer()
  const session = createSession({
    config: CONFIG,
    onLog: () => undefined,
    onState: () => undefined,
    clientSetup: setup,
    transportFactory: () => fake.clientTransport,
  })
  open.push({ session, fake })
  const state = await session.connect()
  expect(state.status).toBe('connected')
  return { fake, session }
}

const pendingNow = () => useClientPending.getState().pending
const waitForPending = async (n: number) => {
  for (let i = 0; i < 200 && pendingNow().length < n; i++) await new Promise((r) => setTimeout(r, 5))
  expect(pendingNow().length).toBeGreaterThanOrEqual(n)
}

const SAMPLING = { messages: [{ role: 'user', content: { type: 'text', text: 'hi' } }], maxTokens: 10 }
const ELICIT_FORM = { mode: 'form', message: 'Name?', requestedSchema: { type: 'object', properties: { name: { type: 'string' } } } }

describe('clientFeatureSetup.capabilities (read at connect time)', () => {
  it('is {} when everything is disabled', () => {
    expect(clientFeatureSetup.capabilities).toEqual({})
  })
  it('follows the settings at the moment it is read', () => {
    setSettings({ roots: { enabled: true, items: [] } })
    expect(clientFeatureSetup.capabilities).toEqual({ roots: {} })
    setSettings({ sampling: { enabled: true } })
    expect(clientFeatureSetup.capabilities).toEqual({ sampling: {} })
    setSettings({ elicitation: { enabled: true } })
    expect(clientFeatureSetup.capabilities).toEqual({ elicitation: { form: {}, url: {} } })
  })
  it('declares roots.listChanged only when asked to', () => {
    setSettings({ roots: { enabled: true, items: [] } })
    expect(createClientFeatureSetup({ rootsListChanged: true }).capabilities).toEqual({ roots: { listChanged: true } })
    expect(createClientFeatureSetup({ rootsListChanged: true }).capabilities).not.toEqual(clientFeatureSetup.capabilities)
  })
})

describe('configure(client) registers handlers only for enabled features', () => {
  it('disabled features answer -32601 and add nothing to the queue', async () => {
    const { fake } = await connected()
    for (const method of ['roots/list', 'sampling/createMessage', 'elicitation/create']) {
      const reply = await fake.sendRequest(method, method === 'roots/list' ? undefined : method.startsWith('s') ? SAMPLING : ELICIT_FORM)
      expect('error' in reply && reply.error.code).toBe(-32601)
    }
    expect(pendingNow()).toEqual([])
  })

  it('enabled sampling does not enable elicitation', async () => {
    setSettings({ sampling: { enabled: true } })
    const { fake } = await connected()
    const reply = await fake.sendRequest('elicitation/create', ELICIT_FORM)
    expect('error' in reply && reply.error.code).toBe(-32601)
  })

  it('throws no error for a Client that declares nothing and a disabled setup', () => {
    const setup = createClientFeatureSetup()
    const client = new Client({ name: 't', version: '1' }, { capabilities: setup.capabilities })
    expect(() => setup.configure(client)).not.toThrow()
  })
})

describe('roots', () => {
  it('answers roots/list immediately from settings, without user interaction', async () => {
    setSettings({
      roots: {
        enabled: true,
        items: [
          { uri: 'file:///work', name: 'Work' },
          { uri: 'file:///tmp', name: null },
        ],
      },
    })
    const { fake } = await connected()
    const reply = await fake.sendRequest('roots/list')
    expect(reply).toEqual({ result: { roots: [{ uri: 'file:///work', name: 'Work' }, { uri: 'file:///tmp' }] } })
    expect(pendingNow()).toEqual([])
  })

  it('declares the roots capability to the server in initialize', async () => {
    setSettings({ roots: { enabled: true, items: [] } })
    const { fake } = await connected()
    const init = fake.received.find((m) => (m as { method?: string }).method === 'initialize') as unknown as { params: { capabilities: unknown } }
    expect(init.params.capabilities).toEqual({ roots: {} })
  })

  it('records the applied settings for "Reconnect to apply" and clears them on disconnect', async () => {
    setSettings({ roots: { enabled: true, items: [{ uri: 'file:///a', name: null }] } })
    const { session } = await connected()
    expect(useClientPending.getState().applied?.snapshot).toMatchObject({ roots: true, sampling: false, elicitation: false })
    await session.disconnect()
    expect(useClientPending.getState().applied).toBeNull()
  })
})

describe('sampling', () => {
  it('queues the request, stays pending until answered, and Approve answers with the typed reply', async () => {
    setSettings({ sampling: { enabled: true } })
    const { fake } = await connected()
    const reply = fake.sendRequest('sampling/createMessage', SAMPLING)
    await waitForPending(1)
    expect(pendingNow()[0]).toMatchObject({ kind: 'sampling', params: SAMPLING })
    await new Promise((r) => setTimeout(r, 30))
    expect(pendingNow()).toHaveLength(1) // still pending: nobody answered

    useClientPending.getState().answer(
      pendingNow()[0].id,
      { role: 'assistant', content: { type: 'text', text: 'hello' }, model: 'manual', stopReason: 'endTurn' },
      'Approved',
    )
    expect(await reply).toEqual({
      result: { role: 'assistant', content: { type: 'text', text: 'hello' }, model: 'manual', stopReason: 'endTurn' },
    })
    expect(pendingNow()).toEqual([])
    expect(useClientPending.getState().recent[0]).toMatchObject({ kind: 'sampling', outcome: 'Approved', summary: 'hi' })
  })

  it('Reject answers JSON-RPC error -1 "User rejected sampling request"', async () => {
    setSettings({ sampling: { enabled: true } })
    const { fake } = await connected()
    const reply = fake.sendRequest('sampling/createMessage', SAMPLING)
    await waitForPending(1)
    const { samplingRejection } = await import('./register')
    useClientPending.getState().rejectRequest(pendingNow()[0].id, samplingRejection(), 'Rejected')
    expect(await reply).toEqual({ error: { code: -1, message: 'User rejected sampling request' } })
  })

  it('disconnect rejects a pending request and clears the queue', async () => {
    setSettings({ sampling: { enabled: true } })
    const { fake, session } = await connected()
    void fake.sendRequest('sampling/createMessage', SAMPLING).catch(() => undefined)
    await waitForPending(1)
    await session.disconnect()
    expect(pendingNow()).toEqual([])
    expect(useClientPending.getState().recent[0]).toMatchObject({ outcome: expect.stringMatching(/^Cancelled/) })
  })
})

describe('elicitation', () => {
  it('form mode: Accept answers {action:accept, content}', async () => {
    setSettings({ elicitation: { enabled: true } })
    const { fake } = await connected()
    const reply = fake.sendRequest('elicitation/create', ELICIT_FORM)
    await waitForPending(1)
    useClientPending.getState().answer(pendingNow()[0].id, { action: 'accept', content: { name: 'Ada' } }, 'Accepted')
    expect(await reply).toEqual({ result: { action: 'accept', content: { name: 'Ada' } } })
  })

  it('URL mode is accepted because both modes are declared', async () => {
    setSettings({ elicitation: { enabled: true } })
    const { fake } = await connected()
    const reply = fake.sendRequest('elicitation/create', { mode: 'url', message: 'Sign in', url: 'https://x.test/a', elicitationId: 'e1' })
    await waitForPending(1)
    expect(pendingNow()[0].params).toMatchObject({ mode: 'url', url: 'https://x.test/a' })
    useClientPending.getState().answer(pendingNow()[0].id, { action: 'decline' }, 'Declined')
    expect(await reply).toEqual({ result: { action: 'decline' } })
  })

  it('queues concurrent requests FIFO', async () => {
    setSettings({ sampling: { enabled: true }, elicitation: { enabled: true } })
    const { fake } = await connected()
    void fake.sendRequest('sampling/createMessage', SAMPLING)
    await waitForPending(1)
    void fake.sendRequest('elicitation/create', ELICIT_FORM)
    await waitForPending(2)
    expect(pendingNow().map((p) => p.kind)).toEqual(['sampling', 'elicitation'])
    expect(pendingNow()[0].id).toBeLessThan(pendingNow()[1].id)
  })
})

describe('per-client pending state (a late dispose of connection N must not touch connection N+1)', () => {
  async function liveClient(setup: ClientFeatureSetup) {
    const fake = createFakeServer()
    const client = new Client({ name: 't', version: '1' }, { capabilities: setup.capabilities })
    setup.configure(client)
    await client.connect(fake.clientTransport)
    return { fake, client }
  }

  it('dispose() belongs to the OLDEST configure; the newer connection keeps its pending request', async () => {
    setSettings({ sampling: { enabled: true } })
    const setup = createClientFeatureSetup()

    // Connection N and N+1 are both configured before N's (slow) dispose runs.
    const a = await liveClient(setup)
    const rejectedA: unknown[] = []
    const replyA = a.fake.sendRequest('sampling/createMessage', SAMPLING)
    void replyA
    await waitForPending(1)
    const requestA = pendingNow()[0]
    // Observe A's rejection through the callback the SDK handler is waiting on.
    const origReject = requestA.reject
    requestA.reject = (e) => {
      rejectedA.push(e)
      origReject(e)
    }

    const b = await liveClient(setup)
    const replyB = b.fake.sendRequest('sampling/createMessage', SAMPLING)
    await waitForPending(2)
    const requestB = pendingNow()[1]
    expect(requestB.ctxId).not.toBe(requestA.ctxId)

    // N's late dispose arrives after N+1's configure():
    setup.dispose()

    expect(rejectedA).toHaveLength(1)
    expect(pendingNow().map((p) => p.id)).toEqual([requestB.id]) // B's request is untouched
    expect(useClientPending.getState().applied?.snapshot.sampling).toBe(true) // B's applied snapshot survives too

    // B can still be answered normally...
    useClientPending.getState().answer(
      requestB.id,
      { role: 'assistant', content: { type: 'text', text: 'ok' }, model: 'manual', stopReason: 'endTurn' },
      'Approved',
    )
    expect(await replyB).toMatchObject({ result: { content: { text: 'ok' } } })

    // ...and its own dispose still cleans up after it.
    setup.dispose()
    expect(useClientPending.getState().applied).toBeNull()
    await a.client.close()
    await b.client.close()
  })

  it('closing a client cancels only its own in-flight requests (second safety net)', async () => {
    setSettings({ sampling: { enabled: true } })
    const setup = createClientFeatureSetup()
    const a = await liveClient(setup)
    const b = await liveClient(setup)
    void a.fake.sendRequest('sampling/createMessage', SAMPLING).catch(() => undefined)
    await waitForPending(1)
    void b.fake.sendRequest('sampling/createMessage', SAMPLING).catch(() => undefined)
    await waitForPending(2)
    const [reqA, reqB] = pendingNow()

    await a.client.close() // SDK aborts A's request signal; no dispose() involved
    for (let i = 0; i < 100 && pendingNow().length > 1; i++) await new Promise((r) => setTimeout(r, 5))
    expect(pendingNow().map((p) => p.id)).toEqual([reqB.id])
    expect(reqA.id).not.toBe(reqB.id)
    await b.client.close()
  })

  it('a configure() that throws leaves no context behind, so the next dispose() still hits the right one', async () => {
    setSettings({ sampling: { enabled: true } })
    const setup = createClientFeatureSetup()
    // A client that did not declare sampling: registering the handler throws CapabilityNotSupported.
    const undeclared = new Client({ name: 't', version: '1' }, { capabilities: {} })
    expect(() => setup.configure(undeclared)).toThrow()
    expect(useClientPending.getState().applied).toBeNull()

    const good = await liveClient(setup)
    const reply = good.fake.sendRequest('sampling/createMessage', SAMPLING)
    void reply.catch(() => undefined)
    await waitForPending(1)
    setup.dispose() // pairs with the successful configure(), not with the failed one
    expect(pendingNow()).toEqual([])
    expect(useClientPending.getState().recent[0]).toMatchObject({ outcome: expect.stringMatching(/^Cancelled/) })
    await good.client.close()
  })

  it('through real McpSessions: a slow disconnect of session A cannot reject session B\'s pending request', async () => {
    setSettings({ sampling: { enabled: true } })
    const shared = createClientFeatureSetup() // one setup instance shared by both sessions, like the app

    let releaseTerminate: () => void = () => undefined
    let terminateStarted = false
    const fakeA = createFakeServer({ sessionId: 'sess-a' })
    ;(fakeA.clientTransport as unknown as { terminateSession: () => Promise<void> }).terminateSession = () =>
      new Promise<void>((r) => {
        terminateStarted = true
        releaseTerminate = r
      })
    const fakeB = createFakeServer()
    const mk = (fake: FakeServer) =>
      createSession({
        config: CONFIG,
        onLog: () => undefined,
        onState: () => undefined,
        clientSetup: shared,
        transportFactory: () => fake.clientTransport,
      })
    const sessionA = mk(fakeA)
    const sessionB = mk(fakeB)
    open.push({ session: sessionA, fake: fakeA }, { session: sessionB, fake: fakeB })

    expect((await sessionA.connect()).status).toBe('connected')
    const disconnectingA = sessionA.disconnect() // stuck in terminateSession(): A's dispose() has not run yet
    await vi.waitFor(() => expect(terminateStarted).toBe(true))

    expect((await sessionB.connect()).status).toBe('connected') // B's configure() runs BEFORE A's dispose()
    const replyB = fakeB.sendRequest('sampling/createMessage', SAMPLING)
    await waitForPending(1)
    const requestB = pendingNow()[0]

    releaseTerminate() // A's dispose() now lands after B's configure()
    await disconnectingA

    expect(pendingNow().map((p) => p.id)).toEqual([requestB.id]) // untouched
    expect(useClientPending.getState().applied?.snapshot.sampling).toBe(true)
    useClientPending.getState().answer(
      requestB.id,
      { role: 'assistant', content: { type: 'text', text: 'ok' }, model: 'manual', stopReason: 'endTurn' },
      'Approved',
    )
    expect(await replyB).toMatchObject({ result: { content: { text: 'ok' } } })

    await sessionB.disconnect() // B's own dispose still cleans up after it
    expect(useClientPending.getState().applied).toBeNull()
  })

  it('a stray dispose() with nothing configured is harmless', () => {
    expect(() => createClientFeatureSetup().dispose()).not.toThrow()
  })
})
