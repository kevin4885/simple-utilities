import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { z } from 'zod'

// ── Schema ────────────────────────────────────────────────────────────────────

const RegexTesterSchema = z.object({
  /** The raw regex pattern string (without delimiters). */
  pattern: z.string().default(''),
  /** Active regex flags (individual booleans). */
  flagG: z.boolean().default(true),
  flagI: z.boolean().default(false),
  flagM: z.boolean().default(false),
  flagS: z.boolean().default(false),
  flagU: z.boolean().default(false),
  flagY: z.boolean().default(false),
  /** The test string to match against. */
  testString: z.string().default(''),
  /** Replacement string for the replace section. */
  replacement: z.string().default(''),
  /** Whether the replace section is expanded. */
  showReplace: z.boolean().default(false),
})

export type RegexTesterPersistedState = z.infer<typeof RegexTesterSchema>

// ── Store state ───────────────────────────────────────────────────────────────

export interface RegexTesterState extends RegexTesterPersistedState {
  setPattern: (pattern: string) => void
  setFlagG: (v: boolean) => void
  setFlagI: (v: boolean) => void
  setFlagM: (v: boolean) => void
  setFlagS: (v: boolean) => void
  setFlagU: (v: boolean) => void
  setFlagY: (v: boolean) => void
  setTestString: (testString: string) => void
  setReplacement: (replacement: string) => void
  setShowReplace: (showReplace: boolean) => void
}

// ── Rehydration ───────────────────────────────────────────────────────────────

export function mergePersisted(
  persisted: unknown,
  current: RegexTesterState,
): RegexTesterState {
  const result = RegexTesterSchema.partial().safeParse(persisted)
  if (!result.success) return current
  return { ...current, ...result.data }
}

// ── Store ─────────────────────────────────────────────────────────────────────

export const useRegexTesterStore = create<RegexTesterState>()(
  persist(
    (set) => ({
      pattern: '',
      flagG: true,
      flagI: false,
      flagM: false,
      flagS: false,
      flagU: false,
      flagY: false,
      testString: '',
      replacement: '',
      showReplace: false,

      setPattern: (pattern) => set({ pattern }),
      setFlagG: (v) => set({ flagG: v }),
      setFlagI: (v) => set({ flagI: v }),
      setFlagM: (v) => set({ flagM: v }),
      setFlagS: (v) => set({ flagS: v }),
      setFlagU: (v) => set({ flagU: v }),
      setFlagY: (v) => set({ flagY: v }),
      setTestString: (testString) => set({ testString }),
      setReplacement: (replacement) => set({ replacement }),
      setShowReplace: (showReplace) => set({ showReplace }),
    }),
    {
      name: 'su:regex-tester',
      merge: (persisted, current) =>
        mergePersisted(persisted, current as RegexTesterState),
    },
  ),
)
