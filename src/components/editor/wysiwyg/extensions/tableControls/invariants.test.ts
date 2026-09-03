/**
 * tableControls/invariants.test.ts
 *
 * Verifies the GFM header-row invariant: every allowed row/column action via
 * the commands module must leave the document serialisable as GFM markdown
 * (i.e. getMarkdown() never contains "[table]" and always contains "---").
 *
 * Also verifies the guards added to moveRow:
 *   - moveRow(…, 0, 1) returns false and leaves doc unchanged
 *   - moveRow(…, 1, 0) returns false and leaves doc unchanged
 *
 * Uses createTestEditor() from testUtils so the editor config exactly matches
 * WysiwygEditor (including allowBase64, Markdown options).
 *
 * Note: these tests run headless (no DOM). Operations that need a table
 * selection use selectRow/selectColumn from commands.ts to position the
 * cursor directly via CellSelection dispatch — never editor.chain().focus()
 * (focus() is a no-op in headless and aborts the chain in strict mode).
 */

import { describe, it, expect, afterEach } from 'vitest'
import type { Editor } from '@tiptap/core'
import { createTestEditor, getMarkdown } from '../../testUtils'
import {
  selectRow,
  selectColumn,
  moveRow,
  moveColumn,
  getEditorTablePos,
} from './commands'

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
// ---------------------------------------------------------------------------

import { tableControlsKey, setDropdownOpen, createTableControlsPlugin } from './plugin'
import { Editor as TipTapEditor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Extension } from '@tiptap/core'
import { Table } from '@tiptap/extension-table'
import { TableRow } from '@tiptap/extension-table-row'
import { TableCell } from '@tiptap/extension-table-cell'
import { TableHeader } from '@tiptap/extension-table-header'
import { Markdown } from 'tiptap-markdown'

function makePluginEditor(): TipTapEditor {
  return new TipTapEditor({
    extensions: [
      StarterKit,
      Table.configure({ resizable: false }),
      TableRow,
      TableCell,
      TableHeader,
      Markdown.configure({ html: false }),
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
