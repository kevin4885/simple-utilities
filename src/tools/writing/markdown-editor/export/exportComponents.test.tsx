/**
 * exportComponents.test.tsx — exportUrlTransform matrix + component map spot
 * checks (rendered via renderToStaticMarkup + react-markdown, same path used
 * by exportHtml.tsx).
 */

import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { exportUrlTransform, makeExportComponents } from './exportComponents'
import { DEFAULT_EXPORT_OPTIONS } from './exportOptions'

function render(markdown: string, opts = DEFAULT_EXPORT_OPTIONS): string {
  return renderToStaticMarkup(
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={makeExportComponents(opts)}
      urlTransform={exportUrlTransform}
    >
      {markdown}
    </ReactMarkdown>,
  )
}

describe('exportUrlTransform — allow-list matrix', () => {
  it('allows https://', () => {
    expect(exportUrlTransform('https://example.com')).toBe('https://example.com')
  })

  it('allows http://', () => {
    expect(exportUrlTransform('http://example.com')).toBe('http://example.com')
  })

  it('allows mailto:', () => {
    expect(exportUrlTransform('mailto:a@b.com')).toBe('mailto:a@b.com')
  })

  it('allows data:image/png;base64,...', () => {
    const uri = 'data:image/png;base64,AAAA'
    expect(exportUrlTransform(uri)).toBe(uri)
  })

  it('allows data:image/svg+xml', () => {
    const uri = 'data:image/svg+xml,<svg/>'
    expect(exportUrlTransform(uri)).toBe(uri)
  })

  it('blocks data:text/html', () => {
    expect(exportUrlTransform('data:text/html,<script>1</script>')).toBe('')
  })

  it('blocks javascript:', () => {
    expect(exportUrlTransform('javascript:alert(1)')).toBe('')
  })

  it('blocks uppercase scheme JAVASCRIPT:', () => {
    expect(exportUrlTransform('JAVASCRIPT:alert(1)')).toBe('')
  })

  it('blocks vbscript:', () => {
    expect(exportUrlTransform('vbscript:msgbox(1)')).toBe('')
  })

  it('blocks file:///', () => {
    expect(exportUrlTransform('file:///etc/passwd')).toBe('')
  })

  it('blocks with leading whitespace before javascript:', () => {
    expect(exportUrlTransform('   javascript:alert(1)')).toBe('')
  })

  it('allows relative path ./a.png', () => {
    expect(exportUrlTransform('./a.png')).toBe('./a.png')
  })

  it('allows bare relative path a.png', () => {
    expect(exportUrlTransform('a.png')).toBe('a.png')
  })

  it('allows anchor-only #section', () => {
    expect(exportUrlTransform('#section')).toBe('#section')
  })

  it('blocks protocol-relative //evil.com', () => {
    expect(exportUrlTransform('//evil.com/x')).toBe('')
  })

  it('empty string → empty string', () => {
    expect(exportUrlTransform('')).toBe('')
  })

  it('whitespace-only → empty string', () => {
    expect(exportUrlTransform('   ')).toBe('')
  })
})

describe('exportComponents — task list glyphs', () => {
  it('renders checked task as ☑ text, not <input>', () => {
    const html = render('- [x] done\n- [ ] todo')
    expect(html).toContain('☑')
    expect(html).toContain('☐')
    expect(html).not.toContain('<input')
  })
})

describe('exportComponents — code blocks', () => {
  it('labeled fence produces highlighted markup with class="hl"', () => {
    const html = render('```ts\nconst x = 1\n```')
    expect(html).toContain('class="hl"')
  })

  it('unlabeled fence produces <pre><code>', () => {
    const html = render('```\nplain text\n```')
    expect(html).toMatch(/<pre><code>/)
  })

  it('inline code produces <code> without a wrapping <pre>', () => {
    const html = render('some `inline` code')
    expect(html).toContain('<code>inline</code>')
    expect(html).not.toContain('<pre>')
  })
})

describe('exportComponents — links + showLinkUrls', () => {
  it('showLinkUrls true: link text differs from href → url span appended', () => {
    const html = render('[site](https://x.y)', { ...DEFAULT_EXPORT_OPTIONS, showLinkUrls: true })
    expect(html).toContain('<span class="url"> (https://x.y)</span>')
  })

  it('showLinkUrls false: no url span', () => {
    const html = render('[site](https://x.y)', { ...DEFAULT_EXPORT_OPTIONS, showLinkUrls: false })
    expect(html).not.toContain('class="url"')
  })

  it('link text equals href: no url span even when showLinkUrls is true', () => {
    const html = render('[https://x.y](https://x.y)', { ...DEFAULT_EXPORT_OPTIONS, showLinkUrls: true })
    expect(html).not.toContain('class="url"')
  })

  it('blocked href renders href=""', () => {
    const html = render('[bad](javascript:alert(1))')
    expect(html).toContain('href=""')
  })
})

describe('exportComponents — images', () => {
  it('valid src renders <img>', () => {
    const html = render('![alt text](https://example.com/a.png)')
    expect(html).toContain('<img')
    expect(html).toContain('alt="alt text"')
  })

  it('blocked src falls back to <em>alt</em>', () => {
    const html = render('![alt text](javascript:alert(1))')
    expect(html).toContain('<em>alt text</em>')
    expect(html).not.toContain('<img')
  })
})

describe('exportComponents — raw HTML in markdown is escaped, not rendered', () => {
  it('<script>alert(1)</script> is rendered as escaped text', () => {
    const html = render('<script>alert(1)</script>')
    expect(html).not.toMatch(/<script>/)
  })
})
