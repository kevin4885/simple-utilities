/**
 * tableControls/TableControls.tsx
 *
 * React overlay component that renders gravity-ui-style table controls:
 *
 *  • Row handle pill — at left edge of hovered row; opens DropdownMenu
 *    (insert above (disabled on header row), insert below, move up/down,
 *    delete row (disabled on header row), delete table).
 *  • Column handle pill — at top edge of hovered column; opens DropdownMenu
 *    (insert left/right, move left/right, delete column, delete table).
 *  • Edge "+" buttons — append column (right edge) and append row (bottom
 *    edge) when the table is focused.
 *
 * Positioning: absolute inside `wysiwyg-root` (`position: relative`).
 * Blur guard: all interactive elements use onMouseDown={e=>e.preventDefault()}.
 *
 * GFM header-row invariant:
 *   GFM tables always have exactly one header row (row 0 = all tableHeader
 *   cells). The tiptap-markdown serialiser requires this invariant or it
 *   falls back to the HTML serialiser (writing "[table]" when html:false).
 *   Therefore:
 *   - "Insert row above" is disabled when rowIdx === 0 (would insert above
 *     the header, making the new body row become row 0).
 *   - "Delete row" is disabled when rowIdx === 0 (deleting the header makes
 *     the first body row become the new row 0, which is tableCell, not
 *     tableHeader → serialiser sees a broken table).
 *   - "Move row up" is disabled when rowIdx <= 1 (row 1 cannot move above
 *     the header; row 0 is the header and must not move).
 *   - "Move row down" is disabled when rowIdx === 0 (header must not move).
 *   - "Toggle header row" has been removed (GFM tables always have a header).
 *
 * Per-instance menu state:
 *   setDropdownOpen(editor, open) dispatches a 'menu' meta transaction so
 *   the ProseMirror plugin can freeze hover updates while a menu is open
 *   without using a module-level flag (which would affect all editor instances).
 *
 *   Additionally, on OPEN we snapshot the current rowIdx/colIdx into React
 *   state.  All menu actions then use the snapshot, not live hover values —
 *   this prevents the Radix portal / mouseleave race from changing the target
 *   row/col between the user opening the menu and clicking an item.
 */

import { useState, useEffect, useCallback } from 'react'
import type { Editor } from '@tiptap/core'
import {
  PlusIcon,
  Rows3Icon,
  Columns3Icon,
  Trash2Icon,
  ArrowUpIcon,
  ArrowDownIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
} from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'
import { tableControlsKey, setDropdownOpen } from './plugin'
import type { TableControlsState } from './plugin'
import {
  selectRow,
  selectColumn,
  moveRow,
  moveColumn,
  isRectangularTable,
} from './commands'
import { TableMap } from '@tiptap/pm/tables'
import { getScrollParent } from '../../utils'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TableRect {
  left: number
  top: number
  right: number
  bottom: number
  width: number
  height: number
}

interface HandleRect {
  centerX: number
  centerY: number
}

interface OverlayState {
  plugin: TableControlsState | null
  table: TableRect | null
  rowHandle: HandleRect | null
  colHandle: HandleRect | null
}

// ---------------------------------------------------------------------------
// Measure rects from DOM (pure DOM, returns data — no setState)
// ---------------------------------------------------------------------------

function measureTableRects(
  editor: Editor,
  tablePos: number | null,
): Pick<OverlayState, 'table' | 'rowHandle' | 'colHandle'> {
  if (tablePos === null) return { table: null, rowHandle: null, colHandle: null }

  const root = editor.view.dom.closest('.wysiwyg-root') as HTMLElement | null
  if (!root) return { table: null, rowHandle: null, colHandle: null }

  const tableDom = editor.view.nodeDOM(tablePos) as HTMLElement | null
  if (!tableDom) return { table: null, rowHandle: null, colHandle: null }

  const rootR = root.getBoundingClientRect()
  const tableR = tableDom.getBoundingClientRect()

  const table: TableRect = {
    left: tableR.left - rootR.left,
    top: tableR.top - rootR.top,
    right: tableR.right - rootR.left,
    bottom: tableR.bottom - rootR.top,
    width: tableR.width,
    height: tableR.height,
  }

  const rowHandleCell = tableDom.querySelector('[data-row-handle]') as HTMLElement | null
  let rowHandle: HandleRect | null = null
  if (rowHandleCell) {
    const r = rowHandleCell.getBoundingClientRect()
    rowHandle = {
      centerX: r.left - rootR.left + r.width / 2,
      centerY: r.top - rootR.top + r.height / 2,
    }
  }

  const colHandleCell = tableDom.querySelector('[data-col-handle]') as HTMLElement | null
  let colHandle: HandleRect | null = null
  if (colHandleCell) {
    const r = colHandleCell.getBoundingClientRect()
    colHandle = {
      centerX: r.left - rootR.left + r.width / 2,
      centerY: r.top - rootR.top + r.height / 2,
    }
  }

  return { table, rowHandle, colHandle }
}

// ---------------------------------------------------------------------------
// TableControls
// ---------------------------------------------------------------------------

export interface TableControlsProps {
  editor: Editor
}

export function TableControls({ editor }: TableControlsProps) {
  const [overlay, setOverlay] = useState<OverlayState>({
    plugin: null,
    table: null,
    rowHandle: null,
    colHandle: null,
  })
  const [rowMenuOpen, setRowMenuOpen] = useState(false)
  const [colMenuOpen, setColMenuOpen] = useState(false)

  // Snapshots of row/col index at the moment the menu opens.
  // We snapshot here so that mouse-leave during the menu (Radix portal in
  // <body> makes the pointer leave the editor DOM) cannot change which
  // row/col the menu actions target before the user clicks an item.
  // The 0 defaults are never actually used: menus can only open when a
  // hover snapshot is set (null-checked in handleRowOpenChange/handleColOpenChange).
  const [rowMenuTarget, setRowMenuTarget] = useState<number>(0)
  const [colMenuTarget, setColMenuTarget] = useState<number>(0)

  // Build a full OverlayState snapshot from the editor's current state
  const snapshotOverlay = useCallback(
    (tablePos: number | null, pluginState: TableControlsState | null): OverlayState => {
      const rects = measureTableRects(editor, tablePos)
      return { plugin: pluginState, ...rects }
    },
    [editor],
  )

  // Subscribe to plugin state — setState called inside the subscription callback
  useEffect(() => {
    if (!editor) return
    const onTransaction = () => {
      const pluginState = tableControlsKey.getState(editor.state) ?? null
      const tablePos = pluginState?.tablePos ?? null
      setOverlay(snapshotOverlay(tablePos, pluginState))
    }
    editor.on('transaction', onTransaction)
    onTransaction() // initial snapshot
    return () => { editor.off('transaction', onTransaction) }
  }, [editor, snapshotOverlay])

  // Re-measure on scroll and resize — setState called inside event callbacks
  useEffect(() => {
    const scrollContainer = getScrollParent(editor.view.dom) as HTMLElement | null
    const target = scrollContainer ?? editor.view.dom.parentElement

    const onScroll = () => {
      const pluginState = tableControlsKey.getState(editor.state) ?? null
      const tablePos = pluginState?.tablePos ?? null
      setOverlay(snapshotOverlay(tablePos, pluginState))
    }

    target?.addEventListener('scroll', onScroll, { passive: true })

    let obs: ResizeObserver | null = null
    if (typeof ResizeObserver !== 'undefined') {
      obs = new ResizeObserver(() => {
        const pluginState = tableControlsKey.getState(editor.state) ?? null
        const tablePos = pluginState?.tablePos ?? null
        setOverlay(snapshotOverlay(tablePos, pluginState))
      })
      if (target) obs.observe(target)
      obs.observe(editor.view.dom)
    }

    return () => {
      target?.removeEventListener('scroll', onScroll)
      obs?.disconnect()
    }
  }, [editor, snapshotOverlay])

  // Reset per-instance dropdown flag on unmount
  useEffect(() => {
    return () => { setDropdownOpen(editor, false) }
  }, [editor])

  const handleRowOpenChange = useCallback(
    (o: boolean) => {
      setRowMenuOpen(o)
      // Dispatch per-instance menu-open meta (replaces old module-level flag)
      setDropdownOpen(editor, o || colMenuOpen)
      const tp = overlay.plugin?.tablePos
      const rowIdx = overlay.plugin?.hover?.rowIdx
      if (o && tp != null && rowIdx != null) {
        // Snapshot the target row now so menu actions use the stable value
        setRowMenuTarget(rowIdx)
        selectRow(editor, tp, rowIdx)
      }
    },
    [editor, overlay.plugin, colMenuOpen],
  )

  const handleColOpenChange = useCallback(
    (o: boolean) => {
      setColMenuOpen(o)
      setDropdownOpen(editor, rowMenuOpen || o)
      const tp = overlay.plugin?.tablePos
      const colIdx = overlay.plugin?.hover?.colIdx
      if (o && tp != null && colIdx != null) {
        setColMenuTarget(colIdx)
        selectColumn(editor, tp, colIdx)
      }
    },
    [editor, overlay.plugin, rowMenuOpen],
  )

  // Nothing to render
  const { plugin: pluginState, table: tableRect, rowHandle: rowHandleRect, colHandle: colHandleRect } = overlay
  if (!pluginState || pluginState.tablePos === null || tableRect === null) return null

  const { tablePos } = pluginState

  // Table dimensions for disabling move items
  const tableNode = editor.state.doc.nodeAt(tablePos)
  const map = tableNode
    ? (() => { try { return TableMap.get(tableNode) } catch { return null } })()
    : null
  const nRows = map?.height ?? 0
  const nCols = map?.width ?? 0
  const isRect = isRectangularTable(editor, tablePos)

  // Use snapshotted indices for all menu actions — never live hover
  const currentRow = rowMenuOpen ? rowMenuTarget : (pluginState.hover?.rowIdx ?? 0)
  const currentCol = colMenuOpen ? colMenuTarget : (pluginState.hover?.colIdx ?? 0)

  const isHeaderRow  = currentRow === 0
  const isLastRow    = currentRow === nRows - 1
  const isFirstCol   = currentCol === 0
  const isLastCol    = currentCol === nCols - 1

  const showRowHandle = rowHandleRect !== null && (rowMenuOpen || pluginState.hover !== null)
  const showColHandle = colHandleRect !== null && (colMenuOpen || pluginState.hover !== null)

  // ── Geometry constants ──────────────────────────────────────────────────────
  const ROW_HANDLE_W = 8
  const ROW_HANDLE_H = 22
  const COL_HANDLE_W = 22
  const COL_HANDLE_H = 8
  const PLUS_SIZE = 20
  const HANDLE_OFFSET = 14

  const rowHandleLeft = tableRect.left - HANDLE_OFFSET
  const rowHandleTop = rowHandleRect ? rowHandleRect.centerY - ROW_HANDLE_H / 2 : 0
  const colHandleTop = tableRect.top - HANDLE_OFFSET
  const colHandleLeft = colHandleRect ? colHandleRect.centerX - COL_HANDLE_W / 2 : 0
  const appendColLeft = tableRect.right + 4
  const appendColTop = tableRect.top + tableRect.height / 2 - PLUS_SIZE / 2
  const appendRowLeft = tableRect.left + tableRect.width / 2 - PLUS_SIZE / 2
  const appendRowTop = tableRect.bottom + 4

  // ── Event guard: prevent editor blur ───────────────────────────────────────
  function noBlur(e: React.MouseEvent) { e.preventDefault() }

  // ── Deferred action helpers (use snapshotted indices) ───────────────────────
  function handleRowAction(action: () => void) {
    setRowMenuOpen(false)
    // setDropdownOpen is handled by handleRowOpenChange via onOpenChange(false)
    setTimeout(() => { editor.view.focus(); action() }, 0)
  }

  function handleColAction(action: () => void) {
    setColMenuOpen(false)
    // setDropdownOpen is handled by handleColOpenChange via onOpenChange(false)
    setTimeout(() => { editor.view.focus(); action() }, 0)
  }

  return (
    <div
      data-wysiwyg-table-controls
      className="pointer-events-none absolute inset-0 overflow-visible"
      style={{ zIndex: 10 }}
    >
      {/* ── Row handle ─────────────────────────────────────────────────── */}
      {showRowHandle && rowHandleRect && (
        <DropdownMenu open={rowMenuOpen} onOpenChange={handleRowOpenChange}>
          <DropdownMenuTrigger asChild>
            <button
              className="pointer-events-auto absolute wysiwyg-table-handle wysiwyg-table-row-handle"
              style={{
                left: rowHandleLeft,
                top: rowHandleTop,
                width: ROW_HANDLE_W,
                height: ROW_HANDLE_H,
              }}
              onMouseDown={noBlur}
              aria-label={`Row ${currentRow + 1} options`}
              title={`Row ${currentRow + 1} options`}
            />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            side="left"
            align="start"
            onCloseAutoFocus={(e) => { e.preventDefault(); editor.view.focus() }}
            className="min-w-[190px]"
          >
            {/* Disabled on the header row: inserting above row 0 would push
                the header down and break the GFM header-row invariant. */}
            <DropdownMenuItem
              disabled={isHeaderRow}
              onSelect={() => handleRowAction(() => editor.chain().focus().addRowBefore().run())}
            >
              <Rows3Icon className="h-4 w-4 shrink-0" />
              <span>{isHeaderRow ? 'Insert row above (header row)' : 'Insert row above'}</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => handleRowAction(() => editor.chain().focus().addRowAfter().run())}
            >
              <Rows3Icon className="h-4 w-4 shrink-0" />
              <span>Insert row below</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {/* Move up: disabled for row 0 (header) and row 1 (would swap
                body row 1 above the header, breaking the invariant). */}
            <DropdownMenuItem
              disabled={!isRect || currentRow <= 1}
              onSelect={() => handleRowAction(() => moveRow(editor, tablePos, currentRow, currentRow - 1))}
            >
              <ArrowUpIcon className="h-4 w-4 shrink-0" />
              <span>Move row up</span>
            </DropdownMenuItem>
            {/* Move down: disabled for row 0 (header must not move). */}
            <DropdownMenuItem
              disabled={!isRect || isHeaderRow || isLastRow}
              onSelect={() => handleRowAction(() => moveRow(editor, tablePos, currentRow, currentRow + 1))}
            >
              <ArrowDownIcon className="h-4 w-4 shrink-0" />
              <span>Move row down</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {/* Delete row: disabled for the header row — deleting it makes the
                first body row (tableCell) become row 0, breaking the invariant.
                Delete the whole table instead. */}
            <DropdownMenuItem
              disabled={isHeaderRow}
              className="text-destructive focus:text-destructive focus:bg-destructive/10"
              onSelect={() => handleRowAction(() => editor.chain().focus().deleteRow().run())}
            >
              <Trash2Icon className="h-4 w-4 shrink-0" />
              <span>{isHeaderRow ? 'Delete row (header — delete table instead)' : 'Delete row'}</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              className="text-destructive focus:text-destructive focus:bg-destructive/10"
              onSelect={() => handleRowAction(() => editor.chain().focus().deleteTable().run())}
            >
              <Trash2Icon className="h-4 w-4 shrink-0" />
              <span>Delete table</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {/* ── Column handle ──────────────────────────────────────────────── */}
      {showColHandle && colHandleRect && (
        <DropdownMenu open={colMenuOpen} onOpenChange={handleColOpenChange}>
          <DropdownMenuTrigger asChild>
            <button
              className="pointer-events-auto absolute wysiwyg-table-handle wysiwyg-table-col-handle"
              style={{
                left: colHandleLeft,
                top: colHandleTop,
                width: COL_HANDLE_W,
                height: COL_HANDLE_H,
              }}
              onMouseDown={noBlur}
              aria-label={`Column ${currentCol + 1} options`}
              title={`Column ${currentCol + 1} options`}
            />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            side="top"
            align="start"
            onCloseAutoFocus={(e) => { e.preventDefault(); editor.view.focus() }}
            className="min-w-[190px]"
          >
            <DropdownMenuItem
              onSelect={() => handleColAction(() => editor.chain().focus().addColumnBefore().run())}
            >
              <Columns3Icon className="h-4 w-4 shrink-0" />
              <span>Insert column left</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => handleColAction(() => editor.chain().focus().addColumnAfter().run())}
            >
              <Columns3Icon className="h-4 w-4 shrink-0" />
              <span>Insert column right</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              disabled={!isRect || isFirstCol}
              onSelect={() => handleColAction(() => moveColumn(editor, tablePos, currentCol, currentCol - 1))}
            >
              <ArrowLeftIcon className="h-4 w-4 shrink-0" />
              <span>Move column left</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={!isRect || isLastCol}
              onSelect={() => handleColAction(() => moveColumn(editor, tablePos, currentCol, currentCol + 1))}
            >
              <ArrowRightIcon className="h-4 w-4 shrink-0" />
              <span>Move column right</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive focus:text-destructive focus:bg-destructive/10"
              onSelect={() => handleColAction(() => editor.chain().focus().deleteColumn().run())}
            >
              <Trash2Icon className="h-4 w-4 shrink-0" />
              <span>Delete column</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              className="text-destructive focus:text-destructive focus:bg-destructive/10"
              onSelect={() => handleColAction(() => editor.chain().focus().deleteTable().run())}
            >
              <Trash2Icon className="h-4 w-4 shrink-0" />
              <span>Delete table</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {/* ── Append column "+" button ──────────────────────────────────── */}
      <button
        className="pointer-events-auto absolute wysiwyg-table-plus-btn"
        style={{
          left: appendColLeft,
          top: appendColTop,
          width: PLUS_SIZE,
          height: PLUS_SIZE,
        }}
        onMouseDown={noBlur}
        onClick={() => {
          // Select the last column first so addColumnAfter appends at the end
          selectColumn(editor, tablePos, nCols - 1)
          editor.chain().focus().addColumnAfter().run()
        }}
        aria-label="Append column"
        title="Append column"
      >
        <PlusIcon className="h-3 w-3" />
      </button>

      {/* ── Append row "+" button ─────────────────────────────────────── */}
      <button
        className="pointer-events-auto absolute wysiwyg-table-plus-btn"
        style={{
          left: appendRowLeft,
          top: appendRowTop,
          width: PLUS_SIZE,
          height: PLUS_SIZE,
        }}
        onMouseDown={noBlur}
        onClick={() => {
          // Select the last row first so addRowAfter appends at the end
          selectRow(editor, tablePos, nRows - 1)
          editor.chain().focus().addRowAfter().run()
        }}
        aria-label="Append row"
        title="Append row"
      >
        <PlusIcon className="h-3 w-3" />
      </button>
    </div>
  )
}
