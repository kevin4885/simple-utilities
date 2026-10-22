import { describe, expect, it } from 'vitest'
import {
  AuthorizationServerMismatchError,
  InsecureTokenEndpointError,
  InsufficientScopeError,
  OAuthError,
  OAuthErrorCode,
  RegistrationRejectedError,
  UnauthorizedError,
} from '@modelcontextprotocol/client'
import { CLIENT_NAME, authFailureMessage, buildClientMetadata, classifyOAuthError, oauthRedirectUrl, randomToken, tokenStatus } from './logic'

const ORIGIN = 'https://app.test'

describe('oauthRedirectUrl / buildClientMetadata', () => {
  it('redirect url is exactly origin + /oauth/callback', () => {
    expect(oauthRedirectUrl('https://app.test')).toBe('https://app.test/oauth/callback')
    expect(oauthRedirectUrl('http://localhost:5173')).toBe('http://localhost:5173/oauth/callback')
  })

  it('builds the public-client registration metadata', () => {
    expect(buildClientMetadata({ redirectUrl: 'https://app.test/oauth/callback', scope: null })).toEqual({
      redirect_uris: ['https://app.test/oauth/callback'],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      client_name: 'Simple Utilities MCP Inspector',
    })
    expect(CLIENT_NAME).toBe('Simple Utilities MCP Inspector')
  })

  it('includes scope only when set (trimmed); blank is omitted', () => {
    expect(buildClientMetadata({ redirectUrl: 'https://a/cb', scope: ' mcp:tools read ' }).scope).toBe('mcp:tools read')
    expect('scope' in buildClientMetadata({ redirectUrl: 'https://a/cb', scope: '   ' })).toBe(false)
    expect('scope' in buildClientMetadata({ redirectUrl: 'https://a/cb', scope: null })).toBe(false)
  })
})

describe('randomToken', () => {
  it('yields >= 128 bits of unpadded base64url and differs per call', () => {
    const a = randomToken()
    const b = randomToken()
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(a.length).toBeGreaterThanOrEqual(22) // 22 base64url chars = 132 bits
    expect(a).not.toBe(b)
  })

  it('encodes the bytes it is given (32 bytes -> 43 chars)', () => {
    // 32 bytes of 0xFF: 42 full base64url chars of '_' then the 4 leftover bits ('8' once padding is dropped).
    expect(randomToken(32, (bytes) => bytes.fill(255))).toBe('_'.repeat(42) + '8')
    expect(randomToken(32, (b) => b.fill(0))).toBe('A'.repeat(43))
  })
})

describe('tokenStatus', () => {
  it('is not signed in without a usable token record', () => {
    for (const stored of [null, '', 'not json', '[]', '{}', '{"access_token":""}', '{"access_token":5}', 'null']) {
      expect(tokenStatus(stored)).toEqual({ signedIn: false, expiresAt: null })
    }
  })

  it('reports the expiry from obtained_at + expires_in, never the token', () => {
    const s = tokenStatus(JSON.stringify({ access_token: 'SECRET', token_type: 'Bearer', expires_in: 3600, obtained_at: 1_000_000 }))
    expect(s).toEqual({ signedIn: true, expiresAt: 1_000_000 + 3_600_000 })
    expect(JSON.stringify(s)).not.toContain('SECRET')
  })

  it('is signed in with unknown expiry when expires_in or obtained_at is missing', () => {
    expect(tokenStatus(JSON.stringify({ access_token: 'x', token_type: 'Bearer' }))).toEqual({ signedIn: true, expiresAt: null })
    expect(tokenStatus(JSON.stringify({ access_token: 'x', expires_in: 60 }))).toEqual({ signedIn: true, expiresAt: null })
  })
})

describe('classifyOAuthError', () => {
  it.each([
    ['discovery', /discovery/],
    ['registration', /registration/],
    ['token', /token/],
  ] as const)('a "Failed to fetch" during %s is cors-or-network and names the endpoint class', (endpoint, label) => {
    const d = classifyOAuthError(new TypeError('Failed to fetch'), { endpoint, origin: ORIGIN })
    expect(d.code).toBe('cors-or-network')
    expect(d.title).toMatch(label)
    const hints = d.hints.join('\n')
    expect(hints).toMatch(label)
    expect(hints).toContain('Access-Control-Allow-Origin')
    expect(hints).toContain(ORIGIN)
    expect(d.detail).toContain('Failed to fetch')
    expect(d.httpStatus).toBeNull()
  })

  it('also recognises the sanitised plain Error that McpSession.finishAuth rethrows', () => {
    const d = classifyOAuthError(new Error('Failed to fetch'), { endpoint: 'token', origin: ORIGIN })
    expect(d.code).toBe('cors-or-network')
  })

  it('InsecureTokenEndpointError -> protocol, carrying the SDK message', () => {
    const e = new InsecureTokenEndpointError('http://auth.test/token')
    const d = classifyOAuthError(e, { endpoint: 'token', origin: ORIGIN })
    expect(d.code).toBe('protocol')
    expect(d.detail).toContain(e.message)
  })

  it('AuthorizationServerMismatchError -> protocol, carrying the SDK message', () => {
    const e = new AuthorizationServerMismatchError('https://a.test', 'https://b.test')
    const d = classifyOAuthError(e, { endpoint: 'token', origin: ORIGIN })
    expect(d.code).toBe('protocol')
    expect(d.detail).toContain(e.message)
    expect(d.hints.join(' ')).toMatch(/Clear credentials/)
  })

  it('InsufficientScopeError -> forbidden (403), carrying the SDK message', () => {
    const e = new InsufficientScopeError({ requiredScope: 'admin' })
    const d = classifyOAuthError(e, { endpoint: 'token', origin: ORIGIN })
    expect(d.code).toBe('forbidden')
    expect(d.httpStatus).toBe(403)
    expect(d.detail).toContain(e.message)
  })

  it('RegistrationRejectedError mentions the pre-registered client ID escape hatch', () => {
    const e = new RegistrationRejectedError({ status: 400, body: 'no thanks', submittedMetadata: buildClientMetadata({ redirectUrl: 'https://app.test/oauth/callback', scope: null }) })
    const d = classifyOAuthError(e, { endpoint: 'registration', origin: ORIGIN })
    expect(d.code).toBe('protocol')
    expect(d.hints.join(' ')).toMatch(/Pre-registered client ID/)
  })

  it('an OAuthError from the server -> protocol with its code and message', () => {
    const d = classifyOAuthError(new OAuthError(OAuthErrorCode.InvalidGrant, 'code expired'), { endpoint: 'token', origin: ORIGIN })
    expect(d.code).toBe('protocol')
    expect(d.title).toContain(OAuthErrorCode.InvalidGrant)
    expect(d.detail).toContain('code expired')
  })

  it('UnauthorizedError -> unauthorized; anything else falls back to the connection classifier', () => {
    expect(classifyOAuthError(new UnauthorizedError('nope'), { endpoint: 'token', origin: ORIGIN }).code).toBe('unauthorized')
    const d = classifyOAuthError(new Error('weird'), { endpoint: 'token', origin: ORIGIN })
    expect(d.code).toBe('unknown')
    expect(d.detail).toContain('weird')
  })
})

describe('authFailureMessage', () => {
  it('gives the CORS checklist for network failures and the SDK message otherwise', () => {
    const net = authFailureMessage(new TypeError('Failed to fetch'), { endpoint: 'token', origin: ORIGIN })
    expect(net).toContain('Access-Control-Allow-Origin')
    expect(authFailureMessage(new OAuthError(OAuthErrorCode.InvalidGrant, 'code expired'), { endpoint: 'token', origin: ORIGIN })).toBe('code expired')
  })
})
