/**
 * tableControls/commands.ts
 *
 * Pure command helpers for the table-controls overlay:
 *   selectRow   — builds CellSelection.rowSelection for the given row
 *   selectColumn — builds CellSelection.colSelection for the given column
 *   moveRow     — reorders rows in the table using prosemirror-tables moveTableRow
 *   moveColumn  — reorders columns using moveTableColumn
 *
 * Assumptions:
 *   GFM markdown produces rectangular tables with no colspan/rowspan > 1.
 *   If TableMap reports any cell with span > 1, move operations are disabled
 *   (guard via canMoveRows / canMoveColumns helpers).
 */

import type { Editor } from '@tiptap/core'
import {
  CellSelection,
  TableMap,
  findTable,
  moveTableRow,
  moveTableColumn,
  toggleHeaderRow,
} from '@tiptap/pm/tables'

// ---------------------------------------------------------------------------
// Select a whole row
// ---------------------------------------------------------------------------

/**
 * Sets a CellSelection spanning the entire row at `rowIdx` in the table at
 * `tablePos`. Returns true if dispatched.
 */
export function selectRow(editor: Editor, tablePos: number, rowIdx: number): boolean {
  const { state, dispatch } = editor.view
  const tableNode = state.doc.nodeAt(tablePos)
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
  const tableNode = state.doc.nodeAt(tablePos)
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
  const tableNode = editor.view.state.doc.nodeAt(tablePos)
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
 */
export function moveRow(
  editor: Editor,
  tablePos: number,
  fromIdx: number,
  toIdx: number,
): boolean {
  if (fromIdx === toIdx) return false
  if (!isRectangularTable(editor, tablePos)) return false

  const { state, dispatch } = editor.view
  const tableNode = state.doc.nodeAt(tablePos)
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
  const tableNode = state.doc.nodeAt(tablePos)
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
// Toggle header row
// ---------------------------------------------------------------------------

/**
 * Runs the prosemirror-tables toggleHeaderRow command.
 * Only meaningful when the selection is in the first row.
 */
export function runToggleHeaderRow(editor: Editor): boolean {
  const { state, dispatch } = editor.view
  return toggleHeaderRow(state, dispatch)
}

// ---------------------------------------------------------------------------
// Helper: get current table position from editor state
// ---------------------------------------------------------------------------

export function getEditorTablePos(editor: Editor): number | null {
  const { selection } = editor.state
  const $anchor =
    selection instanceof CellSelection ? selection.$anchorCell : selection.$from
  const result = findTable($anchor)
  return result ? result.pos : null
}
