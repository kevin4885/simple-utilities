import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { z } from 'zod'
import type { TimestampUnit } from './logic'
import { useAuth } from '@/lib/auth/useAuth'
import { useToolState } from '@/lib/cloudState/useToolState'
import { registerSweepTarget } from '@/lib/cloudState/importSweep.io'

// ── Schema ────────────────────────────────────────────────────────────────────

const TimestampConverterSchema = z.object({
  /** The raw timestamp string entered by the user (timestamp → date direction). */
  timestampInput: z.string().default(''),
  /** The unit override chosen by the user (or auto-detected). */
  unitOverride: z.enum(['seconds', 'millis', 'micros']).default('seconds'),
  /** Whether the unit is in "auto" mode (null = auto, otherwise locked). */
  unitLocked: z.boolean().default(false),
  /** The datetime-local string entered by the user (date → timestamp direction). */
  dateInput: z.string().default(''),
})

export type TimestampConverterPersistedState = z.infer<typeof TimestampConverterSchema>

// ── Store state ───────────────────────────────────────────────────────────────

export interface TimestampConverterState extends TimestampConverterPersistedState {
  setTimestampInput: (timestampInput: string) => void
  setUnitOverride: (unitOverride: TimestampUnit) => void
  setUnitLocked: (unitLocked: boolean) => void
  setDateInput: (dateInput: string) => void
}

// ── Rehydration ───────────────────────────────────────────────────────────────

export function mergePersisted(
  persisted: unknown,
  current: TimestampConverterState,
): TimestampConverterState {
  const result = TimestampConverterSchema.partial().safeParse(persisted)
  if (!result.success) return current
  return { ...current, ...result.data }
}

const DEFAULT_STATE: TimestampConverterPersistedState = {
  timestampInput: '',
  unitOverride: 'seconds',
  unitLocked: false,
  dateInput: '',
}

// ── Local (signed-out) store — unchanged behavior/localStorage key ─────────────

const useLocalTimestampConverterStore = create<TimestampConverterState>()(
  persist(
    (set) => ({
      ...DEFAULT_STATE,

      setTimestampInput: (timestampInput) => set({ timestampInput }),
      setUnitOverride: (unitOverride) => set({ unitOverride }),
      setUnitLocked: (unitLocked) => set({ unitLocked }),
      setDateInput: (dateInput) => set({ dateInput }),
    }),
    {
      name: 'su:timestamp-converter',
      merge: (persisted, current) =>
        mergePersisted(persisted, current as TimestampConverterState),
    },
  ),
)

// ── Cloud-backed state (Phase 3 of google-auth-cloud-state) ─────────────────────

const TOOL_ID = 'timestamp-converter'

// Import-sweep registration (Phase 3b of google-auth-cloud-state): on first
// sign-in, the sweep imports this tool's current local data into the cloud
// if no cloud row exists yet for this user/tool. See importSweep.io.ts.
registerSweepTarget({
  toolId: TOOL_ID,
  getLocalItems: () => [{ itemId: 'default', data: useLocalTimestampConverterStore.getState() }],
  schema: TimestampConverterSchema,
})

function useTimestampConverterStoreImpl(): TimestampConverterState {
  const { status } = useAuth()
  const local = useLocalTimestampConverterStore()
  const cloud = useToolState(TOOL_ID, 'default', TimestampConverterSchema, DEFAULT_STATE)

  if (status !== 'signed-in') return local

  const data = cloud.data
  return {
    timestampInput: data.timestampInput,
    unitOverride: data.unitOverride,
    unitLocked: data.unitLocked,
    dateInput: data.dateInput,
    setTimestampInput: (timestampInput) => cloud.setData({ ...data, timestampInput }),
    setUnitOverride: (unitOverride) => cloud.setData({ ...data, unitOverride }),
    setUnitLocked: (unitLocked) => cloud.setData({ ...data, unitLocked }),
    setDateInput: (dateInput) => cloud.setData({ ...data, dateInput }),
  }
}

export const useTimestampConverterStore = Object.assign(useTimestampConverterStoreImpl, {
  getState: () => useLocalTimestampConverterStore.getState(),
  setState: (partial: Partial<TimestampConverterState>) => useLocalTimestampConverterStore.setState(partial),
})
