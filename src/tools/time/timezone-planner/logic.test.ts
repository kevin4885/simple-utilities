/**
 * Timezone Meeting Planner — logic unit tests
 */

import { describe, it, expect } from 'vitest'
import {
  getZoneOffsetMinutes,
  getLocalDateStr,
  getLocalHour,
  getLocalTimeStr,
  findLocalMidnightUtc,
  buildHourGrid,
  classifyHour,
  computeOverlap,
  getFriendlyLabel,
  formatOffset,
  formatConsecutiveHours,
  getDayDiff,
  isValidIanaZone,
  getSupportedZones,
  FALLBACK_ZONES,
  WORK_START,
  WORK_END,
} from './logic'
import type { ZoneEntry } from './logic'

// ── getZoneOffsetMinutes ───────────────────────────────────────────────────────

describe('getZoneOffsetMinutes', () => {
  it('returns 0 for UTC', () => {
    const d = new Date('2024-06-15T12:00:00Z')
    expect(getZoneOffsetMinutes('UTC', d)).toBe(0)
  })

  it('returns −300 for America/New_York in standard time (January)', () => {
    // EST = UTC−5 = −300 min
    const d = new Date('2024-01-15T12:00:00Z')
    expect(getZoneOffsetMinutes('America/New_York', d)).toBe(-300)
  })

  it('returns −240 for America/New_York in summer (July, DST)', () => {
    // EDT = UTC−4 = −240 min
    const d = new Date('2024-07-15T12:00:00Z')
    expect(getZoneOffsetMinutes('America/New_York', d)).toBe(-240)
  })

  it('returns +0 for Europe/London in standard time (January)', () => {
    // GMT = UTC+0
    const d = new Date('2024-01-15T12:00:00Z')
    expect(getZoneOffsetMinutes('Europe/London', d)).toBe(0)
  })

  it('returns +60 for Europe/London in summer (July, BST)', () => {
    // BST = UTC+1 = +60 min
    const d = new Date('2024-07-15T12:00:00Z')
    expect(getZoneOffsetMinutes('Europe/London', d)).toBe(60)
  })

  it('returns +330 for Asia/Kolkata (IST, no DST)', () => {
    const d = new Date('2024-06-15T12:00:00Z')
    expect(getZoneOffsetMinutes('Asia/Kolkata', d)).toBe(330)
  })

  it('returns +540 for Asia/Tokyo (JST, no DST)', () => {
    const d = new Date('2024-06-15T12:00:00Z')
    expect(getZoneOffsetMinutes('Asia/Tokyo', d)).toBe(540)
  })

  // DST boundary: America/New_York springs forward 2024-03-10 at 02:00
  it('returns −300 just before DST spring-forward in America/New_York (2024-03-10 06:59Z = 01:59 EST)', () => {
    // 2024-03-10T06:59:59Z = 01:59:59 EST (still standard time)
    const d = new Date('2024-03-10T06:59:59Z')
    expect(getZoneOffsetMinutes('America/New_York', d)).toBe(-300)
  })

  it('returns −240 just after DST spring-forward in America/New_York (2024-03-10 07:01Z = 03:01 EDT)', () => {
    // 2024-03-10T07:01:00Z = 03:01:00 EDT (after spring-forward)
    const d = new Date('2024-03-10T07:01:00Z')
    expect(getZoneOffsetMinutes('America/New_York', d)).toBe(-240)
  })

  // DST boundary: Europe/London springs forward 2024-03-31 at 01:00
  it('returns 0 just before Europe/London spring-forward (2024-03-31 00:59Z)', () => {
    const d = new Date('2024-03-31T00:59:59Z')
    expect(getZoneOffsetMinutes('Europe/London', d)).toBe(0)
  })

  it('returns +60 just after Europe/London spring-forward (2024-03-31 01:01Z)', () => {
    const d = new Date('2024-03-31T01:01:00Z')
    expect(getZoneOffsetMinutes('Europe/London', d)).toBe(60)
  })

  it('returns 0 for an invalid zone name (graceful fallback)', () => {
    const d = new Date('2024-06-15T12:00:00Z')
    expect(getZoneOffsetMinutes('Not/A/Zone', d)).toBe(0)
  })
})

// ── getLocalHour ──────────────────────────────────────────────────────────────

describe('getLocalHour', () => {
  it('returns 12 for UTC noon in UTC zone', () => {
    const d = new Date('2024-06-15T12:00:00Z')
    expect(getLocalHour('UTC', d)).toBe(12)
  })

  it('returns 17 for 22:00 UTC in America/New_York (EST = UTC−5)', () => {
    // November → standard time UTC−5; 22:00 − 5 = 17:00
    const d = new Date('2024-11-15T22:00:00Z')
    expect(getLocalHour('America/New_York', d)).toBe(17)
  })

  it('returns 21 for 12:00 UTC in Asia/Tokyo (JST = UTC+9)', () => {
    const d = new Date('2024-06-15T12:00:00Z')
    expect(getLocalHour('Asia/Tokyo', d)).toBe(21)
  })
})

// ── getLocalDateStr ───────────────────────────────────────────────────────────

describe('getLocalDateStr', () => {
  it('returns "2024-06-15" for UTC noon in UTC zone', () => {
    const d = new Date('2024-06-15T12:00:00Z')
    expect(getLocalDateStr('UTC', d)).toBe('2024-06-15')
  })

  it('returns the next day for late UTC time in Japan', () => {
    // 2024-06-15T20:00:00Z in Tokyo = 2024-06-16 05:00 JST
    const d = new Date('2024-06-15T20:00:00Z')
    expect(getLocalDateStr('Asia/Tokyo', d)).toBe('2024-06-16')
  })

  it('returns the previous day for early UTC time in US West Coast', () => {
    // 2024-06-15T05:00:00Z in Los Angeles = 2024-06-14 22:00 PDT (UTC−7)
    const d = new Date('2024-06-15T05:00:00Z')
    expect(getLocalDateStr('America/Los_Angeles', d)).toBe('2024-06-14')
  })
})

// ── getLocalTimeStr ───────────────────────────────────────────────────────────

describe('getLocalTimeStr', () => {
  it('returns "12:00" for UTC noon in UTC zone', () => {
    const d = new Date('2024-06-15T12:00:00Z')
    expect(getLocalTimeStr('UTC', d)).toBe('12:00')
  })

  it('returns "07:00" for UTC 22:00 in Tokyo (UTC+9)', () => {
    // 22:00 + 9 = 31:00 - 24 = 07:00 next day
    const d = new Date('2024-06-14T22:00:00Z')
    expect(getLocalTimeStr('Asia/Tokyo', d)).toBe('07:00')
  })
})

// ── findLocalMidnightUtc ──────────────────────────────────────────────────────

describe('findLocalMidnightUtc', () => {
  it('UTC midnight = UTC midnight', () => {
    const result = findLocalMidnightUtc('UTC', '2024-06-15')
    expect(result.toISOString()).toBe('2024-06-15T00:00:00.000Z')
  })

  it('NYC EST midnight (UTC−5): local midnight = 05:00 UTC', () => {
    // January → EST = UTC−5
    const result = findLocalMidnightUtc('America/New_York', '2024-01-15')
    expect(result.toISOString()).toBe('2024-01-15T05:00:00.000Z')
  })

  it('NYC EDT midnight (UTC−4): local midnight = 04:00 UTC', () => {
    // July → EDT = UTC−4
    const result = findLocalMidnightUtc('America/New_York', '2024-07-15')
    expect(result.toISOString()).toBe('2024-07-15T04:00:00.000Z')
  })

  it('Tokyo (UTC+9): local midnight = 15:00 UTC the previous day', () => {
    // 2024-06-15 midnight JST = 2024-06-14 15:00 UTC
    const result = findLocalMidnightUtc('Asia/Tokyo', '2024-06-15')
    expect(result.toISOString()).toBe('2024-06-14T15:00:00.000Z')
  })

  it('India (UTC+5:30): local midnight = 18:30 UTC the previous day', () => {
    const result = findLocalMidnightUtc('Asia/Kolkata', '2024-06-15')
    expect(result.toISOString()).toBe('2024-06-14T18:30:00.000Z')
  })

  // DST spring-forward edge cases — the two-step correction must keep reference col 0 = hour 0

  it('Auckland spring-forward 2024-09-29: reference col 0 must be local midnight (hour 0)', () => {
    // NZST→NZDT: clocks spring forward at 02:00 local on 2024-09-29 (UTC+12→UTC+13)
    // Without the two-step correction, col 0 would land at 23:00 on the previous day
    const utcMidnight = findLocalMidnightUtc('Pacific/Auckland', '2024-09-29')
    // The returned instant should show local hour 0 in Auckland
    expect(getLocalHour('Pacific/Auckland', utcMidnight)).toBe(0)
    expect(getLocalDateStr('Pacific/Auckland', utcMidnight)).toBe('2024-09-29')
  })

  it('Sydney spring-forward 2024-10-06: reference col 0 must be local midnight (hour 0)', () => {
    // AEST→AEDT: clocks spring forward at 02:00 local on 2024-10-06 (UTC+10→UTC+11)
    const utcMidnight = findLocalMidnightUtc('Australia/Sydney', '2024-10-06')
    expect(getLocalHour('Australia/Sydney', utcMidnight)).toBe(0)
    expect(getLocalDateStr('Australia/Sydney', utcMidnight)).toBe('2024-10-06')
  })
})

// ── classifyHour ─────────────────────────────────────────────────────────────

describe('classifyHour', () => {
  it('hour 9 is working', () => expect(classifyHour(9)).toBe('working'))
  it('hour 16 is working', () => expect(classifyHour(16)).toBe('working'))
  it('hour 17 is shoulder (not working)', () => expect(classifyHour(17)).toBe('shoulder'))
  it('hour 7 is shoulder', () => expect(classifyHour(7)).toBe('shoulder'))
  it('hour 8 is shoulder', () => expect(classifyHour(8)).toBe('shoulder'))
  it('hour 20 is shoulder', () => expect(classifyHour(20)).toBe('shoulder'))
  it('hour 21 is night', () => expect(classifyHour(21)).toBe('night'))
  it('hour 0 is night', () => expect(classifyHour(0)).toBe('night'))
  it('hour 6 is night', () => expect(classifyHour(6)).toBe('night'))
  it('hour 23 is night', () => expect(classifyHour(23)).toBe('night'))

  // Sanity-check against named constants
  it('WORK_START is classified as working', () =>
    expect(classifyHour(WORK_START)).toBe('working'))
  it('WORK_END is classified as shoulder', () =>
    expect(classifyHour(WORK_END)).toBe('shoulder'))
})

// ── buildHourGrid ─────────────────────────────────────────────────────────────

describe('buildHourGrid', () => {
  const nyEntry: ZoneEntry = {
    zone: 'America/New_York',
    label: 'New York',
    isLocal: false,
  }
  const tokyoEntry: ZoneEntry = { zone: 'Asia/Tokyo', label: 'Tokyo', isLocal: false }
  const utcEntry: ZoneEntry   = { zone: 'UTC', label: 'UTC', isLocal: false }

  it('returns empty grid for empty entries', () => {
    const g = buildHourGrid([], '2024-06-15')
    expect(g.rows).toHaveLength(0)
    expect(g.utcTimes).toHaveLength(0)
  })

  it('produces 24 columns', () => {
    const g = buildHourGrid([utcEntry], '2024-06-15')
    expect(g.utcTimes).toHaveLength(24)
    expect(g.rows[0].cells).toHaveLength(24)
  })

  it('column 0 for UTC on 2024-06-15 is 00:00 UTC', () => {
    const g = buildHourGrid([utcEntry], '2024-06-15')
    expect(g.utcTimes[0].toISOString()).toBe('2024-06-15T00:00:00.000Z')
  })

  it('column 0 for America/New_York (EST, January) is 00:00 local = 05:00 UTC', () => {
    const g = buildHourGrid([nyEntry], '2024-01-15')
    expect(g.utcTimes[0].toISOString()).toBe('2024-01-15T05:00:00.000Z')
  })

  it('reference zone column 0 cell has local hour 0', () => {
    const g = buildHourGrid([nyEntry], '2024-01-15')
    expect(g.rows[0].cells[0].localHour).toBe(0)
  })

  it('reference zone column 9 cell has local hour 9', () => {
    const g = buildHourGrid([nyEntry], '2024-01-15')
    expect(g.rows[0].cells[9].localHour).toBe(9)
  })

  it('Tokyo at column 0 of a NYC January grid is ahead (UTC+9 vs UTC−5 = +14h)', () => {
    // NYC midnight = 05:00 UTC. Tokyo at 05:00 UTC = 14:00 JST
    const g = buildHourGrid([nyEntry, tokyoEntry], '2024-01-15')
    expect(g.rows[1].cells[0].localHour).toBe(14)
  })

  it('each cell has a valid localDateStr in YYYY-MM-DD format', () => {
    const g = buildHourGrid([utcEntry], '2024-06-15')
    for (const cell of g.rows[0].cells) {
      expect(cell.localDateStr).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    }
  })

  it('each cell has a valid localTimeStr in HH:MM format', () => {
    const g = buildHourGrid([utcEntry], '2024-06-15')
    for (const cell of g.rows[0].cells) {
      expect(cell.localTimeStr).toMatch(/^\d{2}:\d{2}$/)
    }
  })

  it('reference zone cell[0].localHour is 0 on a DST spring-forward day (Auckland)', () => {
    // Regression for DST two-step correction bug: without the fix, col 0 shows hour 23
    const aucklandEntry: ZoneEntry = {
      zone: 'Pacific/Auckland',
      label: 'Auckland',
      isLocal: false,
    }
    const g = buildHourGrid([aucklandEntry], '2024-09-29')
    expect(g.rows[0].cells[0].localHour).toBe(0)
    expect(g.rows[0].cells[0].localDateStr).toBe('2024-09-29')
  })
})

// ── computeOverlap ────────────────────────────────────────────────────────────

describe('computeOverlap — full overlap', () => {
  it('UTC + London (same offset in January) have full 8-hour working-hours overlap', () => {
    const entries: ZoneEntry[] = [
      { zone: 'UTC',           label: 'UTC',    isLocal: false },
      { zone: 'Europe/London', label: 'London', isLocal: false },
    ]
    // Both UTC+0 in January → identical local hours → full overlap hours 9–16
    const grid   = buildHourGrid(entries, '2024-01-15')
    const result = computeOverlap(grid)
    expect(result.type).toBe('full')
    // Columns 9–16 = 8 hours where both zones are 9:00–16:59
    expect(result.fullOverlapHours).toHaveLength(8)
    expect(result.fullOverlapHours[0]).toBe(9)
    expect(result.fullOverlapHours[7]).toBe(16)
  })
})

describe('computeOverlap — partial overlap', () => {
  it('NYC and London have partial overlap in July (BST)', () => {
    // NYC July = EDT (UTC−4), London July = BST (UTC+1)
    // Reference = NYC. London is 5h ahead.
    // NYC 09:00 = London 14:00 → London still working
    // NYC 16:00 = London 21:00 → London past shoulder end (21:00 = shoulder_end, night starts at 21)
    // Actually 21 is night. So overlap ends when London leaves working hours.
    // London working 09:00-17:00 BST = NYC 04:00-12:00 EDT (reference col 4-11)
    // NYC working 09:00-17:00 EDT = cols 9-16 in reference
    // Overlap: both working = cols 9-11 (3 hours)
    const entries: ZoneEntry[] = [
      { zone: 'America/New_York', label: 'New York', isLocal: false },
      { zone: 'Europe/London',    label: 'London',   isLocal: false },
    ]
    const grid   = buildHourGrid(entries, '2024-07-15')
    const result = computeOverlap(grid)
    // Should be full or partial — both zones do overlap for some hours
    expect(['full', 'partial']).toContain(result.type)
    expect(result.bestHours.length).toBeGreaterThan(0)
  })

  it('bestCount is less than zone count for partial overlap', () => {
    const entries: ZoneEntry[] = [
      { zone: 'America/New_York', label: 'New York', isLocal: false },
      { zone: 'Asia/Tokyo',       label: 'Tokyo',     isLocal: false },
    ]
    // NYC and Tokyo are ~13-14h apart — minimal/no working-hours overlap
    const grid   = buildHourGrid(entries, '2024-06-15')
    const result = computeOverlap(grid)
    // Tokyo working hours are in the middle of NYC night → no full overlap
    expect(result.fullOverlapHours).toHaveLength(0)
    if (result.type === 'partial') {
      expect(result.bestCount).toBeLessThan(2)
    }
  })
})

describe('computeOverlap — none', () => {
  it('returns type none for an empty grid', () => {
    const grid   = buildHourGrid([], '2024-06-15')
    const result = computeOverlap(grid)
    expect(result.type).toBe('none')
    expect(result.fullOverlapHours).toHaveLength(0)
    expect(result.bestCount).toBe(0)
    expect(result.bestHours).toHaveLength(0)
  })
})

// ── getDayDiff ────────────────────────────────────────────────────────────────

describe('getDayDiff', () => {
  it('returns 0 for same date', () => {
    expect(getDayDiff('2024-06-15', '2024-06-15')).toBe(0)
  })

  it('returns +1 when local date is one day ahead of reference', () => {
    expect(getDayDiff('2024-06-15', '2024-06-16')).toBe(1)
  })

  it('returns −1 when local date is one day behind reference', () => {
    expect(getDayDiff('2024-06-15', '2024-06-14')).toBe(-1)
  })
})

// ── Day difference flag in grid cells ────────────────────────────────────────

describe('day-difference flags via buildHourGrid', () => {
  it('Tokyo can be on the next calendar day relative to NYC', () => {
    // NYC midnight Jan 15 = 05:00 UTC; Tokyo at that time is already 14:00 Jan 15 JST
    // But at NYC hour 23 (= 04:00 UTC Jan 16) Tokyo is 13:00 Jan 16 JST — same offset
    // However at NYC hour 10 (= 15:00 UTC Jan 15) Tokyo = 00:00 Jan 16 JST
    // So somewhere in the 24-column grid, Tokyo's localDateStr will be '2024-01-16'
    const entries: ZoneEntry[] = [
      { zone: 'America/New_York', label: 'New York', isLocal: false },
      { zone: 'Asia/Tokyo',       label: 'Tokyo',     isLocal: false },
    ]
    const grid        = buildHourGrid(entries, '2024-01-15')
    const refDateStr  = '2024-01-15'
    const tokyoRow    = grid.rows[1]
    const hasDayPlus1 = tokyoRow.cells.some(
      (c) => getDayDiff(refDateStr, c.localDateStr) === 1,
    )
    expect(hasDayPlus1).toBe(true)
  })

  it('Los Angeles can be on the previous calendar day relative to UTC', () => {
    // UTC midnight — LA (PDT, UTC−7) is still on the previous day
    const entries: ZoneEntry[] = [
      { zone: 'UTC',                  label: 'UTC', isLocal: false },
      { zone: 'America/Los_Angeles',  label: 'LA',  isLocal: false },
    ]
    const grid        = buildHourGrid(entries, '2024-07-15')
    const refDateStr  = '2024-07-15'
    const laRow       = grid.rows[1]
    const hasDayMinus1 = laRow.cells.some(
      (c) => getDayDiff(refDateStr, c.localDateStr) === -1,
    )
    expect(hasDayMinus1).toBe(true)
  })
})

// ── getFriendlyLabel ──────────────────────────────────────────────────────────

describe('getFriendlyLabel', () => {
  it('"America/New_York" → "New York"', () => {
    expect(getFriendlyLabel('America/New_York')).toBe('New York')
  })

  it('"Europe/London" → "London"', () => {
    expect(getFriendlyLabel('Europe/London')).toBe('London')
  })

  it('"UTC" → "UTC"', () => {
    expect(getFriendlyLabel('UTC')).toBe('UTC')
  })

  it('"Asia/Kolkata" → "Kolkata"', () => {
    expect(getFriendlyLabel('Asia/Kolkata')).toBe('Kolkata')
  })

  it('"America/Indiana/Indianapolis" → "Indianapolis"', () => {
    expect(getFriendlyLabel('America/Indiana/Indianapolis')).toBe('Indianapolis')
  })

  it('underscores are replaced with spaces', () => {
    expect(getFriendlyLabel('America/New_York')).not.toContain('_')
  })
})

// ── formatOffset ─────────────────────────────────────────────────────────────

describe('formatOffset', () => {
  it('+0 → "UTC+0"', () => expect(formatOffset(0)).toBe('UTC+0'))
  it('+60 → "UTC+1"', () => expect(formatOffset(60)).toBe('UTC+1'))
  it('+330 → "UTC+5:30"', () => expect(formatOffset(330)).toBe('UTC+5:30'))
  it('+540 → "UTC+9"', () => expect(formatOffset(540)).toBe('UTC+9'))
  it('−300 → "UTC−5"', () => expect(formatOffset(-300)).toBe('UTC\u22125'))
  it('−240 → "UTC−4"', () => expect(formatOffset(-240)).toBe('UTC\u22124'))
})

// ── formatConsecutiveHours ────────────────────────────────────────────────────

describe('formatConsecutiveHours', () => {
  it('empty → "none"', () => expect(formatConsecutiveHours([])).toBe('none'))

  it('single hour 9 → "09:00–10:00"', () =>
    expect(formatConsecutiveHours([9])).toBe('09:00–10:00'))

  it('[9,10,11,12,13,14,15,16] → "09:00–17:00"', () =>
    expect(formatConsecutiveHours([9, 10, 11, 12, 13, 14, 15, 16])).toBe('09:00–17:00'))

  it('[9,10,14,15] → "09:00–11:00, 14:00–16:00"', () =>
    expect(formatConsecutiveHours([9, 10, 14, 15])).toBe('09:00–11:00, 14:00–16:00'))

  it('[0] → "00:00–01:00"', () =>
    expect(formatConsecutiveHours([0])).toBe('00:00–01:00'))
})

// ── isValidIanaZone ───────────────────────────────────────────────────────────

describe('isValidIanaZone', () => {
  it('accepts "UTC"', () => expect(isValidIanaZone('UTC')).toBe(true))
  it('accepts "America/New_York"', () =>
    expect(isValidIanaZone('America/New_York')).toBe(true))
  it('accepts "Asia/Tokyo"', () => expect(isValidIanaZone('Asia/Tokyo')).toBe(true))
  it('rejects "Not/A/Zone"', () => expect(isValidIanaZone('Not/A/Zone')).toBe(false))
  it('rejects empty string', () => expect(isValidIanaZone('')).toBe(false))
  it('rejects arbitrary string', () => expect(isValidIanaZone('garbage')).toBe(false))
})

// ── FALLBACK_ZONES ────────────────────────────────────────────────────────────

describe('FALLBACK_ZONES', () => {
  it('has at least 40 entries', () => {
    expect(FALLBACK_ZONES.length).toBeGreaterThanOrEqual(40)
  })

  it('contains UTC', () => {
    expect(FALLBACK_ZONES).toContain('UTC')
  })

  it('contains major zones across continents', () => {
    expect(FALLBACK_ZONES).toContain('America/New_York')
    expect(FALLBACK_ZONES).toContain('Europe/London')
    expect(FALLBACK_ZONES).toContain('Asia/Tokyo')
    expect(FALLBACK_ZONES).toContain('Asia/Kolkata')
    expect(FALLBACK_ZONES).toContain('Australia/Sydney')
  })

  it('all entries are valid IANA zone names', () => {
    for (const zone of FALLBACK_ZONES) {
      expect(isValidIanaZone(zone), `"${zone}" should be a valid IANA zone`).toBe(true)
    }
  })
})

// ── getSupportedZones ─────────────────────────────────────────────────────────

describe('getSupportedZones', () => {
  it('returns a non-empty array', () => {
    const zones = getSupportedZones()
    expect(zones.length).toBeGreaterThan(0)
  })

  it('includes America/New_York', () => {
    expect(getSupportedZones()).toContain('America/New_York')
  })

  it('includes Asia/Tokyo', () => {
    expect(getSupportedZones()).toContain('Asia/Tokyo')
  })

  it('all returned entries are valid IANA zone names', () => {
    const zones = getSupportedZones()
    // Check a sample (first 10) to keep test fast
    for (const zone of zones.slice(0, 10)) {
      expect(isValidIanaZone(zone), `"${zone}" should be a valid IANA zone`).toBe(true)
    }
  })
})
