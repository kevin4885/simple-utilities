/**
 * Base64 Encoder / Decoder — pure logic (no React, no side-effects)
 *
 * Unicode-safe: uses TextEncoder / TextDecoder (UTF-8) rather than bare btoa/atob.
 * Supports both standard Base64 (RFC 4648 §4) and Base64URL (RFC 4648 §5).
 */

// ── Types ─────────────────────────────────────────────────────────────────────

/** Which Base64 alphabet to use. */
export type Base64Variant = 'standard' | 'url'

export interface EncodeResult {
  ok: true
  output: string
}

export interface DecodeResult {
  ok: true
  output: string
}

export interface ErrorResult {
  ok: false
  error: string
}

export type Base64EncodeResult = EncodeResult | ErrorResult
export type Base64DecodeResult = DecodeResult | ErrorResult

// ── Alphabet helpers ──────────────────────────────────────────────────────────

/**
 * Convert a standard Base64 string to Base64URL:
 *   + → -   / → _   strip trailing =
 */
function toBase64Url(b64: string): string {
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/**
 * Convert a Base64URL string to standard Base64 (add padding, swap alphabet).
 */
function fromBase64Url(b64url: string): string {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/')
  // Re-add missing padding
  const pad = (4 - (b64.length % 4)) % 4
  return b64 + '='.repeat(pad)
}

// ── Encode ────────────────────────────────────────────────────────────────────

/**
 * Encode a plain-text string (any Unicode) to Base64 / Base64URL.
 *
 * Process:
 *   1. Encode the string as UTF-8 bytes via TextEncoder.
 *   2. Turn the byte array into a binary string character-by-character.
 *   3. Apply btoa() to get standard Base64.
 *   4. Convert to Base64URL alphabet if requested.
 */
export function encodeBase64(input: string, variant: Base64Variant = 'standard'): Base64EncodeResult {
  try {
    const bytes = new TextEncoder().encode(input)
    let binary = ''
    // Build binary string from typed array
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i])
    }
    const b64 = btoa(binary)
    const output = variant === 'url' ? toBase64Url(b64) : b64
    return { ok: true, output }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

// ── Decode ────────────────────────────────────────────────────────────────────

/** Characters that are invalid in standard Base64 (ignoring whitespace and padding). */
const INVALID_STD_RE = /[^A-Za-z0-9+/=\s]/
/** Characters that are invalid in Base64URL (ignoring whitespace). */
const INVALID_URL_RE = /[^A-Za-z0-9\-_=\s]/

/**
 * Validate a Base64 string without decoding.
 * Returns a user-friendly error string, or null if valid.
 */
export function validateBase64(input: string, variant: Base64Variant): string | null {
  const stripped = input.replace(/\s/g, '')
  if (stripped === '') return 'Input is empty'

  if (variant === 'standard') {
    if (INVALID_STD_RE.test(stripped)) {
      const badChar = stripped.match(INVALID_STD_RE)?.[0] ?? '?'
      return `Invalid character "${badChar}" for standard Base64. Standard Base64 uses A–Z, a–z, 0–9, +, /, and = for padding.`
    }
    // Padding must be 0–2 trailing = chars; length (after adding padding) must be divisible by 4
    const noPad = stripped.replace(/=+$/, '')
    const trailingEq = stripped.length - noPad.length
    if (trailingEq > 2) {
      return `Too many padding characters (${trailingEq} "=" found; maximum is 2).`
    }
    if ((noPad.length + trailingEq) % 4 !== 0) {
      // atob will catch this, but give a friendlier message
      return `Invalid Base64 length — the encoded string length (excluding padding) must be a multiple of 4 when padded.`
    }
  } else {
    if (INVALID_URL_RE.test(stripped)) {
      const badChar = stripped.match(INVALID_URL_RE)?.[0] ?? '?'
      return `Invalid character "${badChar}" for Base64URL. Base64URL uses A–Z, a–z, 0–9, -, and _.`
    }
  }

  return null
}

/**
 * Decode a Base64 / Base64URL string to a UTF-8 text string.
 *
 * Returns a friendly error for:
 *   - Invalid characters (wrong alphabet)
 *   - Invalid length / padding
 *   - Bytes that aren't valid UTF-8
 */
export function decodeBase64(input: string, variant: Base64Variant = 'standard'): Base64DecodeResult {
  // Strip all whitespace so multi-line pastes work
  const stripped = input.replace(/\s/g, '')

  if (stripped === '') {
    return { ok: false, error: 'Input is empty.' }
  }

  // Validate before attempting decode (gives friendlier errors)
  const validationError = validateBase64(stripped, variant)
  if (validationError) {
    return { ok: false, error: validationError }
  }

  try {
    // Normalise to standard Base64 (with padding) before atob
    const b64 = variant === 'url' ? fromBase64Url(stripped) : stripped
    const binary = atob(b64)

    // Convert binary string to Uint8Array
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i)
    }

    // Decode as UTF-8 (fatal=true throws on invalid byte sequences)
    const output = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    return { ok: true, output }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    // atob itself throws on bad chars (should be caught by validator above, but be safe).
    // TextDecoder with fatal:true throws a TypeError for invalid UTF-8 byte sequences.
    // We distinguish the two cases by checking for common patterns in the error message.
    const isUtf8Error =
      msg.includes('UTF') ||
      msg.includes('utf') ||
      msg.toLowerCase().includes('encoding') ||
      msg.toLowerCase().includes('invalid byte sequence') ||
      // jsdom / Node: TypeError with empty message or "Failed to execute 'decode'"
      (e instanceof TypeError && !msg.toLowerCase().includes('base64'))
    if (isUtf8Error) {
      return {
        ok: false,
        error:
          'The Base64 data decodes to bytes that are not valid UTF-8 text. ' +
          'If this is binary data (an image, PDF, etc.), it cannot be displayed as text.',
      }
    }
    return {
      ok: false,
      error: `Could not decode: ${msg}`,
    }
  }
}

// ── File → data URI ───────────────────────────────────────────────────────────

/**
 * Build a data URI from a file's bytes and MIME type.
 * `bytes` is the raw binary as a Uint8Array (already read via FileReader).
 */
export function bytesToDataUri(bytes: Uint8Array, mimeType: string): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return `data:${mimeType};base64,${btoa(binary)}`
}

/**
 * Format a byte count as a human-readable string (B / KB / MB / GB).
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

/**
 * Estimate how many Base64 characters a given byte count will produce
 * (ceil(bytes / 3) * 4 with standard padding).
 */
export function estimateBase64Size(byteCount: number): number {
  return Math.ceil(byteCount / 3) * 4
}
