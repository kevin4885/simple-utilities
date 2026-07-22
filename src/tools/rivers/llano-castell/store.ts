/**
 * Zustand store for the Llano @ Castell tool.
 *
 * Persists gauge data to localStorage under key `su:llano-castell`.
 * All localStorage reads are Zod-validated on rehydrate (merge function).
 */
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { CachedStateSchema, type CachedState } from './schemas'

// Persist schema — only the cache fields survive localStorage round-trips
const PersistSchema = CachedStateSchema

interface LlanoCastellState extends CachedState {
  // Action
  setCache: (data: CachedState) => void
  clearCache: () => void
}

const DEFAULT_CACHE: CachedState = {
  fetchedAtMs: 0,
  mason: [],
  llano: [],
  masonFt: [],
  llanoFt: [],
}

export const useLlanoCastellStore = create<LlanoCastellState>()(
  persist(
    (set) => ({
      ...DEFAULT_CACHE,
      setCache: (data: CachedState) => set({ ...data }),
      clearCache: () => set({ ...DEFAULT_CACHE }),
    }),
    {
      name: 'su:llano-castell',
      merge: (persisted: unknown, current: LlanoCastellState): LlanoCastellState => {
        const parsed = PersistSchema.safeParse(persisted)
        if (parsed.success) {
          return { ...current, ...parsed.data }
        }
        // Invalid / old shape → start fresh
        return current
      },
      // Serialize only the cache fields (not the actions)
      partialize: (state) => ({
        fetchedAtMs: state.fetchedAtMs,
        mason: state.mason,
        llano: state.llano,
        masonFt: state.masonFt,
        llanoFt: state.llanoFt,
      }),
    },
  ),
)
