/**
 * Cron Expression Parser
 *
 * Features:
 *   – Input for standard 5-field cron expressions + macros
 *   – Plain-English description of the schedule
 *   – Next 10 run times listed with weekday, date, and time
 *   – Per-field breakdown showing raw value + expanded values
 *   – Preset examples dropdown
 *   – Friendly validation errors
 *   – State persisted via Zustand store
 */

import { useDeferredValue, useMemo, useState, useCallback, useRef, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import {
  parseCron,
  nextOccurrences,
  describeCron,
  describeFieldValues,
  CRON_PRESETS,
  FIELD_NAMES,
  FIELD_LABELS,
} from './logic'
import { useCronParserStore } from './store'
import { AlertCircle, ChevronDown, CalendarClock, Clock, Info } from 'lucide-react'

// ── Date formatting ───────────────────────────────────────────────────────────

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MONTHS_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]

function padTwo(n: number): string {
  return String(n).padStart(2, '0')
}

function formatDate(dt: Date): { weekday: string; date: string; time: string } {
  const weekday = WEEKDAYS[dt.getDay()]
  const day = dt.getDate()
  const month = MONTHS_SHORT[dt.getMonth()]
  const year = dt.getFullYear()
  const hour = padTwo(dt.getHours())
  const minute = padTwo(dt.getMinutes())
  return {
    weekday,
    date: `${day} ${month} ${year}`,
    time: `${hour}:${minute}`,
  }
}

// ── FieldBreakdownRow ─────────────────────────────────────────────────────────

function FieldBreakdownRow({
  fieldId,
  info,
}: {
  fieldId: (typeof FIELD_NAMES)[number]
  info: { raw: string; values: number[]; isWildcard: boolean }
}) {
  const label = FIELD_LABELS[fieldId]
  const description = describeFieldValues(fieldId, info)

  return (
    <div className="flex flex-col sm:flex-row sm:items-start gap-1 sm:gap-3 py-2.5 border-b border-input last:border-0">
      <div className="shrink-0 w-32 text-sm font-medium text-muted-foreground">{label}</div>
      <div className="shrink-0 font-mono text-sm text-foreground bg-muted/30 px-2 py-0.5 rounded min-w-[2.5rem] text-center">
        {info.raw}
      </div>
      <div className="text-sm text-muted-foreground flex-1">{description}</div>
    </div>
  )
}

// ── NextRunRow ────────────────────────────────────────────────────────────────

function NextRunRow({ dt, index }: { dt: Date; index: number }) {
  const { weekday, date, time } = formatDate(dt)
  return (
    <div
      className={cn(
        'flex items-center gap-3 px-3 py-2 rounded-lg text-sm',
        index === 0
          ? 'bg-primary/8 border border-primary/20'
          : 'bg-muted/20 border border-transparent',
      )}
    >
      {/* Index badge */}
      <span className="shrink-0 w-5 h-5 flex items-center justify-center rounded-full bg-muted text-muted-foreground text-xs font-bold tabular-nums">
        {index + 1}
      </span>
      {/* Weekday */}
      <span className="shrink-0 w-24 text-muted-foreground">{weekday}</span>
      {/* Date */}
      <span className="flex-1 tabular-nums font-medium">{date}</span>
      {/* Time */}
      <span className="shrink-0 font-mono font-semibold tabular-nums text-primary">
        {time}
      </span>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function CronParser() {
  const { expression, setExpression } = useCronParserStore()

  // Presets dropdown state
  const [presetsOpen, setPresetsOpen] = useState(false)
  const presetsRef = useRef<HTMLDivElement>(null)

  // Close presets on outside click
  useEffect(() => {
    if (!presetsOpen) return
    function handleClick(e: MouseEvent) {
      if (presetsRef.current && !presetsRef.current.contains(e.target as Node)) {
        setPresetsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [presetsOpen])

  // Defer heavy computation until the user pauses typing
  const deferredExpression = useDeferredValue(expression)

  // Parse cron expression
  const parseResult = useMemo(() => parseCron(deferredExpression), [deferredExpression])

  // Compute description
  const description = useMemo(() => {
    if (!parseResult.ok) return null
    return describeCron(parseResult.parsed)
  }, [parseResult])

  // Compute next 10 run times
  const nextRuns = useMemo(() => {
    if (!parseResult.ok) return []
    return nextOccurrences(parseResult.parsed, new Date(), 10)
  }, [parseResult])

  // Re-compute next runs every minute so display stays current
  const [, forceUpdate] = useState(0)
  useEffect(() => {
    const now = Date.now()
    const msUntilNextMinute = 60_000 - (now % 60_000)
    const timeout = setTimeout(() => {
      forceUpdate((n) => n + 1)
    }, msUntilNextMinute)
    return () => clearTimeout(timeout)
  })

  const handlePresetSelect = useCallback(
    (expr: string) => {
      setExpression(expr)
      setPresetsOpen(false)
    },
    [setExpression],
  )

  const isValid = parseResult.ok
  const errorMsg = parseResult.ok ? null : parseResult.error

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 space-y-6">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="space-y-1">
        <h1 className="text-xl font-semibold">Cron Expression Parser</h1>
        <p className="text-sm text-muted-foreground">
          Parse and preview cron schedules — supports{' '}
          <code className="bg-muted px-1 rounded text-xs">* , - /</code> syntax,
          month/day names, and macros like{' '}
          <code className="bg-muted px-1 rounded text-xs">@daily</code>.
        </p>
      </div>

      {/* ── Expression input ────────────────────────────────────────────────── */}
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <Label htmlFor="cron-expression" className="text-sm font-medium">
            Cron Expression
          </Label>

          {/* Presets dropdown */}
          <div className="relative" ref={presetsRef}>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPresetsOpen((o) => !o)}
              className="gap-1.5 text-xs h-7"
            >
              Examples
              <ChevronDown className="h-3.5 w-3.5" />
            </Button>
            {presetsOpen && (
              <div className="absolute right-0 z-50 mt-1 w-72 rounded-lg border border-input bg-popover shadow-md overflow-hidden">
                <div className="max-h-80 overflow-y-auto">
                  {CRON_PRESETS.map((preset) => (
                    <button
                      key={preset.label}
                      onClick={() => handlePresetSelect(preset.expression)}
                      className="w-full px-3 py-2.5 text-left hover:bg-accent transition-colors border-b border-input/50 last:border-0"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium text-foreground">
                          {preset.label}
                        </span>
                        <code className="text-xs font-mono text-muted-foreground shrink-0">
                          {preset.expression}
                        </code>
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {preset.description}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        <Input
          id="cron-expression"
          value={expression}
          onChange={(e) => setExpression(e.target.value)}
          placeholder="*/15 9-17 * * MON-FRI"
          className="font-mono text-base"
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          aria-invalid={!isValid && expression.trim() !== ''}
        />

        {/* Field labels hint */}
        <div className="flex gap-2 text-xs text-muted-foreground font-mono px-0.5 select-none">
          {(['min', 'hour', 'dom', 'mon', 'dow'] as const).map((f) => (
            <span key={f} className="flex-1 text-center">{f}</span>
          ))}
        </div>

        {/* Error */}
        {!isValid && expression.trim() !== '' && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}
      </div>

      {/* ── Description ────────────────────────────────────────────────────── */}
      {isValid && description && (
        <div className="flex items-start gap-3 rounded-lg border border-input bg-muted/20 px-4 py-3">
          <Info className="h-4 w-4 mt-0.5 shrink-0 text-primary" />
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-0.5">
              Schedule
            </p>
            <p className="text-sm font-medium text-foreground">{description}</p>
            {/* Show expanded expression for macros */}
            {parseResult.ok && parseResult.parsed.expression !== expression.trim() && (
              <p className="text-xs text-muted-foreground mt-1 font-mono">
                Expanded: {parseResult.parsed.expression}
              </p>
            )}
          </div>
        </div>
      )}

      {/* ── Per-field breakdown ─────────────────────────────────────────────── */}
      {isValid && parseResult.ok && (
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-muted-foreground" />
            <Label className="text-sm font-medium">Field Breakdown</Label>
          </div>
          <div className="rounded-lg border border-input bg-muted/10 px-4 divide-y-0">
            {FIELD_NAMES.map((fieldId, i) => (
              <FieldBreakdownRow
                key={fieldId}
                fieldId={fieldId}
                info={parseResult.parsed.fields[i]}
              />
            ))}
          </div>
        </div>
      )}

      {/* ── Next run times ──────────────────────────────────────────────────── */}
      {isValid && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <CalendarClock className="h-4 w-4 text-muted-foreground" />
            <Label className="text-sm font-medium">Next 10 Occurrences</Label>
            <span className="text-xs text-muted-foreground">(local time)</span>
          </div>

          {nextRuns.length === 0 ? (
            <div className="rounded-lg border border-input bg-muted/20 px-4 py-6 text-center">
              <p className="text-sm text-muted-foreground">
                No occurrences found within the next 5 years.
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Check your day-of-month value (e.g.{' '}
                <code className="bg-muted px-1 rounded">29 FEB</code> only exists in leap years).
              </p>
            </div>
          ) : (
            <div className="space-y-1.5">
              {nextRuns.map((dt, i) => (
                <NextRunRow key={i} dt={dt} index={i} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Empty state ─────────────────────────────────────────────────────── */}
      {!isValid && expression.trim() === '' && (
        <div className="rounded-lg border border-input bg-muted/20 px-4 py-8 text-center text-sm text-muted-foreground">
          Enter a cron expression above to see the schedule and next run times.
        </div>
      )}
    </div>
  )
}
