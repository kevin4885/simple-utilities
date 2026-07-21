import { describe, it, expect, beforeEach } from 'vitest'
import { mergePersisted, usePepperoniRollsStore, PepperoniRollsSchema } from './store'
import type { PepperoniRollsState } from './store'

// ---------------------------------------------------------------------------
// Stub "current" store state (the initialised in-memory defaults)
// ---------------------------------------------------------------------------
const currentState: PepperoniRollsState = {
  rolls: 24,
  ballWeight: 80,
  setRolls: () => {},
  setBallWeight: () => {},
}

// ---------------------------------------------------------------------------
// PepperoniRollsSchema — basic validation
// ---------------------------------------------------------------------------
describe('PepperoniRollsSchema', () => {
  it('succeeds when all fields are valid', () => {
    const result = PepperoniRollsSchema.safeParse({ rolls: 24, ballWeight: 80 })
    expect(result.success).toBe(true)
  })

  it('fails when rolls is out of range', () => {
    const result = PepperoniRollsSchema.safeParse({ rolls: 999, ballWeight: 80 })
    expect(result.success).toBe(false)
  })

  it('fails when ballWeight is out of range (too low)', () => {
    const result = PepperoniRollsSchema.safeParse({ rolls: 24, ballWeight: 10 })
    expect(result.success).toBe(false)
  })

  it('fails when ballWeight is out of range (too high)', () => {
    const result = PepperoniRollsSchema.safeParse({ rolls: 24, ballWeight: 9999 })
    expect(result.success).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// mergePersisted — rehydration
// ---------------------------------------------------------------------------
describe('mergePersisted', () => {
  it('valid persisted state is merged onto current', () => {
    const persisted = { rolls: 12, ballWeight: 100 }
    const merged = mergePersisted(persisted, currentState)
    expect(merged.rolls).toBe(12)
    expect(merged.ballWeight).toBe(100)
  })

  it('partial state (only rolls) is tolerated; missing ballWeight falls back to current', () => {
    const persisted = { rolls: 6 }
    const merged = mergePersisted(persisted, currentState)
    expect(merged.rolls).toBe(6)
    expect(merged.ballWeight).toBe(currentState.ballWeight)
  })

  it('partial state (only ballWeight) is tolerated; missing rolls falls back to current', () => {
    const persisted = { ballWeight: 120 }
    const merged = mergePersisted(persisted, currentState)
    expect(merged.ballWeight).toBe(120)
    expect(merged.rolls).toBe(currentState.rolls)
  })

  it('corrupt state (string) returns current unchanged', () => {
    const merged = mergePersisted('not-an-object', currentState)
    expect(merged).toBe(currentState)
  })

  it('corrupt state (null) returns current unchanged', () => {
    const merged = mergePersisted(null, currentState)
    expect(merged).toBe(currentState)
  })

  it('state with out-of-range rolls returns current unchanged', () => {
    const badState = { rolls: 999, ballWeight: 80 }
    const merged = mergePersisted(badState, currentState)
    expect(merged).toBe(currentState)
  })

  it('state with out-of-range ballWeight returns current unchanged', () => {
    const badState = { rolls: 24, ballWeight: 10 }
    const merged = mergePersisted(badState, currentState)
    expect(merged).toBe(currentState)
  })

  it('empty object is tolerated (all fields fall back to current)', () => {
    const merged = mergePersisted({}, currentState)
    expect(merged.rolls).toBe(currentState.rolls)
    expect(merged.ballWeight).toBe(currentState.ballWeight)
  })
})

// ---------------------------------------------------------------------------
// usePepperoniRollsStore — setters
// ---------------------------------------------------------------------------
describe('usePepperoniRollsStore setters', () => {
  beforeEach(() => {
    usePepperoniRollsStore.setState({ rolls: 24, ballWeight: 80 })
  })

  it('setRolls updates rolls', () => {
    usePepperoniRollsStore.getState().setRolls(12)
    expect(usePepperoniRollsStore.getState().rolls).toBe(12)
  })

  it('setBallWeight updates ballWeight', () => {
    usePepperoniRollsStore.getState().setBallWeight(100)
    expect(usePepperoniRollsStore.getState().ballWeight).toBe(100)
  })

  it('setRolls and setBallWeight are independent', () => {
    usePepperoniRollsStore.getState().setRolls(6)
    usePepperoniRollsStore.getState().setBallWeight(150)
    expect(usePepperoniRollsStore.getState().rolls).toBe(6)
    expect(usePepperoniRollsStore.getState().ballWeight).toBe(150)
  })
})
