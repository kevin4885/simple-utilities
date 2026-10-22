import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('../../shell/viewerIo', async (orig) => ({
  ...(await orig<typeof import('../../shell/viewerIo')>()),
  copyText: vi.fn().mockResolvedValue(true),
  downloadBlob: vi.fn(),
}))

import { copyText, downloadBlob } from '../../shell/viewerIo'
import { createFakeServer, type FakeServer, type FakeServerOptions } from '../../testing/fakeServer'
import { createSession, type McpSession } from '../../connection/session'
import type { ServerSummary, SessionOptions } from '../../connection/types'
import type { TabProps } from '../../shell/logic'
import { useLogStore } from '../../shell/logStore'
import { CHECKS } from '../../conformance/checks'
import ConformanceTab from './ConformanceTab'

const fakes: FakeServer[] = []
const sessions: McpSession[] = []

function serverOptions(extra: FakeServerOptions = {}): FakeServerOptions {
  return {
    sessionId: 'SESSION-ID-9876',
    capabilities: { tools: {}, resources: {}, prompts: {} },
    tools: [
      { name: 'now', description: 'time', inputSchema: { type: 'object' }, annotations: { readOnlyHint: true } },
      { name: 'wipe', description: 'wipe', inputSchema: { type: 'object' }, annotations: { destructiveHint: true } },
    ],
    toolHandlers: {
      now: () => ({ content: [{ type: 'text', text: 'noon' }] }),
      wipe: () => {
        throw new Error('must not be called')
      },
    },
    resources: [{ uri: 'file:///a.txt', name: 'a' }],
    resourceContents: { 'file:///a.txt': [{ uri: 'file:///a.txt', text: 'hi' }] },
    prompts: [{ name: 'p', arguments: [{ name: 'x', required: true }] }],
    promptHandlers: {
      p: (a) => {
        if (!a.x) throw { code: -32602, message: 'x required' }
        return { messages: [] }
      },
    },
    ...extra,
  }
}

async function setup(extra: FakeServerOptions = {}, secretHeader = 'Bearer SECRET') {
  const created: FakeServer[] = []
  // A fresh in-memory fake per transport request: the main session and the throwaway session of
  // http.session-delete must not share one transport.
  const fetchCalls: string[] = []
  const fetchImpl = (async (_i: RequestInfo | URL, init?: RequestInit) => {
    fetchCalls.push(init?.method ?? 'GET')
    if (init?.method === 'DELETE') return new Response(null, { status: 405 })
    return new Response(null, { status: 202 })
  }) as typeof fetch
  const base: Omit<SessionOptions, 'onLog' | 'onState'> = {
    config: {
      url: 'https://mcp.test/mcp',
      transport: 'streamable-http',
      headers: [{ name: 'Authorization', value: secretHeader }],
      protocolVersion: null,
    },
    fetchImpl,
    transportFactory: () => {
      const f = createFakeServer(serverOptions(extra))
      created.push(f)
      fakes.push(f)
      return f.clientTransport
    },
  }
  const session = createSession({ ...base, onLog: () => undefined, onState: () => undefined })
  sessions.push(session)
  const state = await session.connect()
  if (state.status !== 'connected') throw new Error('not connected')
  const props: TabProps = { session, info: state.info as ServerSummary, sessionOptions: base, profileId: 'p1' }
  return { props, main: created[0], fetchCalls }
}

beforeEach(() => {
  vi.mocked(copyText).mockClear()
  vi.mocked(downloadBlob).mockClear()
  useLogStore.getState().clear()
})

afterEach(async () => {
  for (const s of sessions.splice(0)) await s.disconnect().catch(() => undefined)
  for (const f of fakes.splice(0)) await f.close().catch(() => undefined)
})

const checkbox = (id: string) => document.getElementById(`check-${id}`) as HTMLElement

describe('ConformanceTab layout', () => {
  it('groups checks, preselects defaultOn checks and leaves call-smoke unchecked with its explanation', async () => {
    const { props } = await setup()
    render(<ConformanceTab {...props} />)
    for (const g of new Set(CHECKS.map((c) => c.group))) expect(screen.getByRole('region', { name: g })).toBeInTheDocument()
    for (const c of CHECKS) {
      expect(checkbox(c.id)).toHaveAttribute('aria-checked', c.defaultOn ? 'true' : 'false')
    }
    expect(checkbox('tools.call-smoke')).toHaveAttribute('aria-checked', 'false')
    expect(screen.getByText(/Calls read-only tools that need no arguments/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Run selected' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: 'Stop' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Download JSON' })).toBeDisabled()
  })
})

describe('ConformanceTab running', () => {
  it('Run selected streams results with icon + text status, summary counts, and never calls a real tool', async () => {
    const user = userEvent.setup()
    const { props, main } = await setup()
    render(<ConformanceTab {...props} />)
    await user.click(screen.getByRole('button', { name: 'Run selected' }))
    const row = await screen.findByTestId('result-handshake.ping')
    expect(within(row).getByText('Pass')).toBeInTheDocument()
    expect(row.querySelector('svg')).not.toBeNull() // icon next to the word
    await waitFor(() => expect(screen.getByRole('button', { name: 'Run selected' })).toBeEnabled(), { timeout: 5000 })
    expect(screen.getByLabelText('Summary').textContent).toMatch(/Pass: 1\d/)
    expect(screen.getByLabelText('Summary').textContent).toContain('Fail: 0')
    expect(screen.getByLabelText('Summary').textContent).toContain('Info: 1')
    const toolNames = main.received
      .filter((m) => (m as { method?: string }).method === 'tools/call')
      .map((m) => (m as { params?: { name?: string } }).params?.name)
    expect(toolNames).not.toContain('now')
    expect(toolNames).not.toContain('wipe')
    // the throwaway-session check ran and said so
    expect(within(screen.getByTestId('result-http.session-delete')).getByText(/does not allow client session termination/)).toBeInTheDocument()
  })

  it('shows a text label for fail and warn rows too', async () => {
    const user = userEvent.setup()
    const { props } = await setup({ tools: [{ name: 'quiet', inputSchema: { type: 'string' } }] })
    render(<ConformanceTab {...props} />)
    await user.click(screen.getByRole('button', { name: 'Run group Tools' }))
    const bad = await screen.findByTestId('result-tools.input-schema-valid')
    expect(within(bad).getByText('Fail')).toBeInTheDocument()
    expect(within(screen.getByTestId('result-tools.descriptions-present')).getByText('Warn')).toBeInTheDocument()
    expect(within(screen.getByTestId('result-tools.output-schema-valid')).getByText('Skip')).toBeInTheDocument()
  })

  it('Run group runs only that group; Re-run one re-runs a single check', async () => {
    const user = userEvent.setup()
    const { props } = await setup()
    render(<ConformanceTab {...props} />)
    await user.click(screen.getByRole('button', { name: 'Run group Handshake' }))
    await screen.findByTestId('result-handshake.ping')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Run group Handshake' })).toBeEnabled())
    expect(screen.getByTestId('result-handshake.initialize-valid')).toBeInTheDocument()
    expect(screen.queryByTestId('result-tools.unique-names')).not.toBeInTheDocument()
    expect(screen.queryByTestId('result-errors.unknown-method')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Re-run errors.unknown-method' }))
    await screen.findByTestId('result-errors.unknown-method')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Run selected' })).toBeEnabled())
    expect(screen.queryByTestId('result-tools.unique-names')).not.toBeInTheDocument()
  })

  it('a checked opt-in call-smoke check is run; unchecking a default check excludes it', async () => {
    const user = userEvent.setup()
    const { props, main } = await setup()
    render(<ConformanceTab {...props} />)
    for (const c of CHECKS) if (c.id !== 'tools.call-smoke' && checkbox(c.id).getAttribute('aria-checked') === 'true') await user.click(checkbox(c.id))
    await user.click(checkbox('tools.call-smoke'))
    await user.click(screen.getByRole('button', { name: 'Run selected' }))
    await screen.findByTestId('result-tools.call-smoke')
    expect(screen.getAllByTestId(/^result-/)).toHaveLength(1)
    const names = main.received.filter((m) => (m as { method?: string }).method === 'tools/call').map((m) => (m as { params?: { name?: string } }).params?.name)
    expect(names).toEqual(['now']) // read-only tool only; the destructive one is never called
  })

  it('Run selected is disabled with nothing selected', async () => {
    const user = userEvent.setup()
    const { props } = await setup()
    render(<ConformanceTab {...props} />)
    for (const c of CHECKS) if (checkbox(c.id).getAttribute('aria-checked') === 'true') await user.click(checkbox(c.id))
    expect(screen.getByRole('button', { name: 'Run selected' })).toBeDisabled()
  })

  it('while running: Run is disabled and Stop cancels, marking unstarted checks Skip/Cancelled', async () => {
    const user = userEvent.setup()
    const { props } = await setup({ onRequest: (r) => (r.method === 'ping' ? 'no-response' : undefined) })
    render(<ConformanceTab {...props} />)
    await user.click(screen.getByRole('button', { name: 'Run selected' }))
    const stop = await screen.findByRole('button', { name: 'Stop' })
    expect(screen.getByRole('button', { name: 'Run selected' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Run group Tools' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Re-run errors.unknown-method' })).toBeDisabled()
    expect(screen.getByText('Running')).toBeInTheDocument()
    await user.click(stop)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Run selected' })).toBeEnabled())
    expect(screen.queryByRole('button', { name: 'Stop' })).not.toBeInTheDocument()
    const cancelled = screen.getByTestId('result-errors.unknown-method')
    expect(within(cancelled).getByText('Skip')).toBeInTheDocument()
    expect(within(cancelled).getByText('Cancelled')).toBeInTheDocument()
  })

  it('expands detail through JsonView', async () => {
    const user = userEvent.setup()
    const { props } = await setup({ tools: [{ name: 'quiet', inputSchema: { type: 'object' } }] })
    render(<ConformanceTab {...props} />)
    await user.click(screen.getByRole('button', { name: 'Re-run tools.descriptions-present' }))
    const row = await screen.findByTestId('result-tools.descriptions-present')
    expect(row.textContent).not.toContain('"missing"')
    await user.click(within(row).getByRole('button', { name: /Show details/ }))
    expect(row.textContent).toContain('"missing"')
    expect(row.textContent).toContain('quiet')
    await user.click(within(row).getByRole('button', { name: /Hide details/ }))
    expect(row.textContent).not.toContain('"missing"')
  })

  it('renders server text as text, not HTML', async () => {
    const user = userEvent.setup()
    const { props } = await setup({ tools: [{ name: '<img src=x onerror=alert(1)>', inputSchema: { type: 'object' } }] })
    render(<ConformanceTab {...props} />)
    await user.click(screen.getByRole('button', { name: 'Re-run tools.descriptions-present' }))
    const row = await screen.findByTestId('result-tools.descriptions-present')
    expect(row.textContent).toContain('<img src=x onerror=alert(1)>')
    expect(document.querySelector('img')).toBeNull()
  })
})

describe('ConformanceTab report buttons', () => {
  it('Download JSON hands over a report without header values, tokens or the session id', async () => {
    const user = userEvent.setup()
    const { props } = await setup()
    expect(props.info.sessionId).toBe('SESSION-ID-9876')
    render(<ConformanceTab {...props} />)
    await user.click(screen.getByRole('button', { name: 'Run selected' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Run selected' })).toBeEnabled(), { timeout: 5000 })
    await user.click(screen.getByRole('button', { name: 'Download JSON' }))
    expect(downloadBlob).toHaveBeenCalledTimes(1)
    const [filename, data, mime] = vi.mocked(downloadBlob).mock.calls[0]
    expect(filename).toBe('mcp-conformance-report.json')
    expect(mime).toBe('application/json')
    const text = String(data)
    const report = JSON.parse(text)
    expect(report.tool).toBe('Simple Utilities MCP Inspector')
    expect(report.server.name).toBe('fake-server')
    expect(report.results.length).toBe(CHECKS.length - 1)
    expect(report.counts.total).toBe(CHECKS.length - 1)
    expect(text).not.toContain('SECRET')
    expect(text).not.toContain('Bearer')
    expect(text).not.toContain('SESSION-ID-9876')
  })

  it('Copy Markdown copies a table and escapes pipes/newlines from server text', async () => {
    const user = userEvent.setup()
    const { props } = await setup({ tools: [{ name: 'a|b\nc', inputSchema: { type: 'object' } }] })
    render(<ConformanceTab {...props} />)
    await user.click(screen.getByRole('button', { name: 'Re-run tools.descriptions-present' }))
    await screen.findByTestId('result-tools.descriptions-present')
    await user.click(screen.getByRole('button', { name: 'Copy Markdown' }))
    await waitFor(() => expect(copyText).toHaveBeenCalledTimes(1))
    const md = String(vi.mocked(copyText).mock.calls[0][0])
    expect(md).toContain('| id | status | message |')
    expect(md).toContain('a\\|b c')
    const rows = md.split('\n').filter((l) => l.startsWith('| tools.'))
    expect(rows).toHaveLength(1)
    expect(md).not.toContain('SESSION-ID-9876')
    expect(await screen.findByText('Markdown copied')).toBeInTheDocument()
  })

  it('a secret echoed by the server into a message is scrubbed from the export', async () => {
    const user = userEvent.setup()
    const { props } = await setup({ tools: [{ name: 'SECRET-TOKEN-1', inputSchema: { type: 'object' } }] }, 'Bearer SECRET-TOKEN-1')
    render(<ConformanceTab {...props} />)
    await user.click(screen.getByRole('button', { name: 'Re-run tools.descriptions-present' }))
    await screen.findByTestId('result-tools.descriptions-present')
    await user.click(screen.getByRole('button', { name: 'Download JSON' }))
    expect(String(vi.mocked(downloadBlob).mock.calls[0][1])).not.toContain('SECRET-TOKEN-1')
  })
})
