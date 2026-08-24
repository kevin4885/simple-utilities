import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { z } from 'zod'
import type { GenerateUnit, OutputFormat } from './logic'

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

// ── Store ─────────────────────────────────────────────────────────────────────

export const useLoremIpsumStore = create<LoremIpsumState>()(
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
