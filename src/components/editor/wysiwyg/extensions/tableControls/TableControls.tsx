/**
 * tableControls/TableControls.tsx
 *
 * React overlay component that renders gravity-ui-style table controls:
 *
 *  • Row handle pill — at left edge of hovered row; opens DropdownMenu
 *    (insert above/below, move up/down, toggle header row, delete row,
 *    delete table).
 *  • Column handle pill — at top edge of hovered column; opens DropdownMenu
 *    (insert left/right, move left/right, delete column, delete table).
 *  • Edge "+" buttons — append column (right edge) and append row (bottom
 *    edge) when the table is focused.
 *
 * Positioning: absolute inside `wysiwyg-root` (`position: relative`).
 * Blur guard: all interactive elements use onMouseDown={e=>e.preventDefault()}.
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
  TableIcon,
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
  runToggleHeaderRow,
} from './commands'
import { TableMap } from '@tiptap/pm/tables'

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
    const scrollContainer = editor.view.dom.closest('.overflow-y-auto') as HTMLElement | null
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

  // Keep module-level dropdown flag in sync — called in event handlers only
  const syncDropdown = useCallback((rowOpen: boolean, colOpen: boolean) => {
    setDropdownOpen(rowOpen || colOpen)
  }, [])

  // Reset dropdown flag on unmount so it doesn't persist for the next editor instance
  useEffect(() => {
    return () => { setDropdownOpen(false) }
  }, [])

  const handleRowOpenChange = useCallback(
    (o: boolean) => {
      setRowMenuOpen(o)
      syncDropdown(o, colMenuOpen)
      const tp = overlay.plugin?.tablePos
      const rowIdx = overlay.plugin?.hover?.rowIdx
      if (o && tp != null && rowIdx != null) selectRow(editor, tp, rowIdx)
    },
    [editor, overlay.plugin, colMenuOpen, syncDropdown],
  )

  const handleColOpenChange = useCallback(
    (o: boolean) => {
      setColMenuOpen(o)
      syncDropdown(rowMenuOpen, o)
      const tp = overlay.plugin?.tablePos
      const colIdx = overlay.plugin?.hover?.colIdx
      if (o && tp != null && colIdx != null) selectColumn(editor, tp, colIdx)
    },
    [editor, overlay.plugin, rowMenuOpen, syncDropdown],
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
  const currentRow = pluginState.hover?.rowIdx ?? 0
  const currentCol = pluginState.hover?.colIdx ?? 0
  const isFirstRow = currentRow === 0
  const isLastRow = currentRow === nRows - 1
  const isFirstCol = currentCol === 0
  const isLastCol = currentCol === nCols - 1

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

  // ── Deferred action helpers ─────────────────────────────────────────────────
  function handleRowAction(action: () => void) {
    setRowMenuOpen(false)
    syncDropdown(false, colMenuOpen)
    setTimeout(() => { editor.view.focus(); action() }, 0)
  }

  function handleColAction(action: () => void) {
    setColMenuOpen(false)
    syncDropdown(rowMenuOpen, false)
    setTimeout(() => { editor.view.focus(); action() }, 0)
  }

  return (
    <div
      className="pointer-events-none absolute inset-0 overflow-visible"
      style={{ zIndex: 20 }}
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
            <DropdownMenuItem
              onSelect={() => handleRowAction(() => editor.chain().focus().addRowBefore().run())}
            >
              <Rows3Icon className="h-4 w-4 shrink-0" />
              <span>Insert row above</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => handleRowAction(() => editor.chain().focus().addRowAfter().run())}
            >
              <Rows3Icon className="h-4 w-4 shrink-0" />
              <span>Insert row below</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              disabled={!isRect || isFirstRow}
              onSelect={() => handleRowAction(() => moveRow(editor, tablePos, currentRow, currentRow - 1))}
            >
              <ArrowUpIcon className="h-4 w-4 shrink-0" />
              <span>Move row up</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={!isRect || isLastRow}
              onSelect={() => handleRowAction(() => moveRow(editor, tablePos, currentRow, currentRow + 1))}
            >
              <ArrowDownIcon className="h-4 w-4 shrink-0" />
              <span>Move row down</span>
            </DropdownMenuItem>
            {isFirstRow && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onSelect={() => handleRowAction(() => runToggleHeaderRow(editor))}
                >
                  <TableIcon className="h-4 w-4 shrink-0" />
                  <span>Toggle header row</span>
                </DropdownMenuItem>
              </>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive focus:text-destructive focus:bg-destructive/10"
              onSelect={() => handleRowAction(() => editor.chain().focus().deleteRow().run())}
            >
              <Trash2Icon className="h-4 w-4 shrink-0" />
              <span>Delete row</span>
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
