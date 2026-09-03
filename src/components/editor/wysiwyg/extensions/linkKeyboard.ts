/**
 * wysiwyg/extensions/linkKeyboard.ts
 *
 * Link keyboard extension: Mod-k opens the link popover,
 * Mod-Shift-k removes the link mark, plus table keyboard shortcuts.
 *
 * Also exports MARKDOWN_LINK_REGEX and buildLinkKeyboardExtension.
 */

import type { MutableRefObject } from 'react'
import { Extension, InputRule } from '@tiptap/core'
import type { Editor } from '@tiptap/core'
import { normalizeUrl } from '../utils'

/**
 * Matches `[text](url)` followed by a space or at end-of-line.
 * Capture groups:
 *   [1] text between [ ]
 *   [2] url between ( )
 *
 * Negative cases handled:
 *   - `[ ]` (task list unchecked) — empty text after trim
 *   - `[x]` or `[X]` (task list checked) — single letter, rejected by handler
 *   - `[foo]` without `(url)` — regex won't match
 *   - `[text]()` — empty url, regex requires 1+ chars in url group
 *
 * Note: single char link text like `[x](https://x.com)` is also blocked by
 * the handler guard as an intentional task-list disambiguation tradeoff.
 */
export const MARKDOWN_LINK_REGEX = /\[([^\]]+)\]\(([^)]+)\)\s?$/

/**
 * Builds the link keyboard extension: Mod-k opens the link popover,
 * Mod-Shift-k removes the link mark, table keyboard shortcuts.
 *
 * Table shortcuts only fire when the caret is inside a table; otherwise
 * they return false so the key falls through to other handlers.
 */
export function buildLinkKeyboardExtension(
  openLinkRef: MutableRefObject<(() => void) | null>,
): Extension {
  return Extension.create({
    name: 'linkKeyboard',
    addKeyboardShortcuts() {
      return {
        // Open link popover
        'Mod-k': () => {
          openLinkRef.current?.()
          return true
        },
        // Remove link mark
        'Mod-Shift-k': ({ editor }: { editor: Editor }) => {
          if (!editor.isActive('link')) return false
          editor.chain().focus().extendMarkRange('link').unsetLink().run()
          return true
        },
        // Table shortcuts — only when inside a table
        'Mod-Enter': ({ editor }: { editor: Editor }) => {
          if (!editor.isActive('table')) return false
          editor.chain().focus().addRowAfter().run()
          return true
        },
        'Mod-Shift-Enter': ({ editor }: { editor: Editor }) => {
          if (!editor.isActive('table')) return false
          editor.chain().focus().addRowBefore().run()
          return true
        },
        'Mod-Alt-ArrowRight': ({ editor }: { editor: Editor }) => {
          if (!editor.isActive('table')) return false
          editor.chain().focus().addColumnAfter().run()
          return true
        },
        'Mod-Alt-ArrowLeft': ({ editor }: { editor: Editor }) => {
          if (!editor.isActive('table')) return false
          editor.chain().focus().addColumnBefore().run()
          return true
        },
        'Mod-Alt-Backspace': ({ editor }: { editor: Editor }) => {
          if (!editor.isActive('table')) return false
          editor.chain().focus().deleteRow().run()
          return true
        },
      }
    },
    addInputRules() {
      const linkType = this.editor.schema.marks.link
      if (!linkType) return []

      return [
        new InputRule({
          find: MARKDOWN_LINK_REGEX,
          handler({ state, range, match }) {
            const text = match[1]
            const rawUrl = match[2]
            if (!text || !rawUrl) return null

            // Reject single char task-list matches: [ ] or [x]
            if (text.trim().length <= 1 && /^[\s xX]$/.test(text)) return null

            const href = normalizeUrl(rawUrl)
            if (!href) return null

            const { tr } = state
            // Replace the full match (including trailing space) with linked text
            const fullMatch = match[0]
            const hasTrailingSpace = fullMatch.endsWith(' ')
            const linkText = text
            const from = range.from
            const to = range.to

            tr.delete(from, to)
            const linkMark = linkType.create({ href })
            const textNode = state.schema.text(linkText, [linkMark])
            tr.insert(from, textNode)
            // Remove the link mark from cursor so subsequent typing is plain
            tr.removeStoredMark(linkType)
            // Add the trailing space back (outside the link)
            if (hasTrailingSpace) {
              tr.insertText(' ', from + linkText.length)
            }
          },
        }),
      ]
    },
  })
}
