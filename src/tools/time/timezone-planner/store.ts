import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { z } from 'zod'
import { isValidIanaZone, getFriendlyLabel, getTodayDateStr, MAX_ZONES } from './logic'

// ── Schema ────────────────────────────────────────────────────────────────────

/**
 * A stored zone entry. We persist zone + label + isLocal; the component rebuilds
 * the display data (offset, cell times) from these on each render.
 */
const StoredZoneSchema = z.object({
  zone: z
    .string()
    .min(1)
    .refine((v) => isValidIanaZone(v), {
      message: 'Invalid IANA timezone identifier',
    }),
  label: z.string().min(1),
  isLocal: z.boolean(),
})

const TimezonePlannerSchema = z.object({
  /** Ordered list of selected zones (first = reference). Max 10. */
  zones: z.array(StoredZoneSchema).default([]),
  /**
   * Selected date as "YYYY-MM-DD". Empty string → use today.
   * We store it as a string so rehydration doesn't depend on current date.
   */
  selectedDate: z.string().default(''),
})

export type StoredZone = z.infer<typeof StoredZoneSchema>
export type TimezonePlannerPersistedState = z.infer<typeof TimezonePlannerSchema>

// ── Store state ───────────────────────────────────────────────────────────────

export interface TimezonePlannerState extends TimezonePlannerPersistedState {
  setZones: (zones: StoredZone[]) => void
  addZone: (zone: string) => void
  removeZone: (zone: string) => void
  moveZoneUp: (zone: string) => void
  moveZoneDown: (zone: string) => void
  setSelectedDate: (date: string) => void
}

// ── Rehydration ───────────────────────────────────────────────────────────────

export function mergePersisted(
  persisted: unknown,
  current: TimezonePlannerState,
): TimezonePlannerState {
  const result = TimezonePlannerSchema.partial().safeParse(persisted)
  if (!result.success) return current

  const data = result.data

  // Extra guard: filter out any zone entries whose zone string fails runtime
  // Intl validation (belt-and-suspenders on top of the Zod refine).
  const safeZones = data.zones
    ? data.zones.filter((z) => isValidIanaZone(z.zone))
    : current.zones

  return {
    ...current,
    ...data,
    zones: safeZones,
  }
}

// ── Store ─────────────────────────────────────────────────────────────────────

export const useTimezonePlannerStore = create<TimezonePlannerState>()(
  persist(
    (set, get) => ({
      zones: [],
      selectedDate: '',

      setZones: (zones) => set({ zones }),

      addZone: (zone) => {
        const { zones } = get()
        if (zones.length >= MAX_ZONES) return
        if (zones.some((z) => z.zone === zone)) return
        if (!isValidIanaZone(zone)) return
        const label = getFriendlyLabel(zone)
        set({ zones: [...zones, { zone, label, isLocal: false }] })
      },

      removeZone: (zone) => {
        set((s) => ({ zones: s.zones.filter((z) => z.zone !== zone) }))
      },

      moveZoneUp: (zone) => {
        set((s) => {
          const idx = s.zones.findIndex((z) => z.zone === zone)
          if (idx <= 0) return s
          const next = [...s.zones]
          ;[next[idx - 1], next[idx]] = [next[idx], next[idx - 1]]
          return { zones: next }
        })
      },

      moveZoneDown: (zone) => {
        set((s) => {
          const idx = s.zones.findIndex((z) => z.zone === zone)
          if (idx < 0 || idx >= s.zones.length - 1) return s
          const next = [...s.zones]
          ;[next[idx], next[idx + 1]] = [next[idx + 1], next[idx]]
          return { zones: next }
        })
      },

      setSelectedDate: (date) => set({ selectedDate: date }),
    }),
    {
      name: 'su:timezone-planner',
      merge: (persisted, current) =>
        mergePersisted(persisted, current as TimezonePlannerState),
    },
  ),
)

// ── Bootstrap helper ──────────────────────────────────────────────────────────

/**
 * Add the user's local timezone as the first zone (labeled "(you)") if it is not
 * already present. Call this once on mount to seed the default state.
 */
export function ensureLocalZone(
  zones: StoredZone[],
  setZones: (z: StoredZone[]) => void,
): void {
  const localZone = Intl.DateTimeFormat().resolvedOptions().timeZone
  if (!zones.some((z) => z.zone === localZone)) {
    const label = getFriendlyLabel(localZone)
    setZones([{ zone: localZone, label: `${label} (you)`, isLocal: true }, ...zones])
  }
}

/**
 * Return the effective date string: persisted value if set, otherwise today.
 */
export function getEffectiveDate(selectedDate: string): string {
  return selectedDate || getTodayDateStr()
}
