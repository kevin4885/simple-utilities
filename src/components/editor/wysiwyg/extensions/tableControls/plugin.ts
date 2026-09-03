/**
 * tableControls/plugin.ts
 *
 * ProseMirror plugin that powers gravity-ui-style table controls:
 *
 *  1. When the selection is inside a table, adds `wysiwyg-table-focused`
 *     class decoration to the table node (subtle ring outline).
 *
 *  2. On throttled mousemove (100 ms) over the focused table, resolves the
 *     hovered cell → {rowIdx, colIdx} and stores it via
 *     tr.setMeta(tableControlsKey, { type: 'hover', … }).
 *     mouseleave on the editor DOM clears hover after 150 ms grace.
 *
 *  3. When hover is set, adds `data-row-handle` attr decoration to the first
 *     cell of the hovered row, and `data-col-handle` attr decoration to the
 *     first-row cell in the hovered column — React overlay queries these to
 *     measure handle positions.
 *
 * Plugin state shape: TableControlsState (exported).
 *
 * Meta types:
 *   tr.setMeta(tableControlsKey, { type: 'hover', rowIdx, colIdx })
 *     where rowIdx/colIdx may be null to clear hover.
 *   tr.setMeta(tableControlsKey, { type: 'menu', open: boolean })
 *     signals that a row/column dropdown has opened or closed.
 *     This replaces the old module-level _dropdownOpen flag so each editor
 *     instance manages its own menu state (no global pollution between
 *     multiple mounted editors).
 *
 * setDropdownOpen(editor, open) — helper that dispatches the 'menu' meta;
 *   call it from TableControls.tsx instead of the old exported flag setter.
 */

import { Plugin, PluginKey } from '@tiptap/pm/state'
import type { EditorState } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { EditorView } from '@tiptap/pm/view'
import { CellSelection, TableMap, findTable } from '@tiptap/pm/tables'
import type { Node } from '@tiptap/pm/model'
import type { Editor } from '@tiptap/core'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface TableControlsMeta {
  type: 'hover'
  rowIdx: number | null
  colIdx: number | null
}

export interface TableControlsMenuMeta {
  type: 'menu'
  open: boolean
}

export interface TableControlsState {
  /** Position of the table node containing the selection, or null */
  tablePos: number | null
  /** Hovered cell inside the focused table, or null */
  hover: { rowIdx: number; colIdx: number } | null
  /** True while a row/column dropdown menu is open (per-instance flag) */
  menuOpen: boolean
  decorations: DecorationSet
}

// ---------------------------------------------------------------------------
// Plugin key
// ---------------------------------------------------------------------------

export const tableControlsKey = new PluginKey<TableControlsState>('tableControls')

// ---------------------------------------------------------------------------
// setDropdownOpen — per-instance helper (replaces old module-level flag)
// ---------------------------------------------------------------------------

/**
 * Dispatch a 'menu' meta on the editor to set/clear the per-instance
 * menuOpen flag in plugin state. Replaces the old module-level
 * _dropdownOpen variable so multiple editor instances don't interfere.
 *
 * Call from TableControls.tsx in handleRowOpenChange / handleColOpenChange.
 */
export function setDropdownOpen(editor: Editor, open: boolean): void {
  if (editor.isDestroyed) return
  editor.view.dispatch(
    editor.view.state.tr.setMeta(tableControlsKey, {
      type: 'menu',
      open,
    } satisfies TableControlsMenuMeta),
  )
}

// ---------------------------------------------------------------------------
// Throttle (tiny, no lodash)
// ---------------------------------------------------------------------------

export function throttle<T extends unknown[]>(
  fn: (...args: T) => void,
  ms: number,
): (...args: T) => void {
  let last = 0
  let timer: ReturnType<typeof setTimeout> | null = null
  return function (...args: T) {
    const now = Date.now()
    const remaining = ms - (now - last)
    if (remaining <= 0) {
      if (timer !== null) { clearTimeout(timer); timer = null }
      last = now
      fn(...args)
    } else {
      if (timer !== null) clearTimeout(timer)
      timer = setTimeout(() => {
        last = Date.now()
        timer = null
        fn(...args)
      }, remaining)
    }
  }
}

// ---------------------------------------------------------------------------
// Decoration builder
// ---------------------------------------------------------------------------

function buildDecorations(
  doc: Node,
  tablePos: number | null,
  hover: { rowIdx: number; colIdx: number } | null,
): DecorationSet {
  if (tablePos === null) return DecorationSet.empty

  const tableNode = doc.nodeAt(tablePos)
  if (!tableNode || tableNode.type.name !== 'table') return DecorationSet.empty

  const tableEnd = tablePos + tableNode.nodeSize
  const decos: Decoration[] = [
    Decoration.node(tablePos, tableEnd, { class: 'wysiwyg-table-focused' }),
  ]

  if (hover !== null) {
    const { rowIdx, colIdx } = hover
    try {
      const map = TableMap.get(tableNode)
      if (rowIdx < map.height && colIdx < map.width) {
        const tableStart = tablePos + 1 // opening token of the table node

        // First cell of hovered row
        const rowRelPos = map.map[rowIdx * map.width + 0]
        const rowAbsPos = tableStart + rowRelPos
        const rowCellNode = doc.nodeAt(rowAbsPos)
        if (rowCellNode) {
          decos.push(
            Decoration.node(
              rowAbsPos,
              rowAbsPos + rowCellNode.nodeSize,
              { 'data-row-handle': rowIdx.toString() },
            ),
          )
        }

        // First-row cell in hovered column
        const colRelPos = map.map[0 * map.width + colIdx]
        const colAbsPos = tableStart + colRelPos
        const colCellNode = doc.nodeAt(colAbsPos)
        if (colCellNode) {
          decos.push(
            Decoration.node(
              colAbsPos,
              colAbsPos + colCellNode.nodeSize,
              { 'data-col-handle': colIdx.toString() },
            ),
          )
        }
      }
    } catch {
      // TableMap.get can throw on malformed tables — bail silently
    }
  }

  return DecorationSet.create(doc, decos)
}

// ---------------------------------------------------------------------------
// Find table position for the current selection
// ---------------------------------------------------------------------------

function getTablePos(state: EditorState): number | null {
  const { selection } = state
  const $anchor =
    selection instanceof CellSelection ? selection.$anchorCell : selection.$from
  const result = findTable($anchor)
  return result ? result.pos : null
}

// ---------------------------------------------------------------------------
// Resolve cell row/col under mouse pointer
// ---------------------------------------------------------------------------

function resolveCellCoords(
  view: EditorView,
  event: MouseEvent,
  tablePosInDoc: number,
): { rowIdx: number; colIdx: number } | null {
  const hit = view.posAtCoords({ left: event.clientX, top: event.clientY })
  if (!hit) return null

  const $pos = view.state.doc.resolve(hit.pos)
  let cellPos: number | null = null
  for (let d = $pos.depth; d >= 0; d--) {
    const name = $pos.node(d).type.name
    if (name === 'tableCell' || name === 'tableHeader') {
      cellPos = $pos.before(d)
      break
    }
  }
  if (cellPos === null) return null

  const tableNode = view.state.doc.nodeAt(tablePosInDoc)
  if (!tableNode) return null
  const tableEnd = tablePosInDoc + tableNode.nodeSize
  if (cellPos < tablePosInDoc || cellPos >= tableEnd) return null

  try {
    const map = TableMap.get(tableNode)
    const relPos = cellPos - (tablePosInDoc + 1)
    const rect = map.findCell(relPos)
    return { rowIdx: rect.top, colIdx: rect.left }
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Plugin factory
// ---------------------------------------------------------------------------

export function createTableControlsPlugin(): Plugin<TableControlsState> {
  let hoverClearTimer: ReturnType<typeof setTimeout> | null = null

  const throttledMousemove = throttle((view: EditorView, event: MouseEvent) => {
    if (view.isDestroyed) return
    const pluginState = tableControlsKey.getState(view.state)
    // Skip updates while a dropdown menu is open (per-instance flag in state)
    if (!pluginState || pluginState.menuOpen || pluginState.tablePos === null) return

    const coords = resolveCellCoords(view, event, pluginState.tablePos)
    const newRowIdx = coords?.rowIdx ?? null
    const newColIdx = coords?.colIdx ?? null

    // Skip dispatch if nothing changed
    if (
      (pluginState.hover?.rowIdx ?? null) === newRowIdx &&
      (pluginState.hover?.colIdx ?? null) === newColIdx
    ) {
      return
    }

    if (hoverClearTimer !== null) { clearTimeout(hoverClearTimer); hoverClearTimer = null }

    view.dispatch(
      view.state.tr.setMeta(tableControlsKey, {
        type: 'hover',
        rowIdx: newRowIdx,
        colIdx: newColIdx,
      } satisfies TableControlsMeta),
    )
  }, 100)

  return new Plugin<TableControlsState>({
    key: tableControlsKey,

    state: {
      init(_config, state): TableControlsState {
        const tablePos = getTablePos(state)
        return {
          tablePos,
          hover: null,
          menuOpen: false,
          decorations: buildDecorations(state.doc, tablePos, null),
        }
      },

      apply(tr, prev, _oldState, newState): TableControlsState {
        const meta = tr.getMeta(tableControlsKey) as
          | TableControlsMeta
          | TableControlsMenuMeta
          | undefined

        if (meta?.type === 'menu') {
          // Per-instance menu-open flag — hover state and decorations unchanged
          return { ...prev, menuOpen: (meta as TableControlsMenuMeta).open }
        }

        if (meta?.type === 'hover') {
          const hoverMeta = meta as TableControlsMeta
          const hover =
            hoverMeta.rowIdx !== null && hoverMeta.colIdx !== null
              ? { rowIdx: hoverMeta.rowIdx, colIdx: hoverMeta.colIdx }
              : null
          return {
            tablePos: prev.tablePos,
            hover,
            menuOpen: prev.menuOpen,
            decorations: buildDecorations(newState.doc, prev.tablePos, hover),
          }
        }

        if (tr.selectionSet || tr.docChanged) {
          const tablePos = getTablePos(newState)
          const sameTable = tablePos === prev.tablePos
          const hover = sameTable ? prev.hover : null
          const decorations = (tr.docChanged || !sameTable)
            ? buildDecorations(newState.doc, tablePos, hover)
            : prev.decorations.map(tr.mapping, newState.doc)
          return { tablePos, hover, menuOpen: prev.menuOpen, decorations }
        }

        return prev
      },
    },

    props: {
      decorations(state) {
        return tableControlsKey.getState(state)?.decorations ?? DecorationSet.empty
      },

      handleDOMEvents: {
        mousemove(view: EditorView, event: Event) {
          throttledMousemove(view, event as MouseEvent)
          return false
        },

        mouseleave(view: EditorView) {
          const pluginState = tableControlsKey.getState(view.state)
          if (!pluginState || pluginState.hover === null) return false

          // If a dropdown is open, the pointer may have left the editor DOM
          // to reach the Radix portal in <body>. Do NOT clear hover — that
          // would reset currentRow/currentCol before the menu action fires.
          if (pluginState.menuOpen) return false

          if (hoverClearTimer !== null) clearTimeout(hoverClearTimer)
          hoverClearTimer = setTimeout(() => {
            hoverClearTimer = null
            if (view.isDestroyed) return
            const current = tableControlsKey.getState(view.state)
            if (!current || current.hover === null) return
            // Re-check: don't clear if a menu was opened during the grace period
            if (current.menuOpen) return
            view.dispatch(
              view.state.tr.setMeta(tableControlsKey, {
                type: 'hover',
                rowIdx: null,
                colIdx: null,
              } satisfies TableControlsMeta),
            )
          }, 150)
          return false
        },
      },
    },

    view() {
      return {
        destroy() {
          // Clear pending timers so callbacks don't fire on a destroyed view
          if (hoverClearTimer !== null) {
            clearTimeout(hoverClearTimer)
            hoverClearTimer = null
          }
        },
      }
    },
  })
}
