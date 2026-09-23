import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { z } from 'zod'
import type { SliderMode } from './logic'

const HISTORY_LIMIT = 50

const ColorConverterSchema = z.object({
  inputValue: z.string().default('#0a1120'),
  sliderMode: z.enum(['rgb', 'hsl', 'hsv']).default('hsl'),
  history: z.array(z.string()).default([]),
})

interface ColorConverterState {
  inputValue: string
  sliderMode: SliderMode
  history: string[]
  setInputValue: (v: string) => void
  setSliderMode: (m: SliderMode) => void
  addToHistory: (hex: string) => void
  clearHistory: () => void
}

export const useColorConverterStore = create<ColorConverterState>()(
  persist(
    (set) => ({
      inputValue: '#0a1120',
      sliderMode: 'hsl',
      history: [],
      setInputValue: (inputValue) => set({ inputValue }),
      setSliderMode: (sliderMode) => set({ sliderMode }),
      addToHistory: (hex) =>
        set((state) => {
          const deduped = state.history.filter((h) => h !== hex)
          return { history: [hex, ...deduped].slice(0, HISTORY_LIMIT) }
        }),
      clearHistory: () => set({ history: [] }),
    }),
    {
      name: 'su:color-converter',
      merge: (persisted, current) => {
        const parsed = ColorConverterSchema.safeParse(persisted)
        if (!parsed.success) return current
        return { ...current, ...parsed.data }
      },
    },
  ),
)
