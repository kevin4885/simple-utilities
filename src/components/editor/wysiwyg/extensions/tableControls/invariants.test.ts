/**
 * tableControls/invariants.test.ts
 *
 * Verifies the GFM table structure invariants enforced by tableInvariantExtension:
 *
 *   1. Header-row invariant: row 0 = all tableHeader; rows 1+ = all tableCell.
 *   2. Single-paragraph invariant: every cell must contain exactly one paragraph
 *      child. Multi-paragraph cells (e.g. from a splitBlock / Enter-in-cell)
 *      have their text joined; non-paragraph cells (pasted list, heading) are
 *      flattened to plain text.
 *
 * Also verifies:
 *   - All allowed row/column actions keep the table GFM-serialisable.
 *   - moveRow header-row guards (returns false, doc unchanged).
 *   - Enter-in-cell (via manual splitBlock simulation) does not produce [table].
 *   - Valid table is untouched (node identity === — idempotency).
 *
 * All tests use createTestEditor() from testUtils so the editor config exactly
 * matches WysiwygEditor (including allowBase64, Markdown options, tableInvariant).
 *
 * Note: these tests run headless (no DOM). Operations that need a table
 * selection use selectRow/selectColumn from commands.ts to position the
 * cursor directly via CellSelection dispatch — never editor.chain().focus()
 * (focus() is a no-op in headless and aborts the chain in strict mode).
 */

import { describe, it, expect, afterEach } from 'vitest'
import type { Editor } from '@tiptap/core'
import { Extension } from '@tiptap/core'
import { createTestEditor, getMarkdown, buildCoreExtensions } from '../../testUtils'
import { Editor as TipTapEditor } from '@tiptap/core'
import {
  selectRow,
  selectColumn,
  moveRow,
  moveColumn,
  getEditorTablePos,
} from './commands'
import { tableControlsKey, setDropdownOpen, createTableControlsPlugin } from './plugin'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TABLE_2X2 = `| A | B |
|---|---|
| 1 | 2 |`

const TABLE_3X3 = `| A | B | C |
|---|---|---|
| 1 | 2 | 3 |
| 4 | 5 | 6 |`

function editorTablePos(editor: Editor): number {
  const pos = getEditorTablePos(editor)
  if (pos === null) throw new Error('No table found')
  return pos
}

/**
 * A GFM table serialisation always:
 *   - does NOT contain the fallback string "[table]"
 *   - contains a "---" delimiter row (tiptap-markdown outputs "| --- | --- |")
 *   - contains "|" (pipe characters)
 * These three conditions together detect a successfully serialised GFM table.
 */
function isGfmTable(md: string): boolean {
  return !md.includes('[table]') && md.includes('---') && md.includes('|')
}

// ---------------------------------------------------------------------------
// GFM invariant: all allowed actions keep the table serialisable
// ---------------------------------------------------------------------------

describe('GFM header-row invariant', () => {
  let editor: Editor

  afterEach(() => { editor?.destroy() })

  it('TABLE_2X2 fixture parses and re-serialises as GFM table (real config)', () => {
    editor = createTestEditor(TABLE_2X2)
    const md = getMarkdown(editor)
    expect(isGfmTable(md)).toBe(true)
  })

  it('TABLE_3X3 fixture parses and re-serialises as GFM table (real config)', () => {
    editor = createTestEditor(TABLE_3X3)
    const md = getMarkdown(editor)
    expect(isGfmTable(md)).toBe(true)
  })

  it('addRowAfter on a body row keeps GFM invariant', () => {
    editor = createTestEditor(TABLE_2X2)
    const tablePos = editorTablePos(editor)
    // Select body row 1 (index 1) so addRowAfter appends after it
    selectRow(editor, tablePos, 1)
    editor.chain().addRowAfter().run()
    const md = getMarkdown(editor)
    expect(isGfmTable(md)).toBe(true)
  })

  it('addRowBefore on a body row (not header) keeps GFM invariant', () => {
    editor = createTestEditor(TABLE_3X3)
    const tablePos = editorTablePos(editor)
    // Select body row 2 (last row); insert before it — still in body
    selectRow(editor, tablePos, 2)
    editor.chain().addRowBefore().run()
    const md = getMarkdown(editor)
    expect(isGfmTable(md)).toBe(true)
  })

  it('deleteRow on a body row (not header) keeps GFM invariant', () => {
    editor = createTestEditor(TABLE_3X3)
    const tablePos = editorTablePos(editor)
    // Select body row 2 (last row)
    selectRow(editor, tablePos, 2)
    editor.chain().deleteRow().run()
    const md = getMarkdown(editor)
    expect(isGfmTable(md)).toBe(true)
  })

  it('moveRow body rows only never produces [table]', () => {
    editor = createTestEditor(TABLE_3X3)
    const tablePos = editorTablePos(editor)
    // Move body row 1 → row 2 (allowed)
    const result = moveRow(editor, tablePos, 1, 2)
    expect(result).toBe(true)
    const md = getMarkdown(editor)
    expect(isGfmTable(md)).toBe(true)
  })

  it('moveColumn never produces [table]', () => {
    editor = createTestEditor(TABLE_3X3)
    const tablePos = editorTablePos(editor)
    const result = moveColumn(editor, tablePos, 0, 2)
    expect(result).toBe(true)
    const md = getMarkdown(editor)
    expect(isGfmTable(md)).toBe(true)
  })

  it('addColumnAfter never produces [table]', () => {
    editor = createTestEditor(TABLE_2X2)
    const tablePos = editorTablePos(editor)
    // Select a column so addColumnAfter knows where to insert
    selectColumn(editor, tablePos, 1)
    editor.chain().addColumnAfter().run()
    const md = getMarkdown(editor)
    expect(isGfmTable(md)).toBe(true)
  })

  it('addColumnBefore never produces [table]', () => {
    editor = createTestEditor(TABLE_2X2)
    const tablePos = editorTablePos(editor)
    selectColumn(editor, tablePos, 1)
    editor.chain().addColumnBefore().run()
    const md = getMarkdown(editor)
    expect(isGfmTable(md)).toBe(true)
  })

  it('deleteColumn never produces [table]', () => {
    editor = createTestEditor(TABLE_3X3)
    const tablePos = editorTablePos(editor)
    // Select last column so deleting it keeps the table non-empty
    selectColumn(editor, tablePos, 2)
    editor.chain().deleteColumn().run()
    const md = getMarkdown(editor)
    expect(isGfmTable(md)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// moveRow header-row guards
// ---------------------------------------------------------------------------

describe('moveRow header-row guards', () => {
  let editor: Editor

  afterEach(() => { editor?.destroy() })

  it('moveRow(…, 0, 1) returns false — header row must not move', () => {
    editor = createTestEditor(TABLE_3X3)
    const tablePos = editorTablePos(editor)
    const docBefore = editor.state.doc

    const result = moveRow(editor, tablePos, 0, 1)

    expect(result).toBe(false)
    // Document unchanged
    expect(editor.state.doc).toBe(docBefore)
  })

  it('moveRow(…, 1, 0) returns false — no body row may take header position', () => {
    editor = createTestEditor(TABLE_3X3)
    const tablePos = editorTablePos(editor)
    const docBefore = editor.state.doc

    const result = moveRow(editor, tablePos, 1, 0)

    expect(result).toBe(false)
    expect(editor.state.doc).toBe(docBefore)
  })

  it('moveRow(…, 2, 1) returns true and keeps GFM invariant', () => {
    editor = createTestEditor(TABLE_3X3)
    const tablePos = editorTablePos(editor)

    const result = moveRow(editor, tablePos, 2, 1)

    expect(result).toBe(true)
    const md = getMarkdown(editor)
    expect(isGfmTable(md)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Plugin state: per-instance menuOpen meta
//
// Uses buildCoreExtensions() + a test-only Extension wrapping createTableControlsPlugin.
// This replaces the old makePluginEditor() that hand-rolled its own StarterKit
// + Table + Markdown array (which diverged from the component config).
// ---------------------------------------------------------------------------

function makePluginEditor(): TipTapEditor {
  return new TipTapEditor({
    extensions: [
      ...buildCoreExtensions(),
      Extension.create({
        name: 'tableControlsTest',
        addProseMirrorPlugins() {
          return [createTableControlsPlugin()]
        },
      }),
    ],
    content: TABLE_3X3,
  })
}

describe('tableControlsPlugin menuOpen meta', () => {
  let pluginEditor: TipTapEditor

  afterEach(() => { pluginEditor?.destroy() })

  it('initial menuOpen is false', () => {
    pluginEditor = makePluginEditor()
    const state = tableControlsKey.getState(pluginEditor.state)
    expect(state?.menuOpen).toBe(false)
  })

  it('setDropdownOpen(editor, true) sets menuOpen = true in plugin state', () => {
    pluginEditor = makePluginEditor()
    setDropdownOpen(pluginEditor, true)
    const state = tableControlsKey.getState(pluginEditor.state)
    expect(state?.menuOpen).toBe(true)
  })

  it('setDropdownOpen(editor, false) sets menuOpen = false', () => {
    pluginEditor = makePluginEditor()
    setDropdownOpen(pluginEditor, true)
    setDropdownOpen(pluginEditor, false)
    const state = tableControlsKey.getState(pluginEditor.state)
    expect(state?.menuOpen).toBe(false)
  })

  it('mouseleave does NOT clear hover when menuOpen = true', () => {
    pluginEditor = makePluginEditor()

    // Simulate hover by dispatching hover meta
    pluginEditor.view.dispatch(
      pluginEditor.view.state.tr.setMeta(tableControlsKey, {
        type: 'hover',
        rowIdx: 1,
        colIdx: 0,
      }),
    )
    expect(tableControlsKey.getState(pluginEditor.state)?.hover).toEqual({ rowIdx: 1, colIdx: 0 })

    // Open the menu
    setDropdownOpen(pluginEditor, true)

    // Call the mouseleave handler directly via plugin's handleDOMEvents
    const plugin = pluginEditor.state.plugins.find((p) => p.spec.key === tableControlsKey)
    // Access handleDOMEvents from plugin props
    const handleDOMEvents = (plugin?.props as { handleDOMEvents?: { mouseleave?: (view: unknown, event: unknown) => boolean } })?.handleDOMEvents
    if (handleDOMEvents?.mouseleave) {
      // Pass a synthetic event with relatedTarget=null (pointer left the window, not into controls overlay)
      handleDOMEvents.mouseleave(pluginEditor.view, { relatedTarget: null } as unknown as Event)
    }

    // Hover should still be set (not cleared because menu is open)
    expect(tableControlsKey.getState(pluginEditor.state)?.hover).toEqual({ rowIdx: 1, colIdx: 0 })
  })
})

// ---------------------------------------------------------------------------
// tableInvariant plugin — GFM header-row enforcement
//
// Uses createTestEditor() which includes tableInvariantExtension via
// buildCoreExtensions(). These tests confirm that any transaction that leaves
// cells with the wrong type is immediately corrected before serialisation.
// ---------------------------------------------------------------------------

/**
 * Count the number of rows in the first table in the editor doc.
 */
function countTableRows(editor: TipTapEditor): number {
  let rows = 0
  editor.state.doc.descendants((node) => {
    if (node.type.name === 'table') {
      node.forEach((child) => {
        if (child.type.name === 'tableRow') rows++
      })
      return false // stop after first table
    }
    return true
  })
  return rows
}

/**
 * Returns the column count of the first table's first row.
 */
function countTableCols(editor: TipTapEditor): number {
  let cols = 0
  editor.state.doc.descendants((node) => {
    if (node.type.name === 'table') {
      const firstRow = node.firstChild
      if (firstRow) cols = firstRow.childCount
      return false
    }
    return true
  })
  return cols
}

describe('tableInvariant plugin — GFM header-row enforcement', () => {
  let editor: TipTapEditor

  afterEach(() => { editor?.destroy() })

  // ── addRowBefore on the header row ─────────────────────────────────────────
  // Mod-Shift-Enter (addRowBefore) with cursor in row 0 inserts a new row at
  // position 0. Without the invariant plugin the old header becomes a body row
  // but remains typed as tableHeader → [table] on serialise.
  // With the invariant plugin the new row 0 becomes tableHeader and the old
  // header (now row 1) becomes tableCell.
  it('addRowBefore on header row: result still serialises as GFM table', () => {
    editor = createTestEditor(TABLE_2X2)
    const tablePos = editorTablePos(editor)
    // Select header row (row 0) so addRowBefore inserts above it
    selectRow(editor, tablePos, 0)
    editor.chain().addRowBefore().run()
    const md = getMarkdown(editor)
    expect(isGfmTable(md)).toBe(true)
    expect(md).not.toContain('[table]')
    // Row count should have increased by 1 (was 2 rows: 1 header + 1 body)
    expect(countTableRows(editor)).toBe(3)
  })

  it('addRowBefore on header row: column count is unchanged', () => {
    const colsBefore = 2 // TABLE_2X2 has 2 columns
    editor = createTestEditor(TABLE_2X2)
    const tablePos = editorTablePos(editor)
    selectRow(editor, tablePos, 0)
    editor.chain().addRowBefore().run()
    expect(countTableCols(editor)).toBe(colsBefore)
  })

  // ── deleteRow on the header row ────────────────────────────────────────────
  // Mod-Alt-Backspace (deleteRow) with cursor in row 0 removes the header.
  // Without the invariant plugin row 1 (tableCell) becomes row 0 → [table].
  // With the invariant plugin row 1 (now row 0) is promoted to tableHeader.
  it('deleteRow on header row: result still serialises as GFM table', () => {
    editor = createTestEditor(TABLE_3X3)
    const tablePos = editorTablePos(editor)
    selectRow(editor, tablePos, 0)
    editor.chain().deleteRow().run()
    const md = getMarkdown(editor)
    expect(isGfmTable(md)).toBe(true)
    expect(md).not.toContain('[table]')
  })

  it('deleteRow on header row: remaining rows = N-1', () => {
    editor = createTestEditor(TABLE_3X3)
    const tablePos = editorTablePos(editor)
    selectRow(editor, tablePos, 0)
    editor.chain().deleteRow().run()
    // TABLE_3X3 had 3 rows; after deleting the header, 2 rows remain
    expect(countTableRows(editor)).toBe(2)
  })

  // ── HTML paste without <th> / direct cell-type corruption ────────────────
  // Directly corrupt a valid table by changing a header cell to a body cell,
  // then verify the invariant plugin repairs it before the next serialisation.
  it('direct cell-type corruption: row-0 tableCell gets promoted to tableHeader', () => {
    editor = createTestEditor(TABLE_2X2)
    const { schema } = editor.state

    // Find the first cell in row 0 (which is a tableHeader)
    let headerCellPos: number | null = null
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'table') {
        const tableStart = pos + 1
        node.forEach((rowNode, rowOffset) => {
          const rowPos = tableStart + rowOffset
          if (headerCellPos === null) {
            rowNode.forEach((_cellNode, cellOffset) => {
              if (headerCellPos === null) {
                // row 0, first cell
                headerCellPos = rowPos + 1 + cellOffset
              }
            })
          }
        })
        return false
      }
      return true
    })
    expect(headerCellPos).not.toBeNull()

    // Corrupt it: change from tableHeader to tableCell
    const corruptingTr = editor.state.tr.setNodeMarkup(
      headerCellPos!,
      schema.nodes.tableCell,
      {},
    )
    corruptingTr.setMeta('addToHistory', false)
    editor.view.dispatch(corruptingTr)

    // After dispatch the appendTransaction should have fired and fixed it.
    // Serialise and verify.
    const md = getMarkdown(editor)
    expect(isGfmTable(md)).toBe(true)
    expect(md).not.toContain('[table]')
  })

  // ── Two tables in one doc ──────────────────────────────────────────────────
  it('two tables both normalised correctly', () => {
    const twoTables = TABLE_2X2 + '\n\n' + TABLE_3X3
    editor = createTestEditor(twoTables)
    const md = getMarkdown(editor)
    // Both tables should be GFM-serialisable — no [table] fallback
    expect(md).not.toContain('[table]')
    // Both separator rows present
    const pipeCount = (md.match(/\|/g) ?? []).length
    expect(pipeCount).toBeGreaterThan(10) // 2x2 + 3x3 gives many pipes
  })

  // ── Idempotency: valid table produces no appended transaction ──────────────
  // A doc that is already valid must not produce a fixing transaction,
  // because that would mean the plugin appends infinite fixing transactions.
  // We verify this by dispatching a no-op (text insertion in a paragraph)
  // and confirming the table node object is the same reference before and after.
  it('a valid table: plugin appends no fixing transaction (table node identity)', () => {
    // Prepend a paragraph so we can insert text there without touching the table
    const docWithParagraph = 'Some text\n\n' + TABLE_2X2
    editor = createTestEditor(docWithParagraph)

    // Find the table node before the no-op dispatch
    let tableBefore: ReturnType<typeof editor.state.doc.nodeAt> = null
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'table') {
        tableBefore = editor.state.doc.nodeAt(pos)
        return false
      }
      return true
    })
    expect(tableBefore).not.toBeNull()

    // Dispatch a text change in the paragraph (not the table)
    // Position 1 is inside the first paragraph.
    const { tr } = editor.state
    tr.insertText('!', 1)
    editor.view.dispatch(tr)

    // Find the table node after
    let tableAfter: ReturnType<typeof editor.state.doc.nodeAt> = null
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'table') {
        tableAfter = editor.state.doc.nodeAt(pos)
        return false
      }
      return true
    })

    // Same object reference → plugin did NOT rebuild the table (no fixing tr)
    expect(tableAfter).toBe(tableBefore)
  })
})

// ---------------------------------------------------------------------------
// tableInvariant plugin — single-paragraph cell enforcement (Blocking fix)
//
// tiptap-markdown's isMarkdownSerializable requires every cell to have
// childCount === 1 and that child to be a paragraph. These tests verify that
// the invariant plugin normalises cells that violate this rule.
// ---------------------------------------------------------------------------

describe('tableInvariant plugin — single-paragraph cell enforcement', () => {
  let editor: TipTapEditor

  afterEach(() => { editor?.destroy() })

  // ── setContent with two paragraphs in one cell ────────────────────────────
  // Simulates the "Enter in a table cell" bug: splitBlock leaves two
  // paragraphs inside the same cell, which breaks isMarkdownSerializable.
  it('cell with two paragraphs: serialises as GFM (text joined by space)', () => {
    editor = createTestEditor(TABLE_2X2)
    const { schema } = editor.state

    // Find the first body cell (row 1, col 0) and inject two paragraphs.
    let cellPos: number | null = null
    let cellNodeSize = 0
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'table') {
        let rowIdx = 0
        node.forEach((rowNode, rowOffset) => {
          const rowAbsPos = pos + 1 + rowOffset
          if (rowIdx === 1 && cellPos === null) {
            // First cell of row 1
            rowNode.forEach((cellNode, cellOffset) => {
              if (cellPos === null) {
                cellPos = rowAbsPos + 1 + cellOffset
                cellNodeSize = cellNode.nodeSize
              }
            })
          }
          rowIdx++
        })
        return false
      }
      return true
    })
    expect(cellPos).not.toBeNull()

    // Build a tableCell with two paragraph children
    const cellType = schema.nodes.tableCell
    const para1 = schema.nodes.paragraph.create(null, schema.text('hello'))
    const para2 = schema.nodes.paragraph.create(null, schema.text('world'))
    const badCell = cellType.create(null, [para1, para2])

    // Inject it directly (bypassing the invariant's own addToHistory guard)
    const corruptingTr = editor.state.tr.replaceWith(
      cellPos!,
      cellPos! + cellNodeSize,
      badCell,
    )
    corruptingTr.setMeta('addToHistory', false)
    editor.view.dispatch(corruptingTr)

    // The invariant plugin should have fired and merged the two paragraphs.
    const md = getMarkdown(editor)
    expect(md).not.toContain('[table]')
    expect(isGfmTable(md)).toBe(true)
    // The text "hello world" (joined with a space) should appear in the output
    expect(md).toContain('hello world')
  })

  // ── Verify a cell with a bullet-list child is flattened to text ───────────
  it('cell containing a bullet list: flattened to plain text, no [table]', () => {
    editor = createTestEditor(TABLE_2X2)
    const { schema } = editor.state

    // Find the first body cell (row 1, col 0)
    let cellPos: number | null = null
    let cellNodeSize = 0
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'table') {
        let rowIdx = 0
        node.forEach((rowNode, rowOffset) => {
          const rowAbsPos = pos + 1 + rowOffset
          if (rowIdx === 1 && cellPos === null) {
            rowNode.forEach((cellNode, cellOffset) => {
              if (cellPos === null) {
                cellPos = rowAbsPos + 1 + cellOffset
                cellNodeSize = cellNode.nodeSize
              }
            })
          }
          rowIdx++
        })
        return false
      }
      return true
    })
    expect(cellPos).not.toBeNull()

    // Build a tableCell with a bulletList child (not a paragraph)
    const cellType = schema.nodes.tableCell
    const listItemContent = schema.nodes.paragraph.create(null, schema.text('item'))
    const listItem = schema.nodes.listItem
      ? schema.nodes.listItem.create(null, listItemContent)
      : null
    const bulletList = schema.nodes.bulletList && listItem
      ? schema.nodes.bulletList.create(null, [listItem])
      : null

    if (!bulletList) {
      // Schema doesn't have bulletList — skip (shouldn't happen with buildCoreExtensions)
      return
    }

    const badCell = cellType.create(null, [bulletList])
    const corruptingTr = editor.state.tr.replaceWith(
      cellPos!,
      cellPos! + cellNodeSize,
      badCell,
    )
    corruptingTr.setMeta('addToHistory', false)
    editor.view.dispatch(corruptingTr)

    // The invariant plugin should have flattened the list to plain text.
    const md = getMarkdown(editor)
    expect(md).not.toContain('[table]')
    expect(isGfmTable(md)).toBe(true)
    // 'item' text should appear in the serialised table
    expect(md).toContain('item')
  })
})

// ---------------------------------------------------------------------------
// tableInvariant plugin — hardBreak-in-cell enforcement (Blocking fix)
//
// tiptap-markdown cannot serialise a hardBreak node inside a table cell —
// it emits the literal string "[hardBreak]". The invariant plugin replaces
// each hardBreak with a single space text node.
//
// Test cases:
//   1. Paste of <table><tr><th>h</th></tr><tr><td>x<br>y</td></tr></table>
//      → row serialises as "| x y |", no "[hardBreak]", no "[table]"
//   2. A valid table with no hardBreak nodes is left untouched (node identity ===)
// ---------------------------------------------------------------------------

/**
 * Find the position and nodeSize of the first body cell (row 1, col 0).
 */
function firstBodyCell(editor: TipTapEditor): { pos: number; nodeSize: number } | null {
  let result: { pos: number; nodeSize: number } | null = null
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === 'table') {
      let rowIdx = 0
      node.forEach((rowNode, rowOffset) => {
        const rowAbsPos = pos + 1 + rowOffset
        if (rowIdx === 1 && result === null) {
          rowNode.forEach((cellNode, cellOffset) => {
            if (result === null) {
              result = { pos: rowAbsPos + 1 + cellOffset, nodeSize: cellNode.nodeSize }
            }
          })
        }
        rowIdx++
      })
      return false
    }
    return true
  })
  return result
}

describe('tableInvariant plugin — hardBreak-in-cell enforcement', () => {
  let editor: TipTapEditor

  afterEach(() => { editor?.destroy() })

  // ── HTML-paste path: cell paragraph with a hardBreak inline ──────────────
  // Simulates <td>x<br>y</td> parsed as a cell paragraph containing
  // [text("x"), hardBreak, text("y")]. The invariant must replace the
  // hardBreak with a space so markdown yields "| x y |".
  it('cell paragraph with hardBreak: replaced with space, no [hardBreak] in markdown', () => {
    editor = createTestEditor(TABLE_2X2)
    const { schema } = editor.state

    const cell = firstBodyCell(editor)
    expect(cell).not.toBeNull()

    const hardBreakType = schema.nodes.hardBreak
    if (!hardBreakType) return // shouldn't happen with buildCoreExtensions

    // Build cell with paragraph containing [text("x"), hardBreak, text("y")]
    const para = schema.nodes.paragraph.create(null, [
      schema.text('x'),
      hardBreakType.create(),
      schema.text('y'),
    ])
    const badCell = schema.nodes.tableCell.create(null, para)

    const corruptingTr = editor.state.tr.replaceWith(
      cell!.pos,
      cell!.pos + cell!.nodeSize,
      badCell,
    )
    corruptingTr.setMeta('addToHistory', false)
    editor.view.dispatch(corruptingTr)

    const md = getMarkdown(editor)
    expect(md).not.toContain('[hardBreak]')
    expect(md).not.toContain('[table]')
    expect(isGfmTable(md)).toBe(true)
    // hardBreak replaced with space → "x y" in the cell
    expect(md).toContain('x y')
  })

  // ── Full HTML-paste simulation: table with <br> in body cell ─────────────
  // Directly construct a table matching what DOMParser would produce from
  // <table><tr><th>h</th></tr><tr><td>x<br>y</td></tr></table> and inject it.
  it('HTML-paste table with <br> in cell: row serialises as "| x y |", no [hardBreak]', () => {
    editor = createTestEditor('') // start with empty doc
    const { schema } = editor.state

    const hardBreakType = schema.nodes.hardBreak
    if (!hardBreakType) return

    // Build the table: header row with "h", body row with "x<br>y"
    const headerPara = schema.nodes.paragraph.create(null, schema.text('h'))
    const headerCell = schema.nodes.tableHeader.create(null, headerPara)
    const headerRow = schema.nodes.tableRow.create(null, [headerCell])

    const bodyPara = schema.nodes.paragraph.create(null, [
      schema.text('x'),
      hardBreakType.create(),
      schema.text('y'),
    ])
    const bodyCell = schema.nodes.tableCell.create(null, bodyPara)
    const bodyRow = schema.nodes.tableRow.create(null, [bodyCell])

    const table = schema.nodes.table.create(null, [headerRow, bodyRow])

    // Replace the entire document content with this table
    const pasteDoc = schema.nodes.doc.create(null, [table])
    const pasteTr = editor.state.tr.replaceWith(
      0,
      editor.state.doc.content.size,
      pasteDoc.content,
    )
    pasteTr.setMeta('addToHistory', false)
    editor.view.dispatch(pasteTr)

    const md = getMarkdown(editor)
    expect(md).not.toContain('[hardBreak]')
    expect(md).not.toContain('[table]')
    expect(isGfmTable(md)).toBe(true)
    // Header row
    expect(md).toContain('h')
    // Body row: hardBreak replaced by space
    expect(md).toContain('x y')
  })

  // ── Cross-fix regression: content fix (lower position) + hardBreak fix ─────
  // A table where cell 0 (lower position) needs a content fix (two paragraphs)
  // AND cell 1 (higher position) has a hardBreak. Both fixes are size-changing.
  // If they were applied in separate loops (content first, then hardBreak) the
  // hardBreak position would be stale after the content fix shifted it.
  // The invariant merges both into one descending-sorted list to avoid this.
  it('cell with two paragraphs (lower) + cell with hardBreak (higher): both fixed correctly', () => {
    editor = createTestEditor('') // start with empty doc
    const { schema } = editor.state

    const hardBreakType = schema.nodes.hardBreak
    if (!hardBreakType) return

    // Build a 1-header + 1-body-row table with two cells:
    //   header: "A" | "B"
    //   body row:
    //     cell 0 (lower pos): two paragraphs (content fix needed)
    //     cell 1 (higher pos): paragraph with hardBreak (hardBreak fix needed)
    const headerA = schema.nodes.tableHeader.create(null, schema.nodes.paragraph.create(null, schema.text('A')))
    const headerB = schema.nodes.tableHeader.create(null, schema.nodes.paragraph.create(null, schema.text('B')))
    const headerRow = schema.nodes.tableRow.create(null, [headerA, headerB])

    // cell 0: two-paragraph cell (violates single-para rule)
    const cell0 = schema.nodes.tableCell.create(null, [
      schema.nodes.paragraph.create(null, schema.text('p1')),
      schema.nodes.paragraph.create(null, schema.text('p2')),
    ])
    // cell 1: paragraph with hardBreak inline
    const cell1 = schema.nodes.tableCell.create(null,
      schema.nodes.paragraph.create(null, [
        schema.text('x'),
        hardBreakType.create(),
        schema.text('y'),
      ]),
    )
    const bodyRow = schema.nodes.tableRow.create(null, [cell0, cell1])
    const table = schema.nodes.table.create(null, [headerRow, bodyRow])

    const pasteDoc = schema.nodes.doc.create(null, [table])
    const pasteTr = editor.state.tr.replaceWith(
      0,
      editor.state.doc.content.size,
      pasteDoc.content,
    )
    pasteTr.setMeta('addToHistory', false)
    editor.view.dispatch(pasteTr)

    const md = getMarkdown(editor)
    // No invariant-violation fallback strings
    expect(md).not.toContain('[table]')
    expect(md).not.toContain('[hardBreak]')
    expect(isGfmTable(md)).toBe(true)
    // cell 0 text joined with space
    expect(md).toContain('p1 p2')
    // cell 1 hardBreak replaced with space
    expect(md).toContain('x y')
  })

  // ── Idempotency: valid table is untouched (node identity ===) ──────────────
  it('valid table without hardBreak: invariant plugin does NOT touch it (node identity)', () => {
    editor = createTestEditor(TABLE_2X2)

    // Find table node before no-op dispatch
    let tableBefore: ReturnType<typeof editor.state.doc.nodeAt> = null
    let tablePosBefore = -1
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'table') {
        tableBefore = editor.state.doc.nodeAt(pos)
        tablePosBefore = pos
        return false
      }
      return true
    })
    expect(tableBefore).not.toBeNull()

    // Dispatch a doc-changing transaction outside the table
    const docWithParagraph = 'Note\n\n' + TABLE_2X2
    const freshEditor = createTestEditor(docWithParagraph)
    let tablePosInFresh = -1
    freshEditor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'table') { tablePosInFresh = pos; return false }
      return true
    })
    const tableBeforeFresh = freshEditor.state.doc.nodeAt(tablePosInFresh)

    // Insert text in the paragraph (not the table)
    const { tr } = freshEditor.state
    tr.insertText('!', 1)
    freshEditor.view.dispatch(tr)

    const tableAfterFresh = freshEditor.state.doc.nodeAt(tablePosInFresh + 1) // shifted by 1 inserted char
    // Node identity: same object reference (plugin didn't rebuild it)
    expect(tableAfterFresh).toBe(tableBeforeFresh)

    freshEditor.destroy()
    // Original editor untouched too
    const tableAfterOrig = editor.state.doc.nodeAt(tablePosBefore)
    expect(tableAfterOrig).toBe(tableBefore)
  })
})
