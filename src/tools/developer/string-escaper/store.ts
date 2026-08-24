import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { z } from 'zod'

// ── Schema ────────────────────────────────────────────────────────────────────

const StringEscaperSchema = z.object({
  /** 'escape' = readable → escaped; 'unescape' = escaped → readable */
  direction: z.enum(['escape', 'unescape']).default('unescape'),
  /** Wrap escaped output in double quotes */
  quotes: z.boolean().default(false),
  input: z.string().default(''),
})

export type StringEscaperPersistedState = z.infer<typeof StringEscaperSchema>

// ── Store state ───────────────────────────────────────────────────────────────

export interface StringEscaperState extends StringEscaperPersistedState {
  setDirection: (direction: 'escape' | 'unescape') => void
  setQuotes: (quotes: boolean) => void
  setInput: (input: string) => void
}

// ── Rehydration ───────────────────────────────────────────────────────────────

export function mergePersisted(
  persisted: unknown,
  current: StringEscaperState,
): StringEscaperState {
  const result = StringEscaperSchema.partial().safeParse(persisted)
  if (!result.success) return current
  return { ...current, ...result.data }
}

// ── Store ─────────────────────────────────────────────────────────────────────

export const useStringEscaperStore = create<StringEscaperState>()(
  persist(
    (set) => ({
      direction: 'unescape',
      quotes: false,
      input: '',

      setDirection: (direction) => set({ direction }),
      setQuotes: (quotes) => set({ quotes }),
      setInput: (input) => set({ input }),
    }),
    {
      name: 'su:string-escaper',
      merge: (persisted, current) => mergePersisted(persisted, current as StringEscaperState),
    },
  ),
)
