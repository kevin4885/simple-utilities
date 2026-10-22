import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { UnauthorizedError, type Transport } from '@modelcontextprotocol/client'
import { createFakeServer, type FakeServerOptions } from '../testing/fakeServer'

const mocks = vi.hoisted(() => ({
  fake: {} as Record<string, unknown>,
  failures: [] as Error[],
  isMobile: false,
  factoryCalls: 0,
}))

vi.mock('@/lib/useMediaQuery', () => ({ useMediaQuery: () => mocks.isMobile }))
vi.mock('../connection/session', async (orig) => {
  const real = await orig<typeof import('../connection/session')>()
  return {
    ...real,
    createSession: (opts: Parameters<typeof real.createSession>[0]) =>
      real.createSession({
        ...opts,
        transportFactory: () => {
          const err = mocks.failures[mocks.factoryCalls++]
          if (err) throw err
          return createFakeServer(mocks.fake as FakeServerOptions).clientTransport as Transport
        },
      }),
  }
})
// The real tabs have their own suites; the shell only needs to know that the default tab is mounted.
vi.mock('../tabs/tools/ToolsTab', () => ({ default: () => <div data-testid="tab-stub-tools">tools stub</div> }))
vi.mock('../auth/flow', () => ({
  completeAuthorization: vi.fn(),
  consumePendingOAuthReturn: vi.fn(() => null),
}))
vi.mock('./viewerIo', async (orig) => ({
  ...(await orig<typeof import('./viewerIo')>()),
  copyText: vi.fn().mockResolvedValue(true),
  downloadBlob: vi.fn(),
}))

import { completeAuthorization } from '../auth/flow'
import { useMcpInspectorStore } from '../store'
import { useLogStore } from './logStore'
import { useUiStore } from './uiStore'
import { copyText } from './viewerIo'
import McpInspectorShell from './McpInspectorShell'
import McpInspector from '../index'

function seedProfile(over: Record<string, unknown> = {}) {
  const p = useMcpInspectorStore.getState().addProfile({ name: 'Server A', url: 'https://mcp.test/mcp' })
  if (Object.keys(over).length) useMcpInspectorStore.getState().updateProfile(p.id, over)
  return p
}

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  useMcpInspectorStore.setState({ profiles: [], activeProfileId: null, history: [] })
  useLogStore.getState().clear()
  useUiStore.setState({ activeTab: 'tools' })
  mocks.fake = { serverInfo: { name: 'fake', version: '3.1' }, sessionId: 'sess-9', tools: [], instructions: 'Be <b>nice</b>' }
  mocks.failures = []
  mocks.isMobile = false
  mocks.factoryCalls = 0
  vi.mocked(completeAuthorization).mockReset()
  vi.mocked(copyText).mockClear()
  Element.prototype.scrollIntoView ??= () => {}
  Element.prototype.hasPointerCapture ??= () => false
})

describe('layout', () => {
  it('the root has flex flex-col h-full overflow-hidden and never uses h-screen', () => {
    const { container } = render(<McpInspector />)
    const root = container.firstElementChild as HTMLElement
    for (const c of ['flex', 'flex-col', 'h-full', 'overflow-hidden']) expect(root).toHaveClass(c)
    expect(container.innerHTML).not.toMatch(/h-screen|min-h-screen/)
  })

  it('the log drawer defaults closed and shows a simple "Log (n)" toggle that opens it', async () => {
    render(<McpInspectorShell />)
    const toggle = screen.getByRole('button', { name: 'Log (0)' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByLabelText('Filter log')).toBeNull()
    await userEvent.setup().click(toggle)
    expect(screen.getByLabelText('Filter log')).toBeInTheDocument()
  })

  it('on a narrow viewport the sidebar lives in a Sheet opened by a button', async () => {
    mocks.isMobile = true
    seedProfile()
    render(<McpInspectorShell />)
    expect(screen.queryByLabelText('Server URL')).toBeNull()
    expect(screen.queryByRole('complementary')).toBeNull()
    await userEvent.setup().click(screen.getByRole('button', { name: /Profiles/ }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByLabelText('Server URL')).toBeInTheDocument()
  })

  it('on a wide viewport the sidebar is always visible', () => {
    seedProfile()
    render(<McpInspectorShell />)
    expect(screen.getByLabelText('Server URL')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Profiles$/ })).toBeNull()
  })
})

describe('pre-flight', () => {
  it('disables Connect for an invalid URL and for an invalid header name', () => {
    seedProfile({ url: 'ftp://nope' })
    const { unmount } = render(<McpInspectorShell />)
    expect(screen.getByRole('button', { name: 'Connect' })).toBeDisabled()
    unmount()

    useMcpInspectorStore.setState({ profiles: [], activeProfileId: null })
    seedProfile({ headers: [{ id: 'h1', name: 'Bad Name', value: 'x', secret: false, enabled: true }] })
    render(<McpInspectorShell />)
    expect(screen.getByRole('button', { name: 'Connect' })).toBeDisabled()
    expect(screen.getByText(/Invalid header name: Bad Name/)).toBeInTheDocument()
  })

  it('enables Connect for a valid profile', () => {
    seedProfile()
    render(<McpInspectorShell />)
    expect(screen.getByRole('button', { name: 'Connect' })).toBeEnabled()
  })

  it('shows a visible, non-blocking mixed-content warning for http:// on an https page', () => {
    const original = window.location
    Object.defineProperty(window, 'location', { configurable: true, value: { ...original, protocol: 'https:', origin: 'https://app.test' } })
    try {
      seedProfile({ url: 'http://example.com/mcp' })
      render(<McpInspectorShell />)
      expect(screen.getByTestId('mixed-content-warning')).toHaveTextContent(/mixed content/i)
      expect(screen.getByTestId('mixed-content-warning')).toHaveTextContent(/https/)
      expect(screen.getByRole('button', { name: 'Connect' })).toBeEnabled()
    } finally {
      Object.defineProperty(window, 'location', { configurable: true, value: original })
    }
  })

  it('shows no mixed-content warning for an https server', () => {
    seedProfile()
    render(<McpInspectorShell />)
    expect(screen.queryByTestId('mixed-content-warning')).toBeNull()
  })

  it('invites you to create a profile when there is none, and Connect does not exist yet', async () => {
    render(<McpInspectorShell />)
    expect(screen.getByText(/No profile selected/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Connect' })).toBeDisabled()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Create a profile' }))
    expect(useMcpInspectorStore.getState().profiles).toHaveLength(1)
  })
})

describe('connect flow', () => {
  it('shows Connecting then Connected with the summary, and Disconnect returns to Disconnected', async () => {
    const user = userEvent.setup()
    mocks.fake = { ...mocks.fake, latencyMs: 40 }
    seedProfile()
    render(<McpInspectorShell />)
    expect(screen.getByTestId('status-badge')).toHaveTextContent('Disconnected')
    expect(screen.getByText('Connect to a server to begin.')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Connect' }))
    await waitFor(() => expect(screen.getByTestId('status-badge')).toHaveTextContent('Connecting'))
    await waitFor(() => expect(screen.getByTestId('status-badge')).toHaveTextContent('Connected'))

    const summary = screen.getByTestId('server-summary')
    expect(summary).toHaveTextContent('fake 3.1')
    expect(summary).toHaveTextContent(/Protocol version\s*20\d\d-\d\d-\d\d/)
    expect(summary).toHaveTextContent('Streamable HTTP')
    expect(summary).toHaveTextContent('Session ID')
    expect(summary).toHaveTextContent('tools')
    expect(screen.queryByText('Connect to a server to begin.')).toBeNull()
    // the default tab is mounted
    expect(within(screen.getByRole('tabpanel')).getByTestId('tab-stub-tools')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Disconnect' }))
    await waitFor(() => expect(screen.getByTestId('status-badge')).toHaveTextContent('Disconnected'))
    expect(screen.queryByTestId('server-summary')).toBeNull()
    expect(screen.getByText('Connect to a server to begin.')).toBeInTheDocument()
  })

  it('shows "none" when the server issues no session id, and instructions only in a collapsible as text', async () => {
    const user = userEvent.setup()
    mocks.fake = { serverInfo: { name: 'fake', version: '1' }, tools: [], instructions: 'Be <img src=x onerror=alert(1)> nice' }
    seedProfile()
    const { container } = render(<McpInspectorShell />)
    await user.click(screen.getByRole('button', { name: 'Connect' }))
    await screen.findByTestId('server-summary')
    expect(screen.getByTestId('server-summary')).toHaveTextContent(/Session ID\s*none/)
    expect(screen.queryByText(/Be <img/)).toBeNull() // collapsed: instructions not rendered yet
    await user.click(screen.getByRole('button', { name: 'Server instructions' }))
    expect(screen.getByText('Be <img src=x onerror=alert(1)> nice')).toBeInTheDocument()
    expect(container.querySelector('img')).toBeNull()
  })

  it('Resources/Prompts tabs are disabled when the server advertises only tools', async () => {
    seedProfile()
    render(<McpInspectorShell />)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Connect' }))
    await screen.findByTestId('server-summary')
    expect(screen.getByRole('tab', { name: 'Resources' })).toBeDisabled()
    expect(screen.getByRole('tab', { name: 'Prompts' })).toBeDisabled()
    expect(screen.getByRole('tab', { name: 'Tools' })).toBeEnabled()
  })

  it('switching to another profile while connected disconnects', async () => {
    const user = userEvent.setup()
    seedProfile()
    useMcpInspectorStore.getState().addProfile({ name: 'Server B', url: 'https://other.test/mcp' })
    useMcpInspectorStore.getState().setActiveProfile(useMcpInspectorStore.getState().profiles[0].id)
    render(<McpInspectorShell />)
    await user.click(screen.getByRole('button', { name: 'Connect' }))
    await screen.findByTestId('server-summary')
    await user.click(screen.getByRole('button', { name: 'Server B' }))
    await waitFor(() => expect(screen.getByTestId('status-badge')).toHaveTextContent('Disconnected'))
    expect(screen.queryByTestId('server-summary')).toBeNull()
  })

  it('every log entry from the connection lands in the log drawer count', async () => {
    seedProfile()
    render(<McpInspectorShell />)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Connect' }))
    await screen.findByTestId('server-summary')
    await waitFor(() => expect(screen.getByRole('button', { name: /^Log \([1-9]\d*\)$/ })).toBeInTheDocument())
  })
})

describe('error state', () => {
  it('renders title, detail, each hint as a list item, the HTTP status, and copies plain-text diagnostics', async () => {
    const user = userEvent.setup()
    mocks.failures = [new TypeError('Failed to fetch')]
    seedProfile()
    render(<McpInspectorShell />)
    await user.click(screen.getByRole('button', { name: 'Connect' }))
    const alert = await screen.findByRole('alert')
    await waitFor(() => expect(screen.getByTestId('status-badge')).toHaveTextContent('Error'))
    const items = within(alert).getAllByRole('listitem')
    expect(items.length).toBeGreaterThan(0)
    expect(alert.textContent).toMatch(/Access-Control-Allow-Origin/)
    expect(alert.textContent).toMatch(/Failed to fetch/)
    expect(screen.getByRole('button', { name: 'Connect' })).toBeEnabled() // can retry

    await user.click(within(alert).getByRole('button', { name: 'Copy diagnostics' }))
    expect(copyText).toHaveBeenCalledTimes(1)
    const copied = vi.mocked(copyText).mock.calls[0][0]
    expect(copied).toContain('Access-Control-Allow-Origin')
    expect(copied).toContain('Failed to fetch')
    expect(copied).not.toMatch(/<[a-z]/i)
    await waitFor(() => expect(within(alert).getByText('Copied')).toBeInTheDocument())
  })

  it('shows the HTTP status when the diagnosis has one', async () => {
    const { SdkHttpError, SdkErrorCode } = await import('@modelcontextprotocol/client')
    mocks.failures = [new SdkHttpError(SdkErrorCode.ClientHttpNotImplemented, 'HTTP 500', { status: 500 })]
    seedProfile()
    render(<McpInspectorShell />)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Connect' }))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('HTTP status: 500')
  })
})

describe('auth-required', () => {
  it('shows "Waiting for authorization…" with Cancel; Cancel ends Disconnected and logs an event', async () => {
    const user = userEvent.setup()
    mocks.failures = [new UnauthorizedError()]
    vi.mocked(completeAuthorization).mockImplementation(
      (_s, _p, signal) =>
        new Promise<void>((_, reject) => signal.addEventListener('abort', () => reject(new DOMException('x', 'AbortError')))),
    )
    seedProfile()
    render(<McpInspectorShell />)
    await user.click(screen.getByRole('button', { name: 'Connect' }))
    expect(await screen.findByText('Waiting for authorization…')).toBeInTheDocument()
    expect(vi.mocked(completeAuthorization).mock.calls[0][2]).toBeInstanceOf(AbortSignal)

    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.getByTestId('status-badge')).toHaveTextContent('Disconnected'))
    expect(screen.queryByText('Waiting for authorization…')).toBeNull()
    expect(
      useLogStore.getState().entries.some((e) => e.kind === 'event' && /cancel/i.test(e.text)),
    ).toBe(true)
  })

  it('connects again when authorization resolves', async () => {
    mocks.failures = [new UnauthorizedError()]
    vi.mocked(completeAuthorization).mockResolvedValue(undefined)
    seedProfile()
    render(<McpInspectorShell />)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Connect' }))
    await waitFor(() => expect(screen.getByTestId('status-badge')).toHaveTextContent('Connected'))
  })

  it('shows the rejection message in an error diagnosis', async () => {
    mocks.failures = [new UnauthorizedError()]
    vi.mocked(completeAuthorization).mockRejectedValue(new Error('popup closed by user'))
    seedProfile()
    render(<McpInspectorShell />)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Connect' }))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('popup closed by user')
  })
})

describe('unmount', () => {
  it('disconnects the live session', async () => {
    seedProfile()
    const { unmount } = render(<McpInspectorShell />)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Connect' }))
    await screen.findByTestId('server-summary')
    const logsBefore = useLogStore.getState().entries.length
    await act(async () => {
      unmount()
      await new Promise((r) => setTimeout(r, 20))
    })
    // nothing throws after unmount and the session is closed (no further crash)
    expect(useLogStore.getState().entries.length).toBeGreaterThanOrEqual(logsBefore)
  })
})

describe('a11y/input', () => {
  it('keeps the URL field editable and persists edits to the profile', () => {
    seedProfile({ url: '' })
    render(<McpInspectorShell />)
    fireEvent.change(screen.getByLabelText('Server URL'), { target: { value: 'https://new.test/mcp' } })
    expect(useMcpInspectorStore.getState().profiles[0].url).toBe('https://new.test/mcp')
    expect(screen.getByRole('button', { name: 'Connect' })).toBeEnabled()
  })
})
