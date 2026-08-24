/**
 * Unix Timestamp Converter
 *
 * Features:
 *   – Live "current timestamp" ticker (seconds + ms) with copy buttons
 *   – Timestamp → date: auto-detects seconds/millis/micros with manual override
 *   – Shows local time, UTC, ISO 8601, and relative time
 *   – World clocks: UTC, New York, London, Tokyo + user's local zone
 *   – Date → timestamp: datetime-local input → epoch seconds + milliseconds
 *   – Handles negative timestamps (pre-1970) and friendly error messages
 *   – State persisted via Zustand store (su:timestamp-converter)
 */

import { useState, useEffect, useCallback, useDeferredValue, useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import {
  detectUnit,
  parseTimestamp,
  formatRelative,
  formatLocalFull,
  formatUtcFull,
  formatIso8601,
  toEpochSeconds,
  toEpochMillis,
  getTimezoneDisplays,
} from './logic'
import type { TimestampUnit } from './logic'
import { useTimestampConverterStore } from './store'
import { AlertCircle, Copy, Check, Clock, Globe, ArrowRight } from 'lucide-react'

// ── useCopyToClipboard ────────────────────────────────────────────────────────

function useCopyToClipboard(timeoutMs = 1500) {
  const [copiedKey, setCopiedKey] = useState<string | null>(null)

  const copy = useCallback(
    (text: string, key: string) => {
      if (!navigator.clipboard) return
      navigator.clipboard.writeText(text).then(
        () => {
          setCopiedKey(key)
          setTimeout(() => setCopiedKey((k) => (k === key ? null : k)), timeoutMs)
        },
        () => { /* clipboard access denied — silently ignore */ },
      )
    },
    [timeoutMs],
  )

  return { copiedKey, copy }
}

// ── CopyButton ────────────────────────────────────────────────────────────────

function CopyButton({
  text,
  copyKey,
  copiedKey,
  onCopy,
  size = 'sm',
}: {
  text: string
  copyKey: string
  copiedKey: string | null
  onCopy: (text: string, key: string) => void
  size?: 'sm' | 'xs'
}) {
  const isCopied = copiedKey === copyKey
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => onCopy(text, copyKey)}
      className={cn(
        'h-7 w-7 p-0 shrink-0',
        size === 'xs' && 'h-6 w-6',
        isCopied && 'text-green-600 dark:text-green-400',
      )}
      title={isCopied ? 'Copied!' : `Copy ${text}`}
      aria-label={isCopied ? 'Copied' : 'Copy to clipboard'}
    >
      {isCopied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
    </Button>
  )
}

// ── ResultRow ─────────────────────────────────────────────────────────────────

function ResultRow({
  label,
  value,
  mono = false,
  copyKey,
  copiedKey,
  onCopy,
}: {
  label: string
  value: string
  mono?: boolean
  copyKey: string
  copiedKey: string | null
  onCopy: (text: string, key: string) => void
}) {
  return (
    <div className="flex items-start justify-between gap-3 py-2.5 border-b border-input last:border-0">
      <span className="shrink-0 w-28 text-xs font-medium text-muted-foreground pt-0.5">
        {label}
      </span>
      <span
        className={cn(
          'flex-1 text-sm break-all text-foreground',
          mono && 'font-mono',
        )}
      >
        {value}
      </span>
      <CopyButton
        text={value}
        copyKey={copyKey}
        copiedKey={copiedKey}
        onCopy={onCopy}
        size="xs"
      />
    </div>
  )
}

// ── UNIT_LABELS ───────────────────────────────────────────────────────────────

const UNIT_LABELS: Record<TimestampUnit, string> = {
  seconds: 'Seconds',
  millis: 'Milliseconds',
  micros: 'Microseconds',
}

// ── Main component ────────────────────────────────────────────────────────────

export default function TimestampConverter() {
  const {
    timestampInput,
    setTimestampInput,
    unitOverride,
    setUnitOverride,
    unitLocked,
    setUnitLocked,
    dateInput,
    setDateInput,
  } = useTimestampConverterStore()

  // Live clock state
  const [now, setNow] = useState(() => new Date())

  // Tick every second
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])

  const { copiedKey, copy } = useCopyToClipboard()

  // ── Timestamp → Date ───────────────────────────────────────────────────────

  const deferredInput = useDeferredValue(timestampInput)

  // Auto-detect unit from current input
  const detectedUnit = useMemo<TimestampUnit>(() => {
    const trimmed = deferredInput.trim()
    if (!trimmed || !/^-?\d+(\.\d+)?$/.test(trimmed)) return 'seconds'
    const n = parseFloat(trimmed)
    if (!isFinite(n)) return 'seconds'
    return detectUnit(n)
  }, [deferredInput])

  // The effective unit: locked override or auto-detected
  const effectiveUnit: TimestampUnit = unitLocked ? unitOverride : detectedUnit

  // Parse result
  const parseResult = useMemo(
    () => parseTimestamp(deferredInput, effectiveUnit),
    [deferredInput, effectiveUnit],
  )

  const parsedDate = parseResult.ok ? parseResult.parsed.date : null

  // World clocks
  const worldClocks = useMemo(
    () => (parsedDate ? getTimezoneDisplays(parsedDate) : []),
    [parsedDate],
  )

  // Relative time (based on live now)
  const relativeTime = useMemo(
    () => (parsedDate ? formatRelative(parsedDate, now) : null),
    [parsedDate, now],
  )

  // ── Date → Timestamp ───────────────────────────────────────────────────────

  const deferredDateInput = useDeferredValue(dateInput)

  const dateToTs = useMemo<{
    seconds: string
    millis: string
    error: string | null
  }>(() => {
    if (!deferredDateInput) return { seconds: '', millis: '', error: null }
    // datetime-local gives us "YYYY-MM-DDTHH:mm" — we interpret this as local time
    const d = new Date(deferredDateInput)
    if (isNaN(d.getTime())) {
      return { seconds: '', millis: '', error: 'Invalid date — please select a valid date/time.' }
    }
    return {
      seconds: String(toEpochSeconds(d)),
      millis: String(toEpochMillis(d)),
      error: null,
    }
  }, [deferredDateInput])

  // ── Unit toggle handler ────────────────────────────────────────────────────

  const handleUnitClick = useCallback(
    (unit: TimestampUnit) => {
      if (unitLocked && unitOverride === unit) {
        // Clicking the currently-locked unit unlocks (back to auto)
        setUnitLocked(false)
      } else {
        setUnitOverride(unit)
        setUnitLocked(true)
      }
    },
    [unitLocked, unitOverride, setUnitOverride, setUnitLocked],
  )

  // ── Render ─────────────────────────────────────────────────────────────────

  const nowSeconds = String(toEpochSeconds(now))
  const nowMillis  = String(toEpochMillis(now))

  const tsHasInput = timestampInput.trim() !== ''
  const showTsError = tsHasInput && !parseResult.ok
  const showTsResult = tsHasInput && parseResult.ok

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 space-y-8">

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="space-y-1">
        <h1 className="text-xl font-semibold">Unix Timestamp Converter</h1>
        <p className="text-sm text-muted-foreground">
          Convert Unix timestamps to dates and back. Auto-detects seconds, milliseconds,
          and microseconds.
        </p>
      </div>

      {/* ── Live clock ──────────────────────────────────────────────────────── */}
      <div className="rounded-lg border border-input bg-muted/20 px-4 py-3 space-y-2">
        <div className="flex items-center gap-2">
          <Clock className="h-4 w-4 text-muted-foreground shrink-0" />
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Current Unix Timestamp
          </span>
        </div>
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-muted-foreground w-20 shrink-0">Seconds</span>
            <span className="font-mono text-lg font-semibold tabular-nums text-primary flex-1">
              {nowSeconds}
            </span>
            <CopyButton
              text={nowSeconds}
              copyKey="live-seconds"
              copiedKey={copiedKey}
              onCopy={copy}
            />
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-muted-foreground w-20 shrink-0">Milliseconds</span>
            <span className="font-mono text-sm tabular-nums text-foreground flex-1">
              {nowMillis}
            </span>
            <CopyButton
              text={nowMillis}
              copyKey="live-millis"
              copiedKey={copiedKey}
              onCopy={copy}
            />
          </div>
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════════════════
          Section 1: Timestamp → Date
      ══════════════════════════════════════════════════════════════════════ */}
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0" />
          <h2 className="text-sm font-semibold">Timestamp → Date</h2>
        </div>

        {/* Input */}
        <div className="space-y-2">
          <Label htmlFor="ts-input" className="text-sm font-medium">
            Unix Timestamp
          </Label>
          <Input
            id="ts-input"
            value={timestampInput}
            onChange={(e) => setTimestampInput(e.target.value)}
            placeholder="e.g. 1700000000"
            className="font-mono text-base"
            spellCheck={false}
            inputMode="numeric"
            aria-invalid={showTsError}
          />
        </div>

        {/* Unit selector */}
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground">Unit:</span>
            {(['seconds', 'millis', 'micros'] as TimestampUnit[]).map((unit) => {
              const isEffective = effectiveUnit === unit
              const isAutoDetected = !unitLocked && detectedUnit === unit
              return (
                <button
                  key={unit}
                  type="button"
                  onClick={() => handleUnitClick(unit)}
                  className={cn(
                    'px-2.5 py-0.5 rounded text-xs font-medium transition-colors border',
                    isEffective
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-transparent text-muted-foreground border-input hover:bg-accent hover:text-accent-foreground',
                  )}
                  title={
                    isEffective && !unitLocked
                      ? `Auto-detected as ${UNIT_LABELS[unit]} — click to lock`
                      : isEffective && unitLocked
                        ? `Locked to ${UNIT_LABELS[unit]} — click to unlock`
                        : `Switch to ${UNIT_LABELS[unit]}`
                  }
                >
                  {UNIT_LABELS[unit]}
                  {isAutoDetected && (
                    <span className="ml-1 opacity-60 text-[10px]">(auto)</span>
                  )}
                </button>
              )
            })}
          </div>
          {unitLocked && (
            <p className="text-xs text-muted-foreground">
              Unit locked to <strong>{UNIT_LABELS[unitOverride]}</strong>.{' '}
              <button
                type="button"
                className="underline hover:no-underline"
                onClick={() => setUnitLocked(false)}
              >
                Reset to auto
              </button>
            </p>
          )}
        </div>

        {/* Error */}
        {showTsError && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
            <span>{(parseResult as { ok: false; error: string }).error}</span>
          </div>
        )}

        {/* Results */}
        {showTsResult && parsedDate && (
          <div className="rounded-lg border border-input bg-muted/10">
            <div className="px-4 divide-y-0">
              <ResultRow
                label="Local"
                value={formatLocalFull(parsedDate)}
                copyKey="local"
                copiedKey={copiedKey}
                onCopy={copy}
              />
              <ResultRow
                label="UTC"
                value={formatUtcFull(parsedDate)}
                mono
                copyKey="utc"
                copiedKey={copiedKey}
                onCopy={copy}
              />
              <ResultRow
                label="ISO 8601"
                value={formatIso8601(parsedDate)}
                mono
                copyKey="iso"
                copiedKey={copiedKey}
                onCopy={copy}
              />
              <ResultRow
                label="Relative"
                value={relativeTime ?? ''}
                copyKey="relative"
                copiedKey={copiedKey}
                onCopy={copy}
              />
            </div>
          </div>
        )}

        {/* World clocks */}
        {showTsResult && parsedDate && worldClocks.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Globe className="h-4 w-4 text-muted-foreground shrink-0" />
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                World Clocks
              </span>
            </div>
            <div className="rounded-lg border border-input bg-muted/10">
              <div className="px-4 divide-y-0">
                {worldClocks.map((tz) => (
                  <ResultRow
                    key={tz.tz}
                    label={tz.label}
                    value={tz.formatted}
                    copyKey={`tz-${tz.tz}`}
                    copiedKey={copiedKey}
                    onCopy={copy}
                  />
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Empty state */}
        {!tsHasInput && (
          <div className="rounded-lg border border-input bg-muted/20 px-4 py-6 text-center text-sm text-muted-foreground">
            Enter a Unix timestamp above to convert it to a date.
          </div>
        )}
      </div>

      {/* ══════════════════════════════════════════════════════════════════════
          Section 2: Date → Timestamp
      ══════════════════════════════════════════════════════════════════════ */}
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0 rotate-180" />
          <h2 className="text-sm font-semibold">Date → Timestamp</h2>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="date-input" className="text-sm font-medium">
              Date &amp; Time
            </Label>
            <span className="text-xs text-muted-foreground">Interpreted as your local timezone</span>
          </div>
          <Input
            id="date-input"
            type="datetime-local"
            value={dateInput}
            onChange={(e) => setDateInput(e.target.value)}
            className="font-mono"
            aria-invalid={!!dateToTs.error}
          />
        </div>

        {dateToTs.error && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
            <span>{dateToTs.error}</span>
          </div>
        )}

        {dateInput && !dateToTs.error && (
          <div className="rounded-lg border border-input bg-muted/10">
            <div className="px-4 divide-y-0">
              <ResultRow
                label="Seconds"
                value={dateToTs.seconds}
                mono
                copyKey="d2ts-seconds"
                copiedKey={copiedKey}
                onCopy={copy}
              />
              <ResultRow
                label="Milliseconds"
                value={dateToTs.millis}
                mono
                copyKey="d2ts-millis"
                copiedKey={copiedKey}
                onCopy={copy}
              />
            </div>
          </div>
        )}

        {!dateInput && (
          <div className="rounded-lg border border-input bg-muted/20 px-4 py-6 text-center text-sm text-muted-foreground">
            Select a date and time above to get its Unix timestamp.
          </div>
        )}
      </div>
    </div>
  )
}
