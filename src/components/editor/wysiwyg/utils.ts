/**
 * wysiwyg/utils.ts — pure helper functions for WysiwygEditor
 *
 * Kept separate so they can be unit-tested without any DOM / React
 * dependencies. Moved from wysiwyg-utils.ts; that module now re-exports
 * from here for backwards compatibility.
 */

import type { Editor } from '@tiptap/core'
import type { CSSProperties } from 'react'

// ---------------------------------------------------------------------------
// normalizeUrl — re-exported here from the canonical location
// ---------------------------------------------------------------------------

export { normalizeUrl } from '../wysiwyg-utils'

// ---------------------------------------------------------------------------
// Selection-rect helpers — used to anchor popovers to the current selection
// ---------------------------------------------------------------------------

export interface SelectionRect {
  top: number
  left: number
  width: number
  height: number
}

export function getSelectionRect(editor: Editor): SelectionRect | null {
  const { state, view } = editor
  const { selection } = state

  try {
    if (editor.isActive('image')) {
      const nodeDom = view.nodeDOM(selection.from)
      if (nodeDom instanceof Element) {
        const r = nodeDom.getBoundingClientRect()
        return { top: r.top, left: r.left, width: r.width, height: r.height }
      }
    }

    const fromCoords = view.coordsAtPos(selection.from)
    const toCoords   = view.coordsAtPos(Math.max(selection.from, selection.to))
    const top    = Math.min(fromCoords.top,    toCoords.top)
    const left   = Math.min(fromCoords.left,   toCoords.left)
    const bottom = Math.max(fromCoords.bottom, toCoords.bottom)
    const right  = Math.max(fromCoords.right,  toCoords.right)
    return {
      top,
      left,
      width:  Math.max(right - left, 1),
      height: Math.max(bottom - top, 1),
    }
  } catch {
    return null
  }
}

export function anchorRectToStyle(rect: SelectionRect | null): CSSProperties {
  if (rect) {
    return {
      position: 'fixed',
      top: rect.top,
      left: rect.left,
      width: rect.width,
      height: rect.height,
      pointerEvents: 'none',
      visibility: 'hidden',
    }
  }
  return {
    position: 'fixed',
    top: 0,
    left: 0,
    width: 1,
    height: 1,
    pointerEvents: 'none',
    visibility: 'hidden',
  }
}
