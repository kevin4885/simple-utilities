import { describe, it, expect } from 'vitest'
import { calcDough, getProTip, THICKNESS_FACTORS, type DoughInputs } from './logic'

// Default: 6x16" regular, no GF
const defaults: DoughInputs = { size: 16, qty: 6, thickness: 'regular', glutenFree: false }

describe('calcDough — defaults (6×16" regular)', () => {
  const result = calcDough(defaults)

  it('flour ≈ 1705g', () => {
    expect(result.flour).toBeGreaterThanOrEqual(1700)
    expect(result.flour).toBeLessThanOrEqual(1710)
  })

  it('water ≈ 1057g', () => {
    expect(result.water).toBeGreaterThanOrEqual(1055)
    expect(result.water).toBeLessThanOrEqual(1060)
  })

  it('ball weight ≈ 425g', () => {
    expect(result.ballWeight).toBeGreaterThanOrEqual(420)
    expect(result.ballWeight).toBeLessThanOrEqual(430)
  })

  it('hydration = 0.62', () => {
    expect(result.hydration).toBe(0.62)
  })

  it('yeast ≈ 0.4% of flour', () => {
    expect(result.yeast).toBeCloseTo(result.flour * 0.004, 0)
  })

  it('salt = round(flour * 0.025)', () => {
    expect(result.salt).toBe(Math.round(result.flour * 0.025))
  })

  it('sugar = round(flour * 0.02)', () => {
    expect(result.sugar).toBe(Math.round(result.flour * 0.02))
  })

  it('oil = round(flour * 0.033)', () => {
    expect(result.oil).toBe(Math.round(result.flour * 0.033))
  })
})

describe('calcDough — gluten free', () => {
  const gf: DoughInputs = { ...defaults, glutenFree: true }
  const result = calcDough(gf)

  it('hydration = 0.80', () => {
    expect(result.hydration).toBe(0.8)
  })

  it('base flour = 333*6 at 16"×6', () => {
    // At default size/qty, flour should equal 333*6 = 1998
    expect(result.flour).toBe(1998)
  })

  it('water = round(flour * 0.80)', () => {
    expect(result.water).toBe(Math.round(result.flour * 0.8))
  })
})

describe('calcDough — thin crust', () => {
  const thin: DoughInputs = { ...defaults, thickness: 'thin' }
  const resultThin = calcDough(thin)
  const resultReg = calcDough(defaults)

  it('thin flour < regular flour', () => {
    expect(resultThin.flour).toBeLessThan(resultReg.flour)
  })

  it('scales by thickness factor ratio', () => {
    const expectedFlour = resultReg.flour * (THICKNESS_FACTORS.thin / THICKNESS_FACTORS.regular)
    expect(resultThin.flour).toBeCloseTo(expectedFlour, -1) // within ~5g
  })
})

describe('calcDough — thick crust', () => {
  const thick: DoughInputs = { ...defaults, thickness: 'thick' }
  const resultThick = calcDough(thick)
  const resultReg = calcDough(defaults)

  it('thick flour > regular flour', () => {
    expect(resultThick.flour).toBeGreaterThan(resultReg.flour)
  })

  it('scales by thickness factor ratio', () => {
    const expectedFlour = resultReg.flour * (THICKNESS_FACTORS.thick / THICKNESS_FACTORS.regular)
    expect(resultThick.flour).toBeCloseTo(expectedFlour, -1)
  })
})

describe('calcDough — size scaling', () => {
  it('18" pizza has more flour than 16"', () => {
    const r16 = calcDough(defaults)
    const r18 = calcDough({ ...defaults, size: 18 })
    expect(r18.flour).toBeGreaterThan(r16.flour)
  })

  it('flour scales as (size/16)^2', () => {
    const r10 = calcDough({ ...defaults, size: 10 })
    const r20 = calcDough({ ...defaults, size: 20 })
    const expectedRatio = Math.pow(20 / 10, 2)
    const actualRatio = r20.flour / r10.flour
    expect(actualRatio).toBeCloseTo(expectedRatio, 1)
  })
})

describe('calcDough — quantity scaling', () => {
  it('12 pizzas has twice the flour of 6', () => {
    // qty is capped at 10 in UI but logic is uncapped
    const r6 = calcDough(defaults)
    const r12 = calcDough({ ...defaults, qty: 12 })
    expect(r12.flour / r6.flour).toBeCloseTo(2, 1)
  })

  it('1 pizza ball weight same as 6 pizza ball weight', () => {
    // ball weight = total dough / qty, so each ball should be same regardless of qty
    const r1 = calcDough({ ...defaults, qty: 1 })
    const r6 = calcDough(defaults)
    expect(r1.ballWeight).toBeCloseTo(r6.ballWeight, -1) // within ~5g
  })
})

describe('getProTip', () => {
  it('returns GF tip first when GF enabled', () => {
    const tip = getProTip({ ...defaults, glutenFree: true, size: 18 })
    expect(tip).toMatch(/GF dough/i)
  })

  it('returns large pizza tip for size >= 18', () => {
    const tip = getProTip({ ...defaults, size: 18 })
    expect(tip).toMatch(/preheat/i)
  })

  it('returns batch tip for qty >= 8', () => {
    const tip = getProTip({ ...defaults, qty: 8 })
    expect(tip).toMatch(/4 days/i)
  })

  it('returns thick tip', () => {
    const tip = getProTip({ ...defaults, thickness: 'thick' })
    expect(tip).toMatch(/450°F/i)
  })

  it('returns thin tip', () => {
    const tip = getProTip({ ...defaults, thickness: 'thin' })
    expect(tip).toMatch(/4–5 minutes/i)
  })

  it('returns null for defaults', () => {
    const tip = getProTip(defaults)
    expect(tip).toBeNull()
  })
})
