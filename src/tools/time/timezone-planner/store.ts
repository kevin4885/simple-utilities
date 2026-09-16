import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { z } from 'zod'
import { isValidIanaZone, getFriendlyLabel, getTodayDateStr, MAX_ZONES } from './logic'
import { useAuth } from '@/lib/auth/useAuth'
import { useToolState } from '@/lib/cloudState/useToolState'
import { registerSweepTarget } from '@/lib/cloudState/importSweep.io'

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

const DEFAULT_STATE: TimezonePlannerPersistedState = {
  zones: [],
  selectedDate: '',
}

/** Shared zone-list mutation helpers, used by both the local and cloud paths
 *  so the add/remove/move logic (bounds checks, dedup, IANA validation)
 *  lives in exactly one place. */
function computeAddZone(zones: StoredZone[], zone: string): StoredZone[] | null {
  if (zones.length >= MAX_ZONES) return null
  if (zones.some((z) => z.zone === zone)) return null
  if (!isValidIanaZone(zone)) return null
  const label = getFriendlyLabel(zone)
  return [...zones, { zone, label, isLocal: false }]
}

function computeMoveZoneUp(zones: StoredZone[], zone: string): StoredZone[] | null {
  const idx = zones.findIndex((z) => z.zone === zone)
  if (idx <= 0) return null
  const next = [...zones]
  ;[next[idx - 1], next[idx]] = [next[idx], next[idx - 1]]
  return next
}

function computeMoveZoneDown(zones: StoredZone[], zone: string): StoredZone[] | null {
  const idx = zones.findIndex((z) => z.zone === zone)
  if (idx < 0 || idx >= zones.length - 1) return null
  const next = [...zones]
  ;[next[idx], next[idx + 1]] = [next[idx + 1], next[idx]]
  return next
}

// ── Local (signed-out) store — unchanged behavior/localStorage key ─────────────

const useLocalTimezonePlannerStore = create<TimezonePlannerState>()(
  persist(
    (set, get) => ({
      ...DEFAULT_STATE,

      setZones: (zones) => set({ zones }),

      addZone: (zone) => {
        const next = computeAddZone(get().zones, zone)
        if (next) set({ zones: next })
      },

      removeZone: (zone) => {
        set((s) => ({ zones: s.zones.filter((z) => z.zone !== zone) }))
      },

      moveZoneUp: (zone) => {
        set((s) => {
          const next = computeMoveZoneUp(s.zones, zone)
          return next ? { zones: next } : s
        })
      },

      moveZoneDown: (zone) => {
        set((s) => {
          const next = computeMoveZoneDown(s.zones, zone)
          return next ? { zones: next } : s
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

// ── Cloud-backed state (Phase 3 of google-auth-cloud-state) ─────────────────────

const TOOL_ID = 'timezone-planner'

// Import-sweep registration (Phase 3b of google-auth-cloud-state): on first
// sign-in, the sweep imports this tool's current local data into the cloud
// if no cloud row exists yet for this user/tool. See importSweep.io.ts.
registerSweepTarget({
  toolId: TOOL_ID,
  getLocalItems: () => [{ itemId: 'default', data: useLocalTimezonePlannerStore.getState() }],
  schema: TimezonePlannerSchema,
})

function useTimezonePlannerStoreImpl(): TimezonePlannerState {
  const { status } = useAuth()
  const local = useLocalTimezonePlannerStore()
  const cloud = useToolState(TOOL_ID, 'default', TimezonePlannerSchema, DEFAULT_STATE)

  if (status !== 'signed-in') return local

  const data = cloud.data
  return {
    zones: data.zones,
    selectedDate: data.selectedDate,
    setZones: (zones) => cloud.setData({ ...data, zones }),
    addZone: (zone) => {
      const next = computeAddZone(data.zones, zone)
      if (next) cloud.setData({ ...data, zones: next })
    },
    removeZone: (zone) =>
      cloud.setData({ ...data, zones: data.zones.filter((z) => z.zone !== zone) }),
    moveZoneUp: (zone) => {
      const next = computeMoveZoneUp(data.zones, zone)
      if (next) cloud.setData({ ...data, zones: next })
    },
    moveZoneDown: (zone) => {
      const next = computeMoveZoneDown(data.zones, zone)
      if (next) cloud.setData({ ...data, zones: next })
    },
    setSelectedDate: (date) => cloud.setData({ ...data, selectedDate: date }),
  }
}

export const useTimezonePlannerStore = Object.assign(useTimezonePlannerStoreImpl, {
  getState: () => useLocalTimezonePlannerStore.getState(),
  setState: (partial: Partial<TimezonePlannerState>) => useLocalTimezonePlannerStore.setState(partial),
})

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
