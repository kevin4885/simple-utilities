import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { z } from 'zod'
import { useAuth } from '@/lib/auth/useAuth'
import { useToolState } from '@/lib/cloudState/useToolState'
import { registerSweepTarget } from '@/lib/cloudState/importSweep.io'

export const PepperoniRollsSchema = z.object({
  rolls: z.number().int().min(1).max(96).default(24),
  ballWeight: z.number().int().min(30).max(300).default(80),
})

export type PepperoniRollsPersistedState = z.infer<typeof PepperoniRollsSchema>

export type PepperoniRollsState = PepperoniRollsPersistedState & {
  setRolls: (rolls: number) => void
  setBallWeight: (ballWeight: number) => void
}

/**
 * Merge persisted (possibly old/corrupt) state onto the current store state.
 * Exported as a pure function so it can be unit-tested independently.
 *
 * Uses the partial schema so missing fields are tolerated (treated as undefined
 * rather than failing the parse). Fields that are present but out-of-range still
 * fail and return current unchanged.
 */
export function mergePersisted(
  persisted: unknown,
  current: PepperoniRollsState,
): PepperoniRollsState {
  const partial = PepperoniRollsSchema.partial().safeParse(persisted)
  if (!partial.success) return current

  return {
    ...current,
    ...partial.data,
  }
}

const DEFAULT_STATE: PepperoniRollsPersistedState = {
  rolls: 24,
  ballWeight: 80,
}

// ── Local (signed-out) store — unchanged behavior/localStorage key ─────────────

const useLocalPepperoniRollsStore = create<PepperoniRollsState>()(
  persist(
    (set) => ({
      ...DEFAULT_STATE,

      setRolls: (rolls) => set({ rolls }),
      setBallWeight: (ballWeight) => set({ ballWeight }),
    }),
    {
      name: 'su:pepperoni-rolls',
      merge: (persisted, current) =>
        mergePersisted(persisted, current as PepperoniRollsState),
    },
  ),
)

// ── Cloud-backed state (Phase 3 of google-auth-cloud-state) ─────────────────────

const TOOL_ID = 'pepperoni-rolls'

// Import-sweep registration (Phase 3b of google-auth-cloud-state): on first
// sign-in, the sweep imports this tool's current local data into the cloud
// if no cloud row exists yet for this user/tool. See importSweep.io.ts.
registerSweepTarget({
  toolId: TOOL_ID,
  getLocalItems: () => [{ itemId: 'default', data: useLocalPepperoniRollsStore.getState() }],
  schema: PepperoniRollsSchema,
})

function usePepperoniRollsStoreImpl(): PepperoniRollsState {
  const { status } = useAuth()
  const local = useLocalPepperoniRollsStore()
  const cloud = useToolState(TOOL_ID, 'default', PepperoniRollsSchema, DEFAULT_STATE)

  if (status !== 'signed-in') return local

  const data = cloud.data
  return {
    rolls: data.rolls,
    ballWeight: data.ballWeight,
    setRolls: (rolls) => cloud.setData({ ...data, rolls }),
    setBallWeight: (ballWeight) => cloud.setData({ ...data, ballWeight }),
  }
}

export const usePepperoniRollsStore = Object.assign(usePepperoniRollsStoreImpl, {
  getState: () => useLocalPepperoniRollsStore.getState(),
  setState: (partial: Partial<PepperoniRollsState>) => useLocalPepperoniRollsStore.setState(partial),
})
