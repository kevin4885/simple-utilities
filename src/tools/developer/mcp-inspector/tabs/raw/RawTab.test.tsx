import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { McpSession } from '../../connection/session'
import type { RawResult, ServerSummary } from '../../connection/types'

vi.mock('@/components/editor/CodeEditor', () => ({
  default: ({ value, onChange }: { value: string; onChange?: (v: string) => void }) => (
    <textarea aria-label="Params editor" value={value} onChange={(e) => onChange?.(e.target.value)} />
  ),
}))

import { useUiStore } from '../../shell/uiStore'
import { useMcpInspectorStore } from '../../store'
import RawTab from './RawTab'

const info: ServerSummary = {
  serverName: 's',
  serverVersion: '1',
  title: null,
  protocolVersion: '2025-11-25',
  capabilities: {},
  instructions: null,
  transport: 'streamable-http',
  sessionId: null,
}

interface FakeSession {
  rawRequest: ReturnType<typeof vi.fn>
  rawNotification: ReturnType<typeof vi.fn>
}

function setup(session: Partial<FakeSession> = {}, profileId = 'p1') {
  const fake: FakeSession = {
    rawRequest: session.rawRequest ?? vi.fn().mockResolvedValue({ ok: true, result: { pong: true }, durationMs: 12 } satisfies RawResult),
    rawNotification: session.rawNotification ?? vi.fn().mockResolvedValue({ ok: true }),
  }
  const props = {
    session: fake as unknown as McpSession,
    info,
    sessionOptions: {} as never,
    profileId,
  }
  const view = render(<RawTab {...props} />)
  return { fake, view, props }
}

const methodInput = () => screen.getByLabelText('Method') as HTMLInputElement
const editor = () => screen.getByLabelText('Params editor') as HTMLTextAreaElement
const sendButton = () => screen.getByRole('button', { name: /^Send|^Sending/ })

beforeEach(() => {
  useUiStore.setState({ activeTab: 'raw', rawDraft: null, draftNonce: 0 })
  useMcpInspectorStore.setState({ history: [], prefs: { saveHistory: true } })
})

describe('RawTab request mode', () => {
  it('sends the request once with parsed params and timeout, shows result and duration', async () => {
    const user = userEvent.setup()
    const { fake } = setup()
    await user.type(methodInput(), 'tools/call')
    await user.click(editor())
    await user.paste('{"name":"echo"}')
    await user.click(sendButton())

    expect(fake.rawRequest).toHaveBeenCalledTimes(1)
    const [method, params, opts] = fake.rawRequest.mock.calls[0]
    expect(method).toBe('tools/call')
    expect(params).toEqual({ name: 'echo' })
    expect(opts.timeoutMs).toBe(60000)
    expect(opts.signal).toBeInstanceOf(AbortSignal)
    expect(await screen.findByText(/"pong": true/)).toBeInTheDocument()
    expect(within(screen.getByLabelText('Response')).getByText('12 ms')).toBeInTheDocument()
  })

  it('sends no params for empty editor text', async () => {
    const user = userEvent.setup()
    const { fake } = setup()
    await user.type(methodInput(), 'ping')
    await user.click(sendButton())
    expect(fake.rawRequest.mock.calls[0][1]).toBeUndefined()
  })

  it('uses the typed timeout and rejects values below 1000', async () => {
    const user = userEvent.setup()
    const { fake } = setup()
    await user.type(methodInput(), 'ping')
    const timeout = screen.getByLabelText('Timeout (ms)')
    await user.clear(timeout)
    await user.type(timeout, '500')
    expect(screen.getByText(/at least 1000 ms/)).toBeInTheDocument()
    expect(sendButton()).toBeDisabled()
    await user.clear(timeout)
    await user.type(timeout, '2500')
    await user.click(sendButton())
    expect(fake.rawRequest.mock.calls[0][2].timeoutMs).toBe(2500)
  })

  it('renders a server error under "Protocol error"', async () => {
    const user = userEvent.setup()
    setup({
      rawRequest: vi.fn().mockResolvedValue({
        ok: false,
        error: { code: -32601, message: 'Method not found', data: { x: 1 } },
        durationMs: 3,
      } satisfies RawResult),
    })
    await user.type(methodInput(), 'nope')
    await user.click(sendButton())
    expect(await screen.findByRole('heading', { name: /Protocol error/ })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /Local failure/ })).toBeNull()
    expect(screen.getByText(/-32601/)).toBeInTheDocument()
    expect(screen.getByText(/Method not found/)).toBeInTheDocument()
  })

  it('renders a code:null failure under "Local failure"', async () => {
    const user = userEvent.setup()
    setup({
      rawRequest: vi.fn().mockResolvedValue({
        ok: false,
        error: { code: null, message: 'Request timed out after 1000 ms' },
        durationMs: 1000,
      } satisfies RawResult),
    })
    await user.type(methodInput(), 'ping')
    await user.click(sendButton())
    expect(await screen.findByRole('heading', { name: /Local failure/ })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /Protocol error/ })).toBeNull()
    expect(screen.getByText(/timed out/)).toBeInTheDocument()
  })

  it('disables Send while in flight and Cancel aborts the signal and shows Cancelled', async () => {
    const user = userEvent.setup()
    let signal: AbortSignal | undefined
    const rawRequest = vi.fn((_m: string, _p: unknown, o: { signal: AbortSignal }) => {
      signal = o.signal
      return new Promise<RawResult>((r) => {
        o.signal.addEventListener('abort', () =>
          r({ ok: false, error: { code: null, message: 'Request aborted' }, durationMs: 4 }),
        )
      })
    })
    setup({ rawRequest })
    await user.type(methodInput(), 'ping')
    await user.click(sendButton())

    expect(sendButton()).toBeDisabled()
    expect(rawRequest).toHaveBeenCalledTimes(1)
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(signal?.aborted).toBe(true)
    expect(await screen.findByText('Cancelled')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /Local failure/ })).toBeNull()
    expect(sendButton()).toBeEnabled()
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull()
  })
})

describe('RawTab notification mode', () => {
  it('calls rawNotification and shows "Notification sent" without a response area', async () => {
    const user = userEvent.setup()
    const { fake } = setup()
    await user.type(methodInput(), 'notifications/cancelled')
    await user.click(screen.getByRole('radio', { name: 'Notification' }))
    await user.click(editor())
    await user.paste('{"requestId":1}')
    await user.click(sendButton())

    expect(fake.rawNotification).toHaveBeenCalledWith('notifications/cancelled', { requestId: 1 })
    expect(fake.rawRequest).not.toHaveBeenCalled()
    expect(await screen.findByText('Notification sent')).toBeInTheDocument()
    expect(screen.queryByLabelText('Response')).toBeNull()
    expect(screen.queryByLabelText('Timeout (ms)')).toBeNull()
  })

  it('shows a local failure when the notification cannot be sent', async () => {
    const user = userEvent.setup()
    setup({ rawNotification: vi.fn().mockResolvedValue({ ok: false, message: 'Not connected' }) })
    await user.type(methodInput(), 'notifications/x')
    await user.click(screen.getByRole('radio', { name: 'Notification' }))
    await user.click(sendButton())
    expect(await screen.findByRole('heading', { name: /Local failure/ })).toBeInTheDocument()
    expect(screen.getByText('Not connected')).toBeInTheDocument()
    expect(useMcpInspectorStore.getState().history[0]).toMatchObject({ kind: 'raw', ok: false })
  })
})

describe('RawTab validation', () => {
  it('disables Send for an empty method and for blocked methods with a message', async () => {
    const user = userEvent.setup()
    setup()
    expect(sendButton()).toBeDisabled()
    await user.type(methodInput(), 'initialize')
    expect(sendButton()).toBeDisabled()
    expect(screen.getByRole('alert')).toHaveTextContent('Use Reconnect to re-initialize')
    await user.clear(methodInput())
    await user.type(methodInput(), 'custom/anything')
    expect(sendButton()).toBeEnabled()
  })

  it('shows an inline error and disables Send for invalid params JSON', async () => {
    const user = userEvent.setup()
    const { fake } = setup()
    await user.type(methodInput(), 'ping')
    await user.click(editor())
    await user.paste('{"a":')
    expect(screen.getByRole('alert')).toHaveTextContent(/Invalid JSON/)
    expect(sendButton()).toBeDisabled()
    await user.clear(editor())
    await user.paste('42')
    expect(screen.getByRole('alert')).toHaveTextContent(/object or array/)
    expect(sendButton()).toBeDisabled()
    expect(fake.rawRequest).not.toHaveBeenCalled()
  })

  it('offers the known methods as suggestions', () => {
    setup()
    const list = document.getElementById(methodInput().getAttribute('list')!)!
    const values = Array.from(list.querySelectorAll('option')).map((o) => o.getAttribute('value'))
    expect(values).toContain('tools/list')
    expect(values).toContain('logging/setLevel')
  })
})

describe('RawTab draft handoff', () => {
  it('loads a draft once per nonce and does not overwrite later edits on re-render', async () => {
    const user = userEvent.setup()
    const { view, props } = setup()
    act(() => useUiStore.getState().setRawDraft({ method: 'tools/call', paramsText: '{"a":1}' }))
    expect(methodInput().value).toBe('tools/call')
    expect(editor().value).toBe('{"a":1}')

    await user.clear(methodInput())
    await user.type(methodInput(), 'edited')
    view.rerender(<RawTab {...props} />)
    expect(methodInput().value).toBe('edited')

    act(() => useUiStore.getState().setRawDraft({ method: 'ping', paramsText: '' }))
    expect(methodInput().value).toBe('ping')
    expect(editor().value).toBe('')
  })

  it('loads a draft that was set before the tab mounted', () => {
    useUiStore.getState().setRawDraft({ method: 'resources/list', paramsText: '{}' })
    setup()
    expect(methodInput().value).toBe('resources/list')
    expect(editor().value).toBe('{}')
  })

  it('switches to notification mode for a notifications/* draft', () => {
    useUiStore.getState().setRawDraft({ method: 'notifications/cancelled', paramsText: '' })
    setup()
    expect(screen.getByRole('radio', { name: 'Notification' })).toBeChecked()
  })
})

describe('RawTab history', () => {
  it('pushes a raw history entry per send and lists it under Recent for this profile only', async () => {
    const user = userEvent.setup()
    setup()
    useMcpInspectorStore.setState({
      history: [{ id: 'other', ts: 1, profileId: 'p2', kind: 'raw', name: 'other/method', argsJson: '{}', ok: true, durationMs: 1 }],
    })
    await user.type(methodInput(), 'tools/call')
    await user.click(editor())
    await user.paste('{"name":"echo"}')
    await user.click(sendButton())
    await screen.findByText(/"pong": true/)

    const history = useMcpInspectorStore.getState().history
    expect(history).toHaveLength(2)
    expect(history[1]).toMatchObject({
      profileId: 'p1',
      kind: 'raw',
      name: 'tools/call',
      argsJson: '{"name":"echo"}',
      ok: true,
      durationMs: 12,
    })
    expect(screen.queryByText('other/method')).toBeNull()
  })

  it('records {} for empty params and ok:false for a failed request', async () => {
    const user = userEvent.setup()
    setup({
      rawRequest: vi.fn().mockResolvedValue({ ok: false, error: { code: -1, message: 'x' }, durationMs: 5 } satisfies RawResult),
    })
    await user.type(methodInput(), 'ping')
    await user.click(sendButton())
    await screen.findByRole('heading', { name: /Protocol error/ })
    expect(useMcpInspectorStore.getState().history[0]).toMatchObject({ name: 'ping', argsJson: '{}', ok: false, durationMs: 5 })
  })

  it('re-loads a Recent entry into the composer', async () => {
    const user = userEvent.setup()
    useMcpInspectorStore.setState({
      history: [{ id: 'h1', ts: 1, profileId: 'p1', kind: 'raw', name: 'prompts/get', argsJson: '{"name":"hi"}', ok: true, durationMs: 9 }],
    })
    setup()
    await user.click(screen.getByRole('button', { name: /prompts\/get/ }))
    expect(methodInput().value).toBe('prompts/get')
    expect(editor().value).toBe('{"name":"hi"}')
  })

  it('ignores non-raw history entries', () => {
    useMcpInspectorStore.setState({
      history: [{ id: 'h1', ts: 1, profileId: 'p1', kind: 'tool', name: 'echo', argsJson: '{}', ok: true, durationMs: 9 }],
    })
    setup()
    expect(screen.queryByRole('button', { name: /echo/ })).toBeNull()
  })
})
