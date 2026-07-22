/**
 * USGS IV API Zod schemas.
 * API endpoint: https://waterservices.usgs.gov/nwis/iv/
 *   ?sites=08150700,08151500&parameterCd=00060&format=json&period=P7D
 *
 * Sentinel value -999999 is treated as null/missing.
 */
import { z } from 'zod'

export const MASON_SITE = '08150700'
export const LLANO_SITE = '08151500'
export const USGS_SENTINEL = -999999

// A single USGS IV value
export const UsgsValueSchema = z.object({
  dateTime: z.string(),
  value: z
    .string()
    .transform((s) => {
      const n = parseFloat(s)
      return isNaN(n) || n === USGS_SENTINEL ? null : n
    }),
  qualifiers: z.array(z.string()).optional(),
})

export type UsgsValue = z.infer<typeof UsgsValueSchema>

export const UsgsSiteValueSchema = z.object({
  value: z.array(UsgsValueSchema),
})

export const UsgsTimeSeriesSchema = z.object({
  sourceInfo: z.object({
    siteCode: z.array(
      z.object({
        value: z.string(),
      }),
    ),
    siteName: z.string().optional(),
  }),
  variable: z
    .object({
      variableDescription: z.string().optional(),
      // variableCode[0].value is e.g. "00060" (discharge) or "00065" (gage height)
      variableCode: z
        .array(z.object({ value: z.string() }))
        .optional(),
    })
    .optional(),
  values: z.array(UsgsSiteValueSchema),
})

export const UsgsResponseSchema = z.object({
  value: z.object({
    timeSeries: z.array(UsgsTimeSeriesSchema),
  }),
})

export type UsgsResponse = z.infer<typeof UsgsResponseSchema>

// Parsed gauge reading (after sentinel removal)
export const GaugeReadingSchema = z.object({
  dateTime: z.string(),
  value: z.number(),
})

// Cached API state (stored in localStorage under su:llano-castell)
export const CachedStateSchema = z.object({
  fetchedAtMs: z.number(),
  mason: z.array(GaugeReadingSchema),
  llano: z.array(GaugeReadingSchema),
  // Gage height (ft) — optional so old localStorage shapes still parse
  masonFt: z.array(GaugeReadingSchema).optional().default([]),
  llanoFt: z.array(GaugeReadingSchema).optional().default([]),
})

export type CachedState = z.infer<typeof CachedStateSchema>
