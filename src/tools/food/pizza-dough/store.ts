import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { z } from 'zod'
import { type ThicknessName } from './logic'

const PizzaDoughSchema = z.object({
  size: z.number().int().min(10).max(20).default(16),
  qty: z.number().int().min(1).max(10).default(6),
  thickness: z.enum(['thin', 'regular', 'thick']).default('regular'),
  glutenFree: z.boolean().default(false),
})

type PizzaDoughState = z.infer<typeof PizzaDoughSchema> & {
  setSize: (size: number) => void
  setQty: (qty: number) => void
  setThickness: (thickness: ThicknessName) => void
  setGlutenFree: (glutenFree: boolean) => void
}

export const usePizzaDoughStore = create<PizzaDoughState>()(
  persist(
    (set) => ({
      size: 16,
      qty: 6,
      thickness: 'regular' as ThicknessName,
      glutenFree: false,

      setSize: (size) => set({ size }),
      setQty: (qty) => set({ qty }),
      setThickness: (thickness) => set({ thickness }),
      setGlutenFree: (glutenFree) => set({ glutenFree }),
    }),
    {
      name: 'su:pizza-dough',
      // Validate on rehydrate to guard against corrupted localStorage
      merge: (persisted, current) => {
        const parsed = PizzaDoughSchema.safeParse(persisted)
        if (!parsed.success) return current
        return { ...current, ...parsed.data }
      },
    },
  ),
)
