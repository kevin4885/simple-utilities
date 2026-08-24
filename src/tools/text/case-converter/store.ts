import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { z } from 'zod'

// ── Schema ────────────────────────────────────────────────────────────────────

const CaseConverterSchema = z.object({
  /** The text entered by the user. */
  text: z.string().default(''),
})

export type CaseConverterPersistedState = z.infer<typeof CaseConverterSchema>

// ── Store state ───────────────────────────────────────────────────────────────

export interface CaseConverterState extends CaseConverterPersistedState {
  setText: (text: string) => void
}

// ── Rehydration ───────────────────────────────────────────────────────────────

export function mergePersisted(
  persisted: unknown,
  current: CaseConverterState,
): CaseConverterState {
  const result = CaseConverterSchema.partial().safeParse(persisted)
  if (!result.success) return current
  return { ...current, ...result.data }
}

// ── Store ─────────────────────────────────────────────────────────────────────

export const useCaseConverterStore = create<CaseConverterState>()(
  persist(
    (set) => ({
      text: '',

      setText: (text) => set({ text }),
    }),
    {
      name: 'su:case-converter',
      merge: (persisted, current) =>
        mergePersisted(persisted, current as CaseConverterState),
    },
  ),
)
