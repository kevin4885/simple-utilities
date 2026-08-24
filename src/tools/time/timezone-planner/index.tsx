/**
 * Timezone Meeting Planner
 *
 * Features:
 *   – Add locations/timezones from a searchable list (Intl.supportedValuesOf with fallback)
 *   – User's local zone added by default and labelled "(you)"
 *   – 24-hour strip per timezone for a selected date (date picker, defaults today)
 *   – Rows aligned to reference zone's local day; columns = local hours in that zone
 *   – Color-coded cells: working (green), shoulder (yellow), night (muted)
 *   – Hover/click a column highlights the full vertical slice + shows summary
 *   – Overlap summary: working-hours overlap across all zones
 *   – Zones reorderable (up/down) and removable; cap at 10
 *   – DST handled correctly via getZoneOffsetMinutes
 *   – State persisted via Zustand store (su:timezone-planner)
 */

import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import {
  buildHourGrid,
  classifyHour,
  computeOverlap,
  formatConsecutiveHours,
  formatOffset,
  getZoneOffsetMinutes,
  getDayDiff,
  getSupportedZones,
  getFriendlyLabel,
  MAX_ZONES,
} from './logic'
import type { ZoneEntry, HourType } from './logic'
import {
  useTimezonePlannerStore,
  ensureLocalZone,
  getEffectiveDate,
} from './store'
import type { StoredZone } from './store'
import {
  Plus,
  Trash2,
  ChevronUp,
  ChevronDown,
  Search,
  X,
  Globe,
  CalendarDays,
  Clock,
} from 'lucide-react'

// ── Cell colour helpers ───────────────────────────────────────────────────────

function cellBg(type: HourType, isHighlighted: boolean): string {
  if (isHighlighted) return 'bg-primary/25'
  switch (type) {
    case 'working':  return 'bg-green-500/20 dark:bg-green-400/15'
    case 'shoulder': return 'bg-yellow-400/25 dark:bg-yellow-300/15'
    case 'night':    return 'bg-muted/30 dark:bg-muted/20'
  }
}

function cellTextColor(type: HourType): string {
  switch (type) {
    case 'working':  return 'text-foreground'
    case 'shoulder': return 'text-muted-foreground'
    case 'night':    return 'text-muted-foreground/60'
  }
}

// ── Zone picker dialog (inline dropdown) ─────────────────────────────────────

interface ZonePickerProps {
  onAdd: (zone: string) => void
  existingZones: string[]
}

function ZonePicker({ onAdd, existingZones }: ZonePickerProps) {
  const [query, setQuery]       = useState('')
  const [open, setOpen]         = useState(false)
  const containerRef            = useRef<HTMLDivElement>(null)
  const inputRef                = useRef<HTMLInputElement>(null)

  // Build zone list once (memoised — expensive but only once per mount)
  const allZones = useMemo(() => getSupportedZones(), [])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return allZones.slice(0, 60) // show first 60 when empty
    return allZones
      .filter((z) => {
        const friendly = getFriendlyLabel(z).toLowerCase()
        return z.toLowerCase().includes(q) || friendly.includes(q)
      })
      .slice(0, 60)
  }, [query, allZones])

  // Close on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    if (open) document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  function handleSelect(zone: string) {
    onAdd(zone)
    setQuery('')
    setOpen(false)
  }

  return (
    <div ref={containerRef} className="relative">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <Input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setOpen(true)
            }}
            onFocus={() => setOpen(true)}
            placeholder="Search city or timezone…"
            className="pl-8 text-sm h-8"
            spellCheck={false}
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label="Clear search"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {open && filtered.length > 0 && (
        <div className="absolute z-50 top-full mt-1 left-0 right-0 rounded-md border border-input bg-popover text-popover-foreground shadow-md max-h-64 overflow-y-auto">
          {filtered.map((zone) => {
            const alreadyAdded = existingZones.includes(zone)
            return (
              <button
                key={zone}
                type="button"
                disabled={alreadyAdded}
                onClick={() => !alreadyAdded && handleSelect(zone)}
                className={cn(
                  'w-full flex items-center justify-between px-3 py-1.5 text-sm text-left transition-colors',
                  alreadyAdded
                    ? 'opacity-40 cursor-not-allowed'
                    : 'hover:bg-accent hover:text-accent-foreground cursor-pointer',
                )}
              >
                <span className="font-medium">{getFriendlyLabel(zone)}</span>
                <span className="text-xs text-muted-foreground ml-2 shrink-0">{zone}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Zone list row ─────────────────────────────────────────────────────────────

interface ZoneRowControlProps {
  entry: StoredZone
  isFirst: boolean
  isLast: boolean
  onRemove: () => void
  onMoveUp: () => void
  onMoveDown: () => void
  offsetStr: string
}

function ZoneRowControl({
  entry,
  isFirst,
  isLast,
  onRemove,
  onMoveUp,
  onMoveDown,
  offsetStr,
}: ZoneRowControlProps) {
  return (
    <div className="flex items-center gap-2 py-1.5 border-b border-input last:border-0">
      <div className="flex flex-col gap-0.5">
        <button
          type="button"
          onClick={onMoveUp}
          disabled={isFirst}
          className="h-4 w-4 flex items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed"
          aria-label="Move up"
        >
          <ChevronUp className="h-3 w-3" />
        </button>
        <button
          type="button"
          onClick={onMoveDown}
          disabled={isLast}
          className="h-4 w-4 flex items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed"
          aria-label="Move down"
        >
          <ChevronDown className="h-3 w-3" />
        </button>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-medium truncate">{entry.label}</span>
          {isFirst && (
            <span className="text-[10px] bg-primary/15 text-primary rounded px-1 py-px shrink-0">
              reference
            </span>
          )}
        </div>
        <div className="text-xs text-muted-foreground truncate">
          {entry.zone} · {offsetStr}
        </div>
      </div>
      <button
        type="button"
        onClick={onRemove}
        className="h-6 w-6 flex items-center justify-center text-muted-foreground hover:text-destructive transition-colors shrink-0"
        aria-label={`Remove ${entry.label}`}
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

// ── Hour-strip legend ─────────────────────────────────────────────────────────

function HourLegend({
  highlightCol,
}: {
  highlightCol: number | null
}) {
  return (
    <div className="flex">
      {/* Label column spacer */}
      <div className="shrink-0 w-32" />
      {/* 24 hour labels */}
      <div className="flex-1 grid grid-cols-[repeat(24,minmax(0,1fr))] min-w-0">
        {Array.from({ length: 24 }, (_, i) => (
          <div
            key={i}
            className={cn(
              'text-center text-[9px] leading-tight py-0.5 select-none',
              highlightCol === i
                ? 'text-primary font-semibold'
                : 'text-muted-foreground/60',
            )}
          >
            {i.toString().padStart(2, '0')}
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Strip row ─────────────────────────────────────────────────────────────────

interface StripRowProps {
  row: ReturnType<typeof buildHourGrid>['rows'][number]
  refDateStr: string
  highlightCol: number | null
  onColEnter: (col: number) => void
  onColLeave: () => void
  onColClick: (col: number) => void
  stickyCol: number | null
}

function StripRow({
  row,
  refDateStr,
  highlightCol,
  onColEnter,
  onColLeave,
  onColClick,
  stickyCol,
}: StripRowProps) {
  const effectiveHighlight = stickyCol ?? highlightCol

  return (
    <div className="flex items-center">
      {/* Zone label */}
      <div className="shrink-0 w-32 pr-2 min-w-0">
        <div className="text-xs font-medium truncate">{row.entry.label}</div>
        {row.entry.isLocal && (
          <div className="text-[9px] text-muted-foreground">local</div>
        )}
      </div>

      {/* 24 cells */}
      <div className="flex-1 grid grid-cols-[repeat(24,minmax(0,1fr))] min-w-0">
        {row.cells.map((cell, colIdx) => {
          const type       = classifyHour(cell.localHour)
          const isHL       = effectiveHighlight === colIdx
          const dayDiff    = getDayDiff(refDateStr, cell.localDateStr)
          const showDayTag = dayDiff !== 0 && cell.localHour === 0

          return (
            <div
              key={colIdx}
              role="button"
              tabIndex={0}
              aria-label={`${row.entry.label} at column ${colIdx}: ${cell.localTimeStr}${dayDiff !== 0 ? ` (${dayDiff > 0 ? '+' : ''}${dayDiff} day)` : ''}`}
              onMouseEnter={() => onColEnter(colIdx)}
              onMouseLeave={onColLeave}
              onClick={() => onColClick(colIdx)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') onColClick(colIdx)
              }}
              className={cn(
                'relative h-8 border-r border-input/30 cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
                cellBg(type, isHL),
                colIdx === 23 && 'border-r-0',
              )}
            >
              {/* Hour label inside cell (only every 3 or highlighted) */}
              <span
                className={cn(
                  'absolute inset-0 flex items-center justify-center text-[9px] leading-none select-none',
                  cellTextColor(type),
                  isHL && 'text-primary font-semibold text-[10px]',
                )}
              >
                {isHL ? cell.localTimeStr : cell.localHour === 0 || cell.localHour % 6 === 0
                  ? cell.localHour.toString().padStart(2, '0')
                  : ''}
              </span>

              {/* +1 / −1 day badge */}
              {showDayTag && (
                <span className="absolute top-0 right-0 text-[7px] font-bold leading-none text-muted-foreground bg-muted/60 px-px rounded-bl">
                  {dayDiff > 0 ? '+1' : '−1'}
                </span>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Hover/click column summary ────────────────────────────────────────────────

interface ColSummaryProps {
  grid: ReturnType<typeof buildHourGrid>
  colIdx: number
  refDateStr: string
  onClose: () => void
}

function ColSummary({ grid, colIdx, refDateStr, onClose }: ColSummaryProps) {
  const utcTime = grid.utcTimes[colIdx]
  const utcStr  = utcTime.toISOString().slice(11, 16) + ' UTC'

  return (
    <div className="rounded-lg border border-input bg-card shadow-sm p-3 space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Clock className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            Column {colIdx} · {utcStr}
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-muted-foreground hover:text-foreground transition-colors"
          aria-label="Close summary"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="space-y-1">
        {grid.rows.map((row) => {
          const cell    = row.cells[colIdx]
          const type    = classifyHour(cell.localHour)
          const dayDiff = getDayDiff(refDateStr, cell.localDateStr)

          return (
            <div
              key={row.entry.zone}
              className="flex items-center gap-2 text-xs"
            >
              <span
                className={cn(
                  'w-2.5 h-2.5 rounded-sm shrink-0',
                  type === 'working'  && 'bg-green-500/60',
                  type === 'shoulder' && 'bg-yellow-400/60',
                  type === 'night'    && 'bg-muted',
                )}
              />
              <span className="w-24 truncate font-medium shrink-0">
                {row.entry.label}
              </span>
              <span className="font-mono text-foreground">{cell.localTimeStr}</span>
              {dayDiff !== 0 && (
                <span className="text-[10px] text-muted-foreground shrink-0">
                  ({dayDiff > 0 ? '+1 day' : '−1 day'})
                </span>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Overlap summary ───────────────────────────────────────────────────────────

interface OverlapSummaryProps {
  grid: ReturnType<typeof buildHourGrid>
  refDateStr: string
}

function OverlapSummary({ grid, refDateStr }: OverlapSummaryProps) {
  const result = useMemo(() => computeOverlap(grid), [grid])

  if (grid.rows.length < 2) return null

  const refLabel = grid.rows[0]?.entry.label ?? 'reference'

  return (
    <div
      className={cn(
        'rounded-lg border px-4 py-3 space-y-1',
        result.type === 'full'    && 'border-green-500/40 bg-green-500/5',
        result.type === 'partial' && 'border-yellow-400/40 bg-yellow-400/5',
        result.type === 'none'    && 'border-input bg-muted/10',
      )}
    >
      <div className="flex items-center gap-2">
        <span
          className={cn(
            'text-xs font-semibold uppercase tracking-wide',
            result.type === 'full'    && 'text-green-700 dark:text-green-400',
            result.type === 'partial' && 'text-yellow-700 dark:text-yellow-400',
            result.type === 'none'    && 'text-muted-foreground',
          )}
        >
          {result.type === 'full'    && '✓ Full overlap'}
          {result.type === 'partial' && '~ Best compromise'}
          {result.type === 'none'    && 'No working-hours overlap'}
        </span>
      </div>

      {result.type === 'full' && (
        <p className="text-sm">
          All zones are in working hours during{' '}
          <strong>{formatConsecutiveHours(result.fullOverlapHours)}</strong>{' '}
          <span className="text-muted-foreground">({refLabel} time, {refDateStr})</span>
        </p>
      )}

      {result.type === 'partial' && (
        <p className="text-sm">
          At most{' '}
          <strong>
            {result.bestCount} of {grid.rows.length}
          </strong>{' '}
          zones in working hours at the same time —{' '}
          <strong>{formatConsecutiveHours(result.bestHours)}</strong>{' '}
          <span className="text-muted-foreground">({refLabel} time, {refDateStr})</span>
        </p>
      )}

      {result.type === 'none' && (
        <p className="text-sm text-muted-foreground">
          No zones have overlapping working hours on this date.
        </p>
      )}
    </div>
  )
}

// ── Legend key ────────────────────────────────────────────────────────────────

function LegendKey() {
  return (
    <div className="flex items-center gap-4 text-xs text-muted-foreground">
      <div className="flex items-center gap-1.5">
        <span className="w-3 h-3 rounded-sm bg-green-500/30" />
        Working (9–17)
      </div>
      <div className="flex items-center gap-1.5">
        <span className="w-3 h-3 rounded-sm bg-yellow-400/40" />
        Shoulder (7–9, 17–21)
      </div>
      <div className="flex items-center gap-1.5">
        <span className="w-3 h-3 rounded-sm bg-muted/50" />
        Night
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function TimezonePlanner() {
  const {
    zones,
    selectedDate,
    setZones,
    addZone,
    removeZone,
    moveZoneUp,
    moveZoneDown,
    setSelectedDate,
  } = useTimezonePlannerStore()

  // Seed local zone on first mount
  const seededRef = useRef(false)
  useEffect(() => {
    if (seededRef.current) return
    seededRef.current = true
    ensureLocalZone(zones, setZones)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const effectiveDate = getEffectiveDate(selectedDate)

  // Convert StoredZone[] to ZoneEntry[] (same shape, just re-typed)
  const entries: ZoneEntry[] = useMemo(
    () => zones.map((z) => ({ zone: z.zone, label: z.label, isLocal: z.isLocal })),
    [zones],
  )

  // Build hour grid
  const grid = useMemo(
    () => buildHourGrid(entries, effectiveDate),
    [entries, effectiveDate],
  )

  // Offset for each zone at the current date's local noon
  const offsetsStr = useMemo(() => {
    const noonUtc = new Date(`${effectiveDate}T12:00:00Z`)
    return entries.map((e) => formatOffset(getZoneOffsetMinutes(e.zone, noonUtc)))
  }, [entries, effectiveDate])

  const [hoverCol, setHoverCol]   = useState<number | null>(null)
  const [stickyCol, setStickyCol] = useState<number | null>(null)

  const handleColEnter = useCallback((col: number) => setHoverCol(col), [])
  const handleColLeave = useCallback(() => setHoverCol(null), [])
  const handleColClick = useCallback(
    (col: number) =>
      setStickyCol((prev) => (prev === col ? null : col)),
    [],
  )

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 space-y-8">

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="space-y-1">
        <h1 className="text-xl font-semibold">Timezone Meeting Planner</h1>
        <p className="text-sm text-muted-foreground">
          Compare working hours across multiple timezones. Hover a column to see
          local times; click to pin the summary.
        </p>
      </div>

      {/* ── Controls row ────────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row gap-4">
        {/* Date picker */}
        <div className="flex items-center gap-2 shrink-0">
          <CalendarDays className="h-4 w-4 text-muted-foreground shrink-0" />
          <input
            type="date"
            value={effectiveDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className={cn(
              'h-8 rounded-md border border-input bg-background px-3 text-sm',
              'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-0',
              'text-foreground',
            )}
            aria-label="Select date"
          />
        </div>

        {/* Zone picker — only show when under cap */}
        {zones.length < MAX_ZONES && (
          <div className="flex-1 min-w-0">
            <ZonePicker
              onAdd={addZone}
              existingZones={zones.map((z) => z.zone)}
            />
          </div>
        )}

        {zones.length >= MAX_ZONES && (
          <p className="text-xs text-muted-foreground self-center">
            Maximum {MAX_ZONES} zones reached.
          </p>
        )}
      </div>

      {/* ── Empty state ──────────────────────────────────────────────────────── */}
      {zones.length === 0 && (
        <div className="rounded-lg border border-input bg-muted/20 px-4 py-8 text-center space-y-2">
          <Globe className="h-8 w-8 text-muted-foreground mx-auto" />
          <p className="text-sm text-muted-foreground">
            No timezones added yet. Search above or wait for your local zone to load.
          </p>
        </div>
      )}

      {zones.length > 0 && (
        <>
          {/* ── Zone management ───────────────────────────────────────────── */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Globe className="h-4 w-4 text-muted-foreground shrink-0" />
              <span className="text-sm font-semibold">Locations</span>
              <span className="text-xs text-muted-foreground">
                ({zones.length}/{MAX_ZONES}) · First row is the reference timezone
              </span>
            </div>
            <div className="rounded-lg border border-input divide-y divide-input">
              {zones.map((z, idx) => (
                <div key={z.zone} className="px-3">
                  <ZoneRowControl
                    entry={z}
                    isFirst={idx === 0}
                    isLast={idx === zones.length - 1}
                    offsetStr={offsetsStr[idx] ?? ''}
                    onRemove={() => removeZone(z.zone)}
                    onMoveUp={() => moveZoneUp(z.zone)}
                    onMoveDown={() => moveZoneDown(z.zone)}
                  />
                </div>
              ))}
            </div>
          </div>

          {/* ── Add zone button (mobile-friendly second entry) ─────────────── */}
          {zones.length < MAX_ZONES && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Plus className="h-3.5 w-3.5" />
              <span>Search above to add another timezone</span>
            </div>
          )}

          {/* ── 24-hour grid ───────────────────────────────────────────────── */}
          <div className="space-y-1">
            <div className="flex items-center gap-2 mb-2">
              <Clock className="h-4 w-4 text-muted-foreground shrink-0" />
              <span className="text-sm font-semibold">24-hour Strip</span>
              <span className="text-xs text-muted-foreground">
                · Hours shown in each zone's local time, aligned to{' '}
                <strong>{grid.rows[0]?.entry.label}</strong>'s day
              </span>
            </div>

            <div
              className="rounded-lg border border-input bg-background overflow-x-auto"
              onMouseLeave={handleColLeave}
            >
              <div className="min-w-[640px] p-2 space-y-1">
                <HourLegend highlightCol={stickyCol ?? hoverCol} />
                {grid.rows.map((row) => (
                  <StripRow
                    key={row.entry.zone}
                    row={row}
                    refDateStr={effectiveDate}
                    highlightCol={hoverCol}
                    stickyCol={stickyCol}
                    onColEnter={handleColEnter}
                    onColLeave={handleColLeave}
                    onColClick={handleColClick}
                  />
                ))}
              </div>
            </div>

            <LegendKey />
          </div>

          {/* ── Column summary (sticky click) ──────────────────────────────── */}
          {stickyCol !== null && (
            <ColSummary
              grid={grid}
              colIdx={stickyCol}
              refDateStr={effectiveDate}
              onClose={() => setStickyCol(null)}
            />
          )}

          {/* ── Overlap summary ───────────────────────────────────────────── */}
          <OverlapSummary grid={grid} refDateStr={effectiveDate} />
        </>
      )}
    </div>
  )
}
