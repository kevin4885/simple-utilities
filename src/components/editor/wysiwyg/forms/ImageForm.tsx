/**
 * wysiwyg/forms/ImageForm.tsx
 *
 * ImageForm / ImagePopover — modal-free inline form for inserting/editing images.
 * Moved from WysiwygEditor.tsx. Unchanged behaviour.
 */

import { useState, useEffect, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Popover,
  PopoverContent,
  PopoverAnchor,
} from '@/components/ui/popover'
import { anchorRectToStyle } from '../utils'
import type { SelectionRect } from '../utils'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ImagePopoverState {
  open: boolean
  initialSrc: string
  initialAlt: string
  isEditing: boolean
  anchorRect: SelectionRect | null
}

interface ImagePopoverProps {
  state: ImagePopoverState
  onSave: (src: string, alt: string) => void
  onRemove: () => void
  onClose: () => void
}

interface ImageFormProps {
  initialSrc: string
  initialAlt: string
  isEditing: boolean
  onSave: (src: string, alt: string) => void
  onRemove: () => void
  onClose: () => void
}

// ---------------------------------------------------------------------------
// ImageForm
// ---------------------------------------------------------------------------

function ImageForm({
  initialSrc,
  initialAlt,
  isEditing,
  onSave,
  onRemove,
  onClose,
}: ImageFormProps) {
  const [src, setSrc] = useState(initialSrc)
  const [alt, setAlt] = useState(initialAlt)
  const srcInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setTimeout(() => {
      srcInputRef.current?.focus()
      srcInputRef.current?.select()
    }, 50)
  }, [])

  function handleSave() {
    onSave(src.trim(), alt.trim())
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
        {isEditing ? 'Edit image' : 'Insert image'}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="wysiwyg-image-src" className="text-xs">
          Image URL
        </Label>
        <Input
          id="wysiwyg-image-src"
          ref={srcInputRef}
          value={src}
          onChange={(e) => setSrc(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="https://example.com/image.png"
          className="h-8 text-sm"
          autoComplete="off"
        />
        <p className="text-[10px] text-muted-foreground leading-tight">
          URL or base64 data: URI
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="wysiwyg-image-alt" className="text-xs">
          Alt text
        </Label>
        <Input
          id="wysiwyg-image-alt"
          value={alt}
          onChange={(e) => setAlt(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Describe the image"
          className="h-8 text-sm"
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
            title="Remove image"
            aria-label="Remove image"
          >
            Remove
          </Button>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// ImagePopover
// ---------------------------------------------------------------------------

export function ImagePopover({ state, onSave, onRemove, onClose }: ImagePopoverProps) {
  const formKey = `${state.open}|${state.initialSrc}|${state.initialAlt}`

  return (
    <Popover open={state.open} onOpenChange={(open) => { if (!open) onClose() }}>
      <PopoverAnchor asChild>
        <span style={anchorRectToStyle(state.anchorRect)} />
      </PopoverAnchor>
      <PopoverContent
        className="w-80 p-4"
        onOpenAutoFocus={(e) => e.preventDefault()}
        onInteractOutside={onClose}
      >
        <ImageForm
          key={formKey}
          initialSrc={state.initialSrc}
          initialAlt={state.initialAlt}
          isEditing={state.isEditing}
          onSave={onSave}
          onRemove={onRemove}
          onClose={onClose}
        />
      </PopoverContent>
    </Popover>
  )
}
