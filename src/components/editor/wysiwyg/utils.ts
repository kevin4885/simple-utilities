/**
 * wysiwyg/utils.ts — pure helper functions for WysiwygEditor
 *
 * Kept separate so they can be unit-tested without any DOM / React
 * dependencies.
 */

import type { EditorState } from '@tiptap/pm/state'

// ---------------------------------------------------------------------------
// normalizeUrl
// ---------------------------------------------------------------------------

/**
 * Normalise a raw URL string entered by the user.
 *
 * Rules:
 *  - Returns '' for empty / whitespace-only input (treat as "no URL").
 *  - Rejects dangerous schemes (javascript:, vbscript:) by returning ''.
 *  - Leaves anything that already has a safe URL scheme alone:
 *      mailto:, data:image/*, tel:, ftp://, https://, http://, #anchor, etc.
 *  - Leaves relative paths (/foo, ./foo, ../foo) alone.
 *  - Prepends "https://" to everything else (bare domains, host:port, etc.).
 *
 * Whitespace is always trimmed before any check.
 */
export function normalizeUrl(url: string): string {
  const trimmed = url.trim()
  if (!trimmed) return ''

  // Absolute anchor (#) or relative paths
  if (
    trimmed.startsWith('#') ||
    trimmed.startsWith('/') ||
    trimmed.startsWith('./') ||
    trimmed.startsWith('../')
  ) {
    return trimmed
  }

  // Check for a URL scheme vs a host:port.
  // A URL scheme is [ALPHA *( ALPHA / DIGIT / "+" / "-" / "." )] followed by ":".
  // But host:port looks the same syntactically. We disambiguate by inspecting
  // what follows the colon:
  //   - A port is purely numeric (digits only, possibly followed by / or end).
  //   - A scheme value starts with "/" (http://, ftp://) or a non-digit letter
  //     (mailto:user@..., javascript:..., data:image/...).
  //
  // Additionally, real URL schemes never contain dots — "example.com" is a host,
  // not a scheme. So we also exclude possibleSchemes that contain dots.
  const colonIdx = trimmed.indexOf(':')
  if (colonIdx > 0) {
    const possibleScheme = trimmed.slice(0, colonIdx)
    const afterColon = trimmed.slice(colonIdx + 1)

    // A scheme must be letters-only (+ optional +, -, but NOT dots or digits before the colon)
    const looksLikeScheme = /^[a-zA-Z][a-zA-Z+-]*$/.test(possibleScheme)
    // A port is purely numeric (possibly followed by / or end of string)
    const looksLikePort = /^\d+(\/|$)/.test(afterColon)

    if (looksLikeScheme && !looksLikePort) {
      const schemeLower = possibleScheme.toLowerCase()
      // Block known dangerous schemes
      if (schemeLower === 'javascript' || schemeLower === 'vbscript') {
        return ''
      }
      // Allow all other safe schemes (http, https, mailto, tel, ftp, data, etc.)
      return trimmed
    }
  }

  // No scheme (or host:port), bare domain or path — prepend https://
  return `https://${trimmed}`
}

// ---------------------------------------------------------------------------
// getScrollParent — nearest scrollable ancestor
// ---------------------------------------------------------------------------

/**
 * Walk up the DOM tree to find the nearest ancestor that is scrollable
 * (i.e. has `overflow-y: auto` or `overflow-y: scroll` via computed style).
 * Falls back to `document.scrollingElement` if none is found.
 *
 * Replaces the fragile `el.closest('.overflow-y-auto')` pattern in
 * TableControls.tsx which was coupled to Tailwind class names.
 */
export function getScrollParent(el: HTMLElement | null): HTMLElement | Element | null {
  if (!el) return null
  let node: HTMLElement | null = el.parentElement
  while (node) {
    const style = getComputedStyle(node)
    const overflowY = style.overflowY
    if (overflowY === 'auto' || overflowY === 'scroll') {
      return node
    }
    node = node.parentElement
  }
  return (typeof document !== 'undefined' ? document.scrollingElement : null)
}

// ---------------------------------------------------------------------------
// sanitizeImageSrc
// ---------------------------------------------------------------------------

/**
 * Sanitise an image src before inserting/updating it in the editor.
 *
 * Allowed sources:
 *   • `data:image/*`  — file drop/paste data URIs; passed through unchanged.
 *   • `blob:`         — object URLs created by the browser; passed through.
 *   • `https://` / `http://` — remote image URLs (via normalizeUrl).
 *   • Relative paths  — `/foo`, `./foo`, `../foo` (via normalizeUrl).
 *   • `#anchor`       — fragment-only references (unusual but valid).
 *
 * Rejected:
 *   • `javascript:`, `vbscript:` — dangerous; normalizeUrl returns ''.
 *   • `data:text/html`, `data:application/*` — not images; rejected here
 *     before normalizeUrl would otherwise pass them through.
 *   • Empty / whitespace-only input.
 *
 * Returns '' if the result is empty (caller should not insert).
 */
export function sanitizeImageSrc(src: string): string {
  const trimmed = src.trim()
  if (!trimmed) return ''
  // data:image/* URIs (file drop / paste) are safe and must not be mangled by normalizeUrl
  if (trimmed.startsWith('data:image/')) return trimmed
  // blob: object URLs are safe (created by the browser for file previews)
  if (trimmed.startsWith('blob:')) return trimmed
  // Reject any other data: URI (e.g. data:text/html, data:application/javascript)
  if (trimmed.startsWith('data:')) return ''
  return normalizeUrl(trimmed)
}

// ---------------------------------------------------------------------------
// getLinkRange — find the full extent of the link mark at the cursor
// ---------------------------------------------------------------------------

/**
 * Returns the from/to extent of the link mark under the current cursor,
 * or null if the cursor is not inside a link mark.
 *
 * Used by openLinkWidget (to set range decoration bounds) and by WidgetPopover
 * (to prefill the link text field when editing an existing link).
 */
export function getLinkRange(state: EditorState): { from: number; to: number } | null {
  const { selection } = state
  const { $from } = selection
  const linkMark = $from.marks().find((m) => m.type.name === 'link')
  if (!linkMark) return null
  let from = selection.from
  let to = selection.from
  while (from > 0 && state.doc.rangeHasMark(from - 1, from, linkMark.type)) from--
  while (to < state.doc.content.size && state.doc.rangeHasMark(to, to + 1, linkMark.type)) to++
  return { from, to }
}
