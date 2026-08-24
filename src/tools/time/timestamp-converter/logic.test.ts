/**
 * Unix Timestamp Converter — logic unit tests
 */

import { describe, it, expect } from 'vitest'
import {
  detectUnit,
  parseTimestamp,
  formatRelative,
  formatInTimeZone,
  formatIso8601,
  formatUtcFull,
  toEpochSeconds,
  toEpochMillis,
  getTimezoneDisplays,
} from './logic'

// ── detectUnit ────────────────────────────────────────────────────────────────

describe('detectUnit', () => {
  it('detects seconds for a typical 2023 timestamp', () => {
    expect(detectUnit(1_700_000_000)).toBe('seconds')
  })

  it('detects seconds for 0 (epoch)', () => {
    expect(detectUnit(0)).toBe('seconds')
  })

  it('detects seconds for values just below 1e10', () => {
    expect(detectUnit(9_999_999_999)).toBe('seconds')
  })

  it('detects millis for a typical 2023 ms timestamp', () => {
    expect(detectUnit(1_700_000_000_000)).toBe('millis')
  })

  it('detects millis at exactly the seconds/millis boundary', () => {
    expect(detectUnit(1e10)).toBe('millis')
  })

  it('detects millis for values just below 1e13', () => {
    expect(detectUnit(9_999_999_999_999)).toBe('millis')
  })

  it('detects micros at exactly the millis/micros boundary', () => {
    expect(detectUnit(1e13)).toBe('micros')
  })

  it('detects micros for large values', () => {
    expect(detectUnit(1_700_000_000_000_000)).toBe('micros')
  })

  it('handles negative seconds (pre-1970)', () => {
    expect(detectUnit(-1_000_000)).toBe('seconds')
  })

  it('handles negative millis (pre-1970)', () => {
    expect(detectUnit(-1_000_000_000_000)).toBe('millis')
  })

  it('handles negative micros', () => {
    expect(detectUnit(-1_700_000_000_000_000)).toBe('micros')
  })
})

// ── parseTimestamp ────────────────────────────────────────────────────────────

describe('parseTimestamp — valid inputs', () => {
  it('parses a seconds timestamp', () => {
    const r = parseTimestamp('1700000000', 'seconds')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.parsed.date.getTime()).toBe(1_700_000_000_000)
    expect(r.parsed.unit).toBe('seconds')
  })

  it('parses a millis timestamp', () => {
    const r = parseTimestamp('1700000000000', 'millis')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.parsed.date.getTime()).toBe(1_700_000_000_000)
  })

  it('parses a micros timestamp', () => {
    const r = parseTimestamp('1700000000000000', 'micros')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    // micros / 1000 = millis
    expect(r.parsed.date.getTime()).toBe(1_700_000_000_000)
  })

  it('parses epoch 0 (1970-01-01T00:00:00Z)', () => {
    const r = parseTimestamp('0', 'seconds')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.parsed.date.toISOString()).toBe('1970-01-01T00:00:00.000Z')
  })

  it('parses a negative timestamp (pre-1970)', () => {
    // -86400 seconds = 1969-12-31T00:00:00Z
    const r = parseTimestamp('-86400', 'seconds')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.parsed.date.toISOString()).toBe('1969-12-31T00:00:00.000Z')
  })

  it('parses a large negative millis (pre-1970)', () => {
    const r = parseTimestamp('-86400000', 'millis')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.parsed.date.toISOString()).toBe('1969-12-31T00:00:00.000Z')
  })

  it('trims leading/trailing whitespace', () => {
    const r = parseTimestamp('  1700000000  ', 'seconds')
    expect(r.ok).toBe(true)
  })

  it('truncates a fractional seconds value to integer ms', () => {
    const r = parseTimestamp('1700000000.9', 'seconds')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    // trunc(1700000000.9) * 1000 = 1700000000000
    expect(r.parsed.date.getTime()).toBe(1_700_000_000_000)
  })
})

describe('parseTimestamp — invalid inputs', () => {
  it('rejects empty string', () => {
    const r = parseTimestamp('', 'seconds')
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error).toBeTruthy()
  })

  it('rejects whitespace-only string', () => {
    const r = parseTimestamp('   ', 'seconds')
    expect(r.ok).toBe(false)
  })

  it('rejects non-numeric input', () => {
    const r = parseTimestamp('abc', 'seconds')
    expect(r.ok).toBe(false)
  })

  it('rejects a date string', () => {
    const r = parseTimestamp('2023-11-14', 'seconds')
    expect(r.ok).toBe(false)
  })

  it('rejects "Infinity"', () => {
    const r = parseTimestamp('Infinity', 'seconds')
    expect(r.ok).toBe(false)
  })

  it('rejects a value so large it overflows to Infinity', () => {
    // Number too large for JS number precision
    const r = parseTimestamp('9e999', 'seconds')
    expect(r.ok).toBe(false)
  })

  it('rejects input with embedded spaces', () => {
    const r = parseTimestamp('170 000', 'seconds')
    expect(r.ok).toBe(false)
  })
})

// ── formatRelative ────────────────────────────────────────────────────────────

describe('formatRelative', () => {
  const now = new Date('2023-11-14T12:00:00.000Z')

  // Past
  it('returns "just now" for 3 seconds ago', () => {
    const date = new Date(now.getTime() - 3_000)
    expect(formatRelative(date, now)).toBe('just now')
  })

  it('returns "N seconds ago" for 30 seconds ago', () => {
    const date = new Date(now.getTime() - 30_000)
    expect(formatRelative(date, now)).toBe('30 seconds ago')
  })

  it('returns "N seconds ago" for 6 seconds ago', () => {
    const date = new Date(now.getTime() - 6_000)
    expect(formatRelative(date, now)).toBe('6 seconds ago')
  })

  it('returns "N minutes ago" for 5 minutes ago', () => {
    const date = new Date(now.getTime() - 5 * 60 * 1000)
    expect(formatRelative(date, now)).toBe('5 minutes ago')
  })

  it('returns "1 minute ago" for 1 minute ago', () => {
    const date = new Date(now.getTime() - 60_000)
    expect(formatRelative(date, now)).toBe('1 minute ago')
  })

  it('returns "N hours ago" for 3 hours ago', () => {
    const date = new Date(now.getTime() - 3 * 3600 * 1000)
    expect(formatRelative(date, now)).toBe('3 hours ago')
  })

  it('returns "1 hour ago" for 1 hour ago', () => {
    const date = new Date(now.getTime() - 3600 * 1000)
    expect(formatRelative(date, now)).toBe('1 hour ago')
  })

  it('returns "N days ago" for 10 days ago', () => {
    const date = new Date(now.getTime() - 10 * 24 * 3600 * 1000)
    expect(formatRelative(date, now)).toBe('10 days ago')
  })

  it('returns "1 day ago" for 1 day ago', () => {
    const date = new Date(now.getTime() - 24 * 3600 * 1000)
    expect(formatRelative(date, now)).toBe('1 day ago')
  })

  it('returns "N months ago" for 60 days ago', () => {
    const date = new Date(now.getTime() - 60 * 24 * 3600 * 1000)
    expect(formatRelative(date, now)).toBe('2 months ago')
  })

  it('returns "N years ago" for 400 days ago', () => {
    const date = new Date(now.getTime() - 400 * 24 * 3600 * 1000)
    expect(formatRelative(date, now)).toBe('1 year ago')
  })

  it('returns "N years ago" for 730 days ago', () => {
    const date = new Date(now.getTime() - 730 * 24 * 3600 * 1000)
    expect(formatRelative(date, now)).toBe('2 years ago')
  })

  // Future
  it('returns "just now" for 2 seconds in the future', () => {
    const date = new Date(now.getTime() + 2_000)
    expect(formatRelative(date, now)).toBe('just now')
  })

  it('returns "in N seconds" for 15 seconds in the future', () => {
    const date = new Date(now.getTime() + 15_000)
    expect(formatRelative(date, now)).toBe('in 15 seconds')
  })

  it('returns "in N minutes" for 3 minutes in the future', () => {
    const date = new Date(now.getTime() + 3 * 60 * 1000)
    expect(formatRelative(date, now)).toBe('in 3 minutes')
  })

  it('returns "in N hours" for 5 hours in the future', () => {
    const date = new Date(now.getTime() + 5 * 3600 * 1000)
    expect(formatRelative(date, now)).toBe('in 5 hours')
  })

  it('returns "in 2 days" for 2 days in the future', () => {
    const date = new Date(now.getTime() + 2 * 24 * 3600 * 1000)
    expect(formatRelative(date, now)).toBe('in 2 days')
  })

  it('returns "in N months" for 90 days in the future', () => {
    const date = new Date(now.getTime() + 90 * 24 * 3600 * 1000)
    expect(formatRelative(date, now)).toBe('in 3 months')
  })

  it('returns "in N years" for 800 days in the future', () => {
    const date = new Date(now.getTime() + 800 * 24 * 3600 * 1000)
    expect(formatRelative(date, now)).toBe('in 2 years')
  })
})

// ── formatIso8601 ─────────────────────────────────────────────────────────────

describe('formatIso8601', () => {
  it('returns ISO 8601 with trailing Z for epoch 0', () => {
    expect(formatIso8601(new Date(0))).toBe('1970-01-01T00:00:00.000Z')
  })

  it('returns ISO 8601 for a known timestamp', () => {
    const date = new Date(1_700_000_000_000)
    // 2023-11-14T22:13:20.000Z
    expect(formatIso8601(date)).toBe('2023-11-14T22:13:20.000Z')
  })

  it('handles negative timestamps (pre-1970)', () => {
    const date = new Date(-86_400_000) // 1969-12-31
    expect(formatIso8601(date)).toBe('1969-12-31T00:00:00.000Z')
  })
})

// ── formatUtcFull ─────────────────────────────────────────────────────────────

describe('formatUtcFull', () => {
  it('formats epoch 0 in UTC', () => {
    expect(formatUtcFull(new Date(0))).toBe('1970-01-01 00:00:00 UTC')
  })

  it('formats a known date in UTC', () => {
    const date = new Date('2023-11-14T22:13:20.000Z')
    expect(formatUtcFull(date)).toBe('2023-11-14 22:13:20 UTC')
  })

  it('pads single-digit month and day', () => {
    const date = new Date('2023-01-05T03:04:05.000Z')
    expect(formatUtcFull(date)).toBe('2023-01-05 03:04:05 UTC')
  })

  it('handles negative (pre-1970) dates', () => {
    const date = new Date(-86_400_000)
    expect(formatUtcFull(date)).toBe('1969-12-31 00:00:00 UTC')
  })
})

// ── toEpochSeconds / toEpochMillis ────────────────────────────────────────────

describe('toEpochSeconds', () => {
  it('returns integer seconds for epoch 0', () => {
    expect(toEpochSeconds(new Date(0))).toBe(0)
  })

  it('returns correct seconds for a known timestamp', () => {
    expect(toEpochSeconds(new Date(1_700_000_000_000))).toBe(1_700_000_000)
  })

  it('returns negative seconds for pre-1970 dates', () => {
    expect(toEpochSeconds(new Date(-1_000))).toBe(-1)
  })

  it('truncates (does not round) sub-second remainder', () => {
    // 1500ms → 1 second (truncate, not round)
    expect(toEpochSeconds(new Date(1_500))).toBe(1)
    expect(toEpochSeconds(new Date(-1_500))).toBe(-1)
  })
})

describe('toEpochMillis', () => {
  it('returns 0 for epoch 0', () => {
    expect(toEpochMillis(new Date(0))).toBe(0)
  })

  it('returns correct millis for a known timestamp', () => {
    expect(toEpochMillis(new Date(1_700_000_000_000))).toBe(1_700_000_000_000)
  })

  it('returns negative millis for pre-1970 dates', () => {
    expect(toEpochMillis(new Date(-500))).toBe(-500)
  })
})

// ── formatInTimeZone ──────────────────────────────────────────────────────────

describe('formatInTimeZone', () => {
  const date = new Date('2023-11-14T22:13:20.000Z')

  it('formats in UTC timezone', () => {
    const result = formatInTimeZone(date, 'UTC')
    // Should include 22:13:20 (UTC time)
    expect(result).toContain('22:13:20')
  })

  it('formats in Tokyo timezone (UTC+9)', () => {
    const result = formatInTimeZone(date, 'Asia/Tokyo')
    // 22:13 UTC = 07:13 next day in Tokyo (JST = UTC+9)
    expect(result).toContain('07:13:20')
  })

  it('formats in New York timezone (UTC-5 in November)', () => {
    const result = formatInTimeZone(date, 'America/New_York')
    // 22:13 UTC = 17:13 EST (UTC-5)
    expect(result).toContain('17:13:20')
  })

  it('formats in London timezone', () => {
    const result = formatInTimeZone(date, 'Europe/London')
    // November → UTC+0, so 22:13 UTC = 22:13 London
    expect(result).toContain('22:13:20')
  })

  it('returns "Unsupported timezone" for an invalid timezone', () => {
    const result = formatInTimeZone(date, 'Not/AReal/Zone')
    expect(result).toBe('Unsupported timezone')
  })
})

// ── getTimezoneDisplays ───────────────────────────────────────────────────────

describe('getTimezoneDisplays', () => {
  const date = new Date('2023-11-14T22:13:20.000Z')

  it('returns all four fixed world zones', () => {
    const displays = getTimezoneDisplays(date, 'UTC') // local = UTC, already in list
    const tzs = displays.map((d) => d.tz)
    expect(tzs).toContain('UTC')
    expect(tzs).toContain('America/New_York')
    expect(tzs).toContain('Europe/London')
    expect(tzs).toContain('Asia/Tokyo')
  })

  it('does not duplicate UTC when local is UTC', () => {
    const displays = getTimezoneDisplays(date, 'UTC')
    const utcCount = displays.filter((d) => d.tz === 'UTC').length
    expect(utcCount).toBe(1)
  })

  it('appends local timezone when it is not already in the list', () => {
    const displays = getTimezoneDisplays(date, 'Australia/Sydney')
    const tzs = displays.map((d) => d.tz)
    expect(tzs).toContain('Australia/Sydney')
    // Should be 5 entries (4 fixed + 1 local)
    expect(displays).toHaveLength(5)
  })

  it('each entry has a formatted string', () => {
    const displays = getTimezoneDisplays(date, 'UTC')
    for (const d of displays) {
      expect(typeof d.formatted).toBe('string')
      expect(d.formatted.length).toBeGreaterThan(0)
    }
  })

  it('UTC entry contains the UTC time', () => {
    const displays = getTimezoneDisplays(date, 'America/New_York')
    const utc = displays.find((d) => d.tz === 'UTC')
    expect(utc).toBeDefined()
    expect(utc!.formatted).toContain('22:13:20')
  })
})

// ── Integration: parseTimestamp → formatIso8601 ───────────────────────────────

describe('integration: round-trip through parseTimestamp', () => {
  it('seconds timestamp round-trips through ISO 8601', () => {
    const r = parseTimestamp('1700000000', 'seconds')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(formatIso8601(r.parsed.date)).toBe('2023-11-14T22:13:20.000Z')
  })

  it('millis timestamp round-trips through toEpochMillis', () => {
    const r = parseTimestamp('1700000000000', 'millis')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(toEpochMillis(r.parsed.date)).toBe(1_700_000_000_000)
  })

  it('negative seconds (pre-1970) round-trip through ISO 8601', () => {
    const r = parseTimestamp('-86400', 'seconds')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(formatIso8601(r.parsed.date)).toBe('1969-12-31T00:00:00.000Z')
  })

  it('auto-detected unit matches manual unit for seconds', () => {
    const value = 1_700_000_000
    const r1 = parseTimestamp(String(value), detectUnit(value))
    const r2 = parseTimestamp(String(value), 'seconds')
    expect(r1.ok).toBe(true)
    expect(r2.ok).toBe(true)
    if (!r1.ok || !r2.ok) return
    expect(r1.parsed.date.getTime()).toBe(r2.parsed.date.getTime())
  })

  it('auto-detected unit matches manual unit for millis', () => {
    const value = 1_700_000_000_000
    const r1 = parseTimestamp(String(value), detectUnit(value))
    const r2 = parseTimestamp(String(value), 'millis')
    expect(r1.ok).toBe(true)
    expect(r2.ok).toBe(true)
    if (!r1.ok || !r2.ok) return
    expect(r1.parsed.date.getTime()).toBe(r2.parsed.date.getTime())
  })
})
