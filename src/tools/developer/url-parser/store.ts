import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { z } from 'zod'
import type { EncodeDecodeMode } from './logic'
import { useAuth } from '@/lib/auth/useAuth'
import { useToolState } from '@/lib/cloudState/useToolState'
import { registerSweepTarget } from '@/lib/cloudState/importSweep.io'

// ── Schema ────────────────────────────────────────────────────────────────────

const UrlParserSchema = z.object({
  /** The raw URL string entered by the user. */
  urlInput: z.string().default(''),
  /** Input for the encode/decode section. */
  encodeInput: z.string().default(''),
  /** Selected encode/decode mode. */
  encodeMode: z
    .enum(['encodeURIComponent', 'decodeURIComponent', 'encodeURI', 'decodeURI'])
    .default('encodeURIComponent'),
})

export type UrlParserPersistedState = z.infer<typeof UrlParserSchema>

// ── Store state ───────────────────────────────────────────────────────────────

export interface UrlParserState extends UrlParserPersistedState {
  setUrlInput: (urlInput: string) => void
  setEncodeInput: (encodeInput: string) => void
  setEncodeMode: (encodeMode: EncodeDecodeMode) => void
}

// ── Rehydration ───────────────────────────────────────────────────────────────

export function mergePersisted(
  persisted: unknown,
  current: UrlParserState,
): UrlParserState {
  const result = UrlParserSchema.partial().safeParse(persisted)
  if (!result.success) return current
  return { ...current, ...result.data }
}

const DEFAULT_STATE: UrlParserPersistedState = {
  urlInput: '',
  encodeInput: '',
  encodeMode: 'encodeURIComponent',
}

// ── Local (signed-out) store — unchanged behavior/localStorage key ─────────────

const useLocalUrlParserStore = create<UrlParserState>()(
  persist(
    (set) => ({
      ...DEFAULT_STATE,

      setUrlInput: (urlInput) => set({ urlInput }),
      setEncodeInput: (encodeInput) => set({ encodeInput }),
      setEncodeMode: (encodeMode) => set({ encodeMode }),
    }),
    {
      name: 'su:url-parser',
      merge: (persisted, current) =>
        mergePersisted(persisted, current as UrlParserState),
    },
  ),
)

// ── Cloud-backed state (Phase 3 of google-auth-cloud-state) ─────────────────────

const TOOL_ID = 'url-parser'

// Import-sweep registration (Phase 3b of google-auth-cloud-state): on first
// sign-in, the sweep imports this tool's current local data into the cloud
// if no cloud row exists yet for this user/tool. See importSweep.io.ts.
registerSweepTarget({
  toolId: TOOL_ID,
  getLocalItems: () => [{ itemId: 'default', data: useLocalUrlParserStore.getState() }],
  schema: UrlParserSchema,
})

function useUrlParserStoreImpl(): UrlParserState {
  const { status } = useAuth()
  const local = useLocalUrlParserStore()
  const cloud = useToolState(TOOL_ID, 'default', UrlParserSchema, DEFAULT_STATE)

  if (status !== 'signed-in') return local

  const data = cloud.data
  return {
    urlInput: data.urlInput,
    encodeInput: data.encodeInput,
    encodeMode: data.encodeMode,
    setUrlInput: (urlInput) => cloud.setData({ ...data, urlInput }),
    setEncodeInput: (encodeInput) => cloud.setData({ ...data, encodeInput }),
    setEncodeMode: (encodeMode) => cloud.setData({ ...data, encodeMode }),
  }
}

export const useUrlParserStore = Object.assign(useUrlParserStoreImpl, {
  getState: () => useLocalUrlParserStore.getState(),
  setState: (partial: Partial<UrlParserState>) => useLocalUrlParserStore.setState(partial),
})
