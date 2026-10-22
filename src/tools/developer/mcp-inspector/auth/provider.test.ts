import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Profile } from '../schemas'
import { PERSISTED_SECRETS_KEY, SESSION_SECRETS_KEY, getSecret, setSecret } from '../secrets'
import { OAUTH_CREDENTIALS_EVENT } from './logic'
import { stopCallbackBuffer } from './flow'
import { POPUP_NAME, buildAuthProvider, clearOAuthCredentials } from './provider'

const ORIGIN = 'https://app.test'

function profile(over: Omit<Partial<Profile>, 'auth'> & { auth?: Partial<Profile['auth']> } = {}): Profile {
  const { auth, ...rest } = over
  return {
    id: 'p1',
    name: 'P',
    url: 'https://mcp.test/mcp',
    transport: 'auto',
    protocolVersion: null,
    headers: [],
    persistSecrets: false,
    createdAt: 1,
    updatedAt: 1,
    ...rest,
    auth: { mode: 'oauth', scope: null, clientId: null, ...auth },
  }
}

function build(p: Profile, deps = {}) {
  const provider = buildAuthProvider(p, ORIGIN, deps)
  if (!provider) throw new Error('expected a provider')
  return provider
}

function allLocalText(): string {
  let out = ''
  for (let i = 0; i < localStorage.length; i++) out += `${localStorage.key(i)}=${localStorage.getItem(localStorage.key(i)!)}\n`
  return out
}
const sessionText = () => sessionStorage.getItem(SESSION_SECRETS_KEY) ?? ''
const persistedText = () => localStorage.getItem(PERSISTED_SECRETS_KEY) ?? ''

const TOKENS = { access_token: 'ACCESS-TOKEN-AAAA', refresh_token: 'REFRESH-TOKEN-BBBB', token_type: 'Bearer', expires_in: 3600 }
const CLIENT = { client_id: 'client-123', client_secret: 'CLIENT-SECRET-CCCC', redirect_uris: [`${ORIGIN}/oauth/callback`] }

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
})

describe('buildAuthProvider', () => {
  it("returns undefined when auth.mode is 'none'", () => {
    expect(buildAuthProvider(profile({ auth: { mode: 'none' } }), ORIGIN)).toBeUndefined()
  })

  it('redirectUrl is exactly ${origin}/oauth/callback and clientMetadata is a public client', () => {
    const p = build(profile())
    expect(p.redirectUrl).toBe('https://app.test/oauth/callback')
    expect(p.clientMetadata).toEqual({
      redirect_uris: ['https://app.test/oauth/callback'],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      client_name: 'Simple Utilities MCP Inspector',
    })
  })

  it('clientMetadata.scope equals profile.auth.scope when set', () => {
    expect(build(profile({ auth: { scope: 'mcp:tools' } })).clientMetadata.scope).toBe('mcp:tools')
  })

  it('does not enable DPoP and never exposes skipIssuerMetadataValidation', () => {
    const p = build(profile()) as unknown as Record<string, unknown>
    expect(p.dpop).toBeUndefined()
    expect('skipIssuerMetadataValidation' in p).toBe(false)
  })
})

describe('storage round trips', () => {
  it('tokens round-trip under oauth:<id>:tokens and the expiry timestamp is never handed to the SDK', async () => {
    const p = build(profile(), { now: () => 5000 })
    expect(await p.tokens()).toBeUndefined()
    await p.saveTokens(TOKENS)
    expect(await p.tokens()).toEqual(TOKENS)
    expect(getSecret('oauth:p1:tokens')).toContain('"obtained_at":5000')
  })

  it('client information round-trips under oauth:<id>:client', async () => {
    const p = build(profile())
    expect(await p.clientInformation()).toBeUndefined()
    await p.saveClientInformation!(CLIENT)
    expect(await p.clientInformation()).toEqual(CLIENT)
    expect(getSecret('oauth:p1:client')).not.toBeNull()
  })

  it('a client registered for another origin is not reused', async () => {
    const p = build(profile())
    await p.saveClientInformation!({ ...CLIENT, redirect_uris: ['https://other.test/oauth/callback'] })
    expect(await p.clientInformation()).toBeUndefined()
  })

  it('code verifier round-trips under oauth:<id>:verifier; reading a missing one throws', async () => {
    const p = build(profile())
    expect(() => p.codeVerifier()).toThrow(/verifier/i)
    await p.saveCodeVerifier('verifier-VVVV')
    expect(await p.codeVerifier()).toBe('verifier-VVVV')
    expect(getSecret('oauth:p1:verifier')).toBe('verifier-VVVV')
  })

  it('discovery state round-trips and is dropped with the other state', async () => {
    const p = build(profile())
    expect(await p.discoveryState!()).toBeUndefined()
    await p.saveDiscoveryState!({ authorizationServerUrl: 'https://auth.test' })
    expect(await p.discoveryState!()).toEqual({ authorizationServerUrl: 'https://auth.test' })
  })

  it('stores nothing for another profile id', async () => {
    await build(profile()).saveTokens(TOKENS)
    expect(await build(profile({ id: 'p2' })).tokens()).toBeUndefined()
  })
})

describe('persistence tiers', () => {
  it('persistSecrets:false -> no token or client secret text in localStorage; session storage holds them', async () => {
    const p = build(profile({ persistSecrets: false }))
    await p.saveTokens(TOKENS)
    await p.saveClientInformation!(CLIENT)
    await p.saveCodeVerifier('verifier-VVVV')
    p.state!()
    expect(allLocalText()).not.toContain('ACCESS-TOKEN-AAAA')
    expect(allLocalText()).not.toContain('REFRESH-TOKEN-BBBB')
    expect(allLocalText()).not.toContain('CLIENT-SECRET-CCCC')
    expect(allLocalText()).not.toContain('verifier-VVVV')
    expect(sessionText()).toContain('ACCESS-TOKEN-AAAA')
    expect(sessionText()).toContain('CLIENT-SECRET-CCCC')
  })

  it('persistSecrets:true -> tokens and client info go to the persisted tier', async () => {
    const p = build(profile({ persistSecrets: true }))
    await p.saveTokens(TOKENS)
    await p.saveClientInformation!(CLIENT)
    expect(persistedText()).toContain('ACCESS-TOKEN-AAAA')
    expect(persistedText()).toContain('CLIENT-SECRET-CCCC')
    expect(sessionText()).not.toContain('ACCESS-TOKEN-AAAA')
    expect(await p.tokens()).toEqual(TOKENS)
  })

  it('the verifier, state and discovery state are ALWAYS session-only, even with persistSecrets:true', async () => {
    const p = build(profile({ persistSecrets: true }), { newState: () => 'state-SSSS' })
    await p.saveCodeVerifier('verifier-VVVV')
    p.state!()
    await p.saveDiscoveryState!({ authorizationServerUrl: 'https://auth.test' })
    expect(persistedText()).toBe('')
    expect(allLocalText()).not.toContain('verifier-VVVV')
    expect(allLocalText()).not.toContain('state-SSSS')
    expect(sessionText()).toContain('verifier-VVVV')
    expect(sessionText()).toContain('state-SSSS')
  })

  it('saving fresh tokens replaces a stale copy in the other tier', async () => {
    setSecret('oauth:p1:tokens', JSON.stringify({ access_token: 'STALE-SESSION-TOKEN' }), { persist: false })
    const p = build(profile({ persistSecrets: true }))
    await p.saveTokens(TOKENS)
    expect((await p.tokens())?.access_token).toBe('ACCESS-TOKEN-AAAA')
    expect(sessionText()).not.toContain('STALE-SESSION-TOKEN')
  })

  it('a refused write surfaces as an error instead of silently losing the credentials', () => {
    const p = build(profile())
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota')
    })
    try {
      expect(() => p.saveTokens(TOKENS)).toThrow(/Could not store/)
      expect(() => p.saveCodeVerifier('v')).toThrow(/Could not store/)
    } finally {
      spy.mockRestore()
    }
  })

  it('saving tokens drops the one-time verifier and state', async () => {
    const p = build(profile())
    await p.saveCodeVerifier('verifier-VVVV')
    p.state!()
    await p.saveTokens(TOKENS)
    expect(getSecret('oauth:p1:verifier')).toBeNull()
    expect(getSecret('oauth:p1:state')).toBeNull()
  })
})

describe('invalidateCredentials', () => {
  async function fill(persist: boolean) {
    const p = build(profile({ persistSecrets: persist }))
    await p.saveTokens(TOKENS)
    await p.saveClientInformation!(CLIENT)
    await p.saveCodeVerifier('verifier-VVVV')
    p.state!()
    await p.saveDiscoveryState!({ authorizationServerUrl: 'https://auth.test' })
    // saveTokens clears verifier/state; put them back so each scope can be observed separately
    await p.saveCodeVerifier('verifier-VVVV')
    p.state!()
    return p
  }
  const keys = () => ({
    tokens: getSecret('oauth:p1:tokens'),
    client: getSecret('oauth:p1:client'),
    verifier: getSecret('oauth:p1:verifier'),
    state: getSecret('oauth:p1:state'),
    discovery: getSecret('oauth:p1:discovery'),
  })

  it.each([true, false])("'all' deletes every key from both tiers (persistSecrets=%s)", async (persist) => {
    const p = await fill(persist)
    await p.invalidateCredentials!('all')
    expect(Object.values(keys())).toEqual([null, null, null, null, null])
    expect(persistedText()).toBe('')
    expect(sessionText()).toBe('')
  })

  it.each(['tokens', 'client', 'verifier', 'discovery'] as const)("'%s' deletes only that key", async (scope) => {
    const p = await fill(false)
    await p.invalidateCredentials!(scope)
    const k = keys()
    expect(k[scope]).toBeNull()
    for (const other of ['tokens', 'client', 'verifier', 'discovery'] as const) {
      if (other !== scope) expect(k[other]).not.toBeNull()
    }
  })

  it('does not touch another profile', async () => {
    await build(profile({ id: 'p2' })).saveTokens(TOKENS)
    await build(profile()).invalidateCredentials!('all')
    expect(getSecret('oauth:p2:tokens')).not.toBeNull()
  })

  it('notifies listeners so the status line can refresh', () => {
    const listener = vi.fn()
    window.addEventListener(OAUTH_CREDENTIALS_EVENT, listener)
    clearOAuthCredentials('p1')
    window.removeEventListener(OAUTH_CREDENTIALS_EVENT, listener)
    expect(listener).toHaveBeenCalledTimes(1)
  })
})

describe('pre-registered client', () => {
  it('clientInformation() returns {client_id} and never needs a stored registration', async () => {
    const p = build(profile({ auth: { clientId: ' my-public-client ' } }))
    expect(await p.clientInformation()).toEqual({ client_id: 'my-public-client' })
    expect(await p.clientInformation({ issuer: 'https://auth.test' })).toEqual({ client_id: 'my-public-client', issuer: 'https://auth.test' })
  })

  it('does not store a registration for it, and a stale stored one is ignored', async () => {
    setSecret('oauth:p1:client', JSON.stringify(CLIENT), { persist: false })
    const p = build(profile({ auth: { clientId: 'pre-1' } }))
    await p.saveClientInformation!({ client_id: 'pre-1', issuer: 'https://auth.test' })
    expect((await p.clientInformation())?.client_id).toBe('pre-1')
    expect(getSecret('oauth:p1:client')).toBe(JSON.stringify(CLIENT))
  })
})

describe('state()', () => {
  it('is fresh per call (>= 128 bits base64url) and persisted for verification', () => {
    const p = build(profile())
    const a = p.state!() as string
    const first = getSecret('oauth:p1:state')
    const b = p.state!() as string
    expect(a).toMatch(/^[A-Za-z0-9_-]{22,}$/)
    expect(b).toMatch(/^[A-Za-z0-9_-]{22,}$/)
    expect(a).not.toBe(b)
    expect(first).toBe(a)
    expect(getSecret('oauth:p1:state')).toBe(b)
  })
})

describe('redirectToAuthorization', () => {
  const url = new URL('https://auth.test/authorize?client_id=c&state=s')

  it.each(['javascript:alert(1)', 'data:text/html,hi', 'file:///etc/passwd', 'ftp://auth.test/x'])('rejects %s without opening anything', (bad) => {
    const openWindow = vi.fn()
    const assignLocation = vi.fn()
    const p = build(profile(), { openWindow, assignLocation })
    expect(() => p.redirectToAuthorization(new URL(bad))).toThrow(/non-http/)
    expect(openWindow).not.toHaveBeenCalled()
    expect(assignLocation).not.toHaveBeenCalled()
    expect(getSecret('oauth:pending-return')).toBeNull()
  })

  it('opens the URL in a popup named mcp-oauth and leaves the page where it is', () => {
    const popup = {} as Window
    const openWindow = vi.fn().mockReturnValue(popup)
    const assignLocation = vi.fn()
    build(profile(), { openWindow, assignLocation }).redirectToAuthorization(url)
    expect(openWindow).toHaveBeenCalledTimes(1)
    expect(openWindow.mock.calls[0][0]).toBe(url.toString())
    expect(openWindow.mock.calls[0][1]).toBe('mcp-oauth')
    expect(POPUP_NAME).toBe('mcp-oauth')
    expect(assignLocation).not.toHaveBeenCalled()
    expect(getSecret('oauth:pending-return')).toBeNull()
  })

  it('cuts the popup off from this window (reverse-tabnabbing guard)', () => {
    const popup = { opener: 'this window' } as unknown as Window
    build(profile(), { openWindow: () => popup, assignLocation: vi.fn() }).redirectToAuthorization(url)
    expect(popup.opener).toBeNull()
  })

  it('clears a stale full-page marker BEFORE the popup is opened (the popup inherits sessionStorage)', () => {
    setSecret('oauth:pending-return', JSON.stringify({ profileId: 'old' }), { persist: false })
    let markerWhenOpened: string | null = 'not called'
    const openWindow = vi.fn(() => {
      markerWhenOpened = getSecret('oauth:pending-return')
      return {} as Window
    })
    build(profile(), { openWindow, assignLocation: vi.fn() }).redirectToAuthorization(url)
    expect(markerWhenOpened).toBeNull()
    expect(getSecret('oauth:pending-return')).toBeNull()
  })

  it('when the popup is blocked it stores {profileId} in the SESSION tier and navigates this page', () => {
    const assignLocation = vi.fn()
    build(profile({ persistSecrets: true }), { openWindow: () => null, assignLocation }).redirectToAuthorization(url)
    expect(JSON.parse(getSecret('oauth:pending-return')!)).toEqual({ profileId: 'p1' })
    expect(sessionText()).toContain('oauth:pending-return')
    expect(allLocalText()).not.toContain('pending-return')
    expect(assignLocation).toHaveBeenCalledWith(url.toString())
  })

  describe('lost-message buffer', () => {
    class FakeChannel {
      static instances: FakeChannel[] = []
      onmessage: ((e: MessageEvent) => void) | null = null
      closed = false
      constructor(readonly name: string) {
        FakeChannel.instances.push(this)
      }
      postMessage(): void {}
      close(): void {
        this.closed = true
      }
    }
    beforeEach(() => {
      FakeChannel.instances = []
      vi.stubGlobal('BroadcastChannel', FakeChannel)
    })
    afterEach(() => {
      stopCallbackBuffer()
      vi.unstubAllGlobals()
    })

    it('starts listening on the OAuth channel once the popup is open', () => {
      build(profile(), { openWindow: () => ({}) as Window, assignLocation: vi.fn() }).redirectToAuthorization(url)
      expect(FakeChannel.instances).toHaveLength(1)
      expect(FakeChannel.instances[0].name).toBe('su-mcp-oauth')
      expect(FakeChannel.instances[0].onmessage).not.toBeNull()
    })

    it('does not listen in the full-page fallback or for a rejected URL', () => {
      build(profile(), { openWindow: () => null, assignLocation: vi.fn() }).redirectToAuthorization(url)
      expect(() => build(profile(), { openWindow: vi.fn(), assignLocation: vi.fn() }).redirectToAuthorization(new URL('javascript:alert(1)'))).toThrow()
      expect(FakeChannel.instances).toHaveLength(0)
    })

    it('a second sign-in replaces the first listener instead of stacking another', () => {
      const p = build(profile(), { openWindow: () => ({}) as Window, assignLocation: vi.fn() })
      p.redirectToAuthorization(url)
      p.redirectToAuthorization(url)
      expect(FakeChannel.instances).toHaveLength(2)
      expect(FakeChannel.instances.filter((c) => !c.closed)).toHaveLength(1)
    })
  })

  it('does not leave the page when the marker cannot be stored', () => {
    const assignLocation = vi.fn()
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota')
    })
    try {
      expect(() => build(profile(), { openWindow: () => null, assignLocation }).redirectToAuthorization(url)).toThrow(/Could not store/)
    } finally {
      spy.mockRestore()
    }
    expect(assignLocation).not.toHaveBeenCalled()
  })
})
