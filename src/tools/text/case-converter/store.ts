import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { z } from 'zod'
import { useAuth } from '@/lib/auth/useAuth'
import { useToolState } from '@/lib/cloudState/useToolState'

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

// ── Local (signed-out) store — unchanged behavior/localStorage key ─────────────

const useLocalCaseConverterStore = create<CaseConverterState>()(
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

// ── Cloud-backed state (Phase 3 of google-auth-cloud-state) ─────────────────────
//
// Single-blob tool: one `useToolState` row per user, `item_id = 'default'`.
// Signed out: the local store above, unchanged. Signed in: the Phase 1
// adapter, never redesigned here.

const TOOL_ID = 'case-converter'

const DEFAULT_STATE: CaseConverterPersistedState = {
  text: '',
}

function useCaseConverterStoreImpl(): CaseConverterState {
  const { status } = useAuth()
  const local = useLocalCaseConverterStore()
  const cloud = useToolState(TOOL_ID, 'default', CaseConverterSchema, DEFAULT_STATE)

  if (status !== 'signed-in') return local

  const data = cloud.data
  return {
    text: data.text,
    setText: (text) => cloud.setData({ ...data, text }),
  }
}

export const useCaseConverterStore = Object.assign(useCaseConverterStoreImpl, {
  getState: () => useLocalCaseConverterStore.getState(),
  setState: (partial: Partial<CaseConverterState>) => useLocalCaseConverterStore.setState(partial),
})
