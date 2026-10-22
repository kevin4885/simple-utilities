import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ServerSummary, SessionState } from '../connection/types'
import type { McpSession } from '../connection/session'
import { TabHost } from './TabHost'
import { useUiStore } from './uiStore'
import type { SessionBaseOptions } from './useConnection'

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

const session = {} as McpSession
const options = { config: { url: 'https://x.test/mcp', transport: 'auto', headers: [], protocolVersion: null } } as SessionBaseOptions

function connected(caps: Record<string, unknown>): SessionState {
  return { status: 'connected', info: info(caps) }
}

function renderHost(state: SessionState, epoch = 1, live = state.status === 'connected') {
  const props = {
    state,
    session: live ? session : null,
    sessionOptions: live ? options : null,
    profileId: 'p1',
    epoch,
  }
  const r = render(<TabHost {...props} />)
  return {
    ...r,
    rerenderHost: (next: Partial<typeof props>) => r.rerender(<TabHost {...props} {...next} />),
  }
}

beforeEach(() => {
  useUiStore.setState({ activeTab: 'tools' })
})

describe('TabHost', () => {
  it('before connecting shows the prompt and mounts no tab component', () => {
    renderHost({ status: 'disconnected' })
    expect(screen.getByText('Connect to a server to begin.')).toBeInTheDocument()
    expect(screen.queryByText('Not implemented yet')).toBeNull()
    for (const name of ['Tools', 'Resources', 'Prompts', 'Raw', 'Conformance', 'Client']) {
      expect(screen.getByRole('tab', { name })).toBeDisabled()
    }
  })

  it('lists the six tabs in order', () => {
    renderHost(connected({ tools: {} }))
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual([
      'Tools',
      'Resources',
      'Prompts',
      'Raw',
      'Conformance',
      'Client',
    ])
  })

  it('with {tools:{}} only Resources and Prompts are disabled, with an explanatory title', () => {
    renderHost(connected({ tools: {} }))
    for (const name of ['Tools', 'Raw', 'Conformance', 'Client']) {
      const tab = screen.getByRole('tab', { name })
      expect(tab).toBeEnabled()
      expect(tab).not.toHaveAttribute('title')
    }
    for (const name of ['Resources', 'Prompts']) {
      const tab = screen.getByRole('tab', { name })
      expect(tab).toBeDisabled()
      expect(tab).toHaveAttribute('title', 'Server does not advertise this capability')
    }
  })

  it('defaults to tools when enabled, else raw; renders the active tab placeholder', () => {
    const a = renderHost(connected({ tools: {} }))
    expect(screen.getByRole('tab', { name: 'Tools' })).toHaveAttribute('data-state', 'active')
    expect(screen.getByText('Not implemented yet')).toBeInTheDocument()
    a.unmount()
    renderHost(connected({ resources: {} }))
    expect(screen.getByRole('tab', { name: 'Raw' })).toHaveAttribute('data-state', 'active')
  })

  it('switching tabs updates the ui store and shows that tab', async () => {
    renderHost(connected({ tools: {} }))
    await userEvent.setup().click(screen.getByRole('tab', { name: 'Raw' }))
    expect(useUiStore.getState().activeTab).toBe('raw')
    expect(screen.getByRole('tab', { name: 'Raw' })).toHaveAttribute('data-state', 'active')
  })

  it('remounts the active tab component when the epoch changes, not when it stays the same', () => {
    const h = renderHost(connected({ tools: {} }), 1)
    const first = screen.getByText('Not implemented yet')
    h.rerenderHost({ epoch: 1 })
    expect(screen.getByText('Not implemented yet')).toBe(first)
    h.rerenderHost({ epoch: 2 })
    expect(screen.getByText('Not implemented yet')).not.toBe(first)
  })

  it('unmounts the tab again when the session goes away', () => {
    const h = renderHost(connected({ tools: {} }))
    expect(screen.getByText('Not implemented yet')).toBeInTheDocument()
    h.rerenderHost({ state: { status: 'disconnected' }, session: null, sessionOptions: null })
    expect(screen.queryByText('Not implemented yet')).toBeNull()
    expect(screen.getByText('Connect to a server to begin.')).toBeInTheDocument()
  })

  it('uses the default tab when the stored active tab is not advertised', () => {
    useUiStore.setState({ activeTab: 'prompts' })
    renderHost(connected({ tools: {} }))
    expect(screen.getByRole('tab', { name: 'Tools' })).toHaveAttribute('data-state', 'active')
  })

})
