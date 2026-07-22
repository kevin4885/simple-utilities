/**
 * Llano River @ Castell Trip Tool
 *
 * Sections:
 *   1. Hero card — trip dates, countdown, current Castell estimate, trend
 *   2. Trip-day forecast cards (Thu/Fri/Sat)
 *   3. Wading verdict card (accent border)
 *   4. "How 2026 stacks up" — 11-bar history chart
 *   5. Footer strip — gauge readings, "How this works" collapsible
 */
import { useCallback, useEffect, useState } from 'react'
import { RefreshCw, AlertTriangle, Waves } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'

import {
  activeTripYear,
  tripWindow,
  tripCountdown,
  tripPhase,
  estimateCastellFromGauges,
  recessionRatePerDay,
  forecastTripDays,
  wadingVerdict,
  stacksUp,
  trendArrow,
  fmtCfs,
  fmtFt,
  fmtRatePct,
  fmtTimeAgo,
  fmtMonthDay,
  fmtTripDateRange,
  fitRatingCurve,
} from './logic'
import type { DayForecast, HistoricalYear } from './logic'
import { useGaugeData } from './useGaugeData'
import { HistoryChart } from './HistoryChart'

import tripStatsRaw from './trip_stats.json'
import mrcRaw from './mrc_params.json'

// ---------------------------------------------------------------------------
// Static data from JSON exports
// ---------------------------------------------------------------------------

const historicalYears = tripStatsRaw.historical as HistoricalYear[]

// Type assertion — mrc_params.json has the shape we need
const masonMrc = mrcRaw.mason as unknown as {
  tau: Record<string, number>
  tau_summer: Record<string, number>
  floor_cfs: number
  calibrated_bands: Record<string, [number, number]>
}

// ---------------------------------------------------------------------------
// Skeleton placeholder
// ---------------------------------------------------------------------------

function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'animate-pulse rounded bg-muted',
        className,
      )}
      aria-hidden="true"
    />
  )
}

// ---------------------------------------------------------------------------
// Day card
// ---------------------------------------------------------------------------

interface DayCardProps {
  day: DayForecast
  isToday: boolean
  isObserved: boolean
  isPushiest: boolean
  isEasiest: boolean
}

function DayCard({ day, isToday, isObserved, isPushiest, isEasiest }: DayCardProps) {
  const dateStr = fmtMonthDay(day.date)
  return (
    <Card
      className={cn(
        'flex flex-col gap-1 p-4',
        isToday && 'ring-2 ring-primary',
      )}
    >
      <div className="flex items-center justify-between">
        <span className="font-semibold text-sm text-foreground">
          {day.label}
          <span className="ml-1 text-xs text-muted-foreground font-normal">{dateStr}</span>
        </span>
        <div className="flex gap-1">
          {isToday && (
            <span className="rounded-full bg-primary px-2 py-0.5 text-[10px] font-medium text-primary-foreground">
              today
            </span>
          )}
          {isObserved && !isToday && (
            <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
              observed
            </span>
          )}
          {isPushiest && (
            <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-medium text-secondary-foreground">
              pushiest
            </span>
          )}
          {isEasiest && !isPushiest && (
            <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
              easiest
            </span>
          )}
        </div>
      </div>

      {/* q50 large */}
      <div className="text-2xl font-bold tabular-nums text-foreground">
        {fmtCfs(day.q50)} <span className="text-sm font-normal text-muted-foreground">cfs</span>
      </div>

      {/* q10–q90 range */}
      <div className="text-xs text-muted-foreground tabular-nums">
        range {fmtCfs(day.q10)}–{fmtCfs(day.q90)} cfs
      </div>

      {/* Mason gage height forecast */}
      {day.ft50 !== null && (
        <div className="text-xs text-muted-foreground tabular-nums">
          Mason ~{fmtFt(day.ft50)} ft
          {day.ft10 !== null && day.ft90 !== null && (
            <span> ({fmtFt(day.ft10)}–{fmtFt(day.ft90)} ft)</span>
          )}
        </div>
      )}
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function LlanoCastellPage() {
  // Re-render countdown every minute
  const [, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 60_000)
    return () => clearInterval(id)
  }, [])

  const now = Date.now()
  const year = activeTripYear(now)
  const tw = tripWindow(year)
  const phase = tripPhase(year, now)
  const countdown = tripCountdown(year, now)

  const { mason, llano, masonFt, llanoFt, fetchedAtMs, isLoading, isStale, error, refresh } = useGaugeData()

  // Latest readings
  const latestMason = mason.length > 0 ? mason[mason.length - 1] : null
  const latestLlano = llano.length > 0 ? llano[llano.length - 1] : null

  // Latest gage heights (ft) — may be empty if parameter unavailable
  const latestMasonFt = masonFt.length > 0 ? masonFt[masonFt.length - 1] : null
  const latestLlanoFt = llanoFt.length > 0 ? llanoFt[llanoFt.length - 1] : null

  // Castell estimate
  const castellEst =
    latestMason && latestLlano
      ? estimateCastellFromGauges(latestMason.value, latestLlano.value, mason, fetchedAtMs || Date.now())
      : null

  // Recession rate (from Mason ~48h)
  const recRate = recessionRatePerDay(mason)

  // Rating curve — fit from paired Mason CFS/ft observations
  const masonRatingCurve = fitRatingCurve(mason, masonFt)

  // Forecast days
  const tripDates = [tw.thu, tw.fri, tw.sat]
  const forecastDays: DayForecast[] =
    latestMason && latestLlano
      ? forecastTripDays(
          latestMason.value,
          latestLlano.value,
          masonMrc,
          fetchedAtMs || Date.now(),
          tripDates,
          masonRatingCurve,
        )
      : []

  // Wading verdict
  const verdictData =
    forecastDays.length > 0
      ? wadingVerdict(forecastDays, phase === 'before' || phase === 'during')
      : null

  // Stacks-up
  const forecastAvg =
    forecastDays.length > 0
      ? forecastDays.reduce((s, d) => s + d.q50, 0) / forecastDays.length
      : 0
  const stacksUpData =
    forecastAvg > 0 ? stacksUp(historicalYears, forecastAvg, year) : null

  // Selected year for chart detail
  const [selectedYear, setSelectedYear] = useState<number | null>(null)
  const selectedHistYear = selectedYear
    ? historicalYears.find((y) => y.year === selectedYear)
    : null

  // "How this works" collapsible
  const [howOpen, setHowOpen] = useState(false)

  // Latest gauge timestamp
  const latestTs = latestMason?.dateTime
    ? new Date(latestMason.dateTime).toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        timeZone: 'America/Chicago',
      })
    : null

  // Refresh callback (force bypass cache)
  const handleRefresh = useCallback(() => {
    refresh()
  }, [refresh])

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="mx-auto max-w-3xl space-y-5 px-4 py-6">
      {/* ── Stale / error banner ─────────────────────────────────── */}
      {(error || isStale) && (
        <div
          className="flex items-start gap-2 rounded-md border border-border bg-muted px-4 py-3 text-sm text-muted-foreground"
          role="alert"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-secondary" />
          <span>
            {error
              ? `USGS fetch failed: ${error}. Showing cached data.`
              : 'Live data may be delayed (>1h old). Showing cached readings.'}
          </span>
        </div>
      )}

      {/* ── 1. HERO CARD ─────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Waves className="h-5 w-5 text-primary" />
            Castell Trip · Llano River
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Trip dates + countdown */}
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="text-xl font-bold text-foreground">
              {fmtTripDateRange(tw)}, {year}
            </span>
            <span className="text-sm text-muted-foreground">
              (Thu {fmtMonthDay(tw.thu)} – Sat {fmtMonthDay(tw.sat)})
            </span>
            <span
              className={cn(
                'rounded-full px-2.5 py-0.5 text-sm font-semibold',
                phase === 'during'
                  ? 'bg-secondary text-secondary-foreground'
                  : phase === 'after'
                    ? 'bg-muted text-muted-foreground'
                    : 'bg-primary text-primary-foreground',
              )}
            >
              {countdown}
            </span>
          </div>

          {/* Current Castell estimate */}
          <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
            {isLoading && !castellEst ? (
              <Skeleton className="h-8 w-40" />
            ) : castellEst ? (
              <div className="flex items-baseline gap-1.5">
                <span className="text-3xl font-bold tabular-nums text-foreground">
                  ~{fmtCfs(castellEst.q50)}
                </span>
                <span className="text-base text-muted-foreground">cfs est. Castell</span>
                <span
                  className={cn(
                    'ml-1 text-sm font-medium',
                    (recRate ?? 0) < -5 ? 'text-secondary' : 'text-muted-foreground',
                  )}
                >
                  {trendArrow(recRate)}
                </span>
              </div>
            ) : (
              <span className="text-sm text-muted-foreground">
                No gauge data — check cache or try refreshing.
              </span>
            )}

            {recRate !== null && (
              <span
                className={cn(
                  'text-sm tabular-nums',
                  recRate < -5 ? 'text-secondary' : 'text-muted-foreground',
                )}
              >
                {trendArrow(recRate)} falling {fmtRatePct(recRate)}
              </span>
            )}
          </div>

          {/* Mason gage height sub-label */}
          {latestMasonFt && (
            <p className="text-xs text-muted-foreground">
              Mason at{' '}
              <span className="tabular-nums font-medium text-foreground">
                {fmtFt(latestMasonFt.value)} ft
              </span>
            </p>
          )}

          {/* Updated + refresh */}
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {fetchedAtMs > 0 && <span>updated {fmtTimeAgo(fetchedAtMs)}</span>}
            <Button
              variant="ghost"
              size="sm"
              onClick={handleRefresh}
              disabled={isLoading}
              className="h-6 px-2 text-xs"
              aria-label="Refresh gauge data"
            >
              <RefreshCw className={cn('h-3 w-3 mr-1', isLoading && 'animate-spin')} />
              {isLoading ? 'Refreshing…' : 'Refresh'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ── 2. TRIP-DAY CARDS ────────────────────────────────────── */}
      <section aria-labelledby="trip-days-heading">
        <h2 id="trip-days-heading" className="mb-2 text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          Trip-day forecast
        </h2>
        {isLoading && forecastDays.length === 0 ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-28" />
            ))}
          </div>
        ) : forecastDays.length > 0 ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {forecastDays.map((day) => {
              const todayUtc = new Date().toISOString().slice(0, 10)
              const dayUtc = day.date.toISOString().slice(0, 10)
              const isToday = phase === 'during' && dayUtc === todayUtc
              const isObserved = phase === 'after'
              const isPushiest =
                verdictData?.hardestDay === day.label
              const isEasiest =
                verdictData?.easiestDay === day.label
              return (
                <DayCard
                  key={day.label}
                  day={day}
                  isToday={isToday}
                  isObserved={isObserved}
                  isPushiest={isPushiest}
                  isEasiest={isEasiest}
                />
              )
            })}
          </div>
        ) : (
          <Card>
            <CardContent className="py-6 text-center text-sm text-muted-foreground">
              Trip-day forecast unavailable — gauge data needed.
            </CardContent>
          </Card>
        )}
      </section>

      {/* ── 3. WADING VERDICT ────────────────────────────────────── */}
      {verdictData && (
        <Card className="border-2 border-accent">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Wading Conditions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {/* Primary verdict */}
            <p className="font-semibold text-foreground">
              {verdictData.brief}
            </p>

            {/* Flow basis */}
            <p className="text-sm text-muted-foreground">
              Forecast upper band (conservative): ~{fmtCfs(verdictData.primaryCfs)} cfs
              {verdictData.easiestDay && verdictData.hardestDay &&
                verdictData.easiestDay !== verdictData.hardestDay && (
                  <> · {verdictData.hardestDay} pushiest, {verdictData.easiestDay} easiest</>
                )}
            </p>

            {/* Safety line */}
            <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
              {verdictData.safetyLine}
            </p>
          </CardContent>
        </Card>
      )}

      {/* ── 4. HISTORY CHART ─────────────────────────────────────── */}
      <section aria-labelledby="history-heading">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base" id="history-heading">
              How {year} stacks up
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {/* Stacks-up summary line */}
            {stacksUpData && (
              <p className="text-sm text-muted-foreground">{stacksUpData.text}</p>
            )}

            {/* Chart */}
            {forecastAvg > 0 ? (
              <HistoryChart
                historicalYears={historicalYears}
                forecastAvg={forecastAvg}
                forecastYear={year}
                selectedYear={selectedYear}
                onSelectYear={setSelectedYear}
                masonRatingCurve={masonRatingCurve}
              />
            ) : (
              <Skeleton className="h-48 w-full" />
            )}

            {/* Year detail panel */}
            {selectedYear && (
              <div className="rounded-md border border-border bg-muted px-4 py-3 text-sm">
                {selectedYear === year && forecastDays.length > 0 ? (
                  <div>
                    <span className="font-semibold">{year} (forecast)</span>
                    <span className="ml-2 text-muted-foreground">
                      {fmtMonthDay(tw.thu)}–{fmtMonthDay(tw.sat)} ·{' '}
                      q50 avg ~{fmtCfs(forecastAvg)} cfs ·{' '}
                      range {fmtCfs(Math.min(...forecastDays.map((d) => d.q10)))}–
                      {fmtCfs(Math.max(...forecastDays.map((d) => d.q90)))} cfs
                    </span>
                  </div>
                ) : selectedHistYear ? (
                  <div>
                    <span className="font-semibold">{selectedHistYear.year}</span>
                    <span className="ml-2 text-muted-foreground">
                      {selectedHistYear.thu} – {selectedHistYear.sat} ·{' '}
                      avg {fmtCfs(selectedHistYear.avg_cfs ?? 0)} cfs ·{' '}
                      min {fmtCfs(selectedHistYear.min_cfs ?? 0)} · max{' '}
                      {fmtCfs(selectedHistYear.max_cfs ?? 0)} cfs
                      {selectedHistYear.note && (
                        <span className="ml-1 italic">({selectedHistYear.note})</span>
                      )}
                    </span>
                  </div>
                ) : null}
              </div>
            )}

            {/* Legend */}
            <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
              <div className="flex items-center gap-1">
                <span className="inline-block h-2.5 w-4 rounded-sm bg-primary opacity-80" />
                historical
              </div>
              <div className="flex items-center gap-1">
                <span className="inline-block h-2.5 w-4 rounded-sm bg-secondary opacity-80" />
                high water
              </div>
              <div className="flex items-center gap-1">
                <span className="inline-block h-2.5 w-4 rounded-sm bg-muted-foreground opacity-35" />
                drought
              </div>
              <div className="flex items-center gap-1">
                <span className="inline-block h-2.5 w-4 rounded-sm border border-dashed border-current" />
                forecast
              </div>
            </div>
          </CardContent>
        </Card>
      </section>

      {/* ── 5. FOOTER STRIP ──────────────────────────────────────── */}
      <footer className="space-y-3">
        {/* Gauge readings strip */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md border border-border bg-card px-4 py-3 text-sm">
          <span className="font-medium text-foreground">Observed gauges:</span>
          {latestMason ? (
            <span className="tabular-nums text-muted-foreground">
              Mason {fmtCfs(latestMason.value)} cfs
              {latestMasonFt && ` / ${fmtFt(latestMasonFt.value)} ft`}{' '}
              {recRate !== null ? trendArrow(recRate) : ''}
            </span>
          ) : (
            <span className="text-muted-foreground">Mason –</span>
          )}
          <span className="text-border">·</span>
          {latestLlano ? (
            <span className="tabular-nums text-muted-foreground">
              Llano {fmtCfs(latestLlano.value)} cfs
              {latestLlanoFt && ` / ${fmtFt(latestLlanoFt.value)} ft`}
            </span>
          ) : (
            <span className="text-muted-foreground">Llano –</span>
          )}
          {latestTs && (
            <>
              <span className="text-border">·</span>
              <span className="text-muted-foreground">as of {latestTs} CT</span>
            </>
          )}
        </div>

        {/* How this works */}
        <Collapsible open={howOpen} onOpenChange={setHowOpen}>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="text-xs text-muted-foreground">
              {howOpen ? '▲' : '▼'} How this works
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="mt-2 rounded-md border border-border bg-muted px-4 py-3 text-xs text-muted-foreground space-y-2">
              <p>
                <strong className="text-foreground">No gauge at Castell.</strong> There is no
                USGS gauge at Castell, TX. This tool <em>estimates</em> the flow there by
                interpolating between two real gauges: Mason (08150700, upstream) and Llano
                (08151500, downstream), using drainage-area weighting (DAR).
              </p>
              <p>
                <strong className="text-foreground">Formula.</strong> Castell drainage area
                ≈ 3,500 mi² sits between Mason (3,243 mi²) and Llano (4,197 mi²). The
                fractional reach position f ≈ 0.269 gives:{' '}
                <code className="rounded bg-card px-1 text-foreground">
                  Q_castell ≈ Q_mason + f × (Q_llano − Q_mason)
                </code>
                . The band is 20% spatial uncertainty on the lateral gain.
              </p>
              <p>
                <strong className="text-foreground">Forecast.</strong> Future values extend
                Mason flow via the Master Recession Curve (piecewise exponential, τ fast/medium/slow),
                then route through the DAR formula. Calibrated uncertainty bands from
                historical hindcast validation are applied.
              </p>
              <p>
                <strong className="text-foreground">These are estimates, not observations.</strong>{' '}
                Treat Castell values as informed estimates with ±20–30% uncertainty.
                Upstream rain events (not captured by this model) can significantly
                change conditions.
              </p>
              <p className="text-[10px]">
                Data: USGS IV API (CORS-enabled, no key). Gauge sites 08150700 and 08151500.
                Auto-refreshed every 15 min. Logic ported from{' '}
                <code>D:/kj-repos/llano</code> Python pipeline.
              </p>
            </div>
          </CollapsibleContent>
        </Collapsible>
      </footer>
    </div>
  )
}
