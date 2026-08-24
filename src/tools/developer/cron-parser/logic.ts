/**
 * Cron Expression Parser — pure logic (no React, no side-effects)
 *
 * Supports:
 *   - Standard 5-field syntax: minute hour day-of-month month day-of-week
 *   - Wildcards (*), lists (1,2,3), ranges (1-5), steps (* /15, 1-30/5)
 *   - Month names: JAN-DEC (case-insensitive)
 *   - Day-of-week names: SUN-SAT (case-insensitive); both 0 and 7 = Sunday
 *   - Macros: @hourly, @daily, @midnight, @weekly, @monthly, @yearly, @annually
 *   - 6-field expressions rejected with a clear error
 *   - DOM/DOW OR semantics when both fields are restricted (standard cron behaviour)
 */

// ── Constants ─────────────────────────────────────────────────────────────────

export const FIELD_NAMES = [
  'minute',
  'hour',
  'day-of-month',
  'month',
  'day-of-week',
] as const

export type FieldName = (typeof FIELD_NAMES)[number]

export const FIELD_LABELS: Record<FieldName, string> = {
  minute: 'Minute',
  hour: 'Hour',
  'day-of-month': 'Day of Month',
  month: 'Month',
  'day-of-week': 'Day of Week',
}

/** Canonical valid ranges for display; DOW allows 7 as alias for 0 internally. */
export const FIELD_RANGES: Record<FieldName, { min: number; max: number }> = {
  minute: { min: 0, max: 59 },
  hour: { min: 0, max: 23 },
  'day-of-month': { min: 1, max: 31 },
  month: { min: 1, max: 12 },
  'day-of-week': { min: 0, max: 6 },
}

const MONTH_NAME_MAP: Record<string, number> = {
  JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6,
  JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12,
}

const DOW_NAME_MAP: Record<string, number> = {
  SUN: 0, MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6,
}

/** 1-indexed: index 0 is unused. */
const MONTH_LONG = [
  '',
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

const DOW_LONG = [
  'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday',
]

const MACROS: Record<string, string> = {
  '@hourly': '0 * * * *',
  '@daily': '0 0 * * *',
  '@midnight': '0 0 * * *',
  '@weekly': '0 0 * * 0',
  '@monthly': '0 0 1 * *',
  '@yearly': '0 0 1 1 *',
  '@annually': '0 0 1 1 *',
}

// ── Types ─────────────────────────────────────────────────────────────────────

/** Parsed representation of one cron field. */
export interface FieldInfo {
  /** Raw field string as entered by the user. */
  raw: string
  /** Expanded sorted unique numeric values this field matches. */
  values: number[]
  /** True only when the raw field string is literally `*`. */
  isWildcard: boolean
}

/** A fully parsed cron expression. */
export interface ParsedCron {
  /** Expression after macro expansion. */
  expression: string
  /** Fields in order: [minute, hour, day-of-month, month, day-of-week] */
  fields: [FieldInfo, FieldInfo, FieldInfo, FieldInfo, FieldInfo]
}

export type CronParseResult =
  | { ok: true; parsed: ParsedCron }
  | { ok: false; error: string }

export interface CronPreset {
  label: string
  expression: string
  description: string
}

// ── Small helpers ─────────────────────────────────────────────────────────────

function padTwo(n: number): string {
  return String(n).padStart(2, '0')
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] ?? s[v] ?? 'th')
}

/** Parse one token as a number, resolving name aliases. Returns null on failure. */
function parseToken(token: string, nameMap: Record<string, number>): number | null {
  const upper = token.toUpperCase()
  if (upper in nameMap) return nameMap[upper]
  if (!/^\d+$/.test(token)) return null
  return parseInt(token, 10)
}

// ── expandField ───────────────────────────────────────────────────────────────

/**
 * Expand a raw cron field string into a sorted array of unique matching values.
 * Returns an error string on failure (avoids throwing so callers stay pure).
 */
function expandField(
  raw: string,
  fieldId: FieldName,
  nameMap: Record<string, number>,
): number[] | string {
  const { min, max } = FIELD_RANGES[fieldId]
  // DOW allows 7 as an alias for 0 (Sunday), so we extend the maximum for parsing
  const isDOW = fieldId === 'day-of-week'
  const parseMax = isDOW ? 7 : max

  const values = new Set<number>()
  const parts = raw.split(',')

  for (const part of parts) {
    if (part === '') {
      return `Empty value in field "${FIELD_LABELS[fieldId]}" — check for trailing commas`
    }

    // Detect step suffix: .../N
    const slashIdx = part.lastIndexOf('/')
    let rangePart: string
    let step: number

    if (slashIdx !== -1) {
      rangePart = part.slice(0, slashIdx)
      const stepStr = part.slice(slashIdx + 1)
      if (!/^\d+$/.test(stepStr)) {
        return `Invalid step "${stepStr}" in field "${FIELD_LABELS[fieldId]}" — step must be a positive integer`
      }
      step = parseInt(stepStr, 10)
      if (step < 1) {
        return `Step must be ≥ 1 in field "${FIELD_LABELS[fieldId]}", got ${step}`
      }
    } else {
      rangePart = part
      step = 1
    }

    // ── Wildcard ──────────────────────────────────────────────────────────────
    if (rangePart === '*') {
      for (let i = min; i <= max; i += step) values.add(i)
      continue
    }

    // ── Range: X-Y ────────────────────────────────────────────────────────────
    if (rangePart.includes('-')) {
      const dashIdx = rangePart.indexOf('-')
      const startStr = rangePart.slice(0, dashIdx)
      const endStr = rangePart.slice(dashIdx + 1)

      const rangeStart = parseToken(startStr, nameMap)
      const rangeEnd = parseToken(endStr, nameMap)

      if (rangeStart === null) {
        return `Invalid value "${startStr}" in field "${FIELD_LABELS[fieldId]}"`
      }
      if (rangeEnd === null) {
        return `Invalid value "${endStr}" in field "${FIELD_LABELS[fieldId]}"`
      }

      if (rangeStart < min || rangeStart > parseMax) {
        return `Value ${rangeStart} is out of range [${min}–${parseMax}] in field "${FIELD_LABELS[fieldId]}"`
      }
      if (rangeEnd < min || rangeEnd > parseMax) {
        return `Value ${rangeEnd} is out of range [${min}–${parseMax}] in field "${FIELD_LABELS[fieldId]}"`
      }

      if (rangeStart <= rangeEnd) {
        for (let i = rangeStart; i <= rangeEnd; i += step) {
          // Normalize DOW 7 → 0
          values.add(isDOW && i === 7 ? 0 : i)
        }
      } else {
        // Wrap-around: only valid for DOW (e.g. FRI-MON = 5,6,0,1)
        if (isDOW) {
          for (let i = rangeStart; i <= 6; i += step) values.add(i)
          for (let i = 0; i <= rangeEnd; i += step) values.add(i)
        } else {
          return (
            `Range start (${rangeStart}) > end (${rangeEnd}) in field ` +
            `"${FIELD_LABELS[fieldId]}" — ranges must be written low–high`
          )
        }
      }
      continue
    }

    // ── Single value (possibly with step) ────────────────────────────────────
    let val = parseToken(rangePart, nameMap)
    if (val === null) {
      return `Invalid value "${rangePart}" in field "${FIELD_LABELS[fieldId]}"`
    }

    // Normalize DOW 7 → 0
    if (isDOW && val === 7) val = 0

    if (val < min || val > max) {
      return `Value ${val} is out of range [${min}–${max}] in field "${FIELD_LABELS[fieldId]}"`
    }

    if (slashIdx !== -1) {
      // Single value with step: start from val, step to max (e.g. 5/10 = 5,15,25,35,45,55)
      for (let i = val; i <= max; i += step) values.add(i)
    } else {
      values.add(val)
    }
  }

  return [...values].sort((a, b) => a - b)
}

// ── parseCron ─────────────────────────────────────────────────────────────────

/**
 * Parse a cron expression (5-field or macro).
 * Returns `{ ok: false, error }` for any invalid input with a friendly message.
 */
export function parseCron(input: string): CronParseResult {
  const trimmed = input.trim()

  if (!trimmed) {
    return { ok: false, error: 'Cron expression cannot be empty.' }
  }

  // Macro expansion (case-insensitive)
  const lower = trimmed.toLowerCase()
  let expression = trimmed

  if (lower in MACROS) {
    expression = MACROS[lower]
  } else if (lower.startsWith('@')) {
    return {
      ok: false,
      error:
        `Unknown macro "${trimmed}". ` +
        'Supported: @hourly, @daily, @midnight, @weekly, @monthly, @yearly, @annually.',
    }
  }

  const rawFields = expression.trim().split(/\s+/)

  if (rawFields.length === 6) {
    return {
      ok: false,
      error:
        '6-field expressions (with a seconds field) are not supported. ' +
        'Use standard 5-field syntax: minute hour day-of-month month day-of-week.',
    }
  }

  if (rawFields.length !== 5) {
    return {
      ok: false,
      error:
        `Expected 5 fields (minute hour day-of-month month day-of-week), ` +
        `got ${rawFields.length}.`,
    }
  }

  const fieldDefs: Array<{ id: FieldName; nameMap: Record<string, number> }> = [
    { id: 'minute', nameMap: {} },
    { id: 'hour', nameMap: {} },
    { id: 'day-of-month', nameMap: {} },
    { id: 'month', nameMap: MONTH_NAME_MAP },
    { id: 'day-of-week', nameMap: DOW_NAME_MAP },
  ]

  const fields: FieldInfo[] = []

  for (let i = 0; i < 5; i++) {
    const raw = rawFields[i]
    const { id, nameMap } = fieldDefs[i]
    const result = expandField(raw, id, nameMap)

    if (typeof result === 'string') {
      return { ok: false, error: result }
    }
    if (result.length === 0) {
      return {
        ok: false,
        error: `Field "${FIELD_LABELS[id]}" expanded to no values — check your expression.`,
      }
    }

    fields.push({ raw, values: result, isWildcard: raw === '*' })
  }

  return {
    ok: true,
    parsed: {
      expression,
      fields: fields as [FieldInfo, FieldInfo, FieldInfo, FieldInfo, FieldInfo],
    },
  }
}

// ── matchesCron ───────────────────────────────────────────────────────────────

/**
 * Test whether a Date matches the parsed cron schedule (local timezone).
 *
 * DOM/DOW semantics (standard Vixie cron):
 *   - Both fields restricted (neither is `*`) → match if DOM **or** DOW matches
 *   - Only one restricted → only that field is checked
 *   - Neither restricted (`* *`) → always matches
 */
export function matchesCron(parsed: ParsedCron, date: Date): boolean {
  const [minF, hourF, domF, monthF, dowF] = parsed.fields

  const cronMonth = date.getMonth() + 1 // JS 0-indexed → cron 1-indexed
  const cronDOM = date.getDate()
  const cronDOW = date.getDay() // 0 = Sunday
  const cronHour = date.getHours()
  const cronMinute = date.getMinutes()

  if (!monthF.values.includes(cronMonth)) return false

  const domRestricted = !domF.isWildcard
  const dowRestricted = !dowF.isWildcard

  let dayMatches: boolean
  if (domRestricted && dowRestricted) {
    dayMatches = domF.values.includes(cronDOM) || dowF.values.includes(cronDOW)
  } else {
    dayMatches = domF.values.includes(cronDOM) && dowF.values.includes(cronDOW)
  }

  if (!dayMatches) return false
  if (!hourF.values.includes(cronHour)) return false
  if (!minF.values.includes(cronMinute)) return false

  return true
}

// ── nextOccurrences ───────────────────────────────────────────────────────────

/**
 * Compute the next `count` occurrences of the schedule after `from`.
 *
 * All Date arithmetic uses local timezone (via Date local methods).
 * The injectable `from` parameter makes results deterministic in tests.
 *
 * Uses a smart skip algorithm that avoids iterating every minute:
 *   1. Skip entire months when the month field won't match.
 *   2. Skip entire days when the day field (DOM/DOW) won't match.
 *   3. Skip entire hours when the hour field won't match.
 *   4. Advance minute-by-minute only within a matching hour.
 *
 * Search stops after 5 years or 700,000 iterations (guards against
 * unsatisfiable schedules such as Feb 30).
 */
export function nextOccurrences(parsed: ParsedCron, from: Date, count: number): Date[] {
  const results: Date[] = []
  // Start from the first full minute strictly after `from`
  let dt = new Date(Math.floor(from.getTime() / 60_000 + 1) * 60_000)

  const maxYear = from.getFullYear() + 5
  const [minF, hourF, domF, monthF, dowF] = parsed.fields

  const domRestricted = !domF.isWildcard
  const dowRestricted = !dowF.isWildcard

  let guard = 0
  const MAX_GUARD = 700_000

  while (results.length < count && dt.getFullYear() <= maxYear) {
    if (guard++ > MAX_GUARD) break

    // ── Month ─────────────────────────────────────────────────────────────────
    const cronMonth = dt.getMonth() + 1
    if (!monthF.values.includes(cronMonth)) {
      dt = new Date(dt.getFullYear(), dt.getMonth() + 1, 1, 0, 0, 0, 0)
      continue
    }

    // ── Day (DOM / DOW with OR semantics) ─────────────────────────────────────
    const cronDOM = dt.getDate()
    const cronDOW = dt.getDay()
    let dayMatches: boolean
    if (domRestricted && dowRestricted) {
      dayMatches = domF.values.includes(cronDOM) || dowF.values.includes(cronDOW)
    } else {
      dayMatches = domF.values.includes(cronDOM) && dowF.values.includes(cronDOW)
    }

    if (!dayMatches) {
      dt = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate() + 1, 0, 0, 0, 0)
      continue
    }

    // ── Hour ──────────────────────────────────────────────────────────────────
    const cronHour = dt.getHours()
    if (!hourF.values.includes(cronHour)) {
      dt = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate(), dt.getHours() + 1, 0, 0, 0)
      continue
    }

    // ── Minute ────────────────────────────────────────────────────────────────
    const cronMinute = dt.getMinutes()
    if (!minF.values.includes(cronMinute)) {
      dt = new Date(
        dt.getFullYear(), dt.getMonth(), dt.getDate(),
        dt.getHours(), dt.getMinutes() + 1, 0, 0,
      )
      continue
    }

    // ── Match ─────────────────────────────────────────────────────────────────
    results.push(new Date(dt))
    dt = new Date(
      dt.getFullYear(), dt.getMonth(), dt.getDate(),
      dt.getHours(), dt.getMinutes() + 1, 0, 0,
    )
  }

  return results
}

// ── describeFieldValues ───────────────────────────────────────────────────────

/**
 * Compact human-readable string describing what a field expands to.
 * Used in the per-field breakdown panel.
 */
export function describeFieldValues(fieldId: FieldName, info: FieldInfo): string {
  if (info.isWildcard) {
    switch (fieldId) {
      case 'minute':        return 'Every minute (0–59)'
      case 'hour':          return 'Every hour (0–23)'
      case 'day-of-month':  return 'Every day of the month (1–31)'
      case 'month':         return 'Every month'
      case 'day-of-week':   return 'Every day of the week'
    }
  }

  const vals = info.values

  switch (fieldId) {
    case 'minute':
    case 'hour':
      if (vals.length > 24) {
        return `${vals[0]}, ${vals[1]}, …, ${vals[vals.length - 1]} (${vals.length} values)`
      }
      return vals.join(', ')

    case 'day-of-month':
      if (vals.length > 15) {
        return `${ordinal(vals[0])} through ${ordinal(vals[vals.length - 1])} (${vals.length} days)`
      }
      return vals.map(ordinal).join(', ')

    case 'month':
      if (vals.length === 12) return 'Every month'
      return vals.map((v) => MONTH_LONG[v]).join(', ')

    case 'day-of-week':
      if (vals.length === 7) return 'Every day of the week'
      return vals.map((v) => DOW_LONG[v]).join(', ')
  }
}

// ── describeCron ──────────────────────────────────────────────────────────────

/** True if values form a contiguous integer sequence. */
function isContiguous(values: number[]): boolean {
  for (let i = 1; i < values.length; i++) {
    if (values[i] !== values[i - 1] + 1) return false
  }
  return true
}

/**
 * Detect a complete `* /N` step pattern starting from `fieldMin` and spanning
 * to `fieldMax`.  Returns the step size only when `values` contains ALL of the
 * values that `* /N` would produce (i.e. the sequence is evenly spaced AND
 * covers the full field).  This prevents short lists like [0,15] from being
 * mistaken for "every 15 minutes" when [0,30,45] are absent.
 */
function detectStep(values: number[], fieldMin: number, fieldMax: number): number | null {
  if (values.length < 2) return null
  if (values[0] !== fieldMin) return null
  const step = values[1] - values[0]
  if (step <= 0) return null
  // Verify the step is uniform across the entire array
  for (let i = 1; i < values.length; i++) {
    if (values[i] - values[i - 1] !== step) return null
  }
  // Verify the array covers the full field (nothing missing)
  const expectedCount = Math.floor((fieldMax - fieldMin) / step) + 1
  if (values.length !== expectedCount) return null
  return step
}

/** English list: "a", "a and b", "a, b, and c". */
function listWithAnd(items: string[]): string {
  if (items.length === 0) return ''
  if (items.length === 1) return items[0]
  if (items.length === 2) return `${items[0]} and ${items[1]}`
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`
}

/** Ordinal list of DOM values without a leading "the". */
function describeDOMOrdinals(values: number[]): string {
  if (values.length === 1) return ordinal(values[0])
  if (isContiguous(values)) {
    return `${ordinal(values[0])} through ${ordinal(values[values.length - 1])}`
  }
  return listWithAnd(values.map(ordinal))
}

/** Human name(s) for DOW values. */
function describeDOWNames(values: number[]): string {
  if (values.length === 7) return 'every day of the week'
  if (isContiguous(values) && values[0] === 1 && values[values.length - 1] === 5) {
    return 'Monday through Friday'
  }
  if (values.length === 2 && values.includes(0) && values.includes(6)) {
    return 'weekends'
  }
  if (values.length === 1) return DOW_LONG[values[0]]
  if (isContiguous(values)) {
    return `${DOW_LONG[values[0]]} through ${DOW_LONG[values[values.length - 1]]}`
  }
  return listWithAnd(values.map((v) => DOW_LONG[v]))
}

/** Human name(s) for month values. */
function describeMonthNames(values: number[]): string {
  if (values.length === 12) return 'every month'
  if (values.length === 1) return MONTH_LONG[values[0]]
  if (isContiguous(values)) {
    return `${MONTH_LONG[values[0]]} through ${MONTH_LONG[values[values.length - 1]]}`
  }
  return listWithAnd(values.map((v) => MONTH_LONG[v]))
}

/**
 * Generate a plain-English description of the cron schedule.
 *
 * Handles common patterns idiomatically; produces a readable (if slightly verbose)
 * fallback for unusual combinations. Capitalises the first letter of the result.
 */
export function describeCron(parsed: ParsedCron): string {
  const [minF, hourF, domF, monthF, dowF] = parsed.fields

  const minIsWild  = minF.isWildcard
  const hourIsWild = hourF.isWildcard
  const domIsWild  = domF.isWildcard
  const monthIsWild = monthF.isWildcard
  const dowIsWild  = dowF.isWildcard

  const minStep  = detectStep(minF.values, 0, 59)
  const hourStep = detectStep(hourF.values, 0, 23)

  // ── Day qualifier ─────────────────────────────────────────────────────────

  let dayQual = ''
  if (!domIsWild && !dowIsWild) {
    // Both restricted → OR semantics
    dayQual =
      `on the ${describeDOMOrdinals(domF.values)} of the month, ` +
      `or on ${describeDOWNames(dowF.values)}`
  } else if (!dowIsWild) {
    dayQual = describeDOWNames(dowF.values)
  } else if (!domIsWild) {
    dayQual = `on the ${describeDOMOrdinals(domF.values)} of the month`
  }

  // ── Month qualifier ───────────────────────────────────────────────────────

  let monthQual = ''
  if (!monthIsWild) {
    monthQual = `in ${describeMonthNames(monthF.values)}`
  }

  // ── Time base ─────────────────────────────────────────────────────────────

  let timeBase: string

  if (minIsWild && hourIsWild) {
    // * * → every minute
    timeBase = 'every minute'
  } else if (minIsWild && !hourIsWild) {
    // * H → every minute in a specific hour window
    if (hourF.values.length === 1) {
      const h = hourF.values[0]
      timeBase = `every minute from ${padTwo(h)}:00 to ${padTwo(h)}:59`
    } else if (isContiguous(hourF.values)) {
      timeBase =
        `every minute from ${padTwo(hourF.values[0])}:00 to ` +
        `${padTwo(hourF.values[hourF.values.length - 1])}:59`
    } else {
      timeBase = `every minute at hours ${hourF.values.join(', ')}`
    }
  } else if (minStep !== null && hourIsWild) {
    // */N * → every N minutes, all hours
    timeBase = minStep === 1 ? 'every minute' : `every ${minStep} minutes`
  } else if (minStep !== null && !hourIsWild) {
    // */N H → every N minutes within specific hours
    const nDesc = minStep === 1 ? 'every minute' : `every ${minStep} minutes`
    if (isContiguous(hourF.values)) {
      timeBase =
        `${nDesc}, between ${padTwo(hourF.values[0])}:00 and ` +
        `${padTwo(hourF.values[hourF.values.length - 1])}:59`
    } else if (hourF.values.length === 1) {
      timeBase = `${nDesc}, during the ${padTwo(hourF.values[0])} hour`
    } else if (hourStep !== null && hourStep > 1) {
      timeBase = `${nDesc}, every ${hourStep} hours`
    } else {
      timeBase = `${nDesc}, at hours ${hourF.values.join(', ')}`
    }
  } else if (minF.values.length === 1 && minF.values[0] === 0 && hourIsWild) {
    // 0 * → at the start of every hour
    timeBase = 'at the start of every hour'
  } else if (minF.values.length === 1 && minF.values[0] === 0 && !hourIsWild) {
    // 0 H → at specific hour(s), on the hour
    if (hourF.values.length === 1) {
      const h = hourF.values[0]
      if (h === 0) timeBase = 'at midnight'
      else if (h === 12) timeBase = 'at noon'
      else timeBase = `at ${padTwo(h)}:00`
    } else if (hourStep !== null && hourStep > 1) {
      timeBase = `every ${hourStep} hours, on the hour`
    } else if (isContiguous(hourF.values)) {
      timeBase =
        `on the hour, from ${padTwo(hourF.values[0])}:00 to ` +
        `${padTwo(hourF.values[hourF.values.length - 1])}:00`
    } else {
      timeBase = `at ${listWithAnd(hourF.values.map((h) => `${padTwo(h)}:00`))}`
    }
  } else if (minF.values.length === 1 && hourIsWild) {
    // M * → specific minute past every hour
    timeBase = `at ${padTwo(minF.values[0])} minutes past every hour`
  } else if (minF.values.length === 1 && hourF.values.length === 1) {
    // M H → one specific time
    const h = hourF.values[0]
    const m = minF.values[0]
    if (h === 0 && m === 0) timeBase = 'at midnight'
    else if (h === 12 && m === 0) timeBase = 'at noon'
    else timeBase = `at ${padTwo(h)}:${padTwo(m)}`
  } else if (minF.values.length === 1 && !hourIsWild) {
    // M H-H → one specific minute within a range of hours
    if (isContiguous(hourF.values)) {
      timeBase =
        `at :${padTwo(minF.values[0])} past the hour, from ` +
        `${padTwo(hourF.values[0])}:00 to ${padTwo(hourF.values[hourF.values.length - 1])}:00`
    } else {
      timeBase = `at ${listWithAnd(hourF.values.map((h) => `${padTwo(h)}:${padTwo(minF.values[0])}`))}`
    }
  } else if (!minIsWild && minF.values.length <= 8 && hourIsWild) {
    // M,M * → multiple specific minutes, every hour
    timeBase = `at ${minF.values.map((m) => `:${padTwo(m)}`).join(', ')} each hour`
  } else if (!minIsWild && hourF.values.length === 1 && minF.values.length <= 8) {
    // M,M H → multiple specific minutes at a specific hour
    const h = hourF.values[0]
    timeBase = `at ${listWithAnd(minF.values.map((m) => `${padTwo(h)}:${padTwo(m)}`))}`
  } else {
    // Generic fallback
    const mPart = minIsWild
      ? 'every minute'
      : `at ${
          minF.values.length <= 6
            ? minF.values.map((m) => `:${padTwo(m)}`).join(', ')
            : `${minF.values.length} minute values`
        } past the hour`
    const hPart = hourIsWild
      ? ''
      : isContiguous(hourF.values)
        ? `, from ${padTwo(hourF.values[0])}:00 to ` +
          `${padTwo(hourF.values[hourF.values.length - 1])}:59`
        : `, at hours ${
            hourF.values.length <= 8
              ? hourF.values.join(', ')
              : `(${hourF.values.length} values)`
          }`
    timeBase = mPart + hPart
  }

  // ── Compose ───────────────────────────────────────────────────────────────

  const parts = [timeBase, dayQual, monthQual].filter(Boolean)
  const result = parts.join(', ')
  return result.charAt(0).toUpperCase() + result.slice(1)
}

// ── Preset examples ───────────────────────────────────────────────────────────

export const CRON_PRESETS: CronPreset[] = [
  {
    label: 'Every minute',
    expression: '* * * * *',
    description: 'Runs every minute of every day',
  },
  {
    label: 'Every 5 minutes',
    expression: '*/5 * * * *',
    description: 'Runs every 5 minutes',
  },
  {
    label: 'Every 15 minutes',
    expression: '*/15 * * * *',
    description: 'Runs every 15 minutes',
  },
  {
    label: 'Hourly',
    expression: '0 * * * *',
    description: 'At the start of every hour',
  },
  {
    label: 'Daily at midnight',
    expression: '0 0 * * *',
    description: 'At midnight every day',
  },
  {
    label: 'Weekdays at 9am',
    expression: '0 9 * * MON-FRI',
    description: 'At 09:00, Monday through Friday',
  },
  {
    label: 'Business hours (15 min)',
    expression: '*/15 9-17 * * MON-FRI',
    description: 'Every 15 minutes, weekdays 09:00–17:59',
  },
  {
    label: '1st of month, midnight',
    expression: '0 0 1 * *',
    description: 'At midnight on the 1st of every month',
  },
  {
    label: 'Every Sunday midnight',
    expression: '0 0 * * SUN',
    description: 'Every Sunday at midnight',
  },
  {
    label: "New Year's midnight",
    expression: '0 0 1 1 *',
    description: 'At midnight on January 1st',
  },
  {
    label: 'Twice daily',
    expression: '0 8,18 * * *',
    description: 'At 08:00 and 18:00 every day',
  },
  {
    label: 'Every 6 hours',
    expression: '0 */6 * * *',
    description: 'At midnight, 06:00, noon, and 18:00',
  },
]
