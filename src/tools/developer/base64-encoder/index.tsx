/**
 * Base64 Encoder / Decoder
 *
 * Two-pane layout: Input (left) → Output (right, read-only).
 * Full-bleed layout matching the string-escaper pattern.
 *
 * Features:
 *  - Encode plain text → Base64 or Decode Base64 → plain text
 *  - Standard Base64 (RFC 4648 §4) and Base64URL (RFC 4648 §5) variants
 *  - Unicode-safe (TextEncoder / TextDecoder, not bare btoa/atob)
 *  - Friendly error messages for invalid input
 *  - Swap button (move output → input, flip direction)
 *  - Copy button on output
 *  - File → Base64 data URI tab (drag-and-drop + file picker)
 */

import { useCallback, useDeferredValue, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { useBase64EncoderStore } from './store'
import {
  encodeBase64,
  decodeBase64,
  bytesToDataUri,
  formatFileSize,
  estimateBase64Size,
} from './logic'
import type { Base64Variant } from './logic'
import {
  Copy,
  Trash2,
  ArrowLeftRight,
  AlertTriangle,
  FileText,
  Upload,
} from 'lucide-react'
import { cn } from '@/lib/utils'

// ── Copy button with flash feedback ──────────────────────────────────────────

function CopyButton({
  getText,
  disabled,
  label = 'Copy output',
}: {
  getText: () => string
  disabled?: boolean
  label?: string
}) {
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(async () => {
    const text = getText()
    if (!text) return
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }, [getText])

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={handleCopy}
      disabled={disabled}
      className="gap-1.5"
    >
      <Copy className="h-3.5 w-3.5" />
      {copied ? 'Copied!' : label}
    </Button>
  )
}

// ── Variant toggle pill ───────────────────────────────────────────────────────

const VARIANTS: { value: Base64Variant; label: string; title: string }[] = [
  { value: 'standard', label: 'Standard', title: 'RFC 4648 §4 — uses + / = characters' },
  { value: 'url', label: 'Base64URL', title: 'RFC 4648 §5 — uses - _ without padding (URL/filename-safe)' },
]

// ── File → Data URI tab ───────────────────────────────────────────────────────

// Files larger than this show a size warning (not an error — still works).
const LARGE_FILE_THRESHOLD = 1024 * 1024 // 1 MB

interface FileDataUri {
  name: string
  mimeType: string
  sizeBytes: number
  dataUri: string
}

function FileTab() {
  const [fileData, setFileData] = useState<FileDataUri | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [copied, setCopied] = useState(false)

  const processFile = useCallback((file: File) => {
    setError(null)
    setFileData(null)

    const reader = new FileReader()
    reader.onload = (e) => {
      const arrayBuffer = e.target?.result
      if (!(arrayBuffer instanceof ArrayBuffer)) {
        setError('Failed to read file.')
        return
      }
      const bytes = new Uint8Array(arrayBuffer)
      const mimeType = file.type || 'application/octet-stream'
      const dataUri = bytesToDataUri(bytes, mimeType)
      setFileData({
        name: file.name,
        mimeType,
        sizeBytes: file.size,
        dataUri,
      })
    }
    reader.onerror = () => {
      setError('An error occurred while reading the file.')
    }
    reader.readAsArrayBuffer(file)
  }, [])

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (file) processFile(file)
      // Reset so the same file can be re-selected
      e.target.value = ''
    },
    [processFile],
  )

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
  }, [])

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setIsDragging(false)
      const file = e.dataTransfer.files?.[0]
      if (file) processFile(file)
    },
    [processFile],
  )

  const handleCopyDataUri = useCallback(async () => {
    if (!fileData) return
    await navigator.clipboard.writeText(fileData.dataUri)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }, [fileData])

  const b64Size = fileData ? estimateBase64Size(fileData.sizeBytes) : 0

  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
      {/* Drop zone / file picker */}
      <div
        role="button"
        tabIndex={0}
        aria-label="Drop a file here or click to browse"
        onClick={() => fileInputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') fileInputRef.current?.click()
        }}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={cn(
          'flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed p-10 text-center transition-colors cursor-pointer select-none',
          isDragging
            ? 'border-primary bg-primary/5 text-primary'
            : 'border-input text-muted-foreground hover:border-primary/50 hover:bg-muted/40',
        )}
      >
        <Upload className="h-8 w-8 opacity-60" />
        <div className="space-y-1">
          <p className="text-sm font-medium">
            {isDragging ? 'Drop the file here' : 'Drop a file here, or click to browse'}
          </p>
          <p className="text-xs opacity-70">
            Any file type — image, PDF, binary, etc.
          </p>
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        className="sr-only"
        onChange={handleFileChange}
        aria-hidden="true"
        tabIndex={-1}
      />

      {/* Error */}
      {error && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Result */}
      {fileData && (
        <div className="space-y-3">
          {/* File info */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <FileText className="h-3.5 w-3.5" />
              <strong className="text-foreground">{fileData.name}</strong>
            </span>
            <span>{fileData.mimeType}</span>
            <span>{formatFileSize(fileData.sizeBytes)} original</span>
            <span>→ ~{formatFileSize(b64Size)} Base64</span>
          </div>

          {/* Large file warning */}
          {fileData.sizeBytes > LARGE_FILE_THRESHOLD && (
            <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
              <span>
                Large file ({formatFileSize(fileData.sizeBytes)}). The data URI is{' '}
                {formatFileSize(b64Size)} — pasting it into a browser URL bar or HTML attribute
                will work, but some apps have size limits.
              </span>
            </div>
          )}

          {/* Data URI output */}
          <div className="rounded-lg border border-input bg-muted/30 overflow-hidden">
            <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-border bg-muted/40">
              <span className="text-xs font-medium text-muted-foreground">Data URI</span>
              <button
                onClick={handleCopyDataUri}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                <Copy className="h-3.5 w-3.5" />
                {copied ? 'Copied!' : 'Copy'}
              </button>
            </div>
            <div className="p-3">
              <p className="font-mono text-xs break-all leading-relaxed text-foreground/80 max-h-48 overflow-y-auto">
                {fileData.dataUri.slice(0, 200)}
                {fileData.dataUri.length > 200 && (
                  <span className="text-muted-foreground">
                    …{' '}
                    <span>
                      ({formatFileSize(fileData.dataUri.length - 200)} more — use Copy to get the full URI)
                    </span>
                  </span>
                )}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function Base64Encoder() {
  const { input, direction, variant, setInput, setDirection, setVariant } =
    useBase64EncoderStore()

  // Defer computation so fast typing never lags
  const deferredInput = useDeferredValue(input)

  // Compute output — whitespace-only text encodes legitimately in encode mode
  // but is treated as empty in decode mode (whitespace is stripped before decode anyway)
  const result =
    (direction === 'encode' ? deferredInput === '' : deferredInput.trim() === '')
      ? null
      : direction === 'encode'
        ? encodeBase64(deferredInput, variant)
        : decodeBase64(deferredInput, variant)

  const outputValue = result?.ok ? result.output : ''
  const outputError = result && !result.ok ? result.error : null

  // Direction labels
  const directionLabel =
    direction === 'encode' ? 'Text → Base64' : 'Base64 → Text'
  const inputLabel = direction === 'encode' ? 'Plain text input' : 'Base64 input'
  const outputLabel = direction === 'encode' ? 'Base64 output' : 'Decoded text output'

  // Swap: move output → input and flip direction
  const handleSwap = useCallback(() => {
    if (!result?.ok) return
    setInput(result.output)
    setDirection(direction === 'encode' ? 'decode' : 'encode')
  }, [result, direction, setInput, setDirection])

  const handleClear = useCallback(() => setInput(''), [setInput])

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* ── Toolbar ─────────────────────────────────────────────────────────── */}
      <div className="shrink-0 flex flex-wrap items-center gap-2 border-b border-border px-3 py-2 bg-background">
        {/* Direction toggle */}
        <Button
          variant="outline"
          size="sm"
          onClick={() => setDirection(direction === 'encode' ? 'decode' : 'encode')}
          className="gap-1.5"
        >
          <ArrowLeftRight className="h-3.5 w-3.5" />
          {directionLabel}
        </Button>

        {/* Swap */}
        <Button
          variant="ghost"
          size="sm"
          onClick={handleSwap}
          disabled={!result?.ok}
          className="gap-1.5"
          title="Move output to input and flip direction"
        >
          <ArrowLeftRight className="h-3.5 w-3.5 rotate-90" />
          Swap
        </Button>

        <Separator orientation="vertical" className="h-5 shrink-0" />

        {/* Variant selector */}
        <div className="flex items-center gap-1">
          <span className="text-xs text-muted-foreground mr-0.5">Variant:</span>
          {VARIANTS.map((v) => (
            <button
              key={v.value}
              onClick={() => setVariant(v.value)}
              title={v.title}
              aria-pressed={variant === v.value}
              className={cn(
                'h-6 rounded px-1.5 text-xs font-medium transition-colors',
                variant === v.value
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground',
              )}
            >
              {v.label}
            </button>
          ))}
        </div>

        <Separator orientation="vertical" className="h-5 shrink-0" />

        {/* Copy output */}
        <CopyButton getText={() => outputValue} disabled={!outputValue} />

        {/* Clear */}
        <Button
          variant="ghost"
          size="sm"
          onClick={handleClear}
          disabled={input === ''}
          className="gap-1.5"
        >
          <Trash2 className="h-3.5 w-3.5" />
          Clear
        </Button>
      </div>

      {/* ── Tab area ────────────────────────────────────────────────────────── */}
      <Tabs defaultValue="text" className="flex-1 min-h-0 flex flex-col overflow-hidden">
        <div className="shrink-0 border-b border-border px-3 pt-2 bg-background">
          <TabsList variant="line" className="gap-0">
            <TabsTrigger value="text" className="text-xs px-3">
              Text ↔ Base64
            </TabsTrigger>
            <TabsTrigger value="file" className="text-xs px-3">
              File → Data URI
            </TabsTrigger>
          </TabsList>
        </div>

        {/* ── Text tab ──────────────────────────────────────────────────────── */}
        <TabsContent value="text" className="flex-1 min-h-0 overflow-hidden m-0">
          <div className="flex h-full overflow-hidden">
            {/* Input pane */}
            <div className="flex-1 min-w-0 flex flex-col border-r border-border overflow-hidden">
              <div className="shrink-0 px-3 py-1.5 text-xs font-medium text-muted-foreground border-b border-border bg-muted/40">
                {inputLabel}
              </div>
              <div className="flex-1 min-h-0 overflow-hidden">
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  spellCheck={false}
                  placeholder={
                    direction === 'encode'
                      ? 'Type or paste text to encode…'
                      : 'Paste Base64 to decode…'
                  }
                  className={cn(
                    'w-full h-full resize-none p-3 font-mono text-sm',
                    'bg-transparent outline-none',
                    'placeholder:text-muted-foreground text-foreground',
                  )}
                />
              </div>
            </div>

            {/* Output pane */}
            <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
              <div className="shrink-0 px-3 py-1.5 text-xs font-medium text-muted-foreground border-b border-border bg-muted/40">
                {outputLabel}
              </div>
              <div className="flex-1 min-h-0 overflow-hidden">
                {outputError ? (
                  <div className="p-4 text-sm text-destructive space-y-1">
                    <div className="flex items-center gap-1.5 font-medium">
                      <AlertTriangle className="h-4 w-4 shrink-0" />
                      <span>Invalid input</span>
                    </div>
                    <p className="ml-5.5 text-xs font-mono leading-relaxed">{outputError}</p>
                  </div>
                ) : (
                  <textarea
                    value={outputValue}
                    readOnly
                    spellCheck={false}
                    placeholder={
                      input.trim() === ''
                        ? 'Output will appear here…'
                        : 'Processing…'
                    }
                    className={cn(
                      'w-full h-full resize-none p-3 font-mono text-sm',
                      'bg-transparent outline-none',
                      'placeholder:text-muted-foreground text-foreground',
                      'cursor-default select-all',
                    )}
                  />
                )}
              </div>
            </div>
          </div>
        </TabsContent>

        {/* ── File tab ──────────────────────────────────────────────────────── */}
        <TabsContent value="file" className="flex-1 min-h-0 overflow-hidden m-0 flex flex-col">
          <FileTab />
        </TabsContent>
      </Tabs>
    </div>
  )
}
