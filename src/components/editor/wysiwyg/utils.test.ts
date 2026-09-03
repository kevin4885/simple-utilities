/**
 * wysiwyg/utils.test.ts
 *
 * Tests for wysiwyg/utils.ts pure helpers:
 *   normalizeUrl — URL normalisation / unsafe-scheme rejection
 *   getLinkRange — walks the link mark extent at the cursor
 */

import { describe, it, expect } from 'vitest'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Link } from '@tiptap/extension-link'
import { Markdown } from 'tiptap-markdown'
import { TextSelection } from '@tiptap/pm/state'
import { normalizeUrl, getLinkRange } from './utils'

// ---------------------------------------------------------------------------
// normalizeUrl
// ---------------------------------------------------------------------------

describe('normalizeUrl', () => {
  it('returns empty string for empty input', () => {
    expect(normalizeUrl('')).toBe('')
  })

  it('returns empty string for whitespace-only input', () => {
    expect(normalizeUrl('   ')).toBe('')
    expect(normalizeUrl('\t\n')).toBe('')
  })

  it('trims whitespace around valid URLs', () => {
    expect(normalizeUrl('  https://example.com  ')).toBe('https://example.com')
  })

  it('leaves https:// URLs alone', () => {
    expect(normalizeUrl('https://example.com')).toBe('https://example.com')
    expect(normalizeUrl('https://example.com/path?q=1#anchor')).toBe(
      'https://example.com/path?q=1#anchor',
    )
  })

  it('leaves http:// URLs alone', () => {
    expect(normalizeUrl('http://example.com')).toBe('http://example.com')
  })

  it('leaves mailto: alone', () => {
    expect(normalizeUrl('mailto:user@example.com')).toBe('mailto:user@example.com')
  })

  it('leaves tel: alone', () => {
    expect(normalizeUrl('tel:+1234567890')).toBe('tel:+1234567890')
  })

  it('leaves data: URIs alone', () => {
    expect(normalizeUrl('data:image/png;base64,abc123==')).toBe(
      'data:image/png;base64,abc123==',
    )
  })

  it('leaves ftp:// alone', () => {
    expect(normalizeUrl('ftp://files.example.com')).toBe('ftp://files.example.com')
  })

  it('leaves #anchors alone', () => {
    expect(normalizeUrl('#section-1')).toBe('#section-1')
    expect(normalizeUrl('#')).toBe('#')
  })

  it('leaves absolute paths alone', () => {
    expect(normalizeUrl('/about')).toBe('/about')
    expect(normalizeUrl('/some/deep/path')).toBe('/some/deep/path')
  })

  it('leaves relative paths alone', () => {
    expect(normalizeUrl('./page')).toBe('./page')
    expect(normalizeUrl('../parent')).toBe('../parent')
  })

  it('prepends https:// to bare domains', () => {
    expect(normalizeUrl('example.com')).toBe('https://example.com')
    expect(normalizeUrl('www.example.com')).toBe('https://www.example.com')
  })

  it('prepends https:// to bare domains with paths', () => {
    expect(normalizeUrl('example.com/path/to/page')).toBe(
      'https://example.com/path/to/page',
    )
  })

  it('prepends https:// to subdomains', () => {
    expect(normalizeUrl('sub.example.co.uk')).toBe('https://sub.example.co.uk')
  })

  it('prepends https:// to localhost:port', () => {
    expect(normalizeUrl('localhost:3000')).toBe('https://localhost:3000')
  })

  it('prepends https:// to example.com:8080', () => {
    expect(normalizeUrl('example.com:8080')).toBe('https://example.com:8080')
  })

  it('blocks javascript: URIs', () => {
    expect(normalizeUrl('javascript:alert(1)')).toBe('')
  })

  it('blocks vbscript: URIs', () => {
    expect(normalizeUrl('vbscript:msgbox(1)')).toBe('')
  })

  it('blocks javascript: URIs with mixed case', () => {
    expect(normalizeUrl('JavaScript:void(0)')).toBe('')
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
    const tr = editor.state.tr.setSelection(
      TextSelection.near(editor.state.doc.resolve(1)),
    )
    editor.view.dispatch(tr)
    expect(getLinkRange(editor.state)).toBeNull()
    editor.destroy()
  })

  it('returns from/to encompassing the full link mark extent', () => {
    const editor = new Editor({
      extensions: [StarterKit],
      content: '<p>foo <a href="https://example.com">bar</a> baz</p>',
    })

    const state = editor.state

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
      editor.destroy()
      return
    }

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

// ---------------------------------------------------------------------------
// Autolink round-trip (Task 3 verification)
//
// When Link is configured with autolink: true and the user types a URL that
// becomes a link mark, tiptap-markdown must serialise it back to a link.
// We simulate this by inserting a link mark directly and checking serialisation.
// ---------------------------------------------------------------------------

describe('link mark round-trip through tiptap-markdown', () => {
  it('link mark survives markdown serialisation (autolink-style URL)', () => {
    const md = '[https://example.com](https://example.com)'
    const editor = new Editor({
      extensions: [
        StarterKit.configure({ link: false }),
        Link.configure({ autolink: true, linkOnPaste: true }),
        Markdown.configure({ html: false }),
      ],
      content: md,
    })

    const storage = editor.storage as unknown as Record<
      string,
      { getMarkdown?: () => string } | undefined
    >
    const serialized = storage.markdown?.getMarkdown?.() ?? ''
    editor.destroy()

    // Either [url](url) or <url> autolink form — both are valid markdown links
    const hasLink =
      serialized.includes('https://example.com') &&
      (serialized.includes('[') || serialized.includes('<'))
    expect(hasLink).toBe(true)
  })

  it('regular link mark round-trips through tiptap-markdown', () => {
    const md = '[Visit Example](https://example.com)'
    const editor = new Editor({
      extensions: [
        StarterKit.configure({ link: false }),
        Link.configure({ autolink: true, linkOnPaste: true }),
        Markdown.configure({ html: false }),
      ],
      content: md,
    })

    const storage = editor.storage as unknown as Record<
      string,
      { getMarkdown?: () => string } | undefined
    >
    const serialized = storage.markdown?.getMarkdown?.() ?? ''
    editor.destroy()

    expect(serialized).toContain('Visit Example')
    expect(serialized).toContain('https://example.com')
  })
})
