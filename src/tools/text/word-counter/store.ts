import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { z } from 'zod'

// ── Schema ────────────────────────────────────────────────────────────────────

const WordCounterSchema = z.object({
  /** The text entered by the user. */
  text: z.string().default(''),
  /** Whether to exclude stopwords from the word frequency table. */
  excludeStopwords: z.boolean().default(true),
})

export type WordCounterPersistedState = z.infer<typeof WordCounterSchema>

// ── Store state ───────────────────────────────────────────────────────────────

export interface WordCounterState extends WordCounterPersistedState {
  setText: (text: string) => void
  setExcludeStopwords: (exclude: boolean) => void
}

// ── Rehydration ───────────────────────────────────────────────────────────────

export function mergePersisted(
  persisted: unknown,
  current: WordCounterState,
): WordCounterState {
  const result = WordCounterSchema.partial().safeParse(persisted)
  if (!result.success) return current
  return { ...current, ...result.data }
}

// ── Store ─────────────────────────────────────────────────────────────────────

export const useWordCounterStore = create<WordCounterState>()(
  persist(
    (set) => ({
      text: '',
      excludeStopwords: true,

      setText: (text) => set({ text }),
      setExcludeStopwords: (excludeStopwords) => set({ excludeStopwords }),
    }),
    {
      name: 'su:word-counter',
      merge: (persisted, current) =>
        mergePersisted(persisted, current as WordCounterState),
    },
  ),
)
