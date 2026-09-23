import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { z } from 'zod'
import { type ThicknessName, DEFAULT_HYDRATION_REGULAR, DEFAULT_HYDRATION_GF } from './logic'

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

export type PizzaDoughState = z.infer<typeof PizzaDoughSchema> & {
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

export const usePizzaDoughStore = create<PizzaDoughState>()(
  persist(
    (set) => ({
      size: 16,
      qty: 6,
      thickness: 'regular' as ThicknessName,
      glutenFree: false,
      hydration: DEFAULT_HYDRATION_PCT_REGULAR,

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
