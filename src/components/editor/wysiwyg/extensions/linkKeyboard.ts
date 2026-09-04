/**
 * wysiwyg/extensions/linkKeyboard.ts
 *
 * Link keyboard extension: Mod-k opens the link popover,
 * Mod-Shift-k removes the link mark, plus table keyboard shortcuts.
 *
 * Also exports MARKDOWN_LINK_REGEX and buildLinkKeyboardExtension.
 */

import type { MutableRefObject } from 'react'
import { Extension, InputRule } from '@tiptap/core'
import type { Editor } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import { findTable, TableMap } from '@tiptap/pm/tables'
import { SuggestionPluginKey } from '@tiptap/suggestion'
import { normalizeUrl } from '../utils'

/**
 * Matches `[text](url)` followed by a space or at end-of-line.
 * Capture groups:
 *   [1] text between [ ]
 *   [2] url between ( )
 *
 * Negative cases handled:
 *   - `[ ]` (task list unchecked) — empty text after trim
 *   - `[x]` or `[X]` (task list checked) — single letter, rejected by handler
 *   - `[foo]` without `(url)` — regex won't match
 *   - `[text]()` — empty url, regex requires 1+ chars in url group
 *
 * Note: single char link text like `[x](https://x.com)` is also blocked by
 * the handler guard as an intentional task-list disambiguation tradeoff.
 */
export const MARKDOWN_LINK_REGEX = /\[([^\]]+)\]\(([^)]+)\)\s?$/

// ---------------------------------------------------------------------------
// Table cell helpers
// ---------------------------------------------------------------------------

/**
 * Returns true when the caret is directly inside a tableCell or tableHeader.
 * (Checking from the innermost depth outward until we hit a table boundary.)
 */
function isInTableCell(editor: Editor): boolean {
  const { $from } = editor.state.selection
  for (let d = $from.depth; d >= 0; d--) {
    const name = $from.node(d).type.name
    if (name === 'tableCell' || name === 'tableHeader') return true
    if (name === 'table') break
  }
  return false
}

/**
 * Move the caret to the cell directly below the current one (same column, next
 * row). If the caret is in the last row, adds a new row first (via the TipTap
 * addRowAfter command on the updated state) then places the caret in the
 * correct column of the new row.
 *
 * Returns true if the command was handled (caret was in a table cell);
 * false if the caret is outside a table (caller should fall through).
 *
 * Exported for unit testing.
 */
export function moveToCellBelow(editor: Editor): boolean {
  const { state, view } = editor
  const { selection: { $from } } = state

  // Find the cell depth (may be paragraph inside cell — walk up)
  let cellDepth = -1
  for (let d = $from.depth; d >= 0; d--) {
    const name = $from.node(d).type.name
    if (name === 'tableCell' || name === 'tableHeader') {
      cellDepth = d
      break
    }
    if (name === 'table') break
  }
  if (cellDepth === -1) return false

  const tableResult = findTable($from)
  if (!tableResult) return false

  const { node: tableNode, pos: tablePos } = tableResult
  const map = TableMap.get(tableNode)

  // Position of the current cell node in the document.
  // $from.before(cellDepth) gives the position just before the cell node.
  const cellAbsPos = $from.before(cellDepth)
  // The table's content starts at tablePos + 1 (skip table opening token).
  const cellRelPos = cellAbsPos - (tablePos + 1)
  const rect = map.findCell(cellRelPos)
  const currentRow = rect.top
  const currentCol = rect.left

  if (currentRow + 1 >= map.height) {
    // ── Last row: add a row after the current row then navigate ────────────
    // addRowAfter uses the current selection (which is inside the current row).
    editor.chain().addRowAfter().run()

    // Re-read state after the command (addRowAfter dispatches a transaction).
    const newState = editor.state
    const newTableNode = newState.doc.nodeAt(tablePos)
    if (!newTableNode) return true // shouldn't happen, but be safe

    const newMap = TableMap.get(newTableNode)
    const newRow = currentRow + 1

    if (newRow < newMap.height) {
      // Find the cell in the new row at the same column, clamp to valid range.
      const col = Math.min(currentCol, newMap.width - 1)
      const targetRelPos = newMap.map[newRow * newMap.width + col]
      // +1 to enter the cell content (past the cell's opening token)
      const targetAbsPos = tablePos + 1 + targetRelPos + 1
      const $target = newState.doc.resolve(
        Math.min(targetAbsPos, newState.doc.content.size),
      )
      view.dispatch(newState.tr.setSelection(TextSelection.near($target)))
    }
    return true
  }

  // ── Navigate to cell below (same column, next row) ─────────────────────
  const col = Math.min(currentCol, map.width - 1)
  const targetRelPos = map.map[(currentRow + 1) * map.width + col]
  // +1 to enter the cell content (past the cell's opening token)
  const targetAbsPos = tablePos + 1 + targetRelPos + 1
  const $target = state.doc.resolve(
    Math.min(targetAbsPos, state.doc.content.size),
  )
  view.dispatch(state.tr.setSelection(TextSelection.near($target)))
  return true
}

// ---------------------------------------------------------------------------
// buildLinkKeyboardExtension
// ---------------------------------------------------------------------------

/**
 * Builds the link keyboard extension: Mod-k opens the link popover,
 * Mod-Shift-k removes the link mark, table keyboard shortcuts.
 *
 * Table shortcuts only fire when the caret is inside a table; otherwise
 * they return false so the key falls through to other handlers.
 *
 * Enter / Shift-Enter inside a table cell:
 *   • Enter  — moves caret to the cell below (same column, next row).
 *              If in the last row, adds a new row first. Prevents the default
 *              splitBlock behaviour that creates childCount > 1 in a cell
 *              (which causes tiptap-markdown to emit "[table]").
 *   • Shift-Enter — no-op (returns true to consume the event). A hardBreak
 *              inside a cell also breaks the isMarkdownSerializable check;
 *              there is no GFM syntax for a line break inside a cell.
 *              Users needing multi-line cells should use Markdown source mode.
 *   Both handlers return false when not in a table cell so normal behaviour
 *   is untouched everywhere else in the document.
 */
export function buildLinkKeyboardExtension(
  openLinkRef: MutableRefObject<(() => void) | null>,
): Extension {
  return Extension.create({
    name: 'linkKeyboard',

    /**
     * Priority 1000 ensures this extension's keymap plugin is registered
     * BEFORE StarterKit's HardBreak extension (default priority 100).
     * TipTap resolves extensions in descending priority order, so the
     * Shift-Enter no-op and Enter→moveToCellBelow handlers run first and
     * return true, preventing HardBreak from inserting a hardBreak node
     * inside table cells (which would break tiptap-markdown serialisation
     * and emit literal "[hardBreak]" in GFM table cells).
     */
    priority: 1000,

    addKeyboardShortcuts() {
      return {
        // Open link popover
        'Mod-k': () => {
          openLinkRef.current?.()
          return true
        },
        // Remove link mark
        'Mod-Shift-k': ({ editor }: { editor: Editor }) => {
          if (!editor.isActive('link')) return false
          editor.chain().focus().extendMarkRange('link').unsetLink().run()
          return true
        },

        // ── Enter: move to cell below (or add row) ──────────────────────────
        // priority:1000 puts this keymap ahead of the slash-menu Suggestion
        // plugin's handleKeyDown, so yield while the menu is open — Enter
        // must select the highlighted slash item, not change cells.
        'Enter': ({ editor }: { editor: Editor }) => {
          if (SuggestionPluginKey.getState(editor.state)?.active) return false
          return moveToCellBelow(editor)
        },

        // ── Shift-Enter: no-op inside a table cell ──────────────────────────
        'Shift-Enter': ({ editor }: { editor: Editor }) => {
          if (!isInTableCell(editor)) return false
          return true
        },

        // ── Table structure shortcuts ───────────────────────────────────────
        // These also gate on editor.isActive('table'), which is true
        // whenever the selection is anywhere inside a table.
        'Mod-Enter': ({ editor }: { editor: Editor }) => {
          if (!editor.isActive('table')) return false
          editor.chain().focus().addRowAfter().run()
          return true
        },
        'Mod-Shift-Enter': ({ editor }: { editor: Editor }) => {
          if (!editor.isActive('table')) return false
          editor.chain().focus().addRowBefore().run()
          return true
        },
        'Mod-Alt-ArrowRight': ({ editor }: { editor: Editor }) => {
          if (!editor.isActive('table')) return false
          editor.chain().focus().addColumnAfter().run()
          return true
        },
        'Mod-Alt-ArrowLeft': ({ editor }: { editor: Editor }) => {
          if (!editor.isActive('table')) return false
          editor.chain().focus().addColumnBefore().run()
          return true
        },
        'Mod-Alt-Backspace': ({ editor }: { editor: Editor }) => {
          if (!editor.isActive('table')) return false
          editor.chain().focus().deleteRow().run()
          return true
        },
      }
    },
    addInputRules() {
      const linkType = this.editor.schema.marks.link
      if (!linkType) return []

      return [
        new InputRule({
          find: MARKDOWN_LINK_REGEX,
          handler({ state, range, match }) {
            const text = match[1]
            const rawUrl = match[2]
            if (!text || !rawUrl) return null

            // Reject single char task-list matches: [ ] or [x]
            if (text.trim().length <= 1 && /^[\s xX]$/.test(text)) return null

            const href = normalizeUrl(rawUrl)
            if (!href) return null

            const { tr } = state
            // Replace the full match (including trailing space) with linked text
            const fullMatch = match[0]
            const hasTrailingSpace = fullMatch.endsWith(' ')
            const linkText = text
            const from = range.from
            const to = range.to

            tr.delete(from, to)
            const linkMark = linkType.create({ href })
            const textNode = state.schema.text(linkText, [linkMark])
            tr.insert(from, textNode)
            // Remove the link mark from cursor so subsequent typing is plain
            tr.removeStoredMark(linkType)
            // Add the trailing space back (outside the link)
            if (hasTrailingSpace) {
              tr.insertText(' ', from + linkText.length)
            }
          },
        }),
      ]
    },
  })
}
