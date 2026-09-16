import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { z } from 'zod'
import { useAuth } from '@/lib/auth/useAuth'
import { useToolState } from '@/lib/cloudState/useToolState'
import { registerSweepTarget } from '@/lib/cloudState/importSweep.io'

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

const DEFAULT_STATE: RegexTesterPersistedState = {
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
}

// ── Local (signed-out) store — unchanged behavior/localStorage key ─────────────

const useLocalRegexTesterStore = create<RegexTesterState>()(
  persist(
    (set) => ({
      ...DEFAULT_STATE,

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

// ── Cloud-backed state (Phase 3 of google-auth-cloud-state) ─────────────────────

const TOOL_ID = 'regex-tester'

// Import-sweep registration (Phase 3b of google-auth-cloud-state): on first
// sign-in, the sweep imports this tool's current local data into the cloud
// if no cloud row exists yet for this user/tool. See importSweep.io.ts.
registerSweepTarget({
  toolId: TOOL_ID,
  getLocalItems: () => [{ itemId: 'default', data: useLocalRegexTesterStore.getState() }],
  schema: RegexTesterSchema,
})

function useRegexTesterStoreImpl(): RegexTesterState {
  const { status } = useAuth()
  const local = useLocalRegexTesterStore()
  const cloud = useToolState(TOOL_ID, 'default', RegexTesterSchema, DEFAULT_STATE)

  if (status !== 'signed-in') return local

  const data = cloud.data
  return {
    pattern: data.pattern,
    flagG: data.flagG,
    flagI: data.flagI,
    flagM: data.flagM,
    flagS: data.flagS,
    flagU: data.flagU,
    flagY: data.flagY,
    testString: data.testString,
    replacement: data.replacement,
    showReplace: data.showReplace,
    setPattern: (pattern) => cloud.setData({ ...data, pattern }),
    setFlagG: (v) => cloud.setData({ ...data, flagG: v }),
    setFlagI: (v) => cloud.setData({ ...data, flagI: v }),
    setFlagM: (v) => cloud.setData({ ...data, flagM: v }),
    setFlagS: (v) => cloud.setData({ ...data, flagS: v }),
    setFlagU: (v) => cloud.setData({ ...data, flagU: v }),
    setFlagY: (v) => cloud.setData({ ...data, flagY: v }),
    setTestString: (testString) => cloud.setData({ ...data, testString }),
    setReplacement: (replacement) => cloud.setData({ ...data, replacement }),
    setShowReplace: (showReplace) => cloud.setData({ ...data, showReplace }),
  }
}

export const useRegexTesterStore = Object.assign(useRegexTesterStoreImpl, {
  getState: () => useLocalRegexTesterStore.getState(),
  setState: (partial: Partial<RegexTesterState>) => useLocalRegexTesterStore.setState(partial),
})
