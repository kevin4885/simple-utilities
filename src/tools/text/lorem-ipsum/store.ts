import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { z } from 'zod'
import type { GenerateUnit, OutputFormat } from './logic'
import { useAuth } from '@/lib/auth/useAuth'
import { useToolState } from '@/lib/cloudState/useToolState'

// ── Schema ────────────────────────────────────────────────────────────────────

const LoremIpsumSchema = z.object({
  /** Generation unit selector */
  unit: z.enum(['paragraphs', 'sentences', 'words']).default('paragraphs'),
  /** How many units to generate */
  count: z.number().int().min(1).max(2000).default(3),
  /** Prepend the classic "Lorem ipsum dolor sit amet…" opening */
  classicStart: z.boolean().default(true),
  /** Output format */
  format: z.enum(['plain', 'html-p', 'html-ul']).default('plain'),
})

export type LoremIpsumPersistedState = z.infer<typeof LoremIpsumSchema>

// ── Store state ───────────────────────────────────────────────────────────────

export interface LoremIpsumState extends LoremIpsumPersistedState {
  setUnit: (unit: GenerateUnit) => void
  setCount: (count: number) => void
  setClassicStart: (classicStart: boolean) => void
  setFormat: (format: OutputFormat) => void
}

// ── Rehydration ───────────────────────────────────────────────────────────────

export function mergePersisted(
  persisted: unknown,
  current: LoremIpsumState,
): LoremIpsumState {
  const result = LoremIpsumSchema.partial().safeParse(persisted)
  if (!result.success) return current
  return { ...current, ...result.data }
}

// ── Local (signed-out) store — unchanged behavior/localStorage key ─────────────

const useLocalLoremIpsumStore = create<LoremIpsumState>()(
  persist(
    (set) => ({
      unit: 'paragraphs' as GenerateUnit,
      count: 3,
      classicStart: true,
      format: 'plain' as OutputFormat,

      setUnit: (unit) => set({ unit }),
      setCount: (count) => set({ count }),
      setClassicStart: (classicStart) => set({ classicStart }),
      setFormat: (format) => set({ format }),
    }),
    {
      name: 'su:lorem-ipsum',
      merge: (persisted, current) =>
        mergePersisted(persisted, current as LoremIpsumState),
    },
  ),
)

// ── Cloud-backed state (Phase 3 of google-auth-cloud-state) ─────────────────────

const TOOL_ID = 'lorem-ipsum'

const DEFAULT_STATE: LoremIpsumPersistedState = {
  unit: 'paragraphs',
  count: 3,
  classicStart: true,
  format: 'plain',
}

function useLoremIpsumStoreImpl(): LoremIpsumState {
  const { status } = useAuth()
  const local = useLocalLoremIpsumStore()
  const cloud = useToolState(TOOL_ID, 'default', LoremIpsumSchema, DEFAULT_STATE)

  if (status !== 'signed-in') return local

  const data = cloud.data
  return {
    unit: data.unit,
    count: data.count,
    classicStart: data.classicStart,
    format: data.format,
    setUnit: (unit) => cloud.setData({ ...data, unit }),
    setCount: (count) => cloud.setData({ ...data, count }),
    setClassicStart: (classicStart) => cloud.setData({ ...data, classicStart }),
    setFormat: (format) => cloud.setData({ ...data, format }),
  }
}

export const useLoremIpsumStore = Object.assign(useLoremIpsumStoreImpl, {
  getState: () => useLocalLoremIpsumStore.getState(),
  setState: (partial: Partial<LoremIpsumState>) => useLocalLoremIpsumStore.setState(partial),
})
