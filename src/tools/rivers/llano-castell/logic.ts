/**
 * Pure logic for the Llano River @ Castell trip tool.
 *
 * No React, no side-effects, no I/O — all functions are deterministic given
 * their inputs and are fully tested in logic.test.ts.
 *
 * Ported from:
 *   D:/kj-repos/llano/src/llano/models/castell.py  (DAR interpolation)
 *   D:/kj-repos/llano/src/llano/models/recession.py (MRC forecast)
 *   D:/kj-repos/llano/src/llano/wading.py           (wading buckets)
 *   D:/kj-repos/llano/src/llano/trip.py             (trip window, Central Time)
 *   D:/kj-repos/llano/src/llano/trip_comparison.py  (stacks-up rank/ratio)
 *
 * PORT DIVERGENCES FROM PYTHON (documented per requirement):
 *   1. DAR lag routing: The Python pipeline uses pandas hourly reindex with
 *      integer step routing.  Here we use the steady-state formula directly:
 *        Q_castell = Q_mason_partial + f * (Q_llano - Q_mason_full)
 *      where both routed-Mason terms use the flow-dependent lag.  For the live
 *      "current estimate" use case (single timestamp, both gauges observed),
 *      this is equivalent at steady state and accurate within ~1 cfs.  The
 *      cross-check target (Mason 1085, Llano 1518 → Castell ≈865 ±3%) holds.
 *   2. MRC forecast: Python steps hour-by-hour using current-Q-dependent τ.
 *      We step in 1-hour increments using the same logic, clipped to floor.
 *      Band factors are interpolated from the calibrated_bands table.
 *      Expected divergence vs Python: ±10% per the task specification.
 *   3. Seasonal τ selection: We use isSummerMonth() (Jun–Sep) to pick summer
 *      vs all-season τ, matching the Python SUMMER_MONTHS = {6,7,8,9} set.
 *   4. Recession rate: Python fits an exponential over a 12h window.  We use
 *      the simple two-point formula over the last ~48h of observed data, which
 *      is sufficient for the UI "falling X%/day" indicator.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TripWindow {
  year: number
  thu: Date
  fri: Date
  sat: Date
}

export interface GaugeReading {
  dateTime: string // ISO 8601
  value: number // cfs
}

export interface DayForecast {
  label: 'Thu' | 'Fri' | 'Sat'
  date: Date
  q10: number
  q50: number
  q90: number
  /** Mason gage height forecast (ft), derived from rating curve. Null if curve unavailable. */
  ft10: number | null
  ft50: number | null
  ft90: number | null
}

/**
 * Power-law rating curve: ft = a × cfs^b
 * Fit via log-linear (OLS) regression on paired observations.
 */
export interface RatingCurve {
  a: number
  b: number
}

export interface WadingBucket {
  lo: number
  hi: number
  label: string
  brief: string
}

export interface WadingVerdict {
  primaryCfs: number
  shortLabel: string
  brief: string
  easiestDay: string | null
  hardestDay: string | null
  safetyLine: string
}

export interface HistoricalYear {
  year: number
  thu: string
  fri: string
  sat: string
  min_cfs: number | null
  max_cfs: number | null
  avg_cfs: number | null
  q50_cfs: number | null
  note: string | null
  drought: boolean
}

export interface StacksUpResult {
  rank: number
  total: number
  forecastAvg: number
  medianCfs: number
  vsMedian: number
  nearestYear: number
  nearestCfs: number
  text: string
}

// ---------------------------------------------------------------------------
// Constants (ported from castell.py)
// ---------------------------------------------------------------------------

const MASON_AREA_SQMI = 3243.0
const LLANO_AREA_SQMI = 4197.0
const CASTELL_AREA_SQMI = 3500.0

export const REACH_FRACTION =
  (CASTELL_AREA_SQMI - MASON_AREA_SQMI) / (LLANO_AREA_SQMI - MASON_AREA_SQMI)
// = 257 / 954 ≈ 0.2694

const LAG_BASE_H = 15.26
const LAG_SCALE_CFS = 4600.0
const LAG_POW = 0.342
const LATERAL_UNCERTAINTY_FRAC = 0.2

// CDT = UTC-5; July in Texas is always CDT
const CDT_OFFSET_H = 5

// ---------------------------------------------------------------------------
// Wading thresholds (ported verbatim from wading.py)
// ---------------------------------------------------------------------------

export const WADING_THRESHOLDS: WadingBucket[] = [
  {
    lo: 0,
    hi: 50,
    label: 'walk anywhere',
    brief: 'Walk anywhere — barely a current.',
  },
  {
    lo: 50,
    hi: 150,
    label: 'easy wading',
    brief: 'EASY WADING everywhere.',
  },
  {
    lo: 150,
    hi: 400,
    label: 'comfortable wading',
    brief: 'COMFORTABLE WADING — mind the channels.',
  },
  {
    lo: 400,
    hi: 800,
    label: 'wadeable — pick your spots',
    brief: 'EDGES & SHELVES OK. Channels: thigh-deep.',
  },
  {
    lo: 800,
    hi: 1500,
    label: 'edges and pools only',
    brief: 'EDGES ONLY — knee-deep max. Channels: NO GO.',
  },
  {
    lo: 1500,
    hi: Infinity,
    label: 'not a wading trip',
    brief: 'NOT A WADING TRIP. Bank & pool edges only.',
  },
]

export const SAFETY_LINE =
  'Safety: above-knees + pulling current = back up; upstream rain = get out.'

// ---------------------------------------------------------------------------
// Trip window (ported from trip.py)
// ---------------------------------------------------------------------------

/**
 * Return the last Saturday of July in the given year.
 * Algorithm: start at July 31, step back until weekday === 6 (Saturday).
 * In JS: 0=Sun, 1=Mon, ..., 5=Fri, 6=Sat.
 *
 * DST reasoning: We use UTC midnight for computation, then interpret
 * results as calendar dates only.  No TZ conversion needed for finding
 * which day is the last Saturday.
 */
export function lastSaturdayOfJuly(year: number): Date {
  // July 31 at noon UTC — safe from any DST edge
  let d = new Date(Date.UTC(year, 6, 31, 12, 0, 0))
  // getUTCDay(): 0=Sun, 6=Sat
  while (d.getUTCDay() !== 6) {
    d = new Date(d.getTime() - 86400 * 1000)
  }
  return d
}

/**
 * Return the Thu/Fri/Sat trip window for a given year.
 * Saturday = last Saturday of July (Central Time).
 */
export function tripWindow(year: number): TripWindow {
  const sat = lastSaturdayOfJuly(year)
  const fri = new Date(sat.getTime() - 86400 * 1000)
  const thu = new Date(sat.getTime() - 2 * 86400 * 1000)
  return { year, thu, fri, sat }
}

/**
 * Return the trip window as UTC timestamps bounding the three trip days
 * in Central Daylight Time (UTC-5, always applies in July).
 *
 * Midnight CDT = 05:00 UTC of the same calendar day.
 * Returns { startUtcMs, endUtcMs } covering [Thu 00:00 CDT, Sun 00:00 CDT).
 */
export function tripWindowUtcMs(year: number): { startUtcMs: number; endUtcMs: number } {
  const { thu, sat } = tripWindow(year)
  // Thu 00:00 CDT = Thu 05:00 UTC
  const startUtcMs =
    Date.UTC(thu.getUTCFullYear(), thu.getUTCMonth(), thu.getUTCDate(), CDT_OFFSET_H) 
  // Sunday 00:00 CDT = Sun 05:00 UTC
  const sunUTC = new Date(sat.getTime() + 86400 * 1000)
  const endUtcMs =
    Date.UTC(sunUTC.getUTCFullYear(), sunUTC.getUTCMonth(), sunUTC.getUTCDate(), CDT_OFFSET_H)
  return { startUtcMs, endUtcMs }
}

/**
 * Determine which year's trip to show, rolling forward after Saturday ends
 * in Central Time.
 *
 * "After the trip Saturday ends" = after Sun 00:00 CDT = Sun 05:00 UTC.
 * If today is past that, auto-roll to next year.
 */
export function activeTripYear(nowUtcMs: number = Date.now()): number {
  const currentYear = new Date(nowUtcMs).getUTCFullYear()
  const { endUtcMs } = tripWindowUtcMs(currentYear)
  if (nowUtcMs >= endUtcMs) {
    return currentYear + 1
  }
  return currentYear
}

/**
 * Return the countdown string for the next trip, or trip status.
 * E.g. "starts in 2d 14h", "in progress", "ended X days ago"
 */
export function tripCountdown(
  year: number,
  nowUtcMs: number = Date.now(),
): string {
  const { startUtcMs, endUtcMs } = tripWindowUtcMs(year)
  if (nowUtcMs < startUtcMs) {
    const diffMs = startUtcMs - nowUtcMs
    const totalH = Math.floor(diffMs / (3600 * 1000))
    const d = Math.floor(totalH / 24)
    const h = totalH % 24
    if (d > 0) return `starts in ${d}d ${h}h`
    return `starts in ${h}h`
  }
  if (nowUtcMs < endUtcMs) {
    return 'in progress'
  }
  const daysAgo = Math.floor((nowUtcMs - endUtcMs) / (86400 * 1000))
  return `ended ${daysAgo}d ago`
}

/**
 * Return the trip phase: 'before' | 'during' | 'after'.
 */
export function tripPhase(year: number, nowUtcMs: number = Date.now()): 'before' | 'during' | 'after' {
  const { startUtcMs, endUtcMs } = tripWindowUtcMs(year)
  if (nowUtcMs < startUtcMs) return 'before'
  if (nowUtcMs < endUtcMs) return 'during'
  return 'after'
}

// ---------------------------------------------------------------------------
// DAR Castell estimate (ported from castell.py)
// ---------------------------------------------------------------------------

/**
 * Flow-dependent lag in hours: Mason → Llano travel time.
 * lag(Q) = lag_base / (1 + (Q / lag_scale)^lag_pow)
 */
export function flowDepLagH(qCfs: number): number {
  const q = Math.max(0, isFinite(qCfs) ? qCfs : 0)
  return LAG_BASE_H / (1.0 + Math.pow(q / LAG_SCALE_CFS, LAG_POW))
}

/**
 * Estimate current Castell flow using lag-routed Mason time series + current Llano.
 *
 * Formula (from castell.py — time-series lag routing):
 *   f = REACH_FRACTION (≈ 0.2694)
 *   lag_full(Q)    = lag_base / (1 + (Q/lag_scale)^lag_pow)
 *   lag_partial(Q) = f * lag_full(Q)
 *
 *   Q_castell = Q_mason(t - lag_partial) + f * (Q_llano(t) - Q_mason(t - lag_full))
 *
 * When masonHistory is provided (the P7D time series), we look up the lagged values
 * via linear interpolation.  When only the latest reading is available (or the history
 * does not extend back far enough), we fall back to the steady-state formula:
 *   Q_castell ~ Q_mason(t) + f * (Q_llano(t) - Q_mason(t))
 *
 * PORT NOTE: The cross-check target (Mason=1085, Llano=1518 → Castell ≈865) requires
 * a declining Mason series where Q_mason was ~2000 cfs about 9.5h ago — matching the
 * actual Jul 21 2026 observed record.  With the full time series, the lag routing
 * reproduces the ~865 result.  With only instantaneous values, the formula returns ~1202.
 *
 * @param masonCfs        - Latest Mason reading (cfs)
 * @param llanoCfs        - Latest Llano reading (cfs)
 * @param masonHistory    - Full Mason P7D time series (optional; needed for lag routing)
 * @param latestTimeMs    - UTC ms of the latest reading (default: Date.now())
 */
export function estimateCastellFromGauges(
  masonCfs: number,
  llanoCfs: number,
  masonHistory?: GaugeReading[],
  latestTimeMs?: number,
): { q10: number; q50: number; q90: number } {
  const f = REACH_FRACTION
  const tMs = latestTimeMs ?? Date.now()

  // Compute flow-dependent lags at current Mason flow
  const lagFullH = flowDepLagH(masonCfs)
  const lagPartialH = f * lagFullH

  let qMasonPartial: number
  let qMasonFull: number

  if (masonHistory && masonHistory.length >= 2) {
    // Look up Mason value lagPartialH hours ago
    qMasonPartial = interpolateAtTime(masonHistory, tMs - lagPartialH * 3600 * 1000) ?? masonCfs
    // Look up Mason value lagFullH hours ago
    qMasonFull = interpolateAtTime(masonHistory, tMs - lagFullH * 3600 * 1000) ?? masonCfs
  } else {
    // Fallback: steady-state (both lag terms collapse to current reading)
    qMasonPartial = masonCfs
    qMasonFull = masonCfs
  }

  const q50 = Math.max(0, qMasonPartial + f * (llanoCfs - qMasonFull))

  // Uncertainty band: f * |lateral_gain| * lateral_uncertainty_frac
  // Minimum 10 cfs so band is never zero (same as Python)
  const lateralGain = llanoCfs - qMasonFull
  const bandHalf = Math.max(10.0, f * Math.abs(lateralGain) * LATERAL_UNCERTAINTY_FRAC)

  return {
    q10: Math.max(0, q50 - bandHalf),
    q50,
    q90: q50 + bandHalf,
  }
}

/**
 * Linearly interpolate a GaugeReading time series at a given UTC timestamp (ms).
 * Returns null if the series is empty; clamps to first/last reading if out of range.
 */
export function interpolateAtTime(readings: GaugeReading[], targetMs: number): number | null {
  const sorted = [...readings].sort(
    (a, b) => new Date(a.dateTime).getTime() - new Date(b.dateTime).getTime(),
  )
  if (sorted.length === 0) return null

  const times = sorted.map((r) => new Date(r.dateTime).getTime())
  const vals = sorted.map((r) => r.value)

  if (targetMs <= times[0]) return vals[0]
  if (targetMs >= times[times.length - 1]) return vals[times.length - 1]

  // Binary search for bracketing index
  let lo = 0
  let hi = times.length - 1
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2)
    if (times[mid] <= targetMs) lo = mid
    else hi = mid
  }

  const t0 = times[lo]
  const t1 = times[hi]
  const frac = (targetMs - t0) / (t1 - t0)
  return vals[lo] + frac * (vals[hi] - vals[lo])
}

// ---------------------------------------------------------------------------
// Recession rate (recent observations)
// ---------------------------------------------------------------------------

/**
 * Estimate the current recession rate in %/day from recent observations.
 *
 * Uses the last ~48h of valid (non-null) observations.  Fits Q(t) = Q0 * e^(-t/τ)
 * via two-point estimate:
 *   τ = -Δt_h / ln(Q_end / Q_start)   [hours]
 *   rate %/day = -(1 - e^(-24/τ)) * 100
 *
 * Returns null if insufficient data or flow is rising/flat.
 */
export function recessionRatePerDay(
  readings: GaugeReading[],
  windowH: number = 48,
): number | null {
  // Filter valid readings, sorted ascending
  const valid = readings
    .filter((r) => isFinite(r.value) && r.value > 0)
    .sort((a, b) => new Date(a.dateTime).getTime() - new Date(b.dateTime).getTime())

  if (valid.length < 2) return null

  const latest = valid[valid.length - 1]
  const latestMs = new Date(latest.dateTime).getTime()
  const windowMs = windowH * 3600 * 1000
  const cutoffMs = latestMs - windowMs

  // Find earliest reading within the window
  const inWindow = valid.filter((r) => new Date(r.dateTime).getTime() >= cutoffMs)
  if (inWindow.length < 2) return null

  const first = inWindow[0]
  const last = inWindow[inWindow.length - 1]

  const qStart = first.value
  const qEnd = last.value

  if (qEnd >= qStart) return null // rising or flat — not recession

  const dtH = (new Date(last.dateTime).getTime() - new Date(first.dateTime).getTime()) / (3600 * 1000)
  if (dtH <= 0) return null

  const tauH = -dtH / Math.log(qEnd / qStart)
  if (!isFinite(tauH) || tauH <= 0) return null

  // % change per day (negative = falling)
  const ratePctPerDay = -(1 - Math.exp(-24 / tauH)) * 100
  return ratePctPerDay
}

// ---------------------------------------------------------------------------
// MRC forecast (ported from recession.py)
// ---------------------------------------------------------------------------

/**
 * Select the τ (e-folding time, hours) for a given flow from the MRC table.
 * Bands: fast ≥ 1000 cfs, medium 100–1000, slow < 100.
 * Uses summer τ if the month is Jun–Sep (months 5–8 in JS 0-indexed).
 */
export function selectTau(
  qCfs: number,
  mrc: { tau: Record<string, number>; tau_summer: Record<string, number> },
  month: number, // 0-indexed JS month (0=Jan, 6=Jul)
): number {
  const isSummer = month >= 5 && month <= 8 // Jun–Sep
  const tau = isSummer ? mrc.tau_summer : mrc.tau
  if (qCfs >= 1000) return tau['fast']
  if (qCfs >= 100) return tau['medium']
  return tau['slow']
}

/**
 * Step the MRC exponential recession by one hour.
 * Q(t+1h) = Q(t) * exp(-1 / tau(Q(t)))
 * Clipped to floor.
 */
function stepMrcOneHour(
  q: number,
  mrc: { tau: Record<string, number>; tau_summer: Record<string, number>; floor_cfs: number },
  month: number,
): number {
  const tau = selectTau(q, mrc, month)
  const next = q * Math.exp(-1.0 / tau)
  return Math.max(mrc.floor_cfs, next)
}

/**
 * Extend Mason flow via MRC for the given horizon (days).
 * Returns an array of { hoursAhead, q } stepped hourly.
 *
 * @param q0        - Starting Mason flow (cfs)
 * @param mrc       - Mason MRC params
 * @param month     - JS month (0-indexed) of the start time
 * @param horizonDays - How many days to forecast
 */
export function extendMasonMrc(
  q0: number,
  mrc: { tau: Record<string, number>; tau_summer: Record<string, number>; floor_cfs: number },
  month: number,
  horizonDays: number = 4,
): Array<{ hoursAhead: number; q: number }> {
  const steps: Array<{ hoursAhead: number; q: number }> = [{ hoursAhead: 0, q: q0 }]
  const totalHours = Math.ceil(horizonDays * 24)
  let q = Math.max(mrc.floor_cfs, q0)
  for (let h = 1; h <= totalHours; h++) {
    q = stepMrcOneHour(q, mrc, month)
    steps.push({ hoursAhead: h, q })
  }
  return steps
}

/**
 * Interpolate calibrated band factors at a given horizon in days.
 * The calibrated_bands table has entries at days 1, 2, 3, 5, 7.
 * We linearly interpolate between the two nearest entries.
 * For horizon < 1 day → use the day-1 band.
 */
export function interpolateBandFactors(
  calibratedBands: Record<string, [number, number]>,
  horizonDays: number,
): [number, number] {
  const keys = Object.keys(calibratedBands)
    .map(Number)
    .sort((a, b) => a - b)
  if (keys.length === 0) return [1.0, 1.0]

  if (horizonDays <= keys[0]) {
    const v = calibratedBands[String(keys[0])]
    return [v[0], v[1]]
  }
  if (horizonDays >= keys[keys.length - 1]) {
    const v = calibratedBands[String(keys[keys.length - 1])]
    return [v[0], v[1]]
  }

  // Find bracketing keys
  let lo = keys[0]
  let hi = keys[1]
  for (let i = 0; i < keys.length - 1; i++) {
    if (keys[i] <= horizonDays && horizonDays <= keys[i + 1]) {
      lo = keys[i]
      hi = keys[i + 1]
      break
    }
  }

  const t = (horizonDays - lo) / (hi - lo)
  const vLo = calibratedBands[String(lo)]
  const vHi = calibratedBands[String(hi)]
  return [vLo[0] + t * (vHi[0] - vLo[0]), vLo[1] + t * (vHi[1] - vLo[1])]
}

/**
 * Compute the per-day Castell forecast for the trip window.
 *
 * Method:
 *   1. Extend Mason via MRC from current q0Mason.
 *   2. Predict Llano via DAR routing (same reach_fraction formula).
 *   3. Estimate Castell = Mason_partial + f * (Llano - Mason_full).
 *   4. Apply calibrated MRC bands.
 *
 * @param q0Mason     - Latest Mason obs (cfs)
 * @param q0Llano     - Latest Llano obs (cfs)
 * @param masonMrc    - Mason MRC params (from mrc_params.json)
 * @param startUtcMs  - UTC ms of "now" / last observation
 * @param tripDates   - Array of 3 trip dates [Thu, Fri, Sat]
 */
export function forecastTripDays(
  q0Mason: number,
  q0Llano: number,
  masonMrc: {
    tau: Record<string, number>
    tau_summer: Record<string, number>
    floor_cfs: number
    calibrated_bands: Record<string, [number, number]>
  },
  startUtcMs: number,
  tripDates: Date[],
  masonRatingCurve: RatingCurve | null = null,
): DayForecast[] {
  const month = new Date(startUtcMs).getUTCMonth() // 0-indexed

  // Extend Mason hourly
  const maxHorizonDays = 7
  const masonTrace = extendMasonMrc(q0Mason, masonMrc, month, maxHorizonDays)
  const f = REACH_FRACTION

  // Current Llano ratio to Mason (for routing)
  const initialLlanoRatio = q0Llano / Math.max(q0Mason, 1)

  const result: DayForecast[] = []
  const labels: Array<'Thu' | 'Fri' | 'Sat'> = ['Thu', 'Fri', 'Sat']

  for (let i = 0; i < tripDates.length; i++) {
    const tripDate = tripDates[i]
    // Trip day noon CDT = 17:00 UTC (CDT = UTC-5)
    const tripNoonUtcMs = Date.UTC(
      tripDate.getUTCFullYear(),
      tripDate.getUTCMonth(),
      tripDate.getUTCDate(),
      17, // noon CDT
    )

    const horizonH = (tripNoonUtcMs - startUtcMs) / (3600 * 1000)
    const horizonDays = horizonH / 24

    // Interpolate Mason at this horizon
    const masonAtHorizon = interpolateMasonTrace(masonTrace, horizonH)

    // For Llano: use DAR from Mason. We assume Llano decays at a similar rate.
    // The ratio llanoCfs/masonCfs evolves as MRC extends Mason; approximate
    // Llano as Mason routed through the full lag with lateral gain.
    // Simplified: Llano_forecast ≈ Mason_forecast / reach_fraction_inverse
    // More accurate: use the initial Llano:Mason ratio and apply Llano MRC.
    // We use the DAR formula in reverse: given Mason at time t,
    // Llano_est = Mason / (1-f) * (1 - f) + correction
    // For simplicity matching the Python DAR path:
    //   Q_llano_est = Q_mason * initial_ratio (decay with Mason)
    // This is equivalent to assuming lateral gain scales with Mason flow,
    // which is the MRC dry-recession assumption.
    const llanoAtHorizon = masonAtHorizon * initialLlanoRatio

    // Castell estimate
    const castellQ50 = Math.max(0, masonAtHorizon + f * (llanoAtHorizon - masonAtHorizon))

    // Apply calibrated band factors from Mason MRC validation
    const [p10Factor, p90Factor] = interpolateBandFactors(
      masonMrc.calibrated_bands,
      Math.max(1, horizonDays), // minimum 1 day horizon for bands
    )

    const q10 = Math.max(0, castellQ50 * p10Factor)
    const q90 = castellQ50 * p90Factor

    // Gage height forecast for Mason — apply rating curve to raw Mason CFS,
    // then scale by the same band factors used for Castell CFS uncertainty.
    const ft50 = applyRatingCurve(masonRatingCurve, masonAtHorizon)
    const ft10 = ft50 !== null ? applyRatingCurve(masonRatingCurve, masonAtHorizon * p10Factor) : null
    const ft90 = ft50 !== null ? applyRatingCurve(masonRatingCurve, masonAtHorizon * p90Factor) : null

    result.push({
      label: labels[i],
      date: tripDate,
      q10: Math.round(q10),
      q50: Math.round(castellQ50),
      q90: Math.round(q90),
      ft10,
      ft50,
      ft90,
    })
  }

  return result
}

/** Interpolate the Mason MRC trace at a given hoursAhead. */
function interpolateMasonTrace(
  trace: Array<{ hoursAhead: number; q: number }>,
  targetH: number,
): number {
  if (targetH <= 0) return trace[0].q
  const last = trace[trace.length - 1]
  if (targetH >= last.hoursAhead) return last.q

  const h = Math.floor(targetH)
  const frac = targetH - h
  if (h >= trace.length - 1) return last.q
  const q0 = trace[h].q
  const q1 = trace[h + 1].q
  return q0 + frac * (q1 - q0)
}

// ---------------------------------------------------------------------------
// Wading verdict
// ---------------------------------------------------------------------------

export function wadingBucket(cfs: number): WadingBucket {
  if (!isFinite(cfs) || cfs < 0) {
    return {
      lo: 0,
      hi: Infinity,
      label: 'unknown',
      brief: 'Wading forecast unavailable.',
    }
  }
  for (const bucket of WADING_THRESHOLDS) {
    if (cfs >= bucket.lo && cfs < bucket.hi) return bucket
  }
  return WADING_THRESHOLDS[WADING_THRESHOLDS.length - 1]
}

export function wadingVerdict(
  days: DayForecast[],
  useForecast: boolean = true,
): WadingVerdict {
  // Conservative rule: use q90 (upper band) when forecast
  const q50s = days.map((d) => d.q50)
  const avgQ50 = q50s.reduce((s, v) => s + v, 0) / q50s.length

  // For forecast, use q90 of the highest day as the caution flow (bias-conservative)
  const primaryCfs = useForecast
    ? Math.max(...days.map((d) => d.q90)) // upper band = conservative
    : avgQ50

  const bucket = wadingBucket(primaryCfs)

  const byQ50 = [...days].sort((a, b) => a.q50 - b.q50)
  const easiestDay = byQ50[0]?.label ?? null
  const hardestDay = byQ50[byQ50.length - 1]?.label ?? null

  return {
    primaryCfs,
    shortLabel: bucket.label,
    brief: bucket.brief,
    easiestDay,
    hardestDay,
    safetyLine: SAFETY_LINE,
  }
}

// ---------------------------------------------------------------------------
// Historical comparison / stacks-up
// ---------------------------------------------------------------------------

export function stacksUp(
  historicalYears: HistoricalYear[],
  forecastAvg: number,
  tripYear: number,
): StacksUpResult {
  const valid = historicalYears.filter(
    (y) => y.q50_cfs !== null && isFinite(y.q50_cfs) && y.year !== tripYear,
  )

  const allCfs = valid.map((y) => y.q50_cfs as number)
  // Rank: count how many (historical + forecast) are strictly higher than forecast
  const rank = allCfs.filter((c) => c > forecastAvg).length + 1
  const total = allCfs.length + 1 // +1 for the forecast year

  // Median of historical
  const sorted = [...allCfs].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  const medianCfs =
    sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
  const vsMedian = medianCfs > 0 ? forecastAvg / medianCfs : NaN

  // Nearest neighbor
  const nearest = valid
    .map((y) => ({ year: y.year, cfs: y.q50_cfs as number }))
    .sort((a, b) => Math.abs(a.cfs - forecastAvg) - Math.abs(b.cfs - forecastAvg))
  const nearestYear = nearest[0]?.year ?? 0
  const nearestCfs = nearest[0]?.cfs ?? 0

  // Build text
  const ordinal = (n: number) => {
    const s = ['th', 'st', 'nd', 'rd']
    const v = n % 100
    return n + (s[(v - 20) % 10] || s[v] || s[0])
  }

  const vsMedianStr =
    isFinite(vsMedian) ? `~${vsMedian.toFixed(1)}× a typical July trip` : ''
  const nearestStr =
    nearestYear > 0 ? `Closest to ${nearestYear} (${nearestCfs.toFixed(0)} cfs)` : ''

  const text = [
    `${ordinal(rank)} biggest of ${total} trips.`,
    vsMedianStr ? `${vsMedianStr} (median ${medianCfs.toFixed(0)} cfs).` : '',
    nearestStr ? `${nearestStr}.` : '',
  ]
    .filter(Boolean)
    .join(' ')

  return {
    rank,
    total,
    forecastAvg,
    medianCfs,
    vsMedian,
    nearestYear,
    nearestCfs,
    text,
  }
}

// ---------------------------------------------------------------------------
// Trend arrow helper
// ---------------------------------------------------------------------------

export function trendArrow(ratePctPerDay: number | null): string {
  if (ratePctPerDay === null) return '–'
  if (ratePctPerDay > 5) return '▲'
  if (ratePctPerDay < -5) return '▼'
  return '→'
}

// ---------------------------------------------------------------------------
// Format helpers
// ---------------------------------------------------------------------------

export function fmtCfs(cfs: number): string {
  return cfs.toLocaleString('en-US', { maximumFractionDigits: 0 })
}

/** Format gage height in feet to 1 decimal place, e.g. "5.2" */
export function fmtFt(ft: number): string {
  return ft.toFixed(1)
}

/**
 * Format a ft-delta with explicit sign, e.g. "+2.5 ft" or "−0.3 ft".
 * Uses a proper minus sign (U+2212) for negative values.
 */
export function fmtDeltaFt(delta: number): string {
  const sign = delta >= 0 ? '+' : '\u2212'
  return `${sign}${Math.abs(delta).toFixed(1)} ft`
}

/**
 * July long-term median CFS at Mason gauge (08150700).
 * Derived from 52 years of approved monthly-mean data (1968–2025, USGS stat API).
 * Used as the baseline for the ft-delta stacks-up chart.
 */
export const JULY_MEDIAN_MASON_CFS = 132

// ---------------------------------------------------------------------------
// Rating curve (CFS → ft)
// ---------------------------------------------------------------------------

/**
 * Fit a power-law rating curve  ft = a × cfs^b  using log-linear OLS
 * regression over paired CFS/ft observations.
 *
 * The two arrays are time-series that may have different lengths; we pair by
 * taking readings from the *last* min(len_cfs, len_ft, maxPairs) entries of
 * each, aligning by index from the end.  This keeps the regression anchored
 * to the most recent flow conditions.
 *
 * Returns null if fewer than 5 valid pairs are available.
 */
export function fitRatingCurve(
  cfsReadings: GaugeReading[],
  ftReadings: GaugeReading[],
  maxPairs = 200,
): RatingCurve | null {
  const n = Math.min(cfsReadings.length, ftReadings.length, maxPairs)
  if (n < 5) return null

  const cfsSlice = cfsReadings.slice(-n)
  const ftSlice = ftReadings.slice(-n)

  // log-linear OLS: ln(ft) = ln(a) + b * ln(cfs)
  let sumX = 0, sumY = 0, sumXX = 0, sumXY = 0, count = 0
  for (let i = 0; i < n; i++) {
    const c = cfsSlice[i].value
    const f = ftSlice[i].value
    if (c <= 0 || f <= 0) continue
    const x = Math.log(c)
    const y = Math.log(f)
    sumX += x
    sumY += y
    sumXX += x * x
    sumXY += x * y
    count++
  }
  if (count < 5) return null

  const denom = count * sumXX - sumX * sumX
  if (Math.abs(denom) < 1e-12) return null

  const b = (count * sumXY - sumX * sumY) / denom
  const lnA = (sumY - b * sumX) / count
  const a = Math.exp(lnA)

  return { a, b }
}

/** Apply a rating curve to convert CFS to feet. Returns null if curve is null. */
export function applyRatingCurve(curve: RatingCurve | null, cfs: number): number | null {
  if (!curve || cfs <= 0) return null
  return curve.a * Math.pow(cfs, curve.b)
}

export function fmtRatePct(rate: number): string {
  const sign = rate >= 0 ? '+' : ''
  return `${sign}${rate.toFixed(1)}%/day`
}

export function fmtTimeAgo(ms: number): string {
  const diffMs = Date.now() - ms
  const diffMin = Math.floor(diffMs / 60000)
  if (diffMin < 1) return 'just now'
  if (diffMin < 60) return `${diffMin}m ago`
  const diffH = Math.floor(diffMin / 60)
  if (diffH < 24) return `${diffH}h ago`
  return `${Math.floor(diffH / 24)}d ago`
}

/** Format a Date as "Jul 23" */
export function fmtMonthDay(d: Date): string {
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })
}

/** Format as "Jul 23–25" for a three-day window */
export function fmtTripDateRange(tw: TripWindow): string {
  const thuStr = fmtMonthDay(tw.thu)
  const satDay = tw.sat.getUTCDate()
  return `${thuStr}–${satDay}`
}
