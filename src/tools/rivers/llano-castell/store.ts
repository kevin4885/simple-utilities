/**
 * Zustand store for the Llano @ Castell tool.
 *
 * Persists gauge data to localStorage under key `su:llano-castell`.
 * All localStorage reads are Zod-validated on rehydrate (merge function).
 *
 * Cloud state (Phase 3 of google-auth-cloud-state): signed in, this cache is
 * a single `useToolState` row (`item_id = 'default'`) via the Phase 1
 * adapter instead of localStorage — same shape (`CachedState`), same
 * `setCache`/`clearCache` semantics. This is a *cache* of a public USGS feed
 * (not user-authored content), but it is still per-tool state the tool
 * itself owns, so it follows the same single-blob migration as every other
 * tool in this phase.
 */
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { CachedStateSchema, type CachedState } from './schemas'
import { useAuth } from '@/lib/auth/useAuth'
import { useToolState } from '@/lib/cloudState/useToolState'

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

// ── Local (signed-out) store — unchanged behavior/localStorage key ─────────────

const useLocalLlanoCastellStore = create<LlanoCastellState>()(
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

// ── Cloud-backed state (Phase 3 of google-auth-cloud-state) ─────────────────────

const TOOL_ID = 'llano-castell'

function useLlanoCastellStoreImpl(): LlanoCastellState {
  const { status } = useAuth()
  const local = useLocalLlanoCastellStore()
  const cloud = useToolState(TOOL_ID, 'default', CachedStateSchema, DEFAULT_CACHE)

  if (status !== 'signed-in') return local

  const data = cloud.data
  return {
    fetchedAtMs: data.fetchedAtMs,
    mason: data.mason,
    llano: data.llano,
    masonFt: data.masonFt,
    llanoFt: data.llanoFt,
    setCache: (next) => cloud.setData(next),
    clearCache: () => cloud.setData(DEFAULT_CACHE),
  }
}

export const useLlanoCastellStore = Object.assign(useLlanoCastellStoreImpl, {
  getState: () => useLocalLlanoCastellStore.getState(),
  setState: (partial: Partial<LlanoCastellState>) => useLocalLlanoCastellStore.setState(partial),
})
