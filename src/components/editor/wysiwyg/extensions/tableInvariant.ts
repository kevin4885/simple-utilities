/**
 * wysiwyg/extensions/tableInvariant.ts
 *
 * TipTap Extension that enforces the GFM table header-row invariant at the
 * document level via a ProseMirror appendTransaction plugin.
 *
 * Rule: in every table, row 0 cells must be `tableHeader`; all other rows'
 * cells must be `tableCell`.
 *
 * Why this matters:
 *   tiptap-markdown's table serialiser (isMarkdownSerializable) checks the
 *   invariant: if violated it falls back to the HTML serialiser which, with
 *   html:false, writes the literal string "[table]" — silent content loss.
 *
 * This centralises invariant enforcement so:
 *   - Keyboard shortcuts (addRowBefore / deleteRow on the header row) are
 *     safe even without explicit per-command guards.
 *   - HTML paste of tables without a <th> header row is normalised.
 *   - Any future command that produces a malformed table is corrected before
 *     the document is serialised to markdown.
 *
 * The menu guards in TableControls.tsx remain as UX niceties (e.g. "Delete
 * row" is still disabled on the header row because deleting it and having the
 * invariant silently promote row 1 is confusing). The keyboard shortcut
 * Mod-Shift-Enter (addRowBefore) on the header row is ALLOWED — the invariant
 * corrects the result (new row becomes header, old header becomes body).
 *
 * Idempotency / recursion guard:
 *   appendTransaction is called in a fix-point loop. Our fixing transaction
 *   only changes node types where they are wrong. After the fix, all cells
 *   have correct types → the subsequent appendTransaction call on the fixing
 *   transaction finds no violations and returns null → loop terminates.
 *
 * Position stability:
 *   setNodeMarkup does not change node size (only type/attrs). All collected
 *   fix positions remain valid throughout the application loop.
 */

import { Extension } from '@tiptap/core'
import { Plugin } from '@tiptap/pm/state'
import type { NodeType } from '@tiptap/pm/model'

export const tableInvariantExtension = Extension.create({
  name: 'tableInvariant',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        appendTransaction(transactions, _oldState, newState) {
          // Skip if no transaction changed the document — hover metas, selection
          // changes, etc. do not require a table walk.
          const docChanged = transactions.some((tr) => tr.docChanged)
          if (!docChanged) return null

          const { schema } = newState
          const headerType = schema.nodes.tableHeader as NodeType | undefined
          const cellType = schema.nodes.tableCell as NodeType | undefined

          // Schema may not include table node types (minimal test editors).
          if (!headerType || !cellType) return null

          // Collect { pos, type, attrs } for every cell that has the wrong type.
          const fixes: Array<{
            pos: number
            type: NodeType
            attrs: Record<string, unknown>
          }> = []

          newState.doc.descendants((node, pos) => {
            if (node.type.name !== 'table') return true // recurse into non-table nodes

            // Walk rows manually so we can track rowIdx. Using descendants here
            // instead would lose the row-index context.
            let rowIdx = 0
            node.forEach((rowNode, rowOffset) => {
              // Absolute position of this tableRow's opening token:
              //   tableAbsPos + 1 (skip table opening token) + rowOffset
              const rowAbsPos = pos + 1 + rowOffset
              const expectedType = rowIdx === 0 ? headerType! : cellType!

              rowNode.forEach((cellNode, cellOffset) => {
                if (cellNode.type !== expectedType) {
                  fixes.push({
                    // Absolute position of this cell's opening token:
                    //   rowAbsPos + 1 (skip row opening token) + cellOffset
                    pos: rowAbsPos + 1 + cellOffset,
                    type: expectedType,
                    // tableHeader and tableCell share the same attribute set
                    // (colspan, rowspan, colwidth) so attrs carry across safely.
                    attrs: cellNode.attrs as Record<string, unknown>,
                  })
                }
              })
              rowIdx++
            })

            return false // do not recurse into table children — handled above
          })

          if (fixes.length === 0) return null

          // Build a single fixing transaction.
          // Mark as non-history so auto-corrections don't pollute the undo stack.
          const tr = newState.tr
          tr.setMeta('addToHistory', false)
          for (const fix of fixes) {
            tr.setNodeMarkup(fix.pos, fix.type, fix.attrs)
          }
          return tr
        },
      }),
    ]
  },
})
