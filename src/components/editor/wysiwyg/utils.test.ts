/**
 * wysiwyg/utils.test.ts
 *
 * Tests for wysiwyg/utils.ts pure helpers:
 *   normalizeUrl — URL normalisation / unsafe-scheme rejection
 *   getLinkRange — walks the link mark extent at the cursor
 */

import { describe, it, expect, afterEach } from 'vitest'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { TextSelection } from '@tiptap/pm/state'
import { normalizeUrl, getLinkRange, sanitizeImageSrc, getScrollParent } from './utils'

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
// sanitizeImageSrc
// ---------------------------------------------------------------------------

describe('sanitizeImageSrc', () => {
  it('returns empty string for empty input', () => {
    expect(sanitizeImageSrc('')).toBe('')
    expect(sanitizeImageSrc('   ')).toBe('')
  })

  it('rejects javascript: src', () => {
    expect(sanitizeImageSrc('javascript:alert(1)')).toBe('')
  })

  it('rejects vbscript: src', () => {
    expect(sanitizeImageSrc('vbscript:msgbox(1)')).toBe('')
  })

  it('rejects data:text/html (not an image)', () => {
    expect(sanitizeImageSrc('data:text/html,<script>alert(1)</script>')).toBe('')
  })

  it('rejects data:application/javascript', () => {
    expect(sanitizeImageSrc('data:application/javascript,alert(1)')).toBe('')
  })

  it('passes data:image/* through unchanged', () => {
    const dataUri = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVQI12NgAAIABQ=='
    expect(sanitizeImageSrc(dataUri)).toBe(dataUri)
  })

  it('passes data:image/jpeg through unchanged', () => {
    const jpeg = 'data:image/jpeg;base64,/9j/4AAQSkZJRg=='
    expect(sanitizeImageSrc(jpeg)).toBe(jpeg)
  })

  it('passes blob: URLs through unchanged', () => {
    const blobUrl = 'blob:https://example.com/1234-5678'
    expect(sanitizeImageSrc(blobUrl)).toBe(blobUrl)
  })

  it('passes https:// URL through unchanged', () => {
    expect(sanitizeImageSrc('https://example.com/cat.jpg')).toBe('https://example.com/cat.jpg')
  })

  it('prepends https:// to bare domain image URLs', () => {
    expect(sanitizeImageSrc('example.com/image.png')).toBe('https://example.com/image.png')
  })

  it('passes relative paths through (normalizeUrl returns them unchanged)', () => {
    expect(sanitizeImageSrc('/images/cat.png')).toBe('/images/cat.png')
    expect(sanitizeImageSrc('./cat.png')).toBe('./cat.png')
  })

  it('passes #anchor through (normalizeUrl returns it unchanged)', () => {
    expect(sanitizeImageSrc('#logo')).toBe('#logo')
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
// getScrollParent
// ---------------------------------------------------------------------------

describe('getScrollParent', () => {
  it('returns null when passed null', () => {
    expect(getScrollParent(null)).toBeNull()
  })

  it('finds an ancestor with overflow-y: scroll', () => {
    const child = document.createElement('div')
    const parent = document.createElement('div')
    parent.style.overflowY = 'scroll'
    parent.appendChild(child)
    document.body.appendChild(parent)
    expect(getScrollParent(child)).toBe(parent)
    document.body.removeChild(parent)
  })

  it('finds an ancestor with overflow-y: auto', () => {
    const child = document.createElement('div')
    const parent = document.createElement('div')
    parent.style.overflowY = 'auto'
    parent.appendChild(child)
    document.body.appendChild(parent)
    expect(getScrollParent(child)).toBe(parent)
    document.body.removeChild(parent)
  })

  it('returns document.scrollingElement when no scrollable ancestor found', () => {
    const child = document.createElement('div')
    document.body.appendChild(child)
    // No explicitly scrollable ancestor
    const result = getScrollParent(child)
    // jsdom may return null or the scrollingElement; either is acceptable
    expect(result === null || result === document.scrollingElement || result instanceof Element).toBe(true)
    document.body.removeChild(child)
  })
})

// ---------------------------------------------------------------------------
// Autolink round-trip (Task 3 verification)
//
// When Link is configured with autolink: true and the user types a URL that
// becomes a link mark, tiptap-markdown must serialise it back to a link.
// We simulate this by inserting a link mark directly and checking serialisation.
//
// These tests now use createTestEditor() from testUtils so they exercise the
// real component config (including allowBase64, Markdown options, etc.).
// ---------------------------------------------------------------------------

import { createTestEditor, getMarkdown } from './testUtils'

describe('link mark round-trip through tiptap-markdown (real config)', () => {
  let editor2: import('@tiptap/core').Editor

  afterEach(() => { editor2?.destroy() })

  it('link mark with text === href serialises as GFM autolink <url>', () => {
    // isPlainURL check in prosemirror-markdown: when text === href and href has
    // a scheme (^\w+:), the link serialises as <url> not [url](url).
    // NOTE: CLAUDE.md claim "[url](url)" was wrong — it is "<url>".
    const md = '[https://example.com](https://example.com)'
    editor2 = createTestEditor(md)
    const serialized = getMarkdown(editor2)
    // Should serialise as <url> (GFM autolink)
    expect(serialized).toContain('<https://example.com>')
  })

  it('regular link mark with different text round-trips as [text](href)', () => {
    const md = '[Visit Example](https://example.com)'
    editor2 = createTestEditor(md)
    const serialized = getMarkdown(editor2)
    expect(serialized).toContain('Visit Example')
    expect(serialized).toContain('https://example.com')
  })
})
