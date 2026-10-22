import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { McpSession } from './connection/session'
import type { ServerSummary } from './connection/types'
import type { Profile } from './schemas'
import AuthPanel from './auth/AuthPanel'
import { buildAuthProvider } from './auth/provider'
import { completeAuthorization, consumePendingOAuthReturn } from './auth/flow'
import ClientFeatureHost from './client-features/Host'
import { clientFeatureSetup } from './client-features/register'
import ClientTab from './tabs/client/ClientTab'
import ConformanceTab from './tabs/conformance/ConformanceTab'
import PromptsTab from './tabs/prompts/PromptsTab'
import RawTab from './tabs/raw/RawTab'
import ResourcesTab from './tabs/resources/ResourcesTab'
import ToolsTab from './tabs/tools/ToolsTab'

// These slots are placeholders until their owning phase replaces them; the shell depends on their signatures only.

const info: ServerSummary = {
  serverName: 's',
  serverVersion: '1',
  title: null,
  protocolVersion: '2025-06-18',
  capabilities: {},
  instructions: null,
  transport: 'streamable-http',
  sessionId: null,
}
const tabProps = {
  session: {} as McpSession,
  info,
  sessionOptions: { config: { url: 'https://x.test', transport: 'auto' as const, headers: [], protocolVersion: null } },
  profileId: 'p',
}
const profile: Profile = {
  id: 'p',
  name: 'P',
  url: '',
  transport: 'auto',
  protocolVersion: null,
  headers: [],
  persistSecrets: false,
  auth: { mode: 'none', scope: null, clientId: null },
  createdAt: 1,
  updatedAt: 1,
}

describe('tab placeholders', () => {
  it.each([
    ['ToolsTab', ToolsTab],
    ['ResourcesTab', ResourcesTab],
    ['PromptsTab', PromptsTab],
    ['RawTab', RawTab],
    ['ConformanceTab', ConformanceTab],
    ['ClientTab', ClientTab],
  ])('%s renders "Not implemented yet"', (_name, Tab) => {
    render(<Tab {...tabProps} />)
    expect(screen.getByText('Not implemented yet')).toBeInTheDocument()
  })
})

describe('auth and client-feature placeholders', () => {
  it('AuthPanel renders "Not implemented yet"', () => {
    render(<AuthPanel profile={profile} onChange={() => undefined} />)
    expect(screen.getByText('Not implemented yet')).toBeInTheDocument()
  })

  it('buildAuthProvider returns undefined', () => {
    expect(buildAuthProvider(profile, 'https://app.test')).toBeUndefined()
  })

  it('flow placeholders: no pending return; completeAuthorization rejects', async () => {
    expect(consumePendingOAuthReturn()).toBeNull()
    await expect(completeAuthorization({} as McpSession, 'p', new AbortController().signal)).rejects.toThrow(/not implemented/i)
  })

  it('clientFeatureSetup is a no-op declaring no capabilities', () => {
    expect(clientFeatureSetup.capabilities).toEqual({})
    expect(() => clientFeatureSetup.dispose()).not.toThrow()
  })

  it('ClientFeatureHost renders nothing', () => {
    const { container } = render(<ClientFeatureHost />)
    expect(container).toBeEmptyDOMElement()
  })
})