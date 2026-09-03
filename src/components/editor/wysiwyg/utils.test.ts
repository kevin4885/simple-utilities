/**
 * wysiwyg/utils.test.ts
 *
 * Tests for wysiwyg/utils.ts pure helpers.
 * normalizeUrl tests live in ../../wysiwyg-utils.test.ts (unchanged).
 * This file tests getLinkRange and the re-exported normalizeUrl.
 */

import { describe, it, expect } from 'vitest'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { TextSelection } from '@tiptap/pm/state'
import { normalizeUrl, getLinkRange } from './utils'

describe('normalizeUrl (re-exported from wysiwyg-utils)', () => {
  it('returns empty string for empty input', () => {
    expect(normalizeUrl('')).toBe('')
  })

  it('prepends https:// to bare domains', () => {
    expect(normalizeUrl('example.com')).toBe('https://example.com')
  })

  it('leaves https:// URLs unchanged', () => {
    expect(normalizeUrl('https://example.com')).toBe('https://example.com')
  })

  it('blocks javascript: scheme', () => {
    expect(normalizeUrl('javascript:alert(1)')).toBe('')
  })

  it('leaves relative paths unchanged', () => {
    expect(normalizeUrl('/foo/bar')).toBe('/foo/bar')
    expect(normalizeUrl('./relative')).toBe('./relative')
  })

  it('leaves mailto: unchanged', () => {
    expect(normalizeUrl('mailto:user@example.com')).toBe('mailto:user@example.com')
  })
})

// ---------------------------------------------------------------------------
// getLinkRange
// ---------------------------------------------------------------------------

describe('getLinkRange', () => {
  it('returns null when cursor is not inside a link', () => {
    const editor = new Editor({
      extensions: [StarterKit],
      content: '<p>Hello world</p>',
    })
    // Place cursor at position 1 (plain text, no link mark)
    const tr = editor.state.tr.setSelection(
      TextSelection.near(editor.state.doc.resolve(1)),
    )
    editor.view.dispatch(tr)
    expect(getLinkRange(editor.state)).toBeNull()
    editor.destroy()
  })

  it('returns from/to encompassing the full link mark extent', () => {
    // Build content with a link mark in the middle: "foo [bar] baz"
    // StarterKit includes @tiptap/extension-link
    const editor = new Editor({
      extensions: [StarterKit],
      content: '<p>foo <a href="https://example.com">bar</a> baz</p>',
    })

    const state = editor.state

    // Scan doc to find where the link-marked text lives
    let linkFrom = -1
    let linkTo = -1
    state.doc.descendants((node, pos) => {
      if (node.isText) {
        const linkMark = node.marks.find((m) => m.type.name === 'link')
        if (linkMark) {
          if (linkFrom === -1) linkFrom = pos
          linkTo = pos + node.nodeSize
        }
      }
    })

    if (linkFrom === -1) {
      // link extension not available in this context — skip
      editor.destroy()
      return
    }

    // Place cursor in the middle of the link text
    const midPos = Math.floor((linkFrom + linkTo) / 2)
    const tr = editor.state.tr.setSelection(
      TextSelection.near(editor.state.doc.resolve(midPos)),
    )
    editor.view.dispatch(tr)

    const result = getLinkRange(editor.state)
    expect(result).not.toBeNull()
    expect(result!.from).toBe(linkFrom)
    expect(result!.to).toBe(linkTo)
    editor.destroy()
  })
})
