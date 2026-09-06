/**
 * exportHtml.test.ts — full document shape, escaping, code/task/link cases,
 * title block, images, script-in-markdown escaping, empty markdown,
 * htmlFragmentToPlainText cases, buildExportFilename.
 */

import { describe, it, expect } from 'vitest'
import {
  buildExportFragment,
  buildExportHtml,
  htmlFragmentToPlainText,
  buildExportFilename,
  escapeHtml,
} from './exportHtml'
import { DEFAULT_EXPORT_OPTIONS } from './exportOptions'

const FIXED_NOW = new Date(2024, 2, 15) // 2024-03-15 (local)

describe('escapeHtml', () => {
  it('escapes & < > " \'', () => {
    expect(escapeHtml(`& < > " '`)).toBe('&amp; &lt; &gt; &quot; &#39;')
  })
})

describe('buildExportHtml — document shell', () => {
  it('starts with <!doctype html>', () => {
    const html = buildExportHtml('hello', 'My Doc', DEFAULT_EXPORT_OPTIONS, FIXED_NOW)
    expect(html.startsWith('<!doctype html>')).toBe(true)
  })

  it('contains exactly one <style>', () => {
    const html = buildExportHtml('hello', 'My Doc', DEFAULT_EXPORT_OPTIONS, FIXED_NOW)
    expect((html.match(/<style>/g) ?? []).length).toBe(1)
  })

  it('contains no <script', () => {
    const html = buildExportHtml('hello **world**', 'My Doc', DEFAULT_EXPORT_OPTIONS, FIXED_NOW)
    expect(html).not.toContain('<script')
  })

  it('contains no <link', () => {
    const html = buildExportHtml('hello', 'My Doc', DEFAULT_EXPORT_OPTIONS, FIXED_NOW)
    expect(html).not.toContain('<link')
  })

  it('escapes the title', () => {
    const html = buildExportHtml('hello', '<b>Bold</b> & Title', DEFAULT_EXPORT_OPTIONS, FIXED_NOW)
    expect(html).toContain('<title>&lt;b&gt;Bold&lt;/b&gt; &amp; Title</title>')
  })

  it('body class matches preset', () => {
    const html = buildExportHtml('hello', 'T', { ...DEFAULT_EXPORT_OPTIONS, preset: 'github' }, FIXED_NOW)
    expect(html).toContain('<body class="preset-github">')
  })

  it('contains @page size: A4 when paper is a4', () => {
    const html = buildExportHtml('hello', 'T', { ...DEFAULT_EXPORT_OPTIONS, paper: 'a4' }, FIXED_NOW)
    expect(html).toMatch(/@page\s*\{\s*size:\s*A4;/)
  })

  it('contains margin: 10mm when margins is narrow', () => {
    const html = buildExportHtml('hello', 'T', { ...DEFAULT_EXPORT_OPTIONS, margins: 'narrow' }, FIXED_NOW)
    expect(html).toMatch(/margin:\s*10mm/)
  })

  it('empty markdown → valid document with an empty <article>', () => {
    const html = buildExportHtml('', 'Empty', DEFAULT_EXPORT_OPTIONS, FIXED_NOW)
    expect(html).toContain('<article class="doc"></article>')
    expect(html.startsWith('<!doctype html>')).toBe(true)
  })
})

describe('buildExportHtml — title block', () => {
  it('titleBlock true → header with escaped title and YYYY-MM-DD date', () => {
    const html = buildExportHtml('body text', 'My "Great" Doc', { ...DEFAULT_EXPORT_OPTIONS, titleBlock: true }, FIXED_NOW)
    expect(html).toContain('<header class="title-block"><h1 class="doc-title">My &quot;Great&quot; Doc</h1><p class="date">2024-03-15</p></header>')
  })

  it('titleBlock false → no header element (CSS may still define an unused .title-block selector)', () => {
    const html = buildExportHtml('body text', 'Doc', { ...DEFAULT_EXPORT_OPTIONS, titleBlock: false }, FIXED_NOW)
    expect(html).not.toContain('<header class="title-block"')
    expect(html).not.toContain('doc-title')
  })
})

describe('buildExportFragment / security', () => {
  it('script tag in markdown is escaped, not a script element', () => {
    const fragment = buildExportFragment('<script>alert(1)</script>', DEFAULT_EXPORT_OPTIONS)
    expect(fragment).not.toMatch(/<script>/)
  })

  it('javascript: link → href=""', () => {
    const fragment = buildExportFragment('[bad](javascript:alert(1))', DEFAULT_EXPORT_OPTIONS)
    expect(fragment).toContain('href=""')
  })

  it('data:text/html image → falls back to alt text, no <img>', () => {
    const fragment = buildExportFragment('![alt](data:text/html,<b>x</b>)', DEFAULT_EXPORT_OPTIONS)
    expect(fragment).not.toContain('<img')
    expect(fragment).toContain('<em>alt</em>')
  })

  it('vbscript: link → href=""', () => {
    const fragment = buildExportFragment('[bad](vbscript:msgbox(1))', DEFAULT_EXPORT_OPTIONS)
    expect(fragment).toContain('href=""')
  })

  it('file:/// link → href=""', () => {
    const fragment = buildExportFragment('[bad](file:///etc/passwd)', DEFAULT_EXPORT_OPTIONS)
    expect(fragment).toContain('href=""')
  })

  it('https:// link survives', () => {
    const fragment = buildExportFragment('[good](https://example.com)', DEFAULT_EXPORT_OPTIONS)
    expect(fragment).toContain('href="https://example.com"')
  })

  it('mailto: link survives', () => {
    const fragment = buildExportFragment('[mail](mailto:a@b.com)', DEFAULT_EXPORT_OPTIONS)
    expect(fragment).toContain('href="mailto:a@b.com"')
  })

  it('data:image/png image survives', () => {
    const uri = 'data:image/png;base64,AAAA'
    const fragment = buildExportFragment(`![alt](${uri})`, DEFAULT_EXPORT_OPTIONS)
    expect(fragment).toContain(`src="${uri}"`)
  })

  it('relative ./a.png image survives', () => {
    const fragment = buildExportFragment('![alt](./a.png)', DEFAULT_EXPORT_OPTIONS)
    expect(fragment).toContain('src="./a.png"')
  })
})

describe('buildExportFilename', () => {
  it('sanitises the title and appends extension', () => {
    expect(buildExportFilename('My Doc!', 'html')).toBe('my-doc.html')
  })

  it('empty title → document.<ext>', () => {
    expect(buildExportFilename('', 'html')).toBe('document.html')
  })

  it('supports md and txt extensions', () => {
    expect(buildExportFilename('Notes', 'md')).toBe('notes.md')
    expect(buildExportFilename('Notes', 'txt')).toBe('notes.txt')
  })
})

describe('htmlFragmentToPlainText', () => {
  it('empty input → empty string', () => {
    expect(htmlFragmentToPlainText('')).toBe('')
  })

  it('whitespace-only input → empty string', () => {
    expect(htmlFragmentToPlainText('   ')).toBe('')
  })

  it('converts a heading + paragraph + list + task list + code block + table + link', () => {
    const fragment = buildExportFragment(
      [
        '# Title',
        '',
        'A paragraph with a [link](https://example.com).',
        '',
        '- one',
        '- two',
        '',
        '- [x] done',
        '- [ ] todo',
        '',
        '```',
        'code here',
        '```',
        '',
        '| A | B |',
        '| --- | --- |',
        '| 1 | 2 |',
      ].join('\n'),
      DEFAULT_EXPORT_OPTIONS,
    )
    const text = htmlFragmentToPlainText(fragment)

    expect(text).toContain('Title')
    expect(text).toContain('=====') // h1 underline uses = of text length (>=5 chars)
    expect(text).toContain('A paragraph with a link (https://example.com).')
    expect(text).toContain('- one')
    expect(text).toContain('- two')
    expect(text).toContain('[x] done')
    expect(text).toContain('[ ] todo')
    expect(text).toContain('code here')
    expect(text).toContain('1\t2')
  })

  it('does not throw on nested lists', () => {
    const fragment = buildExportFragment('- a\n  - a1\n  - a2\n- b', DEFAULT_EXPORT_OPTIONS)
    expect(() => htmlFragmentToPlainText(fragment)).not.toThrow()
    const text = htmlFragmentToPlainText(fragment)
    expect(text).toContain('a1')
    expect(text).toContain('a2')
  })

  it('does not throw on an empty fragment (article with no content)', () => {
    expect(() => htmlFragmentToPlainText('<article class="doc"></article>')).not.toThrow()
  })
})
