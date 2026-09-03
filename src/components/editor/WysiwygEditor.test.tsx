/**
 * Regression tests for WysiwygEditor lifecycle.
 *
 * Bug: "Cannot read properties of undefined (reading 'getMarkdown')" on page
 * load. TipTap v3 Editor.destroy() resets extensionStorage to {} and
 * useEditor() destroys/recreates instances (React StrictMode double-mount,
 * deps changes). Closures captured on an old instance (debounce timer, blur
 * handler, flush) could then read storage.markdown on a destroyed editor.
 */
import { StrictMode, createRef } from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, act } from '@testing-library/react'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from 'tiptap-markdown'
import WysiwygEditor, { type WysiwygEditorHandle } from './WysiwygEditor'

describe('WysiwygEditor lifecycle', () => {
  it('documents the TipTap behaviour: storage.markdown disappears after destroy()', () => {
    const e = new Editor({ extensions: [StarterKit, Markdown], content: '# Hi' })
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
