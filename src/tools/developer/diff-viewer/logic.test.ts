import { describe, it, expect } from 'vitest'
import {
  normalizeLine,
  computeIntralineDiff,
  computeDiff,
  MAX_LINES,
  MAX_DIFF_D,
} from './logic'
import type { DiffOptions, SideBySideRow, UnifiedRow } from './logic'

// ── Helpers ───────────────────────────────────────────────────────────────────

const OPTS_NONE: DiffOptions = { ignoreWhitespace: false, ignoreCase: false }
const OPTS_WS: DiffOptions = { ignoreWhitespace: true, ignoreCase: false }
const OPTS_CI: DiffOptions = { ignoreWhitespace: false, ignoreCase: true }
const OPTS_BOTH: DiffOptions = { ignoreWhitespace: true, ignoreCase: true }

// ── normalizeLine ─────────────────────────────────────────────────────────────

describe('normalizeLine', () => {
  it('no options — returns line unchanged', () => {
    expect(normalizeLine('  Hello  ', OPTS_NONE)).toBe('  Hello  ')
  })

  it('ignoreWhitespace — trims and collapses inner spaces', () => {
    expect(normalizeLine('  hello   world  ', OPTS_WS)).toBe('hello world')
  })

  it('ignoreCase — lowercases only', () => {
    expect(normalizeLine('HELLO World', OPTS_CI)).toBe('hello world')
  })

  it('both options — trims, collapses, and lowercases', () => {
    expect(normalizeLine('  HELLO   WORLD  ', OPTS_BOTH)).toBe('hello world')
  })

  it('empty string stays empty', () => {
    expect(normalizeLine('', OPTS_BOTH)).toBe('')
  })
})

// ── computeIntralineDiff ──────────────────────────────────────────────────────

describe('computeIntralineDiff', () => {
  it('identical strings → empty spans', () => {
    const { spansA, spansB } = computeIntralineDiff('hello', 'hello')
    expect(spansA).toHaveLength(0)
    expect(spansB).toHaveLength(0)
  })

  it('completely different strings → full spans', () => {
    const { spansA, spansB } = computeIntralineDiff('abc', 'xyz')
    expect(spansA.length).toBeGreaterThan(0)
    expect(spansB.length).toBeGreaterThan(0)
  })

  it('single char change in middle', () => {
    const { spansA, spansB } = computeIntralineDiff('hello', 'hXllo')
    // 'e' → 'X': both should mark position 1
    expect(spansA.some(s => s.start === 1 && s.end === 2)).toBe(true)
    expect(spansB.some(s => s.start === 1 && s.end === 2)).toBe(true)
  })

  it('extra char appended → no spans in A, span at end of B', () => {
    const { spansA, spansB } = computeIntralineDiff('hello', 'hello!')
    expect(spansA).toHaveLength(0)
    expect(spansB.length).toBeGreaterThan(0)
    expect(spansB[0]).toEqual({ start: 5, end: 6 })
  })

  it('prefix removed → span at start of A, no spans in B', () => {
    const { spansA, spansB } = computeIntralineDiff('!hello', 'hello')
    expect(spansA.length).toBeGreaterThan(0)
    expect(spansA[0]).toEqual({ start: 0, end: 1 })
    expect(spansB).toHaveLength(0)
  })

  it('empty A vs non-empty B → spansA empty, spansB covers all', () => {
    const { spansA, spansB } = computeIntralineDiff('', 'abc')
    expect(spansA).toHaveLength(0)
    expect(spansB).toEqual([{ start: 0, end: 3 }])
  })

  it('non-empty A vs empty B → spansA covers all, spansB empty', () => {
    const { spansA, spansB } = computeIntralineDiff('abc', '')
    expect(spansA).toEqual([{ start: 0, end: 3 }])
    expect(spansB).toHaveLength(0)
  })
})

// ── computeDiff — empty / identical ──────────────────────────────────────────

describe('computeDiff — empty / identical inputs', () => {
  it('both empty → 0 rows, 0 additions, 0 deletions', () => {
    const r = computeDiff('', '', OPTS_NONE)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.stats.additions).toBe(0)
    expect(r.stats.deletions).toBe(0)
    expect(r.unified).toHaveLength(0)
  })

  it('identical single-line inputs → 0 additions, 0 deletions', () => {
    const r = computeDiff('hello', 'hello', OPTS_NONE)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.stats.additions).toBe(0)
    expect(r.stats.deletions).toBe(0)
    expect(r.unified).toHaveLength(1)
    expect(r.unified[0].type).toBe('context')
  })

  it('identical multi-line inputs → all context rows', () => {
    const text = 'line1\nline2\nline3'
    const r = computeDiff(text, text, OPTS_NONE)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.stats.additions).toBe(0)
    expect(r.stats.deletions).toBe(0)
    expect(r.unified.every(row => row.type === 'context')).toBe(true)
    expect(r.unified).toHaveLength(3)
  })
})

// ── computeDiff — pure addition ───────────────────────────────────────────────

describe('computeDiff — pure addition (original empty)', () => {
  it('empty original + non-empty modified → all inserts', () => {
    const r = computeDiff('', 'line1\nline2', OPTS_NONE)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.stats.additions).toBe(2)
    expect(r.stats.deletions).toBe(0)
    const types = r.unified.map(row => row.type)
    expect(types).toEqual(['insert', 'insert'])
  })

  it('lineB numbers are assigned correctly for pure-insert', () => {
    const r = computeDiff('', 'a\nb\nc', OPTS_NONE)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const lbs = r.unified.map(row => row.lineB)
    expect(lbs).toEqual([1, 2, 3])
  })
})

// ── computeDiff — pure deletion ───────────────────────────────────────────────

describe('computeDiff — pure deletion (modified empty)', () => {
  it('non-empty original + empty modified → all deletes', () => {
    const r = computeDiff('line1\nline2', '', OPTS_NONE)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.stats.additions).toBe(0)
    expect(r.stats.deletions).toBe(2)
    const types = r.unified.map(row => row.type)
    expect(types).toEqual(['delete', 'delete'])
  })

  it('lineA numbers are assigned correctly for pure-delete', () => {
    const r = computeDiff('a\nb\nc', '', OPTS_NONE)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const las = r.unified.map(row => row.lineA)
    expect(las).toEqual([1, 2, 3])
  })
})

// ── computeDiff — changed lines ───────────────────────────────────────────────

describe('computeDiff — changed lines', () => {
  it('single line changed → 1 delete + 1 insert', () => {
    const r = computeDiff('hello', 'world', OPTS_NONE)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.stats.additions).toBe(1)
    expect(r.stats.deletions).toBe(1)
    expect(r.unified[0].type).toBe('delete')
    expect(r.unified[0].text).toBe('hello')
    expect(r.unified[1].type).toBe('insert')
    expect(r.unified[1].text).toBe('world')
  })

  it('mixed context and changes: correct types emitted in order', () => {
    const original = 'a\nb\nc'
    const modified = 'a\nX\nc'
    const r = computeDiff(original, modified, OPTS_NONE)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const types = r.unified.map(row => row.type)
    expect(types).toEqual(['context', 'delete', 'insert', 'context'])
  })

  it('line numbers are correct around a change', () => {
    const original = 'a\nb\nc'
    const modified = 'a\nX\nc'
    const r = computeDiff(original, modified, OPTS_NONE)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const rows = r.unified
    expect(rows[0]).toMatchObject({ type: 'context', lineA: 1, lineB: 1 })
    expect(rows[1]).toMatchObject({ type: 'delete', lineA: 2, lineB: null })
    expect(rows[2]).toMatchObject({ type: 'insert', lineA: null, lineB: 2 })
    expect(rows[3]).toMatchObject({ type: 'context', lineA: 3, lineB: 3 })
  })

  it('appended lines', () => {
    const r = computeDiff('a\nb', 'a\nb\nc\nd', OPTS_NONE)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.stats.additions).toBe(2)
    expect(r.stats.deletions).toBe(0)
  })

  it('prepended lines', () => {
    const r = computeDiff('c\nd', 'a\nb\nc\nd', OPTS_NONE)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.stats.additions).toBe(2)
    expect(r.stats.deletions).toBe(0)
  })
})

// ── computeDiff — ignoreWhitespace option ─────────────────────────────────────

describe('computeDiff — ignoreWhitespace', () => {
  it('lines differing only in whitespace are treated as equal', () => {
    const original = 'hello world'
    const modified = '  hello   world  '
    const r = computeDiff(original, modified, OPTS_WS)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.stats.additions).toBe(0)
    expect(r.stats.deletions).toBe(0)
    expect(r.unified[0].type).toBe('context')
  })

  it('display text preserves original (un-normalized) line', () => {
    const original = 'hello world'
    const modified = '  hello   world  '
    const r = computeDiff(original, modified, OPTS_WS)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    // Context row should contain the original texts, not the normalized form
    expect(r.unified[0].text).toBe('hello world')
  })

  it('different content after normalization is still detected as a change', () => {
    const r = computeDiff('hello world', '  hello   earth  ', OPTS_WS)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.stats.additions).toBe(1)
    expect(r.stats.deletions).toBe(1)
  })
})

// ── computeDiff — ignoreCase option ──────────────────────────────────────────

describe('computeDiff — ignoreCase', () => {
  it('lines differing only in case are treated as equal', () => {
    const r = computeDiff('Hello World', 'hello world', OPTS_CI)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.stats.additions).toBe(0)
    expect(r.stats.deletions).toBe(0)
  })

  it('display text preserves original casing', () => {
    const r = computeDiff('Hello', 'hello', OPTS_CI)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.unified[0].text).toBe('Hello')
  })

  it('different content after case-folding is still detected', () => {
    const r = computeDiff('HELLO', 'WORLD', OPTS_CI)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.stats.additions).toBe(1)
    expect(r.stats.deletions).toBe(1)
  })
})

// ── computeDiff — side-by-side rows ───────────────────────────────────────────

describe('computeDiff — side-by-side alignment', () => {
  it('context rows have matching textA and textB', () => {
    const r = computeDiff('a\nb\nc', 'a\nb\nc', OPTS_NONE)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    for (const row of r.sideBySide) {
      expect(row.type).toBe('context')
      expect(row.textA).toBe(row.textB)
    }
  })

  it('changed pair: type=changed, both textA and textB set', () => {
    const r = computeDiff('hello', 'world', OPTS_NONE)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.sideBySide).toHaveLength(1)
    expect(r.sideBySide[0].type).toBe('changed')
    expect(r.sideBySide[0].textA).toBe('hello')
    expect(r.sideBySide[0].textB).toBe('world')
  })

  it('delete-only row: textB is null', () => {
    // 2 deletes, 1 insert → 1 changed + 1 delete-only
    const r = computeDiff('a\nb', 'X', OPTS_NONE)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const deleteOnly = r.sideBySide.find((row): row is SideBySideRow => row.type === 'delete-only')
    expect(deleteOnly).toBeDefined()
    expect(deleteOnly!.textB).toBeNull()
  })

  it('insert-only row: textA is null', () => {
    // 1 delete, 2 inserts → 1 changed + 1 insert-only
    const r = computeDiff('X', 'a\nb', OPTS_NONE)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const insertOnly = r.sideBySide.find((row): row is SideBySideRow => row.type === 'insert-only')
    expect(insertOnly).toBeDefined()
    expect(insertOnly!.textA).toBeNull()
  })

  it('pure-add produces insert-only rows', () => {
    const r = computeDiff('', 'a\nb\nc', OPTS_NONE)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.sideBySide.every(row => row.type === 'insert-only')).toBe(true)
  })

  it('pure-delete produces delete-only rows', () => {
    const r = computeDiff('a\nb\nc', '', OPTS_NONE)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.sideBySide.every(row => row.type === 'delete-only')).toBe(true)
  })

  it('line counts in side-by-side match unified', () => {
    const original = 'a\nb\nc\nd'
    const modified = 'a\nX\nY\nd'
    const r = computeDiff(original, modified, OPTS_NONE)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    // unified: context(a) + delete(b) + delete(c) + insert(X) + insert(Y) + context(d)
    const uA = r.unified.filter(x => x.lineA !== null).length
    const uB = r.unified.filter(x => x.lineB !== null).length
    const sbA = r.sideBySide.filter(x => x.lineA !== null).length
    const sbB = r.sideBySide.filter(x => x.lineB !== null).length
    expect(sbA).toBe(uA)
    expect(sbB).toBe(uB)
  })
})

// ── computeDiff — intraline spans ─────────────────────────────────────────────

describe('computeDiff — intraline spans in unified rows', () => {
  it('changed-pair delete row gets non-empty intralineSpans', () => {
    const r = computeDiff('hello world', 'hello earth', OPTS_NONE)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const delRow = r.unified.find((x): x is UnifiedRow => x.type === 'delete')
    expect(delRow).toBeDefined()
    // 'world' vs 'earth' differ, so intraline spans should be set
    expect(delRow!.intralineSpans.length).toBeGreaterThan(0)
  })

  it('changed-pair insert row gets non-empty intralineSpans', () => {
    const r = computeDiff('hello world', 'hello earth', OPTS_NONE)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const insRow = r.unified.find((x): x is UnifiedRow => x.type === 'insert')
    expect(insRow).toBeDefined()
    expect(insRow!.intralineSpans.length).toBeGreaterThan(0)
  })

  it('pure-delete rows (no matching insert) have empty intralineSpans', () => {
    const r = computeDiff('a\nb', '', OPTS_NONE)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const delRows = r.unified.filter(x => x.type === 'delete')
    for (const row of delRows) {
      expect(row.intralineSpans).toHaveLength(0)
    }
  })

  it('pure-insert rows (no matching delete) have empty intralineSpans', () => {
    const r = computeDiff('', 'a\nb', OPTS_NONE)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const insRows = r.unified.filter(x => x.type === 'insert')
    for (const row of insRows) {
      expect(row.intralineSpans).toHaveLength(0)
    }
  })
})

// ── computeDiff — side-by-side intraline spans ────────────────────────────────

describe('computeDiff — intraline spans in side-by-side rows', () => {
  it('changed row has intralineSpansA and intralineSpansB set', () => {
    const r = computeDiff('hello world', 'hello earth', OPTS_NONE)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const changed = r.sideBySide.find(x => x.type === 'changed')
    expect(changed).toBeDefined()
    expect(changed!.intralineSpansA.length).toBeGreaterThan(0)
    expect(changed!.intralineSpansB.length).toBeGreaterThan(0)
  })

  it('delete-only row has empty intraline spans', () => {
    const r = computeDiff('a\nb', 'X', OPTS_NONE)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const deleteOnly = r.sideBySide.filter(x => x.type === 'delete-only')
    for (const row of deleteOnly) {
      expect(row.intralineSpansA).toHaveLength(0)
      expect(row.intralineSpansB).toHaveLength(0)
    }
  })
})

// ── computeDiff — large input guard ──────────────────────────────────────────

describe('computeDiff — large input guard', () => {
  it(`returns error when either input exceeds ${MAX_LINES} lines`, () => {
    const bigText = 'line\n'.repeat(MAX_LINES + 1)
    const r = computeDiff(bigText, 'ok', OPTS_NONE)
    expect(r.ok).toBe(false)
  })

  it('does not error at exactly MAX_LINES lines', () => {
    // MAX_LINES lines = MAX_LINES - 1 newlines (split produces MAX_LINES items)
    const text = 'x\n'.repeat(MAX_LINES - 1) + 'x'
    const r = computeDiff(text, text, OPTS_NONE)
    expect(r.ok).toBe(true)
  })
})

// ── computeDiff — fallback for very large edit distance ───────────────────────

describe('computeDiff — fallback', () => {
  it(`sets fallback=true when edit distance > ${MAX_DIFF_D}`, () => {
    // Two completely different texts with > MAX_DIFF_D lines ensures D > MAX_DIFF_D
    const a = Array.from({ length: MAX_DIFF_D + 10 }, (_, i) => `aaa${i}`).join('\n')
    const b = Array.from({ length: MAX_DIFF_D + 10 }, (_, i) => `zzz${i}`).join('\n')
    const r = computeDiff(a, b, OPTS_NONE)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.fallback).toBe(true)
    // Even in fallback mode, the diff should still be a correct (all-delete + all-insert)
    expect(r.stats.deletions).toBeGreaterThan(0)
    expect(r.stats.additions).toBeGreaterThan(0)
    // Fallback skips intraline pairing — side-by-side rows must be delete-only / insert-only
    const sbs = r.sideBySide
    expect(sbs.every(row => row.type === 'delete-only' || row.type === 'insert-only')).toBe(true)
  })

  it('identical inputs never trigger fallback', () => {
    const text = Array.from({ length: 100 }, (_, i) => `line ${i}`).join('\n')
    const r = computeDiff(text, text, OPTS_NONE)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.fallback).toBe(false)
  })
})

// ── computeDiff — stats accuracy ─────────────────────────────────────────────

describe('computeDiff — stats accuracy', () => {
  it('counts additions and deletions correctly for multi-line diff', () => {
    const original = ['alpha', 'beta', 'gamma', 'delta'].join('\n')
    const modified = ['alpha', 'BETA', 'gamma', 'epsilon', 'zeta'].join('\n')
    const r = computeDiff(original, modified, OPTS_NONE)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    // beta→BETA: 1 del + 1 ins; delta removed: 1 del; epsilon+zeta added: 2 ins
    expect(r.stats.deletions).toBe(2)
    expect(r.stats.additions).toBe(3)
  })
})
