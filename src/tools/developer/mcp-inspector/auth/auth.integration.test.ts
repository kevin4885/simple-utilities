import { beforeEach, describe, expect, it } from 'vitest'
import {
  StreamableHTTPClientTransport,
  auth,
  extractWWWAuthenticateParams,
  type OAuthClientProvider,
} from '@modelcontextprotocol/client'
import { createSession } from '../connection/session'
import type { ConnectionConfig, LogEntryInput, SessionState } from '../connection/types'
import type { Profile } from '../schemas'
import { getSecret } from '../secrets'
import { buildAuthProvider } from './provider'

// The SDK's REAL auth() / transports against a fake network. Nothing here mocks the SDK.

const ORIGIN = 'https://app.test'
const MCP_URL = 'https://mcp.test/mcp'
const AS = 'https://auth.test'

const ACCESS = 'ACCESS-TOKEN-AAAA1111'
const REFRESH = 'REFRESH-TOKEN-BBBB2222'
const CLIENT_SECRET = 'CLIENT-SECRET-CCCC3333'
const CODE = 'AUTH-CODE-DDDD4444'

interface Seen {
  method: string
  url: string
  headers: Record<string, string>
  body: string | null
}

function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' }, ...init })
}

interface NetworkOptions {
  /** Body the token endpoint answers with (default: a normal token response). */
  tokenResponse?: () => Response
  /** Dynamic registration answer (default: a client with a secret). */
  registerResponse?: () => Response
  /** Client auth methods the AS metadata advertises for the token endpoint. */
  tokenAuthMethods?: string[]
  /** Method the dynamic registration assigns to the new client (default 'none' = public client). */
  registeredAuthMethod?: string
}

/** protected-resource metadata + AS metadata + /register + /token + an OAuth-protected MCP endpoint. */
function fakeNetwork(opts: NetworkOptions = {}) {
  const seen: Seen[] = []
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? String(input) : input.url)
    const headers: Record<string, string> = {}
    new Headers(init?.headers).forEach((v, k) => (headers[k] = v))
    const body = init?.body === undefined || init.body === null ? null : String(init.body)
    const method = (init?.method ?? 'GET').toUpperCase()
    seen.push({ method, url: url.href, headers, body })

    if (url.origin === 'https://mcp.test') {
      if (url.pathname === '/.well-known/oauth-protected-resource/mcp' || url.pathname === '/.well-known/oauth-protected-resource') {
        return json({ resource: MCP_URL, authorization_servers: [AS], scopes_supported: ['mcp:tools'] })
      }
      if (url.pathname !== '/mcp') return new Response('nope', { status: 404 })
      if (headers.authorization !== `Bearer ${ACCESS}`) {
        return new Response('{"error":"unauthorized"}', {
          status: 401,
          headers: {
            'content-type': 'application/json',
            'www-authenticate': `Bearer resource_metadata="https://mcp.test/.well-known/oauth-protected-resource/mcp"`,
          },
        })
      }
      if (method === 'GET') return new Response(null, { status: 405 })
      if (method === 'DELETE') return new Response(null, { status: 200 })
      const rpc = body ? (JSON.parse(body) as { method?: string; id?: unknown }) : {}
      if (rpc.id === undefined) return new Response(null, { status: 202 })
      if (rpc.method === 'initialize') {
        return json(
          {
            jsonrpc: '2.0',
            id: rpc.id,
            result: { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'oauth-stub', version: '1.0.0' } },
          },
          { headers: { 'content-type': 'application/json', 'mcp-session-id': 'sess-oauth-1' } },
        )
      }
      return json({ jsonrpc: '2.0', id: rpc.id, result: {} })
    }

    if (url.origin === AS) {
      if (url.pathname.startsWith('/.well-known/oauth-authorization-server')) {
        return json({
          issuer: AS,
          authorization_endpoint: `${AS}/authorize`,
          token_endpoint: `${AS}/token`,
          registration_endpoint: `${AS}/register`,
          response_types_supported: ['code'],
          grant_types_supported: ['authorization_code', 'refresh_token'],
          code_challenge_methods_supported: ['S256'],
          token_endpoint_auth_methods_supported: opts.tokenAuthMethods ?? ['none'],
        })
      }
      if (url.pathname === '/register' && method === 'POST') {
        return (
          opts.registerResponse?.() ??
          json(
            { client_id: 'dyn-client-1', client_secret: CLIENT_SECRET, redirect_uris: [`${ORIGIN}/oauth/callback`], token_endpoint_auth_method: opts.registeredAuthMethod ?? 'none' },
            { status: 201 },
          )
        )
      }
      if (url.pathname === '/token' && method === 'POST') {
        return (
          opts.tokenResponse?.() ??
          json({ access_token: ACCESS, refresh_token: REFRESH, token_type: 'Bearer', expires_in: 3600 })
        )
      }
    }
    return new Response('unexpected request', { status: 500 })
  }) as typeof fetch
  return { fetchImpl, seen }
}

function profile(over: Partial<Profile> = {}): Profile {
  return {
    id: 'p1',
    name: 'P',
    url: MCP_URL,
    transport: 'streamable-http',
    protocolVersion: '2025-06-18',
    headers: [],
    persistSecrets: false,
    auth: { mode: 'oauth', scope: null, clientId: null },
    createdAt: 1,
    updatedAt: 1,
    ...over,
  }
}

function provider(p: Profile = profile(), redirects: URL[] = []): OAuthClientProvider {
  const result = buildAuthProvider(p, ORIGIN, {
    openWindow: (url) => {
      redirects.push(new URL(url))
      return {} as Window
    },
    assignLocation: () => undefined,
  })
  if (!result) throw new Error('expected a provider')
  return result
}

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
})

describe('SDK auth() with the real provider (criterion 9)', () => {
  async function discoverFrom401(fetchImpl: typeof fetch) {
    const res = await fetchImpl(MCP_URL, { method: 'POST', body: '{}' })
    expect(res.status).toBe(401)
    return extractWWWAuthenticateParams(res).resourceMetadataUrl
  }

  it('REDIRECTs with PKCE S256, state and the resource indicator, then AUTHORIZEs from the code', async () => {
    const net = fakeNetwork()
    const redirects: URL[] = []
    const p = provider(profile(), redirects)
    const resourceMetadataUrl = await discoverFrom401(net.fetchImpl)
    expect(resourceMetadataUrl?.href).toBe('https://mcp.test/.well-known/oauth-protected-resource/mcp')

    const first = await auth(p, { serverUrl: MCP_URL, resourceMetadataUrl, fetchFn: net.fetchImpl })
    expect(first).toBe('REDIRECT')
    expect(redirects).toHaveLength(1)
    const authUrl = redirects[0]
    expect(`${authUrl.origin}${authUrl.pathname}`).toBe(`${AS}/authorize`)
    expect(authUrl.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(authUrl.searchParams.get('code_challenge_method')).toBe('S256')
    expect(authUrl.searchParams.get('resource')).toBe(MCP_URL)
    expect(authUrl.searchParams.get('response_type')).toBe('code')
    expect(authUrl.searchParams.get('redirect_uri')).toBe(`${ORIGIN}/oauth/callback`)
    expect(authUrl.searchParams.get('client_id')).toBe('dyn-client-1')
    const state = authUrl.searchParams.get('state')
    expect(state).toMatch(/^[A-Za-z0-9_-]{22,}$/)
    expect(getSecret('oauth:p1:state')).toBe(state)

    // dynamic registration sent our public-client metadata; the client was stored under the profile key
    const register = net.seen.find((r) => r.url === `${AS}/register`)!
    expect(JSON.parse(register.body!)).toMatchObject({
      redirect_uris: [`${ORIGIN}/oauth/callback`],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      client_name: 'Simple Utilities MCP Inspector',
    })
    expect(getSecret('oauth:p1:client')).toContain('dyn-client-1')
    expect(getSecret('oauth:p1:tokens')).toBeNull()

    const verifier = getSecret('oauth:p1:verifier')
    expect(verifier).toBeTruthy()
    const second = await auth(p, { serverUrl: MCP_URL, resourceMetadataUrl, authorizationCode: CODE, fetchFn: net.fetchImpl })
    expect(second).toBe('AUTHORIZED')

    const token = net.seen.find((r) => r.url === `${AS}/token`)!
    const form = new URLSearchParams(token.body!)
    expect(form.get('grant_type')).toBe('authorization_code')
    expect(form.get('code')).toBe(CODE)
    expect(form.get('code_verifier')).toBe(verifier)
    expect(form.get('redirect_uri')).toBe(`${ORIGIN}/oauth/callback`)
    expect(form.get('resource')).toBe(MCP_URL)

    const stored = JSON.parse(getSecret('oauth:p1:tokens')!) as Record<string, unknown>
    expect(stored.access_token).toBe(ACCESS)
    expect(stored.refresh_token).toBe(REFRESH)
    expect((await p.tokens())?.access_token).toBe(ACCESS)
    // tokens never reach persistent storage with persistSecrets:false
    expect(JSON.stringify({ ...localStorage })).not.toContain(ACCESS)
  })

  it('a pre-registered client ID skips dynamic registration', async () => {
    const net = fakeNetwork()
    const redirects: URL[] = []
    const p = provider(profile({ auth: { mode: 'oauth', scope: null, clientId: 'my-public-client' } }), redirects)
    const resourceMetadataUrl = await discoverFrom401(net.fetchImpl)
    expect(await auth(p, { serverUrl: MCP_URL, resourceMetadataUrl, fetchFn: net.fetchImpl })).toBe('REDIRECT')
    expect(net.seen.some((r) => r.url === `${AS}/register`)).toBe(false)
    expect(redirects[0].searchParams.get('client_id')).toBe('my-public-client')
  })

  it('a refresh token is used before sending the user to sign in again', async () => {
    const net = fakeNetwork()
    const p = provider()
    const resourceMetadataUrl = await discoverFrom401(net.fetchImpl)
    await auth(p, { serverUrl: MCP_URL, resourceMetadataUrl, fetchFn: net.fetchImpl })
    await auth(p, { serverUrl: MCP_URL, resourceMetadataUrl, authorizationCode: CODE, fetchFn: net.fetchImpl })
    net.seen.length = 0
    expect(await auth(p, { serverUrl: MCP_URL, resourceMetadataUrl, fetchFn: net.fetchImpl })).toBe('AUTHORIZED')
    const refresh = net.seen.find((r) => r.url === `${AS}/token`)!
    expect(new URLSearchParams(refresh.body!).get('grant_type')).toBe('refresh_token')
  })
})

describe('McpSession + real transport + OAuth provider', () => {
  const config: ConnectionConfig = { url: MCP_URL, transport: 'streamable-http', headers: [], protocolVersion: '2025-06-18' }

  function harness(net: ReturnType<typeof fakeNetwork>, p: OAuthClientProvider, cfg: ConnectionConfig = config) {
    const logs: LogEntryInput[] = []
    const states: SessionState[] = []
    const session = createSession({
      config: cfg,
      onLog: (e) => logs.push(e),
      onState: (s) => states.push(s),
      authProvider: p,
      fetchImpl: net.fetchImpl,
      transportFactory: (_kind, ctx) =>
        new StreamableHTTPClientTransport(ctx.url, { fetch: ctx.fetch, requestInit: { headers: ctx.headers }, authProvider: ctx.authProvider }),
    })
    return { session, logs, states }
  }

  it('connect -> auth-required -> finishAuth(code) -> connect succeeds with the stored bearer token', async () => {
    const net = fakeNetwork()
    const redirects: URL[] = []
    const h = harness(net, provider(profile(), redirects))

    const first = await h.session.connect()
    expect(first.status).toBe('auth-required')
    expect(redirects).toHaveLength(1)
    expect(redirects[0].searchParams.get('resource')).toBe(MCP_URL)

    await h.session.finishAuth(CODE)
    expect(JSON.parse(getSecret('oauth:p1:tokens')!).access_token).toBe(ACCESS)

    const second = await h.session.connect()
    expect(second.status).toBe('connected')
    const authorized = net.seen.filter((r) => r.url === MCP_URL && r.headers.authorization === `Bearer ${ACCESS}`)
    expect(authorized.length).toBeGreaterThan(0)
    await h.session.disconnect()
  })

  describe('token scrubbing (carry-forward from the P1 review)', () => {
    const SECRETS = [ACCESS, REFRESH, CLIENT_SECRET, CODE]

    function expectNoSecrets(logs: LogEntryInput[], states: SessionState[] = []): void {
      const dump = JSON.stringify([logs, states])
      for (const s of SECRETS) expect(dump).not.toContain(s)
    }

    it('no token, client secret or code reaches onLog or any state across auth() + token exchange + authorized requests', async () => {
      const net = fakeNetwork({ tokenAuthMethods: ['client_secret_post', 'none'], registeredAuthMethod: 'client_secret_post' })
      const h = harness(net, provider())

      expect((await h.session.connect()).status).toBe('auth-required')
      await h.session.finishAuth(CODE)
      const connected = await h.session.connect()
      expect(connected.status).toBe('connected')
      const ping = await h.session.rawRequest('ping')
      expect(ping.ok).toBe(true)
      await h.session.disconnect()

      // The secrets really were on the wire (otherwise this test proves nothing).
      const wire = JSON.stringify(net.seen)
      expect(wire).toContain(ACCESS) // Authorization: Bearer <access> on the authorized requests
      expect(wire).toContain(CODE) // in the token request body
      expect(wire).toContain(CLIENT_SECRET) // client_secret_post sends the registered secret to /token
      // ...and the tap really logged the requests that carried them (headers redacted by name).
      const http = h.logs.filter((l): l is Extract<LogEntryInput, { kind: 'http' }> => l.kind === 'http')
      expect(http.some((e) => e.url === `${AS}/token`)).toBe(true)
      const authorizedLog = http.filter((e) => e.url === MCP_URL && Object.keys(e.requestHeaders).some((n) => n.toLowerCase() === 'authorization'))
      expect(authorizedLog.length).toBeGreaterThan(0)
      for (const e of authorizedLog) expect(Object.entries(e.requestHeaders).find(([n]) => n.toLowerCase() === 'authorization')![1]).toBe('[redacted]')

      expectNoSecrets(h.logs, h.states)
    })

    it('a failing token exchange that echoes tokens in its JSON body is scrubbed from the error and the log', async () => {
      const net = fakeNetwork({
        // 400 whose JSON is NOT an OAuth error document: the SDK puts the raw body into its error message.
        tokenResponse: () =>
          new Response(JSON.stringify({ access_token: ACCESS, refresh_token: REFRESH, note: 'partial', client_secret: CLIENT_SECRET }), {
            status: 400,
            headers: { 'content-type': 'application/json' },
          }),
      })
      const h = harness(net, provider())
      expect((await h.session.connect()).status).toBe('auth-required')

      const error = await h.session.finishAuth(CODE).then(
        () => null,
        (e: Error) => e,
      )
      expect(error).not.toBeNull()
      expect(error!.message).toContain('Raw body') // the SDK really did include the body...
      for (const s of SECRETS) expect(error!.message).not.toContain(s) // ...and it was scrubbed
      expect(error!.message).toContain('[redacted]')
      expectNoSecrets(h.logs, h.states)
    })

    it('a 200 token response the SDK cannot parse (it then echoes the raw body in its error) is scrubbed', async () => {
      const net = fakeNetwork({
        // 200 + not a token document + a malformed `error` member: the SDK reports "Raw body: <the JSON>".
        tokenResponse: () => json({ access_token: ACCESS, refresh_token: REFRESH, error: 42 }),
      })
      const h = harness(net, provider())
      expect((await h.session.connect()).status).toBe('auth-required')
      const error = await h.session.finishAuth(CODE).then(
        () => null,
        (e: Error) => e,
      )
      expect(error!.message).toContain('Raw body')
      for (const s of SECRETS) expect(error!.message).not.toContain(s)
      const again = await h.session.connect()
      expect(again.status === 'auth-required' || again.status === 'error').toBe(true)
      expectNoSecrets(h.logs, [...h.states, again])
    })
    it('a rejected registration that echoes the client secret is scrubbed', async () => {
      const net = fakeNetwork({
        registerResponse: () => new Response(JSON.stringify({ error: 'invalid_redirect_uri', client_secret: CLIENT_SECRET }), { status: 400, headers: { 'content-type': 'application/json' } }),
      })
      const h = harness(net, provider())
      const state = await h.session.connect()
      expect(state.status).toBe('error')
      expectNoSecrets(h.logs, [...h.states, state])
    })

    it('tokens saved or read by the provider are learned before they can appear in any message', async () => {
      const net = fakeNetwork()
      const p = provider()
      // Tokens stored by an earlier sign-in (or another tab). The SERVER, not the SDK, echoes them in an error body.
      await p.saveTokens({ access_token: ACCESS, refresh_token: REFRESH, token_type: 'Bearer' })
      const logs: LogEntryInput[] = []
      const states: SessionState[] = []
      const watched = createSession({
        config,
        onLog: (e) => logs.push(e),
        onState: (s) => states.push(s),
        authProvider: p,
        fetchImpl: (async (input: RequestInfo | URL, init?: RequestInit) => {
          const res = await net.fetchImpl(input, init)
          if (init?.method === 'POST' && String(input) === MCP_URL) {
            return new Response(`gateway error, bad bearer ${ACCESS} / ${REFRESH}`, { status: 502 })
          }
          return res
        }) as typeof fetch,
        transportFactory: (_kind, ctx) =>
          new StreamableHTTPClientTransport(ctx.url, { fetch: ctx.fetch, requestInit: { headers: ctx.headers }, authProvider: ctx.authProvider }),
      })
      const final = await watched.connect()
      expect(final.status).toBe('error')
      if (final.status === 'error') expect(final.diagnosis.detail).toContain('[redacted]')
      expectNoSecrets(logs, states)
    })
  })
})
