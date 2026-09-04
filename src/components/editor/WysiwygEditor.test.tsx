/**
 * Regression tests for WysiwygEditor lifecycle.
 *
 * Bug: "Cannot read properties of undefined (reading 'getMarkdown')" on page
 * load. TipTap v3 Editor.destroy() resets extensionStorage to {} and
 * useEditor() destroys/recreates instances (React StrictMode double-mount,
 * deps changes). Closures captured on an old instance (debounce timer, blur
 * handler, flush) could then read storage.markdown on a destroyed editor.
 *
 * Tests that verify extension config use createTestEditor() from testUtils so
 * they always exercise the exact same extension set as the component — not a
 * hand-rolled approximation.
 */
import { StrictMode, createRef } from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, act } from '@testing-library/react'
import { Editor } from '@tiptap/core'
import WysiwygEditor, { type WysiwygEditorHandle } from './WysiwygEditor'
import { createTestEditor, getMarkdown } from './wysiwyg/testUtils'

// ---------------------------------------------------------------------------
// S1: verify exactly one WysiwygEditor mounts (no duplicate desktop+mobile)
// ---------------------------------------------------------------------------

describe('WysiwygEditor — single instance per mount', () => {
  it('renders exactly one .ProseMirror element when mounted', () => {
    const { container, unmount } = render(
      <WysiwygEditor value="# Hello" onChange={vi.fn()} />,
    )
    const proseMirrors = container.querySelectorAll('.ProseMirror')
    expect(proseMirrors.length).toBe(1)
    unmount()
  })

  it('renders exactly one .ProseMirror under StrictMode', () => {
    const { container, unmount } = render(
      <StrictMode>
        <WysiwygEditor value="# Hello" onChange={vi.fn()} />
      </StrictMode>,
    )
    const proseMirrors = container.querySelectorAll('.ProseMirror')
    expect(proseMirrors.length).toBe(1)
    unmount()
  })
})

describe('WysiwygEditor lifecycle', () => {
  it('documents the TipTap behaviour: storage.markdown disappears after destroy()', () => {
    // Uses createTestEditor (real config) so this test is consistent with all
    // other headless editor tests. StarterKit + Markdown hand-rolled is banned.
    const e = createTestEditor('# Hi')
    const storage = e.storage as unknown as Record<string, { getMarkdown?: unknown } | undefined>
    expect(typeof storage.markdown?.getMarkdown).toBe('function')
    e.destroy()
    expect((e.storage as unknown as Record<string, unknown>).markdown).toBeUndefined()
  })

  it('mounts under StrictMode without throwing', () => {
    const onChange = vi.fn()
    expect(() =>
      render(
        <StrictMode>
          <WysiwygEditor value={'# Hello\n\nSome **bold** text.'} onChange={onChange} />
        </StrictMode>,
      ),
    ).not.toThrow()
  })

  it('effects that run against a destroyed editor instance do not throw', async () => {
    // useEditor() may destroy + recreate its Editor (StrictMode double-mount,
    // scheduleDestroy tick racing a concurrent commit). Effects from the same
    // commit still close over the destroyed instance, whose storage is {}.
    vi.useFakeTimers()
    try {
      const onChange = vi.fn()
      const ref = createRef<WysiwygEditorHandle>()
      const r = render(<WysiwygEditor ref={ref} value={'# Hi'} onChange={onChange} />)
      await act(async () => { vi.advanceTimersByTime(20) })
      const pm = r.container.querySelector('.ProseMirror') as HTMLElement
      const editor = (pm as unknown as { editor?: Editor }).editor
      expect(editor).toBeTruthy()
      // A keystroke schedules the debounced emit on this instance …
      act(() => { editor!.commands.insertContent(' typed') })
      // … then the instance is destroyed underneath the component.
      act(() => { editor!.destroy() })
      expect(editor!.isDestroyed).toBe(true)
      // 1) value-sync effect runs with the destroyed instance in its closure
      expect(() => r.rerender(<WysiwygEditor ref={ref} value={'# Changed'} onChange={onChange} />)).not.toThrow()
      // 2) pending debounce timer fires against the destroyed instance
      expect(() => { act(() => { vi.advanceTimersByTime(500) }) }).not.toThrow()
      // 3) imperative flush on the stale instance
      expect(() => ref.current?.flush()).not.toThrow()
    } finally {
      vi.useRealTimers()
    }
  })
})

// ---------------------------------------------------------------------------
// N8: toggling readOnly must NOT recreate the editor (no undo history loss)
// ---------------------------------------------------------------------------

describe('WysiwygEditor — readOnly toggle does not recreate editor', () => {
  it('editor identity is stable when readOnly flips true→false→true', () => {
    const { container, rerender, unmount } = render(
      <WysiwygEditor value="# Hello" readOnly={false} />,
    )
    const pm1 = container.querySelector('.ProseMirror') as HTMLElement
    expect(pm1).toBeTruthy()

    rerender(<WysiwygEditor value="# Hello" readOnly={true} />)
    const pm2 = container.querySelector('.ProseMirror') as HTMLElement
    expect(pm2).toBeTruthy()
    // Same DOM element = same editor instance (not recreated)
    expect(pm2).toBe(pm1)

    rerender(<WysiwygEditor value="# Hello" readOnly={false} />)
    const pm3 = container.querySelector('.ProseMirror') as HTMLElement
    expect(pm3).toBe(pm1)

    unmount()
  })
})

// ---------------------------------------------------------------------------
// Image title round-trip (real config via createTestEditor)
// ---------------------------------------------------------------------------

describe('Image title tiptap-markdown round-trip', () => {
  /**
   * Verify that tiptap-markdown serialises an image with a title attribute
   * as `![alt](src "title")` (standard CommonMark image-with-title syntax).
   *
   * These tests use createTestEditor() which mirrors the component's exact
   * extension config (including allowBase64: true, Markdown options, etc.)
   * so any config drift breaks the test.
   */
  let editor: Editor

  afterEach(() => { editor?.destroy() })

  it('round-trips ![alt](src "title") through tiptap-markdown (real config)', () => {
    const md = '![a cat](https://example.com/cat.jpg "Cute cat")'
    editor = createTestEditor(md)

    const serialized = getMarkdown(editor)

    // Should contain the title in the standard Markdown image-with-title form
    expect(serialized).toContain('"Cute cat"')
    expect(serialized).toContain('https://example.com/cat.jpg')
    expect(serialized).toContain('![a cat]')
  })

  it('omits title from markdown output when title attribute is empty (real config)', () => {
    const md = '![a cat](https://example.com/cat.jpg)'
    editor = createTestEditor(md)

    const serialized = getMarkdown(editor)

    expect(serialized).toContain('https://example.com/cat.jpg')
    // No title attribute → no quoted string in the output
    expect(serialized).not.toMatch(/"[^"]*"/)
  })
})

// ---------------------------------------------------------------------------
// data-URI image round-trip (Issue 1: allowBase64 must be true)
// ---------------------------------------------------------------------------

describe('data-URI image round-trip (allowBase64: true)', () => {
  /**
   * With allowBase64: false (old default), Image.configure parseHTML filters
   * img[src^="data:"] — so setContent with a data-URI image silently
   * removed the node, and the next serialisation produced empty markdown.
   *
   * With allowBase64: true (fixed), the image must survive the parse/serialise
   * round-trip byte-for-byte.
   */
  let editor: Editor

  afterEach(() => { editor?.destroy() })

  it('data-URI image src round-trips through parse+serialise (real config)', () => {
    // A minimal but realistic data URI
    const dataUri = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
    const md = `![test image](${dataUri})`
    editor = createTestEditor(md)

    const serialized = getMarkdown(editor)

    // The data URI must survive the round-trip
    expect(serialized).toContain(dataUri)
    expect(serialized).toContain('![test image]')
  })
})

// ---------------------------------------------------------------------------
// Autolink suppression on setContent (Issue 3)
// ---------------------------------------------------------------------------

describe('autolink suppression on programmatic setContent', () => {
  /**
   * The autolink appendTransaction runs on every document-changing transaction.
   * When setContent is called to load an external value (not a user edit) we
   * must pass preventAutolink: true so URLs in the first block are not silently
   * linked.  These tests use createTestEditor() for the real config.
   *
   * Note: the guarded setContent path is in the WysiwygEditor React component
   * (value-sync effect).  Here we verify that tiptap-markdown's serialiser
   * correctly round-trips a plain URL that was loaded as markdown (not as a
   * link mark) — i.e. the user typed a bare URL without it being linked by
   * the initial content load.
   *
   * The CLAUDE.md claim "autolinked URLs serialise as [url](url)" is
   * INCORRECT.  prosemirror-markdown's isPlainURL check serialises them
   * as <url> (GFM autolink form) when text === href and href has a scheme.
   */
  let editor: Editor

  afterEach(() => { editor?.destroy() })

  it('plain URL in markdown is preserved as plain text (linkify: false)', () => {
    // With Markdown.configure({ linkify: false }), bare URLs in markdown
    // are NOT converted to link marks on parse — they stay as plain text.
    const src = 'See https://example.com\n\nsecond para'
    editor = createTestEditor(src)
    const serialized = getMarkdown(editor)
    // The URL should appear as plain text — no link marks added on load
    expect(serialized).toContain('https://example.com')
    // Should not have been converted to a markdown link syntax
    expect(serialized).not.toMatch(/\[https:\/\/example\.com\]\(https:\/\/example\.com\)/)
  })

  it('guarded setContent (preventAutolink meta) preserves the source byte-for-byte', () => {
    // This is the exact path the WysiwygEditor value-sync effect uses.
    const srcs = ['See https://example.com\n\nsecond para', 'https://only.com\n\nmore']
    for (const src of srcs) {
      editor = createTestEditor('placeholder')
      editor.chain().setMeta('preventAutolink', true).setContent(src, { emitUpdate: false }).run()
      expect(getMarkdown(editor)).toBe(src)
      editor.destroy()
    }
  })

  it('UNguarded setContent would autolink the source (documents why the guard exists)', () => {
    const src = 'See https://example.com\n\nsecond para'
    editor = createTestEditor('placeholder')
    editor.commands.setContent(src, { emitUpdate: false })
    // If this ever stops failing-without-the-guard, the guard may be redundant —
    // but keep it: it is the regression the review caught.
    expect(getMarkdown(editor)).toBe('See <https://example.com>\n\nsecond para')
  })

  it('user typing a URL followed by a space still autolinks (autolink stays on)', () => {
    editor = createTestEditor('')
    editor.view.dispatch(editor.state.tr.insertText('go https://typed.com'))
    editor.view.dispatch(editor.state.tr.insertText(' '))
    expect(editor.state.doc.rangeHasMark(0, editor.state.doc.content.size, editor.schema.marks.link)).toBe(true)
    expect(getMarkdown(editor)).toContain('<https://typed.com>')
  })

  it('a link mark (autolinked by user typing) serialises as <url> not [url](url)', () => {
    // When a URL is a link mark with text === href and href has a scheme,
    // prosemirror-markdown's isPlainURL renders it as <url> (GFM autolink).
    const md = '[https://only.com](https://only.com)'
    editor = createTestEditor(md)
    const serialized = getMarkdown(editor)
    // isPlainURL → serialises as <url>
    expect(serialized).toContain('<https://only.com>')
  })
})
