/**
 * wysiwyg/extensions/tableInvariant.ts
 *
 * TipTap Extension that enforces the GFM table structure invariants at the
 * document level via a ProseMirror appendTransaction plugin.
 *
 * Invariants guaranteed by this plugin:
 *   1. Cell-type rule: in every table, row 0 cells must be `tableHeader`;
 *      all other rows' cells must be `tableCell`.
 *   2. Single-paragraph rule: every cell must have childCount === 1, and that
 *      child must be a `paragraph` node. Violated cells are normalised:
 *        • Multiple children (e.g. two paragraphs created by a split-block):
 *          their text is joined with a single space into one paragraph.
 *          Inline marks are lost in this flatten — acceptable as the primary
 *          guard against Enter-in-cell → content loss.
 *        • Single non-paragraph child (e.g. a pasted bullet list or heading):
 *          replaced with a paragraph containing the cell's plain textContent.
 *          Inline marks are lost — this is the expected fallback.
 *        • Empty cell (childCount === 0): an empty paragraph is inserted.
 *   3. No-hardBreak rule: any `hardBreak` node inside a cell paragraph is
 *      replaced with a single text space (preserving surrounding text nodes
 *      and their marks). This closes the HTML paste path
 *      (`<td>x<br>y</td>` → paragraph with a hardBreak inline) that
 *      tiptap-markdown cannot serialise inside GFM cells, warning
 *      "hardBreak node is only available in html mode" and emitting the
 *      literal string "[hardBreak]".
 *
 * What this plugin does NOT cover:
 *   • Colspan / rowspan > 1 (not reachable from the UI — GFM has no syntax
 *     for spans; prosemirror-tables' mergeCells command is not exposed).
 *     isRectangularTable() still gates Move row/column operations.
 *   • Already-invalid content arriving via setContent is repaired on the next
 *     doc-changing transaction. The Markdown parser never produces invalid
 *     tables, so this only matters for direct ProseMirror manipulation.
 *
 * Why this matters:
 *   tiptap-markdown's table serialiser (isMarkdownSerializable) checks all
 *   three conditions (cell types, no spans, single paragraph per cell). If
 *   any is violated it falls back to the HTML serialiser which, with
 *   html:false, writes the literal string "[table]" — silent content loss.
 *   Even when the structure passes the serialisability check, a hardBreak
 *   inside a cell paragraph causes tiptap-markdown to emit "[hardBreak]"
 *   (the serialiser has no GFM representation for line-breaks inside cells).
 *
 * This centralises invariant enforcement so:
 *   - Enter-in-cell (splitBlock → two paragraphs in one cell) is immediately
 *     collapsed back to a single paragraph, preventing [table] on serialise.
 *   - Shift-Enter / HTML paste of <br> inside <td> → hardBreak removed.
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
 *   only changes nodes where they are wrong. After the fix all cells have
 *   correct types and single paragraph children without any hardBreak nodes
 *   → the subsequent appendTransaction call on the fixing transaction finds
 *   no violations and returns null → loop terminates.
 *
 * Position stability:
 *   setNodeMarkup (type fixes) does not change node size — all collected fix
 *   positions remain valid throughout the application loop.
 *   replaceWith (content fixes) changes sizes; fixes are applied in descending
 *   position order so each replacement does not invalidate subsequent ones.
 *   hardBreak fixes (inline replaceWith) are also applied in descending
 *   position order within each cell, and cells are processed in descending
 *   cell position order.
 */

import { Extension } from '@tiptap/core'
import { Plugin } from '@tiptap/pm/state'
import type { NodeType, Node } from '@tiptap/pm/model'

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
          const paragraphType = schema.nodes.paragraph as NodeType | undefined
          const hardBreakType = schema.nodes.hardBreak as NodeType | undefined

          // Schema may not include table node types (minimal test editors).
          if (!headerType || !cellType) return null

          // ── Collect fixes ─────────────────────────────────────────────────

          // Type fixes: cells with the wrong type (header/cell confusion).
          // setNodeMarkup does not change node size — positions are stable.
          const typeFixes: Array<{
            pos: number
            type: NodeType
            attrs: Record<string, unknown>
          }> = []

          // Content fixes: cells whose content isn't a single paragraph.
          // replaceWith changes sizes — apply in descending position order.
          const contentFixes: Array<{
            pos: number
            nodeSize: number
            newNode: Node
          }> = []

          // hardBreak fixes: inline hardBreak nodes inside cell paragraphs
          // that must be replaced with a space text node.
          // replaceWith changes sizes — applied in descending position order
          // per cell, and cells processed in descending position order.
          const hardBreakFixes: Array<{
            pos: number   // absolute position of the hardBreak opening token
            nodeSize: number  // always 1 for an atom node
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
              const expectedType = rowIdx === 0 ? headerType : cellType

              rowNode.forEach((cellNode, cellOffset) => {
                // Absolute position of this cell's opening token:
                //   rowAbsPos + 1 (skip row opening token) + cellOffset
                const cellAbsPos = rowAbsPos + 1 + cellOffset

                // ── Fix 1: wrong cell type ──────────────────────────────────
                if (cellNode.type !== expectedType) {
                  typeFixes.push({
                    pos: cellAbsPos,
                    type: expectedType,
                    // tableHeader and tableCell share the same attribute set
                    // (colspan, rowspan, colwidth) so attrs carry across safely.
                    attrs: cellNode.attrs as Record<string, unknown>,
                  })
                }

                // ── Fix 2: cell content not a single paragraph ──────────────
                // Only attempt if the schema has a paragraph type.
                if (paragraphType) {
                  const needsContentFix =
                    cellNode.childCount !== 1 ||
                    (cellNode.firstChild !== null &&
                      cellNode.firstChild.type !== paragraphType)

                  if (needsContentFix) {
                    // Flatten all children's text into a single paragraph.
                    // Inline marks are lost intentionally (comment above explains why).
                    let textContent: string
                    if (cellNode.childCount > 1) {
                      // Multiple children (e.g. split-block → two paragraphs):
                      // collect each child's trimmed text and join with a space.
                      const parts: string[] = []
                      cellNode.forEach((child) => {
                        const t = child.textContent.trim()
                        if (t) parts.push(t)
                      })
                      textContent = parts.join(' ')
                    } else {
                      // Single non-paragraph child (list, heading, etc.)
                      // or empty cell (childCount === 0): use raw textContent.
                      textContent = cellNode.textContent
                    }

                    const para = paragraphType.create(
                      null,
                      textContent ? schema.text(textContent) : null,
                    )
                    // Rebuild the cell node with the corrected single-paragraph content
                    // AND the correct cell type (expectedType). This handles the case
                    // where a cell needs both a type fix and a content fix simultaneously
                    // (e.g. an HTML-pasted header-row cell with two paragraphs). Using
                    // expectedType here rather than cellNode.type means both violations
                    // are resolved in a single pass instead of requiring two appendTransaction
                    // cycles. The type fix collected above (typeFixes) for this same cell
                    // is superseded by this replaceWith — it will apply setNodeMarkup to
                    // the replaced node, which is harmless (the new node already has the
                    // right type), but the ordering ensures position stability.
                    const newCellNode = expectedType.create(cellNode.attrs, para)
                    contentFixes.push({
                      pos: cellAbsPos,
                      nodeSize: cellNode.nodeSize,
                      newNode: newCellNode,
                    })
                    // When a content fix will replace the entire cell, there is
                    // no need to also collect hardBreak fixes for its children —
                    // the replacement paragraph won't contain any hardBreaks.
                    return // skip hardBreak walk for this cell
                  }
                }

                // ── Fix 3: hardBreak nodes inside cell paragraphs ──────────
                // A hardBreak inside a cell paragraph causes tiptap-markdown
                // to emit "[hardBreak]" (no GFM representation for <br> in
                // table cells). Replace each hardBreak with a space text node.
                // Only reached when the cell already has a single paragraph
                // (Fix 2 did not trigger), so we only need to inspect the
                // first (and only) paragraph child.
                if (hardBreakType && cellNode.childCount === 1 && paragraphType &&
                    cellNode.firstChild?.type === paragraphType) {
                  const paraNode = cellNode.firstChild
                  // Absolute position of the paragraph opening token:
                  //   cellAbsPos + 1 (skip cell opening token)
                  const paraAbsPos = cellAbsPos + 1
                  paraNode.forEach((inlineNode, inlineOffset) => {
                    if (inlineNode.type === hardBreakType) {
                      // Absolute position of this hardBreak:
                      //   paraAbsPos + 1 (skip paragraph opening token) + inlineOffset
                      hardBreakFixes.push({
                        pos: paraAbsPos + 1 + inlineOffset,
                        nodeSize: inlineNode.nodeSize,
                      })
                    }
                  })
                }
              })
              rowIdx++
            })

            return false // do not recurse into table children — handled above
          })

          if (typeFixes.length === 0 && contentFixes.length === 0 && hardBreakFixes.length === 0) return null

          // ── Build a single fixing transaction ─────────────────────────────
          // Mark as non-history so auto-corrections don't pollute the undo stack.
          const tr = newState.tr
          tr.setMeta('addToHistory', false)

          // Apply type fixes first (setNodeMarkup — no size change).
          for (const fix of typeFixes) {
            tr.setNodeMarkup(fix.pos, fix.type, fix.attrs)
          }

          // Apply all size-changing fixes (contentFixes + hardBreakFixes) in a
          // SINGLE descending-position pass. This is critical for position
          // stability: contentFixes use replaceWith with size changes; if they
          // were applied in a separate loop before hardBreakFixes, a content fix
          // at a lower position would shift the stored hardBreak positions above
          // it, making them stale. Merging both arrays and sorting descending
          // ensures every fix operates on positions that are unaffected by all
          // previously applied fixes (which were all at higher positions).
          //
          // Note: a cell that needs a content fix skips hardBreak collection
          // (the `return` inside the forEach above), so contentFixes and
          // hardBreakFixes never target overlapping ranges.
          const spaceNode = newState.schema.text(' ')
          const allSizeFixes: Array<{ pos: number; nodeSize: number; replacement: Node }> = [
            ...contentFixes.map((f) => ({ pos: f.pos, nodeSize: f.nodeSize, replacement: f.newNode })),
            ...hardBreakFixes.map((f) => ({ pos: f.pos, nodeSize: f.nodeSize, replacement: spaceNode })),
          ]
          allSizeFixes.sort((a, b) => b.pos - a.pos)
          for (const fix of allSizeFixes) {
            tr.replaceWith(fix.pos, fix.pos + fix.nodeSize, fix.replacement)
          }

          return tr
        },
      }),
    ]
  },
})
