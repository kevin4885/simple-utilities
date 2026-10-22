// Shared, SDK-free pieces of the OAuth flow. The `/oauth/callback` route imports ONLY this module
// (and secrets.ts), so the tiny callback chunk never drags the MCP SDK in. This file must import
// nothing, and nothing it is used with may import the SDK (auth/callback.test.ts enforces it).

export const OAUTH_CHANNEL = 'su-mcp-oauth'

export type OAuthCallbackMessage = {
  type: 'mcp-oauth-callback'
  state: string | null
  code: string | null
  error: string | null
  errorDescription: string | null
}

export const OAUTH_CALLBACK_PATH = '/oauth/callback'
export const TOOL_PATH = '/tools/mcp-inspector'

/** Session-only marker for the full-page fallback: `{profileId}` before the redirect, `{profileId, code, state}` after. */
export const PENDING_RETURN_KEY = 'oauth:pending-return'

export type OAuthSecretKind = 'tokens' | 'client' | 'verifier' | 'state' | 'discovery'

/** secrets.ts key for one piece of a profile's OAuth state: `oauth:<profileId>:<kind>`. */
export function oauthSecretKey(profileId: string, kind: OAuthSecretKind): string {
  return `oauth:${profileId}:${kind}`
}

export interface CallbackParams {
  code: string | null
  state: string | null
  error: string | null
  errorDescription: string | null
}

/** Reads the authorization response from a query string (`?code=…&state=…` or `?error=…`). Missing/empty -> null. */
export function parseCallbackParams(search: string): CallbackParams {
  const params = new URLSearchParams(search)
  const get = (name: string) => params.get(name) || null
  return {
    code: get('code'),
    state: get('state'),
    error: get('error'),
    errorDescription: get('error_description'),
  }
}

/** True only when both values are non-empty and equal. */
export function validateState(expected: string | null | undefined, got: string | null | undefined): boolean {
  if (!expected || !got) return false
  return expected === got
}

export function toCallbackMessage(params: CallbackParams): OAuthCallbackMessage {
  return {
    type: 'mcp-oauth-callback',
    state: params.state,
    code: params.code,
    error: params.error,
    errorDescription: params.errorDescription,
  }
}

function nullableString(v: unknown): boolean {
  return v === null || typeof v === 'string'
}

/** Runtime guard for data received on the channel (any same-origin script can post to it). */
export function isOAuthCallbackMessage(data: unknown): data is OAuthCallbackMessage {
  if (typeof data !== 'object' || data === null) return false
  const m = data as Record<string, unknown>
  return (
    m.type === 'mcp-oauth-callback' &&
    nullableString(m.state) &&
    nullableString(m.code) &&
    nullableString(m.error) &&
    nullableString(m.errorDescription)
  )
}
