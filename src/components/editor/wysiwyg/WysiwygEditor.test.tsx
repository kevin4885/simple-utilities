/**
 * WysiwygEditor.test.tsx
 *
 * Component-level integration tests for WysiwygEditor.
 *
 * Tests:
 *   1. Extension superset: renders <WysiwygEditor>, gets the live TipTap editor
 *      from the .ProseMirror element, and asserts that the extension list is a
 *      strict superset of buildCoreExtensions() names. This is a real runtime
 *      check — it catches the case where buildCoreExtensions() and WysiwygEditor
 *      drift apart even though WysiwygEditor spreads ...buildCoreExtensions() in
 *      its useMemo (which it always does — the test proves the spread is still
 *      there after future refactors).
 *   2. editor.setEditable(!readOnly) is applied when readOnly prop changes.
 *   3. Placeholder function: rerender with new placeholder prop updates the
 *      data-placeholder attribute on the empty paragraph.
 */

import { describe, it, expect } from 'vitest'
import { render, act } from '@testing-library/react'
import WysiwygEditor from './WysiwygEditor'
import { buildCoreExtensions } from './coreExtensions'
import type { Editor } from '@tiptap/core'

// ---------------------------------------------------------------------------
// 1. Extension superset assertion (Blocking 2) — real component render
// ---------------------------------------------------------------------------

describe('WysiwygEditor extension superset of buildCoreExtensions()', () => {
  it('live editor extension names ⊇ buildCoreExtensions() names', async () => {
    const { container, unmount } = render(
      <WysiwygEditor value="# Hello" />,
    )

    // Allow the editor to mount and initialise
    await act(async () => { await new Promise((r) => setTimeout(r, 50)) })

    // Get the TipTap editor instance from the ProseMirror DOM element
    const pm = container.querySelector('.ProseMirror') as HTMLElement | null
    expect(pm).toBeTruthy()
    // TipTap attaches the editor instance to the .ProseMirror element
    const editor = (pm as unknown as { editor?: Editor }).editor
    expect(editor).toBeTruthy()
    expect(editor!.isDestroyed).toBe(false)

    const coreExtensions = buildCoreExtensions()
    const coreNames = coreExtensions
      .map((e) => (e as { name?: string }).name)
      .filter((n): n is string => Boolean(n))

    const editorNames = editor!.extensionManager.extensions.map((e) => e.name)

    // Sanity: coreExtensions has more than 5 items
    expect(coreNames.length).toBeGreaterThan(5)

    // Every core extension name must appear in the live editor's extension list
    for (const name of coreNames) {
      expect(editorNames).toContain(name)
    }

    // Critical GFM invariant extensions explicitly asserted
    expect(editorNames).toContain('tableInvariant')
    expect(editorNames).toContain('table')
    expect(editorNames).toContain('tableHeader')
    expect(editorNames).toContain('tableCell')
    expect(editorNames).toContain('link')
    expect(editorNames).toContain('image')
    expect(editorNames).toContain('markdown')

    unmount()
  })
})

// ---------------------------------------------------------------------------
// 2. readOnly → editor.setEditable() propagation
// ---------------------------------------------------------------------------

describe('WysiwygEditor readOnly prop', () => {
  it('editor becomes non-editable when readOnly=true', async () => {
    function Editor({ readOnly }: { readOnly: boolean }) {
      return (
        <WysiwygEditor
          value="hello"
          readOnly={readOnly}
        />
      )
    }

    const { rerender, container } = render(<Editor readOnly={false} />)

    // Allow editor to mount
    await act(async () => { await new Promise((r) => setTimeout(r, 50)) })

    const prosemirror = container.querySelector('[contenteditable]')
    expect(prosemirror?.getAttribute('contenteditable')).toBe('true')

    await act(async () => {
      rerender(<Editor readOnly={true} />)
      await new Promise((r) => setTimeout(r, 50))
    })

    expect(prosemirror?.getAttribute('contenteditable')).toBe('false')
  })
})

// ---------------------------------------------------------------------------
// 3. Placeholder function: live update on rerender
// ---------------------------------------------------------------------------

describe('WysiwygEditor placeholder prop', () => {
  it('data-placeholder attribute updates when placeholder prop changes', async () => {
    function Editor({ placeholder }: { placeholder: string }) {
      return (
        <WysiwygEditor
          value=""
          placeholder={placeholder}
        />
      )
    }

    const { rerender, container } = render(<Editor placeholder="First placeholder" />)

    await act(async () => { await new Promise((r) => setTimeout(r, 50)) })

    const getPlaceholderAttr = () =>
      container.querySelector('[data-placeholder]')?.getAttribute('data-placeholder')

    expect(getPlaceholderAttr()).toBe('First placeholder')

    await act(async () => {
      rerender(<Editor placeholder="Updated placeholder" />)
      await new Promise((r) => setTimeout(r, 50))
    })

    expect(getPlaceholderAttr()).toBe('Updated placeholder')
  })
})
