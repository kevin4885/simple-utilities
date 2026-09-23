import { describe, it, expect, beforeEach } from 'vitest'
import {
  mergePersisted,
  usePizzaDoughStore,
  DEFAULT_HYDRATION_PCT_REGULAR,
  DEFAULT_HYDRATION_PCT_GF,
  PizzaDoughSchema,
} from './store'
import type { PizzaDoughState } from './store'

// ---------------------------------------------------------------------------
// Stub "current" store state (the initialised in-memory defaults)
// ---------------------------------------------------------------------------
const currentState: PizzaDoughState = {
  size: 16,
  qty: 6,
  thickness: 'regular',
  glutenFree: false,
  hydration: DEFAULT_HYDRATION_PCT_REGULAR,
  setSize: () => {},
  setQty: () => {},
  setThickness: () => {},
  setGlutenFree: () => {},
  setHydration: () => {},
}

// ---------------------------------------------------------------------------
// Default constants
// ---------------------------------------------------------------------------
describe('hydration defaults', () => {
  it('DEFAULT_HYDRATION_PCT_REGULAR is 62', () => {
    expect(DEFAULT_HYDRATION_PCT_REGULAR).toBe(62)
  })

  it('DEFAULT_HYDRATION_PCT_GF is 80', () => {
    expect(DEFAULT_HYDRATION_PCT_GF).toBe(80)
  })
})

// ---------------------------------------------------------------------------
// PizzaDoughSchema — hydration has no .default() so missing field fails parse
// ---------------------------------------------------------------------------
describe('PizzaDoughSchema', () => {
  it('fails full parse when hydration is missing (enables fallback branch)', () => {
    const result = PizzaDoughSchema.safeParse({
      size: 16,
      qty: 6,
      thickness: 'regular',
      glutenFree: false,
      // hydration intentionally absent
    })
    expect(result.success).toBe(false)
  })

  it('succeeds when all fields including hydration are present', () => {
    const result = PizzaDoughSchema.safeParse({
      size: 16,
      qty: 6,
      thickness: 'regular',
      glutenFree: false,
      hydration: 62,
    })
    expect(result.success).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// mergePersisted — rehydration fallback
// ---------------------------------------------------------------------------
describe('mergePersisted', () => {
  it('old regular state (no hydration) falls back to 62', () => {
    const oldState = { size: 14, qty: 3, thickness: 'thin', glutenFree: false }
    const merged = mergePersisted(oldState, currentState)
    expect(merged.hydration).toBe(DEFAULT_HYDRATION_PCT_REGULAR)
    expect(merged.hydration).toBe(62)
  })

  it('old GF state (no hydration) falls back to 80', () => {
    const oldState = { size: 16, qty: 6, thickness: 'regular', glutenFree: true }
    const merged = mergePersisted(oldState, currentState)
    expect(merged.hydration).toBe(DEFAULT_HYDRATION_PCT_GF)
    expect(merged.hydration).toBe(80)
  })

  it('new state with explicit hydration preserves the stored value', () => {
    const newState = { size: 16, qty: 4, thickness: 'thick', glutenFree: false, hydration: 75 }
    const merged = mergePersisted(newState, currentState)
    expect(merged.hydration).toBe(75)
  })

  it('corrupt state returns current unchanged', () => {
    const merged = mergePersisted('not-an-object', currentState)
    expect(merged).toBe(currentState)
  })

  it('state with invalid hydration (out of range) returns current unchanged', () => {
    const badState = { size: 16, qty: 6, thickness: 'regular', glutenFree: false, hydration: 999 }
    // partial parse: a single invalid field causes the whole partial parse to fail
    const merged = mergePersisted(badState, currentState)
    expect(merged).toBe(currentState)
  })

  it('preserves other valid fields when merging', () => {
    const oldState = { size: 12, qty: 2, thickness: 'thin', glutenFree: false }
    const merged = mergePersisted(oldState, currentState)
    expect(merged.size).toBe(12)
    expect(merged.qty).toBe(2)
    expect(merged.thickness).toBe('thin')
  })
})

// ---------------------------------------------------------------------------
// usePizzaDoughStore — setGlutenFree resets hydration to mode default
// ---------------------------------------------------------------------------
describe('usePizzaDoughStore.setGlutenFree', () => {
  beforeEach(() => {
    // Reset the store to known defaults before each test
    usePizzaDoughStore.setState({
      size: 16,
      qty: 6,
      thickness: 'regular',
      glutenFree: false,
      hydration: DEFAULT_HYDRATION_PCT_REGULAR,
    })
  })

  it('toggling GF on resets hydration to 80 (GF default)', () => {
    usePizzaDoughStore.getState().setGlutenFree(true)
    expect(usePizzaDoughStore.getState().hydration).toBe(DEFAULT_HYDRATION_PCT_GF)
    expect(usePizzaDoughStore.getState().hydration).toBe(80)
    expect(usePizzaDoughStore.getState().glutenFree).toBe(true)
  })

  it('toggling GF off resets hydration to 62 (regular default)', () => {
    // First go into GF mode
    usePizzaDoughStore.getState().setGlutenFree(true)
    // Manually bump hydration to something custom
    usePizzaDoughStore.getState().setHydration(85)
    // Now toggle back off — should reset to 62 regardless of custom value
    usePizzaDoughStore.getState().setGlutenFree(false)
    expect(usePizzaDoughStore.getState().hydration).toBe(DEFAULT_HYDRATION_PCT_REGULAR)
    expect(usePizzaDoughStore.getState().hydration).toBe(62)
    expect(usePizzaDoughStore.getState().glutenFree).toBe(false)
  })

  it('toggling GF on resets hydration even if user had customised it', () => {
    // User adjusts hydration while in regular mode
    usePizzaDoughStore.getState().setHydration(70)
    expect(usePizzaDoughStore.getState().hydration).toBe(70)
    // Toggle to GF — must reset to 80 regardless
    usePizzaDoughStore.getState().setGlutenFree(true)
    expect(usePizzaDoughStore.getState().hydration).toBe(DEFAULT_HYDRATION_PCT_GF)
  })
})