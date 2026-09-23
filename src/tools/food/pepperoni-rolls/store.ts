import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { z } from 'zod'

export const PepperoniRollsSchema = z.object({
  rolls: z.number().int().min(1).max(96).default(24),
  ballWeight: z.number().int().min(30).max(300).default(80),
})

export type PepperoniRollsState = z.infer<typeof PepperoniRollsSchema> & {
  setRolls: (rolls: number) => void
  setBallWeight: (ballWeight: number) => void
}

/**
 * Merge persisted (possibly old/corrupt) state onto the current store state.
 * Exported as a pure function so it can be unit-tested independently.
 *
 * Uses the partial schema so missing fields are tolerated (treated as undefined)
 * rather than failing the parse. Fields that are present but out-of-range still
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

export const usePepperoniRollsStore = create<PepperoniRollsState>()(
  persist(
    (set) => ({
      rolls: 24,
      ballWeight: 80,

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
