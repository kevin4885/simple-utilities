import { describe, it, expect } from 'vitest'
import {
  OAuthClientFlowError,
  OAuthError,
  ProtocolError,
  RegistrationRejectedError,
  SdkError,
  SdkErrorCode,
  SdkHttpError,
  UnauthorizedError,
} from '@modelcontextprotocol/client'
import {
  addFragments,
  classifyConnectionError,
  collectPages,
  getHttpStatus,
  isLoopbackHost,
  isSecretHeaderName,
  mixedContentRisk,
  oauthSecretFragments,
  redactHeaders,
  redactUrl,
  scrubSecrets,
  secretFragments,
  validateServerUrl,
  withSecretCapture,
} from './logic'

describe('validateServerUrl', () => {
  it('accepts https and http://localhost URLs', () => {
    expect(validateServerUrl('https://x.test/mcp')).toEqual({ ok: true, url: 'https://x.test/mcp' })
    expect(validateServerUrl('http://localhost:3000/mcp')).toEqual({ ok: true, url: 'http://localhost:3000/mcp' })
  })

  it('trims surrounding whitespace', () => {
    expect(validateServerUrl('  https://x.test/mcp \n')).toEqual({ ok: true, url: 'https://x.test/mcp' })
  })

  it.each(['', '   ', 'not a url', 'ftp://x.test', 'javascript:alert(1)', 'file:///etc/passwd'])('rejects %j', (text) => {
    const r = validateServerUrl(text)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason.length).toBeGreaterThan(0)
  })

  it('rejects embedded credentials and points at headers', () => {
    const r = validateServerUrl('https://user:pw@x.test/')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/header/i)
    expect(validateServerUrl('https://user@x.test/').ok).toBe(false)
  })
})

describe('isLoopbackHost', () => {
  it.each(['localhost', 'LOCALHOST', '127.0.0.1', '127.1.2.3', '[::1]', '::1', 'foo.localhost', 'localhost.'])(
    'true for %s',
    (h) => expect(isLoopbackHost(h)).toBe(true),
  )
  it.each(['example.com', '127.0.0.1.evil.com', '128.0.0.1', 'localhost.evil.com', '127.0.0.300', '10.0.0.1'])(
    'false for %s',
    (h) => expect(isLoopbackHost(h)).toBe(false),
  )
})

describe('mixedContentRisk', () => {
  it('is true for remote http on an https page', () => {
    expect(mixedContentRisk({ pageProtocol: 'https:', url: 'http://example.com/mcp' })).toBe(true)
  })
  it('is false for loopback http, any https url, and http pages', () => {
    expect(mixedContentRisk({ pageProtocol: 'https:', url: 'http://localhost/mcp' })).toBe(false)
    expect(mixedContentRisk({ pageProtocol: 'https:', url: 'http://127.0.0.1:8080/mcp' })).toBe(false)
    expect(mixedContentRisk({ pageProtocol: 'https:', url: 'https://example.com/mcp' })).toBe(false)
    expect(mixedContentRisk({ pageProtocol: 'http:', url: 'http://example.com/mcp' })).toBe(false)
  })
  it('is false for an unparseable url', () => {
    expect(mixedContentRisk({ pageProtocol: 'https:', url: 'nope' })).toBe(false)
  })
})

describe('isSecretHeaderName', () => {
  it.each(['Authorization', 'Cookie', 'X-Auth-Token', 'api-key', 'X-Secret', 'Proxy-Authorization', 'Set-Cookie', 'X-Password'])(
    'true for %s',
    (n) => expect(isSecretHeaderName(n)).toBe(true),
  )
  it.each(['Accept', 'Content-Type', 'X-Request-Id', 'Mcp-Session-Id', 'MCP-Protocol-Version'])('false for %s', (n) =>
    expect(isSecretHeaderName(n)).toBe(false),
  )
})

describe('redactHeaders', () => {
  it('redacts secret names and extra names, keeps casing, does not mutate', () => {
    const input = { Authorization: 'Bearer abc', 'X-Api-Key': 'k', Accept: 'x', 'x-custom': 'v' }
    const snapshot = { ...input }
    const out = redactHeaders(input, ['x-custom'])
    expect(out).toEqual({ Authorization: '[redacted]', 'X-Api-Key': '[redacted]', Accept: 'x', 'x-custom': '[redacted]' })
    expect(input).toEqual(snapshot)
    expect(out).not.toBe(input)
  })
  it('matches extra names case-insensitively', () => {
    expect(redactHeaders({ 'X-Tenant': 'acme' }, ['x-TENANT'])).toEqual({ 'X-Tenant': '[redacted]' })
  })
  it('leaves everything when nothing is secret', () => {
    expect(redactHeaders({ Accept: 'a' })).toEqual({ Accept: 'a' })
  })
})

describe('redactUrl / secretFragments / scrubSecrets', () => {
  it('redacts secret-named query params and userinfo only', () => {
    expect(redactUrl('https://x.test/mcp?api_key=SECRET&q=1')).toBe('https://x.test/mcp?api_key=%5Bredacted%5D&q=1')
    expect(redactUrl('https://x.test/mcp?q=1')).toBe('https://x.test/mcp?q=1')
    expect(redactUrl('not a url')).toBe('not a url')
  })
  it('extracts the full value and the token after a scheme word', () => {
    const f = secretFragments([
      { name: 'Authorization', value: 'Bearer SECRET123' },
      { name: 'Accept', value: 'application/json' },
      { name: 'X-Api-Key', value: 'ab' },
    ])
    expect(f).toContain('Bearer SECRET123')
    expect(f).toContain('SECRET123')
    expect(f).not.toContain('application/json')
    expect(f).not.toContain('ab') // too short to scrub safely
    const all = secretFragments([{ name: 'X-Tenant', value: 'acme-corp' }], true)
    expect(all).toContain('acme-corp')
    expect(secretFragments([{ name: 'X-Tenant', value: 'acme-corp' }])).toEqual([])
  })
  it('scrubs every occurrence', () => {
    expect(scrubSecrets('x SECRET123 y SECRET123', ['SECRET123'])).toBe('x [redacted] y [redacted]')
  })
})

describe('OAuth credential scrubbing helpers', () => {
  it('oauthSecretFragments picks credential members of token / registration objects only', () => {
    expect(
      oauthSecretFragments({
        access_token: 'ACCESS1',
        refresh_token: 'REFRESH1',
        id_token: 'IDTOKEN1',
        client_secret: 'SECRET01',
        registration_access_token: 'REGTOKEN1',
        token_type: 'Bearer',
        client_id: 'public-id',
        expires_in: 3600,
      }),
    ).toEqual(['ACCESS1', 'REFRESH1', 'IDTOKEN1', 'SECRET01', 'REGTOKEN1'])
  })

  it('ignores non-objects, non-strings and values too short to scrub safely', () => {
    expect(oauthSecretFragments(null)).toEqual([])
    expect(oauthSecretFragments('access_token')).toEqual([])
    expect(oauthSecretFragments({ access_token: 5, refresh_token: 'abc' })).toEqual([])
  })

  it('addFragments appends in place, skipping duplicates and short strings', () => {
    const target = ['KEEP1234']
    addFragments(target, ['KEEP1234', 'NEW56789', 'ab'])
    expect(target).toEqual(['KEEP1234', 'NEW56789'])
  })

  it('withSecretCapture reports tokens/client info/verifier read or written, and forwards everything', async () => {
    const learned: string[][] = []
    const inner = {
      redirectUrl: 'https://app.test/cb',
      marker: 'untouched',
      tokens: () => ({ access_token: 'ACCESS-READ' }),
      asyncTokens: undefined,
      clientInformation: async () => ({ client_id: 'c', client_secret: 'CLIENT-SECRET-READ' }),
      saveTokens(t: { access_token: string }) {
        return t.access_token
      },
      saveCodeVerifier: (v: string) => v,
      codeVerifier: () => 'VERIFIER-READ',
      redirectToAuthorization: (u: string) => `go:${u}`,
    }
    const wrapped = withSecretCapture(inner, (f) => learned.push(f))
    expect(wrapped.redirectUrl).toBe('https://app.test/cb')
    expect(wrapped.marker).toBe('untouched')
    expect(wrapped.redirectToAuthorization('u')).toBe('go:u')
    expect(wrapped.tokens()).toEqual({ access_token: 'ACCESS-READ' })
    expect(await wrapped.clientInformation()).toEqual({ client_id: 'c', client_secret: 'CLIENT-SECRET-READ' })
    expect(wrapped.saveTokens({ access_token: 'ACCESS-WRITTEN' })).toBe('ACCESS-WRITTEN')
    wrapped.saveCodeVerifier('VERIFIER-WRITTEN')
    expect(wrapped.codeVerifier()).toBe('VERIFIER-READ')
    await Promise.resolve()
    expect(learned.flat().sort()).toEqual(
      ['ACCESS-READ', 'ACCESS-WRITTEN', 'CLIENT-SECRET-READ', 'VERIFIER-READ', 'VERIFIER-WRITTEN'].sort(),
    )
  })

  it('withSecretCapture keeps optional methods absent (the SDK probes for them) and survives a throwing provider', () => {
    const wrapped = withSecretCapture({ tokens: () => { throw new Error('boom') } } as { tokens(): unknown; saveDiscoveryState?: () => void }, () => undefined)
    expect(wrapped.saveDiscoveryState).toBeUndefined()
    expect(() => wrapped.tokens()).toThrow('boom')
  })
})

describe('classifyConnectionError', () => {
  const https = 'https:'

  it('mixed content: opaque fetch failure on https page to remote http', () => {
    const d = classifyConnectionError(new TypeError('Failed to fetch'), { url: 'http://example.com/mcp', pageProtocol: https })
    expect(d.code).toBe('mixed-content')
    expect(d.detail).toContain('Failed to fetch')
  })

  it('cors-or-network: same TypeError to an https target mentions the CORS headers', () => {
    const d = classifyConnectionError(new TypeError('Failed to fetch'), { url: 'https://example.com/mcp', pageProtocol: https })
    expect(d.code).toBe('cors-or-network')
    const hints = d.hints.join('\n')
    expect(hints).toContain('Access-Control-Allow-Origin')
    expect(hints).toContain('Mcp-Session-Id')
    expect(d.httpStatus).toBeNull()
  })

  it('finds a network TypeError wrapped in a cause chain (SDK probe error)', () => {
    const wrapped = new SdkError(SdkErrorCode.EraNegotiationFailed, 'probe failed', undefined, { cause: new TypeError('Failed to fetch') })
    expect(classifyConnectionError(wrapped, { url: 'https://x.test/', pageProtocol: https }).code).toBe('cors-or-network')
  })

  it('unauthorized: SDK UnauthorizedError and HTTP 401', () => {
    expect(classifyConnectionError(new UnauthorizedError(), { url: 'https://x.test/', pageProtocol: https }).code).toBe('unauthorized')
    const e401 = new SdkHttpError(SdkErrorCode.ClientHttpNotImplemented, 'nope', { status: 401 })
    const d = classifyConnectionError(e401, { url: 'https://x.test/', pageProtocol: https })
    expect(d.code).toBe('unauthorized')
    expect(d.httpStatus).toBe(401)
  })

  it('forbidden: 403', () => {
    const d = classifyConnectionError(new SdkHttpError(SdkErrorCode.ClientHttpForbidden, 'denied', { status: 403 }), {
      url: 'https://x.test/',
      pageProtocol: https,
    })
    expect(d.code).toBe('forbidden')
    expect(d.httpStatus).toBe(403)
  })

  it('session-expired only for 404 with a session id', () => {
    const e = new SdkHttpError(SdkErrorCode.ClientHttpNotImplemented, 'gone', { status: 404 })
    expect(classifyConnectionError(e, { url: 'https://x.test/', pageProtocol: https, sessionId: 'abc' }).code).toBe('session-expired')
    const plain = classifyConnectionError(e, { url: 'https://x.test/', pageProtocol: https })
    expect(plain.code).toBe('http-status')
    expect(plain.httpStatus).toBe(404)
  })

  it('http-status: other statuses carry httpStatus', () => {
    const d = classifyConnectionError(new SdkHttpError(SdkErrorCode.ClientHttpNotImplemented, 'boom', { status: 500 }), {
      url: 'https://x.test/',
      pageProtocol: https,
    })
    expect(d.code).toBe('http-status')
    expect(d.httpStatus).toBe(500)
  })

  it('reads the status out of a legacy SSE POST error message', () => {
    expect(getHttpStatus(new Error('Error POSTing to endpoint (HTTP 502): bad'))).toBe(502)
  })

  it('does not read an HTTP status out of OAuth errors or nested causes (would wrongly trigger the SSE fallback)', () => {
    expect(getHttpStatus(new Error('Dynamic Client Registration rejected (HTTP 400)'))).toBe(400) // top-level plain text is still read
    const rejected = new RegistrationRejectedError({ status: 400, body: 'invalid_redirect_uri', submittedMetadata: { redirect_uris: [] } })
    expect(rejected.message).toContain('(HTTP 400)')
    expect(rejected).toBeInstanceOf(OAuthClientFlowError)
    expect(getHttpStatus(rejected)).toBeNull()
    expect(getHttpStatus(new OAuthError('server_error' as never, 'token endpoint said (HTTP 400)'))).toBeNull()
    const wrapped = Object.assign(new Error('connect failed'), { cause: new Error('inner (HTTP 404)') })
    expect(getHttpStatus(wrapped)).toBeNull()
  })

  it('timeout: AbortError, TimeoutError and SDK request timeout', () => {
    const abort = new DOMException('aborted', 'AbortError')
    expect(classifyConnectionError(abort, { url: 'https://x.test/', pageProtocol: https }).code).toBe('timeout')
    const sdk = new SdkError(SdkErrorCode.RequestTimeout, 'Request timed out', { timeout: 10 })
    expect(classifyConnectionError(sdk, { url: 'https://x.test/', pageProtocol: https }).code).toBe('timeout')
  })

  it('protocol: JSON-RPC error to initialize', () => {
    const d = classifyConnectionError(new ProtocolError(-32600, 'bad init'), { url: 'https://x.test/', pageProtocol: https })
    expect(d.code).toBe('protocol')
    expect(d.detail).toContain('bad init')
  })

  it('unknown: keeps the original message in detail', () => {
    const d = classifyConnectionError(new Error('weird thing'), { url: 'https://x.test/', pageProtocol: https })
    expect(d.code).toBe('unknown')
    expect(d.detail).toContain('weird thing')
    expect(classifyConnectionError('a string', { url: 'https://x.test/', pageProtocol: https }).detail).toContain('a string')
  })
})

describe('collectPages', () => {
  const paged = (pages: string[][]) => async (cursor: string | undefined) => {
    const i = cursor === undefined ? 0 : Number(cursor)
    return { items: pages[i], nextCursor: i + 1 < pages.length ? String(i + 1) : undefined }
  }

  it('follows nextCursor across 3 pages preserving order', async () => {
    const r = await collectPages(paged([['a', 'b'], ['c', 'd'], ['e']]))
    expect(r).toEqual({ items: ['a', 'b', 'c', 'd', 'e'], truncated: false, reason: null, error: null })
  })

  it('stops at maxPages', async () => {
    const r = await collectPages(paged([['a'], ['b'], ['c'], ['d']]), { maxPages: 2 })
    expect(r.items).toEqual(['a', 'b'])
    expect(r.truncated).toBe(true)
    expect(r.reason).toBe('max-pages')
    expect(r.error).toBeNull()
  })

  it('defaults to 50 pages', async () => {
    let calls = 0
    const r = await collectPages(async () => {
      calls++
      return { items: [calls], nextCursor: `c${calls}` }
    })
    expect(calls).toBe(50)
    expect(r.reason).toBe('max-pages')
  })

  it('detects a repeated cursor', async () => {
    let n = 0
    const r = await collectPages(async () => ({ items: [n++], nextCursor: 'same' }))
    expect(r.truncated).toBe(true)
    expect(r.reason).toBe('cursor-loop')
    expect(r.items).toEqual([0, 1])
  })

  it('returns collected items plus error when a later page throws', async () => {
    const r = await collectPages(async (cursor) => {
      if (cursor === undefined) return { items: ['p1'], nextCursor: 'x' }
      throw new Error('page 2 exploded')
    })
    expect(r.items).toEqual(['p1'])
    expect(r.error).toBe('page 2 exploded')
    expect(r.truncated).toBe(false)
  })

  it('handles an empty first page and an immediately failing fetch', async () => {
    expect((await collectPages(async () => ({ items: [] }))).items).toEqual([])
    const failed = await collectPages(async () => {
      throw 'plain'
    })
    expect(failed.items).toEqual([])
    expect(failed.error).toBe('plain')
  })
})
