import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { z } from 'zod'
import type { SliderMode } from './logic'
import { useAuth } from '@/lib/auth/useAuth'
import { useToolState } from '@/lib/cloudState/useToolState'

const HISTORY_LIMIT = 50

const ColorConverterSchema = z.object({
  inputValue: z.string().default('#0a1120'),
  sliderMode: z.enum(['rgb', 'hsl', 'hsv']).default('hsl'),
  history: z.array(z.string()).default([]),
})

export type ColorConverterPersistedState = z.infer<typeof ColorConverterSchema>

interface ColorConverterState {
  inputValue: string
  sliderMode: SliderMode
  history: string[]
  setInputValue: (v: string) => void
  setSliderMode: (m: SliderMode) => void
  addToHistory: (hex: string) => void
  clearHistory: () => void
}

const DEFAULT_STATE: ColorConverterPersistedState = {
  inputValue: '#0a1120',
  sliderMode: 'hsl',
  history: [],
}

// ── Local (signed-out) store — unchanged behavior/localStorage key ─────────────

const useLocalColorConverterStore = create<ColorConverterState>()(
  persist(
    (set) => ({
      ...DEFAULT_STATE,
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

// ── Cloud-backed state (Phase 3 of google-auth-cloud-state) ─────────────────────

const TOOL_ID = 'color-converter'

function useColorConverterStoreImpl(): ColorConverterState {
  const { status } = useAuth()
  const local = useLocalColorConverterStore()
  const cloud = useToolState(TOOL_ID, 'default', ColorConverterSchema, DEFAULT_STATE)

  if (status !== 'signed-in') return local

  const data = cloud.data
  return {
    inputValue: data.inputValue,
    sliderMode: data.sliderMode,
    history: data.history,
    setInputValue: (v) => cloud.setData({ ...data, inputValue: v }),
    setSliderMode: (m) => cloud.setData({ ...data, sliderMode: m }),
    addToHistory: (hex) => {
      const deduped = data.history.filter((h) => h !== hex)
      cloud.setData({ ...data, history: [hex, ...deduped].slice(0, HISTORY_LIMIT) })
    },
    clearHistory: () => cloud.setData({ ...data, history: [] }),
  }
}

export const useColorConverterStore = Object.assign(useColorConverterStoreImpl, {
  getState: () => useLocalColorConverterStore.getState(),
  setState: (partial: Partial<ColorConverterState>) => useLocalColorConverterStore.setState(partial),
})
