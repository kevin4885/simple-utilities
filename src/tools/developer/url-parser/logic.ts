/**
 * URL Parser / Encoder — pure logic (no React, no side-effects)
 *
 * Exports:
 *   parseUrl            — parse a URL string into structured parts (lenient: auto-adds https://)
 *   paramsToRows        — URLSearchParams → editable row array
 *   rowsToSearchString  — editable row array → serialised query string (no leading "?")
 *   rebuildUrl          — reconstruct full URL from ParsedUrl + row edits
 *   safeEncode          — encodeURIComponent / encodeURI wrappers
 *   safeDecode          — decodeURIComponent / decodeURI wrappers with URIError handling
 */

// ── Types ─────────────────────────────────────────────────────────────────────

/** All parts extracted from a successfully parsed URL. */
export interface ParsedUrl {
  /** The raw input string that was parsed (after any normalisation). */
  href: string
  /** Protocol including trailing colon, e.g. "https:". */
  protocol: string
  /** Username, decoded. Empty string if absent. */
  username: string
  /** Password, decoded. Empty string if absent. */
  password: string
  /** Hostname only (no port), e.g. "example.com". */
  hostname: string
  /** Port string, e.g. "8080". Empty string if absent / default. */
  port: string
  /** host = hostname + (port ? ":port" : ""). */
  host: string
  /** Pathname, e.g. "/path/to/resource". */
  pathname: string
  /** Full search string including leading "?", or empty string. */
  search: string
  /** Fragment including leading "#", or empty string. */
  hash: string
}

/** One editable row in the query-params table. */
export interface ParamRow {
  /** Stable unique key for React rendering. Not the URL param key. */
  id: string
  /** URL parameter name (decoded). */
  key: string
  /** URL parameter value (decoded). May be empty string. */
  value: string
}

export type ParseUrlResult =
  | { ok: true; parsed: ParsedUrl; addedProtocol: boolean }
  | { ok: false; error: string }

export type EncodeDecodeResult =
  | { ok: true; output: string }
  | { ok: false; error: string }

/** Supported encode/decode modes. */
export type EncodeDecodeMode =
  | 'encodeURIComponent'
  | 'decodeURIComponent'
  | 'encodeURI'
  | 'decodeURI'

// ── ID counter ────────────────────────────────────────────────────────────────

let _idCounter = 0
function nextId(): string {
  return `row-${++_idCounter}`
}

// ── parseUrl ──────────────────────────────────────────────────────────────────

/**
 * Parse a URL string into structured parts using the native URL API.
 *
 * Leniency:
 *   - If the input has no recognisable protocol (no "://"), we prepend "https://"
 *     and set `addedProtocol: true` in the result so the UI can show a note.
 *   - Leading/trailing whitespace is trimmed.
 *
 * Returns `{ ok: false, error }` for genuinely invalid URLs (e.g. missing host
 * after protocol, invalid characters in host, etc.).
 */
export function parseUrl(input: string): ParseUrlResult {
  const trimmed = input.trim()
  if (!trimmed) {
    return { ok: false, error: 'Enter a URL to parse.' }
  }

  // Determine whether we need to add a protocol
  const hasProtocol = /^[a-zA-Z][a-zA-Z0-9+\-.]*:\/\//i.test(trimmed)
  const urlString = hasProtocol ? trimmed : `https://${trimmed}`
  const addedProtocol = !hasProtocol

  let url: URL
  try {
    url = new URL(urlString)
  } catch {
    return {
      ok: false,
      error: addedProtocol
        ? `Could not parse as a URL (tried https://${trimmed}).`
        : 'Invalid URL — check for typos in the host or path.',
    }
  }

  // Decode username/password for display (URL API gives percent-encoded values)
  let username = ''
  let password = ''
  try {
    username = url.username ? decodeURIComponent(url.username) : ''
  } catch {
    username = url.username
  }
  try {
    password = url.password ? decodeURIComponent(url.password) : ''
  } catch {
    password = url.password
  }

  return {
    ok: true,
    addedProtocol,
    parsed: {
      href: url.href,
      protocol: url.protocol,
      username,
      password,
      hostname: url.hostname,
      port: url.port,
      host: url.host,
      pathname: url.pathname,
      search: url.search,
      hash: url.hash,
    },
  }
}

// ── paramsToRows ──────────────────────────────────────────────────────────────

/**
 * Convert a URL search string (e.g. "?q=hello&lang=en") into an array of
 * editable ParamRow objects.
 *
 * Handles repeated keys (each occurrence becomes its own row).
 * Handles empty values and keys.
 * The `search` argument may include a leading "?" or not.
 */
export function paramsToRows(search: string): ParamRow[] {
  const params = new URLSearchParams(search)
  const rows: ParamRow[] = []
  for (const [key, value] of params.entries()) {
    rows.push({ id: nextId(), key, value })
  }
  return rows
}

// ── rowsToSearchString ────────────────────────────────────────────────────────

/**
 * Serialise an array of ParamRow objects back to a query string.
 *
 * Returns the string WITHOUT a leading "?", e.g. "q=hello&lang=en".
 * Empty-key rows are included as-is (URLSearchParams handles them).
 * Returns an empty string when there are no rows (or all rows are empty).
 */
export function rowsToSearchString(rows: ParamRow[]): string {
  const params = new URLSearchParams()
  for (const row of rows) {
    // Include rows that have at least a non-empty key
    if (row.key !== '') {
      params.append(row.key, row.value)
    }
  }
  return params.toString()
}

// ── rebuildUrl ────────────────────────────────────────────────────────────────

/**
 * Reconstruct the full URL from a parsed base and an (possibly edited)
 * array of param rows.
 *
 * Replaces the query string of `parsed.href` with the serialised rows.
 * Returns the full URL string, or the original href if reconstruction fails.
 */
export function rebuildUrl(parsed: ParsedUrl, rows: ParamRow[]): string {
  try {
    const url = new URL(parsed.href)
    const qs = rowsToSearchString(rows)
    url.search = qs ? `?${qs}` : ''
    return url.href
  } catch {
    return parsed.href
  }
}

// ── safeEncode ────────────────────────────────────────────────────────────────

/**
 * Encode `input` using the given mode.
 *
 * Both encodeURIComponent and encodeURI are pure and never throw for valid
 * strings, so this always returns `{ ok: true }`.
 */
export function safeEncode(
  input: string,
  mode: 'encodeURIComponent' | 'encodeURI',
): EncodeDecodeResult {
  if (!input) return { ok: true, output: '' }
  try {
    const output = mode === 'encodeURIComponent' ? encodeURIComponent(input) : encodeURI(input)
    return { ok: true, output }
  } catch (e) {
    // Theoretically unreachable for normal strings; guard anyway
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

// ── safeDecode ────────────────────────────────────────────────────────────────

/**
 * Decode `input` using the given mode.
 *
 * Catches URIError for malformed percent-sequences and returns a friendly
 * error message rather than throwing.
 */
export function safeDecode(
  input: string,
  mode: 'decodeURIComponent' | 'decodeURI',
): EncodeDecodeResult {
  if (!input) return { ok: true, output: '' }
  try {
    const output = mode === 'decodeURIComponent' ? decodeURIComponent(input) : decodeURI(input)
    return { ok: true, output }
  } catch (e) {
    if (e instanceof URIError) {
      return {
        ok: false,
        error: `Malformed percent-encoding: ${e.message}`,
      }
    }
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

// ── applyEncodeDecodeMode ─────────────────────────────────────────────────────

/**
 * Dispatch to safeEncode / safeDecode based on the selected mode.
 */
export function applyEncodeDecodeMode(
  input: string,
  mode: EncodeDecodeMode,
): EncodeDecodeResult {
  switch (mode) {
    case 'encodeURIComponent':
      return safeEncode(input, 'encodeURIComponent')
    case 'encodeURI':
      return safeEncode(input, 'encodeURI')
    case 'decodeURIComponent':
      return safeDecode(input, 'decodeURIComponent')
    case 'decodeURI':
      return safeDecode(input, 'decodeURI')
  }
}
