import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { z } from 'zod'
import { useAuth } from '@/lib/auth/useAuth'
import { useToolState } from '@/lib/cloudState/useToolState'

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

// ── Local (signed-out) store — unchanged behavior/localStorage key ─────────────

const useLocalWordCounterStore = create<WordCounterState>()(
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

// ── Cloud-backed state (Phase 3 of google-auth-cloud-state) ─────────────────────
//
// Single-blob tool: one `useToolState` row per user, `item_id = 'default'`
// (byte-for-byte the same localStorage key the local store above already
// uses, per the Phase 1 adapter's key-naming convention — see
// `useToolState.ts`). Signed out: the local store above, unchanged. Signed
// in: this cloud path, via the Phase 1 adapter, never redesigned here.

const TOOL_ID = 'word-counter'

const DEFAULT_STATE: WordCounterPersistedState = {
  text: '',
  excludeStopwords: true,
}

/**
 * The hook `index.tsx` actually consumes (unchanged export name — `index.tsx`
 * is out of this phase's scope). Signed out (or auth status still
 * `'loading'`): the local Zustand `persist` store above, unchanged. Signed
 * in: the cloud-backed adapter.
 *
 * `.getState()`/`.setState()` are preserved as static methods (forwarding to
 * the local store) so any code relying on the zustand static API (this
 * tool currently has none, but see `store.test.ts` conventions used by
 * other tools in this phase) keeps working unchanged.
 */
function useWordCounterStoreImpl(): WordCounterState {
  const { status } = useAuth()
  const local = useLocalWordCounterStore()
  const cloud = useToolState(TOOL_ID, 'default', WordCounterSchema, DEFAULT_STATE)

  if (status !== 'signed-in') return local

  const data = cloud.data
  return {
    text: data.text,
    excludeStopwords: data.excludeStopwords,
    setText: (text) => cloud.setData({ ...data, text }),
    setExcludeStopwords: (excludeStopwords) => cloud.setData({ ...data, excludeStopwords }),
  }
}

export const useWordCounterStore = Object.assign(useWordCounterStoreImpl, {
  getState: () => useLocalWordCounterStore.getState(),
  setState: (partial: Partial<WordCounterState>) => useLocalWordCounterStore.setState(partial),
})
