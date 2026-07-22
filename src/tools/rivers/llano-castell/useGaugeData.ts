/**
 * React hook: fetch USGS IV data for Mason (08150700) and Llano (08151500).
 *
 * - Fetches P7D of discharge (parameter 00060) from the USGS IV API.
 * - Zod-validates the response.
 * - Caches in Zustand store (→ localStorage su:llano-castell) with 15-min TTL.
 * - Returns { mason, llano, fetchedAtMs, isLoading, isStale, error }.
 * - Auto-refreshes every 15 min while mounted.
 * - Manual refresh via the returned `refresh` function.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { GaugeReading } from './logic'
import { UsgsResponseSchema, MASON_SITE, LLANO_SITE, USGS_SENTINEL } from './schemas'
import { useLlanoCastellStore } from './store'

const USGS_URL =
  `https://waterservices.usgs.gov/nwis/iv/?sites=${MASON_SITE},${LLANO_SITE}` +
  `&parameterCd=00060,00065&format=json&period=P7D`

const CACHE_TTL_MS = 15 * 60 * 1000 // 15 minutes
const STALE_WARN_MS = 60 * 60 * 1000 // warn if >1h old

export interface UseGaugeDataResult {
  mason: GaugeReading[]
  llano: GaugeReading[]
  /** Gage height in feet for Mason gauge (00065), empty if unavailable */
  masonFt: GaugeReading[]
  /** Gage height in feet for Llano gauge (00065), empty if unavailable */
  llanoFt: GaugeReading[]
  fetchedAtMs: number
  isLoading: boolean
  /** Data is older than the TTL — could not refresh */
  isStale: boolean
  error: string | null
  refresh: () => void
}

function parseTimeSeries(ts: unknown[]): Record<string, GaugeReading[]> {
  const result: Record<string, GaugeReading[]> = {}
  // The validated response has already been parsed by UsgsResponseSchema
  // here we re-parse from the already-validated raw API shape.
  // Key format: "<siteCode>_<paramCode>" e.g. "08150700_00060"
  for (const series of ts as Array<{
    sourceInfo: { siteCode: Array<{ value: string }> }
    variable?: { variableCode?: Array<{ value: string }> }
    values: Array<{ value: Array<{ dateTime: string; value: string | number | null }> }>
  }>) {
    const siteCode = series.sourceInfo?.siteCode?.[0]?.value ?? ''
    const paramCode = series.variable?.variableCode?.[0]?.value ?? ''
    const key = paramCode ? `${siteCode}_${paramCode}` : siteCode
    const readings: GaugeReading[] = []
    const values = series.values?.[0]?.value ?? []
    for (const v of values) {
      const raw = v.value
      const num = typeof raw === 'number' ? raw : parseFloat(String(raw ?? ''))
      if (isNaN(num) || num === USGS_SENTINEL || num < 0) continue
      readings.push({ dateTime: v.dateTime, value: num })
    }
    result[key] = readings
  }
  return result
}

export function useGaugeData(): UseGaugeDataResult {
  const { fetchedAtMs, mason, llano, masonFt, llanoFt, setCache } = useLlanoCastellStore()

  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const doFetch = useCallback(async () => {
    // If cache is still fresh AND we already have gage-height data, skip.
    // The masonFt.length check forces a refetch when the cached data predates
    // the 00065 parameter being added (old cache has no feet data).
    if (Date.now() - fetchedAtMs < CACHE_TTL_MS && mason.length > 0 && masonFt.length > 0) return

    if (abortRef.current) abortRef.current.abort()
    abortRef.current = new AbortController()

    setIsLoading(true)
    setError(null)

    try {
      const res = await fetch(USGS_URL, { signal: abortRef.current.signal })
      if (!res.ok) throw new Error(`USGS HTTP ${res.status}`)
      const raw: unknown = await res.json()

      const parsed = UsgsResponseSchema.safeParse(raw)
      if (!parsed.success) {
        throw new Error('USGS response validation failed: ' + parsed.error.message.slice(0, 120))
      }

      const bysite = parseTimeSeries(parsed.data.value.timeSeries)
      const masonData   = bysite[`${MASON_SITE}_00060`] ?? bysite[MASON_SITE] ?? []
      const llanoData   = bysite[`${LLANO_SITE}_00060`] ?? bysite[LLANO_SITE] ?? []
      const masonFtData = bysite[`${MASON_SITE}_00065`] ?? []
      const llanoFtData = bysite[`${LLANO_SITE}_00065`] ?? []

      if (masonData.length === 0 && llanoData.length === 0) {
        throw new Error('USGS returned no valid readings for either gauge')
      }

      setCache({
        fetchedAtMs: Date.now(),
        mason: masonData,
        llano: llanoData,
        masonFt: masonFtData,
        llanoFt: llanoFtData,
      })
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') return
      setError(e instanceof Error ? e.message : 'Unknown fetch error')
    } finally {
      setIsLoading(false)
    }
  }, [fetchedAtMs, mason.length, masonFt.length, setCache])

  // Fetch on mount and on TTL tick
  useEffect(() => {
    void doFetch()
    intervalRef.current = setInterval(() => void doFetch(), CACHE_TTL_MS)
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
      if (abortRef.current) abortRef.current.abort()
    }
  }, [doFetch])

  const isStale = fetchedAtMs > 0 && Date.now() - fetchedAtMs > STALE_WARN_MS

  return {
    mason,
    llano,
    masonFt,
    llanoFt,
    fetchedAtMs,
    isLoading,
    isStale,
    error,
    refresh: () => {
      // Force-bypass cache TTL
      useLlanoCastellStore.setState({ fetchedAtMs: 0 })
      void doFetch()
    },
  }
}
