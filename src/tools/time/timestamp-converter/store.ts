import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { z } from 'zod'
import type { TimestampUnit } from './logic'

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

// ── Store ─────────────────────────────────────────────────────────────────────

export const useTimestampConverterStore = create<TimestampConverterState>()(
  persist(
    (set) => ({
      timestampInput: '',
      unitOverride: 'seconds',
      unitLocked: false,
      dateInput: '',

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
