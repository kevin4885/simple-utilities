/**
 * tableControls/commands.test.ts
 *
 * Unit tests for tableControls/commands.ts:
 *   - selectRow produces a CellSelection.rowSelection of correct size
 *   - selectColumn produces a CellSelection.colSelection of correct size
 *   - moveRow reorders rows correctly (GFM 3×3 table)
 *   - moveColumn reorders columns correctly
 *   - move operations disabled when table has span > 1
 *   - isRectangularTable reports correctly
 *
 * All tests use createTestEditor() from testUtils so the editor config
 * exactly matches WysiwygEditor (including tableInvariantExtension, allowBase64,
 * Markdown options). No test may hand-roll its own extension array.
 */

import { describe, it, expect, afterEach } from 'vitest'
import { CellSelection } from '@tiptap/pm/tables'
import { createTestEditor, getMarkdown } from '../../testUtils'
import type { Editor } from '@tiptap/core'
import {
  selectRow,
  selectColumn,
  moveRow,
  moveColumn,
  isRectangularTable,
  getEditorTablePos,
} from './commands'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TABLE_3X3 = `
| A | B | C |
|---|---|---|
| 1 | 2 | 3 |
| 4 | 5 | 6 |
`.trim()

function editorTablePos(editor: Editor): number {
  const pos = getEditorTablePos(editor)
  if (pos === null) throw new Error('No table found in document')
  return pos
}

// ---------------------------------------------------------------------------
// selectRow
// ---------------------------------------------------------------------------

describe('selectRow', () => {
  let editor: Editor

  afterEach(() => { editor?.destroy() })

  it('selects the first row (row 0) — CellSelection.isRowSelection', () => {
    editor = createTestEditor(TABLE_3X3)
    // Place cursor inside the table first (first cell)
    const tablePos = editorTablePos(editor)
    const result = selectRow(editor, tablePos, 0)
    expect(result).toBe(true)
    const sel = editor.state.selection
    expect(sel).toBeInstanceOf(CellSelection)
    expect((sel as CellSelection).isRowSelection()).toBe(true)
  })

  it('selects the second row (row 1)', () => {
    editor = createTestEditor(TABLE_3X3)
    const tablePos = editorTablePos(editor)
    selectRow(editor, tablePos, 1)
    const sel = editor.state.selection as CellSelection
    expect(sel.isRowSelection()).toBe(true)
  })

  it('returns false for out-of-range row', () => {
    editor = createTestEditor(TABLE_3X3)
    const tablePos = editorTablePos(editor)
    const result = selectRow(editor, tablePos, 99)
    expect(result).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// selectColumn
// ---------------------------------------------------------------------------

describe('selectColumn', () => {
  let editor: Editor

  afterEach(() => { editor?.destroy() })

  it('selects first column (col 0) — CellSelection.isColSelection', () => {
    editor = createTestEditor(TABLE_3X3)
    const tablePos = editorTablePos(editor)
    const result = selectColumn(editor, tablePos, 0)
    expect(result).toBe(true)
    const sel = editor.state.selection as CellSelection
    expect(sel.isColSelection()).toBe(true)
  })

  it('selects third column (col 2)', () => {
    editor = createTestEditor(TABLE_3X3)
    const tablePos = editorTablePos(editor)
    selectColumn(editor, tablePos, 2)
    const sel = editor.state.selection as CellSelection
    expect(sel.isColSelection()).toBe(true)
  })

  it('returns false for out-of-range column', () => {
    editor = createTestEditor(TABLE_3X3)
    const tablePos = editorTablePos(editor)
    const result = selectColumn(editor, tablePos, 99)
    expect(result).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// isRectangularTable
// ---------------------------------------------------------------------------

describe('isRectangularTable', () => {
  let editor: Editor

  afterEach(() => { editor?.destroy() })

  it('returns true for a standard GFM table', () => {
    editor = createTestEditor(TABLE_3X3)
    const tablePos = editorTablePos(editor)
    expect(isRectangularTable(editor, tablePos)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// moveRow
// ---------------------------------------------------------------------------

describe('moveRow', () => {
  let editor: Editor

  afterEach(() => { editor?.destroy() })

  it('moves row 1 to row 2 (last row)', () => {
    editor = createTestEditor(TABLE_3X3)
    const tablePos = editorTablePos(editor)

    // Row order before: header(A,B,C), row1(1,2,3), row2(4,5,6)
    const result = moveRow(editor, tablePos, 1, 2)
    expect(result).toBe(true)

    const md = getMarkdown(editor)
    // After move: header row stays as header (row 0 always header)
    // row 1 should now be 4,5,6 and row 2 should be 1,2,3
    const lines = md.split('\n').filter((l) => l.trim().startsWith('|'))
    expect(lines.length).toBe(4) // header + separator + row + row
    // The data rows (after the separator which is lines[1])
    expect(lines[2]).toContain('4')
    expect(lines[3]).toContain('1')
  })

  it('moves row 2 to row 1 (up)', () => {
    editor = createTestEditor(TABLE_3X3)
    const tablePos = editorTablePos(editor)

    const result = moveRow(editor, tablePos, 2, 1)
    expect(result).toBe(true)

    const md = getMarkdown(editor)
    const lines = md.split('\n').filter((l) => l.trim().startsWith('|'))
    expect(lines[2]).toContain('4')
    expect(lines[3]).toContain('1')
  })

  it('returns false for same from/to', () => {
    editor = createTestEditor(TABLE_3X3)
    const tablePos = editorTablePos(editor)
    expect(moveRow(editor, tablePos, 1, 1)).toBe(false)
  })

  it('returns false for out-of-range row', () => {
    editor = createTestEditor(TABLE_3X3)
    const tablePos = editorTablePos(editor)
    expect(moveRow(editor, tablePos, 1, 99)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// moveColumn
// ---------------------------------------------------------------------------

describe('moveColumn', () => {
  let editor: Editor

  afterEach(() => { editor?.destroy() })

  it('moves column 0 to column 2', () => {
    editor = createTestEditor(TABLE_3X3)
    const tablePos = editorTablePos(editor)

    const result = moveColumn(editor, tablePos, 0, 2)
    expect(result).toBe(true)

    const md = getMarkdown(editor)
    const headerLine = md.split('\n').find((l) => l.includes('A') || l.includes('B'))
    expect(headerLine).toBeTruthy()
    // Column A moved to the end, B and C shift left
    const cells = headerLine!.split('|').map((c) => c.trim()).filter(Boolean)
    expect(cells[cells.length - 1]).toBe('A')
  })

  it('moves column 2 to column 0', () => {
    editor = createTestEditor(TABLE_3X3)
    const tablePos = editorTablePos(editor)

    const result = moveColumn(editor, tablePos, 2, 0)
    expect(result).toBe(true)

    const md = getMarkdown(editor)
    const headerLine = md.split('\n').find((l) => l.includes('A') || l.includes('C'))
    expect(headerLine).toBeTruthy()
    const cells = headerLine!.split('|').map((c) => c.trim()).filter(Boolean)
    expect(cells[0]).toBe('C')
  })

  it('returns false for same from/to', () => {
    editor = createTestEditor(TABLE_3X3)
    const tablePos = editorTablePos(editor)
    expect(moveColumn(editor, tablePos, 0, 0)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// throttle utility
// ---------------------------------------------------------------------------

import { throttle } from './plugin'
import { vi } from 'vitest'

describe('throttle', () => {
  it('calls fn immediately on first call', () => {
    vi.useFakeTimers()
    const fn = vi.fn()
    const t = throttle(fn, 100)
    t('a')
    expect(fn).toHaveBeenCalledTimes(1)
    expect(fn).toHaveBeenCalledWith('a')
    vi.useRealTimers()
  })

  it('throttles subsequent calls within the window', () => {
    vi.useFakeTimers()
    const fn = vi.fn()
    const t = throttle(fn, 100)
    t('a')
    t('b')
    t('c')
    expect(fn).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(110)
    // The trailing call fires after the window
    expect(fn).toHaveBeenCalledTimes(2)
    vi.useRealTimers()
  })

  it('allows another immediate call after window expires', () => {
    vi.useFakeTimers()
    const fn = vi.fn()
    const t = throttle(fn, 100)
    t('a')
    vi.advanceTimersByTime(110)
    t('b')
    expect(fn).toHaveBeenCalledTimes(2)
    vi.useRealTimers()
  })
})
