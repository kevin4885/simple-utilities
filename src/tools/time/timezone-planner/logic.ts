/**
 * Timezone Meeting Planner — pure logic (no React, no side-effects)
 *
 * Exports:
 *   getZoneOffsetMinutes    — DST-aware UTC offset via Intl (formatToParts trick)
 *   getLocalHour            — local hour (0-23) in a zone at a UTC instant
 *   getLocalDateStr         — local date "YYYY-MM-DD" in a zone at a UTC instant
 *   getLocalTimeStr         — local time "HH:MM" in a zone at a UTC instant
 *   findLocalMidnightUtc    — UTC timestamp of local midnight for a zone + date
 *   buildHourGrid           — 24-column × N-row grid aligned to reference zone's day
 *   classifyHour            — working / shoulder / night
 *   computeOverlap          — full/partial/none working-hours overlap across zones
 *   getFriendlyLabel        — "America/New_York" → "New York"
 *   formatOffset            — offsetMinutes → "UTC+5:30" / "UTC−5"
 *   formatConsecutiveHours  — [9,10,11] → "09:00–12:00"
 *   getDayDiff              — calendar-day difference between two "YYYY-MM-DD" strings
 *   isValidIanaZone         — runtime check via Intl.DateTimeFormat construction
 *   getSupportedZones       — Intl.supportedValuesOf with FALLBACK_ZONES guard
 *   getTodayDateStr         — today as "YYYY-MM-DD" in local time
 *   FALLBACK_ZONES          — ~40 major IANA zones for environments without supportedValuesOf
 *   WORK_START / WORK_END   — 9 / 17
 *   SHOULDER_START / …_END  — 7 / 21
 *   MAX_ZONES               — 10
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ZoneEntry {
  /** IANA timezone identifier, e.g. "America/New_York" */
  zone: string
  /** Friendly city label, e.g. "New York" */
  label: string
  /** True when this entry matches the browser's local timezone */
  isLocal: boolean
}

export interface HourCell {
  /** Local hour 0–23 in this zone at the column's UTC instant */
  localHour: number
  /** Local date "YYYY-MM-DD" in this zone at the column's UTC instant */
  localDateStr: string
  /** Local wall-clock time "HH:MM" for display in the hover summary */
  localTimeStr: string
}

export interface GridRow {
  entry: ZoneEntry
  /** 24 cells, column 0 = reference zone's local midnight */
  cells: HourCell[]
}

export interface HourGrid {
  rows: GridRow[]
  /** UTC instant for each of the 24 columns (shared across all rows) */
  utcTimes: Date[]
}

export interface OverlapResult {
  /** 'full' = all zones in working hours; 'partial' = some; 'none' = 0 zones in working hours */
  type: 'full' | 'partial' | 'none'
  /** Reference-zone hours (0–23) where every zone is in working hours */
  fullOverlapHours: number[]
  /** Max number of zones in working hours at the same reference hour (for partial) */
  bestCount: number
  /** Reference-zone hours where bestCount zones are in working hours */
  bestHours: number[]
}

export type HourType = 'working' | 'shoulder' | 'night'

// ── Constants ─────────────────────────────────────────────────────────────────

export const WORK_START     = 9
export const WORK_END       = 17
export const SHOULDER_START = 7
export const SHOULDER_END   = 21
export const MAX_ZONES      = 10

// ── Offset computation ────────────────────────────────────────────────────────

/**
 * Get the UTC offset in minutes for a given IANA zone at a specific UTC instant.
 * Positive = east of UTC (e.g. UTC+5:30 → +330, UTC−5 → −300).
 *
 * Strategy: use Intl.DateTimeFormat.formatToParts to read local date/time parts,
 * then interpret them as UTC and subtract the actual UTC instant. This correctly
 * reflects DST at the exact moment passed in — no fixed offsets anywhere.
 */
export function getZoneOffsetMinutes(zone: string, utcDate: Date): number {
  try {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    })
    const parts = fmt.formatToParts(utcDate)
    const p: Record<string, string> = {}
    for (const part of parts) {
      if (part.type !== 'literal') p[part.type] = part.value
    }
    // hour12:false can emit "24" for midnight; normalise with % 24
    const h   = parseInt(p.hour   ?? '0') % 24
    const min = parseInt(p.minute ?? '0')
    const s   = parseInt(p.second ?? '0')
    const y   = parseInt(p.year   ?? '1970')
    const mo  = parseInt(p.month  ?? '1') - 1
    const d   = parseInt(p.day    ?? '1')
    const localAsUtcMs = Date.UTC(y, mo, d, h, min, s)
    return Math.round((localAsUtcMs - utcDate.getTime()) / 60_000)
  } catch {
    return 0
  }
}

// ── Local date / time helpers ─────────────────────────────────────────────────

/** Get the local date string "YYYY-MM-DD" in a given zone at a UTC instant. */
export function getLocalDateStr(zone: string, utcDate: Date): string {
  try {
    // en-CA locale yields "YYYY-MM-DD" natively
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(utcDate)
  } catch {
    return ''
  }
}

/** Get the local hour (0-23) in a given zone at a UTC instant. */
export function getLocalHour(zone: string, utcDate: Date): number {
  try {
    return (
      parseInt(
        new Intl.DateTimeFormat('en-US', {
          timeZone: zone,
          hour: 'numeric',
          hour12: false,
        }).format(utcDate),
      ) % 24
    )
  } catch {
    return 0
  }
}

/** Get the local wall-clock string "HH:MM" in a given zone at a UTC instant. */
export function getLocalTimeStr(zone: string, utcDate: Date): string {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: zone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(utcDate)
  } catch {
    return '--:--'
  }
}

// ── Midnight finder ───────────────────────────────────────────────────────────

/**
 * Find the UTC timestamp that corresponds to local midnight for the given zone
 * and date string ("YYYY-MM-DD").
 *
 * Strategy (two-step Newton correction):
 *   1. Sample the zone offset at UTC midnight.
 *   2. Apply it to get an estimate of the local-midnight UTC instant.
 *   3. Re-sample the offset at that estimate (it may differ on DST transitions).
 *   4. If the offset changed, apply the corrected offset instead.
 *
 * This handles DST spring-forward days where the offset at UTC midnight and at
 * local midnight differ (e.g. Auckland springs forward at 02:00 local: the offset
 * at UTC midnight is still the old one, so without correction the result is 1 hour
 * early). Two steps are always sufficient for any real-world transition.
 */
export function findLocalMidnightUtc(zone: string, dateStr: string): Date {
  const utcMidnight = new Date(`${dateStr}T00:00:00Z`)
  const off1 = getZoneOffsetMinutes(zone, utcMidnight)
  const est  = new Date(utcMidnight.getTime() - off1 * 60_000)
  const off2 = getZoneOffsetMinutes(zone, est)
  return off2 === off1 ? est : new Date(utcMidnight.getTime() - off2 * 60_000)
}

// ── Grid construction ─────────────────────────────────────────────────────────

/**
 * Build the 24-column × N-row hour grid.
 *
 * Column 0 = reference zone's local midnight on dateStr.
 * Each subsequent column is 1 hour later in UTC.
 * Cells record local hour, local date, and local HH:MM for each zone.
 *
 * Returns an empty grid when entries is empty.
 */
export function buildHourGrid(entries: ZoneEntry[], dateStr: string): HourGrid {
  if (entries.length === 0) {
    return { rows: [], utcTimes: [] }
  }

  const refZone    = entries[0].zone
  const utcMidnight = findLocalMidnightUtc(refZone, dateStr)

  const utcTimes: Date[] = Array.from(
    { length: 24 },
    (_, h) => new Date(utcMidnight.getTime() + h * 3_600_000),
  )

  const rows: GridRow[] = entries.map((entry) => ({
    entry,
    cells: utcTimes.map((utc) => ({
      localHour:    getLocalHour(entry.zone, utc),
      localDateStr: getLocalDateStr(entry.zone, utc),
      localTimeStr: getLocalTimeStr(entry.zone, utc),
    })),
  }))

  return { rows, utcTimes }
}

// ── Hour classification ───────────────────────────────────────────────────────

/** Classify a local hour as 'working' (9–17), 'shoulder' (7–9 or 17–21), or 'night'. */
export function classifyHour(h: number): HourType {
  if (h >= WORK_START && h < WORK_END) return 'working'
  if (
    (h >= SHOULDER_START && h < WORK_START) ||
    (h >= WORK_END && h < SHOULDER_END)
  )
    return 'shoulder'
  return 'night'
}

// ── Overlap computation ───────────────────────────────────────────────────────

/**
 * Compute the working-hours overlap across all zone rows.
 *
 * - 'full': every zone is in working hours (9–17) at the same reference hour.
 * - 'partial': at least one zone is in working hours; bestCount/bestHours give
 *   the reference hours where the most zones overlap.
 * - 'none': no zone is in working hours at any reference hour (extremely unlikely).
 */
export function computeOverlap(grid: HourGrid): OverlapResult {
  if (grid.rows.length === 0) {
    return { type: 'none', fullOverlapHours: [], bestCount: 0, bestHours: [] }
  }

  const zoneCount = grid.rows.length

  // Count how many zones are in working hours for each column index
  const countPerHour: number[] = Array.from({ length: 24 }, (_, h) =>
    grid.rows.reduce(
      (acc, row) => acc + (classifyHour(row.cells[h].localHour) === 'working' ? 1 : 0),
      0,
    ),
  )

  const fullOverlapHours = countPerHour.flatMap((c, i) => (c === zoneCount ? [i] : []))

  if (fullOverlapHours.length > 0) {
    return {
      type: 'full',
      fullOverlapHours,
      bestCount: zoneCount,
      bestHours: fullOverlapHours,
    }
  }

  const maxCount = Math.max(...countPerHour)
  const bestHours = countPerHour.flatMap((c, i) =>
    c === maxCount && c > 0 ? [i] : [],
  )

  return {
    type: maxCount > 0 ? 'partial' : 'none',
    fullOverlapHours: [],
    bestCount: maxCount,
    bestHours,
  }
}

// ── Label helpers ─────────────────────────────────────────────────────────────

/**
 * Derive a friendly display label from an IANA timezone name.
 *   "America/New_York"           → "New York"
 *   "Europe/London"              → "London"
 *   "America/Indiana/Indianapolis" → "Indianapolis"
 *   "UTC"                        → "UTC"
 */
export function getFriendlyLabel(zone: string): string {
  const parts = zone.split('/')
  return parts[parts.length - 1].replace(/_/g, ' ')
}

/**
 * Format a UTC offset in minutes as a human-readable string.
 *   +330 → "UTC+5:30"
 *   −300 → "UTC−5"
 *     0  → "UTC+0"
 */
export function formatOffset(offsetMinutes: number): string {
  const sign = offsetMinutes >= 0 ? '+' : '\u2212' // U+2212 minus sign
  const abs  = Math.abs(offsetMinutes)
  const h    = Math.floor(abs / 60)
  const m    = abs % 60
  return m === 0
    ? `UTC${sign}${h}`
    : `UTC${sign}${h}:${m.toString().padStart(2, '0')}`
}

/**
 * Format a sorted array of reference-zone hour indices as human-readable ranges.
 *   [9,10,11,12,13,14,15,16] → "09:00–17:00"
 *   [9,10,14,15]             → "09:00–11:00, 14:00–16:00"
 *   []                       → "none"
 */
export function formatConsecutiveHours(hours: number[]): string {
  if (hours.length === 0) return 'none'

  const ranges: Array<[number, number]> = []
  let start = hours[0]
  let prev  = hours[0]

  for (let i = 1; i < hours.length; i++) {
    if (hours[i] === prev + 1) {
      prev = hours[i]
    } else {
      ranges.push([start, prev])
      start = hours[i]
      prev  = hours[i]
    }
  }
  ranges.push([start, prev])

  return ranges
    .map(([s, e]) => {
      const sStr = `${s.toString().padStart(2, '0')}:00`
      const eStr = `${(e + 1).toString().padStart(2, '0')}:00`
      return `${sStr}–${eStr}`
    })
    .join(', ')
}

// ── Day difference ────────────────────────────────────────────────────────────

/**
 * Calendar-day difference between two "YYYY-MM-DD" strings.
 * Returns −1, 0, or +1 (clamped; real-world offsets never exceed ±1 day vs UTC).
 */
export function getDayDiff(refDateStr: string, localDateStr: string): -1 | 0 | 1 {
  if (refDateStr === localDateStr) return 0
  const ref  = new Date(`${refDateStr}T00:00:00Z`)
  const loc  = new Date(`${localDateStr}T00:00:00Z`)
  const days = Math.round((loc.getTime() - ref.getTime()) / 86_400_000)
  if (days < 0) return -1
  if (days > 0) return 1
  return 0
}

// ── Zone validation ───────────────────────────────────────────────────────────

/**
 * Runtime check: try constructing Intl.DateTimeFormat with the given zone string.
 * Returns false for any string that would throw (invalid IANA name, etc.).
 */
export function isValidIanaZone(zone: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: zone })
    return true
  } catch {
    return false
  }
}

// ── Zone list ─────────────────────────────────────────────────────────────────

/**
 * Fallback list of ~40 major IANA timezone names.
 * Used when Intl.supportedValuesOf('timeZone') is unavailable (older environments).
 */
export const FALLBACK_ZONES: string[] = [
  'UTC',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Anchorage',
  'Pacific/Honolulu',
  'America/Toronto',
  'America/Vancouver',
  'America/Sao_Paulo',
  'America/Argentina/Buenos_Aires',
  'America/Mexico_City',
  'America/Bogota',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Madrid',
  'Europe/Rome',
  'Europe/Amsterdam',
  'Europe/Stockholm',
  'Europe/Warsaw',
  'Europe/Moscow',
  'Europe/Istanbul',
  'Africa/Cairo',
  'Africa/Johannesburg',
  'Africa/Lagos',
  'Africa/Nairobi',
  'Asia/Dubai',
  'Asia/Karachi',
  'Asia/Kolkata',
  'Asia/Dhaka',
  'Asia/Bangkok',
  'Asia/Singapore',
  'Asia/Shanghai',
  'Asia/Hong_Kong',
  'Asia/Tokyo',
  'Asia/Seoul',
  'Australia/Perth',
  'Australia/Adelaide',
  'Australia/Sydney',
  'Pacific/Auckland',
  'Pacific/Fiji',
]

/**
 * Return the full list of IANA timezone names supported by the environment.
 * Uses Intl.supportedValuesOf if available; falls back to FALLBACK_ZONES.
 */
export function getSupportedZones(): string[] {
  try {
    // Intl.supportedValuesOf is ES2022+; not present in all TS lib targets
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const zones = (Intl as any).supportedValuesOf('timeZone') as string[]
    if (Array.isArray(zones) && zones.length > 0) return zones
  } catch {
    // Not available in this environment
  }
  return FALLBACK_ZONES
}

// ── Utility ───────────────────────────────────────────────────────────────────

/** Today's date as "YYYY-MM-DD" in the browser's local timezone. */
export function getTodayDateStr(): string {
  return new Date().toLocaleDateString('en-CA') // en-CA gives "YYYY-MM-DD"
}
