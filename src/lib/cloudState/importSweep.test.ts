import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { decideImport } from './importSweep'

const Schema = z.object({ text: z.string() })

describe('decideImport', () => {
  it('returns "import" with the validated payload when local data exists and no cloud row exists', () => {
    const decision = decideImport([], { text: 'hello' }, Schema)
    expect(decision).toEqual({ action: 'import', payload: { text: 'hello' } })
  })

  it('returns "skip" when a cloud row already exists, regardless of its content', () => {
    const decision = decideImport(['default'], { text: 'hello' }, Schema)
    expect(decision).toEqual({ action: 'skip' })
  })

  it('returns "skip" when no local data exists at all (undefined)', () => {
    const decision = decideImport([], undefined, Schema)
    expect(decision).toEqual({ action: 'skip' })
  })

  it('returns "skip" when local data is null', () => {
    const decision = decideImport([], null, Schema)
    expect(decision).toEqual({ action: 'skip' })
  })

  it('returns "skip" when local data fails schema validation', () => {
    const decision = decideImport([], { wrong: 'shape' }, Schema)
    expect(decision).toEqual({ action: 'skip' })
  })

  it('is idempotent — calling twice with the same inputs returns the same result both times', () => {
    const first = decideImport([], { text: 'hello' }, Schema)
    const second = decideImport([], { text: 'hello' }, Schema)
    expect(first).toEqual(second)

    const firstSkip = decideImport(['default'], { text: 'hello' }, Schema)
    const secondSkip = decideImport(['default'], { text: 'hello' }, Schema)
    expect(firstSkip).toEqual(secondSkip)
  })
})
