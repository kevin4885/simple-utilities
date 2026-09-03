/**
 * wysiwyg/utils.ts — pure helper functions for WysiwygEditor
 *
 * Kept separate so they can be unit-tested without any DOM / React
 * dependencies. Moved from wysiwyg-utils.ts; that module now re-exports
 * from here for backwards compatibility.
 */

import type { EditorState } from '@tiptap/pm/state'

// ---------------------------------------------------------------------------
// normalizeUrl — re-exported here from the canonical location
// ---------------------------------------------------------------------------

export { normalizeUrl } from '../wysiwyg-utils'

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
