/**
 * GaugeCharts — four interactive hand-rolled SVG line charts.
 *
 * Layout (top to bottom):
 *   Day-window toggle  [ 1d | 3d | 7d | 14d | 30d ]
 *   Mason  — Stage  (ft)
 *   Llano  — Stage  (ft)
 *   Mason  — Discharge (cfs)
 *   Llano  — Discharge (cfs)
 *
 * Interactivity per chart:
 *   - Mouse / touch move → vertical + horizontal crosshair
 *   - Highlighted dot at the nearest data point
 *   - Tooltip box: date/time (CT) + value
 *   - Tooltip flips left/right to stay inside the chart area
 *   - cursor: crosshair over chart area
 */
import { useState, useRef, useMemo } from 'react'
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
// SVG layout constants (viewBox coords)
// ---------------------------------------------------------------------------

const W      = 600
const H      = 220
const PAD_L  = 48   // Y-axis labels
const PAD_R  = 56   // end-of-line value label
const PAD_T  = 16
const PAD_B  = 34
const CHART_W = W - PAD_L - PAD_R
const CHART_H = H - PAD_T - PAD_B

// Tooltip dimensions
const TT_W = 136
const TT_H = 36

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

function windowSlice(readings: GaugeReading[], days: number): GaugeReading[] {
  if (readings.length === 0) return []
  const cutoff = new Date(readings[readings.length - 1].dateTime).getTime() - days * 86_400_000
  return readings.filter((r) => new Date(r.dateTime).getTime() >= cutoff)
}

function niceTicks(min: number, max: number, targetCount = 4): number[] {
  const range = max - min || 1
  const rawStep = range / targetCount
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep)))
  const step = [1, 2, 2.5, 5, 10].map((s) => s * mag).find((s) => s >= rawStep) ?? rawStep * 2
  const start = Math.floor(min / step) * step
  const ticks: number[] = []
  for (let t = start; t <= max + step * 0.01; t += step) {
    ticks.push(parseFloat(t.toFixed(10)))
  }
  return ticks
}

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

function fmtTooltipTime(dateTime: string): string {
  const d = new Date(dateTime)
  return (
    d.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZone: 'America/Chicago',
    }) + ' CT'
  )
}

// ---------------------------------------------------------------------------
// Single interactive line chart
// ---------------------------------------------------------------------------

interface LineChartProps {
  readings: GaugeReading[]
  label: string
  color: string
  yMin: number
  yMax: number
  ticks: number[]
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
  const svgRef = useRef<SVGSVGElement>(null)
  const [hoverIdx, setHoverIdx] = useState<number | null>(null)

  // Map a clientX pixel to the nearest data index, accounting for viewBox scaling
  function idxFromClientX(clientX: number): number | null {
    const svg = svgRef.current
    if (!svg || readings.length === 0) return null
    const rect = svg.getBoundingClientRect()
    if (rect.width === 0) return null
    const scaleX = W / rect.width
    const relX = (clientX - rect.left) * scaleX
    if (relX < PAD_L - 8 || relX > W - PAD_R + 8) return null
    const t = Math.max(0, Math.min(1, (relX - PAD_L) / CHART_W))
    return Math.round(t * (readings.length - 1))
  }

  function handleMouseMove(e: React.MouseEvent<SVGSVGElement>) {
    setHoverIdx(idxFromClientX(e.clientX))
  }

  function handleTouchMove(e: React.TouchEvent<SVGSVGElement>) {
    const touch = e.touches[0]
    if (touch) setHoverIdx(idxFromClientX(touch.clientX))
  }

  // ── Always call hooks before any early return ────────────────────────────

  if (readings.length === 0) {
    return (
      <div className="flex h-[220px] items-center justify-center rounded-md border border-border bg-muted/30">
        <span className="text-xs text-muted-foreground">{label} — no data</span>
      </div>
    )
  }

  const yRange = yMax - yMin || 1

  function xPos(i: number): number {
    return PAD_L + (i / Math.max(readings.length - 1, 1)) * CHART_W
  }

  function yPos(v: number): number {
    return PAD_T + CHART_H - ((v - yMin) / yRange) * CHART_H
  }

  const points = readings
    .map((r, i) => `${xPos(i).toFixed(1)},${yPos(r.value).toFixed(1)}`)
    .join(' ')

  const xTickSet = sparseIndices(readings.length, windowDays <= 1 ? 5 : 6)

  const latest    = readings[readings.length - 1]
  const latestX   = xPos(readings.length - 1)
  const latestY   = yPos(latest.value)

  // Hover state
  const hovered = hoverIdx !== null ? readings[hoverIdx] : null
  const hoverX  = hoverIdx !== null ? xPos(hoverIdx) : null
  const hoverY  = hovered  !== null ? yPos(hovered.value) : null

  // Tooltip: flip left/right to stay inside chart
  let ttX = 0, ttY = 0
  if (hoverX !== null && hoverY !== null) {
    ttX = hoverX > W / 2 ? hoverX - TT_W - 10 : hoverX + 10
    ttY = Math.max(PAD_T + 2, Math.min(PAD_T + CHART_H - TT_H - 2, hoverY - TT_H / 2))
  }

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${W} ${H}`}
      className="w-full cursor-crosshair select-none"
      role="img"
      aria-label={`${label} ${unit} over last ${windowDays} day${windowDays !== 1 ? 's' : ''}`}
      onMouseMove={handleMouseMove}
      onMouseLeave={() => setHoverIdx(null)}
      onTouchMove={handleTouchMove}
      onTouchEnd={() => setHoverIdx(null)}
    >
      {/* ── Y-axis gridlines + labels ────────────────────────── */}
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

      {/* ── X-axis baseline ──────────────────────────────────── */}
      <line
        x1={PAD_L} x2={W - PAD_R}
        y1={PAD_T + CHART_H} y2={PAD_T + CHART_H}
        stroke="currentColor" strokeOpacity={0.15} strokeWidth={1}
      />

      {/* ── Chart label ──────────────────────────────────────── */}
      <text
        x={PAD_L + 6} y={PAD_T + 12}
        fontSize={11} fontWeight="600"
        fill="currentColor" fillOpacity={0.85}
      >
        {label}
      </text>

      {/* ── Data line ────────────────────────────────────────── */}
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
        opacity={0.85}
      />

      {/* ── Latest value dot + label ─────────────────────────── */}
      {hoverIdx === null && (
        <>
          <circle cx={latestX} cy={latestY} r={3.5} fill={color} opacity={0.9} />
          <text
            x={latestX + 7} y={latestY + 3.5}
            fontSize={10} fontWeight="600"
            fill="currentColor" fillOpacity={0.9}
          >
            {formatValue(latest.value)} {unit}
          </text>
        </>
      )}

      {/* ── X-axis date labels ───────────────────────────────── */}
      {readings.map((r, i) => {
        if (!xTickSet.has(i)) return null
        return (
          <text
            key={i}
            x={xPos(i)} y={H - PAD_B + 15}
            textAnchor="middle" fontSize={8}
            fill="currentColor" fillOpacity={0.5}
          >
            {fmtAxisLabel(r.dateTime, windowDays)}
          </text>
        )
      })}

      {/* ── Interactive crosshair + tooltip ──────────────────── */}
      {hoverX !== null && hoverY !== null && hovered !== null && (
        <g pointerEvents="none">
          {/* Vertical crosshair */}
          <line
            x1={hoverX} x2={hoverX}
            y1={PAD_T} y2={PAD_T + CHART_H}
            stroke="currentColor" strokeOpacity={0.35} strokeWidth={1}
            strokeDasharray="3 2"
          />
          {/* Horizontal crosshair */}
          <line
            x1={PAD_L} x2={W - PAD_R}
            y1={hoverY} y2={hoverY}
            stroke="currentColor" strokeOpacity={0.15} strokeWidth={1}
          />
          {/* Dot at hovered point */}
          <circle
            cx={hoverX} cy={hoverY} r={4.5}
            fill={color}
            stroke="var(--background)" strokeWidth={2}
          />
          {/* Tooltip background */}
          <rect
            x={ttX} y={ttY}
            width={TT_W} height={TT_H}
            rx={4}
            fill="var(--popover)"
            stroke="var(--border)" strokeWidth={1}
            fillOpacity={0.97}
          />
          {/* Tooltip: timestamp */}
          <text
            x={ttX + 8} y={ttY + 13}
            fontSize={9}
            fill="var(--muted-foreground)"
          >
            {fmtTooltipTime(hovered.dateTime)}
          </text>
          {/* Tooltip: value */}
          <text
            x={ttX + 8} y={ttY + 27}
            fontSize={11} fontWeight="700"
            fill="var(--foreground)"
          >
            {formatValue(hovered.value)} {unit}
          </text>
        </g>
      )}
    </svg>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function GaugeCharts({ mason, llano, masonFt, llanoFt }: GaugeChartsProps) {
  const [windowDays, setWindowDays] = useState<WindowDays>(7)

  const masonSlice   = useMemo(() => windowSlice(mason,   windowDays), [mason,   windowDays])
  const llanoSlice   = useMemo(() => windowSlice(llano,   windowDays), [llano,   windowDays])
  const masonFtSlice = useMemo(() => windowSlice(masonFt, windowDays), [masonFt, windowDays])
  const llanoFtSlice = useMemo(() => windowSlice(llanoFt, windowDays), [llanoFt, windowDays])

  // Shared ft scale
  const allFtVals  = [...masonFtSlice, ...llanoFtSlice].map((r) => r.value)
  const ftMin      = allFtVals.length > 0 ? Math.min(...allFtVals) : 0
  const ftMax      = allFtVals.length > 0 ? Math.max(...allFtVals) : 10
  const ftPad      = Math.max((ftMax - ftMin) * 0.1, 0.2)
  const ftScaleMin = Math.max(0, ftMin - ftPad)
  const ftScaleMax = ftMax + ftPad
  const ftTicks    = niceTicks(ftScaleMin, ftScaleMax)

  // Shared CFS scale
  const allCfsVals  = [...masonSlice, ...llanoSlice].map((r) => r.value)
  const cfsMin      = allCfsVals.length > 0 ? Math.min(...allCfsVals) : 0
  const cfsMax      = allCfsVals.length > 0 ? Math.max(...allCfsVals) : 500
  const cfsPad      = Math.max((cfsMax - cfsMin) * 0.1, 10)
  const cfsScaleMin = Math.max(0, cfsMin - cfsPad)
  const cfsScaleMax = cfsMax + cfsPad
  const cfsTicks    = niceTicks(cfsScaleMin, cfsScaleMax)

  const masonColor = 'var(--chart-2)'
  const llanoColor = 'var(--chart-4)'

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between text-base">
          <span>Gauge History</span>
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
      <CardContent className="space-y-4">

        {/* Stage (ft) */}
        <div className="space-y-1">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Stage (ft)
          </p>
          <div className="space-y-3">
            <LineChart
              readings={masonFtSlice} label="Mason" color={masonColor}
              yMin={ftScaleMin} yMax={ftScaleMax} ticks={ftTicks}
              windowDays={windowDays} formatValue={fmtFt} unit="ft"
            />
            <LineChart
              readings={llanoFtSlice} label="Llano" color={llanoColor}
              yMin={ftScaleMin} yMax={ftScaleMax} ticks={ftTicks}
              windowDays={windowDays} formatValue={fmtFt} unit="ft"
            />
          </div>
        </div>

        {/* Discharge (cfs) */}
        <div className="space-y-1">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Discharge (cfs)
          </p>
          <div className="space-y-3">
            <LineChart
              readings={masonSlice} label="Mason" color={masonColor}
              yMin={cfsScaleMin} yMax={cfsScaleMax} ticks={cfsTicks}
              windowDays={windowDays} formatValue={fmtCfs} unit="cfs"
            />
            <LineChart
              readings={llanoSlice} label="Llano" color={llanoColor}
              yMin={cfsScaleMin} yMax={cfsScaleMax} ticks={cfsTicks}
              windowDays={windowDays} formatValue={fmtCfs} unit="cfs"
            />
          </div>
        </div>

      </CardContent>
    </Card>
  )
}
