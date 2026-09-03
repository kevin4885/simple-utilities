/**
 * wysiwyg/forms/tableGrid.test.ts
 *
 * Unit tests for tableGrid.ts pure reducer.
 */
import { describe, it, expect } from 'vitest'
import { nextSize, TABLE_GRID_MIN, TABLE_GRID_MAX } from './tableGrid'
import type { TableGridSize } from './tableGrid'

const mid: TableGridSize = { rows: 4, cols: 4 }

describe('nextSize', () => {
  it('ArrowDown increases rows', () => {
    expect(nextSize(mid, 'ArrowDown')).toEqual({ rows: 5, cols: 4 })
  })

  it('ArrowUp decreases rows', () => {
    expect(nextSize(mid, 'ArrowUp')).toEqual({ rows: 3, cols: 4 })
  })

  it('ArrowRight increases cols', () => {
    expect(nextSize(mid, 'ArrowRight')).toEqual({ rows: 4, cols: 5 })
  })

  it('ArrowLeft decreases cols', () => {
    expect(nextSize(mid, 'ArrowLeft')).toEqual({ rows: 4, cols: 3 })
  })

  it('clamps rows to TABLE_GRID_MIN at top edge', () => {
    const atMin: TableGridSize = { rows: TABLE_GRID_MIN, cols: 4 }
    expect(nextSize(atMin, 'ArrowUp').rows).toBe(TABLE_GRID_MIN)
  })

  it('clamps rows to TABLE_GRID_MAX at bottom edge', () => {
    const atMax: TableGridSize = { rows: TABLE_GRID_MAX, cols: 4 }
    expect(nextSize(atMax, 'ArrowDown').rows).toBe(TABLE_GRID_MAX)
  })

  it('clamps cols to TABLE_GRID_MIN at left edge', () => {
    const atMin: TableGridSize = { rows: 4, cols: TABLE_GRID_MIN }
    expect(nextSize(atMin, 'ArrowLeft').cols).toBe(TABLE_GRID_MIN)
  })

  it('clamps cols to TABLE_GRID_MAX at right edge', () => {
    const atMax: TableGridSize = { rows: 4, cols: TABLE_GRID_MAX }
    expect(nextSize(atMax, 'ArrowRight').cols).toBe(TABLE_GRID_MAX)
  })

  it('returns size unchanged for unrecognised key', () => {
    expect(nextSize(mid, 'Enter')).toEqual(mid)
    expect(nextSize(mid, 'Escape')).toEqual(mid)
    expect(nextSize(mid, 'a')).toEqual(mid)
  })
})
