import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { z } from 'zod'
import type { SliderMode } from './logic'

const ColorConverterSchema = z.object({
  inputValue: z.string().default('#0a1120'),
  sliderMode: z.enum(['rgb', 'hsl', 'hsv']).default('hsl'),
})

interface ColorConverterState {
  inputValue: string
  sliderMode: SliderMode
  setInputValue: (v: string) => void
  setSliderMode: (m: SliderMode) => void
}

export const useColorConverterStore = create<ColorConverterState>()(
  persist(
    (set) => ({
      inputValue: '#0a1120',
      sliderMode: 'hsl',
      setInputValue: (inputValue) => set({ inputValue }),
      setSliderMode: (sliderMode) => set({ sliderMode }),
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
