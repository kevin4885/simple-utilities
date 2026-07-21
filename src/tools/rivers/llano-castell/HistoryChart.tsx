/**
 * HistoryChart — SVG bar chart for 11-year trip history + current forecast.
 *
 * Design choices (documented per requirement):
 *   - Hand-rolled SVG: no chart library dependency. The repo has no charting lib
 *     and 11 bars + a median line is trivially done in ~100 lines of SVG.
 *   - Log-scale Y axis (labeled "avg cfs (log)") to handle the 6–1678 cfs range.
 *   - Forecast bar: outlined/dashed border vs. solid historical bars.
 *   - Drought years: muted fill (var(--muted-foreground) at low opacity).
 *   - Big years (2024, current forecast): accent fill.
 *   - Median reference line: dashed, labeled.
 *   - Keyboard-accessible: bars have role="button" + tabIndex + onKeyDown.
 *   - Tap/click → calls onSelectYear prop with the year.
 */
import type { HistoricalYear } from './logic'
import { fmtCfs } from './logic'

interface BarDatum {
  year: number
  cfs: number
  isForecast: boolean
  isDrought: boolean
  isBig: boolean
  dates: string
}

interface HistoryChartProps {
  historicalYears: HistoricalYear[]
  forecastAvg: number
  forecastYear: number
  selectedYear: number | null
  onSelectYear: (year: number | null) => void
}

const LOG_CLAMP_MIN = 4 // avoid log(0) — use 4 cfs as minimum for log scale

function logY(cfs: number): number {
  return Math.log10(Math.max(cfs, LOG_CLAMP_MIN))
}

export function HistoryChart({
  historicalYears,
  forecastAvg,
  forecastYear,
  selectedYear,
  onSelectYear,
}: HistoryChartProps) {
  // Build bar data
  const histBars: BarDatum[] = historicalYears.map((y) => ({
    year: y.year,
    cfs: y.q50_cfs ?? y.avg_cfs ?? 0,
    isForecast: false,
    isDrought: y.drought,
    isBig: (y.q50_cfs ?? y.avg_cfs ?? 0) >= 800,
    dates: `${y.thu} – ${y.sat}`,
  }))

  const forecastBar: BarDatum = {
    year: forecastYear,
    cfs: forecastAvg,
    isForecast: true,
    isDrought: false,
    isBig: forecastAvg >= 800,
    dates: `${forecastYear} forecast`,
  }

  const bars: BarDatum[] = [...histBars, forecastBar].sort((a, b) => a.year - b.year)

  // Medians: historical only
  const histCfs = histBars.map((b) => b.cfs).filter((c) => c > 0).sort((a, b) => a - b)
  const mid = Math.floor(histCfs.length / 2)
  const medianCfs =
    histCfs.length % 2 === 0 ? (histCfs[mid - 1] + histCfs[mid]) / 2 : histCfs[mid]

  // SVG layout
  const W = 600
  const H = 280
  const padL = 52
  const padR = 12
  const padT = 20
  const padB = 48
  const chartW = W - padL - padR
  const chartH = H - padT - padB

  const allCfs = bars.map((b) => b.cfs).filter((c) => c > 0)
  const minLog = logY(Math.min(...allCfs) * 0.5)
  const maxLog = logY(Math.max(...allCfs) * 2)
  const logRange = maxLog - minLog

  function yPos(cfs: number): number {
    const l = logY(cfs)
    const normalized = (l - minLog) / logRange
    return padT + chartH - normalized * chartH
  }

  const barW = chartW / bars.length
  const barPad = barW * 0.15

  // Y-axis ticks (log scale)
  const tickValues = [5, 10, 50, 100, 500, 1000, 2000, 5000].filter(
    (v) => logY(v) >= minLog && logY(v) <= maxLog,
  )

  const medianY = yPos(medianCfs)

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full"
      role="group"
      aria-label="11-year trip history bar chart (log scale). Use arrow keys or tab to explore individual years."
    >
      {/* Y-axis gridlines + labels */}
      {tickValues.map((v) => {
        const y = yPos(v)
        return (
          <g key={v}>
            <line
              x1={padL}
              x2={W - padR}
              y1={y}
              y2={y}
              stroke="currentColor"
              strokeOpacity={0.12}
              strokeWidth={1}
            />
            <text
              x={padL - 5}
              y={y + 4}
              textAnchor="end"
              fontSize={9}
              fill="currentColor"
              fillOpacity={0.55}
            >
              {v >= 1000 ? `${v / 1000}k` : String(v)}
            </text>
          </g>
        )
      })}

      {/* Y-axis label */}
      <text
        x={10}
        y={padT + chartH / 2}
        textAnchor="middle"
        fontSize={9}
        fill="currentColor"
        fillOpacity={0.6}
        transform={`rotate(-90, 10, ${padT + chartH / 2})`}
      >
        avg cfs (log)
      </text>

      {/* Median reference line */}
      <line
        x1={padL}
        x2={W - padR}
        y1={medianY}
        y2={medianY}
        stroke="currentColor"
        strokeOpacity={0.45}
        strokeWidth={1.5}
        strokeDasharray="4 3"
      />
      <text
        x={W - padR - 2}
        y={medianY - 4}
        textAnchor="end"
        fontSize={9}
        fill="currentColor"
        fillOpacity={0.6}
      >
        median {fmtCfs(medianCfs)}
      </text>

      {/* Bars */}
      {bars.map((bar, i) => {
        const x = padL + i * barW + barPad
        const bw = barW - barPad * 2
        const top = yPos(Math.max(bar.cfs, LOG_CLAMP_MIN))
        const bottom = yPos(LOG_CLAMP_MIN)
        const bh = Math.max(2, bottom - top)
        const isSelected = selectedYear === bar.year

        // Color via CSS current-color class tokens applied via inline style
        // We use CSS custom properties so light/dark themes work automatically
        let fillClass = 'fill-primary'
        let fillOpacity = 0.8
        if (bar.isDrought) {
          fillClass = 'fill-muted-foreground'
          fillOpacity = 0.35
        } else if (bar.isBig) {
          fillClass = 'fill-secondary'
          fillOpacity = 0.9
        }

        return (
          <g
            key={bar.year}
            role="button"
            tabIndex={0}
            aria-label={`${bar.year}: ${fmtCfs(bar.cfs)} cfs${bar.isForecast ? ' (forecast)' : ''}`}
            aria-pressed={isSelected}
            onClick={() => onSelectYear(isSelected ? null : bar.year)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onSelectYear(isSelected ? null : bar.year)
              }
            }}
            className="cursor-pointer rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {/* Highlight ring when selected */}
            {isSelected && (
              <rect
                x={x - 2}
                y={top - 2}
                width={bw + 4}
                height={bh + 4}
                rx={3}
                fill="none"
                stroke="currentColor"
                strokeOpacity={0.7}
                strokeWidth={2}
              />
            )}
            {bar.isForecast ? (
              /* Forecast bar: outlined with dashes, no solid fill, slight tint */
              <>
                <rect
                  x={x}
                  y={top}
                  width={bw}
                  height={bh}
                  rx={2}
                  className={fillClass}
                  fillOpacity={0.25}
                  stroke="currentColor"
                  strokeOpacity={0.7}
                  strokeWidth={1.5}
                  strokeDasharray="4 2"
                />
              </>
            ) : (
              <rect
                x={x}
                y={top}
                width={bw}
                height={bh}
                rx={2}
                className={fillClass}
                fillOpacity={fillOpacity}
              />
            )}

            {/* Value label (top of bar) */}
            <text
              x={x + bw / 2}
              y={top - 3}
              textAnchor="middle"
              fontSize={8}
              fill="currentColor"
              fillOpacity={0.75}
            >
              {bar.cfs >= 1000
                ? `${(bar.cfs / 1000).toFixed(1)}k`
                : fmtCfs(bar.cfs)}
            </text>

            {/* Year label (x-axis) */}
            <text
              x={x + bw / 2}
              y={H - padB + 14}
              textAnchor="middle"
              fontSize={9}
              fill="currentColor"
              fillOpacity={0.8}
            >
              {String(bar.year).slice(2)}
            </text>
            {bar.isForecast && (
              <text
                x={x + bw / 2}
                y={H - padB + 26}
                textAnchor="middle"
                fontSize={8}
                fill="currentColor"
                fillOpacity={0.6}
              >
                est
              </text>
            )}
          </g>
        )
      })}
    </svg>
  )
}
