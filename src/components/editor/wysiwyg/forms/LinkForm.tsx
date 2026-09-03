/**
 * wysiwyg/forms/LinkForm.tsx
 *
 * LinkForm — pure form component for inserting/editing links.
 * Rendered inside WidgetPopover (Phase 2). The old LinkPopover wrapper
 * (with frozen position:fixed anchor) has been removed.
 *
 * Exported:
 *   LinkForm        — the form UI
 *   LinkPopoverState / LinkPopoverProps — kept for test/external compatibility
 */

import { useState, useEffect, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { normalizeUrl } from '../utils'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** @deprecated — kept for backward-compat; use WidgetPopover instead */
export interface LinkPopoverState {
  open: boolean
  initialText: string
  initialHref: string
  isEditing: boolean
  anchorRect: null
}

export interface LinkFormProps {
  initialText: string
  initialHref: string
  isEditing: boolean
  onSave: (text: string, href: string) => void
  onRemove: () => void
  onClose: () => void
}

// ---------------------------------------------------------------------------
// LinkForm
// ---------------------------------------------------------------------------

export function LinkForm({
  initialText,
  initialHref,
  isEditing,
  onSave,
  onRemove,
  onClose,
}: LinkFormProps) {
  const [text, setText] = useState(initialText)
  const [href, setHref] = useState(initialHref)
  const hrefInputRef = useRef<HTMLInputElement>(null)
  const textInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setTimeout(() => {
      if (initialText) {
        hrefInputRef.current?.focus()
        hrefInputRef.current?.select()
      } else {
        textInputRef.current?.focus()
      }
    }, 50)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function handleSave() {
    const normalised = normalizeUrl(href)
    onSave(text.trim(), normalised)
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleSave()
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="text-sm font-medium text-foreground">
        {isEditing ? 'Edit link' : 'Insert link'}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="wysiwyg-link-text" className="text-xs">
          Text
        </Label>
        <Input
          id="wysiwyg-link-text"
          ref={textInputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Link text"
          className="h-8 text-sm"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="wysiwyg-link-url" className="text-xs">
          URL
        </Label>
        <Input
          id="wysiwyg-link-url"
          ref={hrefInputRef}
          value={href}
          onChange={(e) => setHref(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="https://example.com"
          className="h-8 text-sm"
          type="url"
          autoComplete="off"
        />
      </div>

      <div className="flex items-center gap-2 pt-1">
        <Button size="sm" className="h-7 text-xs flex-1" onClick={handleSave}>
          Save
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs"
          onClick={onClose}
        >
          Cancel
        </Button>
        {isEditing && (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs text-destructive hover:text-destructive hover:bg-destructive/10"
            onClick={onRemove}
            title="Remove link"
            aria-label="Remove link"
          >
            Unlink
          </Button>
        )}
      </div>
    </div>
  )
}
