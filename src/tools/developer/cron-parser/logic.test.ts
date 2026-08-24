import { describe, it, expect } from 'vitest'
import {
  parseCron,
  matchesCron,
  nextOccurrences,
  describeCron,
  describeFieldValues,
  CRON_PRESETS,
} from './logic'

// ── parseCron — basic validation ──────────────────────────────────────────────

describe('parseCron — empty / whitespace', () => {
  it('rejects empty string', () => {
    const r = parseCron('')
    expect(r.ok).toBe(false)
  })

  it('rejects whitespace-only string', () => {
    const r = parseCron('   ')
    expect(r.ok).toBe(false)
  })

  it('rejects 4-field expression', () => {
    const r = parseCron('0 0 * *')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/5 fields/)
  })

  it('rejects 6-field expression with clear message', () => {
    const r = parseCron('0 0 * * * *')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/6-field/)
  })

  it('rejects 7-field expression', () => {
    const r = parseCron('0 0 * * * * *')
    expect(r.ok).toBe(false)
  })
})

// ── parseCron — wildcards ────────────────────────────────────────────────────

describe('parseCron — wildcards', () => {
  it('accepts "* * * * *" (every minute)', () => {
    const r = parseCron('* * * * *')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.parsed.fields[0].isWildcard).toBe(true)
    expect(r.parsed.fields[0].values).toHaveLength(60) // minutes 0-59
    expect(r.parsed.fields[1].values).toHaveLength(24) // hours 0-23
    expect(r.parsed.fields[2].values).toHaveLength(31) // DOM 1-31
    expect(r.parsed.fields[3].values).toHaveLength(12) // months 1-12
    expect(r.parsed.fields[4].values).toHaveLength(7)  // DOW 0-6
  })

  it('expands * in the minute field to 0-59', () => {
    const r = parseCron('* 0 * * *')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.parsed.fields[0].values[0]).toBe(0)
    expect(r.parsed.fields[0].values[59]).toBe(59)
  })
})

// ── parseCron — step syntax ────────────────────────────────────────────────

describe('parseCron — step syntax', () => {
  it('parses */15 (every 15 minutes)', () => {
    const r = parseCron('*/15 * * * *')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.parsed.fields[0].values).toEqual([0, 15, 30, 45])
  })

  it('parses */2 in hour field', () => {
    const r = parseCron('0 */2 * * *')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.parsed.fields[1].values).toEqual([0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22])
  })

  it('parses range with step: 0-30/10', () => {
    const r = parseCron('0-30/10 * * * *')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.parsed.fields[0].values).toEqual([0, 10, 20, 30])
  })

  it('parses 1-30/5 range with step', () => {
    const r = parseCron('1-30/5 * * * *')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.parsed.fields[0].values).toEqual([1, 6, 11, 16, 21, 26])
  })

  it('parses single-value with step: 5/10 → 5,15,25,35,45,55', () => {
    const r = parseCron('5/10 * * * *')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.parsed.fields[0].values).toEqual([5, 15, 25, 35, 45, 55])
  })

  it('parses */6 in hour field', () => {
    const r = parseCron('0 */6 * * *')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.parsed.fields[1].values).toEqual([0, 6, 12, 18])
  })

  it('rejects step of 0', () => {
    const r = parseCron('*/0 * * * *')
    expect(r.ok).toBe(false)
  })

  it('rejects non-numeric step', () => {
    const r = parseCron('*/x * * * *')
    expect(r.ok).toBe(false)
  })
})

// ── parseCron — ranges ─────────────────────────────────────────────────────

describe('parseCron — ranges', () => {
  it('parses 9-17 in hour field', () => {
    const r = parseCron('0 9-17 * * *')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.parsed.fields[1].values).toEqual([9, 10, 11, 12, 13, 14, 15, 16, 17])
  })

  it('parses 1-5 in DOW field', () => {
    const r = parseCron('0 0 * * 1-5')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.parsed.fields[4].values).toEqual([1, 2, 3, 4, 5])
  })

  it('rejects inverted range for non-DOW fields', () => {
    const r = parseCron('30-10 * * * *')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/range/)
  })
})

// ── parseCron — lists ──────────────────────────────────────────────────────

describe('parseCron — lists', () => {
  it('parses comma-separated list: 0,15,30,45', () => {
    const r = parseCron('0,15,30,45 * * * *')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.parsed.fields[0].values).toEqual([0, 15, 30, 45])
  })

  it('deduplicates list values', () => {
    const r = parseCron('1,1,2,3 * * * *')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.parsed.fields[0].values).toEqual([1, 2, 3])
  })

  it('parses list mixing range and values: 1-3,7,9', () => {
    const r = parseCron('1-3,7,9 * * * *')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.parsed.fields[0].values).toEqual([1, 2, 3, 7, 9])
  })

  it('rejects trailing comma', () => {
    const r = parseCron('1,2, * * * *')
    expect(r.ok).toBe(false)
  })
})

// ── parseCron — month name aliases ──────────────────────────────────────────

describe('parseCron — month name aliases', () => {
  it('parses JAN as 1', () => {
    const r = parseCron('0 0 * JAN *')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.parsed.fields[3].values).toEqual([1])
  })

  it('parses DEC as 12', () => {
    const r = parseCron('0 0 * DEC *')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.parsed.fields[3].values).toEqual([12])
  })

  it('parses month names case-insensitively', () => {
    const r = parseCron('0 0 * jan-mar *')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.parsed.fields[3].values).toEqual([1, 2, 3])
  })

  it('parses MAR-OCT range', () => {
    const r = parseCron('0 0 * MAR-OCT *')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.parsed.fields[3].values).toEqual([3, 4, 5, 6, 7, 8, 9, 10])
  })

  it('parses JAN,JUN,DEC list', () => {
    const r = parseCron('0 0 * JAN,JUN,DEC *')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.parsed.fields[3].values).toEqual([1, 6, 12])
  })

  it('rejects unknown month name', () => {
    const r = parseCron('0 0 * FOO *')
    expect(r.ok).toBe(false)
  })
})

// ── parseCron — day-of-week name aliases ─────────────────────────────────────

describe('parseCron — day-of-week name aliases', () => {
  it('parses SUN as 0', () => {
    const r = parseCron('0 0 * * SUN')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.parsed.fields[4].values).toEqual([0])
  })

  it('parses SAT as 6', () => {
    const r = parseCron('0 0 * * SAT')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.parsed.fields[4].values).toEqual([6])
  })

  it('parses numeric 7 as Sunday (0)', () => {
    const r = parseCron('0 0 * * 7')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.parsed.fields[4].values).toEqual([0])
  })

  it('parses MON-FRI range', () => {
    const r = parseCron('0 9 * * MON-FRI')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.parsed.fields[4].values).toEqual([1, 2, 3, 4, 5])
  })

  it('parses DOW names case-insensitively', () => {
    const r = parseCron('0 0 * * mon,wed,fri')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.parsed.fields[4].values).toEqual([1, 3, 5])
  })

  it('normalises both 0 and 7 to Sunday in a list', () => {
    const r = parseCron('0 0 * * 0,7')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    // Both 0 and 7 map to 0 → deduped
    expect(r.parsed.fields[4].values).toEqual([0])
  })

  it('rejects unknown DOW name', () => {
    const r = parseCron('0 0 * * XYZ')
    expect(r.ok).toBe(false)
  })
})

// ── parseCron — out-of-range values ──────────────────────────────────────────

describe('parseCron — out-of-range values', () => {
  it('rejects minute > 59', () => {
    const r = parseCron('60 * * * *')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/out of range/)
  })

  it('rejects hour > 23', () => {
    const r = parseCron('0 24 * * *')
    expect(r.ok).toBe(false)
  })

  it('rejects DOM < 1', () => {
    const r = parseCron('0 0 0 * *')
    expect(r.ok).toBe(false)
  })

  it('rejects DOM > 31', () => {
    const r = parseCron('0 0 32 * *')
    expect(r.ok).toBe(false)
  })

  it('rejects month 0', () => {
    const r = parseCron('0 0 * 0 *')
    expect(r.ok).toBe(false)
  })

  it('rejects month 13', () => {
    const r = parseCron('0 0 * 13 *')
    expect(r.ok).toBe(false)
  })

  it('rejects DOW > 7', () => {
    const r = parseCron('0 0 * * 8')
    expect(r.ok).toBe(false)
  })
})

// ── parseCron — macros ───────────────────────────────────────────────────────

describe('parseCron — macros', () => {
  it('expands @hourly to "0 * * * *"', () => {
    const r = parseCron('@hourly')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.parsed.expression).toBe('0 * * * *')
    expect(r.parsed.fields[0].values).toEqual([0])
    expect(r.parsed.fields[1].isWildcard).toBe(true)
  })

  it('expands @daily to "0 0 * * *"', () => {
    const r = parseCron('@daily')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.parsed.expression).toBe('0 0 * * *')
  })

  it('expands @midnight to "0 0 * * *"', () => {
    const r = parseCron('@midnight')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.parsed.expression).toBe('0 0 * * *')
  })

  it('expands @weekly to "0 0 * * 0"', () => {
    const r = parseCron('@weekly')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.parsed.expression).toBe('0 0 * * 0')
    expect(r.parsed.fields[4].values).toEqual([0])
  })

  it('expands @monthly to "0 0 1 * *"', () => {
    const r = parseCron('@monthly')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.parsed.expression).toBe('0 0 1 * *')
  })

  it('expands @yearly to "0 0 1 1 *"', () => {
    const r = parseCron('@yearly')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.parsed.expression).toBe('0 0 1 1 *')
    expect(r.parsed.fields[3].values).toEqual([1])
  })

  it('expands @annually (same as @yearly)', () => {
    const r = parseCron('@annually')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.parsed.expression).toBe('0 0 1 1 *')
  })

  it('expands macros case-insensitively', () => {
    const r = parseCron('@DAILY')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.parsed.expression).toBe('0 0 * * *')
  })

  it('rejects unknown macro with helpful message', () => {
    const r = parseCron('@reboot')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/@reboot/)
  })
})

// ── matchesCron — DOM/DOW OR semantics ───────────────────────────────────────

describe('matchesCron — DOM/DOW OR semantics', () => {
  it('when both DOM and DOW restricted, matches if DOM matches (OR)', () => {
    // "0 0 1 * MON" — first of month OR Monday; test with 1st of a month that's not Monday
    // 2024-07-01 is a Monday, but let's use 2024-01-01 which is a Monday too
    // Use 2024-02-01 (Thursday) — DOM matches (1st), DOW does not (Thursday ≠ Monday)
    const r = parseCron('0 0 1 * 1')  // 1st of month OR Monday
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const dt = new Date(2024, 1, 1, 0, 0) // Thursday 2024-02-01
    expect(matchesCron(r.parsed, dt)).toBe(true)
  })

  it('when both DOM and DOW restricted, matches if DOW matches (OR)', () => {
    // "0 0 1 * 1" — 1st of month OR Monday; test with a Monday that isn't the 1st
    const r = parseCron('0 0 1 * 1')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const dt = new Date(2024, 0, 8, 0, 0) // Monday 2024-01-08
    expect(matchesCron(r.parsed, dt)).toBe(true)
  })

  it('when both DOM and DOW restricted, no-match if neither matches', () => {
    // "0 0 1 * 1" — 1st of month OR Monday; test with a Wednesday the 3rd
    const r = parseCron('0 0 1 * 1')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const dt = new Date(2024, 0, 3, 0, 0) // Wednesday 2024-01-03
    expect(matchesCron(r.parsed, dt)).toBe(false)
  })

  it('when only DOW restricted, ignores DOM and matches on DOW alone', () => {
    const r = parseCron('0 0 * * 1')  // Every Monday
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const mon = new Date(2024, 0, 8, 0, 0) // Monday 2024-01-08
    const tue = new Date(2024, 0, 9, 0, 0) // Tuesday 2024-01-09
    expect(matchesCron(r.parsed, mon)).toBe(true)
    expect(matchesCron(r.parsed, tue)).toBe(false)
  })

  it('when only DOM restricted, ignores DOW and matches on DOM alone', () => {
    const r = parseCron('0 0 15 * *')  // 15th of every month
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const match = new Date(2024, 0, 15, 0, 0)
    const noMatch = new Date(2024, 0, 14, 0, 0)
    expect(matchesCron(r.parsed, match)).toBe(true)
    expect(matchesCron(r.parsed, noMatch)).toBe(false)
  })
})

// ── nextOccurrences — basic correctness ──────────────────────────────────────

describe('nextOccurrences — basic', () => {
  it('returns exactly count results for a simple every-minute schedule', () => {
    const r = parseCron('* * * * *')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const from = new Date(2024, 0, 1, 0, 0, 0)
    const results = nextOccurrences(r.parsed, from, 10)
    expect(results).toHaveLength(10)
  })

  it('every-minute results are 1 minute apart', () => {
    const r = parseCron('* * * * *')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const from = new Date(2024, 0, 1, 0, 0, 30) // 30 seconds in
    const results = nextOccurrences(r.parsed, from, 5)
    for (let i = 1; i < results.length; i++) {
      expect(results[i].getTime() - results[i - 1].getTime()).toBe(60_000)
    }
  })

  it('first occurrence is strictly after the from time', () => {
    const r = parseCron('* * * * *')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const from = new Date(2024, 0, 1, 0, 0, 0)
    const results = nextOccurrences(r.parsed, from, 1)
    expect(results[0].getTime()).toBeGreaterThan(from.getTime())
  })

  it('every 15 minutes from a known point', () => {
    const r = parseCron('*/15 * * * *')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    // From 2024-01-01 00:00:00 → next is 00:15, 00:30, 00:45, 01:00 …
    const from = new Date(2024, 0, 1, 0, 0, 0)
    const results = nextOccurrences(r.parsed, from, 4)
    expect(results[0]).toEqual(new Date(2024, 0, 1, 0, 15, 0))
    expect(results[1]).toEqual(new Date(2024, 0, 1, 0, 30, 0))
    expect(results[2]).toEqual(new Date(2024, 0, 1, 0, 45, 0))
    expect(results[3]).toEqual(new Date(2024, 0, 1, 1, 0, 0))
  })

  it('@daily next occurrences are 24 hours apart', () => {
    const r = parseCron('@daily')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const from = new Date(2024, 0, 1, 0, 0, 30) // just after midnight
    const results = nextOccurrences(r.parsed, from, 3)
    // Next midnight is Jan 2nd
    expect(results[0]).toEqual(new Date(2024, 0, 2, 0, 0, 0))
    expect(results[1]).toEqual(new Date(2024, 0, 3, 0, 0, 0))
    expect(results[2]).toEqual(new Date(2024, 0, 4, 0, 0, 0))
  })

  it('weekday-only schedule (MON-FRI 9am) skips weekends', () => {
    const r = parseCron('0 9 * * MON-FRI')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    // 2024-01-05 is Friday; from Thursday 2024-01-04 09:00:01
    const from = new Date(2024, 0, 4, 9, 0, 1)
    const results = nextOccurrences(r.parsed, from, 3)
    // Next: Friday Jan 5, Monday Jan 8, Tuesday Jan 9
    expect(results[0]).toEqual(new Date(2024, 0, 5, 9, 0, 0))
    expect(results[1]).toEqual(new Date(2024, 0, 8, 9, 0, 0))
    expect(results[2]).toEqual(new Date(2024, 0, 9, 9, 0, 0))
  })
})

// ── nextOccurrences — month/year rollover ─────────────────────────────────────

describe('nextOccurrences — month rollover', () => {
  it('crosses month boundary correctly', () => {
    const r = parseCron('0 0 * * *') // midnight every day
    expect(r.ok).toBe(true)
    if (!r.ok) return
    // From Jan 31 at 00:00:01 → next is Feb 1 midnight
    const from = new Date(2024, 0, 31, 0, 0, 1)
    const results = nextOccurrences(r.parsed, from, 2)
    expect(results[0]).toEqual(new Date(2024, 1, 1, 0, 0, 0)) // Feb 1
    expect(results[1]).toEqual(new Date(2024, 1, 2, 0, 0, 0)) // Feb 2
  })

  it('crosses year boundary correctly', () => {
    const r = parseCron('0 0 * * *')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const from = new Date(2024, 11, 31, 0, 0, 1) // Dec 31
    const results = nextOccurrences(r.parsed, from, 1)
    expect(results[0]).toEqual(new Date(2025, 0, 1, 0, 0, 0)) // Jan 1 2025
  })

  it('monthly schedule (1st midnight) skips to next month', () => {
    const r = parseCron('@monthly')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    // From Jan 1 00:00:01 → next is Feb 1 midnight
    const from = new Date(2024, 0, 1, 0, 0, 1)
    const results = nextOccurrences(r.parsed, from, 3)
    expect(results[0]).toEqual(new Date(2024, 1, 1, 0, 0, 0))
    expect(results[1]).toEqual(new Date(2024, 2, 1, 0, 0, 0))
    expect(results[2]).toEqual(new Date(2024, 3, 1, 0, 0, 0))
  })
})

// ── nextOccurrences — leap year (Feb 29) ─────────────────────────────────────

describe('nextOccurrences — leap year', () => {
  it('finds Feb 29 occurrence in a leap year', () => {
    const r = parseCron('0 0 29 2 *') // Feb 29 midnight
    expect(r.ok).toBe(true)
    if (!r.ok) return
    // 2024 is a leap year
    const from = new Date(2024, 0, 1, 0, 0, 0)
    const results = nextOccurrences(r.parsed, from, 1)
    expect(results).toHaveLength(1)
    expect(results[0]).toEqual(new Date(2024, 1, 29, 0, 0, 0))
  })

  it('skips non-leap years for Feb 29 schedule', () => {
    const r = parseCron('0 0 29 2 *') // Feb 29 midnight
    expect(r.ok).toBe(true)
    if (!r.ok) return
    // 2025, 2026, 2027 are not leap years; next is 2028
    const from = new Date(2024, 1, 29, 0, 0, 1) // just after 2024 Feb 29
    const results = nextOccurrences(r.parsed, from, 1)
    // Next leap year is 2028
    expect(results).toHaveLength(1)
    expect(results[0].getFullYear()).toBe(2028)
    expect(results[0].getMonth()).toBe(1) // February
    expect(results[0].getDate()).toBe(29)
  })
})

// ── nextOccurrences — DOM/DOW OR semantics in nextOccurrences ─────────────────

describe('nextOccurrences — DOM/DOW OR semantics', () => {
  it('DOM OR DOW: generates runs on either the 1st or every Monday', () => {
    const r = parseCron('0 0 1 * 1') // 1st of month OR Monday
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const from = new Date(2024, 0, 1, 0, 0, 0) // Jan 1 midnight exactly
    const results = nextOccurrences(r.parsed, from, 6)
    for (const dt of results) {
      const dom = dt.getDate()
      const dow = dt.getDay()
      expect(dom === 1 || dow === 1).toBe(true)
    }
  })
})

// ── describeCron ──────────────────────────────────────────────────────────────

describe('describeCron — wildcard schedules', () => {
  it('"* * * * *" → every minute', () => {
    const r = parseCron('* * * * *')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(describeCron(r.parsed).toLowerCase()).toContain('every minute')
  })

  it('"0 * * * *" → at the start of every hour', () => {
    const r = parseCron('0 * * * *')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(describeCron(r.parsed).toLowerCase()).toContain('every hour')
  })
})

describe('describeCron — step schedules', () => {
  it('"*/15 * * * *" → every 15 minutes', () => {
    const r = parseCron('*/15 * * * *')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(describeCron(r.parsed).toLowerCase()).toContain('every 15 minutes')
  })

  it('"*/5 * * * *" → every 5 minutes', () => {
    const r = parseCron('*/5 * * * *')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(describeCron(r.parsed).toLowerCase()).toContain('every 5 minutes')
  })

  it('"*/15 9-17 * * MON-FRI" → mentions weekdays and 09-17', () => {
    const r = parseCron('*/15 9-17 * * MON-FRI')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const desc = describeCron(r.parsed).toLowerCase()
    expect(desc).toContain('15 minutes')
    expect(desc).toMatch(/mon(day)? through fri(day)?/)
  })

  // Regression: short finite lists must NOT be confused with a full */N step
  it('"0,15 * * * *" is NOT described as "every 15 minutes"', () => {
    const r = parseCron('0,15 * * * *')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const desc = describeCron(r.parsed).toLowerCase()
    // Must not claim it runs every 15 minutes when :30 and :45 are absent
    expect(desc).not.toBe('every 15 minutes')
    // Should mention the specific values 00 and 15
    expect(desc).toContain(':00')
    expect(desc).toContain(':15')
  })

  it('"0,1 * * * *" is NOT described as "every minute"', () => {
    const r = parseCron('0,1 * * * *')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const desc = describeCron(r.parsed).toLowerCase()
    // Must not claim "every minute" when only 0 and 1 are set
    expect(desc).not.toMatch(/^every minute$/)
  })

  it('"0 0,2 * * *" is NOT described as "every 2 hours"', () => {
    const r = parseCron('0 0,2 * * *')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const desc = describeCron(r.parsed).toLowerCase()
    // Only 00:00 and 02:00 — must not claim "every 2 hours"
    expect(desc).not.toContain('every 2 hours')
  })
})

describe('describeCron — fixed times', () => {
  it('"0 0 * * *" → midnight', () => {
    const r = parseCron('0 0 * * *')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(describeCron(r.parsed).toLowerCase()).toContain('midnight')
  })

  it('"0 12 * * *" → noon or 12:00', () => {
    const r = parseCron('0 12 * * *')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const desc = describeCron(r.parsed).toLowerCase()
    expect(desc.includes('noon') || desc.includes('12:00')).toBe(true)
  })

  it('"0 9 * * MON-FRI" → weekdays 09:00', () => {
    const r = parseCron('0 9 * * MON-FRI')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const desc = describeCron(r.parsed)
    expect(desc).toContain('09:00')
    expect(desc.toLowerCase()).toMatch(/mon/)
  })
})

describe('describeCron — monthly / yearly', () => {
  it('"0 0 1 * *" → midnight on the 1st', () => {
    const r = parseCron('0 0 1 * *')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const desc = describeCron(r.parsed).toLowerCase()
    expect(desc).toContain('1st')
    expect(desc).toContain('month')
  })

  it('"0 0 1 1 *" → midnight, January 1st', () => {
    const r = parseCron('0 0 1 1 *')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const desc = describeCron(r.parsed).toLowerCase()
    expect(desc).toContain('january')
  })
})

// ── describeFieldValues ───────────────────────────────────────────────────────

describe('describeFieldValues', () => {
  it('wildcard minute → mentions every minute', () => {
    const r = parseCron('* * * * *')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const s = describeFieldValues('minute', r.parsed.fields[0])
    expect(s.toLowerCase()).toContain('every minute')
  })

  it('wildcard month → mentions every month', () => {
    const r = parseCron('* * * * *')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const s = describeFieldValues('month', r.parsed.fields[3])
    expect(s.toLowerCase()).toContain('every month')
  })

  it('DOW MON-FRI → lists days', () => {
    const r = parseCron('0 0 * * MON-FRI')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const s = describeFieldValues('day-of-week', r.parsed.fields[4])
    expect(s).toContain('Monday')
    expect(s).toContain('Friday')
  })

  it('month JAN,JUN,DEC → lists month names', () => {
    const r = parseCron('0 0 * JAN,JUN,DEC *')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const s = describeFieldValues('month', r.parsed.fields[3])
    expect(s).toContain('January')
    expect(s).toContain('June')
    expect(s).toContain('December')
  })

  it('DOM 1st → uses ordinal', () => {
    const r = parseCron('0 0 1 * *')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const s = describeFieldValues('day-of-month', r.parsed.fields[2])
    expect(s).toContain('1st')
  })

  // Regression: a 7-element DOM range must NOT say "Every day of the week"
  it('DOM 1-7 → does NOT say "Every day of the week"', () => {
    const r = parseCron('0 0 1-7 * *')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const s = describeFieldValues('day-of-month', r.parsed.fields[2])
    expect(s.toLowerCase()).not.toContain('week')
    expect(s).toContain('1st')
    expect(s).toContain('7th')
  })
})

// ── CRON_PRESETS ──────────────────────────────────────────────────────────────

describe('CRON_PRESETS', () => {
  it('has at least 8 presets', () => {
    expect(CRON_PRESETS.length).toBeGreaterThanOrEqual(8)
  })

  it('every preset has a non-empty label, expression, and description', () => {
    for (const p of CRON_PRESETS) {
      expect(p.label.length).toBeGreaterThan(0)
      expect(p.expression.length).toBeGreaterThan(0)
      expect(p.description.length).toBeGreaterThan(0)
    }
  })

  it('every preset expression parses without error', () => {
    for (const p of CRON_PRESETS) {
      const r = parseCron(p.expression)
      if (!r.ok) {
        throw new Error(`Preset "${p.label}" failed: ${r.error}`)
      }
      expect(r.ok).toBe(true)
    }
  })

  it('every preset produces at least 1 next occurrence', () => {
    const from = new Date(2024, 0, 1, 0, 0, 0)
    for (const p of CRON_PRESETS) {
      const r = parseCron(p.expression)
      expect(r.ok).toBe(true)
      if (!r.ok) continue
      const results = nextOccurrences(r.parsed, from, 1)
      expect(results.length).toBeGreaterThanOrEqual(1)
    }
  })
})

// ── Edge cases ────────────────────────────────────────────────────────────────

describe('edge cases', () => {
  it('expression with extra whitespace is accepted', () => {
    const r = parseCron('  */15   *  *  *  * ')
    expect(r.ok).toBe(true)
  })

  it('all-wildcard DOW includes Sunday (0) through Saturday (6)', () => {
    const r = parseCron('* * * * *')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.parsed.fields[4].values).toContain(0)
    expect(r.parsed.fields[4].values).toContain(6)
    expect(r.parsed.fields[4].values).toHaveLength(7)
  })

  it('all-wildcard hour has 0 and 23', () => {
    const r = parseCron('* * * * *')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.parsed.fields[1].values[0]).toBe(0)
    expect(r.parsed.fields[1].values[23]).toBe(23)
  })

  it('"0 8,18 * * *" — twice-daily — produces correct times', () => {
    const r = parseCron('0 8,18 * * *')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const from = new Date(2024, 0, 1, 0, 0, 0)
    const results = nextOccurrences(r.parsed, from, 4)
    expect(results[0]).toEqual(new Date(2024, 0, 1, 8, 0, 0))
    expect(results[1]).toEqual(new Date(2024, 0, 1, 18, 0, 0))
    expect(results[2]).toEqual(new Date(2024, 0, 2, 8, 0, 0))
    expect(results[3]).toEqual(new Date(2024, 0, 2, 18, 0, 0))
  })

  it('@yearly produces exactly Jan 1 midnight occurrences', () => {
    const r = parseCron('@yearly')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const from = new Date(2024, 0, 1, 0, 0, 1)
    const results = nextOccurrences(r.parsed, from, 3)
    expect(results[0]).toEqual(new Date(2025, 0, 1, 0, 0, 0))
    expect(results[1]).toEqual(new Date(2026, 0, 1, 0, 0, 0))
    expect(results[2]).toEqual(new Date(2027, 0, 1, 0, 0, 0))
  })

  it('returns fewer than count results for an unsatisfiable-in-timeframe schedule', () => {
    // Feb 30 never exists — schedule will return 0 occurrences within the guard window
    const r = parseCron('0 0 30 2 *')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const from = new Date(2024, 0, 1, 0, 0, 0)
    const results = nextOccurrences(r.parsed, from, 10)
    expect(results.length).toBe(0) // Feb never has a 30th
  })
})
