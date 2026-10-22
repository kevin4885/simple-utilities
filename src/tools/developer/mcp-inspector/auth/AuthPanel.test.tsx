import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import type { Profile } from '../schemas'
import { getSecret, setSecret } from '../secrets'
import AuthPanel from './AuthPanel'

const TOKEN = 'ACCESS-TOKEN-SHOULD-NEVER-RENDER'
const REFRESH = 'REFRESH-TOKEN-SHOULD-NEVER-RENDER'

function profile(auth: Partial<Profile['auth']> = {}): Profile {
  return {
    id: 'p1',
    name: 'P',
    url: 'https://mcp.test/mcp',
    transport: 'auto',
    protocolVersion: null,
    headers: [],
    persistSecrets: false,
    auth: { mode: 'oauth', scope: null, clientId: null, ...auth },
    createdAt: 1,
    updatedAt: 1,
  }
}

function storeTokens(extra: Record<string, unknown> = {}) {
  setSecret(
    'oauth:p1:tokens',
    JSON.stringify({ access_token: TOKEN, refresh_token: REFRESH, token_type: 'Bearer', expires_in: 3600, obtained_at: Date.now(), ...extra }),
    { persist: false },
  )
}

/** Holds the profile in state so onChange round-trips like it does in the sidebar. */
function Harness({ initial, disabled, onChange }: { initial: Profile; disabled?: boolean; onChange?: (patch: unknown) => void }) {
  const [p, setP] = useState(initial)
  return (
    <AuthPanel
      profile={p}
      disabled={disabled}
      onChange={(patch) => {
        onChange?.(patch)
        setP((cur) => ({ ...cur, ...patch }))
      }}
    />
  )
}

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  // jsdom lacks the DOM APIs Radix Select touches when its listbox opens.
  Element.prototype.scrollIntoView ??= () => {}
  Element.prototype.hasPointerCapture ??= () => false
  Element.prototype.releasePointerCapture ??= () => {}
})

describe('AuthPanel', () => {
  it('shows only the mode select when auth is None', () => {
    render(<Harness initial={profile({ mode: 'none' })} />)
    expect(screen.getByRole('combobox', { name: 'Authentication mode' })).toHaveTextContent('None')
    expect(screen.queryByLabelText('Scope')).toBeNull()
    expect(screen.queryByLabelText('Pre-registered client ID')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Clear credentials' })).toBeNull()
  })

  it('the mode select offers None and OAuth, and choosing OAuth reports the patch and reveals the fields', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Harness initial={profile({ mode: 'none', scope: 'keep', clientId: 'keep-id' })} onChange={onChange} />)
    await user.click(screen.getByRole('combobox', { name: 'Authentication mode' }))
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['None', 'OAuth'])
    await user.click(screen.getByRole('option', { name: 'OAuth' }))
    expect(onChange).toHaveBeenLastCalledWith({ auth: { mode: 'oauth', scope: 'keep', clientId: 'keep-id' } })
    expect(screen.getByLabelText('Scope')).toHaveValue('keep')
  })

  it('edits scope and the pre-registered client ID; empty text becomes null; help text is shown', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Harness initial={profile()} onChange={onChange} />)
    await user.type(screen.getByLabelText('Scope'), 'mcp:tools')
    expect(onChange).toHaveBeenLastCalledWith({ auth: { mode: 'oauth', scope: 'mcp:tools', clientId: null } })
    await user.clear(screen.getByLabelText('Scope'))
    expect(onChange).toHaveBeenLastCalledWith({ auth: { mode: 'oauth', scope: null, clientId: null } })

    const client = screen.getByLabelText('Pre-registered client ID')
    await user.type(client, ' abc ')
    expect(onChange).toHaveBeenLastCalledWith({ auth: { mode: 'oauth', scope: null, clientId: 'abc' } })
    expect(client).toHaveAccessibleDescription(/register this app.*automatically.*redirect URI/i)
    expect(screen.getByText(`${window.location.origin}/oauth/callback`)).toBeInTheDocument()
  })

  it('shows "Not authorized" without tokens', () => {
    render(<Harness initial={profile()} />)
    expect(screen.getByText('Not authorized')).toBeInTheDocument()
    expect(screen.queryByText(/Signed in/)).toBeNull()
  })

  it('shows "Signed in" with the token expiry time when tokens exist, and never a token value', () => {
    storeTokens()
    const { container } = render(<Harness initial={profile()} />)
    expect(screen.getByText('Signed in')).toBeInTheDocument()
    expect(container.textContent).toMatch(/access token expiry/)
    expect(container.textContent).not.toContain(TOKEN)
    expect(container.textContent).not.toContain(REFRESH)
    for (const el of container.querySelectorAll('input')) {
      expect((el as HTMLInputElement).value).not.toContain(TOKEN)
    }
  })

  it('shows the exact expiry time (obtained_at + expires_in) and omits it when unknown', () => {
    storeTokens({ expires_in: 60, obtained_at: 1_700_000_000_000 })
    const { container, unmount } = render(<Harness initial={profile()} />)
    expect(container.textContent).toContain(new Date(1_700_000_060_000).toLocaleString())
    unmount()
    sessionStorage.clear()
    storeTokens({ expires_in: undefined })
    const second = render(<Harness initial={profile()} />)
    expect(screen.getByText('Signed in')).toBeInTheDocument()
    expect(second.container.textContent).not.toMatch(/expiry/)
  })

  it('Clear credentials deletes this profile\'s OAuth keys, shows "Credentials cleared" and flips the status', async () => {
    const user = userEvent.setup()
    storeTokens()
    setSecret('oauth:p1:client', '{"client_id":"c"}', { persist: false })
    setSecret('oauth:p1:verifier', 'v', { persist: false })
    setSecret('oauth:p2:tokens', '{"access_token":"other-profile"}', { persist: false })
    render(<Harness initial={profile()} />)
    expect(screen.getByText('Signed in')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Clear credentials' }))
    expect(screen.getByText('Credentials cleared')).toBeInTheDocument()
    expect(screen.getByText('Not authorized')).toBeInTheDocument()
    for (const k of ['tokens', 'client', 'verifier', 'state']) expect(getSecret(`oauth:p1:${k}`)).toBeNull()
    expect(getSecret('oauth:p2:tokens')).not.toBeNull()
  })

  it('also clears credentials that were persisted', async () => {
    const user = userEvent.setup()
    setSecret('oauth:p1:tokens', JSON.stringify({ access_token: TOKEN }), { persist: true })
    render(<Harness initial={profile()} />)
    await user.click(screen.getByRole('button', { name: 'Clear credentials' }))
    expect(localStorage.getItem('su:mcp-inspector-secrets') ?? '').not.toContain(TOKEN)
  })

  it('follows credential changes made while it is mounted (sign-in finishing elsewhere)', () => {
    render(<Harness initial={profile()} />)
    expect(screen.getByText('Not authorized')).toBeInTheDocument()
    storeTokens()
    act(() => {
      window.dispatchEvent(new Event('mcp-inspector:oauth-credentials'))
    })
    expect(screen.getByText('Signed in')).toBeInTheDocument()
  })

  it('disables every control when disabled', () => {
    storeTokens()
    const { container } = render(<Harness initial={profile()} disabled />)
    expect(screen.getByRole('combobox', { name: 'Authentication mode' })).toBeDisabled()
    expect(screen.getByLabelText('Scope')).toBeDisabled()
    expect(screen.getByLabelText('Pre-registered client ID')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Clear credentials' })).toBeDisabled()
    const enabled = [...container.querySelectorAll('input, button, select, textarea')].filter((el) => !(el as HTMLButtonElement).disabled)
    expect(enabled).toEqual([])
  })

  it('shows the status of the profile it is given (switching profiles)', () => {
    storeTokens()
    const { rerender } = render(<AuthPanel profile={profile()} onChange={() => undefined} />)
    expect(screen.getByText('Signed in')).toBeInTheDocument()
    rerender(<AuthPanel profile={{ ...profile(), id: 'p2' }} onChange={() => undefined} />)
    expect(within(document.body).getByText('Not authorized')).toBeInTheDocument()
  })
})
