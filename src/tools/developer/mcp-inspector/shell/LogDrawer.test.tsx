import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { LogEntryInput } from '../connection/types'

vi.mock('./viewerIo', async (orig) => ({ ...(await orig<typeof import('./viewerIo')>()), copyText: vi.fn().mockResolvedValue(true) }))

import { copyText } from './viewerIo'
import { LogDrawer } from './LogDrawer'
import { useLogStore } from './logStore'
import { useUiStore } from './uiStore'

const rpcOut = (method: string, rpcId: number | null, params?: unknown): LogEntryInput => ({
  ts: 1,
  kind: 'rpc',
  direction: 'out',
  message: { jsonrpc: '2.0', ...(rpcId !== null ? { id: rpcId } : {}), method, ...(params !== undefined ? { params } : {}) },
  method,
  rpcId,
  durationMs: null,
})
const rpcIn = (rpcId: number, body: Record<string, unknown>, durationMs: number): LogEntryInput => ({
  ts: 2,
  kind: 'rpc',
  direction: 'in',
  message: { jsonrpc: '2.0', id: rpcId, ...body },
  method: null,
  rpcId,
  durationMs,
})
const http = (status: number | null, extra: Partial<Extract<LogEntryInput, { kind: 'http' }>> = {}): LogEntryInput => ({
  ts: 3,
  kind: 'http',
  method: 'POST',
  url: 'https://x.test/mcp',
  status,
  requestHeaders: { Authorization: '[redacted]' },
  responseHeaders: { 'content-type': 'application/json' },
  durationMs: 7,
  error: null,
  ...extra,
})
const event = (text: string, level: 'info' | 'warn' | 'error' = 'info'): LogEntryInput => ({ ts: 4, kind: 'event', level, text })

function seed(...entries: LogEntryInput[]) {
  for (const e of entries) useLogStore.getState().append(e)
}
function rows() {
  return document.querySelectorAll('[data-slot="log-row"]')
}

beforeEach(() => {
  useLogStore.getState().clear()
  useLogStore.setState({ nextId: 1 })
  useUiStore.setState({ activeTab: 'tools', rawDraft: null, draftNonce: 0 })
  vi.mocked(copyText).mockClear()
})

describe('LogDrawer rendering', () => {
  it('renders collapsed (no rows) when open=false', () => {
    seed(rpcOut('ping', 1))
    render(<LogDrawer open={false} onOpenChange={() => {}} />)
    expect(rows()).toHaveLength(0)
    expect(screen.getByRole('button', { name: 'Log (1)' })).toBeInTheDocument()
  })

  it('toggle button reports the next open state', async () => {
    const onOpenChange = vi.fn()
    render(<LogDrawer open={false} onOpenChange={onOpenChange} />)
    await userEvent.click(screen.getByRole('button', { name: 'Log (0)' }))
    expect(onOpenChange).toHaveBeenCalledWith(true)
  })

  it('shows an empty-state message for an empty log', () => {
    render(<LogDrawer open onOpenChange={() => {}} />)
    expect(screen.getByText(/No log entries yet/)).toBeInTheDocument()
  })

  it('renders rows in id order with direction, method / HTTP label and duration', () => {
    seed(rpcOut('tools/list', 1), rpcIn(1, { result: {} }, 12), http(200), event('hello'))
    render(<LogDrawer open onOpenChange={() => {}} />)
    const r = rows()
    expect(r).toHaveLength(4)
    expect(within(r[0] as HTMLElement).getByText('->')).toBeInTheDocument()
    expect(within(r[0] as HTMLElement).getByText('tools/list')).toBeInTheDocument()
    expect(within(r[1] as HTMLElement).getByText('<-')).toBeInTheDocument()
    expect(within(r[1] as HTMLElement).getByText('12 ms')).toBeInTheDocument()
    expect(within(r[2] as HTMLElement).getByText('HTTP POST 200')).toBeInTheDocument()
    expect(within(r[2] as HTMLElement).getByText('7 ms')).toBeInTheDocument()
    expect(within(r[3] as HTMLElement).getByText('hello')).toBeInTheDocument()
  })

  it('styles rpc error responses and failing http entries with text-destructive, not healthy ones', () => {
    seed(
      rpcIn(1, { error: { code: -32601, message: 'nope' } }, 3),
      rpcIn(2, { result: {} }, 3),
      http(500),
      http(200),
      http(null, { error: 'Failed to fetch' }),
    )
    render(<LogDrawer open onOpenChange={() => {}} />)
    const buttons = Array.from(rows()).map((r) => r.querySelector('button')!)
    expect(buttons.map((b) => b.className.includes('text-destructive'))).toEqual([true, false, true, false, true])
  })
})

describe('LogDrawer filters', () => {
  it('filters case-insensitively across method, url and text', async () => {
    seed(rpcOut('tools/list', 1), http(200), event('Server Said HELLO'))
    render(<LogDrawer open onOpenChange={() => {}} />)
    const input = screen.getByLabelText('Filter log')
    await userEvent.type(input, 'TOOLS')
    expect(rows()).toHaveLength(1)
    await userEvent.clear(input)
    await userEvent.type(input, 'x.test')
    expect(rows()).toHaveLength(1)
    expect(screen.getByText('HTTP POST 200')).toBeInTheDocument()
    await userEvent.clear(input)
    await userEvent.type(input, 'said hello')
    expect(rows()).toHaveLength(1)
    await userEvent.clear(input)
    await userEvent.type(input, 'zzz')
    expect(rows()).toHaveLength(0)
    expect(screen.getByText(/No entries match/)).toBeInTheDocument()
  })

  it('kind toggles hide and re-show rows', async () => {
    seed(rpcOut('ping', 1), http(200), event('e'))
    render(<LogDrawer open onOpenChange={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: 'Show rpc' }))
    expect(rows()).toHaveLength(2)
    await userEvent.click(screen.getByRole('button', { name: 'Show http' }))
    await userEvent.click(screen.getByRole('button', { name: 'Show event' }))
    expect(rows()).toHaveLength(0)
    await userEvent.click(screen.getByRole('button', { name: 'Show http' }))
    expect(rows()).toHaveLength(1)
  })

  it('Clear empties the store', async () => {
    seed(rpcOut('ping', 1), event('e'))
    render(<LogDrawer open onOpenChange={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: 'Clear' }))
    expect(useLogStore.getState().entries).toEqual([])
    expect(screen.getByText(/No log entries yet/)).toBeInTheDocument()
  })
})

describe('LogDrawer expansion and copy', () => {
  it('expands a row to show the full message via JsonView, and collapses again', async () => {
    seed(rpcOut('tools/call', 1, { name: 'echo' }))
    render(<LogDrawer open onOpenChange={() => {}} />)
    expect(document.querySelector('pre')).toBeNull()
    await userEvent.click(screen.getByText('tools/call'))
    const pre = document.querySelector('pre')!
    expect(pre.textContent).toBe(
      JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'echo' } }, null, 2),
    )
    await userEvent.click(screen.getByText('tools/call'))
    expect(document.querySelector('pre')).toBeNull()
  })

  it('expands an http row to show request and response headers', async () => {
    seed(http(200))
    render(<LogDrawer open onOpenChange={() => {}} />)
    await userEvent.click(screen.getByText('HTTP POST 200'))
    const text = document.querySelector('pre')!.textContent!
    expect(text).toContain('"requestHeaders"')
    expect(text).toContain('[redacted]')
    expect(text).toContain('"responseHeaders"')
  })

  it('Copy all copies JSON text of the entries once', async () => {
    seed(rpcOut('ping', 1), http(200))
    render(<LogDrawer open onOpenChange={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: 'Copy all' }))
    expect(copyText).toHaveBeenCalledTimes(1)
    const text = vi.mocked(copyText).mock.calls[0][0]
    expect(JSON.parse(text)).toEqual(useLogStore.getState().entries)
  })
})

describe('LogDrawer Edit & resend', () => {
  it('appears only on rpc/out requests (method + non-null rpcId)', () => {
    seed(
      rpcOut('tools/list', 1), // request -> yes
      rpcOut('notifications/initialized', null), // notification -> no
      rpcIn(1, { result: {} }, 5), // response -> no
      http(200), // http -> no
      event('e'), // event -> no
    )
    render(<LogDrawer open onOpenChange={() => {}} />)
    const r = Array.from(rows())
    expect(r.map((x) => within(x as HTMLElement).queryByRole('button', { name: /Edit & resend/ }) !== null)).toEqual([
      true,
      false,
      false,
      false,
      false,
    ])
  })

  it('sets a raw draft with pretty params and switches to the raw tab', async () => {
    seed(rpcOut('tools/call', 4, { name: 'echo', arguments: { a: 1 } }))
    render(<LogDrawer open onOpenChange={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: /Edit & resend/ }))
    const ui = useUiStore.getState()
    expect(ui.rawDraft).toMatchObject({
      method: 'tools/call',
      paramsText: JSON.stringify({ name: 'echo', arguments: { a: 1 } }, null, 2),
    })
    expect(ui.activeTab).toBe('raw')
  })

  it('uses an empty paramsText when params are absent', async () => {
    seed(rpcOut('ping', 2))
    render(<LogDrawer open onOpenChange={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: /Edit & resend/ }))
    expect(useUiStore.getState().rawDraft).toMatchObject({ method: 'ping', paramsText: '' })
    expect(useUiStore.getState().activeTab).toBe('raw')
  })
})
