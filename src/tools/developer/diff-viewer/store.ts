import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { z } from 'zod'

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

// ── Store ─────────────────────────────────────────────────────────────────────

export const useDiffViewerStore = create<DiffViewerState>()(
  persist(
    (set) => ({
      original: '',
      modified: '',
      viewMode: 'unified',
      ignoreWhitespace: false,
      ignoreCase: false,

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
