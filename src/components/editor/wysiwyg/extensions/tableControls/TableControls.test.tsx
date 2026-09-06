/**
 * tableControls/TableControls.test.tsx
 *
 * Regression tests for the confirmed production crash:
 *   [tiptap error]: The editor view is not available. Cannot access
 *   view['dom']. The editor may not be mounted yet.
 *
 * Mechanism (see dev/visual-editor-fallback-warning/research.md,
 * "Follow-up: confirmed error"): useEditor()'s EditorInstanceManager arms a
 * 1 ms scheduleDestroy timer at construction. If that timer fires before a
 * sibling effect commits (StrictMode double-invoke racing a slow main
 * thread), the Editor instance still referenced by TableControls' effect
 * closures is destroyed — editor.editorView is null — and any `.view.*`
 * access throws the error above. `editor.destroy()` is used directly here
 * to deterministically simulate that "destroyed but still referenced"
 * state without needing to win a real timing race (see research.md §5.1).
 *
 * Uses createTestEditor() from testUtils so the extension config matches
 * WysiwygEditor exactly (never hand-roll an extension array in tests).
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, act } from '@testing-library/react'
import type { Editor } from '@tiptap/core'
import { createTestEditor } from '../../testUtils'
import { TableControls } from './TableControls'

const TABLE_MD = `
| A | B | C |
|---|---|---|
| 1 | 2 | 3 |
| 4 | 5 | 6 |
`.trim()

describe('TableControls', () => {
  let editor: Editor | undefined

  afterEach(() => {
    if (editor && !editor.isDestroyed) editor.destroy()
    editor = undefined
  })

  it('does not throw when the editor was destroyed before effects run', () => {
    editor = createTestEditor(TABLE_MD)
    editor.destroy()
    expect(editor.isDestroyed).toBe(true)

    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    let container: HTMLElement | undefined
    expect(() => {
      act(() => {
        const result = render(<TableControls editor={editor!} />)
        container = result.container
      })
    }).not.toThrow()

    expect(consoleErrorSpy).not.toHaveBeenCalled()
    expect(container?.firstChild).toBeNull()
    consoleErrorSpy.mockRestore()
  })

  it('mounts cleanly against a live editor with a table', () => {
    editor = createTestEditor(TABLE_MD)
    expect(editor.isDestroyed).toBe(false)

    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    let unmount: (() => void) | undefined
    expect(() => {
      act(() => {
        const result = render(<TableControls editor={editor!} />)
        unmount = result.unmount
      })
    }).not.toThrow()

    expect(consoleErrorSpy).not.toHaveBeenCalled()
    // Component renders null until a hover snapshot exists — no DOM
    // assertions beyond "did not throw" per the brief.
    expect(() => unmount?.()).not.toThrow()
    consoleErrorSpy.mockRestore()
  })

  it('does not throw when the editor is destroyed after mount', () => {
    editor = createTestEditor(TABLE_MD)

    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    let unmount: (() => void) | undefined
    act(() => {
      const result = render(<TableControls editor={editor!} />)
      unmount = result.unmount
    })

    expect(() => {
      act(() => { editor!.destroy() })
    }).not.toThrow()

    expect(() => unmount?.()).not.toThrow()
    expect(consoleErrorSpy).not.toHaveBeenCalled()
    consoleErrorSpy.mockRestore()
  })
})
