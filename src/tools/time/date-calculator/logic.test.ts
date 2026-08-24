/**
 * Date Calculator — Vitest unit tests
 */

import { describe, it, expect } from 'vitest'
import {
  isLeapYear,
  daysInMonth,
  parseYMD,
  formatYMD,
  weekdayName,
  daysBetween,
  businessDaysBetween,
  breakdown,
  weeksAndDays,
  addToDate,
  calcAge,
  computeNextBirthday,
  countdownTo,
  todayYMD,
} from './logic'
import type { YMD } from './logic'

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Build a noon-UTC ms timestamp for a given YMD (for nowOverride). */
function noonUTC(y: number, m: number, d: number): number {
  return Date.UTC(y, m - 1, d, 12, 0, 0, 0)
}

// ── isLeapYear ─────────────────────────────────────────────────────────────────

describe('isLeapYear', () => {
  it('2000 is a leap year (divisible by 400)', () => expect(isLeapYear(2000)).toBe(true))
  it('1900 is NOT a leap year (divisible by 100 but not 400)', () => expect(isLeapYear(1900)).toBe(false))
  it('2024 is a leap year (divisible by 4, not by 100)', () => expect(isLeapYear(2024)).toBe(true))
  it('2023 is not a leap year', () => expect(isLeapYear(2023)).toBe(false))
  it('2100 is not a leap year', () => expect(isLeapYear(2100)).toBe(false))
  it('2400 is a leap year', () => expect(isLeapYear(2400)).toBe(true))
})

// ── daysInMonth ────────────────────────────────────────────────────────────────

describe('daysInMonth', () => {
  it('January has 31 days', () => expect(daysInMonth(2023, 1)).toBe(31))
  it('February has 28 days in a non-leap year', () => expect(daysInMonth(2023, 2)).toBe(28))
  it('February has 29 days in a leap year', () => expect(daysInMonth(2024, 2)).toBe(29))
  it('April has 30 days', () => expect(daysInMonth(2023, 4)).toBe(30))
  it('December has 31 days', () => expect(daysInMonth(2023, 12)).toBe(31))
})

// ── parseYMD / formatYMD ───────────────────────────────────────────────────────

describe('parseYMD', () => {
  it('parses a valid date', () => expect(parseYMD('2024-03-15')).toEqual({ y: 2024, m: 3, d: 15 }))
  it('parses epoch', () => expect(parseYMD('1970-01-01')).toEqual({ y: 1970, m: 1, d: 1 }))
  it('parses Feb 29 in leap year', () => expect(parseYMD('2024-02-29')).toEqual({ y: 2024, m: 2, d: 29 }))
  it('returns null for Feb 29 in non-leap year', () => expect(parseYMD('2023-02-29')).toBeNull())
  it('returns null for invalid month 13', () => expect(parseYMD('2023-13-01')).toBeNull())
  it('returns null for month 0', () => expect(parseYMD('2023-00-01')).toBeNull())
  it('returns null for day 0', () => expect(parseYMD('2023-01-00')).toBeNull())
  it('returns null for empty string', () => expect(parseYMD('')).toBeNull())
  it('returns null for wrong format', () => expect(parseYMD('15/03/2024')).toBeNull())
  it('returns null for April 31', () => expect(parseYMD('2023-04-31')).toBeNull())
})

describe('formatYMD', () => {
  it('formats with zero-padding', () => expect(formatYMD({ y: 2024, m: 3, d: 5 })).toBe('2024-03-05'))
  it('formats December 31', () => expect(formatYMD({ y: 2000, m: 12, d: 31 })).toBe('2000-12-31'))
})

// ── weekdayName ────────────────────────────────────────────────────────────────

describe('weekdayName', () => {
  it('2024-01-01 is Monday', () => expect(weekdayName({ y: 2024, m: 1, d: 1 })).toBe('Monday'))
  it('2024-01-06 is Saturday', () => expect(weekdayName({ y: 2024, m: 1, d: 6 })).toBe('Saturday'))
  it('2024-01-07 is Sunday', () => expect(weekdayName({ y: 2024, m: 1, d: 7 })).toBe('Sunday'))
  it('2024-07-04 is Thursday', () => expect(weekdayName({ y: 2024, m: 7, d: 4 })).toBe('Thursday'))
})

// ── todayYMD ───────────────────────────────────────────────────────────────────

describe('todayYMD', () => {
  it('returns the injected date', () => {
    const ts = noonUTC(2024, 6, 15)
    expect(todayYMD(ts)).toEqual({ y: 2024, m: 6, d: 15 })
  })
})

// ── daysBetween ────────────────────────────────────────────────────────────────

describe('daysBetween', () => {
  it('same date → 0 days (exclusive)', () => {
    const d: YMD = { y: 2024, m: 1, d: 1 }
    expect(daysBetween(d, d)).toBe(0)
  })

  it('same date → 1 day (inclusive)', () => {
    const d: YMD = { y: 2024, m: 1, d: 1 }
    expect(daysBetween(d, d, true)).toBe(1)
  })

  it('consecutive days → 1 day (exclusive)', () => {
    expect(daysBetween({ y: 2024, m: 1, d: 1 }, { y: 2024, m: 1, d: 2 })).toBe(1)
  })

  it('consecutive days → 2 days (inclusive)', () => {
    expect(daysBetween({ y: 2024, m: 1, d: 1 }, { y: 2024, m: 1, d: 2 }, true)).toBe(2)
  })

  it('across a month boundary', () => {
    expect(daysBetween({ y: 2024, m: 1, d: 28 }, { y: 2024, m: 2, d: 3 })).toBe(6)
  })

  it('across a leap-year February (2024 has Feb 29)', () => {
    expect(daysBetween({ y: 2024, m: 2, d: 1 }, { y: 2024, m: 3, d: 1 })).toBe(29)
  })

  it('across a non-leap-year February', () => {
    expect(daysBetween({ y: 2023, m: 2, d: 1 }, { y: 2023, m: 3, d: 1 })).toBe(28)
  })

  it('across a year boundary', () => {
    expect(daysBetween({ y: 2023, m: 12, d: 31 }, { y: 2024, m: 1, d: 1 })).toBe(1)
  })

  it('order-independent (b before a)', () => {
    expect(daysBetween({ y: 2024, m: 3, d: 1 }, { y: 2024, m: 2, d: 1 })).toBe(29)
  })

  it('one full year (non-leap)', () => {
    expect(daysBetween({ y: 2023, m: 1, d: 1 }, { y: 2024, m: 1, d: 1 })).toBe(365)
  })

  it('one full year (leap)', () => {
    expect(daysBetween({ y: 2024, m: 1, d: 1 }, { y: 2025, m: 1, d: 1 })).toBe(366)
  })

  it('end of month clamping doesn\'t affect day count', () => {
    // Jan 31 to Mar 31 = 59 days (non-leap 2023)
    expect(daysBetween({ y: 2023, m: 1, d: 31 }, { y: 2023, m: 3, d: 31 })).toBe(59)
  })
})

// ── businessDaysBetween ────────────────────────────────────────────────────────

describe('businessDaysBetween', () => {
  // Week of Mon Jan 1 – Sun Jan 7, 2024
  // Mon=Jan1, Tue=Jan2, Wed=Jan3, Thu=Jan4, Fri=Jan5, Sat=Jan6, Sun=Jan7

  it('Mon to Fri (exclusive) → 4 business days', () => {
    // Mon Jan 1 to Fri Jan 5: Tue+Wed+Thu+Fri = 4 (exclusive of Mon start)
    // Actually business days between: we count Mon,Tue,Wed,Thu = 4 days up to (but not including) Fri
    // Mon Jan 1 → Fri Jan 5 exclusive: count Tue,Wed,Thu,Fri = 4... 
    // Let's be precise: cursor starts at Jan 1, increments while cur < Jan 5
    // Jan 1 Mon ✓, Jan 2 Tue ✓, Jan 3 Wed ✓, Jan 4 Thu ✓ → 4
    expect(businessDaysBetween({ y: 2024, m: 1, d: 1 }, { y: 2024, m: 1, d: 5 })).toBe(4)
  })

  it('Mon to Fri (inclusive) → 5 business days', () => {
    expect(businessDaysBetween({ y: 2024, m: 1, d: 1 }, { y: 2024, m: 1, d: 5 }, true)).toBe(5)
  })

  it('same day weekday exclusive → 0', () => {
    expect(businessDaysBetween({ y: 2024, m: 1, d: 1 }, { y: 2024, m: 1, d: 1 })).toBe(0)
  })

  it('same day weekday inclusive → 1', () => {
    expect(businessDaysBetween({ y: 2024, m: 1, d: 1 }, { y: 2024, m: 1, d: 1 }, true)).toBe(1)
  })

  it('same day weekend exclusive → 0', () => {
    // Jan 6, 2024 is Saturday
    expect(businessDaysBetween({ y: 2024, m: 1, d: 6 }, { y: 2024, m: 1, d: 6 })).toBe(0)
  })

  it('same day weekend inclusive → 0 (weekend days not counted)', () => {
    expect(businessDaysBetween({ y: 2024, m: 1, d: 6 }, { y: 2024, m: 1, d: 6 }, true)).toBe(0)
  })

  it('Sat to Mon (inclusive) → 1 business day (only Mon)', () => {
    // Jan 6 Sat to Jan 8 Mon inclusive → Mon=1
    expect(businessDaysBetween({ y: 2024, m: 1, d: 6 }, { y: 2024, m: 1, d: 8 }, true)).toBe(1)
  })

  it('Fri to Mon (exclusive) → 1 business day (Fri counted, Sat/Sun skipped, Mon excluded)', () => {
    // Start inclusive, end exclusive: Fri Jan 5 counts, Sat/Sun skip, Mon Jan 8 excluded → 1
    expect(businessDaysBetween({ y: 2024, m: 1, d: 5 }, { y: 2024, m: 1, d: 8 })).toBe(1)
  })

  it('order-independent (b before a)', () => {
    expect(businessDaysBetween({ y: 2024, m: 1, d: 5 }, { y: 2024, m: 1, d: 1 }, true)).toBe(5)
  })

  it('two full weeks → 10 business days', () => {
    // Mon Jan 1 to Fri Jan 12 inclusive
    expect(businessDaysBetween({ y: 2024, m: 1, d: 1 }, { y: 2024, m: 1, d: 12 }, true)).toBe(10)
  })

  it('spans a month boundary', () => {
    // Fri Jan 26 to Mon Jan 29 inclusive → Fri,Mon = 2
    expect(businessDaysBetween({ y: 2024, m: 1, d: 26 }, { y: 2024, m: 1, d: 29 }, true)).toBe(2)
  })

  it('spans a year boundary with weekends', () => {
    // Dec 29 Fri 2023 to Jan 3 Wed 2024 inclusive → Fri Dec 29, Mon Jan 1, Tue Jan 2, Wed Jan 3 = 4
    expect(businessDaysBetween({ y: 2023, m: 12, d: 29 }, { y: 2024, m: 1, d: 3 }, true)).toBe(4)
  })
})

// ── breakdown ──────────────────────────────────────────────────────────────────

describe('breakdown', () => {
  it('same date → 0y 0m 0d', () => {
    const d: YMD = { y: 2024, m: 1, d: 1 }
    expect(breakdown(d, d)).toEqual({ years: 0, months: 0, days: 0, negative: false })
  })

  it('exactly 1 year', () => {
    expect(breakdown({ y: 2023, m: 3, d: 15 }, { y: 2024, m: 3, d: 15 }))
      .toEqual({ years: 1, months: 0, days: 0, negative: false })
  })

  it('exactly 1 month', () => {
    expect(breakdown({ y: 2024, m: 1, d: 15 }, { y: 2024, m: 2, d: 15 }))
      .toEqual({ years: 0, months: 1, days: 0, negative: false })
  })

  it('month-end start to same-month-end: Jan 31 → Feb 28 (non-leap) = 1 month', () => {
    // addToDate(Jan31, 1, 'months') = Feb28 (clamped) = to exactly → 0 days remaining
    expect(breakdown({ y: 2023, m: 1, d: 31 }, { y: 2023, m: 2, d: 28 }))
      .toEqual({ years: 0, months: 1, days: 0, negative: false })
  })

  it('year/month/day mix', () => {
    // Feb 14 2020 to Jul 19 2024 = 4y 5m 5d
    expect(breakdown({ y: 2020, m: 2, d: 14 }, { y: 2024, m: 7, d: 19 }))
      .toEqual({ years: 4, months: 5, days: 5, negative: false })
  })

  it('flags negative when a > b', () => {
    const bd = breakdown({ y: 2024, m: 3, d: 1 }, { y: 2024, m: 1, d: 1 })
    expect(bd.negative).toBe(true)
    expect(bd.years).toBe(0)
    expect(bd.months).toBe(2)
    expect(bd.days).toBe(0)
  })

  it('leap day to regular month end', () => {
    // Feb 29 2024 to Mar 1 2024: 0y 0m 1d
    expect(breakdown({ y: 2024, m: 2, d: 29 }, { y: 2024, m: 3, d: 1 }))
      .toEqual({ years: 0, months: 0, days: 1, negative: false })
  })

  it('across a leap February', () => {
    // Jan 1 2024 to Mar 1 2024: 0y 2m 0d
    expect(breakdown({ y: 2024, m: 1, d: 1 }, { y: 2024, m: 3, d: 1 }))
      .toEqual({ years: 0, months: 2, days: 0, negative: false })
  })

  // Month-end start crossing into a shorter destination month (the bug class)
  it('Jan 31 → Mar 1 (non-leap): 1 month 1 day (not negative days)', () => {
    // from Jan 31 + 1 month = Feb 28; to = Mar 1; remaining = 1 day
    const bd = breakdown({ y: 2023, m: 1, d: 31 }, { y: 2023, m: 3, d: 1 })
    expect(bd.days).toBeGreaterThanOrEqual(0)
    expect(bd.months).toBe(1)
    expect(bd.days).toBe(1)
    expect(bd.negative).toBe(false)
  })

  it('Jan 31 → Mar 1 (leap 2024): 1 month 1 day (not negative days)', () => {
    // from Jan 31 + 1 month = Feb 29 (leap); to = Mar 1; remaining = 1 day
    const bd = breakdown({ y: 2024, m: 1, d: 31 }, { y: 2024, m: 3, d: 1 })
    expect(bd.days).toBeGreaterThanOrEqual(0)
    expect(bd.months).toBe(1)
    expect(bd.days).toBe(1)
    expect(bd.negative).toBe(false)
  })

  it('Aug 31 → Oct 1: 1 month 1 day (not negative days)', () => {
    // from Aug 31 + 1 month = Sep 30; to = Oct 1; remaining = 1 day
    const bd = breakdown({ y: 2024, m: 8, d: 31 }, { y: 2024, m: 10, d: 1 })
    expect(bd.days).toBeGreaterThanOrEqual(0)
    expect(bd.months).toBe(1)
    expect(bd.days).toBe(1)
  })

  it('Jan 31 → Apr 30: 3 months 0 days (clamped month-end lands exactly)', () => {
    // from Jan 31 + 3 months = Apr 30 (clamped to max day of April) = to exactly
    const bd = breakdown({ y: 2024, m: 1, d: 31 }, { y: 2024, m: 4, d: 30 })
    expect(bd.days).toBeGreaterThanOrEqual(0)
    expect(bd.months).toBe(3)
    expect(bd.days).toBe(0)
  })

  it('calcAge with Jan 31 birthdate does not produce negative days', () => {
    // Born Jan 31 2000, today = Mar 1 2023 → should have days >= 0
    const now = noonUTC(2023, 3, 1)
    const age = calcAge({ y: 2000, m: 1, d: 31 }, now)
    expect(age.days).toBeGreaterThanOrEqual(0)
    expect(age.years).toBe(23)
    expect(age.months).toBe(1)
    expect(age.days).toBe(1)
  })
})

// ── weeksAndDays ───────────────────────────────────────────────────────────────

describe('weeksAndDays', () => {
  it('0 days → 0w 0d', () => expect(weeksAndDays(0)).toEqual({ weeks: 0, days: 0 }))
  it('7 days → 1w 0d', () => expect(weeksAndDays(7)).toEqual({ weeks: 1, days: 0 }))
  it('8 days → 1w 1d', () => expect(weeksAndDays(8)).toEqual({ weeks: 1, days: 1 }))
  it('6 days → 0w 6d', () => expect(weeksAndDays(6)).toEqual({ weeks: 0, days: 6 }))
  it('365 days → 52w 1d', () => expect(weeksAndDays(365)).toEqual({ weeks: 52, days: 1 }))
})

// ── addToDate ──────────────────────────────────────────────────────────────────

describe('addToDate', () => {
  // ── days ──
  it('adds days', () => {
    expect(addToDate({ y: 2024, m: 1, d: 1 }, 10, 'days')).toEqual({ y: 2024, m: 1, d: 11 })
  })
  it('subtracts days', () => {
    expect(addToDate({ y: 2024, m: 1, d: 11 }, -10, 'days')).toEqual({ y: 2024, m: 1, d: 1 })
  })
  it('rolls over month boundary', () => {
    expect(addToDate({ y: 2024, m: 1, d: 28 }, 5, 'days')).toEqual({ y: 2024, m: 2, d: 2 })
  })
  it('adds 0 days → same date', () => {
    expect(addToDate({ y: 2024, m: 6, d: 15 }, 0, 'days')).toEqual({ y: 2024, m: 6, d: 15 })
  })

  // ── weeks ──
  it('adds 2 weeks', () => {
    expect(addToDate({ y: 2024, m: 1, d: 1 }, 2, 'weeks')).toEqual({ y: 2024, m: 1, d: 15 })
  })

  // ── months ──
  it('adds 1 month: Jan 15 → Feb 15', () => {
    expect(addToDate({ y: 2024, m: 1, d: 15 }, 1, 'months')).toEqual({ y: 2024, m: 2, d: 15 })
  })
  it('month-end clamping: Jan 31 + 1 month → Feb 28 (non-leap)', () => {
    expect(addToDate({ y: 2023, m: 1, d: 31 }, 1, 'months')).toEqual({ y: 2023, m: 2, d: 28 })
  })
  it('month-end clamping: Jan 31 + 1 month → Feb 29 (leap year 2024)', () => {
    expect(addToDate({ y: 2024, m: 1, d: 31 }, 1, 'months')).toEqual({ y: 2024, m: 2, d: 29 })
  })
  it('month-end clamping: Mar 31 + 1 month → Apr 30', () => {
    expect(addToDate({ y: 2024, m: 3, d: 31 }, 1, 'months')).toEqual({ y: 2024, m: 4, d: 30 })
  })
  it('subtracts 1 month: Mar 31 - 1 month → Feb 29 (leap 2024)', () => {
    expect(addToDate({ y: 2024, m: 3, d: 31 }, -1, 'months')).toEqual({ y: 2024, m: 2, d: 29 })
  })
  it('subtracts 1 month: Mar 31 - 1 month → Feb 28 (non-leap 2023)', () => {
    expect(addToDate({ y: 2023, m: 3, d: 31 }, -1, 'months')).toEqual({ y: 2023, m: 2, d: 28 })
  })
  it('rolls over year: Dec + 1 month → Jan next year', () => {
    expect(addToDate({ y: 2024, m: 12, d: 15 }, 1, 'months')).toEqual({ y: 2025, m: 1, d: 15 })
  })
  it('rolls back year: Jan - 1 month → Dec previous year', () => {
    expect(addToDate({ y: 2024, m: 1, d: 15 }, -1, 'months')).toEqual({ y: 2023, m: 12, d: 15 })
  })
  it('adds 13 months (crosses two years)', () => {
    expect(addToDate({ y: 2023, m: 3, d: 15 }, 13, 'months')).toEqual({ y: 2024, m: 4, d: 15 })
  })

  // ── years ──
  it('adds 1 year', () => {
    expect(addToDate({ y: 2023, m: 6, d: 15 }, 1, 'years')).toEqual({ y: 2024, m: 6, d: 15 })
  })
  it('leap day: Feb 29 + 1 year → Feb 28 (non-leap)', () => {
    expect(addToDate({ y: 2024, m: 2, d: 29 }, 1, 'years')).toEqual({ y: 2025, m: 2, d: 28 })
  })
  it('leap day: Feb 29 + 4 years → Feb 29 (next leap year)', () => {
    expect(addToDate({ y: 2024, m: 2, d: 29 }, 4, 'years')).toEqual({ y: 2028, m: 2, d: 29 })
  })
  it('subtracts 1 year', () => {
    expect(addToDate({ y: 2024, m: 6, d: 15 }, -1, 'years')).toEqual({ y: 2023, m: 6, d: 15 })
  })

  // ── businessDays ──
  it('adds 1 business day from Fri → Mon', () => {
    // Jan 5 2024 is Friday
    expect(addToDate({ y: 2024, m: 1, d: 5 }, 1, 'businessDays')).toEqual({ y: 2024, m: 1, d: 8 })
  })
  it('adds 1 business day from Thu → Fri', () => {
    // Jan 4 2024 is Thursday
    expect(addToDate({ y: 2024, m: 1, d: 4 }, 1, 'businessDays')).toEqual({ y: 2024, m: 1, d: 5 })
  })
  it('adds 5 business days from Mon → Mon (next week)', () => {
    // Jan 1 Mon → Jan 8 Mon
    expect(addToDate({ y: 2024, m: 1, d: 1 }, 5, 'businessDays')).toEqual({ y: 2024, m: 1, d: 8 })
  })
  it('subtracts 1 business day from Mon → Fri', () => {
    expect(addToDate({ y: 2024, m: 1, d: 8 }, -1, 'businessDays')).toEqual({ y: 2024, m: 1, d: 5 })
  })
  it('subtracts 5 business days from Mon → previous Mon', () => {
    expect(addToDate({ y: 2024, m: 1, d: 8 }, -5, 'businessDays')).toEqual({ y: 2024, m: 1, d: 1 })
  })
  it('adds business days across month boundary', () => {
    // Jan 30 2024 (Tue) + 3 business days: Wed Jan 31, Thu Feb 1, Fri Feb 2
    expect(addToDate({ y: 2024, m: 1, d: 30 }, 3, 'businessDays')).toEqual({ y: 2024, m: 2, d: 2 })
  })
})

// ── calcAge ────────────────────────────────────────────────────────────────────

describe('calcAge', () => {
  it('exact birthday today → age years increments and 0 days until next birthday', () => {
    // Born Jan 1 1990, today = Jan 1 2024 → age = 34 years exactly
    const now = noonUTC(2024, 1, 1)
    const age = calcAge({ y: 1990, m: 1, d: 1 }, now)
    expect(age.years).toBe(34)
    expect(age.months).toBe(0)
    expect(age.days).toBe(0)
    expect(age.daysUntilNextBirthday).toBe(0)
  })

  it('age mid-year', () => {
    // Born Mar 15 2000, today = Jun 20 2024 → 24y 3m 5d
    const now = noonUTC(2024, 6, 20)
    const age = calcAge({ y: 2000, m: 3, d: 15 }, now)
    expect(age.years).toBe(24)
    expect(age.months).toBe(3)
    expect(age.days).toBe(5)
  })

  it('birthday tomorrow → daysUntilNextBirthday = 1', () => {
    const now = noonUTC(2024, 6, 14)
    const age = calcAge({ y: 2000, m: 6, d: 15 }, now)
    expect(age.daysUntilNextBirthday).toBe(1)
  })

  it('birthday passed this year → counts days to next year birthday', () => {
    // Born Jan 1 1990, today = Jun 15 2024 → next birthday Jan 1 2025
    const now = noonUTC(2024, 6, 15)
    const age = calcAge({ y: 1990, m: 1, d: 1 }, now)
    expect(age.daysUntilNextBirthday).toBeGreaterThan(0)
    expect(age.nextBirthdayDate).toEqual({ y: 2025, m: 1, d: 1 })
  })

  it('totalDaysLived is correct', () => {
    // Born Jan 1 2024, today = Jan 1 2025 → 366 days (2024 is leap)
    const now = noonUTC(2025, 1, 1)
    const age = calcAge({ y: 2024, m: 1, d: 1 }, now)
    expect(age.totalDaysLived).toBe(366)
  })

  it('Feb 29 birthday — non-leap year: observed Feb 28', () => {
    // Born Feb 29 2000, today = Jun 15 2023 (non-leap)
    // Next birthday should be Feb 28 2024 (2024 IS a leap year)
    // Wait — 2023 is non-leap, 2024 is leap.
    // Since birthday passed in 2023 (Feb 28 2023 < Jun 15 2023), next = Feb 29 2024
    const now = noonUTC(2023, 6, 15)
    const age = calcAge({ y: 2000, m: 2, d: 29 }, now)
    expect(age.isFeb29Birthday).toBe(true)
    // 2024 IS a leap year, so next birthday is Feb 29 2024
    expect(age.nextBirthdayDate).toEqual({ y: 2024, m: 2, d: 29 })
    expect(age.feb29Note).toBeNull() // 2024 is a leap year, no note needed
  })

  it('Feb 29 birthday — today is Feb 28 non-leap: birthday today (observed)', () => {
    // Born Feb 29 1996, today = Feb 28 2023 (non-leap)
    const now = noonUTC(2023, 2, 28)
    const age = calcAge({ y: 1996, m: 2, d: 29 }, now)
    expect(age.isFeb29Birthday).toBe(true)
    expect(age.nextBirthdayDate).toEqual({ y: 2023, m: 2, d: 28 })
    expect(age.daysUntilNextBirthday).toBe(0)
    expect(age.feb29Note).toContain('Feb 29')
  })

  it('age 0 for newborn', () => {
    const now = noonUTC(2024, 6, 15)
    const age = calcAge({ y: 2024, m: 6, d: 15 }, now)
    expect(age.years).toBe(0)
    expect(age.months).toBe(0)
    expect(age.days).toBe(0)
    expect(age.totalDaysLived).toBe(0)
  })
})

// ── computeNextBirthday ────────────────────────────────────────────────────────

describe('computeNextBirthday', () => {
  it('birthday is today → 0 days away', () => {
    const today: YMD = { y: 2024, m: 6, d: 15 }
    const result = computeNextBirthday({ y: 2000, m: 6, d: 15 }, today)
    expect(result.nextBirthdayDate).toEqual({ y: 2024, m: 6, d: 15 })
  })

  it('birthday is tomorrow → next is tomorrow', () => {
    const today: YMD = { y: 2024, m: 6, d: 14 }
    const result = computeNextBirthday({ y: 2000, m: 6, d: 15 }, today)
    expect(result.nextBirthdayDate).toEqual({ y: 2024, m: 6, d: 15 })
  })

  it('birthday was yesterday → next is next year', () => {
    const today: YMD = { y: 2024, m: 6, d: 16 }
    const result = computeNextBirthday({ y: 2000, m: 6, d: 15 }, today)
    expect(result.nextBirthdayDate).toEqual({ y: 2025, m: 6, d: 15 })
  })

  it('Feb 29 in a leap year when today is before it', () => {
    // Born Feb 29, today Jan 1 2024 (leap year) → birthday Feb 29 2024
    const today: YMD = { y: 2024, m: 1, d: 1 }
    const result = computeNextBirthday({ y: 2000, m: 2, d: 29 }, today)
    expect(result.nextBirthdayDate).toEqual({ y: 2024, m: 2, d: 29 })
    expect(result.feb29Note).toBeNull()
  })

  it('Feb 29 in a non-leap year: observed Feb 28', () => {
    // Born Feb 29, today Jan 1 2023 (non-leap) → birthday Feb 28 2023
    const today: YMD = { y: 2023, m: 1, d: 1 }
    const result = computeNextBirthday({ y: 2000, m: 2, d: 29 }, today)
    expect(result.nextBirthdayDate).toEqual({ y: 2023, m: 2, d: 28 })
    expect(result.feb29Note).not.toBeNull()
  })

  it('Feb 29 birthday: today is Feb 28 non-leap → birthday today (observed)', () => {
    const today: YMD = { y: 2023, m: 2, d: 28 }
    const result = computeNextBirthday({ y: 2000, m: 2, d: 29 }, today)
    expect(result.nextBirthdayDate).toEqual({ y: 2023, m: 2, d: 28 })
    expect(result.feb29Note).not.toBeNull()
  })

  it('Feb 29 birthday: today is Mar 1 non-leap → next year', () => {
    // Mar 1 2023 → Feb 28 observed has passed → next is Feb 29 2024 (2024 is leap)
    const today: YMD = { y: 2023, m: 3, d: 1 }
    const result = computeNextBirthday({ y: 2000, m: 2, d: 29 }, today)
    expect(result.nextBirthdayDate).toEqual({ y: 2024, m: 2, d: 29 })
    expect(result.feb29Note).toBeNull() // 2024 is leap
  })

  it('regular birthday on Dec 31: before it (Dec 30)', () => {
    const today: YMD = { y: 2024, m: 12, d: 30 }
    const result = computeNextBirthday({ y: 1990, m: 12, d: 31 }, today)
    expect(result.nextBirthdayDate).toEqual({ y: 2024, m: 12, d: 31 })
  })

  it('regular birthday on Dec 31: passed (Jan 1 next year)', () => {
    const today: YMD = { y: 2025, m: 1, d: 1 }
    const result = computeNextBirthday({ y: 1990, m: 12, d: 31 }, today)
    expect(result.nextBirthdayDate).toEqual({ y: 2025, m: 12, d: 31 })
  })
})

// ── countdownTo ────────────────────────────────────────────────────────────────

describe('countdownTo', () => {
  it('exactly 1 day away', () => {
    const now = noonUTC(2024, 1, 1)
    const target = noonUTC(2024, 1, 2)
    const result = countdownTo(target, now)
    expect(result.days).toBe(1)
    expect(result.hours).toBe(0)
    expect(result.minutes).toBe(0)
    expect(result.seconds).toBe(0)
    expect(result.isPast).toBe(false)
  })

  it('exactly 1 hour away', () => {
    const now = noonUTC(2024, 1, 1)
    const target = now + 3_600_000
    const result = countdownTo(target, now)
    expect(result.days).toBe(0)
    expect(result.hours).toBe(1)
    expect(result.minutes).toBe(0)
    expect(result.seconds).toBe(0)
    expect(result.isPast).toBe(false)
  })

  it('exactly 90 minutes away', () => {
    const now = noonUTC(2024, 1, 1)
    const target = now + 90 * 60_000
    const result = countdownTo(target, now)
    expect(result.days).toBe(0)
    expect(result.hours).toBe(1)
    expect(result.minutes).toBe(30)
    expect(result.seconds).toBe(0)
  })

  it('1 day 2 hours 3 minutes 4 seconds away', () => {
    const now = noonUTC(2024, 1, 1)
    const target = now + (1 * 86_400_000 + 2 * 3_600_000 + 3 * 60_000 + 4 * 1000)
    const result = countdownTo(target, now)
    expect(result.days).toBe(1)
    expect(result.hours).toBe(2)
    expect(result.minutes).toBe(3)
    expect(result.seconds).toBe(4)
    expect(result.isPast).toBe(false)
  })

  it('target in the past', () => {
    const now = noonUTC(2024, 1, 2)
    const target = noonUTC(2024, 1, 1)
    const result = countdownTo(target, now)
    expect(result.isPast).toBe(true)
    expect(result.days).toBe(1)
    expect(result.hours).toBe(0)
  })

  it('target exactly now → 0 and not past', () => {
    const now = noonUTC(2024, 1, 1)
    const result = countdownTo(now, now)
    expect(result.days).toBe(0)
    expect(result.hours).toBe(0)
    expect(result.minutes).toBe(0)
    expect(result.seconds).toBe(0)
    expect(result.isPast).toBe(false)
  })

  it('large duration: 365 days', () => {
    const now = noonUTC(2024, 1, 1)
    const target = now + 365 * 86_400_000
    const result = countdownTo(target, now)
    expect(result.days).toBe(365)
    expect(result.hours).toBe(0)
    expect(result.minutes).toBe(0)
    expect(result.seconds).toBe(0)
  })

  it('decomposition: 100000 seconds', () => {
    // 100000 s = 1 day 3 hours 46 minutes 40 seconds
    const now = 0
    const target = 100_000_000 // 100000 seconds in ms
    const result = countdownTo(target, now)
    expect(result.days).toBe(1)
    expect(result.hours).toBe(3)
    expect(result.minutes).toBe(46)
    expect(result.seconds).toBe(40)
  })
})
