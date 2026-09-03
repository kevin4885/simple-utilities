/**
 * wysiwyg/forms/ImageForm.tsx
 *
 * ImageForm — form component for inserting/editing images.
 * Rendered inside WidgetPopover (Phase 2).
 *
 * Fields: URL, Title (optional), Alt text, plus a drag-and-drop / file picker.
 * Files are read as data: URIs (no backend). Files > 1 MB show a warning.
 *
 * The Title field value is passed as the `title` attribute on the image node
 * and round-trips through tiptap-markdown as `![alt](src "title")`.
 *
 * Width/height are intentionally excluded: GFM markdown has no image size
 * syntax, so dimensions cannot round-trip through the markdown serialiser.
 * See src/components/editor/CLAUDE.md for the deliberate constraint note.
 *
 * Exported:
 *   ImageForm — the form UI
 */

import { useState, useEffect, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ImageIcon, UploadIcon, AlertTriangleIcon } from 'lucide-react'
import { fileToDataUri, isImageFile, formatBytes, SIZE_WARNING_BYTES } from './imageFile'
import { cn } from '@/lib/utils'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ImageFormProps {
  initialSrc: string
  initialAlt: string
  /** Optional tooltip title (shown as tooltip in most renderers). */
  initialTitle?: string
  isEditing: boolean
  onSave: (src: string, alt: string, title: string) => void
  onRemove: () => void
  onClose: () => void
}

// ---------------------------------------------------------------------------
// ImageForm
// ---------------------------------------------------------------------------

export function ImageForm({
  initialSrc,
  initialAlt,
  initialTitle = '',
  isEditing,
  onSave,
  onRemove,
  onClose,
}: ImageFormProps) {
  const [src, setSrc] = useState(initialSrc)
  const [alt, setAlt] = useState(initialAlt)
  const [title, setTitle] = useState(initialTitle)
  const [dragging, setDragging] = useState(false)
  const [sizeWarning, setSizeWarning] = useState<string | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const srcInputRef = useRef<HTMLInputElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setTimeout(() => {
      srcInputRef.current?.focus()
      srcInputRef.current?.select()
    }, 50)
  }, [])

  function handleSave() {
    onSave(src.trim(), alt.trim(), title.trim())
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

  async function handleFile(file: File) {
    if (!isImageFile(file)) {
      setFileError("That file doesn't look like an image — try a PNG, JPEG, GIF, or WebP.")
      return
    }
    setFileError(null)
    if (file.size > SIZE_WARNING_BYTES) {
      setSizeWarning(`Large image (${formatBytes(file.size)}) — this will bloat the document.`)
    } else {
      setSizeWarning(null)
    }
    setLoading(true)
    try {
      const dataUri = await fileToDataUri(file)
      setSrc(dataUri)
      // Try to extract a sensible alt from filename
      if (!alt) {
        const name = file.name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ')
        setAlt(name)
      }
    } catch {
      setFileError("Couldn't read that file — please try again.")
    } finally {
      setLoading(false)
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) void handleFile(file)
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault()
    setDragging(true)
  }

  function handleDragLeave() {
    setDragging(false)
  }

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) void handleFile(file)
  }

  const hasPreview = src.startsWith('data:image') || src.startsWith('http')

  return (
    <div className="flex flex-col gap-3">
      <div className="text-sm font-medium text-foreground">
        {isEditing ? 'Edit image' : 'Insert image'}
      </div>

      {/* Drop zone / file picker */}
      <div
        className={cn(
          'flex flex-col items-center justify-center gap-1.5 rounded-md border-2 border-dashed py-3 px-3 text-xs text-muted-foreground cursor-pointer transition-colors',
          dragging
            ? 'border-primary bg-primary/5 text-primary'
            : 'border-input hover:border-primary/50 hover:bg-muted/40',
        )}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onClick={() => fileInputRef.current?.click()}
        role="button"
        tabIndex={0}
        aria-label="Drop an image or click to browse"
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') fileInputRef.current?.click()
        }}
      >
        {loading ? (
          <span className="text-muted-foreground">Reading file…</span>
        ) : (
          <>
            {hasPreview ? (
              <ImageIcon className="h-5 w-5 text-primary" />
            ) : (
              <UploadIcon className="h-5 w-5" />
            )}
            <span>
              {hasPreview ? 'Replace with file' : 'Paste or drop an image, or click to browse'}
            </span>
          </>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="sr-only"
          tabIndex={-1}
          onChange={handleFileInput}
          aria-hidden="true"
        />
      </div>

      {sizeWarning && (
        <div className="flex items-start gap-1.5 text-[10px] text-amber-600 dark:text-amber-400 leading-tight">
          <AlertTriangleIcon className="h-3 w-3 shrink-0 mt-0.5" />
          <span>{sizeWarning}</span>
        </div>
      )}

      {fileError && (
        <div className="flex items-start gap-1.5 text-[10px] text-destructive leading-tight">
          <AlertTriangleIcon className="h-3 w-3 shrink-0 mt-0.5" />
          <span>{fileError}</span>
        </div>
      )}

      {/* URL field */}
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

      {/* Title field (optional) */}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="wysiwyg-image-title" className="text-xs">
          Title <span className="font-normal text-muted-foreground">(optional)</span>
        </Label>
        <Input
          id="wysiwyg-image-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Shown as tooltip on hover"
          className="h-8 text-sm"
        />
      </div>

      {/* Alt text field */}
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
