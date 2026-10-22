import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Transport } from '@modelcontextprotocol/client'

// CodeMirror needs layout APIs jsdom lacks; the tab only relies on value/onChange.
vi.mock('@/components/editor/CodeEditor', () => ({
  default: ({ value, onChange, readOnly }: { value: string; onChange?: (v: string) => void; readOnly?: boolean }) => (
    <textarea aria-label="JSON arguments" value={value} readOnly={readOnly} onChange={(e) => onChange?.(e.target.value)} />
  ),
}))

import { createSession, type McpSession } from '../../connection/session'
import type { ServerSummary } from '../../connection/types'
import { createFakeServer, type FakeServer, type FakeServerOptions } from '../../testing/fakeServer'
import { useMcpInspectorStore } from '../../store'
import ToolsTab from './ToolsTab'

const PROFILE = 'prof-1'

interface Env {
  fake: FakeServer
  session: McpSession
  tools: Record<string, unknown>[]
}

const live: Env[] = []

async function connect(opts: FakeServerOptions = {}): Promise<Env> {
  const tools = (opts.tools ?? []) as Record<string, unknown>[]
  const fake = createFakeServer({ ...opts, tools })
  const session = createSession({
    config: { url: 'https://mcp.test/mcp', transport: 'streamable-http', headers: [], protocolVersion: null },
    onLog: () => undefined,
    onState: () => undefined,
    transportFactory: () => fake.clientTransport as Transport,
  })
  const state = await session.connect()
  if (state.status !== 'connected') throw new Error(`fake connect failed: ${state.status}`)
  const env = { fake, session, tools }
  live.push(env)
  return env
}

const info: ServerSummary = {
  serverName: 'fake',
  serverVersion: '1',
  title: null,
  protocolVersion: '2025-06-18',
  capabilities: { tools: {} },
  instructions: null,
  transport: 'streamable-http',
  sessionId: null,
}

function mount(env: Env, profileId = PROFILE) {
  return render(
    <ToolsTab
      session={env.session}
      info={info}
      sessionOptions={{ config: { url: 'https://mcp.test/mcp', transport: 'auto', headers: [], protocolVersion: null } }}
      profileId={profileId}
    />,
  )
}

const calls = (env: Env) =>
  env.fake.received.filter((m) => (m as { method?: string }).method === 'tools/call') as { params: Record<string, unknown> }[]
const listCalls = (env: Env) => env.fake.received.filter((m) => (m as { method?: string }).method === 'tools/list').length

const sidebar = () => screen.getByRole('complementary', { name: 'Tools' })
const details = () => screen.getByRole('region', { name: 'Tool details' })
/** Clicks the tool whose visible label is exactly `label` (the button's accessible name also carries its badges). */
const pick = async (user: ReturnType<typeof userEvent.setup>, label: string) => {
  await within(sidebar()).findByText(label)
  const button = within(sidebar())
    .getAllByRole('button')
    .find((b) => b.querySelector('span')?.textContent === label)
  if (!button) throw new Error(`no tool button labelled ${label}`)
  await user.click(button)
}

const T = (name: string, over: Record<string, unknown> = {}) => ({ name, inputSchema: { type: 'object' }, ...over })
const COUNT = { type: 'object', properties: { count: { type: 'integer' } }, required: ['count'] }
const text = (s: string) => ({ content: [{ type: 'text', text: s }] })

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  useMcpInspectorStore.setState({ profiles: [], activeProfileId: null, history: [], prefs: { saveHistory: true } })
  Element.prototype.scrollIntoView ??= () => {}
  Element.prototype.hasPointerCapture ??= () => false
  Element.prototype.releasePointerCapture ??= () => {}
})

afterEach(async () => {
  for (const env of live.splice(0)) {
    await env.session.disconnect()
    await env.fake.close()
  }
})

describe('listing', () => {
  it('lists every tool across pages, with title ?? name, description and only the annotations present', async () => {
    const env = await connect({
      pageSize: 2,
      tools: [
        T('alpha', { title: 'Alpha Tool', description: 'First one', annotations: { readOnlyHint: true, openWorldHint: false } }),
        T('beta', { annotations: { destructiveHint: true, idempotentHint: true } }),
        T('gamma'),
        T('delta'),
        T('epsilon'),
      ],
    })
    mount(env)
    expect(await screen.findByTestId('tool-count')).toHaveTextContent('5 tools')
    expect(listCalls(env)).toBe(3)
    for (const label of ['Alpha Tool', 'beta', 'gamma', 'delta', 'epsilon']) {
      expect(within(sidebar()).getByText(label)).toBeInTheDocument()
    }
    expect(within(sidebar()).getByText('First one')).toBeInTheDocument()

    const alpha = within(sidebar()).getByRole('button', { name: /Alpha Tool/ })
    expect(within(alpha).getByText('read-only')).toBeInTheDocument()
    expect(within(alpha).getByText('not open-world')).toBeInTheDocument()
    expect(within(alpha).queryByText('destructive')).toBeNull()
    const beta = within(sidebar()).getByRole('button', { name: /beta/ })
    expect(within(beta).getByText('destructive')).toBeInTheDocument()
    expect(within(beta).getByText('idempotent')).toBeInTheDocument()
    const gamma = within(sidebar()).getByRole('button', { name: /gamma/ })
    expect(within(gamma).queryByLabelText('Annotations')).toBeNull()
  })

  it('searches name, title and description case-insensitively', async () => {
    const env = await connect({
      tools: [T('get_weather', { title: 'Weather', description: 'Forecast for a CITY' }), T('delete_file'), T('ping')],
    })
    const user = userEvent.setup()
    mount(env)
    await screen.findByTestId('tool-count')
    const search = screen.getByRole('searchbox', { name: 'Search tools' })
    await user.type(search, 'CITY')
    expect(screen.getByTestId('tool-count')).toHaveTextContent('1 of 3 tools')
    expect(within(sidebar()).getByText('Weather')).toBeInTheDocument()
    expect(within(sidebar()).queryByText('delete_file')).toBeNull()
    await user.clear(search)
    await user.type(search, 'DELETE_')
    expect(within(sidebar()).getByText('delete_file')).toBeInTheDocument()
    expect(within(sidebar()).queryByText('Weather')).toBeNull()
    await user.clear(search)
    await user.type(search, 'nothing-matches')
    expect(screen.getByText('No tools match your search.')).toBeInTheDocument()
  })

  it('says so when the server exposes no tools', async () => {
    const env = await connect({ tools: [] })
    mount(env)
    expect(await screen.findByText('This server exposes no tools.')).toBeInTheDocument()
  })

  it('shows an error with Retry when listing fails, and Retry lists again', async () => {
    let failing = true
    const env = await connect({
      tools: [T('only')],
      onRequest: (req) => (req.method === 'tools/list' && failing ? { error: { code: -32603, message: 'boom' } } : undefined),
    })
    const user = userEvent.setup()
    mount(env)
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Could not list tools')
    expect(alert).toHaveTextContent('boom')
    failing = false
    await user.click(within(alert).getByRole('button', { name: 'Retry' }))
    expect(await within(sidebar()).findByText('only')).toBeInTheDocument()
    expect(screen.queryByText(/Could not list tools/)).toBeNull()
  })

  it('shows a notice when pagination is truncated', async () => {
    const env = await connect({
      tools: [],
      onRequest: (req) =>
        req.method === 'tools/list' ? { result: { tools: [T(`t${Math.random()}`)], nextCursor: 'same' } } : undefined,
    })
    mount(env)
    expect(await screen.findByTestId('truncated-notice')).toHaveTextContent(/already returned/)
    expect(within(sidebar()).getAllByRole('button', { name: /^t0\./ }).length).toBeGreaterThan(0)
  })
})

describe('refresh and list_changed', () => {
  it('Refresh re-lists', async () => {
    const env = await connect({ tools: [T('a')] })
    const user = userEvent.setup()
    mount(env)
    await screen.findByTestId('tool-count')
    env.tools.push(T('b'))
    await user.click(screen.getByRole('button', { name: 'Refresh' }))
    expect(await screen.findByText('2 tools')).toBeInTheDocument()
  })

  it('re-lists on list_changed and keeps the selected tool selected if it still exists', async () => {
    const env = await connect({ tools: [T('a'), T('b')] })
    const user = userEvent.setup()
    mount(env)
    await pick(user, 'b')
    expect(within(details()).getByRole('heading', { name: 'b' })).toBeInTheDocument()
    env.tools.push(T('c'))
    await act(async () => {
      await env.fake.sendNotification('notifications/tools/list_changed')
    })
    expect(await screen.findByText('3 tools')).toBeInTheDocument()
    expect(within(details()).getByRole('heading', { name: 'b' })).toBeInTheDocument()
    expect(within(sidebar()).getByRole('button', { name: 'b' })).toHaveAttribute('aria-current', 'true')
  })

  it('clears the selection when the selected tool disappears', async () => {
    const env = await connect({ tools: [T('a'), T('b')] })
    const user = userEvent.setup()
    mount(env)
    await pick(user, 'b')
    env.tools.splice(1, 1)
    await act(async () => {
      await env.fake.sendNotification('notifications/tools/list_changed')
    })
    expect(await screen.findByText('1 tool')).toBeInTheDocument()
    expect(within(details()).getByText(/Select a tool/)).toBeInTheDocument()
  })
})

describe('argument editing', () => {
  it('shows the form for a supported schema', async () => {
    const env = await connect({ tools: [T('t', { inputSchema: COUNT })] })
    const user = userEvent.setup()
    mount(env)
    await pick(user, 't')
    expect(within(details()).getByRole('textbox', { name: /count/ })).toBeInTheDocument()
    expect(screen.queryByLabelText('JSON arguments')).toBeNull()
  })

  it('shows a JSON editor with the reason for an unsupported schema and disables Form with the reason as title', async () => {
    const env = await connect({ tools: [T('t', { inputSchema: { oneOf: [{ type: 'object' }, { type: 'string' }] } })] })
    const user = userEvent.setup()
    mount(env)
    await pick(user, 't')
    expect(screen.getByLabelText('JSON arguments')).toBeInTheDocument()
    expect(screen.getByTestId('form-unavailable')).toHaveTextContent('oneOf')
    const formBtn = screen.getByRole('button', { name: 'Form' })
    expect(formBtn).toBeDisabled()
    expect(formBtn).toHaveAttribute('title', expect.stringContaining('oneOf'))
  })

  it('keeps Form and JSON in sync, and disables Form while the JSON is invalid', async () => {
    const env = await connect({ tools: [T('t', { inputSchema: COUNT })] })
    const user = userEvent.setup()
    mount(env)
    await pick(user, 't')
    await user.type(within(details()).getByRole('textbox', { name: /count/ }), '4')

    await user.click(screen.getByRole('button', { name: 'JSON' }))
    const editor = screen.getByLabelText('JSON arguments') as HTMLTextAreaElement
    expect(JSON.parse(editor.value)).toEqual({ count: 4 })
    expect(editor.value).toContain('\n  "count"')

    fireEvent.change(editor, { target: { value: '{"count": 9}' } })
    await user.click(screen.getByRole('button', { name: 'Form' }))
    expect(within(details()).getByRole('textbox', { name: /count/ })).toHaveValue('9')

    await user.click(screen.getByRole('button', { name: 'JSON' }))
    fireEvent.change(screen.getByLabelText('JSON arguments'), { target: { value: '{"count":' } })
    expect(screen.getByTestId('json-error')).toHaveTextContent(/Invalid JSON/)
    const formBtn = screen.getByRole('button', { name: 'Form' })
    expect(formBtn).toBeDisabled()
    expect(formBtn).toHaveAttribute('title', expect.stringMatching(/Invalid JSON/))
  })

  it('Form -> JSON with an invalid form writes {} and shows the errors', async () => {
    const env = await connect({ tools: [T('t', { inputSchema: COUNT })] })
    const user = userEvent.setup()
    mount(env)
    await pick(user, 't')
    await user.click(screen.getByRole('button', { name: 'JSON' }))
    expect(screen.getByLabelText('JSON arguments')).toHaveValue('{}')
    expect(screen.getByTestId('switch-errors')).toHaveTextContent('count: Required')
  })

  it('keeps each tool\'s draft while looking at another tool', async () => {
    const env = await connect({ tools: [T('one', { inputSchema: COUNT }), T('two', { inputSchema: COUNT })] })
    const user = userEvent.setup()
    mount(env)
    await pick(user, 'one')
    await user.type(within(details()).getByRole('textbox', { name: /count/ }), '12')
    await pick(user, 'two')
    expect(within(details()).getByRole('textbox', { name: /count/ })).toHaveValue('')
    await pick(user, 'one')
    expect(within(details()).getByRole('textbox', { name: /count/ })).toHaveValue('12')
  })
})

describe('calling', () => {
  it('validates first: field errors are shown and no tools/call is sent', async () => {
    const env = await connect({ tools: [T('t', { inputSchema: COUNT })], toolHandlers: { t: () => text('x') } })
    const user = userEvent.setup()
    mount(env)
    await pick(user, 't')
    await user.click(screen.getByRole('button', { name: 'Call tool' }))
    expect(within(details()).getByRole('alert')).toHaveTextContent('Required')
    expect(within(details()).getByRole('textbox', { name: /count/ })).toHaveAttribute('aria-invalid', 'true')
    expect(calls(env)).toHaveLength(0)
    expect(useMcpInspectorStore.getState().history).toHaveLength(0)
  })

  it('sends {name, arguments}, renders content, structuredContent and the duration', async () => {
    const env = await connect({
      tools: [T('add', { inputSchema: COUNT })],
      toolHandlers: { add: (args) => ({ content: [{ type: 'text', text: `got ${JSON.stringify(args)}` }], structuredContent: { total: 7 } }) },
    })
    const user = userEvent.setup()
    mount(env)
    await pick(user, 'add')
    await user.type(within(details()).getByRole('textbox', { name: /count/ }), '3')
    await user.click(screen.getByRole('button', { name: 'Call tool' }))

    const result = await screen.findByTestId('tool-result')
    expect(within(result).getByText('got {"count":3}')).toBeInTheDocument()
    expect(within(result).getByText(/"total": 7/)).toBeInTheDocument()
    expect(within(result).getByTestId('duration').textContent).toMatch(/^\d+ ms$/)
    expect(calls(env)).toHaveLength(1)
    expect(calls(env)[0].params).toMatchObject({ name: 'add', arguments: { count: 3 } })
    expect(within(result).queryByText('Tool returned an error')).toBeNull()
  })

  it('calls from the JSON editor with parsed arguments', async () => {
    const env = await connect({
      tools: [T('free', { inputSchema: { type: 'string' } })],
      toolHandlers: { free: (args) => text(JSON.stringify(args)) },
    })
    const user = userEvent.setup()
    mount(env)
    await pick(user, 'free')
    fireEvent.change(screen.getByLabelText('JSON arguments'), { target: { value: '{"anything": [1, 2]}' } })
    await user.click(screen.getByRole('button', { name: 'Call tool' }))
    await screen.findByTestId('tool-result')
    expect(calls(env)[0].params.arguments).toEqual({ anything: [1, 2] })
  })

  it('does not send while the JSON is invalid', async () => {
    const env = await connect({ tools: [T('free', { inputSchema: { type: 'string' } })], toolHandlers: { free: () => text('x') } })
    const user = userEvent.setup()
    mount(env)
    await pick(user, 'free')
    fireEvent.change(screen.getByLabelText('JSON arguments'), { target: { value: '{' } })
    await user.click(screen.getByRole('button', { name: 'Call tool' }))
    expect(calls(env)).toHaveLength(0)
    expect(screen.getByTestId('json-error')).toBeInTheDocument()
  })

  it('passes the timeout, onprogress and a signal to the SDK, clamping the timeout to at least 1000 ms', async () => {
    const env = await connect({ tools: [T('t')], toolHandlers: { t: () => text('x') } })
    const spy = vi.spyOn(env.session.client, 'request')
    const user = userEvent.setup()
    mount(env)
    await pick(user, 't')
    const timeout = screen.getByLabelText('Timeout (ms)')
    expect(timeout).toHaveValue(60000)
    await user.click(screen.getByRole('button', { name: 'Call tool' }))
    await screen.findByTestId('tool-result')
    const opts = spy.mock.calls.find((c) => (c[0] as { method: string }).method === 'tools/call')![2]!
    expect(opts.timeout).toBe(60000)
    expect(typeof opts.onprogress).toBe('function')
    expect(opts.signal).toBeInstanceOf(AbortSignal)

    fireEvent.change(timeout, { target: { value: '10' } })
    fireEvent.blur(timeout)
    expect(timeout).toHaveValue(1000)
    spy.mockClear()
    await user.click(screen.getByRole('button', { name: 'Call tool' }))
    await waitFor(() => expect(spy.mock.calls.some((c) => (c[0] as { method: string }).method === 'tools/call')).toBe(true))
    const second = spy.mock.calls.find((c) => (c[0] as { method: string }).method === 'tools/call')![2]!
    expect(second.timeout).toBe(1000)
  })
})

describe('result classification', () => {
  it('isError:true shows "Tool returned an error" and still renders the content', async () => {
    const env = await connect({
      tools: [T('t')],
      toolHandlers: { t: () => ({ isError: true, content: [{ type: 'text', text: 'disk full' }] }) },
    })
    const user = userEvent.setup()
    mount(env)
    await pick(user, 't')
    await user.click(screen.getByRole('button', { name: 'Call tool' }))
    const result = await screen.findByTestId('tool-result')
    expect(within(result).getByText('Tool returned an error')).toBeInTheDocument()
    expect(within(result).getByText('disk full')).toBeInTheDocument()
    expect(within(result).queryByText('Protocol error')).toBeNull()
    expect(within(result).queryByText(/Timed out/)).toBeNull()
    expect(useMcpInspectorStore.getState().history[0]).toMatchObject({ ok: false })
  })

  it('a JSON-RPC error shows "Protocol error" with code, message and data', async () => {
    const env = await connect({
      tools: [T('t')],
      rejectMethods: { 'tools/call': { code: -32602, message: 'Invalid params', data: { field: 'x' } } },
    })
    const user = userEvent.setup()
    mount(env)
    await pick(user, 't')
    await user.click(screen.getByRole('button', { name: 'Call tool' }))
    const result = await screen.findByTestId('tool-result')
    expect(within(result).getByText('Protocol error')).toBeInTheDocument()
    expect(result).toHaveTextContent('code: -32602')
    expect(result).toHaveTextContent('message: Invalid params')
    expect(result).toHaveTextContent('"field": "x"')
    expect(within(result).queryByText('Tool returned an error')).toBeNull()
    expect(useMcpInspectorStore.getState().history[0]).toMatchObject({ ok: false })
  })

  it('a protocol error without data shows no data section', async () => {
    const env = await connect({ tools: [T('t')], rejectMethods: { 'tools/call': { code: -32000, message: 'plain' } } })
    const user = userEvent.setup()
    mount(env)
    await pick(user, 't')
    await user.click(screen.getByRole('button', { name: 'Call tool' }))
    const result = await screen.findByTestId('tool-result')
    expect(result).toHaveTextContent('code: -32000')
    expect(result).not.toHaveTextContent('data:')
  })

  it('a timeout shows "Timed out after N ms"', async () => {
    const env = await connect({
      tools: [T('t')],
      onRequest: (req) => (req.method === 'tools/call' ? 'no-response' : undefined),
    })
    const user = userEvent.setup()
    mount(env)
    await pick(user, 't')
    fireEvent.change(screen.getByLabelText('Timeout (ms)'), { target: { value: '1000' } })
    await user.click(screen.getByRole('button', { name: 'Call tool' }))
    const result = await screen.findByTestId('tool-result', undefined, { timeout: 4000 })
    expect(within(result).getByText('Timed out after 1000 ms')).toBeInTheDocument()
    expect(within(result).queryByText('Protocol error')).toBeNull()
    expect(within(result).queryByText('Tool returned an error')).toBeNull()
    expect(useMcpInspectorStore.getState().history[0]).toMatchObject({ ok: false })
  })
})

describe('cancel and progress', () => {
  it('Cancel aborts the call, shows "Cancelled" and records a failed history entry', async () => {
    const env = await connect({
      tools: [T('t')],
      onRequest: (req) => (req.method === 'tools/call' ? 'no-response' : undefined),
    })
    const user = userEvent.setup()
    mount(env)
    await pick(user, 't')
    await user.click(screen.getByRole('button', { name: 'Call tool' }))
    expect(screen.getByRole('button', { name: 'Calling…' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    const result = await screen.findByTestId('tool-result')
    expect(within(result).getByText('Cancelled')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull()
    expect(useMcpInspectorStore.getState().history[0]).toMatchObject({ kind: 'tool', name: 't', ok: false })
  })

  it('progress notifications for the call update a determinate bar, or an indeterminate one without a total', async () => {
    let token: string | number | undefined
    let release: () => void = () => undefined
    const gate = new Promise<void>((r) => (release = r))
    const env = await connect({
      tools: [T('slow')],
      onRequest: (req) => {
        if (req.method === 'tools/call') {
          token = (req.params as { _meta?: { progressToken?: string | number } })._meta?.progressToken
        }
      },
      toolHandlers: { slow: async () => (await gate, text('done')) },
    })
    const user = userEvent.setup()
    mount(env)
    await pick(user, 'slow')
    await user.click(screen.getByRole('button', { name: 'Call tool' }))

    const bar = await screen.findByRole('progressbar', { name: 'Call progress' })
    expect(bar).not.toHaveAttribute('aria-valuenow')
    expect(screen.getByText('Waiting for the server…')).toBeInTheDocument()
    await waitFor(() => expect(token).toBeDefined())

    await act(async () => {
      await env.fake.sendNotification('notifications/progress', { progressToken: token, progress: 5, total: 10, message: 'halfway' })
    })
    await waitFor(() => expect(screen.getByRole('progressbar', { name: 'Call progress' })).toHaveAttribute('aria-valuenow', '50'))
    expect(screen.getByText(/5 \/ 10/)).toHaveTextContent('halfway')

    await act(async () => {
      await env.fake.sendNotification('notifications/progress', { progressToken: token, progress: 7 })
    })
    await waitFor(() => expect(screen.getByRole('progressbar', { name: 'Call progress' })).not.toHaveAttribute('aria-valuenow'))
    expect(screen.getByText('7')).toBeInTheDocument()

    release()
    expect(await screen.findByTestId('tool-result')).toHaveTextContent('done')
    expect(screen.queryByRole('progressbar')).toBeNull()
  })

  it('ignores progress for another token', async () => {
    let release: () => void = () => undefined
    const gate = new Promise<void>((r) => (release = r))
    const env = await connect({ tools: [T('slow')], toolHandlers: { slow: async () => (await gate, text('done')) } })
    const user = userEvent.setup()
    mount(env)
    await pick(user, 'slow')
    await user.click(screen.getByRole('button', { name: 'Call tool' }))
    await screen.findByRole('progressbar')
    await act(async () => {
      await env.fake.sendNotification('notifications/progress', { progressToken: 'someone-else', progress: 9, total: 10 })
    })
    expect(screen.getByRole('progressbar')).not.toHaveAttribute('aria-valuenow')
    release()
    await screen.findByTestId('tool-result')
  })
})

describe('output schema', () => {
  const OUT = { type: 'object', properties: { n: { type: 'number' } }, required: ['n'] }
  const run = async (handlerResult: unknown) => {
    const env = await connect({ tools: [T('t', { outputSchema: OUT })], toolHandlers: { t: () => handlerResult } })
    const user = userEvent.setup()
    mount(env)
    await pick(user, 't')
    await user.click(screen.getByRole('button', { name: 'Call tool' }))
    return screen.findByTestId('tool-result')
  }

  it('valid structuredContent shows "Output matches schema"', async () => {
    const result = await run({ ...text('x'), structuredContent: { n: 1 } })
    expect(within(result).getByText('Output matches schema')).toBeInTheDocument()
    expect(within(result).queryByTestId('output-warning')).toBeNull()
  })

  it('a missing structuredContent warns but still renders the result', async () => {
    const result = await run(text('plain'))
    expect(within(result).getByTestId('output-warning')).toHaveTextContent('no structuredContent')
    expect(within(result).getByText('plain')).toBeInTheDocument()
    expect(within(result).queryByText('Output matches schema')).toBeNull()
  })

  it('a mismatching structuredContent lists the failing paths', async () => {
    const result = await run({ ...text('x'), structuredContent: { n: 'nope' } })
    const warning = within(result).getByTestId('output-warning')
    expect(warning).toHaveTextContent('n: Expected number, got string')
    expect(within(result).getByText(/"n": "nope"/)).toBeInTheDocument()
  })

  it('shows no schema line for tools without an outputSchema', async () => {
    const env = await connect({ tools: [T('t')], toolHandlers: { t: () => ({ ...text('x'), structuredContent: { a: 1 } }) } })
    const user = userEvent.setup()
    mount(env)
    await pick(user, 't')
    await user.click(screen.getByRole('button', { name: 'Call tool' }))
    const result = await screen.findByTestId('tool-result')
    expect(within(result).queryByTestId('output-warning')).toBeNull()
    expect(within(result).queryByTestId('output-valid')).toBeNull()
  })
})

describe('destructive confirmation', () => {
  const setup = async (annotations?: Record<string, unknown>) => {
    const env = await connect({
      tools: [T('wipe', annotations ? { annotations } : {}), T('other', { annotations: { destructiveHint: true } })],
      toolHandlers: { wipe: () => text('wiped'), other: () => text('other done') },
    })
    const user = userEvent.setup()
    const view = mount(env)
    return { env, user, view }
  }

  it('asks first; Cancel sends nothing', async () => {
    const { env, user } = await setup({ destructiveHint: true })
    await pick(user, 'wipe')
    await user.click(screen.getByRole('button', { name: 'Call tool' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toHaveTextContent('wipe')
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(calls(env)).toHaveLength(0)
    expect(screen.queryByTestId('tool-result')).toBeNull()
    expect(useMcpInspectorStore.getState().history).toHaveLength(0)
  })

  it('Confirm sends the call', async () => {
    const { env, user } = await setup({ destructiveHint: true })
    await pick(user, 'wipe')
    await user.click(screen.getByRole('button', { name: 'Call tool' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(calls(env)).toHaveLength(0)
    await user.click(within(dialog).getByRole('button', { name: 'Call tool' }))
    expect(await screen.findByTestId('tool-result')).toHaveTextContent('wiped')
    expect(calls(env)).toHaveLength(1)
  })

  it('"don\'t ask again" suppresses the dialog for that tool only', async () => {
    const { env, user } = await setup({ destructiveHint: true })
    await pick(user, 'wipe')
    await user.click(screen.getByRole('button', { name: 'Call tool' }))
    let dialog = await screen.findByRole('alertdialog')
    await user.click(within(dialog).getByRole('checkbox', { name: /Don't ask again/ }))
    await user.click(within(dialog).getByRole('button', { name: 'Call tool' }))
    await screen.findByTestId('tool-result')

    await user.click(screen.getByRole('button', { name: 'Call tool' }))
    await waitFor(() => expect(calls(env)).toHaveLength(2))
    expect(screen.queryByRole('alertdialog')).toBeNull()

    await pick(user, 'other')
    await user.click(screen.getByRole('button', { name: 'Call tool' }))
    dialog = await screen.findByRole('alertdialog')
    expect(calls(env)).toHaveLength(2)
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
  })

  it("forgets 'don't ask again' when the tab remounts", async () => {
    const { env, user, view: first } = await setup({ destructiveHint: true })
    await pick(user, 'wipe')
    await user.click(screen.getByRole('button', { name: 'Call tool' }))
    let dialog = await screen.findByRole('alertdialog')
    await user.click(within(dialog).getByRole('checkbox', { name: /Don't ask again/ }))
    await user.click(within(dialog).getByRole('button', { name: 'Call tool' }))
    await screen.findByTestId('tool-result')
    first.unmount()

    mount(env)
    await pick(user, 'wipe')
    await user.click(screen.getByRole('button', { name: 'Call tool' }))
    dialog = await screen.findByRole('alertdialog')
    expect(calls(env)).toHaveLength(1)
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
  })
  it.each([
    ['no annotations', undefined],
    ['destructiveHint: false', { destructiveHint: false }],
    ['readOnlyHint only', { readOnlyHint: true }],
  ])('never prompts for a tool with %s', async (_label, annotations) => {
    const { env, user } = await setup(annotations)
    await pick(user, 'wipe')
    await user.click(screen.getByRole('button', { name: 'Call tool' }))
    await screen.findByTestId('tool-result')
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(calls(env)).toHaveLength(1)
  })
})

describe('history', () => {
  const seed = (over: Record<string, unknown>) =>
    useMcpInspectorStore.getState().pushHistory({
      kind: 'tool',
      name: 't',
      argsJson: '{"count":1}',
      ok: true,
      durationMs: 5,
      profileId: PROFILE,
      ...over,
    } as never)

  it('pushes an entry after every call with the exact arguments', async () => {
    const env = await connect({ tools: [T('t', { inputSchema: COUNT })], toolHandlers: { t: () => text('x') } })
    const user = userEvent.setup()
    mount(env)
    await pick(user, 't')
    await user.type(within(details()).getByRole('textbox', { name: /count/ }), '8')
    await user.click(screen.getByRole('button', { name: 'Call tool' }))
    await screen.findByTestId('tool-result')
    expect(useMcpInspectorStore.getState().history).toEqual([
      expect.objectContaining({ kind: 'tool', name: 't', argsJson: '{"count":8}', ok: true, profileId: PROFILE }),
    ])
    expect(within(screen.getByTestId('history-list')).getAllByRole('listitem')).toHaveLength(1)
  })

  it('lists this profile\'s entries for this tool, newest first, and Load fills the form', async () => {
    seed({ argsJson: '{"count":1}' })
    seed({ argsJson: '{"count":2}', ok: false })
    seed({ profileId: 'someone-else', argsJson: '{"count":99}' })
    seed({ name: 'other-tool', argsJson: '{"count":98}' })
    seed({ kind: 'prompt', argsJson: '{"count":97}' })
    const env = await connect({ tools: [T('t', { inputSchema: COUNT })] })
    const user = userEvent.setup()
    mount(env)
    await pick(user, 't')
    const items = within(screen.getByTestId('history-list')).getAllByRole('listitem')
    expect(items).toHaveLength(2)
    expect(items[0]).toHaveTextContent('{"count":2}')
    expect(items[0]).toHaveTextContent('failed')
    expect(items[1]).toHaveTextContent('{"count":1}')

    await user.click(within(items[1]).getByRole('button', { name: 'Load' }))
    expect(within(details()).getByRole('textbox', { name: /count/ })).toHaveValue('1')
    await user.click(within(items[0]).getByRole('button', { name: 'Load' }))
    expect(within(details()).getByRole('textbox', { name: /count/ })).toHaveValue('2')
  })

  it('Load fills the JSON editor when in JSON mode', async () => {
    seed({ argsJson: '{"count":5}' })
    const env = await connect({ tools: [T('t', { inputSchema: COUNT })] })
    const user = userEvent.setup()
    mount(env)
    await pick(user, 't')
    await user.click(screen.getByRole('button', { name: 'JSON' }))
    await user.click(within(screen.getByTestId('history-list')).getByRole('button', { name: 'Load' }))
    expect(JSON.parse((screen.getByLabelText('JSON arguments') as HTMLTextAreaElement).value)).toEqual({ count: 5 })
  })

  it('Clear removes this profile\'s history only', async () => {
    seed({})
    seed({ profileId: 'someone-else' })
    const env = await connect({ tools: [T('t', { inputSchema: COUNT })] })
    const user = userEvent.setup()
    mount(env)
    await pick(user, 't')
    const panel = screen.getByRole('region', { name: 'History' })
    await user.click(within(panel).getByRole('button', { name: 'Clear' }))
    expect(within(panel).getByText('No calls to this tool yet.')).toBeInTheDocument()
    expect(useMcpInspectorStore.getState().history.map((h) => h.profileId)).toEqual(['someone-else'])
  })

  it('with saveHistory off nothing is stored and the panel says history is off', async () => {
    useMcpInspectorStore.setState({ prefs: { saveHistory: false } })
    const env = await connect({ tools: [T('t')], toolHandlers: { t: () => text('x') } })
    const user = userEvent.setup()
    mount(env)
    await pick(user, 't')
    const panel = screen.getByRole('region', { name: 'History' })
    expect(within(panel).getByText(/History is off/)).toBeInTheDocument()
    expect(within(panel).queryByRole('button', { name: 'Clear' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Call tool' }))
    await screen.findByTestId('tool-result')
    expect(useMcpInspectorStore.getState().history).toHaveLength(0)
  })
})

describe('untrusted server text', () => {
  const XSS = '<img src=x onerror=alert(1)>'

  it('renders tool title, description and result text as text (no img element)', async () => {
    const env = await connect({
      tools: [T('t', { title: XSS, description: ` (description)` })],
      toolHandlers: { t: () => text(XSS) },
    })
    const user = userEvent.setup()
    const { container } = mount(env)
    await within(sidebar()).findAllByText(XSS)
    expect(container.querySelector('img')).toBeNull()
    await pick(user, XSS)
    await user.click(screen.getByRole('button', { name: 'Call tool' }))
    await screen.findByTestId('tool-result')
    expect(container.querySelector('img')).toBeNull()
    expect(container.textContent).toContain(XSS)
    expect(container.querySelector('script')).toBeNull()
  })

  it('renders a malicious error message as text too', async () => {
    const env = await connect({ tools: [T('t')], rejectMethods: { 'tools/call': { code: 1, message: XSS } } })
    const user = userEvent.setup()
    const { container } = mount(env)
    await pick(user, 't')
    await user.click(screen.getByRole('button', { name: 'Call tool' }))
    await screen.findByTestId('tool-result')
    expect(container.querySelector('img')).toBeNull()
    expect(container.textContent).toContain(XSS)
  })
})
