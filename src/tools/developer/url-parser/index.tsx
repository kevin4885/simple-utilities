/**
 * URL Parser / Encoder
 *
 * Features:
 *   – Paste a URL and see all its parts (protocol, auth, host, port, path,
 *     query string, fragment) with per-part copy buttons
 *   – Editable query-params table: edit values, add/delete rows; reconstructed
 *     URL updates live; copy the full reconstructed URL
 *   – Encode / Decode section: encodeURIComponent, decodeURIComponent,
 *     encodeURI, decodeURI with clear URIError messages
 *   – State persisted via Zustand store
 */

import {
  useDeferredValue,
  useMemo,
  useState,
  useCallback,
} from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import {
  parseUrl,
  paramsToRows,
  rowsToSearchString,
  rebuildUrl,
  applyEncodeDecodeMode,
} from './logic'
import type { ParsedUrl, ParamRow, EncodeDecodeMode } from './logic'
import { useUrlParserStore } from './store'
import {
  AlertCircle,
  Check,
  Copy,
  Info,
  Plus,
  Trash2,
} from 'lucide-react'

// ── CopyButton ────────────────────────────────────────────────────────────────

function CopyButton({
  text,
  className,
}: {
  text: string
  className?: string
}) {
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
  return (
    <button
      onClick={handleCopy}
      title="Copy"
      className={cn(
        'p-1 rounded hover:bg-accent transition-colors shrink-0',
        className,
      )}
    >
      {copied ? (
        <Check className="h-3.5 w-3.5 text-primary" />
      ) : (
        <Copy className="h-3.5 w-3.5 text-muted-foreground" />
      )}
    </button>
  )
}

// ── PartRow ───────────────────────────────────────────────────────────────────

function PartRow({
  label,
  value,
  mono,
}: {
  label: string
  value: string
  mono?: boolean
}) {
  if (!value) return null
  return (
    <div className="flex items-start gap-3 py-2 border-b border-input last:border-0">
      <span className="shrink-0 w-24 text-xs font-medium text-muted-foreground pt-0.5">
        {label}
      </span>
      <span
        className={cn(
          'flex-1 text-sm break-all text-foreground min-w-0',
          mono && 'font-mono',
        )}
      >
        {value}
      </span>
      <CopyButton text={value} />
    </div>
  )
}

// ── ParamsTable ───────────────────────────────────────────────────────────────

function ParamsTable({
  rows,
  onChange,
}: {
  rows: ParamRow[]
  onChange: (rows: ParamRow[]) => void
}) {
  const handleKeyChange = useCallback(
    (id: string, key: string) => {
      onChange(rows.map((r) => (r.id === id ? { ...r, key } : r)))
    },
    [rows, onChange],
  )

  const handleValueChange = useCallback(
    (id: string, value: string) => {
      onChange(rows.map((r) => (r.id === id ? { ...r, value } : r)))
    },
    [rows, onChange],
  )

  const handleDelete = useCallback(
    (id: string) => {
      onChange(rows.filter((r) => r.id !== id))
    },
    [rows, onChange],
  )

  const handleAdd = useCallback(() => {
    const newRow: ParamRow = {
      id: crypto.randomUUID(),
      key: '',
      value: '',
    }
    onChange([...rows, newRow])
  }, [rows, onChange])

  return (
    <div className="space-y-2">
      {/* Header */}
      <div className="grid grid-cols-[1fr_1fr_auto] gap-2 px-1">
        <span className="text-xs font-medium text-muted-foreground">Key</span>
        <span className="text-xs font-medium text-muted-foreground">Value</span>
        <span className="w-7" />
      </div>

      {/* Rows */}
      {rows.map((row) => (
        <div key={row.id} className="grid grid-cols-[1fr_1fr_auto] gap-2 items-center">
          <Input
            value={row.key}
            onChange={(e) => handleKeyChange(row.id, e.target.value)}
            placeholder="key"
            className="font-mono text-sm h-8"
            spellCheck={false}
            aria-label="Parameter key"
          />
          <Input
            value={row.value}
            onChange={(e) => handleValueChange(row.id, e.target.value)}
            placeholder="value"
            className="font-mono text-sm h-8"
            spellCheck={false}
            aria-label="Parameter value"
          />
          <button
            onClick={() => handleDelete(row.id)}
            title="Delete row"
            className="h-8 w-7 flex items-center justify-center rounded hover:bg-destructive/10 hover:text-destructive transition-colors text-muted-foreground"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}

      {/* Empty state */}
      {rows.length === 0 && (
        <p className="text-xs text-muted-foreground px-1 py-1">
          No query parameters. Click + to add one.
        </p>
      )}

      {/* Add row */}
      <Button
        variant="outline"
        size="sm"
        className="h-7 text-xs gap-1.5"
        onClick={handleAdd}
      >
        <Plus className="h-3.5 w-3.5" />
        Add parameter
      </Button>
    </div>
  )
}

// ── Mode selector ─────────────────────────────────────────────────────────────

const ENCODE_MODES: { value: EncodeDecodeMode; label: string; description: string }[] = [
  {
    value: 'encodeURIComponent',
    label: 'encodeURIComponent',
    description: 'Encodes all chars except A–Z a–z 0–9 - _ . ! ~ * \' ( )',
  },
  {
    value: 'decodeURIComponent',
    label: 'decodeURIComponent',
    description: 'Decodes all percent-encoded sequences',
  },
  {
    value: 'encodeURI',
    label: 'encodeURI',
    description: 'Encodes all chars except valid URI chars (: / ? # etc. preserved)',
  },
  {
    value: 'decodeURI',
    label: 'decodeURI',
    description: 'Decodes percent-encoded sequences; leaves reserved URI chars alone',
  },
]

// ── Main component ────────────────────────────────────────────────────────────

export default function UrlParser() {
  const { urlInput, encodeInput, encodeMode, setUrlInput, setEncodeInput, setEncodeMode } =
    useUrlParserStore()

  // Separate local state for query rows (not persisted — derived from URL)
  const [localRows, setLocalRows] = useState<ParamRow[] | null>(null)

  // Defer URL parsing to avoid lag on every keystroke
  const deferredUrlInput = useDeferredValue(urlInput)

  // Parse the URL
  const parseResult = useMemo(() => parseUrl(deferredUrlInput), [deferredUrlInput])

  // Rows to display: prefer local edits, otherwise derive from parsed URL
  const rows = useMemo<ParamRow[]>(() => {
    if (localRows !== null) return localRows
    if (!parseResult.ok) return []
    return paramsToRows(parseResult.parsed.search)
  }, [localRows, parseResult])

  // Reconstructed URL (live)
  const reconstructedUrl = useMemo<string>(() => {
    if (!parseResult.ok) return ''
    return rebuildUrl(parseResult.parsed, rows)
  }, [parseResult, rows])

  // Handle URL input change: clear local row edits so rows re-derive from new parse
  const handleUrlInputChange = useCallback(
    (value: string) => {
      setUrlInput(value)
      setLocalRows(null) // reset row edits when URL text changes
    },
    [setUrlInput],
  )

  // Handle row edits from the table
  const handleRowsChange = useCallback((newRows: ParamRow[]) => {
    setLocalRows(newRows)
  }, [])

  // Encode/decode section
  const deferredEncodeInput = useDeferredValue(encodeInput)
  const encodeResult = useMemo(
    () =>
      deferredEncodeInput
        ? applyEncodeDecodeMode(deferredEncodeInput, encodeMode)
        : null,
    [deferredEncodeInput, encodeMode],
  )

  // Computed URL parts for display
  const parsed: ParsedUrl | null = parseResult.ok ? parseResult.parsed : null
  const isValid = parseResult.ok
  const isInputEmpty = deferredUrlInput.trim() === ''
  const errorMsg = parseResult.ok ? null : parseResult.error

  // Query string: show as derived from rows (live) or from parsed URL
  const liveQueryString = useMemo(() => {
    if (!isValid || !parsed) return ''
    const qs = rowsToSearchString(rows)
    return qs ? `?${qs}` : ''
  }, [isValid, parsed, rows])

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 space-y-8">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="space-y-1">
        <h1 className="text-xl font-semibold">URL Parser / Encoder</h1>
        <p className="text-sm text-muted-foreground">
          Inspect every part of a URL, edit query parameters live, or
          encode/decode individual values.
        </p>
      </div>

      {/* ── URL Input ──────────────────────────────────────────────────────── */}
      <div className="space-y-2">
        <Label htmlFor="url-input" className="text-sm font-medium">
          URL
        </Label>
        <Input
          id="url-input"
          value={urlInput}
          onChange={(e) => handleUrlInputChange(e.target.value)}
          placeholder="https://example.com/path?q=hello#section"
          className="font-mono text-sm"
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          aria-invalid={!isInputEmpty && !isValid}
        />

        {/* Added-protocol note */}
        {isValid && parseResult.addedProtocol && (
          <div className="flex items-start gap-2 rounded-md border border-input bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
            <Info className="h-3.5 w-3.5 mt-0.5 shrink-0 text-primary" />
            <span>
              No protocol detected — assumed{' '}
              <code className="bg-muted px-1 rounded">https://</code>
            </span>
          </div>
        )}

        {/* Validation error */}
        {!isValid && !isInputEmpty && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}
      </div>

      {/* ── URL Parts ──────────────────────────────────────────────────────── */}
      {isValid && parsed && (
        <div className="space-y-2">
          <Label className="text-sm font-medium">URL Parts</Label>
          <div className="rounded-lg border border-input bg-muted/10 px-4 divide-y-0">
            <PartRow label="Protocol" value={parsed.protocol} mono />
            {parsed.username && (
              <PartRow label="Username" value={parsed.username} mono />
            )}
            {parsed.password && (
              <PartRow label="Password" value={parsed.password} mono />
            )}
            <PartRow label="Host" value={parsed.host} mono />
            {parsed.hostname !== parsed.host && (
              <PartRow label="Hostname" value={parsed.hostname} mono />
            )}
            {parsed.port && <PartRow label="Port" value={parsed.port} mono />}
            <PartRow label="Path" value={parsed.pathname} mono />
            {liveQueryString && (
              <PartRow label="Query" value={liveQueryString} mono />
            )}
            {parsed.hash && <PartRow label="Fragment" value={parsed.hash} mono />}
          </div>
        </div>
      )}

      {/* ── Query Params Table ─────────────────────────────────────────────── */}
      {isValid && parsed && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label className="text-sm font-medium">Query Parameters</Label>
          </div>

          <ParamsTable rows={rows} onChange={handleRowsChange} />

          {/* Reconstructed URL */}
          {reconstructedUrl && (
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">
                Reconstructed URL
              </Label>
              <div className="relative">
                <div className="rounded-md border border-input bg-muted/20 px-3 py-2.5 pr-9 font-mono text-sm break-all min-h-[2.5rem] text-foreground">
                  {reconstructedUrl}
                </div>
                <div className="absolute top-2 right-2">
                  <CopyButton text={reconstructedUrl} />
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Empty state ─────────────────────────────────────────────────────── */}
      {isInputEmpty && (
        <div className="rounded-lg border border-input bg-muted/20 px-4 py-8 text-center text-sm text-muted-foreground">
          Paste a URL above to inspect its parts and edit query parameters.
        </div>
      )}

      {/* ── Encode / Decode ────────────────────────────────────────────────── */}
      <div className="space-y-3 rounded-lg border border-input p-4">
        <div>
          <Label className="text-sm font-medium">Encode / Decode</Label>
          <p className="text-xs text-muted-foreground mt-0.5">
            Convert individual values or strings using browser-native functions.
          </p>
        </div>

        {/* Mode selector */}
        <div className="flex flex-wrap gap-2">
          {ENCODE_MODES.map((m) => (
            <button
              key={m.value}
              onClick={() => setEncodeMode(m.value)}
              title={m.description}
              aria-pressed={encodeMode === m.value}
              className={cn(
                'px-2.5 py-1 rounded text-xs font-mono font-medium transition-colors',
                encodeMode === m.value
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground',
              )}
            >
              {m.label}
            </button>
          ))}
        </div>

        {/* Description of selected mode */}
        <p className="text-xs text-muted-foreground">
          {ENCODE_MODES.find((m) => m.value === encodeMode)?.description}
        </p>

        {/* Input */}
        <div className="space-y-1.5">
          <Label htmlFor="encode-input" className="text-xs font-medium">
            Input
          </Label>
          <Textarea
            id="encode-input"
            value={encodeInput}
            onChange={(e) => setEncodeInput(e.target.value)}
            placeholder="Enter text to encode or decode…"
            rows={3}
            className="font-mono text-sm resize-y"
            spellCheck={false}
          />
        </div>

        {/* Output */}
        {encodeInput && (
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Output</Label>
            {encodeResult && encodeResult.ok ? (
              <div className="relative">
                <div className="rounded-md border border-input bg-muted/20 px-3 py-2.5 pr-9 font-mono text-sm break-all whitespace-pre-wrap min-h-[2.5rem] text-foreground">
                  {encodeResult.output || (
                    <span className="text-muted-foreground italic text-xs">empty string</span>
                  )}
                </div>
                <div className="absolute top-2 right-2">
                  <CopyButton text={encodeResult.output} />
                </div>
              </div>
            ) : encodeResult && !encodeResult.ok ? (
              <div className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>{encodeResult.error}</span>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  )
}
