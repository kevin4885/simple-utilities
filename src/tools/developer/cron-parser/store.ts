import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { z } from 'zod'

// ── Schema ────────────────────────────────────────────────────────────────────

const CronParserSchema = z.object({
  /** The raw cron expression string (user input). */
  expression: z.string().default('*/15 9-17 * * MON-FRI'),
})

export type CronParserPersistedState = z.infer<typeof CronParserSchema>

// ── Store state ───────────────────────────────────────────────────────────────

export interface CronParserState extends CronParserPersistedState {
  setExpression: (expression: string) => void
}

// ── Rehydration ───────────────────────────────────────────────────────────────

export function mergePersisted(
  persisted: unknown,
  current: CronParserState,
): CronParserState {
  const result = CronParserSchema.partial().safeParse(persisted)
  if (!result.success) return current
  return { ...current, ...result.data }
}

// ── Store ─────────────────────────────────────────────────────────────────────

export const useCronParserStore = create<CronParserState>()(
  persist(
    (set) => ({
      expression: '*/15 9-17 * * MON-FRI',

      setExpression: (expression) => set({ expression }),
    }),
    {
      name: 'su:cron-parser',
      merge: (persisted, current) =>
        mergePersisted(persisted, current as CronParserState),
    },
  ),
)
