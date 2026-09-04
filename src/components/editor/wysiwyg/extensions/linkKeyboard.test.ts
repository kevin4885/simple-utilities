/**
 * wysiwyg/extensions/linkKeyboard.test.ts
 *
 * Unit tests for the table-cell keyboard navigation introduced in the VME
 * follow-up. Tests the `moveToCellBelow` function (exported for testing) which
 * backs the `Enter` keymap handler in `buildLinkKeyboardExtension`.
 *
 * Coverage:
 *   - Navigate from an interior cell to the cell directly below (same column)
 *   - Navigate from the header row to the first body row
 *   - Navigate from the last row: adds a new row, moves caret into it
 *   - Column is preserved when navigating to the row below
 *   - Returns false outside a table (so normal Enter falls through)
 *   - Does not produce [table] after adding a row (GFM invariant respected)
 *
 * Shift-Enter priority test (keymap pre-emption):
 *   Dispatches a real KeyboardEvent(shiftKey=true, key='Enter') through
 *   view.someProp('handleKeyDown', …) to prove that the linkKeyboard
 *   extension (priority 1000) wins over StarterKit's HardBreak extension
 *   (priority 100). After dispatch: no hardBreak node exists in the doc,
 *   and getMarkdown() is unchanged.
 *
 * Uses createTestEditor() (real config including tableInvariantExtension).
 * `moveToCellBelow` is exported from linkKeyboard.ts specifically for testing.
 */

import { describe, it, expect, afterEach } from 'vitest'
import type { Editor } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import { TableMap, findTable } from '@tiptap/pm/tables'
import { createTestEditor, getMarkdown, buildCoreExtensions } from '../testUtils'
import { moveToCellBelow, buildLinkKeyboardExtension } from './linkKeyboard'
import { Editor as TipTapEditor, Extension } from '@tiptap/core'
import { Plugin } from '@tiptap/pm/state'
import { SuggestionPluginKey } from '@tiptap/suggestion'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TABLE_2X2 = `| A | B |
|---|---|
| 1 | 2 |`

const TABLE_3X3 = `| A | B | C |
|---|---|---|
| 1 | 2 | 3 |
| 4 | 5 | 6 |`

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Place the caret inside the paragraph of the cell at (rowIdx, colIdx)
 * in the first table. Returns the absolute cell opening position.
 */
function placeCaretInCell(editor: Editor, rowIdx: number, colIdx: number): number {
  let tablePos: number | null = null
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === 'table') {
      tablePos = pos
      return false
    }
    return true
  })
  if (tablePos === null) throw new Error('No table found')

  const tableNode = editor.state.doc.nodeAt(tablePos)!
  const map = TableMap.get(tableNode)
  const relPos = map.map[rowIdx * map.width + colIdx]
  // cellAbsPos + 1 steps past the cell opening token, into the paragraph
  const targetPos = tablePos + 1 + relPos + 1

  const $pos = editor.state.doc.resolve(Math.min(targetPos, editor.state.doc.content.size))
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.near($pos)))
  return tablePos + 1 + relPos
}

/**
 * Returns the {rowIdx, colIdx} of the cell containing the current selection,
 * or null if outside a table.
 */
function currentCellCoords(editor: Editor): { rowIdx: number; colIdx: number } | null {
  const { $from } = editor.state.selection
  const tableResult = findTable($from)
  if (!tableResult) return null

  const { node: tableNode, pos: tablePos } = tableResult
  const map = TableMap.get(tableNode)

  let cellDepth = -1
  for (let d = $from.depth; d >= 0; d--) {
    const name = $from.node(d).type.name
    if (name === 'tableCell' || name === 'tableHeader') { cellDepth = d; break }
  }
  if (cellDepth === -1) return null

  const cellAbsPos = $from.before(cellDepth)
  const cellRelPos = cellAbsPos - (tablePos + 1)

  try {
    const rect = map.findCell(cellRelPos)
    return { rowIdx: rect.top, colIdx: rect.left }
  } catch {
    return null
  }
}

/** Count the rows in the first table. */
function countRows(editor: Editor): number {
  let count = 0
  editor.state.doc.descendants((node) => {
    if (node.type.name === 'table') {
      node.forEach((child) => { if (child.type.name === 'tableRow') count++ })
      return false
    }
    return true
  })
  return count
}

// ---------------------------------------------------------------------------
// moveToCellBelow — interior rows
// ---------------------------------------------------------------------------

describe('moveToCellBelow — navigation within existing rows', () => {
  let editor: Editor

  afterEach(() => { editor?.destroy() })

  it('moves caret from body row 1 → row 2 (same column col 0)', () => {
    editor = createTestEditor(TABLE_3X3)
    placeCaretInCell(editor, 1, 0)

    const handled = moveToCellBelow(editor)

    expect(handled).toBe(true)
    expect(currentCellCoords(editor)).toEqual({ rowIdx: 2, colIdx: 0 })
  })

  it('moves caret from header row (row 0) → body row 1, same column', () => {
    editor = createTestEditor(TABLE_2X2)
    placeCaretInCell(editor, 0, 1) // header, second col

    const handled = moveToCellBelow(editor)

    expect(handled).toBe(true)
    expect(currentCellCoords(editor)).toEqual({ rowIdx: 1, colIdx: 1 })
  })

  it('preserves column index when navigating down (col 2 of 3)', () => {
    editor = createTestEditor(TABLE_3X3)
    placeCaretInCell(editor, 1, 2) // body row 1, last col

    moveToCellBelow(editor)

    expect(currentCellCoords(editor)).toEqual({ rowIdx: 2, colIdx: 2 })
  })

  it('does NOT add a row when not in the last row', () => {
    editor = createTestEditor(TABLE_3X3)
    placeCaretInCell(editor, 1, 0) // not the last row
    const rowsBefore = countRows(editor)

    moveToCellBelow(editor)

    expect(countRows(editor)).toBe(rowsBefore)
  })
})

// ---------------------------------------------------------------------------
// moveToCellBelow — last row → add row
// ---------------------------------------------------------------------------

describe('moveToCellBelow — last row adds a new row', () => {
  let editor: Editor

  afterEach(() => { editor?.destroy() })

  it('adds a row when in the last body row of TABLE_2X2', () => {
    editor = createTestEditor(TABLE_2X2)
    placeCaretInCell(editor, 1, 0) // only body row (last row)
    const rowsBefore = countRows(editor)

    const handled = moveToCellBelow(editor)

    expect(handled).toBe(true)
    expect(countRows(editor)).toBe(rowsBefore + 1)
  })

  it('moves caret into the new row, column 0', () => {
    editor = createTestEditor(TABLE_2X2)
    placeCaretInCell(editor, 1, 0)

    moveToCellBelow(editor)

    const coords = currentCellCoords(editor)
    expect(coords?.rowIdx).toBe(2)
    expect(coords?.colIdx).toBe(0)
  })

  it('preserves column when adding row from col 1', () => {
    editor = createTestEditor(TABLE_2X2)
    placeCaretInCell(editor, 1, 1) // last row, second column

    moveToCellBelow(editor)

    const coords = currentCellCoords(editor)
    expect(coords?.rowIdx).toBe(2)
    expect(coords?.colIdx).toBe(1)
  })

  it('does not produce [table] after row add (GFM invariant)', () => {
    editor = createTestEditor(TABLE_2X2)
    placeCaretInCell(editor, 1, 0)

    moveToCellBelow(editor)

    const md = getMarkdown(editor)
    expect(md).not.toContain('[table]')
    expect(md).toContain('---')
  })

  it('adds row in TABLE_3X3 last row and places caret in correct column', () => {
    editor = createTestEditor(TABLE_3X3)
    placeCaretInCell(editor, 2, 1) // last row, middle column
    const rowsBefore = countRows(editor)

    moveToCellBelow(editor)

    expect(countRows(editor)).toBe(rowsBefore + 1)
    const coords = currentCellCoords(editor)
    expect(coords?.rowIdx).toBe(3)
    expect(coords?.colIdx).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// moveToCellBelow — fall-through outside a table
// ---------------------------------------------------------------------------

describe('moveToCellBelow — returns false outside a table', () => {
  let editor: Editor

  afterEach(() => { editor?.destroy() })

  it('returns false and does not move caret when in a paragraph', () => {
    const md = 'Paragraph text\n\n' + TABLE_2X2
    editor = createTestEditor(md)
    // Place caret in the paragraph (position 1)
    const $pos = editor.state.doc.resolve(1)
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.near($pos)))

    const handled = moveToCellBelow(editor)

    expect(handled).toBe(false)
    // Should still be outside a table
    expect(currentCellCoords(editor)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Shift-Enter keymap pre-emption — proves priority:1000 wins over HardBreak
//
// StarterKit's HardBreak extension (priority 100) binds Shift-Enter and
// inserts a hardBreak node. buildLinkKeyboardExtension has priority 1000 so
// it runs first. Inside a table cell, the Shift-Enter handler returns true
// (no-op) and the hardBreak is never inserted.
//
// We dispatch the event through view.someProp('handleKeyDown', …) which
// exercises the REAL keymap plugin chain — not just calling the function
// directly. This confirms the priority wiring is correct end-to-end.
// ---------------------------------------------------------------------------

/**
 * Creates a full editor with both buildCoreExtensions() AND
 * buildLinkKeyboardExtension() so the keymap priority is exercised.
 * Uses a no-op ref for openLinkRef (not needed for Shift-Enter test).
 */
function createFullEditor(markdown: string): TipTapEditor {
  const openLinkRef = { current: null }
  return new TipTapEditor({
    extensions: [
      ...buildCoreExtensions(),
      buildLinkKeyboardExtension(openLinkRef),
    ],
    content: markdown,
  })
}

/**
 * Returns true if any hardBreak node exists anywhere in the editor doc.
 */
function hasHardBreak(editor: TipTapEditor): boolean {
  let found = false
  editor.state.doc.descendants((node) => {
    if (node.type.name === 'hardBreak') { found = true; return false }
    return true
  })
  return found
}

describe('Shift-Enter pre-emption — linkKeyboard priority:1000 beats HardBreak', () => {
  let editor: TipTapEditor

  afterEach(() => { editor?.destroy() })

  it('Shift-Enter in a table cell produces no hardBreak node', () => {
    editor = createFullEditor(TABLE_2X2)

    // Place caret in body row 1, col 0
    let tablePos: number | null = null
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'table') { tablePos = pos; return false }
      return true
    })
    if (tablePos === null) throw new Error('No table')
    const tableNode = editor.state.doc.nodeAt(tablePos)!
    const map = TableMap.get(tableNode)
    const relPos = map.map[1 * map.width + 0] // row 1, col 0
    const targetPos = tablePos + 1 + relPos + 1
    const $p = editor.state.doc.resolve(Math.min(targetPos, editor.state.doc.content.size))
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.near($p)))

    const markdownBefore = getMarkdown(editor)

    // Dispatch a real KeyboardEvent through the full handleKeyDown chain
    const { view } = editor
    const event = new KeyboardEvent('keydown', {
      key: 'Enter',
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    })
    let handled = false
    view.someProp('handleKeyDown', (f) => {
      handled = f(view, event) === true
      return handled
    })

    expect(handled).toBe(true) // our handler consumed the event
    expect(hasHardBreak(editor)).toBe(false) // no hardBreak injected
    expect(getMarkdown(editor)).toBe(markdownBefore) // doc unchanged
  })

  it('Shift-Enter in a table cell: markdown is unchanged (no [hardBreak] in output)', () => {
    editor = createFullEditor(TABLE_2X2)

    // Place caret in header row, col 1
    let tablePos: number | null = null
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'table') { tablePos = pos; return false }
      return true
    })
    if (tablePos === null) throw new Error('No table')
    const tableNode = editor.state.doc.nodeAt(tablePos)!
    const map = TableMap.get(tableNode)
    const relPos = map.map[0 * map.width + 1] // row 0, col 1
    const targetPos = tablePos + 1 + relPos + 1
    const $p = editor.state.doc.resolve(Math.min(targetPos, editor.state.doc.content.size))
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.near($p)))

    const markdownBefore = getMarkdown(editor)

    const { view } = editor
    const event = new KeyboardEvent('keydown', {
      key: 'Enter',
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    })
    view.someProp('handleKeyDown', (f) => f(view, event))

    const markdownAfter = getMarkdown(editor)
    expect(markdownAfter).toBe(markdownBefore)
    expect(markdownAfter).not.toContain('[hardBreak]')
  })

  it('Shift-Enter outside a table still inserts a hardBreak (no-op guard is cell-only)', () => {
    // In a paragraph, Shift-Enter should fall through to HardBreak extension.
    // This confirms the guard is correctly scoped to table cells.
    editor = createFullEditor('Hello world')

    const $p = editor.state.doc.resolve(1)
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.near($p)))

    const { view } = editor
    const event = new KeyboardEvent('keydown', {
      key: 'Enter',
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    })
    let handled = false
    view.someProp('handleKeyDown', (f) => {
      handled = f(view, event) === true
      return handled
    })

    // HardBreak extension should have handled it
    expect(handled).toBe(true)
    expect(hasHardBreak(editor)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Enter yields to an open slash menu (Suggestion plugin) inside a table cell.
// Without this guard, priority:1000 would let moveToCellBelow swallow the
// Enter that should select the highlighted slash item.
// ---------------------------------------------------------------------------

describe('Enter in a table cell yields to an active slash-menu suggestion', () => {
  let editor: TipTapEditor

  afterEach(() => { editor?.destroy() })

  it('linkKeyboard Enter returns false while the Suggestion plugin is active', () => {
    // Stub that (a) marks the suggestion state active under the real key and
    // (b) records whether its own Enter handler was reached — i.e. whether
    // the higher-priority linkKeyboard keymap yielded.
    let suggestionSawEnter = false
    const activeSuggestion = Extension.create({
      name: 'fakeSuggestion',
      addProseMirrorPlugins() {
        return [new Plugin({
          key: SuggestionPluginKey,
          state: { init: () => ({ active: true }), apply: (_tr, v) => v },
          props: { handleKeyDown: (_view, ev) => { if (ev.key === 'Enter') { suggestionSawEnter = true; return true } return false } },
        })]
      },
    })
    editor = new TipTapEditor({
      extensions: [...buildCoreExtensions(), buildLinkKeyboardExtension({ current: null }), activeSuggestion],
      content: TABLE_2X2,
    })
    let cellPos = -1
    editor.state.doc.descendants((n, p) => { if (n.type.name === 'tableCell' && cellPos < 0) cellPos = p + 2; return cellPos < 0 })
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, cellPos)))
    const rowsBefore = editor.state.doc.firstChild!.childCount
    const mdBefore = getMarkdown(editor)

    editor.view.someProp('handleKeyDown', (f) =>
      f(editor.view, new KeyboardEvent('keydown', { key: 'Enter' })),
    )

    expect(suggestionSawEnter).toBe(true)              // linkKeyboard yielded
    expect(editor.state.doc.firstChild!.childCount).toBe(rowsBefore) // no cell nav / row add
    expect(getMarkdown(editor)).toBe(mdBefore)
  })
})