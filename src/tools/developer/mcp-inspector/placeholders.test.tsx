import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { McpSession } from './connection/session'
import type { Profile } from './schemas'
import AuthPanel from './auth/AuthPanel'
import { buildAuthProvider } from './auth/provider'
import { completeAuthorization, consumePendingOAuthReturn } from './auth/flow'

// The auth slots below are placeholders until their owning phase replaces them; the shell depends on their signatures only.

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

describe('auth placeholders', () => {
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
})
