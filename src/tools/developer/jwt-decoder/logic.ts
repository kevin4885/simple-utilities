/**
 * JWT Decoder — pure logic (no React, no side-effects)
 *
 * Client-side only. Never sends the token anywhere.
 * Base64url decoding handles missing padding, - and _ characters, UTF-8 payloads.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export interface JwtDecodeSuccess {
  ok: true
  header: Record<string, unknown>
  payload: Record<string, unknown>
  /** Raw base64url-encoded signature (third segment, as-is) */
  signature: string
  /** Formatted header JSON */
  headerJson: string
  /** Formatted payload JSON */
  payloadJson: string
}

export interface JwtDecodeError {
  ok: false
  error: string
}

export type JwtDecodeResult = JwtDecodeSuccess | JwtDecodeError

// ── Claim types for formatting ────────────────────────────────────────────────

export interface ClaimInfo {
  key: string
  rawValue: unknown
  /** Human-readable formatted value (date string for timestamps, etc.) */
  formatted?: string
  /** true when exp is in the past */
  expired?: boolean
}

// ── Base64url decode ──────────────────────────────────────────────────────────

/**
 * Decode a base64url string to a Uint8Array.
 * Handles missing padding (= chars) and base64url alphabet (- → +, _ → /).
 */
export function base64urlToBytes(input: string): Uint8Array {
  // Convert base64url to standard base64
  const b64 = input.replace(/-/g, '+').replace(/_/g, '/')
  // Add padding if needed
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4)
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

/**
 * Decode a base64url segment to a UTF-8 string.
 * Throws if the input is not valid base64url or the bytes aren't valid UTF-8.
 */
export function base64urlDecode(input: string): string {
  const bytes = base64urlToBytes(input)
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
}

// ── decodeJwt ─────────────────────────────────────────────────────────────────

/**
 * Decode a JWT token (header.payload.signature) without verifying the signature.
 *
 * Returns a structured error for:
 *   - Wrong number of segments (must be exactly 3)
 *   - Invalid base64url in header or payload
 *   - Non-JSON content in header or payload
 */
export function decodeJwt(token: string): JwtDecodeResult {
  const trimmed = token.trim()
  if (!trimmed) {
    return { ok: false, error: 'Token is empty' }
  }

  const parts = trimmed.split('.')
  if (parts.length !== 3) {
    return {
      ok: false,
      error: `A JWT must have exactly 3 segments separated by dots; found ${parts.length}.`,
    }
  }

  const [headerB64, payloadB64, signature] = parts

  // Decode header
  let headerStr: string
  try {
    headerStr = base64urlDecode(headerB64)
  } catch {
    return { ok: false, error: 'Header segment is not valid base64url.' }
  }

  let header: Record<string, unknown>
  try {
    const parsed = JSON.parse(headerStr) as unknown
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return { ok: false, error: 'Header is not a JSON object.' }
    }
    header = parsed as Record<string, unknown>
  } catch {
    return { ok: false, error: `Header is not valid JSON: ${headerStr.slice(0, 80)}` }
  }

  // Decode payload
  let payloadStr: string
  try {
    payloadStr = base64urlDecode(payloadB64)
  } catch {
    return { ok: false, error: 'Payload segment is not valid base64url.' }
  }

  let payload: Record<string, unknown>
  try {
    const parsed = JSON.parse(payloadStr) as unknown
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return { ok: false, error: 'Payload is not a JSON object.' }
    }
    payload = parsed as Record<string, unknown>
  } catch {
    return { ok: false, error: `Payload is not valid JSON: ${payloadStr.slice(0, 80)}` }
  }

  return {
    ok: true,
    header,
    payload,
    signature,
    headerJson: JSON.stringify(header, null, 2),
    payloadJson: JSON.stringify(payload, null, 2),
  }
}

// ── Timestamp formatting ──────────────────────────────────────────────────────

/**
 * Format a Unix timestamp (seconds) as a locale-aware local date/time string.
 * Returns null if the value is not a number.
 */
export function formatTimestamp(value: unknown): string | null {
  if (typeof value !== 'number' || !isFinite(value)) return null
  const date = new Date(value * 1000)
  return date.toLocaleString(undefined, {
    year:   'numeric',
    month:  'short',
    day:    'numeric',
    hour:   '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZoneName: 'short',
  })
}

/**
 * Check whether an `exp` claim indicates the token is expired.
 * Returns true if exp (Unix seconds) is in the past.
 */
export function isExpired(exp: unknown, nowMs = Date.now()): boolean {
  if (typeof exp !== 'number' || !isFinite(exp)) return false
  return exp * 1000 < nowMs
}

// ── Standard-claim metadata ───────────────────────────────────────────────────

/** Set of standard JWT claims that hold Unix timestamps (seconds). */
export const TIMESTAMP_CLAIMS = new Set(['iat', 'exp', 'nbf', 'auth_time', 'updated_at'])

/**
 * Build a list of ClaimInfo objects from a payload, annotating timestamp
 * claims with a human-readable date string and flagging expired tokens.
 */
export function buildClaimInfos(
  payload: Record<string, unknown>,
  nowMs = Date.now(),
): ClaimInfo[] {
  return Object.entries(payload).map(([key, rawValue]) => {
    const info: ClaimInfo = { key, rawValue }
    if (TIMESTAMP_CLAIMS.has(key)) {
      const formatted = formatTimestamp(rawValue)
      if (formatted !== null) {
        info.formatted = formatted
      }
      if (key === 'exp') {
        info.expired = isExpired(rawValue, nowMs)
      }
    }
    return info
  })
}
