/**
 * BillSplitter store — mergePersisted tests
 *
 * Covers:
 *   – Corrupt / entirely invalid persisted state → returns current unchanged
 *   – Out-of-range field (people > 100) → returns current unchanged
 *   – Valid partial state merges onto current
 *   – Full valid state replaces current data fields
 *   – Missing fields from partial state keep current values
 */

import { describe, it, expect } from 'vitest'
import { mergePersisted } from './store'
import type { BillSplitterState } from './store'

// Minimal stub of the current store state (setters are identity stubs for merge testing)
function makeCurrentState(overrides: Partial<BillSplitterState> = {}): BillSplitterState {
  return {
    billStr: '50.00',
    taxStr: '',
    tipPct: 18,
    tipOnPreTax: false,
    people: 2,
    roundUpMode: 'none',
    currency: 'USD',
    // stub setters
    setBillStr: () => {},
    setTaxStr: () => {},
    setTipPct: () => {},
    setTipOnPreTax: () => {},
    setPeople: () => {},
    setRoundUpMode: () => {},
    setCurrency: () => {},
    ...overrides,
  }
}

describe('mergePersisted', () => {
  it('returns current unchanged for null', () => {
    const current = makeCurrentState()
    expect(mergePersisted(null, current)).toBe(current)
  })

  it('returns current unchanged for undefined', () => {
    const current = makeCurrentState()
    expect(mergePersisted(undefined, current)).toBe(current)
  })

  it('returns current unchanged for non-object', () => {
    const current = makeCurrentState()
    expect(mergePersisted('corrupt', current)).toBe(current)
  })

  it('returns current unchanged when people is out of range (>100)', () => {
    const current = makeCurrentState()
    const persisted = { people: 999 }
    expect(mergePersisted(persisted, current)).toBe(current)
  })

  it('returns current unchanged when people is out of range (<1)', () => {
    const current = makeCurrentState()
    const persisted = { people: 0 }
    expect(mergePersisted(persisted, current)).toBe(current)
  })

  it('returns current unchanged when currency is unknown', () => {
    const current = makeCurrentState()
    const persisted = { currency: 'XYZ' }
    expect(mergePersisted(persisted, current)).toBe(current)
  })

  it('returns current unchanged when tipPct is out of range', () => {
    const current = makeCurrentState()
    const persisted = { tipPct: 300 } // max is 200
    expect(mergePersisted(persisted, current)).toBe(current)
  })

  it('merges valid partial state — only provided fields change', () => {
    const current = makeCurrentState()
    const persisted = { billStr: '120.00', people: 6 }
    const merged = mergePersisted(persisted, current)
    expect(merged.billStr).toBe('120.00')
    expect(merged.people).toBe(6)
    // unchanged fields
    expect(merged.tipPct).toBe(18)
    expect(merged.currency).toBe('USD')
    expect(merged.roundUpMode).toBe('none')
  })

  it('merges currency change', () => {
    const current = makeCurrentState()
    const persisted = { currency: 'EUR' }
    const merged = mergePersisted(persisted, current)
    expect(merged.currency).toBe('EUR')
    expect(merged.billStr).toBe('50.00')
  })

  it('merges roundUpMode change', () => {
    const current = makeCurrentState()
    const persisted = { roundUpMode: 'dollar' }
    const merged = mergePersisted(persisted, current)
    expect(merged.roundUpMode).toBe('dollar')
  })

  it('merges full valid persisted state', () => {
    const current = makeCurrentState()
    const persisted = {
      billStr: '200.00',
      taxStr: '20.00',
      tipPct: 15,
      tipOnPreTax: true,
      people: 8,
      roundUpMode: 'half',
      currency: 'GBP',
    }
    const merged = mergePersisted(persisted, current)
    expect(merged.billStr).toBe('200.00')
    expect(merged.taxStr).toBe('20.00')
    expect(merged.tipPct).toBe(15)
    expect(merged.tipOnPreTax).toBe(true)
    expect(merged.people).toBe(8)
    expect(merged.roundUpMode).toBe('half')
    expect(merged.currency).toBe('GBP')
  })

  it('preserves setter functions on merged state', () => {
    const current = makeCurrentState()
    const persisted = { billStr: '75.00' }
    const merged = mergePersisted(persisted, current)
    expect(typeof merged.setBillStr).toBe('function')
    expect(typeof merged.setPeople).toBe('function')
  })

  it('empty object persisted → all fields fall back to schema defaults', () => {
    const current = makeCurrentState({ billStr: '100.00', people: 5 })
    const merged = mergePersisted({}, current)
    // Empty object is valid partial — no fields to override, so current's values remain
    expect(merged.billStr).toBe('100.00')
    expect(merged.people).toBe(5)
  })
})
