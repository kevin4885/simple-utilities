/**
 * Unix Timestamp Converter — pure logic (no React, no side-effects)
 *
 * Exports:
 *   detectUnit        — auto-detect whether a numeric value is seconds, millis, or micros
 *   parseTimestamp    — convert a raw input string + unit to a Date (or error)
 *   formatRelative    — "3 hours ago" / "in 2 days" etc. with injectable `now`
 *   formatInTimeZone  — format a Date in a given IANA timezone via Intl.DateTimeFormat
 *   formatIso8601     — ISO 8601 string from a Date
 *   toEpochSeconds    — epoch seconds from a Date (integer)
 *   toEpochMillis     — epoch milliseconds from a Date (integer)
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export type TimestampUnit = 'seconds' | 'millis' | 'micros'

export interface ParsedTimestamp {
  date: Date
  /** The unit that was actually used for the parse. */
  unit: TimestampUnit
}

export type ParseTimestampResult =
  | { ok: true; parsed: ParsedTimestamp }
  | { ok: false; error: string }

export interface TimezoneDisplay {
  label: string
  tz: string
  formatted: string
}

// ── Unit detection boundaries ─────────────────────────────────────────────────

/**
 * Boundaries (absolute value) used to auto-detect the unit of a numeric timestamp.
 *
 * Logic:
 *   |v| < 1e10   → seconds   (up to ~year 2286, covers all practical current unix timestamps)
 *   |v| < 1e13   → millis    (up to ~year 2286 in ms — 1e13 ms ≈ year 2286)
 *   otherwise    → micros
 *
 * The boundaries are chosen so that a value like 1_700_000_000 (Nov 2023 in seconds)
 * is correctly identified as seconds, while 1_700_000_000_000 (same moment in ms)
 * is correctly identified as millis.
 */
const SECONDS_MAX_ABS = 1e10  // 10 digits
const MILLIS_MAX_ABS  = 1e13  // 13 digits

export function detectUnit(value: number): TimestampUnit {
  const abs = Math.abs(value)
  if (abs < SECONDS_MAX_ABS) return 'seconds'
  if (abs < MILLIS_MAX_ABS)  return 'millis'
  return 'micros'
}

// ── parseTimestamp ────────────────────────────────────────────────────────────

/**
 * Parse a raw input string into a Date using the given (or auto-detected) unit.
 *
 * Accepts:
 *   - Integer or float strings (floats are truncated to integer ms)
 *   - Negative values (pre-1970 dates)
 *
 * Rejects:
 *   - Empty / whitespace-only strings
 *   - Non-numeric strings
 *   - Values that produce an invalid Date (e.g. Infinity, NaN after overflow)
 *   - Dates outside the safe JS range (~±271,821 years from epoch)
 */
export function parseTimestamp(
  input: string,
  unit: TimestampUnit,
): ParseTimestampResult {
  const trimmed = input.trim()
  if (!trimmed) {
    return { ok: false, error: 'Enter a Unix timestamp to convert.' }
  }

  // Accept optional leading minus + digits + optional decimal part
  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) {
    return {
      ok: false,
      error: 'Invalid input — enter a numeric Unix timestamp (e.g. 1700000000).',
    }
  }

  const numeric = parseFloat(trimmed)

  if (!isFinite(numeric)) {
    return { ok: false, error: 'Value is out of range.' }
  }

  let ms: number
  switch (unit) {
    case 'seconds': ms = Math.trunc(numeric) * 1000;          break
    case 'millis':  ms = Math.trunc(numeric);                  break
    case 'micros':  ms = Math.trunc(numeric / 1000);           break
  }

  const date = new Date(ms)

  if (isNaN(date.getTime())) {
    return { ok: false, error: 'Timestamp is out of the valid date range.' }
  }

  // Guard against absurd dates that JS accepts but are unusable
  const year = date.getUTCFullYear()
  if (year < -100_000 || year > 100_000) {
    return { ok: false, error: 'Timestamp is too far in the past or future.' }
  }

  return { ok: true, parsed: { date, unit } }
}

// ── formatRelative ────────────────────────────────────────────────────────────

/**
 * Return a human-readable relative time string like "3 hours ago" or "in 2 days".
 *
 * Thresholds:
 *   < 5 s          → "just now"
 *   < 60 s         → "N seconds ago / in N seconds"
 *   < 60 min       → "N minutes ago / in N minutes"
 *   < 24 h         → "N hours ago / in N hours"
 *   < 30 days      → "N days ago / in N days"
 *   < 365 days     → "N months ago / in N months"
 *   ≥ 365 days     → "N years ago / in N years"
 *
 * Injectable `now` parameter for deterministic tests.
 */
export function formatRelative(date: Date, now: Date): string {
  const diffMs = date.getTime() - now.getTime()
  const abs = Math.abs(diffMs)
  const future = diffMs > 0

  function fmt(value: number, unit: string): string {
    const s = value === 1 ? unit : `${unit}s`
    return future ? `in ${value} ${s}` : `${value} ${s} ago`
  }

  const SECOND = 1000
  const MINUTE = 60 * SECOND
  const HOUR   = 60 * MINUTE
  const DAY    = 24 * HOUR
  const MONTH  = 30 * DAY
  const YEAR   = 365 * DAY

  if (abs < 5 * SECOND)  return 'just now'
  if (abs < MINUTE)      return fmt(Math.round(abs / SECOND), 'second')
  if (abs < HOUR)        return fmt(Math.round(abs / MINUTE), 'minute')
  if (abs < DAY)         return fmt(Math.round(abs / HOUR),   'hour')
  if (abs < MONTH)       return fmt(Math.round(abs / DAY),    'day')
  if (abs < YEAR)        return fmt(Math.round(abs / MONTH),  'month')
  return fmt(Math.round(abs / YEAR), 'year')
}

// ── formatInTimeZone ──────────────────────────────────────────────────────────

/**
 * Format `date` in the given IANA timezone using Intl.DateTimeFormat.
 * Returns a human-readable string like "Saturday, 18 Nov 2023, 15:30:00 UTC+0".
 *
 * Uses no external dependencies — only the native Intl API.
 */
export function formatInTimeZone(date: Date, timeZone: string): string {
  try {
    const fmt = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      weekday: 'short',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      timeZoneName: 'shortOffset',
      hour12: false,
    })
    return fmt.format(date)
  } catch {
    return 'Unsupported timezone'
  }
}

// ── formatLocalFull ───────────────────────────────────────────────────────────

/**
 * Format `date` in the user's local timezone with UTC offset.
 * e.g. "Saturday, 18 Nov 2023, 15:30:00 UTC+5:30"
 */
export function formatLocalFull(date: Date): string {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZoneName: 'shortOffset',
    hour12: false,
  })
  return fmt.format(date)
}

// ── formatUtcFull ─────────────────────────────────────────────────────────────

/**
 * Format `date` in UTC using a fixed-format string.
 * e.g. "2023-11-18 15:30:00 UTC"
 */
export function formatUtcFull(date: Date): string {
  const pad = (n: number, len = 2) => String(n).padStart(len, '0')
  const y   = date.getUTCFullYear()
  const mo  = pad(date.getUTCMonth() + 1)
  const d   = pad(date.getUTCDate())
  const h   = pad(date.getUTCHours())
  const min = pad(date.getUTCMinutes())
  const s   = pad(date.getUTCSeconds())
  return `${y}-${mo}-${d} ${h}:${min}:${s} UTC`
}

// ── formatIso8601 ─────────────────────────────────────────────────────────────

/**
 * Return the ISO 8601 representation of `date` (UTC, with trailing Z).
 * e.g. "2023-11-18T15:30:00.000Z"
 */
export function formatIso8601(date: Date): string {
  return date.toISOString()
}

// ── toEpochSeconds / toEpochMillis ────────────────────────────────────────────

/** Return the epoch seconds (integer, truncated) for a Date. */
export function toEpochSeconds(date: Date): number {
  return Math.trunc(date.getTime() / 1000)
}

/** Return the epoch milliseconds (integer) for a Date. */
export function toEpochMillis(date: Date): number {
  return date.getTime()
}

// ── WORLD_ZONES ───────────────────────────────────────────────────────────────

/**
 * Fixed list of timezone zones shown in the "World Clocks" section.
 * The user's local zone is appended dynamically in the UI.
 */
export const WORLD_ZONES: Array<{ label: string; tz: string }> = [
  { label: 'UTC',          tz: 'UTC' },
  { label: 'New York',     tz: 'America/New_York' },
  { label: 'London',       tz: 'Europe/London' },
  { label: 'Tokyo',        tz: 'Asia/Tokyo' },
]

// ── getTimezoneDisplays ───────────────────────────────────────────────────────

/**
 * Build an array of TimezoneDisplay entries for `date` in the fixed world zones
 * plus the user's local timezone (if not already in the list).
 *
 * `localTz` is injected (defaults to `Intl.DateTimeFormat().resolvedOptions().timeZone`)
 * so tests can pass a fixed value.
 */
export function getTimezoneDisplays(
  date: Date,
  localTz: string = Intl.DateTimeFormat().resolvedOptions().timeZone,
): TimezoneDisplay[] {
  const zones = [...WORLD_ZONES]

  // Append the local zone only if it's not already in the list
  const isLocalAlreadyListed = zones.some((z) => z.tz === localTz)
  if (!isLocalAlreadyListed) {
    zones.push({ label: 'Local', tz: localTz })
  }

  return zones.map(({ label, tz }) => ({
    label,
    tz,
    formatted: formatInTimeZone(date, tz),
  }))
}
