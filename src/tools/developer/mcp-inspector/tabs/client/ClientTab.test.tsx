import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DEFAULT_SETTINGS, MAX_SERVER_LOGS, snapshotSettings } from '../../client-features/logic'
import { useClientPending } from '../../client-features/pendingStore'
import { useClientSettings } from '../../client-features/settingsStore'
import type { McpSession } from '../../connection/session'
import type { ServerSummary } from '../../connection/types'
import ClientTab from './ClientTab'

beforeAll(() => {
  Element.prototype.scrollIntoView ??= () => {}
  Element.prototype.hasPointerCapture ??= () => false
  Element.prototype.releasePointerCapture ??= () => {}
})

type Listener = (params: unknown) => void

function makeSession() {
  const listeners = new Map<string, Set<Listener>>()
  const setLoggingLevel = vi.fn<(level: string) => Promise<object>>(async () => ({}))
  const rawNotification = vi.fn<(method: string, params?: unknown) => Promise<{ ok: true }>>(async () => ({ ok: true }))
  const session = {
    client: { setLoggingLevel },
    rawNotification,
    onNotification: (method: string, cb: Listener) => {
      if (!listeners.has(method)) listeners.set(method, new Set())
      listeners.get(method)!.add(cb)
      return () => listeners.get(method)?.delete(cb)
    },
  } as unknown as McpSession
  return {
    session,
    setLoggingLevel,
    rawNotification,
    emit: (method: string, params: unknown) => act(() => listeners.get(method)?.forEach((cb) => cb(params))),
    listenerCount: (method: string) => listeners.get(method)?.size ?? 0,
  }
}

function info(caps: Record<string, unknown>): ServerSummary {
  return {
    serverName: 's',
    serverVersion: '1',
    title: null,
    protocolVersion: '2025-06-18',
    capabilities: caps,
    instructions: null,
    transport: 'streamable-http',
    sessionId: null,
  }
}

function renderTab(caps: Record<string, unknown> = { logging: {} }) {
  const h = makeSession()
  const r = render(
    <ClientTab
      session={h.session}
      info={info(caps)}
      sessionOptions={{ config: { url: 'https://x.test/mcp', transport: 'auto', headers: [], protocolVersion: null } }}
      profileId="p1"
    />,
  )
  return { ...h, ...r }
}

beforeEach(() => {
  localStorage.clear()
  useClientSettings.setState({ ...DEFAULT_SETTINGS })
  useClientPending.getState().reset()
})

describe('ClientTab - settings', () => {
  it('shows the three feature toggles with the C9 defaults (all off)', () => {
    renderTab()
    expect(screen.getByRole('checkbox', { name: 'Roots' })).not.toBeChecked()
    expect(screen.getByLabelText('Sampling')).not.toBeChecked()
    expect(screen.getByLabelText('Elicitation')).not.toBeChecked()
    expect(screen.getByText('No roots configured.')).toBeInTheDocument()
  })

  it('toggling a feature updates the persisted settings', async () => {
    renderTab()
    await userEvent.setup().click(screen.getByLabelText('Sampling'))
    expect(useClientSettings.getState().sampling.enabled).toBe(true)
    expect(screen.getByLabelText('Sampling')).toBeChecked()
  })

  it('rejects an invalid root with an inline error and keeps the list unchanged', async () => {
    renderTab()
    const user = userEvent.setup()
    await user.type(screen.getByLabelText('Root URI'), '/not/a/uri')
    await user.click(screen.getByRole('button', { name: 'Add root' }))
    expect(screen.getByRole('alert')).toHaveTextContent(/scheme/)
    expect(useClientSettings.getState().roots.items).toEqual([])
    expect(screen.getByLabelText('Root URI')).toHaveAttribute('aria-invalid', 'true')
  })

  it('adds and removes a root', async () => {
    renderTab()
    const user = userEvent.setup()
    await user.type(screen.getByLabelText('Root URI'), 'file:///work')
    await user.type(screen.getByLabelText('Name (optional)'), 'Work')
    await user.click(screen.getByRole('button', { name: 'Add root' }))
    const list = screen.getByRole('list', { name: 'Roots' })
    expect(within(list).getByText('file:///work')).toBeInTheDocument()
    expect(within(list).getByText('(Work)')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByLabelText('Root URI')).toHaveValue('')
    await user.click(screen.getByRole('button', { name: 'Remove root file:///work' }))
    expect(useClientSettings.getState().roots.items).toEqual([])
  })

  it('renders a hostile root URI / name as text', () => {
    useClientSettings.setState({ roots: { enabled: true, items: [{ uri: 'x-a:<img src=x onerror=alert(1)>', name: null }] } })
    const { container } = renderTab()
    expect(container.querySelector('img')).toBeNull()
  })
})

describe('ClientTab - Reconnect to apply', () => {
  it('is hidden until a setting differs from what the live connection was configured with', async () => {
    useClientPending.getState().setApplied(1, snapshotSettings(DEFAULT_SETTINGS, {}))
    renderTab()
    expect(screen.queryByTestId('reconnect-notice')).toBeNull()
    await userEvent.setup().click(screen.getByLabelText('Elicitation'))
    expect(screen.getByTestId('reconnect-notice')).toHaveTextContent('Reconnect to apply')
    await userEvent.setup().click(screen.getByLabelText('Elicitation'))
    expect(screen.queryByTestId('reconnect-notice')).toBeNull()
  })

  it('also appears when the roots list is edited while connected', async () => {
    useClientSettings.setState({ roots: { enabled: true, items: [] } })
    useClientPending.getState().setApplied(1, snapshotSettings(useClientSettings.getState(), { roots: {} }))
    renderTab()
    const user = userEvent.setup()
    await user.type(screen.getByLabelText('Root URI'), 'file:///new')
    await user.click(screen.getByRole('button', { name: 'Add root' }))
    expect(screen.getByTestId('reconnect-notice')).toBeInTheDocument()
  })
})

describe('ClientTab - roots/list_changed', () => {
  async function addRoot(user: ReturnType<typeof userEvent.setup>, uri: string) {
    await user.type(screen.getByLabelText('Root URI'), uri)
    await user.click(screen.getByRole('button', { name: 'Add root' }))
  }

  it('sends notifications/roots/list_changed when roots.listChanged was declared', async () => {
    useClientSettings.setState({ roots: { enabled: true, items: [] } })
    useClientPending.getState().setApplied(1, snapshotSettings(useClientSettings.getState(), { roots: { listChanged: true } }))
    const { rawNotification } = renderTab()
    expect(rawNotification).not.toHaveBeenCalled()
    await addRoot(userEvent.setup(), 'file:///a')
    expect(rawNotification).toHaveBeenCalledTimes(1)
    expect(rawNotification).toHaveBeenCalledWith('notifications/roots/list_changed')
  })

  it('sends nothing when listChanged was not declared', async () => {
    useClientSettings.setState({ roots: { enabled: true, items: [] } })
    useClientPending.getState().setApplied(1, snapshotSettings(useClientSettings.getState(), { roots: {} }))
    const { rawNotification } = renderTab()
    await addRoot(userEvent.setup(), 'file:///a')
    expect(rawNotification).not.toHaveBeenCalled()
  })

  it('sends nothing for an edit that was rejected', async () => {
    useClientPending.getState().setApplied(1, snapshotSettings(DEFAULT_SETTINGS, { roots: { listChanged: true } }))
    const { rawNotification } = renderTab()
    await addRoot(userEvent.setup(), 'bad uri')
    expect(rawNotification).not.toHaveBeenCalled()
  })
})

describe('ClientTab - pending and recent requests', () => {
  it('lists pending requests and the last answered ones as text with outcome and time', async () => {
    const reject = vi.fn()
    act(() => {
      useClientPending.setState({
        pending: [{ id: 1, ctxId: 1, kind: 'sampling', params: {}, receivedAt: Date.now(), resolve: vi.fn(), reject }],
      })
    })
    renderTab()
    expect(within(screen.getByRole('list', { name: 'Pending requests' })).getAllByTestId('pending-item')).toHaveLength(1)
    expect(screen.getByText('Nothing answered yet.')).toBeInTheDocument()

    act(() => {
      useClientPending.getState().answer(1, { action: 'accept' }, 'Accepted')
    })
    expect(screen.getByText('No requests are waiting.')).toBeInTheDocument()
    const item = within(screen.getByRole('list', { name: 'Recent requests' })).getByTestId('recent-item')
    expect(item).toHaveTextContent('sampling')
    expect(item).toHaveTextContent('Accepted')
  })

  it('keeps only the 20 most recent answered requests, newest first, and renders summaries as text', () => {
    act(() => {
      for (let i = 1; i <= 25; i++) {
        useClientPending.setState((s) => ({
          pending: [
            ...s.pending,
            {
              id: 1000 + i,
              ctxId: 1,
              kind: 'elicitation',
              params: { message: i === 25 ? '<img src=x onerror=alert(1)>' : `m${i}` },
              receivedAt: 0,
              resolve: vi.fn(),
              reject: vi.fn(),
            },
          ],
        }))
        useClientPending.getState().answer(1000 + i, {}, 'Declined')
      }
    })
    const { container } = renderTab()
    const items = screen.getAllByTestId('recent-item')
    expect(items).toHaveLength(20)
    expect(items[0]).toHaveTextContent('<img src=x onerror=alert(1)>')
    expect(items[19]).toHaveTextContent('m6')
    expect(container.querySelector('img')).toBeNull()
  })
})

describe('ClientTab - logging', () => {
  it('has a select with the level; disabled with a reason when the server has no logging capability', () => {
    const { setLoggingLevel } = renderTab({ tools: {} })
    expect(screen.getByRole('combobox', { name: /log level/i })).toBeDisabled()
    expect(screen.getByTestId('logging-disabled-reason')).toHaveTextContent(/does not advertise the logging capability/)
    expect(setLoggingLevel).not.toHaveBeenCalled()
  })

  it('offers all 8 levels and calls client.setLoggingLevel when one is picked', async () => {
    const { setLoggingLevel } = renderTab({ logging: {} })
    await waitForInitialSend(setLoggingLevel)
    setLoggingLevel.mockClear()
    const user = userEvent.setup()
    await user.click(screen.getByRole('combobox', { name: /log level/i }))
    const options = await screen.findAllByRole('option')
    expect(options.map((o) => o.textContent)).toEqual(['debug', 'info', 'notice', 'warning', 'error', 'critical', 'alert', 'emergency'])
    await user.click(screen.getByRole('option', { name: 'error' }))
    expect(setLoggingLevel).toHaveBeenCalledWith('error')
    expect(useClientSettings.getState().loggingLevel).toBe('error')
  })

  it('sends the saved level once to a freshly connected server', async () => {
    useClientSettings.setState({ loggingLevel: 'warning' })
    const { setLoggingLevel } = renderTab({ logging: {} })
    await waitForInitialSend(setLoggingLevel)
    expect(setLoggingLevel).toHaveBeenCalledTimes(1)
    expect(setLoggingLevel).toHaveBeenCalledWith('warning')
  })

  it('shows an error when the server rejects the level', async () => {
    const h = makeSession()
    h.setLoggingLevel.mockRejectedValue(new Error('nope'))
    render(
      <ClientTab
        session={h.session}
        info={info({ logging: {} })}
        sessionOptions={{ config: { url: 'https://x.test/mcp', transport: 'auto', headers: [], protocolVersion: null } }}
        profileId="p1"
      />,
    )
    expect(await screen.findByRole('alert')).toHaveTextContent(/The server rejected the log level: nope/)
  })

  it('lists inbound notifications/message with level word, logger and data as text', () => {
    const h = renderTab()
    h.emit('notifications/message', { level: 'error', logger: 'db', data: { msg: '<img src=x onerror=alert(1)>', code: 5 } })
    h.emit('notifications/message', { level: 'info', data: 'plain' })
    const rows = screen.getAllByTestId('server-log')
    expect(rows).toHaveLength(2)
    expect(within(rows[0]).getByTestId('server-log-level')).toHaveTextContent('error')
    expect(rows[0]).toHaveTextContent('db')
    expect(rows[0]).toHaveTextContent('<img src=x onerror=alert(1)>')
    expect(within(rows[1]).getByTestId('server-log-level')).toHaveTextContent('info')
    expect(rows[1]).toHaveTextContent('plain')
    expect(document.querySelector('img')).toBeNull()
  })

  it('uses semantic tokens for severity and always shows the level word', () => {
    const h = renderTab()
    h.emit('notifications/message', { level: 'emergency', data: 'x' })
    h.emit('notifications/message', { level: 'debug', data: 'y' })
    const levels = screen.getAllByTestId('server-log-level')
    expect(levels[0]).toHaveClass('text-destructive')
    expect(levels[1]).toHaveClass('text-muted-foreground')
    expect(levels[0]).toHaveTextContent('emergency')
  })

  it('caps the list at 500 entries (oldest dropped) and Clear empties it', async () => {
    const h = renderTab()
    act(() => {
      for (let i = 0; i < MAX_SERVER_LOGS + 25; i++) {
        useClientPending.getState().addServerLog({ ts: i, level: 'info', logger: null, data: `n${i}` })
      }
    })
    expect(screen.getAllByTestId('server-log')).toHaveLength(MAX_SERVER_LOGS)
    expect(screen.queryByText('n0')).toBeNull()
    expect(screen.getByText(`n${MAX_SERVER_LOGS + 24}`)).toBeInTheDocument()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Clear' }))
    expect(screen.queryAllByTestId('server-log')).toHaveLength(0)
    h.emit('notifications/message', { level: 'info', data: 'after' })
    expect(screen.getAllByTestId('server-log')).toHaveLength(1)
  })

  it('stops observing on unmount and starts a fresh list for a new session', () => {
    const first = renderTab()
    first.emit('notifications/message', { level: 'info', data: 'one' })
    expect(first.listenerCount('notifications/message')).toBe(1)
    first.unmount()
    expect(first.listenerCount('notifications/message')).toBe(0)

    const second = renderTab()
    expect(screen.queryAllByTestId('server-log')).toHaveLength(0)
    second.emit('notifications/message', { level: 'info', data: 'two' })
    expect(screen.getAllByTestId('server-log')).toHaveLength(1)
  })

  it('survives a malformed log notification', () => {
    const h = renderTab()
    h.emit('notifications/message', null)
    expect(screen.getByTestId('server-log-level')).toHaveTextContent('unknown')
  })
})

async function waitForInitialSend(fn: ReturnType<typeof vi.fn>) {
  await vi.waitFor(() => expect(fn).toHaveBeenCalled())
}
