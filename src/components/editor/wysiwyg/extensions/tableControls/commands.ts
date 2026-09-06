/**
 * tableControls/commands.ts
 *
 * Pure command helpers for the table-controls overlay:
 *   selectRow      — builds CellSelection.rowSelection for the given row
 *   selectColumn   — builds CellSelection.colSelection for the given column
 *   moveRow        — reorders rows in the table using prosemirror-tables moveTableRow
 *   moveColumn     — reorders columns using moveTableColumn
 *   isRectangularTable — guard: all cells span=1, move ops are safe
 *
 * GFM header-row invariant
 * ────────────────────────
 * GFM markdown requires the first row of every table to consist entirely of
 * tableHeader nodes; all subsequent rows must be tableCell nodes.
 * tiptap-markdown's table serialiser (isMarkdownSerializable) checks this:
 * if violated it falls back to HTMLNode.serialize which, with html:false,
 * writes the literal string "[table]".
 *
 * To protect the invariant moveRow now guards:
 *   - fromIdx === 0: the header row must never move (returns false).
 *   - toIdx === 0  : moving any body row to position 0 would make it the
 *                    header — forbidden (returns false).
 *
 * Toggle-header-row has been removed entirely:
 *   GFM tables always have a header row; "toggle header" is not a valid
 *   operation in the GFM model and produced broken serialisation.
 *   Column operations (insert/delete/move column) are always safe because
 *   whole-column operations preserve the type of every cell in each row.
 */

import type { Editor } from '@tiptap/core'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import {
  CellSelection,
  TableMap,
  moveTableRow,
  moveTableColumn,
} from '@tiptap/pm/tables'
import { getTablePos } from './plugin'

// ---------------------------------------------------------------------------
// safeNodeAt — doc.nodeAt that never throws
// ---------------------------------------------------------------------------

/** doc.nodeAt that never throws — returns null for out-of-range / invalid positions. */
export function safeNodeAt(doc: ProseMirrorNode, pos: number): ProseMirrorNode | null {
  if (!Number.isInteger(pos) || pos < 0 || pos > doc.content.size) return null
  try {
    return doc.nodeAt(pos)
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Select a whole row
// ---------------------------------------------------------------------------

/**
 * Sets a CellSelection spanning the entire row at `rowIdx` in the table at
 * `tablePos`. Returns true if dispatched.
 */
export function selectRow(editor: Editor, tablePos: number, rowIdx: number): boolean {
  const { state, dispatch } = editor.view
  const tableNode = safeNodeAt(state.doc, tablePos)
  if (!tableNode) return false

  try {
    const map = TableMap.get(tableNode)
    if (rowIdx >= map.height) return false

    const tableStart = tablePos + 1
    // anchor = first cell of row, head = last cell of row
    const anchorRelPos = map.map[rowIdx * map.width + 0]
    const headRelPos = map.map[rowIdx * map.width + map.width - 1]

    const anchorPos = tableStart + anchorRelPos
    const headPos = tableStart + headRelPos

    const $anchor = state.doc.resolve(anchorPos)
    const $head = state.doc.resolve(headPos)

    const sel = CellSelection.rowSelection($anchor, $head)
    dispatch(state.tr.setSelection(sel))
    return true
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// Select a whole column
// ---------------------------------------------------------------------------

/**
 * Sets a CellSelection spanning the entire column at `colIdx` in the table
 * at `tablePos`. Returns true if dispatched.
 */
export function selectColumn(editor: Editor, tablePos: number, colIdx: number): boolean {
  const { state, dispatch } = editor.view
  const tableNode = safeNodeAt(state.doc, tablePos)
  if (!tableNode) return false

  try {
    const map = TableMap.get(tableNode)
    if (colIdx >= map.width) return false

    const tableStart = tablePos + 1
    // anchor = top cell of column, head = bottom cell
    const anchorRelPos = map.map[0 * map.width + colIdx]
    const headRelPos = map.map[(map.height - 1) * map.width + colIdx]

    const anchorPos = tableStart + anchorRelPos
    const headPos = tableStart + headRelPos

    const $anchor = state.doc.resolve(anchorPos)
    const $head = state.doc.resolve(headPos)

    const sel = CellSelection.colSelection($anchor, $head)
    dispatch(state.tr.setSelection(sel))
    return true
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// Span guard
// ---------------------------------------------------------------------------

/**
 * Returns true if all cells in the table have colspan=1 and rowspan=1,
 * meaning we can safely reorder rows/columns.
 * GFM tables are always rectangular, but we guard defensively.
 */
export function isRectangularTable(editor: Editor, tablePos: number): boolean {
  const tableNode = safeNodeAt(editor.view.state.doc, tablePos)
  if (!tableNode) return false
  try {
    const map = TableMap.get(tableNode)
    return map.problems === null || map.problems.length === 0
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// Move row
// ---------------------------------------------------------------------------

/**
 * Moves the row at `fromIdx` to `toIdx` within the table at `tablePos`.
 * Uses prosemirror-tables' moveTableRow command (available in v1.5+).
 * Returns true if dispatched.
 *
 * GFM invariant guards (returns false without mutating):
 *   fromIdx === 0  — header row must never move.
 *   toIdx === 0    — no body row may move into position 0 (header slot).
 */
export function moveRow(
  editor: Editor,
  tablePos: number,
  fromIdx: number,
  toIdx: number,
): boolean {
  if (fromIdx === toIdx) return false
  if (!isRectangularTable(editor, tablePos)) return false

  // GFM header-row invariant: row 0 is the header; it must not move, and
  // no body row may take position 0.
  if (fromIdx === 0 || toIdx === 0) return false

  const { state, dispatch } = editor.view
  const tableNode = safeNodeAt(state.doc, tablePos)
  if (!tableNode) return false

  try {
    const map = TableMap.get(tableNode)
    if (fromIdx < 0 || fromIdx >= map.height) return false
    if (toIdx < 0 || toIdx >= map.height) return false

    return moveTableRow({ from: fromIdx, to: toIdx, select: true, pos: tablePos + 1 })(
      state,
      dispatch,
    )
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// Move column
// ---------------------------------------------------------------------------

/**
 * Moves the column at `fromIdx` to `toIdx` within the table at `tablePos`.
 * Returns true if dispatched.
 * Column operations are always safe: they do not change which row is the
 * header (row types are preserved across column reorders).
 */
export function moveColumn(
  editor: Editor,
  tablePos: number,
  fromIdx: number,
  toIdx: number,
): boolean {
  if (fromIdx === toIdx) return false
  if (!isRectangularTable(editor, tablePos)) return false

  const { state, dispatch } = editor.view
  const tableNode = safeNodeAt(state.doc, tablePos)
  if (!tableNode) return false

  try {
    const map = TableMap.get(tableNode)
    if (fromIdx < 0 || fromIdx >= map.width) return false
    if (toIdx < 0 || toIdx >= map.width) return false

    return moveTableColumn({ from: fromIdx, to: toIdx, select: true, pos: tablePos + 1 })(
      state,
      dispatch,
    )
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// Helper: get current table position from editor state
//
// Delegates to getTablePos() from plugin.ts (same logic; deduplication).
// Kept as a named export for callers that import from commands.ts directly.
// ---------------------------------------------------------------------------

export function getEditorTablePos(editor: Editor): number | null {
  return getTablePos(editor.state)
}
