/**
 * GaugeCharts — four hand-rolled SVG line charts for the Llano @ Castell tool.
 *
 * Layout (top to bottom):
 *   Day-window toggle  [ 1d | 3d | 7d | 14d | 30d ]
 *   Mason  — Stage  (ft)
 *   Llano  — Stage  (ft)
 *   Mason  — Discharge (cfs)
 *   Llano  — Discharge (cfs)
 *
 * Design rules (matching existing HistoryChart style):
 *   - Hand-rolled SVG — no chart library.
 *   - Ft pair shares a Y-axis scale; CFS pair shares a Y-axis scale.
 *   - Linear Y-axis, auto-scaled to visible window with ~4 rounded ticks.
 *   - X-axis: date labels spaced to avoid crowding (max ~6 labels).
 *   - Current-value dot + label at right end of each line.
 *   - Graceful "No data" placeholder when a series is empty.
 *   - Toggles use the same ghost-button + active-state pattern as the rest of the UI.
 */
import { useState, useMemo } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { GaugeReading } from './logic'
import { fmtFt, fmtCfs } from './logic'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface GaugeChartsProps {
  mason: GaugeReading[]
  llano: GaugeReading[]
  masonFt: GaugeReading[]
  llanoFt: GaugeReading[]
}

type WindowDays = 1 | 3 | 7 | 14 | 30
const WINDOW_OPTIONS: WindowDays[] = [1, 3, 7, 14, 30]

// ---------------------------------------------------------------------------
// SVG layout constants
// ---------------------------------------------------------------------------

const W = 600
const H = 160
const PAD_L = 44
const PAD_R = 48   // room for end-of-line value label
const PAD_T = 14
const PAD_B = 32
const CHART_W = W - PAD_L - PAD_R
const CHART_H = H - PAD_T - PAD_B

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Filter readings to the last N days */
function windowSlice(readings: GaugeReading[], days: number): GaugeReading[] {
  if (readings.length === 0) return []
  const cutoff = new Date(readings[readings.length - 1].dateTime).getTime() - days * 86_400_000
  return readings.filter((r) => new Date(r.dateTime).getTime() >= cutoff)
}

/** Compute nice round tick values for a [min, max] range */
function niceTicks(min: number, max: number, targetCount = 4): number[] {
  const range = max - min || 1
  const rawStep = range / targetCount
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep)))
  const niceSteps = [1, 2, 2.5, 5, 10]
  const step = niceSteps.map((s) => s * mag).find((s) => s >= rawStep) ?? rawStep * 2
  const start = Math.floor(min / step) * step
  const ticks: number[] = []
  for (let t = start; t <= max + step * 0.01; t += step) {
    ticks.push(parseFloat(t.toFixed(10)))
  }
  return ticks
}

/** Pick at most maxLabels evenly-spaced indices from an array */
function sparseIndices(len: number, maxLabels: number): Set<number> {
  const out = new Set<number>()
  if (len === 0) return out
  out.add(0)
  out.add(len - 1)
  if (len <= maxLabels) {
    for (let i = 0; i < len; i++) out.add(i)
    return out
  }
  const step = Math.floor(len / (maxLabels - 1))
  for (let i = 0; i < len; i += step) out.add(i)
  return out
}

/** Format a dateTime string as a short label, e.g. "Jul 21 2pm" */
function fmtAxisLabel(dateTime: string, windowDays: number): string {
  const d = new Date(dateTime)
  if (windowDays <= 1) {
    return d.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      timeZone: 'America/Chicago',
    })
  }
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'America/Chicago',
  })
}

// ---------------------------------------------------------------------------
// Single line chart SVG
// ---------------------------------------------------------------------------

interface LineChartProps {
  readings: GaugeReading[]
  label: string
  color: string          // CSS color string or currentColor
  yMin: number           // shared scale min
  yMax: number           // shared scale max
  ticks: number[]        // shared scale ticks
  windowDays: WindowDays
  formatValue: (v: number) => string
  unit: string
}

function LineChart({
  readings,
  label,
  color,
  yMin,
  yMax,
  ticks,
  windowDays,
  formatValue,
  unit,
}: LineChartProps) {
  if (readings.length === 0) {
    return (
      <div className="flex h-[160px] items-center justify-center rounded-md border border-border bg-muted/30">
        <span className="text-xs text-muted-foreground">{label} — no data</span>
      </div>
    )
  }

  const yRange = yMax - yMin || 1

  function xPos(i: number): number {
    return PAD_L + (i / Math.max(readings.length - 1, 1)) * CHART_W
  }

  function yPos(v: number): number {
    const normalized = (v - yMin) / yRange
    return PAD_T + CHART_H - normalized * CHART_H
  }

  // Build SVG polyline points
  const points = readings
    .map((r, i) => `${xPos(i).toFixed(1)},${yPos(r.value).toFixed(1)}`)
    .join(' ')

  // X-axis tick indices
  const xTickSet = sparseIndices(readings.length, windowDays <= 1 ? 5 : 6)

  const latest = readings[readings.length - 1]
  const latestX = xPos(readings.length - 1)
  const latestY = yPos(latest.value)

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full"
      role="img"
      aria-label={`${label} over last ${windowDays} day${windowDays !== 1 ? 's' : ''}`}
    >
      {/* Y-axis gridlines + labels */}
      {ticks.map((t) => {
        const y = yPos(t)
        if (y < PAD_T - 4 || y > PAD_T + CHART_H + 4) return null
        return (
          <g key={t}>
            <line
              x1={PAD_L} x2={W - PAD_R} y1={y} y2={y}
              stroke="currentColor" strokeOpacity={0.1} strokeWidth={1}
            />
            <text
              x={PAD_L - 4} y={y + 3.5}
              textAnchor="end" fontSize={9}
              fill="currentColor" fillOpacity={0.55}
            >
              {formatValue(t)}
            </text>
          </g>
        )
      })}

      {/* Chart label (top-left) */}
      <text
        x={PAD_L + 4} y={PAD_T + 11}
        fontSize={10} fontWeight="600"
        fill="currentColor" fillOpacity={0.8}
      >
        {label}
      </text>

      {/* Line */}
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth={1.8}
        strokeLinejoin="round"
        strokeLinecap="round"
        opacity={0.85}
      />

      {/* Current-value dot */}
      <circle cx={latestX} cy={latestY} r={3} fill={color} opacity={0.9} />

      {/* Current-value label (right of dot) */}
      <text
        x={latestX + 6} y={latestY + 3.5}
        fontSize={9} fontWeight="600"
        fill="currentColor" fillOpacity={0.9}
      >
        {formatValue(latest.value)} {unit}
      </text>

      {/* X-axis labels */}
      {readings.map((r, i) => {
        if (!xTickSet.has(i)) return null
        const x = xPos(i)
        return (
          <text
            key={i}
            x={x} y={H - PAD_B + 14}
            textAnchor="middle" fontSize={8}
            fill="currentColor" fillOpacity={0.55}
          >
            {fmtAxisLabel(r.dateTime, windowDays)}
          </text>
        )
      })}

      {/* X-axis baseline */}
      <line
        x1={PAD_L} x2={W - PAD_R}
        y1={PAD_T + CHART_H} y2={PAD_T + CHART_H}
        stroke="currentColor" strokeOpacity={0.15} strokeWidth={1}
      />
    </svg>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function GaugeCharts({ mason, llano, masonFt, llanoFt }: GaugeChartsProps) {
  const [windowDays, setWindowDays] = useState<WindowDays>(7)

  // Slice all four series to the selected window
  const masonSlice   = useMemo(() => windowSlice(mason,   windowDays), [mason,   windowDays])
  const llanoSlice   = useMemo(() => windowSlice(llano,   windowDays), [llano,   windowDays])
  const masonFtSlice = useMemo(() => windowSlice(masonFt, windowDays), [masonFt, windowDays])
  const llanoFtSlice = useMemo(() => windowSlice(llanoFt, windowDays), [llanoFt, windowDays])

  // ── Shared ft scale ──────────────────────────────────────────────────────
  const allFtVals = [...masonFtSlice, ...llanoFtSlice].map((r) => r.value)
  const ftMin = allFtVals.length > 0 ? Math.min(...allFtVals) : 0
  const ftMax = allFtVals.length > 0 ? Math.max(...allFtVals) : 10
  const ftPad = Math.max((ftMax - ftMin) * 0.1, 0.2)
  const ftScaleMin = Math.max(0, ftMin - ftPad)
  const ftScaleMax = ftMax + ftPad
  const ftTicks = niceTicks(ftScaleMin, ftScaleMax)

  // ── Shared CFS scale ─────────────────────────────────────────────────────
  const allCfsVals = [...masonSlice, ...llanoSlice].map((r) => r.value)
  const cfsMin = allCfsVals.length > 0 ? Math.min(...allCfsVals) : 0
  const cfsMax = allCfsVals.length > 0 ? Math.max(...allCfsVals) : 500
  const cfsPad = Math.max((cfsMax - cfsMin) * 0.1, 10)
  const cfsScaleMin = Math.max(0, cfsMin - cfsPad)
  const cfsScaleMax = cfsMax + cfsPad
  const cfsTicks = niceTicks(cfsScaleMin, cfsScaleMax)

  // Line colors: use CSS custom properties so they respect light/dark theme
  const masonColor = 'var(--chart-2)'   // blue-ish
  const llanoColor = 'var(--chart-4)'   // orange-ish

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between text-base">
          <span>Gauge History</span>
          {/* Day-window toggle */}
          <div className="flex gap-1">
            {WINDOW_OPTIONS.map((d) => (
              <Button
                key={d}
                variant="ghost"
                size="sm"
                onClick={() => setWindowDays(d)}
                className={cn(
                  'h-6 px-2 text-xs',
                  windowDays === d
                    ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                    : 'text-muted-foreground',
                )}
              >
                {d}d
              </Button>
            ))}
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">

        {/* ── Stage (ft) ─────────────────────────────────────── */}
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Stage (ft)
          </p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <LineChart
              readings={masonFtSlice}
              label="Mason"
              color={masonColor}
              yMin={ftScaleMin} yMax={ftScaleMax} ticks={ftTicks}
              windowDays={windowDays}
              formatValue={fmtFt}
              unit="ft"
            />
            <LineChart
              readings={llanoFtSlice}
              label="Llano"
              color={llanoColor}
              yMin={ftScaleMin} yMax={ftScaleMax} ticks={ftTicks}
              windowDays={windowDays}
              formatValue={fmtFt}
              unit="ft"
            />
          </div>
        </div>

        {/* ── Discharge (cfs) ────────────────────────────────── */}
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Discharge (cfs)
          </p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <LineChart
              readings={masonSlice}
              label="Mason"
              color={masonColor}
              yMin={cfsScaleMin} yMax={cfsScaleMax} ticks={cfsTicks}
              windowDays={windowDays}
              formatValue={(v) => fmtCfs(v)}
              unit="cfs"
            />
            <LineChart
              readings={llanoSlice}
              label="Llano"
              color={llanoColor}
              yMin={cfsScaleMin} yMax={cfsScaleMax} ticks={cfsTicks}
              windowDays={windowDays}
              formatValue={(v) => fmtCfs(v)}
              unit="cfs"
            />
          </div>
        </div>

      </CardContent>
    </Card>
  )
}
