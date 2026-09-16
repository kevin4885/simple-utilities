import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { z } from 'zod'
import { useAuth } from '@/lib/auth/useAuth'
import { useToolState } from '@/lib/cloudState/useToolState'

// ── Schema ────────────────────────────────────────────────────────────────────

const DiffViewerSchema = z.object({
  /** Original (left / A) text input. */
  original: z.string().default(''),
  /** Modified (right / B) text input. */
  modified: z.string().default(''),
  /** View mode toggle. */
  viewMode: z.enum(['unified', 'side-by-side']).default('unified'),
  /** Ignore leading/trailing and collapsed whitespace when comparing. */
  ignoreWhitespace: z.boolean().default(false),
  /** Ignore character case when comparing. */
  ignoreCase: z.boolean().default(false),
})

export type DiffViewerPersistedState = z.infer<typeof DiffViewerSchema>

// ── Store state ───────────────────────────────────────────────────────────────

export interface DiffViewerState extends DiffViewerPersistedState {
  setOriginal: (v: string) => void
  setModified: (v: string) => void
  setViewMode: (v: 'unified' | 'side-by-side') => void
  setIgnoreWhitespace: (v: boolean) => void
  setIgnoreCase: (v: boolean) => void
}

// ── Rehydration ───────────────────────────────────────────────────────────────

export function mergePersisted(
  persisted: unknown,
  current: DiffViewerState,
): DiffViewerState {
  const result = DiffViewerSchema.partial().safeParse(persisted)
  if (!result.success) return current
  return { ...current, ...result.data }
}

const DEFAULT_STATE: DiffViewerPersistedState = {
  original: '',
  modified: '',
  viewMode: 'unified',
  ignoreWhitespace: false,
  ignoreCase: false,
}

// ── Local (signed-out) store — unchanged behavior/localStorage key ─────────────

const useLocalDiffViewerStore = create<DiffViewerState>()(
  persist(
    (set) => ({
      ...DEFAULT_STATE,

      setOriginal: (original) => set({ original }),
      setModified: (modified) => set({ modified }),
      setViewMode: (viewMode) => set({ viewMode }),
      setIgnoreWhitespace: (ignoreWhitespace) => set({ ignoreWhitespace }),
      setIgnoreCase: (ignoreCase) => set({ ignoreCase }),
    }),
    {
      name: 'su:diff-viewer',
      merge: (persisted, current) =>
        mergePersisted(persisted, current as DiffViewerState),
    },
  ),
)

// ── Cloud-backed state (Phase 3 of google-auth-cloud-state) ─────────────────────

const TOOL_ID = 'diff-viewer'

function useDiffViewerStoreImpl(): DiffViewerState {
  const { status } = useAuth()
  const local = useLocalDiffViewerStore()
  const cloud = useToolState(TOOL_ID, 'default', DiffViewerSchema, DEFAULT_STATE)

  if (status !== 'signed-in') return local

  const data = cloud.data
  return {
    original: data.original,
    modified: data.modified,
    viewMode: data.viewMode,
    ignoreWhitespace: data.ignoreWhitespace,
    ignoreCase: data.ignoreCase,
    setOriginal: (v) => cloud.setData({ ...data, original: v }),
    setModified: (v) => cloud.setData({ ...data, modified: v }),
    setViewMode: (v) => cloud.setData({ ...data, viewMode: v }),
    setIgnoreWhitespace: (v) => cloud.setData({ ...data, ignoreWhitespace: v }),
    setIgnoreCase: (v) => cloud.setData({ ...data, ignoreCase: v }),
  }
}

export const useDiffViewerStore = Object.assign(useDiffViewerStoreImpl, {
  getState: () => useLocalDiffViewerStore.getState(),
  setState: (partial: Partial<DiffViewerState>) => useLocalDiffViewerStore.setState(partial),
})
