/**
 * Tip & Bill Splitter — logic tests
 *
 * Covers:
 *   – parseCents: decimal string → minor units (USD 2-digit, JPY 0-digit, edge cases)
 *   – formatMoney: minor units → Intl string
 *   – computeTip: tip calculation with/without tax exclusion, zero tip, negative guards
 *   – splitFair: sum invariant, max-1-minor-unit spread, edge cases (1 person, large party,
 *       amounts that don't divide evenly)
 *   – roundUpAmount: dollar rounding, 50¢ rounding, step=0 guard
 *   – computeSplit: full integration — tip on pre-tax vs full, rounding modes,
 *       effective tip %, JPY (0-decimal), zero tip, 1 person, 100 people
 */

import { describe, it, expect } from 'vitest'
import {
  parseCents,
  formatMoney,
  computeTip,
  splitFair,
  roundUpAmount,
  computeSplit,
  getCurrency,
  type CurrencyCode,
} from './logic'

// ── helpers ───────────────────────────────────────────────────────────────────

const usd = getCurrency('USD' as CurrencyCode)
const jpy = getCurrency('JPY' as CurrencyCode)
const eur = getCurrency('EUR' as CurrencyCode)

// ── parseCents ────────────────────────────────────────────────────────────────

describe('parseCents', () => {
  it('parses integer string', () => {
    expect(parseCents('42', 2)).toBe(4200)
  })

  it('parses decimal string', () => {
    expect(parseCents('42.50', 2)).toBe(4250)
  })

  it('parses single-decimal string', () => {
    expect(parseCents('42.5', 2)).toBe(4250)
  })

  it('parses string with comma thousands separator', () => {
    expect(parseCents('1,234.56', 2)).toBe(123456)
  })

  it('returns 0 for empty string', () => {
    expect(parseCents('', 2)).toBe(0)
  })

  it('returns 0 for whitespace', () => {
    expect(parseCents('   ', 2)).toBe(0)
  })

  it('returns 0 for non-numeric string', () => {
    expect(parseCents('abc', 2)).toBe(0)
  })

  it('returns 0 for negative value', () => {
    expect(parseCents('-5.00', 2)).toBe(0)
  })

  it('handles JPY (0 minorDigits)', () => {
    expect(parseCents('1500', 0)).toBe(1500)
  })

  it('handles JPY with decimal input (rounds)', () => {
    // 1500.9 → round → 1501 (but user shouldn't enter this; still handle gracefully)
    expect(parseCents('1500.9', 0)).toBe(1501)
  })

  it('handles large bill', () => {
    expect(parseCents('9999.99', 2)).toBe(999999)
  })

  it('rounds floating-point representation correctly (0.1 + 0.2 territory)', () => {
    // 85.00 must parse to exactly 8500
    expect(parseCents('85.00', 2)).toBe(8500)
    // 33.33 must parse to exactly 3333
    expect(parseCents('33.33', 2)).toBe(3333)
  })
})

// ── formatMoney ───────────────────────────────────────────────────────────────

describe('formatMoney', () => {
  it('formats USD cents to dollar string', () => {
    // 4250 cents → $42.50
    const result = formatMoney(4250, usd)
    expect(result).toMatch(/42/)
    expect(result).toMatch(/50/)
    expect(result).toMatch(/\$/)
  })

  it('formats 0 as $0.00', () => {
    const result = formatMoney(0, usd)
    expect(result).toMatch(/0/)
  })

  it('formats JPY as integer (no decimal)', () => {
    const result = formatMoney(1500, jpy)
    // Should not contain a decimal point for JPY
    // Intl formats JPY without decimal fraction
    expect(result).toMatch(/1[,.]?500/)
    expect(result).not.toMatch(/\.00/)
  })
})

// ── computeTip ────────────────────────────────────────────────────────────────

describe('computeTip', () => {
  it('computes 18% tip on $85.00', () => {
    // 8500 * 0.18 = 1530
    expect(computeTip(8500, 18)).toBe(1530)
  })

  it('computes 20% tip on $100.00', () => {
    expect(computeTip(10000, 20)).toBe(2000)
  })

  it('computes 15% tip on $67.50 (rounds half-up)', () => {
    // 6750 * 0.15 = 1012.5 → rounds to 1013
    expect(computeTip(6750, 15)).toBe(1013)
  })

  it('returns 0 for 0% tip', () => {
    expect(computeTip(10000, 0)).toBe(0)
  })

  it('returns 0 for 0 base', () => {
    expect(computeTip(0, 18)).toBe(0)
  })

  it('handles negative tipPct gracefully (returns 0)', () => {
    expect(computeTip(10000, -5)).toBe(0)
  })

  it('handles custom tip like 22%', () => {
    // 5000 * 0.22 = 1100
    expect(computeTip(5000, 22)).toBe(1100)
  })

  it('handles fractional tip % (e.g. 18.5%)', () => {
    // 10000 * 0.185 = 1850
    expect(computeTip(10000, 18.5)).toBe(1850)
  })
})

// ── splitFair ─────────────────────────────────────────────────────────────────

describe('splitFair — sum invariant', () => {
  /** Utility: sum all share amounts × count to get total */
  function sumShares(shares: ReturnType<typeof splitFair>): number {
    return shares.reduce((acc, s) => acc + s.amount * s.count, 0)
  }

  /** Utility: spread = max amount - min amount */
  function spread(shares: ReturnType<typeof splitFair>): number {
    if (shares.length === 0) return 0
    const amounts = shares.map((s) => s.amount)
    return Math.max(...amounts) - Math.min(...amounts)
  }

  it('1 person gets the full amount', () => {
    const shares = splitFair(10000, 1)
    expect(sumShares(shares)).toBe(10000)
    expect(shares[0].amount).toBe(10000)
    expect(shares[0].count).toBe(1)
  })

  it('evenly divisible — everyone pays the same', () => {
    // $100.00 / 4 = $25.00 each
    const shares = splitFair(10000, 4)
    expect(sumShares(shares)).toBe(10000)
    expect(spread(shares)).toBe(0)
    expect(shares.length).toBe(1)
    expect(shares[0].amount).toBe(2500)
    expect(shares[0].count).toBe(4)
  })

  it('non-divisible — sum is exact', () => {
    // $101.00 / 4 = can't divide evenly
    const shares = splitFair(10100, 4)
    expect(sumShares(shares)).toBe(10100)
    expect(spread(shares)).toBeLessThanOrEqual(1)
  })

  it('non-divisible — 3 people, $100.01', () => {
    // 10001 / 3: base=3333, rem=2 → 2 people pay 3334, 1 pays 3333
    const shares = splitFair(10001, 3)
    expect(sumShares(shares)).toBe(10001)
    expect(spread(shares)).toBeLessThanOrEqual(1)
  })

  it('non-divisible — 4 people, $101.01', () => {
    const shares = splitFair(10101, 4)
    expect(sumShares(shares)).toBe(10101)
    expect(spread(shares)).toBeLessThanOrEqual(1)
  })

  it('100 people', () => {
    const total = 12345  // $123.45
    const shares = splitFair(total, 100)
    expect(sumShares(shares)).toBe(total)
    expect(spread(shares)).toBeLessThanOrEqual(1)
  })

  it('large party of 20, awkward total', () => {
    const total = 8333  // $83.33
    const shares = splitFair(total, 20)
    expect(sumShares(shares)).toBe(total)
    expect(spread(shares)).toBeLessThanOrEqual(1)
  })

  it('handles zero total', () => {
    const shares = splitFair(0, 4)
    expect(sumShares(shares)).toBe(0)
    expect(shares[0].amount).toBe(0)
  })

  it('handles 1 person, odd total', () => {
    const shares = splitFair(9999, 1)
    expect(sumShares(shares)).toBe(9999)
  })

  it('returns empty for 0 people', () => {
    expect(splitFair(10000, 0)).toEqual([])
  })

  // Stress test: many awkward splits
  for (const people of [2, 3, 5, 7, 11, 13, 17, 19, 23]) {
    for (const total of [100, 1001, 9999, 10001, 123456]) {
      it(`sum invariant: ${total} cents / ${people} people`, () => {
        const shares = splitFair(total, people)
        expect(sumShares(shares)).toBe(total)
        expect(spread(shares)).toBeLessThanOrEqual(1)
      })
    }
  }
})

// ── roundUpAmount ─────────────────────────────────────────────────────────────

describe('roundUpAmount', () => {
  it('rounds up to nearest 100 (dollar)', () => {
    expect(roundUpAmount(2534, 100)).toBe(2600)
  })

  it('already on boundary — no change', () => {
    expect(roundUpAmount(2500, 100)).toBe(2500)
  })

  it('rounds up to nearest 50', () => {
    expect(roundUpAmount(2510, 50)).toBe(2550)
  })

  it('rounds up to nearest 50 — exact boundary', () => {
    expect(roundUpAmount(2550, 50)).toBe(2550)
  })

  it('rounds up 1 cent to 50', () => {
    expect(roundUpAmount(1, 50)).toBe(50)
  })

  it('rounds up 1 cent to 100', () => {
    expect(roundUpAmount(1, 100)).toBe(100)
  })

  it('rounds up 0 to 0', () => {
    expect(roundUpAmount(0, 100)).toBe(0)
  })

  it('step=0 returns amount unchanged', () => {
    expect(roundUpAmount(1234, 0)).toBe(1234)
  })
})

// ── computeSplit — integration ─────────────────────────────────────────────────

describe('computeSplit', () => {
  it('basic split: $80.00, 20% tip, 4 people, no rounding', () => {
    const result = computeSplit({
      billStr: '80.00',
      taxStr: '',
      tipPct: 20,
      tipOnPreTax: false,
      people: 4,
      roundUpMode: 'none',
      currency: usd,
    })
    expect(result.billCents).toBe(8000)
    expect(result.tipCents).toBe(1600)
    expect(result.totalCents).toBe(9600)
    // 9600 / 4 = 2400 each
    expect(result.shares).toEqual([{ amount: 2400, count: 4 }])
    expect(result.roundingActive).toBe(false)
  })

  it('tip on pre-tax: $100 bill, $15 tax, 20% tip', () => {
    const result = computeSplit({
      billStr: '100.00',
      taxStr: '15.00',
      tipPct: 20,
      tipOnPreTax: true,
      people: 1,
      roundUpMode: 'none',
      currency: usd,
    })
    // tipBase = 10000 - 1500 = 8500
    expect(result.tipBaseCents).toBe(8500)
    // tip = 8500 * 0.20 = 1700
    expect(result.tipCents).toBe(1700)
    expect(result.totalCents).toBe(11700)
  })

  it('tip on full bill when tipOnPreTax=false (tax provided but ignored)', () => {
    const result = computeSplit({
      billStr: '100.00',
      taxStr: '15.00',
      tipPct: 20,
      tipOnPreTax: false,
      people: 1,
      roundUpMode: 'none',
      currency: usd,
    })
    expect(result.tipBaseCents).toBe(10000)
    expect(result.tipCents).toBe(2000)
  })

  it('zero tip', () => {
    const result = computeSplit({
      billStr: '50.00',
      taxStr: '',
      tipPct: 0,
      tipOnPreTax: false,
      people: 2,
      roundUpMode: 'none',
      currency: usd,
    })
    expect(result.tipCents).toBe(0)
    expect(result.totalCents).toBe(5000)
    expect(result.shares).toEqual([{ amount: 2500, count: 2 }])
  })

  it('1 person pays everything', () => {
    const result = computeSplit({
      billStr: '45.50',
      taxStr: '',
      tipPct: 15,
      tipOnPreTax: false,
      people: 1,
      roundUpMode: 'none',
      currency: usd,
    })
    // bill=4550, tip=682 (4550*0.15 = 682.5 → 683), total=5233
    expect(result.billCents).toBe(4550)
    expect(result.shares[0].count).toBe(1)
    expect(result.shares[0].amount).toBe(result.totalCents)
  })

  it('uneven split — sum invariant holds', () => {
    const result = computeSplit({
      billStr: '101.01',
      taxStr: '',
      tipPct: 0,
      tipOnPreTax: false,
      people: 3,
      roundUpMode: 'none',
      currency: usd,
    })
    const shareSum = result.shares.reduce((a, s) => a + s.amount * s.count, 0)
    expect(shareSum).toBe(result.totalCents)
  })

  it('dollar round-up: $85 / 4 people, 18% tip', () => {
    const result = computeSplit({
      billStr: '85.00',
      taxStr: '',
      tipPct: 18,
      tipOnPreTax: false,
      people: 4,
      roundUpMode: 'dollar',
      currency: usd,
    })
    // bill=8500, tip=1530, total=10030, per-person raw ≈ 2508
    expect(result.billCents).toBe(8500)
    expect(result.tipCents).toBe(1530)
    expect(result.roundingActive).toBe(true)
    // Rounded per-person = ceil(2508/100)*100 = 2600
    expect(result.roundedPerPerson).toBe(2600)
    expect(result.roundedTotal).toBe(10400)
    expect(result.roundingOverpay).toBe(10400 - 10030)
    // effectiveTipPct: extra tip = 10400 - 8500 = 1900; 1900/8500 * 100 = 22.35%
    expect(result.effectiveTipPct).toBe(22.35)
  })

  it('50-cent round-up', () => {
    const result = computeSplit({
      billStr: '85.00',
      taxStr: '',
      tipPct: 18,
      tipOnPreTax: false,
      people: 4,
      roundUpMode: 'half',
      currency: usd,
    })
    expect(result.roundingActive).toBe(true)
    // Per-person = ceil(2508 / 50) * 50
    // 2508 / 50 = 50.16 → ceil = 51 → 51*50 = 2550
    expect(result.roundedPerPerson).toBe(2550)
    expect(result.roundedTotal).toBe(10200)
  })

  it('rounding inactive for JPY (0 minorDigits)', () => {
    const result = computeSplit({
      billStr: '3000',
      taxStr: '',
      tipPct: 10,
      tipOnPreTax: false,
      people: 3,
      roundUpMode: 'dollar',
      currency: jpy,
    })
    // JPY has 0 minorDigits, rounding is disabled
    expect(result.roundingActive).toBe(false)
  })

  it('JPY: bill 3000 yen, 0% tip, 3 people', () => {
    const result = computeSplit({
      billStr: '3000',
      taxStr: '',
      tipPct: 0,
      tipOnPreTax: false,
      people: 3,
      roundUpMode: 'none',
      currency: jpy,
    })
    expect(result.billCents).toBe(3000)
    expect(result.tipCents).toBe(0)
    expect(result.totalCents).toBe(3000)
    expect(result.shares).toEqual([{ amount: 1000, count: 3 }])
  })

  it('JPY uneven split: 1001 yen / 3 people', () => {
    const result = computeSplit({
      billStr: '1001',
      taxStr: '',
      tipPct: 0,
      tipOnPreTax: false,
      people: 3,
      roundUpMode: 'none',
      currency: jpy,
    })
    expect(result.billCents).toBe(1001)
    const shareSum = result.shares.reduce((a, s) => a + s.amount * s.count, 0)
    expect(shareSum).toBe(1001)
    const amounts = result.shares.map((s) => s.amount)
    expect(Math.max(...amounts) - Math.min(...amounts)).toBeLessThanOrEqual(1)
  })

  it('empty bill string → 0 results', () => {
    const result = computeSplit({
      billStr: '',
      taxStr: '',
      tipPct: 18,
      tipOnPreTax: false,
      people: 2,
      roundUpMode: 'none',
      currency: usd,
    })
    expect(result.billCents).toBe(0)
    expect(result.tipCents).toBe(0)
    expect(result.totalCents).toBe(0)
  })

  it('large party: $500.00, 15% tip, 100 people', () => {
    const result = computeSplit({
      billStr: '500.00',
      taxStr: '',
      tipPct: 15,
      tipOnPreTax: false,
      people: 100,
      roundUpMode: 'none',
      currency: usd,
    })
    // 50000 * 1.15 = 57500; 57500 / 100 = 575 cents each
    expect(result.totalCents).toBe(57500)
    expect(result.shares).toEqual([{ amount: 575, count: 100 }])
  })

  it('EUR currency works correctly', () => {
    const result = computeSplit({
      billStr: '60.00',
      taxStr: '',
      tipPct: 10,
      tipOnPreTax: false,
      people: 3,
      roundUpMode: 'none',
      currency: eur,
    })
    expect(result.billCents).toBe(6000)
    expect(result.tipCents).toBe(600)
    expect(result.totalCents).toBe(6600)
    expect(result.shares).toEqual([{ amount: 2200, count: 3 }])
  })

  it('effectiveTipPct is null when rounding is off', () => {
    const result = computeSplit({
      billStr: '100.00',
      taxStr: '',
      tipPct: 18,
      tipOnPreTax: false,
      people: 4,
      roundUpMode: 'none',
      currency: usd,
    })
    expect(result.effectiveTipPct).toBeNull()
  })

  it('tip on pre-tax with no tax provided = tip on full bill', () => {
    const r1 = computeSplit({
      billStr: '80.00',
      taxStr: '',
      tipPct: 20,
      tipOnPreTax: true, // flag true but no tax
      people: 2,
      roundUpMode: 'none',
      currency: usd,
    })
    const r2 = computeSplit({
      billStr: '80.00',
      taxStr: '',
      tipPct: 20,
      tipOnPreTax: false,
      people: 2,
      roundUpMode: 'none',
      currency: usd,
    })
    expect(r1.tipCents).toBe(r2.tipCents)
  })
})
