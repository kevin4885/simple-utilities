import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { JSONRPCMessage } from '@modelcontextprotocol/client'
import { createSession, type McpSession } from '../../connection/session'
import type { ServerSummary } from '../../connection/types'
import { createFakeServer, type FakeServer, type FakeServerOptions } from '../../testing/fakeServer'
import { useMcpInspectorStore } from '../../store'
import ResourcesTab from './ResourcesTab'

const CAPS = { resources: { subscribe: true, listChanged: true } }

interface Setup {
  fake: FakeServer
  session: McpSession
  info: ServerSummary
}

const opened: Setup[] = []

async function setup(options: FakeServerOptions = {}, capabilities: Record<string, unknown> = CAPS): Promise<Setup> {
  const fake = createFakeServer({ capabilities, ...options })
  const session = createSession({
    config: { url: 'https://mcp.test/mcp', transport: 'streamable-http', headers: [], protocolVersion: null },
    onLog: () => undefined,
    onState: () => undefined,
    transportFactory: () => fake.clientTransport,
  })
  const state = await session.connect()
  if (state.status !== 'connected') throw new Error(`connect failed: ${state.status}`)
  const s = { fake, session, info: state.info }
  opened.push(s)
  return s
}

function mount(s: Setup) {
  return render(
    <ResourcesTab
      session={s.session}
      info={s.info}
      sessionOptions={{ config: { url: 'https://mcp.test/mcp', transport: 'auto', headers: [], protocolVersion: null } }}
      profileId="p1"
    />,
  )
}

const methods = (fake: FakeServer, method: string) =>
  fake.received.filter((m): m is JSONRPCMessage & { method: string; params?: Record<string, unknown> } => (m as { method?: string }).method === method)

const res = (n: number) => ({ uri: `file:///r${n}.txt`, name: `res${n}`, mimeType: 'text/plain', description: `desc ${n}` })

beforeEach(() => {
  useMcpInspectorStore.setState({ history: [], prefs: { saveHistory: true } })
})

afterEach(async () => {
  cleanup()
  for (const s of opened.splice(0)) {
    await s.session.disconnect()
    await s.fake.close()
  }
})

describe('ResourcesTab list', () => {
  it('merges pages and shows name, title, uri, mime type and description', async () => {
    const s = await setup({
      resources: [res(1), res(2), { ...res(3), title: 'Third' }],
      pageSize: 2,
    })
    mount(s)
    expect(await screen.findByText('res1')).toBeInTheDocument()
    expect(screen.getByText('res2')).toBeInTheDocument()
    expect(screen.getByText('Third')).toBeInTheDocument()
    expect(screen.getByText('res3')).toBeInTheDocument() // name shown under the title
    expect(screen.getByText('file:///r1.txt')).toBeInTheDocument()
    expect(screen.getAllByText('text/plain')).toHaveLength(3)
    expect(screen.getByText('desc 2')).toBeInTheDocument()
    expect(methods(s.fake, 'resources/list')).toHaveLength(2)
  })

  it('searches by name or uri', async () => {
    const s = await setup({ resources: [res(1), { uri: 'db://orders', name: 'orders' }] })
    mount(s)
    await screen.findByText('res1')
    const user = userEvent.setup()
    await user.type(screen.getByRole('searchbox', { name: 'Search resources' }), 'db://')
    expect(screen.queryByText('res1')).toBeNull()
    expect(screen.getByText('orders')).toBeInTheDocument()
    await user.clear(screen.getByRole('searchbox', { name: 'Search resources' }))
    await user.type(screen.getByRole('searchbox', { name: 'Search resources' }), 'RES1')
    expect(screen.getByText('res1')).toBeInTheDocument()
    expect(screen.queryByText('orders')).toBeNull()
  })

  it('shows "No resources." for an empty list', async () => {
    const s = await setup({ resources: [], resourceTemplates: [] })
    mount(s)
    expect(await screen.findByText('No resources.')).toBeInTheDocument()
  })

  it('shows the error with Retry and recovers when the retry succeeds', async () => {
    let fail = true
    const s = await setup({
      resources: [res(1)],
      onRequest: ({ method }) =>
        method === 'resources/list' && fail ? { error: { code: -32603, message: 'boom' } } : undefined,
    })
    mount(s)
    expect(await screen.findByText('boom')).toBeInTheDocument()
    fail = false
    await userEvent.setup().click(screen.getAllByRole('button', { name: 'Retry' })[0])
    expect(await screen.findByText('res1')).toBeInTheDocument()
    expect(screen.queryByText('boom')).toBeNull()
  })

  it('refreshes on resources/list_changed', async () => {
    const items = [res(1)]
    const s = await setup({ resources: items })
    mount(s)
    await screen.findByText('res1')
    items.push(res(2))
    await act(async () => {
      await s.fake.sendNotification('notifications/resources/list_changed')
    })
    expect(await screen.findByText('res2')).toBeInTheDocument()
  })

  it('renders server text as text, not HTML', async () => {
    const s = await setup({
      resources: [{ uri: 'x://a', name: '<img src=x onerror=alert(1)>', description: '<b>bold</b>' }],
    })
    const { container } = mount(s)
    expect(await screen.findByText('<img src=x onerror=alert(1)>')).toBeInTheDocument()
    expect(screen.getByText('<b>bold</b>')).toBeInTheDocument()
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('b')).toBeNull()
  })
})

describe('ResourcesTab read', () => {
  it('reads a resource, renders contents with mime type and size, and pushes history', async () => {
    const s = await setup({
      resources: [res(1)],
      resourceContents: { 'file:///r1.txt': [{ uri: 'file:///r1.txt', mimeType: 'text/plain', text: 'hello world' }] },
    })
    mount(s)
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: /res1/ }))
    await user.click(screen.getByRole('button', { name: 'Read' }))
    expect(await screen.findByText('hello world')).toBeInTheDocument()
    expect(screen.getByText('text/plain · 11 chars')).toBeInTheDocument()
    expect(methods(s.fake, 'resources/read')[0].params).toEqual({ uri: 'file:///r1.txt' })
    const h = useMcpInspectorStore.getState().history
    expect(h).toHaveLength(1)
    expect(h[0]).toMatchObject({ kind: 'resource', name: 'file:///r1.txt', ok: true, profileId: 'p1' })
  })

  it('shows the byte size of a blob', async () => {
    const s = await setup({
      resources: [res(1)],
      resourceContents: { 'file:///r1.txt': [{ uri: 'file:///r1.txt', mimeType: 'application/octet-stream', blob: btoa('abcd') }] },
    })
    mount(s)
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: /res1/ }))
    await user.click(screen.getByRole('button', { name: 'Read' }))
    expect(await screen.findByText('application/octet-stream · 4 B')).toBeInTheDocument()
  })

  it('shows a JSON-RPC error as "Protocol error" with code and message', async () => {
    const s = await setup({ resources: [res(1)], resourceContents: {} })
    mount(s)
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: /res1/ }))
    await user.click(screen.getByRole('button', { name: 'Read' }))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Protocol error')
    // the SDK normalises a received -32002 (resource not found) to -32602 before the tab sees it
    expect(alert).toHaveTextContent('Code -32602')
    expect(alert).toHaveTextContent('Resource not found: file:///r1.txt')
    expect(useMcpInspectorStore.getState().history[0]).toMatchObject({ kind: 'resource', ok: false })
  })
})

describe('ResourcesTab templates', () => {
  const template = { uriTemplate: 'file:///{dir}/{name}{?v}', name: 'files', description: 'files tpl' }

  it('lists templates separately, previews the expanded URI live and gates Read on it', async () => {
    const s = await setup({
      resources: [res(1)],
      resourceTemplates: [template],
      resourceContents: { 'file:///a%20b/c.txt?v=1': [{ uri: 'x', mimeType: 'text/plain', text: 'tpl body' }] },
    })
    mount(s)
    const user = userEvent.setup()
    const tpl = await screen.findByRole('button', { name: /file:\/\/\/\{dir\}\/\{name\}\{\?v\}/ })
    await user.click(tpl)
    const read = screen.getByRole('button', { name: 'Read' })
    expect(read).toBeDisabled()
    await user.type(screen.getByLabelText('dir'), 'a b')
    expect(read).toBeDisabled() // name still missing
    await user.type(screen.getByLabelText('name'), 'c.txt')
    expect(screen.getByTestId('expanded-uri')).toHaveTextContent('file:///a%20b/c.txt')
    expect(read).toBeEnabled()
    await user.type(screen.getByLabelText('v'), '1')
    expect(screen.getByTestId('expanded-uri')).toHaveTextContent('file:///a%20b/c.txt?v=1')
    await user.click(read)
    expect(await screen.findByText('tpl body')).toBeInTheDocument()
    expect(methods(s.fake, 'resources/read')[0].params).toEqual({ uri: 'file:///a%20b/c.txt?v=1' })
    expect(useMcpInspectorStore.getState().history[0]).toMatchObject({ kind: 'resource', name: 'file:///a%20b/c.txt?v=1' })
  })

  it('shows an error and keeps Read disabled for an unsupported template', async () => {
    const s = await setup({ resourceTemplates: [{ uriTemplate: 'x://{/p}', name: 'bad' }] })
    mount(s)
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: /bad/ }))
    expect(screen.getByRole('alert')).toHaveTextContent("Unsupported operator '/'")
    expect(screen.getByRole('button', { name: 'Read' })).toBeDisabled()
  })

  it('requests completions (debounced) with a ref/resource when completions is advertised', async () => {
    const s = await setup(
      {
        resourceTemplates: [template],
        onRequest: ({ method }) =>
          method === 'completion/complete' ? { result: { completion: { values: ['alpha', 'beta'] } } } : undefined,
      },
      { ...CAPS, completions: {} },
    )
    mount(s)
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: /files/ }))
    await user.type(screen.getByLabelText('dir'), 'al')
    expect(methods(s.fake, 'completion/complete')).toHaveLength(0) // debounced
    const list = await screen.findByRole('list', { name: 'Suggestions for dir' })
    expect(within(list).getByRole('button', { name: 'alpha' })).toBeInTheDocument()
    const calls = methods(s.fake, 'completion/complete')
    expect(calls).toHaveLength(1) // one request for the whole burst of typing
    expect(calls[0].params).toMatchObject({
      ref: { type: 'ref/resource', uri: template.uriTemplate },
      argument: { name: 'dir', value: 'al' },
    })
    await user.click(within(list).getByRole('button', { name: 'beta' }))
    expect(screen.getByLabelText('dir')).toHaveValue('beta')
  })

  it('sends no completion request without the completions capability', async () => {
    const s = await setup({ resourceTemplates: [template] })
    mount(s)
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: /files/ }))
    await user.type(screen.getByLabelText('dir'), 'al')
    await new Promise((r) => setTimeout(r, 450))
    expect(methods(s.fake, 'completion/complete')).toHaveLength(0)
  })
})

describe('ResourcesTab subscriptions', () => {
  const uri = 'file:///r1.txt'
  const contents = { [uri]: [{ uri, mimeType: 'text/plain', text: 'v1' }] }

  it('hides Subscribe when the server does not advertise resources.subscribe', async () => {
    const s = await setup({ resources: [res(1)] }, { resources: { listChanged: true } })
    mount(s)
    await userEvent.setup().click(await screen.findByRole('button', { name: /res1/ }))
    expect(screen.getByRole('button', { name: 'Read' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Subscribe' })).toBeNull()
  })

  it('subscribes, shows Updated + Re-read on a notification, and unsubscribes', async () => {
    const s = await setup({ resources: [res(1)], resourceContents: contents })
    mount(s)
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: /res1/ }))
    await user.click(screen.getByRole('button', { name: 'Subscribe' }))
    await screen.findByRole('button', { name: 'Unsubscribe' })
    expect(methods(s.fake, 'resources/subscribe')[0].params).toEqual({ uri })

    await act(async () => {
      await s.fake.sendNotification('notifications/resources/updated', { uri })
    })
    const reread = await screen.findByRole('button', { name: 'Re-read' })
    expect(screen.getAllByText('Updated').length).toBeGreaterThan(0)

    await user.click(reread)
    expect(await screen.findByText('v1')).toBeInTheDocument()
    expect(screen.queryByText('Updated')).toBeNull()
    expect(methods(s.fake, 'resources/read')).toHaveLength(1)

    await user.click(screen.getByRole('button', { name: 'Unsubscribe' }))
    await screen.findByRole('button', { name: 'Subscribe' })
    expect(methods(s.fake, 'resources/unsubscribe')[0].params).toEqual({ uri })
  })

  it('ignores updates for a uri that is not subscribed', async () => {
    const s = await setup({ resources: [res(1)], resourceContents: contents })
    mount(s)
    await userEvent.setup().click(await screen.findByRole('button', { name: /res1/ }))
    await act(async () => {
      await s.fake.sendNotification('notifications/resources/updated', { uri })
    })
    await new Promise((r) => setTimeout(r, 50))
    expect(screen.queryByText('Updated')).toBeNull()
  })

  it('unsubscribes every active subscription when the tab unmounts', async () => {
    const s = await setup({ resources: [res(1), res(2)], resourceContents: contents })
    const view = mount(s)
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: /res1/ }))
    await user.click(screen.getByRole('button', { name: 'Subscribe' }))
    await screen.findByRole('button', { name: 'Unsubscribe' })
    await user.click(screen.getByRole('button', { name: /res2/ }))
    await user.click(screen.getByRole('button', { name: 'Subscribe' }))
    await screen.findByRole('button', { name: 'Unsubscribe' })
    expect(methods(s.fake, 'resources/unsubscribe')).toHaveLength(0)

    view.unmount()
    await waitFor(() => expect(methods(s.fake, 'resources/unsubscribe')).toHaveLength(2))
    expect(methods(s.fake, 'resources/unsubscribe').map((m) => m.params?.uri).sort()).toEqual(['file:///r1.txt', 'file:///r2.txt'])
  })
})
