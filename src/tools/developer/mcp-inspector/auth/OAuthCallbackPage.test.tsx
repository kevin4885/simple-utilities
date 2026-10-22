import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { getSecret, setSecret } from '../secrets'
import { OAUTH_CHANNEL, type OAuthCallbackMessage } from './callback'
import OAuthCallbackPage from './OAuthCallbackPage'

class FakeChannel {
  static instances: FakeChannel[] = []
  static posted: { name: string; data: unknown }[] = []
  closed = false
  constructor(readonly name: string) {
    FakeChannel.instances.push(this)
  }
  postMessage(data: unknown): void {
    FakeChannel.posted.push({ name: this.name, data })
  }
  close(): void {
    this.closed = true
  }
}

function Where() {
  const loc = useLocation()
  return <p data-testid="where">{loc.pathname}</p>
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/oauth/callback']}>
      <Routes>
        <Route path="/oauth/callback" element={<OAuthCallbackPage />} />
        <Route path="/tools/mcp-inspector" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  )
}

/** The page reads window.location.search (the real URL), so drive that. */
function visit(search: string) {
  window.history.replaceState(null, '', `/oauth/callback${search}`)
}

let closeSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  FakeChannel.instances = []
  FakeChannel.posted = []
  vi.stubGlobal('BroadcastChannel', FakeChannel)
  closeSpy = vi.spyOn(window, 'close').mockImplementation(() => undefined)
})

afterEach(() => {
  vi.unstubAllGlobals()
  closeSpy.mockRestore()
  document.head.querySelectorAll('meta[name="robots"]').forEach((m) => m.remove())
  window.history.replaceState(null, '', '/')
})

describe('OAuthCallbackPage (popup flow)', () => {
  it('posts exactly one OAuthCallbackMessage on the shared channel, shows the completion text and tries to close', async () => {
    visit('?code=CODE-1&state=STATE-1')
    renderPage()
    expect(await screen.findByText('Authorization complete - you can close this window')).toBeInTheDocument()
    expect(FakeChannel.posted).toHaveLength(1)
    expect(FakeChannel.posted[0].name).toBe(OAUTH_CHANNEL)
    const expected: OAuthCallbackMessage = {
      type: 'mcp-oauth-callback',
      state: 'STATE-1',
      code: 'CODE-1',
      iss: null,
      error: null,
      errorDescription: null,
    }
    expect(FakeChannel.posted[0].data).toEqual(expected)
    expect(FakeChannel.instances.every((c) => c.closed)).toBe(true)
    expect(closeSpy).toHaveBeenCalled()
  })

  it('includes the RFC 9207 iss in the one posted message', async () => {
    visit('?code=CODE-1&state=STATE-1&iss=https%3A%2F%2Fas.test')
    renderPage()
    await screen.findByText(/Authorization complete/)
    expect(FakeChannel.posted).toHaveLength(1)
    expect(FakeChannel.posted[0].data).toMatchObject({ code: 'CODE-1', state: 'STATE-1', iss: 'https://as.test' })
  })

  it('never renders the authorization code or state', async () => {
    visit('?code=CODE-SECRET&state=STATE-SECRET')
    const { container } = renderPage()
    await screen.findByText(/Authorization complete/)
    expect(container.textContent).not.toContain('CODE-SECRET')
    expect(container.textContent).not.toContain('STATE-SECRET')
  })

  it('removes the response from the address bar', async () => {
    visit('?code=CODE-1&state=STATE-1')
    renderPage()
    await screen.findByText(/Authorization complete/)
    expect(window.location.search).toBe('')
  })

  it('forwards a provider error and shows it instead of success', async () => {
    visit('?error=access_denied&error_description=User%20said%20no&state=S')
    renderPage()
    expect(await screen.findByText(/Authorization was not completed/)).toBeInTheDocument()
    expect(screen.getByText('access_denied: User said no')).toBeInTheDocument()
    expect(screen.queryByText(/Authorization complete/)).toBeNull()
    expect(FakeChannel.posted).toHaveLength(1)
    expect(FakeChannel.posted[0].data).toMatchObject({ error: 'access_denied', errorDescription: 'User said no', code: null })
  })

  it('a callback URL with neither code nor error is not reported as success', async () => {
    visit('')
    renderPage()
    expect(await screen.findByText(/Authorization was not completed/)).toBeInTheDocument()
    expect(screen.getByText('No authorization code was returned.')).toBeInTheDocument()
  })

  it('sets <meta name="robots" content="noindex"> and removes it when it unmounts', async () => {
    visit('?code=c&state=s')
    const { unmount } = renderPage()
    const meta = document.head.querySelector('meta[name="robots"]')
    expect(meta).toHaveAttribute('content', 'noindex')
    unmount()
    expect(document.head.querySelector('meta[name="robots"]')).toBeNull()
  })

  it('renders only text: a hostile error description cannot inject markup', async () => {
    visit('?error=x&error_description=%3Cimg%20src%3Dx%20onerror%3Dalert(1)%3E')
    const { container } = renderPage()
    await screen.findByText(/Authorization was not completed/)
    expect(container.querySelector('img')).toBeNull()
    expect(container.textContent).toContain('<img src=x onerror=alert(1)>')
  })
})

describe('OAuthCallbackPage (full-page fallback)', () => {
  it('writes the response into the pending-return marker and navigates back to the tool, posting nothing', async () => {
    setSecret('oauth:pending-return', JSON.stringify({ profileId: 'p1' }), { persist: false })
    visit('?code=CODE-1&state=STATE-1')
    renderPage()
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/tools/mcp-inspector'))
    expect(JSON.parse(getSecret('oauth:pending-return')!)).toEqual({
      profileId: 'p1',
      code: 'CODE-1',
      state: 'STATE-1',
      iss: null,
      error: null,
      errorDescription: null,
    })
    expect(FakeChannel.posted).toHaveLength(0)
    expect(closeSpy).not.toHaveBeenCalled()
    expect(window.location.search).toBe('')
  })

  it('keeps the RFC 9207 iss in the marker', async () => {
    setSecret('oauth:pending-return', JSON.stringify({ profileId: 'p1' }), { persist: false })
    visit('?code=CODE-1&state=STATE-1&iss=https%3A%2F%2Fas.test')
    renderPage()
    await waitFor(() => expect(screen.getByTestId('where')).toBeInTheDocument())
    expect(JSON.parse(getSecret('oauth:pending-return')!)).toMatchObject({ profileId: 'p1', code: 'CODE-1', state: 'STATE-1', iss: 'https://as.test' })
  })

  it('keeps a provider error in the marker so the tool can report it', async () => {
    setSecret('oauth:pending-return', JSON.stringify({ profileId: 'p1' }), { persist: false })
    visit('?error=access_denied&state=STATE-1')
    renderPage()
    await waitFor(() => expect(screen.getByTestId('where')).toBeInTheDocument())
    expect(JSON.parse(getSecret('oauth:pending-return')!)).toMatchObject({ profileId: 'p1', error: 'access_denied', code: null })
  })

  it('stays in the popup flow when the marker is garbage', async () => {
    setSecret('oauth:pending-return', 'not json', { persist: false })
    visit('?code=c&state=s')
    renderPage()
    expect(await screen.findByText(/Authorization complete/)).toBeInTheDocument()
    expect(FakeChannel.posted).toHaveLength(1)
  })

  it('tells the user when the marker cannot be written instead of navigating', async () => {
    setSecret('oauth:pending-return', JSON.stringify({ profileId: 'p1' }), { persist: false })
    visit('?code=c&state=s')
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota')
    })
    try {
      renderPage()
      expect(await screen.findByText(/storage is unavailable/i)).toBeInTheDocument()
    } finally {
      spy.mockRestore()
    }
    expect(screen.queryByTestId('where')).toBeNull()
  })
})
