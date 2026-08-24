/**
 * Hash Generator
 *
 * Features:
 *  - Hash text input live (debounced) with MD5, SHA-1, SHA-256, SHA-384, SHA-512
 *  - File hashing via file picker / drag-and-drop (client-side ArrayBuffer)
 *  - All algorithms shown at once in a results list with individual copy buttons
 *  - Lowercase / uppercase hex toggle
 *  - Base64 output toggle
 *  - Optional HMAC secret key (switches SHA-* to HMAC mode; MD5 excluded)
 *  - File size warning for files > 100 MB
 *  - All settings persisted via Zustand store
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Separator } from '@/components/ui/separator'
import {
  Copy,
  Check,
  Upload,
  FileText,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useHashGeneratorStore } from './store'
import {
  md5,
  sha1,
  sha256,
  sha384,
  sha512,
  hmacSha1,
  hmacSha256,
  hmacSha384,
  hmacSha512,
  encodeUtf8,
  formatDigest,
  formatFileSize,
  ALGORITHMS,
} from './logic'
import type { HashAlgorithmId, HexCase, OutputEncoding } from './logic'

// ── Constants ─────────────────────────────────────────────────────────────────

/** Files larger than this show a warning but are still hashed. */
const FILE_SIZE_WARN_BYTES = 100 * 1024 * 1024 // 100 MB

/** Debounce delay for live typing (ms). */
const DEBOUNCE_MS = 150

// ── Types ─────────────────────────────────────────────────────────────────────

interface DigestRow {
  algorithmId: HashAlgorithmId
  label: string
  /** Formatted digest (hex lower/upper or base64). Empty string while computing. */
  digest: string
  loading: boolean
}

// ── Copy button ───────────────────────────────────────────────────────────────

function CopyButton({ text, size = 'sm' }: { text: string; size?: 'sm' | 'xs' }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(async () => {
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // clipboard access denied — silently ignore
    }
  }, [text])

  if (size === 'xs') {
    return (
      <button
        onClick={handleCopy}
        disabled={!text}
        title="Copy"
        className="p-1 rounded hover:bg-accent transition-colors shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {copied ? (
          <Check className="h-3.5 w-3.5 text-primary" />
        ) : (
          <Copy className="h-3.5 w-3.5 text-muted-foreground" />
        )}
      </button>
    )
  }

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={handleCopy}
      disabled={!text}
      className="gap-1.5 shrink-0"
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      {copied ? 'Copied!' : 'Copy'}
    </Button>
  )
}

// ── Digest row component ──────────────────────────────────────────────────────

function DigestRow({
  row,
  isHmacMode,
}: {
  row: DigestRow
  isHmacMode: boolean
}) {
  const isSkipped = row.algorithmId === 'md5' && isHmacMode

  return (
    <div className="flex items-center gap-3 rounded-lg border border-input bg-muted/20 px-3 py-2.5">
      {/* Algorithm label */}
      <span className="shrink-0 w-16 text-xs font-semibold text-muted-foreground font-mono">
        {row.label}
        {isHmacMode && row.algorithmId !== 'md5' && (
          <span className="text-primary ml-0.5 text-[10px]">HMAC</span>
        )}
      </span>

      <Separator orientation="vertical" className="h-5 shrink-0" />

      {/* Digest value */}
      <div className="flex-1 min-w-0">
        {isSkipped ? (
          <span className="text-xs text-muted-foreground italic">
            HMAC-MD5 not supported
          </span>
        ) : row.loading ? (
          <span className="text-xs text-muted-foreground animate-pulse">Computing…</span>
        ) : row.digest ? (
          <span className="font-mono text-xs break-all text-foreground leading-relaxed">
            {row.digest}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground italic">—</span>
        )}
      </div>

      {/* Copy button */}
      <CopyButton
        text={isSkipped || row.loading ? '' : row.digest}
        size="xs"
      />
    </div>
  )
}

// ── Output format toggles ─────────────────────────────────────────────────────

function TogglePill<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: { value: T; label: string; title?: string }[]
  value: T
  onChange: (v: T) => void
  label: string
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-xs text-muted-foreground shrink-0">{label}</span>
      <div className="flex items-center gap-0.5">
        {options.map((opt) => (
          <button
            key={opt.value}
            onClick={() => onChange(opt.value)}
            title={opt.title}
            aria-pressed={value === opt.value}
            className={cn(
              'h-6 rounded px-2 text-xs font-medium transition-colors',
              value === opt.value
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground',
            )}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  )
}

// ── Hook: compute all digests ─────────────────────────────────────────────────

const EMPTY_ROWS: DigestRow[] = ALGORITHMS.map((a) => ({
  algorithmId: a.id,
  label: a.label,
  digest: '',
  loading: false,
}))

const LOADING_ROWS: DigestRow[] = ALGORITHMS.map((a) => ({
  algorithmId: a.id,
  label: a.label,
  digest: '',
  loading: true,
}))

function useHashDigests(
  bytes: Uint8Array | null,
  hexCase: HexCase,
  outputEncoding: OutputEncoding,
  hmacKeyBytes: Uint8Array | null,
) {
  const [rows, setRows] = useState<DigestRow[]>(EMPTY_ROWS)

  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    // Cancel any in-flight computation
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl

    if (!bytes) {
      // Use a microtask so this setState is not synchronous inside the effect body
      Promise.resolve().then(() => {
        if (!ctrl.signal.aborted) setRows(EMPTY_ROWS)
      })
      return () => { ctrl.abort() }
    }

    // Mark all as loading via microtask to avoid synchronous setState in effect
    Promise.resolve().then(() => {
      if (!ctrl.signal.aborted) setRows(LOADING_ROWS)
    })

    const useHmac = hmacKeyBytes !== null && hmacKeyBytes.length > 0

    // Compute all digests concurrently
    const algoPromises: Promise<void>[] = ALGORITHMS.map(async (algo) => {
      let hexDigest = ''
      try {
        if (algo.id === 'md5') {
          hexDigest = useHmac ? '' : md5(bytes)
        } else if (algo.id === 'sha1') {
          hexDigest = useHmac ? await hmacSha1(hmacKeyBytes!, bytes) : await sha1(bytes)
        } else if (algo.id === 'sha256') {
          hexDigest = useHmac ? await hmacSha256(hmacKeyBytes!, bytes) : await sha256(bytes)
        } else if (algo.id === 'sha384') {
          hexDigest = useHmac ? await hmacSha384(hmacKeyBytes!, bytes) : await sha384(bytes)
        } else {
          hexDigest = useHmac ? await hmacSha512(hmacKeyBytes!, bytes) : await sha512(bytes)
        }
      } catch {
        hexDigest = ''
      }

      if (ctrl.signal.aborted) return

      const formatted = hexDigest ? formatDigest(hexDigest, hexCase, outputEncoding) : ''

      setRows((prev) =>
        prev.map((r) =>
          r.algorithmId === algo.id ? { ...r, digest: formatted, loading: false } : r,
        ),
      )
    })

    // Catch any unhandled promise rejection from the batch
    Promise.all(algoPromises).catch(() => {
      /* individual errors already handled above */
    })

    return () => {
      ctrl.abort()
    }
  }, [bytes, hexCase, outputEncoding, hmacKeyBytes])

  return rows
}

// ── Text hash tab ─────────────────────────────────────────────────────────────

function TextTab({
  hexCase,
  outputEncoding,
  showHmac,
  hmacKey,
  setShowHmac,
  setHmacKey,
}: {
  hexCase: HexCase
  outputEncoding: OutputEncoding
  showHmac: boolean
  hmacKey: string
  setShowHmac: (v: boolean) => void
  setHmacKey: (v: string) => void
}) {
  const { inputText, setInputText } = useHashGeneratorStore()

  // Debounced bytes to avoid hashing on every keystroke
  const [debouncedBytes, setDebouncedBytes] = useState<Uint8Array | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      setDebouncedBytes(inputText.length > 0 ? encodeUtf8(inputText) : null)
    }, DEBOUNCE_MS)
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [inputText])

  // Stable HMAC key bytes — memoized so identity only changes when key/mode changes,
  // preventing spurious re-runs of the digest effect on every keystroke.
  const hmacKeyBytes = useMemo(
    () => (showHmac && hmacKey.length > 0 ? encodeUtf8(hmacKey) : null),
    [showHmac, hmacKey],
  )

  const rows = useHashDigests(debouncedBytes, hexCase, outputEncoding, hmacKeyBytes)

  // Memoized byte count for the "N bytes (UTF-8)" label — avoids re-encoding on every render.
  const inputByteCount = useMemo(
    () => (inputText.length > 0 ? encodeUtf8(inputText).length : 0),
    [inputText],
  )

  return (
    <div className="space-y-4">
      {/* Input */}
      <div className="space-y-2">
        <Label htmlFor="hash-input" className="text-sm font-medium">
          Input text
        </Label>
        <textarea
          id="hash-input"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          placeholder="Type or paste text to hash…"
          rows={4}
          spellCheck={false}
          className={cn(
            'w-full rounded-md border border-input bg-transparent px-3 py-2',
            'text-sm font-mono resize-y',
            'placeholder:text-muted-foreground text-foreground',
            'outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0',
            'dark:bg-input/30',
          )}
        />
        {inputText.length > 0 && (
          <p className="text-xs text-muted-foreground tabular-nums">
            {inputByteCount} bytes (UTF-8)
          </p>
        )}
      </div>

      {/* HMAC section */}
      <div className="border border-input rounded-lg overflow-hidden">
        <button
          onClick={() => setShowHmac(!showHmac)}
          className="w-full flex items-center gap-2 px-4 py-3 text-sm font-medium hover:bg-muted/40 transition-colors text-left"
        >
          {showHmac ? (
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          )}
          HMAC
          <span className="text-xs font-normal text-muted-foreground ml-1">
            — optional secret key for SHA-* algorithms
          </span>
        </button>

        {showHmac && (
          <div className="px-4 pb-4 space-y-2 border-t border-input">
            <div className="space-y-1.5 pt-3">
              <Label htmlFor="hmac-key" className="text-sm font-medium">
                Secret key
              </Label>
              <Input
                id="hmac-key"
                value={hmacKey}
                onChange={(e) => setHmacKey(e.target.value)}
                placeholder="Enter HMAC secret key…"
                className="font-mono text-sm"
                spellCheck={false}
                autoComplete="off"
              />
              <p className="text-xs text-muted-foreground">
                Key is encoded as UTF-8. When set, SHA-* algorithms switch to HMAC mode.
                MD5 does not support HMAC.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Results */}
      {inputText.length > 0 && (
        <div className="space-y-2">
          <Label className="text-sm font-medium">Digests</Label>
          <div className="space-y-1.5">
            {rows.map((row) => (
              <DigestRow
                key={row.algorithmId}
                row={row}
                isHmacMode={showHmac && hmacKey.length > 0}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── File hash tab ─────────────────────────────────────────────────────────────

function FileTab({
  hexCase,
  outputEncoding,
  showHmac,
  hmacKey,
  setShowHmac,
  setHmacKey,
}: {
  hexCase: HexCase
  outputEncoding: OutputEncoding
  showHmac: boolean
  hmacKey: string
  setShowHmac: (v: boolean) => void
  setHmacKey: (v: string) => void
}) {
  const [fileInfo, setFileInfo] = useState<{ name: string; size: number } | null>(null)
  const [fileBytes, setFileBytes] = useState<Uint8Array | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Stable HMAC key bytes — memoized so identity only changes when key/mode changes.
  const hmacKeyBytes = useMemo(
    () => (showHmac && hmacKey.length > 0 ? encodeUtf8(hmacKey) : null),
    [showHmac, hmacKey],
  )

  const rows = useHashDigests(fileBytes, hexCase, outputEncoding, hmacKeyBytes)

  const processFile = useCallback((file: File) => {
    setError(null)
    setFileInfo(null)
    setFileBytes(null)

    const reader = new FileReader()
    reader.onload = (e) => {
      const arrayBuffer = e.target?.result
      if (!(arrayBuffer instanceof ArrayBuffer)) {
        setError('Failed to read file.')
        return
      }
      setFileInfo({ name: file.name, size: file.size })
      setFileBytes(new Uint8Array(arrayBuffer))
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

  return (
    <div className="space-y-4">
      {/* Drop zone */}
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
          <p className="text-xs opacity-70">Any file type — computes MD5, SHA-1, SHA-256, SHA-384, SHA-512</p>
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

      {/* File info */}
      {fileInfo && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <FileText className="h-3.5 w-3.5 shrink-0" />
              <strong className="text-foreground">{fileInfo.name}</strong>
            </span>
            <span>{formatFileSize(fileInfo.size)}</span>
          </div>

          {/* Size warning */}
          {fileInfo.size > FILE_SIZE_WARN_BYTES && (
            <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
              <span>
                Large file ({formatFileSize(fileInfo.size)}). Hashing may take a moment.
              </span>
            </div>
          )}
        </div>
      )}

      {/* HMAC section */}
      <div className="border border-input rounded-lg overflow-hidden">
        <button
          onClick={() => setShowHmac(!showHmac)}
          className="w-full flex items-center gap-2 px-4 py-3 text-sm font-medium hover:bg-muted/40 transition-colors text-left"
        >
          {showHmac ? (
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          )}
          HMAC
          <span className="text-xs font-normal text-muted-foreground ml-1">
            — optional secret key for SHA-* algorithms
          </span>
        </button>

        {showHmac && (
          <div className="px-4 pb-4 space-y-2 border-t border-input">
            <div className="space-y-1.5 pt-3">
              <Label htmlFor="hmac-key-file" className="text-sm font-medium">
                Secret key
              </Label>
              <Input
                id="hmac-key-file"
                value={hmacKey}
                onChange={(e) => setHmacKey(e.target.value)}
                placeholder="Enter HMAC secret key…"
                className="font-mono text-sm"
                spellCheck={false}
                autoComplete="off"
              />
              <p className="text-xs text-muted-foreground">
                Key is encoded as UTF-8. When set, SHA-* algorithms switch to HMAC mode.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Results */}
      {fileBytes && (
        <div className="space-y-2">
          <Label className="text-sm font-medium">Digests</Label>
          <div className="space-y-1.5">
            {rows.map((row) => (
              <DigestRow
                key={row.algorithmId}
                row={row}
                isHmacMode={showHmac && hmacKey.length > 0}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function HashGenerator() {
  const {
    hexCase,
    outputEncoding,
    showHmac,
    hmacKey,
    activeTab,
    setHexCase,
    setOutputEncoding,
    setShowHmac,
    setHmacKey,
    setActiveTab,
  } = useHashGeneratorStore()

  const sharedHmacProps = { showHmac, hmacKey, setShowHmac, setHmacKey }

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 space-y-6">
      {/* ── Toolbar ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3">
        <TogglePill<HexCase>
          label="Case:"
          options={[
            { value: 'lower', label: 'abc', title: 'Lowercase hex output' },
            { value: 'upper', label: 'ABC', title: 'Uppercase hex output' },
          ]}
          value={hexCase}
          onChange={setHexCase}
        />
        <TogglePill<OutputEncoding>
          label="Format:"
          options={[
            { value: 'hex', label: 'Hex', title: 'Output as hexadecimal string' },
            { value: 'base64', label: 'Base64', title: 'Output as Base64 string' },
          ]}
          value={outputEncoding}
          onChange={setOutputEncoding}
        />
      </div>

      {/* ── Tabs ────────────────────────────────────────────────────────────── */}
      <Tabs
        value={activeTab}
        onValueChange={(v) => setActiveTab(v as 'text' | 'file')}
      >
        <TabsList variant="line" className="gap-0">
          <TabsTrigger value="text" className="text-xs px-4">
            Text
          </TabsTrigger>
          <TabsTrigger value="file" className="text-xs px-4">
            File
          </TabsTrigger>
        </TabsList>

        <TabsContent value="text" className="mt-4">
          <TextTab
            hexCase={hexCase}
            outputEncoding={outputEncoding}
            {...sharedHmacProps}
          />
        </TabsContent>

        <TabsContent value="file" className="mt-4">
          <FileTab
            hexCase={hexCase}
            outputEncoding={outputEncoding}
            {...sharedHmacProps}
          />
        </TabsContent>
      </Tabs>
    </div>
  )
}
