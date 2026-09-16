import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { z } from 'zod'
import { useAuth } from '@/lib/auth/useAuth'
import { useToolState } from '@/lib/cloudState/useToolState'

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

const DEFAULT_STATE: CronParserPersistedState = {
  expression: '*/15 9-17 * * MON-FRI',
}

// ── Local (signed-out) store — unchanged behavior/localStorage key ─────────────

const useLocalCronParserStore = create<CronParserState>()(
  persist(
    (set) => ({
      ...DEFAULT_STATE,

      setExpression: (expression) => set({ expression }),
    }),
    {
      name: 'su:cron-parser',
      merge: (persisted, current) =>
        mergePersisted(persisted, current as CronParserState),
    },
  ),
)

// ── Cloud-backed state (Phase 3 of google-auth-cloud-state) ─────────────────────

const TOOL_ID = 'cron-parser'

function useCronParserStoreImpl(): CronParserState {
  const { status } = useAuth()
  const local = useLocalCronParserStore()
  const cloud = useToolState(TOOL_ID, 'default', CronParserSchema, DEFAULT_STATE)

  if (status !== 'signed-in') return local

  const data = cloud.data
  return {
    expression: data.expression,
    setExpression: (expression) => cloud.setData({ ...data, expression }),
  }
}

export const useCronParserStore = Object.assign(useCronParserStoreImpl, {
  getState: () => useLocalCronParserStore.getState(),
  setState: (partial: Partial<CronParserState>) => useLocalCronParserStore.setState(partial),
})
