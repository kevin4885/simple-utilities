import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { z } from 'zod'
import { type ThicknessName, DEFAULT_HYDRATION_REGULAR, DEFAULT_HYDRATION_GF } from './logic'
import { useAuth } from '@/lib/auth/useAuth'
import { useToolState } from '@/lib/cloudState/useToolState'
import { registerSweepTarget } from '@/lib/cloudState/importSweep.io'

/** Integer percentage defaults exposed so the UI and tests can reference them. */
export const DEFAULT_HYDRATION_PCT_REGULAR = Math.round(DEFAULT_HYDRATION_REGULAR * 100) // 62
export const DEFAULT_HYDRATION_PCT_GF = Math.round(DEFAULT_HYDRATION_GF * 100) // 80

// No .default() on hydration: old persisted state that is missing the field fails
// the full schema parse and enters the GF-aware fallback branch in mergePersisted.
export const PizzaDoughSchema = z.object({
  size: z.number().int().min(10).max(20).default(16),
  qty: z.number().int().min(1).max(10).default(6),
  thickness: z.enum(['thin', 'regular', 'thick']).default('regular'),
  glutenFree: z.boolean().default(false),
  hydration: z.number().int().min(50).max(90),
})

export type PizzaDoughPersistedState = z.infer<typeof PizzaDoughSchema>

export type PizzaDoughState = PizzaDoughPersistedState & {
  setSize: (size: number) => void
  setQty: (qty: number) => void
  setThickness: (thickness: ThicknessName) => void
  setGlutenFree: (glutenFree: boolean) => void
  setHydration: (hydration: number) => void
}

/**
 * Merge persisted (possibly old) state onto the current store state.
 * Exported as a pure function so it can be unit-tested independently.
 *
 * Handles rehydration gracefully:
 *  - Old state missing `hydration` → derives the correct default from `glutenFree`
 *  - Fully corrupt state → returns `current` unchanged
 */
export function mergePersisted(persisted: unknown, current: PizzaDoughState): PizzaDoughState {
  // Use the partial schema so missing fields are tolerated (treated as undefined
  // rather than failing the parse). Note: fields that are present but out-of-range
  // still fail and return current unchanged.
  const partial = PizzaDoughSchema.partial().safeParse(persisted)
  if (!partial.success) return current

  const gf = partial.data.glutenFree ?? current.glutenFree
  const fallbackHydration = gf ? DEFAULT_HYDRATION_PCT_GF : DEFAULT_HYDRATION_PCT_REGULAR

  return {
    ...current,
    ...partial.data,
    // If hydration is absent from old state, fall back to the mode-appropriate default.
    hydration: partial.data.hydration ?? fallbackHydration,
  }
}

const DEFAULT_STATE: PizzaDoughPersistedState = {
  size: 16,
  qty: 6,
  thickness: 'regular' as ThicknessName,
  glutenFree: false,
  hydration: DEFAULT_HYDRATION_PCT_REGULAR,
}

// ── Local (signed-out) store — unchanged behavior/localStorage key ─────────────

const useLocalPizzaDoughStore = create<PizzaDoughState>()(
  persist(
    (set) => ({
      ...DEFAULT_STATE,

      setSize: (size) => set({ size }),
      setQty: (qty) => set({ qty }),
      setThickness: (thickness) => set({ thickness }),
      // Toggling gluten-free unconditionally resets hydration to that mode's default.
      // The user can then adjust it from that baseline.
      setGlutenFree: (glutenFree) =>
        set({
          glutenFree,
          hydration: glutenFree ? DEFAULT_HYDRATION_PCT_GF : DEFAULT_HYDRATION_PCT_REGULAR,
        }),
      setHydration: (hydration) => set({ hydration }),
    }),
    {
      name: 'su:pizza-dough',
      merge: (persisted, current) => mergePersisted(persisted, current as PizzaDoughState),
    },
  ),
)

// ── Cloud-backed state (Phase 3 of google-auth-cloud-state) ─────────────────────

const TOOL_ID = 'pizza-dough'

// Import-sweep registration (Phase 3b of google-auth-cloud-state): on first
// sign-in, the sweep imports this tool's current local data into the cloud
// if no cloud row exists yet for this user/tool. See importSweep.io.ts.
registerSweepTarget({
  toolId: TOOL_ID,
  getLocalItems: () => [{ itemId: 'default', data: useLocalPizzaDoughStore.getState() }],
  schema: PizzaDoughSchema,
})

function usePizzaDoughStoreImpl(): PizzaDoughState {
  const { status } = useAuth()
  const local = useLocalPizzaDoughStore()
  const cloud = useToolState(TOOL_ID, 'default', PizzaDoughSchema, DEFAULT_STATE)

  if (status !== 'signed-in') return local

  const data = cloud.data
  return {
    size: data.size,
    qty: data.qty,
    thickness: data.thickness,
    glutenFree: data.glutenFree,
    hydration: data.hydration,
    setSize: (size) => cloud.setData({ ...data, size }),
    setQty: (qty) => cloud.setData({ ...data, qty }),
    setThickness: (thickness) => cloud.setData({ ...data, thickness }),
    setGlutenFree: (glutenFree) =>
      cloud.setData({
        ...data,
        glutenFree,
        hydration: glutenFree ? DEFAULT_HYDRATION_PCT_GF : DEFAULT_HYDRATION_PCT_REGULAR,
      }),
    setHydration: (hydration) => cloud.setData({ ...data, hydration }),
  }
}

export const usePizzaDoughStore = Object.assign(usePizzaDoughStoreImpl, {
  getState: () => useLocalPizzaDoughStore.getState(),
  setState: (partial: Partial<PizzaDoughState>) => useLocalPizzaDoughStore.setState(partial),
})
