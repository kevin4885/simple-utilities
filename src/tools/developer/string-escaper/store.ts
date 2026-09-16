import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { z } from 'zod'
import { useAuth } from '@/lib/auth/useAuth'
import { useToolState } from '@/lib/cloudState/useToolState'
import { registerSweepTarget } from '@/lib/cloudState/importSweep.io'

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

const DEFAULT_STATE: StringEscaperPersistedState = {
  direction: 'unescape',
  quotes: false,
  input: '',
}

// ── Local (signed-out) store — unchanged behavior/localStorage key ─────────────

const useLocalStringEscaperStore = create<StringEscaperState>()(
  persist(
    (set) => ({
      ...DEFAULT_STATE,

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

// ── Cloud-backed state (Phase 3 of google-auth-cloud-state) ─────────────────────

const TOOL_ID = 'string-escaper'

// Import-sweep registration (Phase 3b of google-auth-cloud-state): on first
// sign-in, the sweep imports this tool's current local data into the cloud
// if no cloud row exists yet for this user/tool. See importSweep.io.ts.
registerSweepTarget({
  toolId: TOOL_ID,
  getLocalItems: () => [{ itemId: 'default', data: useLocalStringEscaperStore.getState() }],
  schema: StringEscaperSchema,
})

function useStringEscaperStoreImpl(): StringEscaperState {
  const { status } = useAuth()
  const local = useLocalStringEscaperStore()
  const cloud = useToolState(TOOL_ID, 'default', StringEscaperSchema, DEFAULT_STATE)

  if (status !== 'signed-in') return local

  const data = cloud.data
  return {
    direction: data.direction,
    quotes: data.quotes,
    input: data.input,
    setDirection: (direction) => cloud.setData({ ...data, direction }),
    setQuotes: (quotes) => cloud.setData({ ...data, quotes }),
    setInput: (input) => cloud.setData({ ...data, input }),
  }
}

export const useStringEscaperStore = Object.assign(useStringEscaperStoreImpl, {
  getState: () => useLocalStringEscaperStore.getState(),
  setState: (partial: Partial<StringEscaperState>) => useLocalStringEscaperStore.setState(partial),
})
