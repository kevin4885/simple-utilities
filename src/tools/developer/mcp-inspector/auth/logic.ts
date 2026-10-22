import {
  AuthorizationServerMismatchError,
  InsecureTokenEndpointError,
  InsufficientScopeError,
  IssuerMismatchError,
  OAuthError,
  RegistrationRejectedError,
  UnauthorizedError,
} from '@modelcontextprotocol/client'
import { classifyConnectionError, errorMessage } from '../connection/logic'
import type { Diagnosis } from '../connection/types'

// Pure helpers for the OAuth area: client metadata, random values, token status and error
// classification. No React, no storage. (The SDK-free callback helpers live in callback.ts.)

export const CLIENT_NAME = 'Simple Utilities MCP Inspector'

/** Fired on `window` whenever stored OAuth credentials change, so the sidebar status line can refresh. */
export const OAUTH_CREDENTIALS_EVENT = 'mcp-inspector:oauth-credentials'

export function oauthRedirectUrl(origin: string): string {
  return `${origin}/oauth/callback`
}

export interface ClientMetadataInput {
  redirectUrl: string
  /** Free text from the profile; blank means "let the server decide". */
  scope: string | null
}

export function buildClientMetadata({ redirectUrl, scope }: ClientMetadataInput) {
  const trimmed = scope?.trim()
  return {
    redirect_uris: [redirectUrl],
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
    client_name: CLIENT_NAME,
    ...(trimmed ? { scope: trimmed } : {}),
  }
}

type RandomFill = (bytes: Uint8Array) => Uint8Array

/** `byteLength` random bytes as unpadded base64url (32 bytes -> 43 chars, 256 bits). */
export function randomToken(byteLength = 32, fill: RandomFill = (b) => crypto.getRandomValues(b)): string {
  const bytes = fill(new Uint8Array(byteLength))
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export interface TokenStatus {
  signedIn: boolean
  /** Epoch ms when the access token expires; null when unknown (no `expires_in`, or no timestamp). */
  expiresAt: number | null
}

/** Reads the stored token JSON (see provider.ts) without ever exposing a token value. */
export function tokenStatus(storedJson: string | null): TokenStatus {
  const none: TokenStatus = { signedIn: false, expiresAt: null }
  if (!storedJson) return none
  try {
    const parsed: unknown = JSON.parse(storedJson)
    if (typeof parsed !== 'object' || parsed === null) return none
    const t = parsed as Record<string, unknown>
    if (typeof t.access_token !== 'string' || !t.access_token) return none
    const expiresIn = typeof t.expires_in === 'number' && Number.isFinite(t.expires_in) ? t.expires_in : null
    const obtainedAt = typeof t.obtained_at === 'number' && Number.isFinite(t.obtained_at) ? t.obtained_at : null
    return { signedIn: true, expiresAt: expiresIn !== null && obtainedAt !== null ? obtainedAt + expiresIn * 1000 : null }
  } catch {
    return none
  }
}

// ---------------------------------------------------------------------------
// Error classification
// ---------------------------------------------------------------------------

export type OAuthEndpointClass = 'discovery' | 'registration' | 'token' | 'authorization'

const ENDPOINT_LABEL: Record<OAuthEndpointClass, string> = {
  discovery: 'discovery (metadata)',
  registration: 'dynamic client registration',
  token: 'token',
  authorization: 'authorization',
}

const NETWORK_FAILURE = /failed to fetch|networkerror|load failed|network request failed|fetch failed/i

export interface OAuthErrorContext {
  /** Which kind of authorization-server request failed. */
  endpoint: OAuthEndpointClass
  /** The app origin the browser sends as `Origin` (what the authorization server must allow). */
  origin: string
  pageProtocol?: string
}

function isNetworkFailure(error: unknown): boolean {
  // Plain `Error`s count too: McpSession.finishAuth re-throws a sanitised Error that keeps only the message.
  return error instanceof Error && NETWORK_FAILURE.test(error.message)
}

function diagnosis(
  code: Diagnosis['code'],
  title: string,
  detail: string,
  hints: string[],
  httpStatus: number | null = null,
): Diagnosis {
  return { code, title, detail, hints, httpStatus }
}

/**
 * Turns an error from the OAuth leg of a connection into a Diagnosis. A browser cannot tell a CORS
 * block from a dead host, so an opaque network failure becomes a checklist naming which kind of
 * authorization-server request failed and what that server must send.
 */
export function classifyOAuthError(error: unknown, ctx: OAuthErrorContext): Diagnosis {
  const message = errorMessage(error)
  const label = ENDPOINT_LABEL[ctx.endpoint]

  if (isNetworkFailure(error)) {
    return diagnosis(
      'cors-or-network',
      `Could not reach the authorization server (${label} endpoint)`,
      `The browser could not complete the OAuth ${label} request. It reports CORS blocks, DNS errors, refused connections and TLS problems alike. Original error: ${message}`,
      [
        `The failing request was to the OAuth ${label} endpoint, which belongs to the authorization server (it can be a different host from the MCP server).`,
        `The authorization server must send Access-Control-Allow-Origin for ${ctx.origin} (or *) on its ${label} endpoint.`,
        ctx.endpoint === 'discovery'
          ? 'Its metadata documents (/.well-known/oauth-authorization-server, /.well-known/oauth-protected-resource) must be readable cross-origin.'
          : 'It must also answer the CORS preflight (OPTIONS) for POST requests that carry a Content-Type header.',
        'Open the browser developer console (Network tab) for the exact CORS message.',
      ],
    )
  }
  if (error instanceof InsecureTokenEndpointError) {
    return diagnosis('protocol', 'Insecure token endpoint refused', message, [
      'The token endpoint must use https (http is only accepted for localhost).',
      'Ask the authorization server operator to publish an https token_endpoint.',
    ])
  }
  if (error instanceof AuthorizationServerMismatchError || error instanceof IssuerMismatchError) {
    return diagnosis('protocol', 'Authorization server mismatch', message, [
      'The stored credentials or the authorization response belong to a different authorization server than the one now advertised.',
      'Use "Clear credentials" and sign in again.',
    ])
  }
  if (error instanceof InsufficientScopeError) {
    return diagnosis(
      'forbidden',
      'Insufficient scope (403)',
      message,
      ["Add the required scope to the profile's Scope field and sign in again."],
      403,
    )
  }
  if (error instanceof RegistrationRejectedError) {
    return diagnosis('protocol', 'Dynamic client registration rejected', message, [
      'The authorization server refused to register this client.',
      'If you have a pre-registered public client, enter its ID under "Pre-registered client ID" and register this redirect URI for it: <this origin>/oauth/callback.',
    ])
  }
  if (error instanceof OAuthError) {
    return diagnosis('protocol', `Authorization server error (${error.code})`, message, [
      'The authorization server rejected the request; the message above comes from it.',
    ])
  }
  if (error instanceof UnauthorizedError) {
    return diagnosis('unauthorized', 'Authorization failed', message, ['Sign in again.'], 401)
  }
  return classifyConnectionError(error, { url: ctx.origin, pageProtocol: ctx.pageProtocol ?? 'https:' })
}

/** Plain-text failure message for the connection UI: the CORS checklist for network failures, else the SDK message. */
export function authFailureMessage(error: unknown, ctx: OAuthErrorContext): string {
  const d = classifyOAuthError(error, ctx)
  if (d.code === 'cors-or-network') return `${d.title}. ${d.hints.slice(1, 3).join(' ')}`
  return errorMessage(error)
}
