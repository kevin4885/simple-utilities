/**
 * exportHtml
 *
 * Pure builders that turn a markdown string into exportable HTML/plaintext.
 * The only DOM-ish API used is `renderToStaticMarkup` (react-dom/server) —
 * runs fine under jsdom in tests — plus `DOMParser` (also jsdom-provided) for
 * `htmlFragmentToPlainText`. No other browser API is touched here.
 *
 * The SAME fragment HTML produced by `buildExportFragment` is used for the
 * .html download body, the rich-text clipboard payload, and the print
 * iframe — "what you export is what you print".
 */

import { renderToStaticMarkup } from 'react-dom/server'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { makeExportComponents, exportUrlTransform } from './exportComponents'
import { buildExportCss } from './exportStyles'
import { toSafeFilename } from '../logic'
import type { ExportOptions } from './exportOptions'

// ── Escaping ───────────────────────────────────────────────────────────────

/** Escape `& < > " '` for safe interpolation into HTML text/attribute contexts. */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// ── Fragment / document builders ───────────────────────────────────────────

/**
 * Body-only HTML for `markdown` (no `<html>`/`<style>` wrapper) — used for
 * the .html download's `<article>` contents and the rich-text clipboard
 * payload. No raw HTML from the markdown source is ever rendered (no
 * rehype-raw) — react-markdown escapes it as text.
 */
export function buildExportFragment(markdown: string, opts: ExportOptions): string {
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

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

function formatDate(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

/**
 * Full, self-contained HTML document: `<!doctype html>` + one `<style>` +
 * the rendered fragment, optionally preceded by a title block. No `<script>`,
 * no `<link>`, no external stylesheet/font — everything needed to render is
 * inline.
 */
export function buildExportHtml(
  markdown: string,
  title: string,
  opts: ExportOptions,
  now: Date = new Date(),
): string {
  const css = buildExportCss(opts)
  const fragment = buildExportFragment(markdown, opts)
  const escapedTitle = escapeHtml(title)

  const titleBlock = opts.titleBlock
    ? `<header class="title-block"><h1 class="doc-title">${escapedTitle}</h1><p class="date">${formatDate(now)}</p></header>`
    : ''

  return (
    '<!doctype html>' +
    `<html lang="en"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<title>${escapedTitle}</title>` +
    `<style>${css}</style></head>` +
    `<body class="preset-${opts.preset}"><article class="doc">${titleBlock}${fragment}</article></body></html>`
  )
}

export function buildExportFilename(title: string, ext: 'md' | 'txt' | 'html'): string {
  return `${toSafeFilename(title) || 'document'}.${ext}`
}

// ── Plain text conversion ────────────────────────────────────────────────

const BLOCK_TAGS = new Set(['P', 'DIV', 'HEADER', 'ARTICLE', 'SECTION', 'FIGURE'])

function textOf(node: Node): string {
  return stripUrlSpans(node).replace(/\s+/g, ' ').trim()
}

/** Text content of a node/element, excluding any descendant `.url` span (the
 * link component appends `<span class="url"> (href)</span>` when
 * `showLinkUrls` is on — plain-text conversion re-derives that suffix itself
 * via `renderLink`, so the raw span text must not be double-counted). */
function stripUrlSpans(node: Node): string {
  if (node.nodeType === 3) return node.textContent ?? ''
  if (node.nodeType !== 1) return ''
  const el = node as Element
  if (el.classList?.contains('url')) return ''
  let text = ''
  for (const child of Array.from(el.childNodes)) text += stripUrlSpans(child)
  return text
}

function renderList(el: Element, ordered: boolean, depth: number): string {
  const items: string[] = []
  let index = 1
  for (const child of Array.from(el.children)) {
    if (child.tagName !== 'LI') continue
    items.push(...renderListItem(child, ordered, depth, index))
    index++
  }
  return items.join('\n')
}

function renderListItem(li: Element, ordered: boolean, depth: number, index: number): string[] {
  const indent = '  '.repeat(depth)
  const lines: string[] = []
  const nestedLists: Element[] = []
  let inline = ''

  for (const child of Array.from(li.childNodes)) {
    if (child.nodeType === 1 && ((child as Element).tagName === 'UL' || (child as Element).tagName === 'OL')) {
      nestedLists.push(child as Element)
      continue
    }
    inline += inlineText(child)
  }

  const prefix = ordered ? `${index}. ` : '- '
  const text = inline.replace(/\s+/g, ' ').trim()
  lines.push(`${indent}${prefix}${text}`)

  for (const nested of nestedLists) {
    lines.push(renderList(nested, nested.tagName === 'OL', depth + 1))
  }

  return lines
}

function renderTable(table: Element): string {
  const rows: string[] = []
  for (const row of Array.from(table.querySelectorAll('tr'))) {
    const cells = Array.from(row.querySelectorAll('th, td')).map((c) => textOf(c))
    rows.push(cells.join('\t'))
  }
  return rows.join('\n')
}

function renderLink(a: Element): string {
  const text = textOf(a)
  const href = a.getAttribute('href') ?? ''
  if (href && text !== href) return `${text} (${href})`
  return text
}

/** Convert a node's inline content (text + <a>/<span class="task">, ignoring
 * `.url` spans) to a single text-ish string, preserving original adjacency
 * (no artificial spaces are inserted between sibling nodes) so punctuation
 * that directly follows a link/glyph in the source doesn't get separated. */
function inlineText(node: Node): string {
  if (node.nodeType === 3) return node.textContent ?? ''
  if (node.nodeType !== 1) return ''
  const el = node as Element
  if (el.classList?.contains('url')) return ''
  if (el.tagName === 'A') return renderLink(el)
  if (el.classList?.contains('task')) return el.textContent === '☑' ? '[x]' : '[ ]'
  let text = ''
  for (const child of Array.from(el.childNodes)) text += inlineText(child)
  return text
}

/**
 * Convert an export fragment (as produced by `buildExportFragment`) to
 * readable plain text. Parses with `DOMParser` (jsdom-provided) and walks
 * the tree, applying markdown-ish plain-text conventions per element.
 * Empty input → `''`.
 */
export function htmlFragmentToPlainText(fragment: string): string {
  if (!fragment.trim()) return ''

  const doc = new DOMParser().parseFromString(fragment, 'text/html')
  const root = doc.body
  const lines: string[] = []

  function walk(node: Node): void {
    if (node.nodeType === 3) {
      const t = node.textContent ?? ''
      if (t.trim()) lines.push(t.trim())
      return
    }
    if (node.nodeType !== 1) return
    const el = node as Element
    const tag = el.tagName

    switch (tag) {
      case 'H1':
      case 'H2': {
        const text = textOf(el)
        lines.push('')
        lines.push(text)
        lines.push((tag === 'H1' ? '=' : '-').repeat(Math.max(text.length, 1)))
        lines.push('')
        return
      }
      case 'H3': case 'H4': case 'H5': case 'H6': {
        lines.push('')
        lines.push(textOf(el))
        lines.push('')
        return
      }
      case 'P': {
        const text = inlineText(el).replace(/\s+/g, ' ').trim()
        lines.push('')
        lines.push(text || textOf(el))
        lines.push('')
        return
      }
      case 'UL':
        lines.push('')
        lines.push(renderList(el, false, 0))
        lines.push('')
        return
      case 'OL':
        lines.push('')
        lines.push(renderList(el, true, 0))
        lines.push('')
        return
      case 'PRE': {
        lines.push('')
        lines.push(el.textContent ?? '')
        lines.push('')
        return
      }
      case 'BLOCKQUOTE': {
        const text = textOf(el)
        lines.push('')
        lines.push(...text.split('\n').map((l) => `> ${l}`))
        lines.push('')
        return
      }
      case 'HR':
        lines.push('')
        lines.push('---')
        lines.push('')
        return
      case 'TABLE':
        lines.push('')
        lines.push(renderTable(el))
        lines.push('')
        return
      case 'A':
        lines.push(renderLink(el))
        return
      case 'IMG':
        lines.push(`[${el.getAttribute('alt') ?? ''}]`)
        return
      case 'BR':
        lines.push('\n')
        return
      default:
        // Recurse into unknown/container elements (article, span, strong, em…)
        for (const child of Array.from(el.childNodes)) walk(child)
        if (BLOCK_TAGS.has(tag)) lines.push('')
    }
  }

  for (const child of Array.from(root.childNodes)) walk(child)

  const text = lines.join('\n')
  return text
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .concat('\n')
}
