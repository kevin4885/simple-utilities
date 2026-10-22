import {
  OAuthClientFlowError,
  OAuthError,
  ProtocolError,
  SdkError,
  SdkErrorCode,
  SdkHttpError,
  SseError,
  UnauthorizedError,
} from '@modelcontextprotocol/client'
import type { Diagnosis } from './types'

// Pure helpers for the connection layer: URL validation, header redaction,
// error classification and pagination. No React, no IO, no module state.

export const REDACTED = '[redacted]'

// ---------------------------------------------------------------------------
// URL validation
// ---------------------------------------------------------------------------

export type UrlCheck = { ok: true; url: string } | { ok: false; reason: string }

export function validateServerUrl(text: string): UrlCheck {
  const trimmed = text.trim()
  if (!trimmed) return { ok: false, reason: 'Enter the server URL.' }
  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    return { ok: false, reason: 'Not a valid URL. Include the scheme, e.g. https://example.com/mcp.' }
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, reason: `Only http: and https: URLs are supported (got ${parsed.protocol}).` }
  }
  if (parsed.username || parsed.password) {
    return {
      ok: false,
      reason: 'URLs with embedded credentials are not allowed. Send credentials in a request header instead.',
    }
  }
  if (!parsed.hostname) return { ok: false, reason: 'The URL has no host.' }
  return { ok: true, url: parsed.href }
}

/** True for hosts a browser treats as potentially trustworthy (loopback). */
export function isLoopbackHost(host: string): boolean {
  let h = host.trim().toLowerCase()
  if (h.endsWith('.')) h = h.slice(0, -1)
  if (h.startsWith('[') && h.endsWith(']')) h = h.slice(1, -1)
  if (h === 'localhost' || h.endsWith('.localhost')) return true
  if (h === '::1') return true
  const m = /^127\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h)
  return m !== null && m.slice(1).every((octet) => Number(octet) <= 255)
}

/** An https: page cannot call a plain http: server unless it is loopback. */
export function mixedContentRisk(o: { pageProtocol: string; url: string }): boolean {
  if (o.pageProtocol !== 'https:') return false
  let parsed: URL
  try {
    parsed = new URL(o.url)
  } catch {
    return false
  }
  return parsed.protocol === 'http:' && !isLoopbackHost(parsed.hostname)
}

// ---------------------------------------------------------------------------
// Redaction
// ---------------------------------------------------------------------------

const SECRET_EXACT = new Set(['authorization', 'proxy-authorization', 'cookie', 'set-cookie'])
const SECRET_PATTERN = /(token|secret|key|password|auth)/i

export function isSecretHeaderName(name: string): boolean {
  const n = name.trim().toLowerCase()
  return SECRET_EXACT.has(n) || SECRET_PATTERN.test(n)
}

/** Returns a copy with secret values replaced by `[redacted]`; keeps header-name casing; never mutates. */
export function redactHeaders(headers: Record<string, string>, extraSecretNames: string[] = []): Record<string, string> {
  const extra = new Set(extraSecretNames.map((n) => n.trim().toLowerCase()))
  const out: Record<string, string> = {}
  for (const [name, value] of Object.entries(headers)) {
    out[name] = isSecretHeaderName(name) || extra.has(name.trim().toLowerCase()) ? REDACTED : value
  }
  return out
}

/** Redacts values of secret-looking query parameters (e.g. `?api_key=...`) so URLs are safe to log. */
export function redactUrl(url: string): string {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return url
  }
  let changed = false
  for (const name of new Set(parsed.searchParams.keys())) {
    if (isSecretHeaderName(name)) {
      parsed.searchParams.set(name, REDACTED)
      changed = true
    }
  }
  if (parsed.username || parsed.password) {
    parsed.username = ''
    parsed.password = ''
    changed = true
  }
  return changed ? parsed.href : url
}

const MIN_SCRUB_LENGTH = 4

/**
 * Literal secret strings (the full header value plus the token after a scheme word like `Bearer`).
 * With `all` every header counts; otherwise only headers whose NAME looks secret.
 */
export function secretFragments(headers: { name: string; value: string }[], all = false): string[] {
  const out = new Set<string>()
  for (const { name, value } of headers) {
    if (!all && !isSecretHeaderName(name)) continue
    const v = value.trim()
    if (v.length >= MIN_SCRUB_LENGTH) out.add(v)
    const scheme = /^(?:bearer|basic|token|digest)\s+(.+)$/i.exec(v)
    if (scheme && scheme[1].length >= MIN_SCRUB_LENGTH) out.add(scheme[1])
  }
  return [...out]
}

/** Replaces every occurrence of a known secret string; used on free text built from error messages. */
export function scrubSecrets(text: string, fragments: string[]): string {
  let out = text
  for (const f of fragments) out = out.split(f).join(REDACTED)
  return out
}

// ---------------------------------------------------------------------------
// Error classification
// ---------------------------------------------------------------------------

export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message || e.name
  if (typeof e === 'string') return e
  try {
    return JSON.stringify(e) ?? String(e)
  } catch {
    return String(e)
  }
}

function causeChain(error: unknown): unknown[] {
  const chain: unknown[] = []
  let cur: unknown = error
  for (let i = 0; i < 6 && cur !== undefined && cur !== null; i++) {
    chain.push(cur)
    cur = typeof cur === 'object' ? (cur as { cause?: unknown }).cause : undefined
  }
  return chain
}

export function isUnauthorizedError(error: unknown): boolean {
  return causeChain(error).some(
    (e) => e instanceof UnauthorizedError || (e instanceof Error && e.name === 'UnauthorizedError'),
  )
}

/** HTTP status carried by an SDK error (SdkHttpError, SSE error, or `HTTP 5xx` in a transport message). */
export function getHttpStatus(error: unknown): number | null {
  for (const [depth, e] of causeChain(error).entries()) {
    if (e instanceof SdkHttpError && typeof e.data?.status === 'number') return e.data.status
    if (e instanceof SseError && typeof e.code === 'number' && e.code >= 100 && e.code <= 599) return e.code
    // Only the transport's own top-level error is parsed from text: OAuth errors (e.g. a rejected dynamic
    // client registration, "(HTTP 400)") also carry "(HTTP nnn)" but are not an MCP endpoint status.
    if (depth === 0 && e instanceof Error && !(e instanceof OAuthError) && !(e instanceof OAuthClientFlowError)) {
      const m = /\(HTTP (\d{3})\)/.exec(e.message)
      if (m) return Number(m[1])
    }
  }
  return null
}

function isAbortLike(e: unknown): boolean {
  if (e instanceof SdkError && e.code === SdkErrorCode.RequestTimeout) return true
  // DOMException is not always an Error subclass (jsdom), so go by the name.
  const name = typeof e === 'object' && e !== null ? (e as { name?: unknown }).name : undefined
  return name === 'AbortError' || name === 'TimeoutError'
}

const NETWORK_TYPE_ERROR = /failed to fetch|networkerror|load failed|network request failed|fetch failed/i

function isNetworkFailure(error: unknown): boolean {
  return causeChain(error).some((e) => e instanceof TypeError && NETWORK_TYPE_ERROR.test(e.message))
}

export interface ClassifyContext {
  url: string
  pageProtocol: string
  /** Session id in use when the failing request was made (drives `session-expired`). */
  sessionId?: string | null
}

export function classifyConnectionError(error: unknown, ctx: ClassifyContext): Diagnosis {
  const message = errorMessage(error)
  const status = getHttpStatus(error)

  if (isNetworkFailure(error)) {
    if (mixedContentRisk({ pageProtocol: ctx.pageProtocol, url: ctx.url })) {
      return {
        code: 'mixed-content',
        title: 'Blocked: https page calling an http server',
        detail: `This page is served over https, but the server URL is plain http (${ctx.url}). The browser blocks that request before it is sent. Original error: ${message}`,
        hints: [
          'Use an https:// URL for the server (for example behind a TLS proxy or tunnel).',
          'http://localhost and http://127.0.0.1 are allowed from an https page; remote http hosts are not.',
          'Alternatively open this tool from a page served over http (for example the local dev server).',
        ],
        httpStatus: null,
      }
    }
    return {
      code: 'cors-or-network',
      title: 'Could not reach the server (CORS or network)',
      detail: `The browser could not complete the request to ${ctx.url}. It reports this opaque error for CORS failures, DNS errors, refused connections and TLS problems alike. Original error: ${message}`,
      hints: [
        'Check the URL, that the server is running, and that you are online.',
        'The server must answer CORS preflight requests and send Access-Control-Allow-Origin for this site (or *).',
        'Access-Control-Allow-Headers must include Content-Type, Accept, Authorization, Mcp-Session-Id and MCP-Protocol-Version (plus any custom header you added).',
        'Access-Control-Expose-Headers must include Mcp-Session-Id, otherwise the session id is hidden from the browser.',
        'Open the browser developer console (Network tab) for the exact CORS message.',
        'For http://localhost targets, Chrome may also need Access-Control-Allow-Private-Network: true on the preflight response.',
        'Servers that only speak stdio cannot be reached from a browser; bridge them to HTTP with an external tool.',
      ],
      httpStatus: null,
    }
  }

  if (isUnauthorizedError(error) || status === 401) {
    return {
      code: 'unauthorized',
      title: 'Unauthorized (401)',
      detail: `The server rejected the credentials. Original error: ${message}`,
      hints: [
        'Add or correct an Authorization header (for example Bearer <token>) in the profile.',
        'Or switch the profile to OAuth if the server supports MCP authorization.',
      ],
      httpStatus: 401,
    }
  }
  if (status === 403) {
    return {
      code: 'forbidden',
      title: 'Forbidden (403)',
      detail: `The server understood the request but refused it. Original error: ${message}`,
      hints: [
        'The credentials may be valid but lack permission or scope for this server.',
        'Check the server access policy and, for OAuth, the requested scope.',
      ],
      httpStatus: 403,
    }
  }
  if (status === 404 && ctx.sessionId) {
    return {
      code: 'session-expired',
      title: 'Session expired (404)',
      detail: `The server no longer recognises the session id. Original error: ${message}`,
      hints: ['Disconnect and connect again to start a new session.'],
      httpStatus: 404,
    }
  }
  if (status !== null) {
    return {
      code: 'http-status',
      title: `Server responded with HTTP ${status}`,
      detail: `The server answered with an HTTP error. Original error: ${message}`,
      hints:
        status === 404 || status === 405
          ? ['Check the URL path: this does not look like an MCP endpoint.', 'Legacy servers use an SSE endpoint; try the Legacy SSE transport.']
          : status >= 500
            ? ['The server failed internally; check its logs and retry.']
            : [],
      httpStatus: status,
    }
  }

  if (isAbortLike(error)) {
    return {
      code: 'timeout',
      title: 'Timed out',
      detail: `The server did not answer in time. Original error: ${message}`,
      hints: ['Check that the server is reachable and responsive, then retry.'],
      httpStatus: null,
    }
  }

  if (error instanceof ProtocolError) {
    return {
      code: 'protocol',
      title: `Server returned a protocol error (${error.code})`,
      detail: `The server answered with a JSON-RPC error. Original error: ${message}`,
      hints: ['The URL may not be an MCP endpoint, or the server rejected the initialize handshake.'],
      httpStatus: null,
    }
  }

  return {
    code: 'unknown',
    title: 'Connection failed',
    detail: `Original error: ${message}`,
    hints: [],
    httpStatus: null,
  }
}

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------

export interface CollectedPages<T> {
  items: T[]
  truncated: boolean
  reason: 'max-pages' | 'cursor-loop' | null
  error: string | null
}

export const DEFAULT_MAX_PAGES = 50

/** Follows `nextCursor` until exhausted. Never throws: a failing page ends the walk with `error` set. */
export async function collectPages<T>(
  fetchPage: (cursor: string | undefined) => Promise<{ items: T[]; nextCursor?: string }>,
  o: { maxPages?: number } = {},
): Promise<CollectedPages<T>> {
  const maxPages = o.maxPages ?? DEFAULT_MAX_PAGES
  const items: T[] = []
  const seen = new Set<string>()
  let cursor: string | undefined
  let pages = 0
  for (;;) {
    if (pages >= maxPages) return { items, truncated: true, reason: 'max-pages', error: null }
    let page: { items: T[]; nextCursor?: string }
    try {
      page = await fetchPage(cursor)
    } catch (e) {
      return { items, truncated: false, reason: null, error: errorMessage(e) }
    }
    pages++
    items.push(...page.items)
    const next = page.nextCursor
    if (next === undefined || next === null || next === '') return { items, truncated: false, reason: null, error: null }
    if (seen.has(next)) return { items, truncated: true, reason: 'cursor-loop', error: null }
    seen.add(next)
    cursor = next
  }
}
