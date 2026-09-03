/**
 * wysiwyg/forms/WidgetPopover.tsx
 *
 * React side of the widget-form system. Subscribes to widgetFormExtension
 * storage, and when active renders a Radix Popover anchored to the in-document
 * anchor element via PopoverAnchor + virtualRef.
 *
 * Anchor modes (see widgetForm.ts):
 *   chip  — virtualRef → chip <span> in the document
 *   range — virtualRef → .wysiwyg-link-target span (resolved lazily after render)
 *   node  — virtualRef → the image DOM node
 *
 * Form routing: active.kind determines which form is rendered.
 */

import { useState, useEffect, useRef, useLayoutEffect } from 'react'
import type { RefObject } from 'react'
import type { Measurable } from '@radix-ui/rect'
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from '@/components/ui/popover'
import type { Editor } from '@tiptap/core'
import type { WidgetFormStorage, WidgetFormKind, ActiveWidget } from '../extensions/widgetForm'
import { TextSelection, NodeSelection } from '@tiptap/pm/state'
import { LinkForm } from './LinkForm'
import { ImageForm } from './ImageForm'
import { TableForm } from './TableForm'
import { getLinkRange, sanitizeImageSrc } from '../utils'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WidgetPopoverProps {
  editor: Editor
}

// ---------------------------------------------------------------------------
// WidgetPopover
// ---------------------------------------------------------------------------

export function WidgetPopover({ editor }: WidgetPopoverProps) {
  const getInitialActive = (): ActiveWidget | null => {
    const storage = (editor.storage as unknown as Record<string, unknown>).widgetForm as
      | WidgetFormStorage
      | undefined
    return storage?.active ?? null
  }
  const [active, setActive] = useState<ActiveWidget | null>(getInitialActive)
  const virtualRef = useRef<Measurable | null>(null)

  // Sync virtualRef whenever active.dom changes (layout effect = before browser paint)
  useLayoutEffect(() => {
    virtualRef.current = active?.dom ?? null
  })

  // Subscribe to widgetForm storage changes
  useEffect(() => {
    const storage = (editor.storage as unknown as Record<string, unknown>).widgetForm as
      | WidgetFormStorage
      | undefined
    if (!storage) return
    const cb = (a: ActiveWidget | null) => {
      setActive(a)
    }
    storage.subscribe(cb)
    return () => storage.unsubscribe(cb)
  }, [editor])

  const isOpen = active !== null

  function handleClose() {
    if (!active) {
      editor.commands.closeWidgetForm()
      return
    }
    // Restore the user's original selection before focusing so Cancel doesn't lose the cursor
    const { mode, selectionFrom, selectionTo, nodePos } = active
    editor.commands.closeWidgetForm()

    try {
      const { state } = editor
      if (mode === 'node' && nodePos !== undefined) {
        const tr = state.tr.setSelection(NodeSelection.create(state.doc, nodePos))
        editor.view.dispatch(tr)
      } else if (selectionFrom !== selectionTo) {
        const safeTo = Math.min(selectionTo, state.doc.content.size)
        const safeFrom = Math.min(selectionFrom, safeTo)
        const tr = state.tr.setSelection(
          TextSelection.create(state.doc, safeFrom, safeTo),
        )
        editor.view.dispatch(tr)
      }
    } catch {
      // Selection restore is best-effort; ignore if doc changed
    }
  }

  // ----- Link form handlers -----

  function handleLinkSave(text: string, href: string) {
    if (!active) return
    const { selectionFrom, selectionTo, rangeFrom, rangeTo, mode } = active
    const hasSelection = selectionFrom !== selectionTo
    const isEditing = editor.isActive('link')
    editor.commands.closeWidgetForm()

    if (!href) {
      if (isEditing) {
        editor.chain().focus().extendMarkRange('link').unsetLink().run()
      }
      return
    }

    if (text) {
      if (mode === 'range') {
        // range mode: replace the full decorated range (covers selected text OR
        // the full existing link mark extent)
        editor
          .chain()
          .focus()
          .setTextSelection({ from: rangeFrom, to: rangeTo })
          .deleteSelection()
          .insertContent({
            type: 'text',
            text,
            marks: [{ type: 'link', attrs: { href } }],
          })
          .run()
      } else if (hasSelection) {
        editor
          .chain()
          .focus()
          .setTextSelection({ from: selectionFrom, to: selectionTo })
          .deleteSelection()
          .insertContent({
            type: 'text',
            text,
            marks: [{ type: 'link', attrs: { href } }],
          })
          .run()
      } else if (isEditing) {
        editor
          .chain()
          .focus()
          .extendMarkRange('link')
          .deleteSelection()
          .insertContent({
            type: 'text',
            text,
            marks: [{ type: 'link', attrs: { href } }],
          })
          .run()
      } else {
        editor
          .chain()
          .focus()
          .insertContent({
            type: 'text',
            text,
            marks: [{ type: 'link', attrs: { href } }],
          })
          .run()
      }
    } else {
      // No text — apply/update the link mark
      if (mode === 'range') {
        editor
          .chain()
          .focus()
          .setTextSelection({ from: rangeFrom, to: rangeTo })
          .setLink({ href })
          .run()
      } else if (hasSelection) {
        editor
          .chain()
          .focus()
          .setTextSelection({ from: selectionFrom, to: selectionTo })
          .setLink({ href })
          .run()
      } else {
        editor.chain().focus().extendMarkRange('link').setLink({ href }).run()
      }
    }
  }

  function handleLinkRemove() {
    if (!active) return
    editor.commands.closeWidgetForm()
    editor.chain().focus().extendMarkRange('link').unsetLink().run()
  }

  // ----- Image form handlers -----

  function handleImageSave(src: string, alt: string, title: string) {
    if (!active) return
    const isImageEdit = active.kind === 'image' && editor.isActive('image')
    const selFrom = active.selectionFrom
    editor.commands.closeWidgetForm()

    // Sanitize src: blocks javascript: / vbscript:; passes data:image/* through;
    // normalizes bare domains by prepending https://.
    const safeSrc = sanitizeImageSrc(src)
    if (!safeSrc) return

    if (isImageEdit) {
      editor.chain().focus().updateAttributes('image', { src: safeSrc, alt, title: title || undefined }).run()
      return
    }

    // Insert mode — move caret to widget pos then insert
    const { state } = editor
    const resolvedPos = state.doc.resolve(Math.min(selFrom, state.doc.content.size))
    const tr = state.tr.setSelection(TextSelection.near(resolvedPos))
    editor.view.dispatch(tr)
    editor.chain().focus().setImage({ src: safeSrc, alt, title: title || undefined } as Parameters<typeof editor.commands.setImage>[0]).run()
  }

  function handleImageRemove() {
    if (!active) return
    editor.commands.closeWidgetForm()
    editor.chain().focus().deleteSelection().run()
  }

  // ----- Table form handlers -----

  function handleTableInsert(rows: number, cols: number, withHeaderRow: boolean) {
    if (!active) return
    const selFrom = active.selectionFrom
    editor.commands.closeWidgetForm()

    const { state } = editor
    const resolvedPos = state.doc.resolve(Math.min(selFrom, state.doc.content.size))
    const tr = state.tr.setSelection(TextSelection.near(resolvedPos))
    editor.view.dispatch(tr)
    editor.chain().focus().insertTable({ rows, cols, withHeaderRow }).run()
  }

  // Determine initial values for link/image forms (edit mode)
  const linkAttrs = editor.getAttributes('link') as { href?: string }
  const imageAttrs = editor.getAttributes('image') as { src?: string; alt?: string; title?: string }
  const isEditingLink = editor.isActive('link')
  const isEditingImage = active?.kind === 'image' && editor.isActive('image')

  // Prefill link text from selection or existing link
  // Uses getLinkRange() util to walk the mark extent (same logic as range decoration).
  let prefillLinkText = ''
  const prefillLinkHref = linkAttrs.href ?? ''
  if (isOpen && active?.kind === 'link') {
    const { selection } = editor.state
    prefillLinkText = editor.state.doc.textBetween(selection.from, selection.to, '')
    if (!prefillLinkText && isEditingLink) {
      const range = getLinkRange(editor.state)
      if (range) {
        prefillLinkText = editor.state.doc.textBetween(range.from, range.to, '')
      }
    }
  }

  // formKey forces form remount when kind/prefill changes
  const formKey = active ? `${active.id}|${active.kind}` : 'closed'

  return (
    <Popover
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) handleClose()
      }}
    >
      {/* PopoverAnchor with virtualRef — anchors to the in-document anchor element */}
      <PopoverAnchor virtualRef={virtualRef as RefObject<Measurable | null>} />
      <PopoverContent
        className="w-80 p-4"
        align="start"
        sideOffset={6}
        collisionPadding={8}
        onOpenAutoFocus={(e) => e.preventDefault()}
        onInteractOutside={handleClose}
        onEscapeKeyDown={handleClose}
      >
        {active?.kind === 'link' && (
          <LinkForm
            key={formKey}
            initialText={prefillLinkText}
            initialHref={prefillLinkHref}
            isEditing={isEditingLink}
            onSave={handleLinkSave}
            onRemove={handleLinkRemove}
            onClose={handleClose}
          />
        )}
        {active?.kind === 'image' && (
          <ImageForm
            key={formKey}
            initialSrc={imageAttrs.src ?? ''}
            initialAlt={imageAttrs.alt ?? ''}
            initialTitle={imageAttrs.title ?? ''}
            isEditing={isEditingImage}
            onSave={handleImageSave}
            onRemove={handleImageRemove}
            onClose={handleClose}
          />
        )}
        {active?.kind === 'table' && (
          <TableForm
            key={formKey}
            onInsert={handleTableInsert}
            onClose={handleClose}
          />
        )}
      </PopoverContent>
    </Popover>
  )
}

// ---------------------------------------------------------------------------
// Public openers — choose the appropriate anchor mode automatically
// ---------------------------------------------------------------------------

/**
 * Open the link widget.
 * Mode = 'range' when there is a non-empty selection OR the cursor is inside
 * an existing link (both cases need a visible range highlight, not a chip).
 * Otherwise mode = 'chip'.
 *
 * Guard: if the computed range ends up zero-width (unlikely mark/state desync),
 * fall back to chip so the form always opens.
 */
export function openLinkWidget(editor: Editor): void {
  const { state } = editor
  const { selection } = state

  if (!selection.empty || editor.isActive('link')) {
    // range mode: use the selection or the full link mark extent
    const linkRange =
      editor.isActive('link') && selection.empty ? getLinkRange(state) : null
    const from = linkRange?.from ?? selection.from
    const to = linkRange?.to ?? selection.to

    // Guard: if range is zero-width, fall back to chip so form always opens
    if (from >= to) {
      editor.commands.openWidgetForm('link', { mode: 'chip' })
      return
    }

    editor.commands.openWidgetForm('link', { mode: 'range', rangeFrom: from, rangeTo: to })
  } else {
    editor.commands.openWidgetForm('link', { mode: 'chip' })
  }
}

/**
 * Open the image widget.
 * Mode = 'node' when there is an existing image selected (ImageBubble "Edit").
 * Otherwise mode = 'chip'.
 */
export function openImageWidget(editor: Editor): void {
  if (editor.isActive('image')) {
    const { selection } = editor.state
    editor.commands.openWidgetForm('image', { mode: 'node', nodePos: selection.from })
  } else {
    editor.commands.openWidgetForm('image', { mode: 'chip' })
  }
}

/**
 * Open the table widget. Always chip mode (table insert is always at caret).
 */
export function openTableWidget(editor: Editor): void {
  editor.commands.openWidgetForm('table', { mode: 'chip' })
}

// Export kind type for external use
export type { WidgetFormKind }
