/**
 * Date Calculator — pure logic (no React, no side-effects)
 *
 * All date arithmetic works on calendar {y,m,d} tuples or noon-UTC Date objects
 * to sidestep timezone/DST pitfalls.
 *
 * Exported functions:
 *   daysBetween          — total days between two calendar dates
 *   businessDaysBetween  — Mon–Fri days between two calendar dates
 *   breakdown            — years/months/days calendar-aware breakdown
 *   weeksAndDays         — total days expressed as weeks + remainder days
 *   addToDate            — add/subtract an amount of a unit from a date
 *   calcAge              — exact age from a birthdate
 *   nextBirthday         — date of the next birthday (handles Feb 29)
 *   countdownTo          — live countdown components from now to a target datetime
 *   todayYMD            — today's calendar date (injectable for tests)
 *   nowMs               — current time in ms (injectable for tests)
 *   ymdToDate           — {y,m,d} → noon-UTC Date
 *   dateToYMD           — Date → {y,m,d} in UTC
 *   formatYMD           — {y,m,d} → "YYYY-MM-DD"
 *   parseYMD            — "YYYY-MM-DD" → {y,m,d} | null
 *   weekdayName         — {y,m,d} → weekday string
 *   isLeapYear          — boolean
 *   daysInMonth         — days in a given month
 */

// ── Calendar types ─────────────────────────────────────────────────────────────

export interface YMD {
  y: number
  m: number // 1–12
  d: number // 1–31
}

// ── Leap year / month helpers ─────────────────────────────────────────────────

export function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0
}

export function daysInMonth(y: number, m: number): number {
  const DAYS = [0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  if (m === 2 && isLeapYear(y)) return 29
  return DAYS[m]
}

// ── YMD ↔ Date conversion (noon UTC to avoid DST boundary issues) ─────────────

/** Convert a {y,m,d} to a Date at noon UTC. */
export function ymdToDate(ymd: YMD): Date {
  return new Date(Date.UTC(ymd.y, ymd.m - 1, ymd.d, 12, 0, 0, 0))
}

/** Extract the UTC {y,m,d} from any Date. */
export function dateToYMD(date: Date): YMD {
  return {
    y: date.getUTCFullYear(),
    m: date.getUTCMonth() + 1,
    d: date.getUTCDate(),
  }
}

/** Format a {y,m,d} as "YYYY-MM-DD". */
export function formatYMD(ymd: YMD): string {
  const mm = String(ymd.m).padStart(2, '0')
  const dd = String(ymd.d).padStart(2, '0')
  return `${ymd.y}-${mm}-${dd}`
}

/** Parse "YYYY-MM-DD" into {y,m,d}, returning null on malformed input. */
export function parseYMD(s: string): YMD | null {
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return null
  const y = parseInt(m[1], 10)
  const mo = parseInt(m[2], 10)
  const d = parseInt(m[3], 10)
  if (mo < 1 || mo > 12) return null
  if (d < 1 || d > daysInMonth(y, mo)) return null
  return { y, m: mo, d }
}

/** Return today's YMD using the injectable `now` parameter (defaults to Date.now()). */
export function todayYMD(nowOverride?: number): YMD {
  return dateToYMD(new Date(nowOverride ?? Date.now()))
}

/** Return current time in ms. */
export function nowMs(): number {
  return Date.now()
}

/** Return weekday name for a {y,m,d}. */
export function weekdayName(ymd: YMD): string {
  const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
  const date = ymdToDate(ymd)
  return DAYS[date.getUTCDay()]
}

// ── Days between ──────────────────────────────────────────────────────────────

/**
 * Count the total calendar days between two dates.
 *
 * When `includeEnd` is true the end date itself is counted
 * (i.e. from Jan 1 to Jan 3 inclusive = 3 days).
 * When false (default) it is the mathematical difference
 * (Jan 1 to Jan 3 = 2 days).
 *
 * Always returns a non-negative number; the order of `a` and `b` doesn't matter.
 */
export function daysBetween(a: YMD, b: YMD, includeEnd = false): number {
  const msA = ymdToDate(a).getTime()
  const msB = ymdToDate(b).getTime()
  const diff = Math.abs(msB - msA)
  const days = Math.round(diff / 86_400_000)
  return includeEnd ? days + 1 : days
}

/**
 * Count Mon–Fri business days between two dates.
 *
 * When `includeEnd` is true, the end date itself is included in the count
 * if it falls on a weekday.
 *
 * No holiday support (noted in UI).
 */
export function businessDaysBetween(a: YMD, b: YMD, includeEnd = false): number {
  // Normalise so start <= end
  let msA = ymdToDate(a).getTime()
  let msB = ymdToDate(b).getTime()
  if (msA > msB) {
    const tmp = msA
    msA = msB
    msB = tmp
  }

  let count = 0
  let cur = msA
  // When not including end, we stop before msB; when including end, we include msB.
  const limit = includeEnd ? msB : msB - 1
  while (cur <= limit) {
    const dow = new Date(cur).getUTCDay() // 0=Sun, 6=Sat
    if (dow !== 0 && dow !== 6) count++
    cur += 86_400_000
  }
  return count
}

// ── Calendar-aware breakdown ──────────────────────────────────────────────────

/**
 * Decompose the difference between two calendar dates into years, months, and
 * remaining days — fully calendar-aware.
 *
 * Uses the addToDate-based approach for correctness:
 *   1. Compute `from + y years + m months`.
 *   2. If that overshoots `to`, reduce m by 1 and recompute.
 *   3. Remaining days = simple calendar-day difference to `to`.
 *
 * This guarantees `days >= 0` for all inputs, including month-end cases like
 * Jan 31 → Mar 1 (= 1 month, 1 day) where the naïve borrow-from-previous-month
 * approach would produce a negative day component.
 *
 * Always treats the earlier date as "from" and the later as "to" so the result
 * is always non-negative. `negative` in the result signals which direction it was.
 */
export interface Breakdown {
  years: number
  months: number
  days: number
  negative: boolean
}

export function breakdown(a: YMD, b: YMD): Breakdown {
  // Determine direction
  const msA = ymdToDate(a).getTime()
  const msB = ymdToDate(b).getTime()
  const negative = msA > msB
  const from = negative ? b : a
  const to = negative ? a : b

  let y = to.y - from.y
  let m = to.m - from.m

  if (m < 0) {
    y -= 1
    m += 12
  }

  // Candidate: from + y years + m months
  const candidate = addToDate(addToDate(from, y, 'years'), m, 'months')
  const candidateMs = ymdToDate(candidate).getTime()
  const toMs = ymdToDate(to).getTime()

  let yy = y
  let mm = m
  let intermediate: YMD

  if (candidateMs > toMs) {
    // Overshot by one month — reduce m by 1
    mm -= 1
    if (mm < 0) {
      mm += 12
      yy -= 1
    }
    intermediate = addToDate(addToDate(from, yy, 'years'), mm, 'months')
  } else {
    intermediate = candidate
    yy = y
    mm = m
  }

  const d = Math.round(
    (ymdToDate(to).getTime() - ymdToDate(intermediate).getTime()) / 86_400_000,
  )

  return { years: yy, months: mm, days: d, negative }
}

/** Express a total number of days as { weeks, days }. */
export interface WeeksAndDays {
  weeks: number
  days: number
}

export function weeksAndDays(totalDays: number): WeeksAndDays {
  const abs = Math.abs(totalDays)
  return { weeks: Math.floor(abs / 7), days: abs % 7 }
}

// ── Add / subtract from a date ────────────────────────────────────────────────

export type AddUnit = 'days' | 'weeks' | 'months' | 'years' | 'businessDays'

/**
 * Add (or subtract) `amount` of `unit` from `date`.
 *
 * Month-end clamping: adding 1 month to Jan 31 → Feb 28/29.
 * Leap day: adding 1 year to Feb 29 → Feb 28 in non-leap years.
 *
 * For `businessDays`, skips Saturday and Sunday when counting steps.
 * Negative `amount` subtracts.
 */
export function addToDate(date: YMD, amount: number, unit: AddUnit): YMD {
  if (amount === 0) return date

  if (unit === 'days') {
    const ms = ymdToDate(date).getTime() + amount * 86_400_000
    return dateToYMD(new Date(ms))
  }

  if (unit === 'weeks') {
    return addToDate(date, amount * 7, 'days')
  }

  if (unit === 'businessDays') {
    const step = amount > 0 ? 1 : -1
    let remaining = Math.abs(amount)
    let ms = ymdToDate(date).getTime()
    while (remaining > 0) {
      ms += step * 86_400_000
      const dow = new Date(ms).getUTCDay()
      if (dow !== 0 && dow !== 6) remaining--
    }
    return dateToYMD(new Date(ms))
  }

  if (unit === 'months') {
    let newY = date.y
    let newM = date.m + amount
    // Normalise month overflow/underflow
    while (newM > 12) {
      newM -= 12
      newY++
    }
    while (newM < 1) {
      newM += 12
      newY--
    }
    // Clamp day to valid range for the new month
    const maxDay = daysInMonth(newY, newM)
    const newD = Math.min(date.d, maxDay)
    return { y: newY, m: newM, d: newD }
  }

  if (unit === 'years') {
    const newY = date.y + amount
    const maxDay = daysInMonth(newY, date.m)
    const newD = Math.min(date.d, maxDay)
    return { y: newY, m: date.m, d: newD }
  }

  return date
}

// ── Age calculator ────────────────────────────────────────────────────────────

export interface AgeResult {
  years: number
  months: number
  days: number
  totalDaysLived: number
  /** Days until the next birthday (0 = birthday is today). */
  daysUntilNextBirthday: number
  nextBirthdayDate: YMD
  /** True when the birth date is Feb 29. */
  isFeb29Birthday: boolean
  /** Note string when Feb 29 birthday is adjusted. */
  feb29Note: string | null
}

/**
 * Calculate exact age from a birth date.
 *
 * `nowOverride` — optional timestamp (ms) for deterministic testing.
 *
 * Feb 29 birthdays: next birthday is Feb 28 in non-leap years
 * (industry-standard; many countries use this legally).
 */
export function calcAge(birth: YMD, nowOverride?: number): AgeResult {
  const today = todayYMD(nowOverride)
  const isFeb29Birthday = birth.m === 2 && birth.d === 29

  const bd = breakdown(birth, today)
  const { years, months, days } = bd

  const totalDaysLived = daysBetween(birth, today, false)

  // Next birthday calculation
  const { nextBirthdayDate, feb29Note } = computeNextBirthday(birth, today)
  const daysUntilNextBirthday = daysBetween(today, nextBirthdayDate, false)

  return {
    years,
    months,
    days,
    totalDaysLived,
    daysUntilNextBirthday,
    nextBirthdayDate,
    isFeb29Birthday,
    feb29Note,
  }
}

// ── Next birthday ─────────────────────────────────────────────────────────────

interface NextBirthdayResult {
  nextBirthdayDate: YMD
  feb29Note: string | null
}

/**
 * Find the date of the next birthday, given `birth` and `today`.
 *
 * - If today IS the birthday → 0 days away (return today).
 * - If the birthday has already passed this year → use next year.
 * - Feb 29 birthdays in non-leap years are celebrated on Feb 28
 *   (and a note is included).
 */
export function computeNextBirthday(birth: YMD, today: YMD): NextBirthdayResult {
  const isFeb29 = birth.m === 2 && birth.d === 29

  // Helper: resolve the birthday in a given year
  function birthdayInYear(y: number): { date: YMD; note: string | null } {
    if (isFeb29 && !isLeapYear(y)) {
      return { date: { y, m: 2, d: 28 }, note: 'Feb 29 birthday observed on Feb 28 in non-leap years.' }
    }
    return { date: { y, m: birth.m, d: birth.d }, note: null }
  }

  // Try this year first
  const thisYear = birthdayInYear(today.y)
  const thisYearMs = ymdToDate(thisYear.date).getTime()
  const todayMs = ymdToDate(today).getTime()

  if (thisYearMs >= todayMs) {
    // Birthday is today or still in the future this year
    return { nextBirthdayDate: thisYear.date, feb29Note: thisYear.note }
  }

  // Birthday already passed this year → use next year
  const nextYear = birthdayInYear(today.y + 1)
  return { nextBirthdayDate: nextYear.date, feb29Note: nextYear.note }
}

// ── Countdown ─────────────────────────────────────────────────────────────────

export interface CountdownResult {
  /** Total milliseconds remaining (negative = in the past). */
  totalMs: number
  days: number
  hours: number
  minutes: number
  seconds: number
  isPast: boolean
}

/**
 * Decompose the difference from `nowMs` to a target datetime (in ms) into
 * days / hours / minutes / seconds.
 *
 * If the target is in the past, `isPast` is true and all components reflect
 * the elapsed time (positive values).
 */
export function countdownTo(targetMs: number, currentMs: number): CountdownResult {
  const diff = targetMs - currentMs
  const isPast = diff < 0
  const abs = Math.abs(diff)

  const totalSeconds = Math.floor(abs / 1000)
  const seconds = totalSeconds % 60
  const totalMinutes = Math.floor(totalSeconds / 60)
  const minutes = totalMinutes % 60
  const totalHours = Math.floor(totalMinutes / 60)
  const hours = totalHours % 24
  const days = Math.floor(totalHours / 24)

  return { totalMs: diff, days, hours, minutes, seconds, isPast }
}
