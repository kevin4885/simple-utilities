/**
 * exportComponents
 *
 * A react-markdown `Components` map + URL allow-list for the Markdown
 * Editor's export pipeline (`export/exportHtml.tsx`). Produces clean,
 * semantic, light-theme-only HTML with no raw-HTML passthrough (no
 * rehype-raw) and a strict URL scheme allow-list.
 *
 * URL policy (security, non-negotiable — see PLAN.md Design §2):
 *   allowed: http:, https:, mailto:, data:image/* (case-insensitive scheme,
 *            leading/trailing whitespace trimmed), and scheme-less relative
 *            URLs (no colon before the first `/`, `?` or `#`).
 *   blocked: everything else, including javascript:, vbscript:, file:,
 *            non-image data: URIs, and protocol-relative `//host/...` URLs
 *            (treated as non-http since the scheme is ambiguous/unverified).
 *   Blocked URLs resolve to `''` — react-markdown then renders `href=""` /
 *   `src=""`, which is inert.
 */

import type { Components } from 'react-markdown'
import type { ReactNode } from 'react'
import { SyntaxHighlighter, resolveHighlightLanguage } from '@/components/editor/prismLanguages'
import oneLight from 'react-syntax-highlighter/dist/esm/styles/prism/one-light'
import type { ExportOptions } from './exportOptions'

// ── URL allow-list ─────────────────────────────────────────────────────────

/**
 * react-markdown 10 `urlTransform` — called for every `href`/`src` it emits.
 * Returning `''` renders an inert (empty) attribute; passing our own
 * transform bypasses react-markdown's own (looser) default sanitiser, so
 * this allow-list is the only thing standing between markdown text and the
 * exported document's links/images.
 */
export function exportUrlTransform(url: string): string {
  const trimmed = (url ?? '').trim()
  if (trimmed === '') return ''
  // Protocol-relative URLs (`//evil.com/x`) have no explicit scheme to vet —
  // treat as blocked rather than silently assuming http/https.
  if (trimmed.startsWith('//')) return ''

  const colonIdx = trimmed.indexOf(':')
  const stopChars = ['/', '?', '#']
  let firstStop = Infinity
  for (const c of stopChars) {
    const i = trimmed.indexOf(c)
    if (i !== -1 && i < firstStop) firstStop = i
  }
  const hasScheme = colonIdx !== -1 && colonIdx < firstStop
  if (!hasScheme) return trimmed // scheme-less relative URL — allowed as-is

  const scheme = trimmed.slice(0, colonIdx).toLowerCase()
  if (scheme === 'http' || scheme === 'https' || scheme === 'mailto') return trimmed
  if (scheme === 'data') {
    const afterScheme = trimmed.slice(colonIdx + 1).toLowerCase()
    return afterScheme.startsWith('image/') ? trimmed : ''
  }
  return ''
}

// ── Helpers ────────────────────────────────────────────────────────────────

function childrenToText(children: ReactNode): string {
  if (children === null || children === undefined) return ''
  if (typeof children === 'string' || typeof children === 'number') return String(children)
  if (Array.isArray(children)) return children.map(childrenToText).join('')
  if (typeof children === 'object' && 'props' in children) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return childrenToText((children as any).props?.children)
  }
  return ''
}

// ── Component map ──────────────────────────────────────────────────────────

/**
 * Build the react-markdown `Components` map for export, given the user's
 * styling options (only `showLinkUrls` actually affects component output —
 * the rest are consumed by `buildExportCss`).
 */
export function makeExportComponents(opts: ExportOptions): Components {
  return {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    a({ node: _node, href, children, ...props }) {
      const text = childrenToText(children)
      const showUrl =
        opts.showLinkUrls &&
        !!href &&
        /^https?:\/\//i.test(href) &&
        text !== href

      return (
        <a href={href} rel="noreferrer noopener" {...props}>
          {children}
          {showUrl && <span className="url"> ({href})</span>}
        </a>
      )
    },

    // Fenced/inline code — three cases, mirrors MarkdownRenderer's detection.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    code({ className, children, node: _node, ...props }) {
      const match = /language-(\w+)/.exec(className ?? '')
      const detectedLang = match ? match[1] : ''

      // Case 1: labeled fenced block — syntax highlighted (inline styles).
      if (detectedLang) {
        const language = resolveHighlightLanguage(detectedLang)
        const code = String(children).replace(/\n$/, '')
        return (
          <SyntaxHighlighter
            language={language}
            style={oneLight}
            PreTag="pre"
            customStyle={{ margin: 0 }}
            codeTagProps={{ className: 'hl' }}
          >
            {code}
          </SyntaxHighlighter>
        )
      }

      // react-markdown always appends '\n' to fenced content; inline never has one.
      const isBlock = String(children).includes('\n')

      // Case 2: unlabeled fenced block — plain <pre><code>.
      if (isBlock) {
        return (
          <pre>
            <code>{String(children).replace(/\n$/, '')}</code>
          </pre>
        )
      }

      // Case 3: inline code.
      return <code {...props}>{children}</code>
    },

    // `pre` is a pass-through: `code` (above) supplies its own <pre> for both
    // block cases, so react-markdown's wrapping <pre> must not double up.
    pre({ children }) {
      return <>{children}</>
    },

    // Task-list checkboxes render as text glyphs so they survive print/HTML
    // (a disabled <input> has no visual affordance in print, and Word strips
    // form controls on paste).
    input({ type, checked }) {
      if (type !== 'checkbox') return null
      return (
        <>
          <span className="task" aria-hidden="true">{checked ? '☑' : '☐'}</span>{' '}
        </>
      )
    },

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    img({ node: _node, src, alt }) {
      if (!src) return <em>{alt}</em>
      return <img src={src} alt={alt} loading="eager" />
    },
  }
}
