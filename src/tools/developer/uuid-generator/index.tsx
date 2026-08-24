/**
 * UUID / ULID Generator
 *
 * Generates UUID v4, UUID v7, ULID, and Nano ID identifiers in bulk.
 * Formatting options for UUIDs: casing and hyphens toggles.
 * Copy individual, copy all, and regenerate buttons.
 * Settings persisted in Zustand store; generated values are transient.
 */

import { useCallback, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { useUuidGeneratorStore } from './store'
import { generateBulk, NANOID_MIN_LENGTH, NANOID_MAX_LENGTH } from './logic'
import type { IdType, UuidFormatOptions } from './logic'
import { Copy, RefreshCw, ClipboardList } from 'lucide-react'
import { cn } from '@/lib/utils'

// ── Type selector ─────────────────────────────────────────────────────────────

const ID_TYPES: { value: IdType; label: string; description: string }[] = [
  {
    value: 'uuidv4',
    label: 'UUID v4',
    description: 'Random (RFC 9562 §5.4)',
  },
  {
    value: 'uuidv7',
    label: 'UUID v7',
    description: 'Timestamp-ordered (RFC 9562 §5.7)',
  },
  {
    value: 'ulid',
    label: 'ULID',
    description: '26-char Crockford base32',
  },
  {
    value: 'nanoid',
    label: 'Nano ID',
    description: 'URL-safe, configurable length',
  },
]

// ── Copy button with flash feedback ──────────────────────────────────────────

function CopyButton({
  text,
  disabled,
  label = 'Copy',
  size = 'sm',
}: {
  text: string
  disabled?: boolean
  label?: string
  size?: 'sm' | 'xs'
}) {
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(async () => {
    if (!text) return
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }, [text])

  return (
    <Button
      variant="outline"
      size={size}
      onClick={handleCopy}
      disabled={disabled || !text}
      className="gap-1.5 shrink-0"
    >
      <Copy className="h-3.5 w-3.5" />
      {copied ? 'Copied!' : label}
    </Button>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function UuidGenerator() {
  const {
    idType,
    count,
    casing,
    hyphens,
    nanoIdLength,
    setIdType,
    setCount,
    setCasing,
    setHyphens,
    setNanoIdLength,
  } = useUuidGeneratorStore()

  const [ids, setIds] = useState<string[]>([])

  const generate = useCallback(() => {
    const opts: UuidFormatOptions = { casing, hyphens }
    const results = generateBulk(idType, count, opts, nanoIdLength)
    setIds(results)
  }, [idType, count, casing, hyphens, nanoIdLength])

  const allText = ids.join('\n')

  // Whether UUID formatting options are relevant for the current type
  const showUuidOptions = idType === 'uuidv4' || idType === 'uuidv7'
  const showNanoIdOptions = idType === 'nanoid'

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 space-y-6">
      {/* ── ID Type selector ──────────────────────────────────────────────── */}
      <div className="space-y-2">
        <Label className="text-sm font-medium">Type</Label>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {ID_TYPES.map((t) => (
            <button
              key={t.value}
              onClick={() => setIdType(t.value)}
              aria-pressed={idType === t.value}
              className={cn(
                'flex flex-col items-start rounded-lg border px-3 py-2.5 text-left transition-colors',
                idType === t.value
                  ? 'border-primary bg-primary/5 text-primary'
                  : 'border-input bg-background text-foreground hover:border-primary/50 hover:bg-muted/40',
              )}
            >
              <span className="text-sm font-semibold">{t.label}</span>
              <span
                className={cn(
                  'text-xs mt-0.5',
                  idType === t.value ? 'text-primary/70' : 'text-muted-foreground',
                )}
              >
                {t.description}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* ── Options row ───────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-end gap-4">
        {/* Count */}
        <div className="space-y-1.5">
          <Label htmlFor="count-input" className="text-sm font-medium">
            Count
          </Label>
          <Input
            id="count-input"
            type="number"
            min={1}
            max={1000}
            value={count}
            onChange={(e) => {
              const v = parseInt(e.target.value, 10)
              if (!isNaN(v)) setCount(Math.max(1, Math.min(1000, v)))
            }}
            className="w-24"
          />
          <p className="text-xs text-muted-foreground">1–1000</p>
        </div>

        {/* UUID formatting options */}
        {showUuidOptions && (
          <>
            <Separator orientation="vertical" className="h-16 shrink-0 hidden sm:block" />

            {/* Casing */}
            <div className="space-y-1.5">
              <Label className="text-sm font-medium">Casing</Label>
              <div className="flex items-center gap-1">
                {(['lower', 'upper'] as const).map((c) => (
                  <button
                    key={c}
                    onClick={() => setCasing(c)}
                    aria-pressed={casing === c}
                    className={cn(
                      'h-8 rounded px-2.5 text-xs font-medium transition-colors',
                      casing === c
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                    )}
                  >
                    {c === 'lower' ? 'lowercase' : 'UPPERCASE'}
                  </button>
                ))}
              </div>
            </div>

            {/* Hyphens */}
            <div className="space-y-1.5">
              <Label className="text-sm font-medium">Hyphens</Label>
              <div className="flex items-center gap-1">
                {[
                  { value: true, label: 'With' },
                  { value: false, label: 'Without' },
                ].map(({ value, label }) => (
                  <button
                    key={String(value)}
                    onClick={() => setHyphens(value)}
                    aria-pressed={hyphens === value}
                    className={cn(
                      'h-8 rounded px-2.5 text-xs font-medium transition-colors',
                      hyphens === value
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}

        {/* Nano ID length */}
        {showNanoIdOptions && (
          <>
            <Separator orientation="vertical" className="h-16 shrink-0 hidden sm:block" />
            <div className="space-y-1.5">
              <Label htmlFor="nanoid-length" className="text-sm font-medium">
                Length
              </Label>
              <Input
                id="nanoid-length"
                type="number"
                min={NANOID_MIN_LENGTH}
                max={NANOID_MAX_LENGTH}
                value={nanoIdLength}
                onChange={(e) => {
                  const v = parseInt(e.target.value, 10)
                  if (!isNaN(v))
                    setNanoIdLength(Math.max(NANOID_MIN_LENGTH, Math.min(NANOID_MAX_LENGTH, v)))
                }}
                className="w-24"
              />
              <p className="text-xs text-muted-foreground">
                {NANOID_MIN_LENGTH}–{NANOID_MAX_LENGTH}
              </p>
            </div>
          </>
        )}
      </div>

      {/* ── Generate / actions row ─────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={generate} className="gap-1.5">
          <RefreshCw className="h-4 w-4" />
          Generate
        </Button>

        {ids.length > 0 && (
          <>
            <CopyButton text={allText} label={`Copy all (${ids.length})`} />
          </>
        )}
      </div>

      {/* ── Results ───────────────────────────────────────────────────────── */}
      {ids.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-muted-foreground">
              {ids.length} {ids.length === 1 ? 'result' : 'results'}
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={generate}
              className="gap-1.5 text-xs"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Regenerate
            </Button>
          </div>

          {ids.length === 1 ? (
            /* Single result — inline display with copy button */
            <div className="flex items-center gap-2 rounded-lg border border-input bg-muted/30 px-3 py-2.5">
              <span className="flex-1 font-mono text-sm break-all text-foreground">
                {ids[0]}
              </span>
              <CopyButton text={ids[0]} />
            </div>
          ) : (
            /* Multiple results — list with per-row copy */
            <div className="rounded-lg border border-input bg-muted/30 overflow-hidden">
              {/* Header */}
              <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-border bg-muted/40">
                <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <ClipboardList className="h-3.5 w-3.5" />
                  Generated IDs
                </span>
                <CopyButton
                  text={allText}
                  label={`Copy all`}
                  size="xs"
                />
              </div>
              {/* Rows */}
              <ul className="divide-y divide-border max-h-96 overflow-y-auto">
                {ids.map((id, i) => (
                  <li
                    key={i}
                    className="flex items-center gap-2 px-3 py-1.5 hover:bg-muted/30 group"
                  >
                    <span className="w-6 shrink-0 text-right text-xs text-muted-foreground/60 tabular-nums">
                      {i + 1}
                    </span>
                    <span className="flex-1 font-mono text-xs break-all text-foreground">
                      {id}
                    </span>
                    <button
                      onClick={async () => {
                        await navigator.clipboard.writeText(id)
                      }}
                      title="Copy"
                      className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0 p-1 rounded hover:bg-accent"
                    >
                      <Copy className="h-3 w-3 text-muted-foreground" />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
