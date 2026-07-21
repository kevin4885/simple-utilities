import { describe, it, expect } from 'vitest'
import {
  calcRolls,
  formatYeast,
  BAKER_PERCENTAGES,
  SUM_OF_PERCENTAGES,
  SCALING_LOSS,
  type RollsInputs,
} from './logic'

// Default inputs: 24 rolls × 80g
const defaults: RollsInputs = { rolls: 24, ballWeight: 80 }

// ─── SUM_OF_PERCENTAGES ──────────────────────────────────────────────────────
describe('SUM_OF_PERCENTAGES', () => {
  it('equals 1.728 (flour + water + oil + sugar + salt + yeast)', () => {
    expect(SUM_OF_PERCENTAGES).toBeCloseTo(1.728, 4)
  })
})

// ─── calcRolls — defaults (24 × 80g) ─────────────────────────────────────────
describe('calcRolls — defaults (24 rolls × 80g)', () => {
  const result = calcRolls(defaults)

  it('targetDough = rolls × ballWeight = 1920g', () => {
    expect(result.targetDough).toBe(1920)
  })

  it('totalDough includes 2% scaling-loss buffer (≈1959g)', () => {
    const expected = Math.round((24 * 80) / (1 - SCALING_LOSS))
    expect(result.totalDough).toBe(expected)
    expect(result.totalDough).toBe(1959)
  })

  it('flour ≈ 1134g', () => {
    expect(result.flour).toBe(1134)
  })

  it('water = round(flour × 0.63) ≈ 714g', () => {
    expect(result.water).toBe(714)
    expect(result.water).toBe(Math.round(result.flour * BAKER_PERCENTAGES.water))
  })

  it('oil = round(flour × 0.04) = 45g', () => {
    expect(result.oil).toBe(45)
    expect(result.oil).toBe(Math.round(result.flour * BAKER_PERCENTAGES.oil))
  })

  it('sugar = round(flour × 0.03) = 34g', () => {
    expect(result.sugar).toBe(34)
    expect(result.sugar).toBe(Math.round(result.flour * BAKER_PERCENTAGES.sugar))
  })

  it('salt = round(flour × 0.02) = 23g', () => {
    expect(result.salt).toBe(23)
    expect(result.salt).toBe(Math.round(result.flour * BAKER_PERCENTAGES.salt))
  })

  it('yeast ≈ 0.8% of flour (≈9.07g raw)', () => {
    expect(result.yeast).toBeCloseTo(result.flour * BAKER_PERCENTAGES.yeast, 0)
  })

  it('formatYeast displays yeast to 1 decimal: "9.1"', () => {
    expect(formatYeast(result.yeast)).toBe('9.1')
  })
})

// ─── calcRolls — ingredient ratios ───────────────────────────────────────────
describe('calcRolls — ingredient ratios', () => {
  it('water = round(flourExact × 0.63)', () => {
    const r = calcRolls(defaults)
    // Verify the ratio is preserved within rounding
    expect(r.water / r.flour).toBeCloseTo(BAKER_PERCENTAGES.water, 1)
  })

  it('salt = round(flourExact × 0.02)', () => {
    const r = calcRolls(defaults)
    expect(r.salt).toBe(Math.round(r.flour * BAKER_PERCENTAGES.salt))
  })

  it('yeast ≈ 0.8% of flour', () => {
    const r = calcRolls(defaults)
    expect(r.yeast / r.flour).toBeCloseTo(BAKER_PERCENTAGES.yeast, 3)
  })
})

// ─── calcRolls — quantity scaling ────────────────────────────────────────────
describe('calcRolls — quantity scaling', () => {
  it('12 rolls × 80g produces half the flour of 24 rolls × 80g', () => {
    const r24 = calcRolls({ rolls: 24, ballWeight: 80 })
    const r12 = calcRolls({ rolls: 12, ballWeight: 80 })
    expect(r24.flour / r12.flour).toBeCloseTo(2, 1)
  })

  it('12 rolls × 80g: flour ≈ 567g', () => {
    const r = calcRolls({ rolls: 12, ballWeight: 80 })
    expect(r.flour).toBe(567)
  })

  it('12 rolls × 80g: water ≈ 357g', () => {
    const r = calcRolls({ rolls: 12, ballWeight: 80 })
    expect(r.water).toBe(357)
  })

  it('24 rolls × 80g has twice the water as 12 rolls × 80g', () => {
    const r24 = calcRolls({ rolls: 24, ballWeight: 80 })
    const r12 = calcRolls({ rolls: 12, ballWeight: 80 })
    expect(r24.water / r12.water).toBeCloseTo(2, 1)
  })
})

// ─── calcRolls — ball weight scaling ─────────────────────────────────────────
describe('calcRolls — ball weight scaling', () => {
  it('heavier balls produce more total dough for same roll count', () => {
    const r80 = calcRolls({ rolls: 24, ballWeight: 80 })
    const r100 = calcRolls({ rolls: 24, ballWeight: 100 })
    expect(r100.flour).toBeGreaterThan(r80.flour)
  })

  it('targetDough scales linearly with ballWeight', () => {
    const r80 = calcRolls({ rolls: 24, ballWeight: 80 })
    const r100 = calcRolls({ rolls: 24, ballWeight: 100 })
    expect(r100.targetDough / r80.targetDough).toBeCloseTo(100 / 80, 2)
  })

  it('flour scales linearly with ballWeight', () => {
    const r80 = calcRolls({ rolls: 24, ballWeight: 80 })
    const r160 = calcRolls({ rolls: 24, ballWeight: 160 })
    expect(r160.flour / r80.flour).toBeCloseTo(2, 1)
  })
})

// ─── calcRolls — small batch (6 rolls × 80g) ─────────────────────────────────
describe('calcRolls — small batch (6 rolls × 80g)', () => {
  const result = calcRolls({ rolls: 6, ballWeight: 80 })

  it('targetDough = 480g', () => {
    expect(result.targetDough).toBe(480)
  })

  it('flour is positive and water < flour', () => {
    expect(result.flour).toBeGreaterThan(0)
    expect(result.water).toBeLessThan(result.flour)
  })
})

// ─── formatYeast ──────────────────────────────────────────────────────────────
describe('formatYeast', () => {
  it('formats to 1 decimal place', () => {
    expect(formatYeast(9.07)).toBe('9.1')
    expect(formatYeast(4.535)).toBe('4.5')
    expect(formatYeast(1.0)).toBe('1.0')
  })
})
