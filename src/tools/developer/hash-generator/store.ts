import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { z } from 'zod'
import type { HexCase, OutputEncoding } from './logic'
import { useAuth } from '@/lib/auth/useAuth'
import { useToolState } from '@/lib/cloudState/useToolState'

// ── Schema ────────────────────────────────────────────────────────────────────

const HashGeneratorSchema = z.object({
  /** Current text in the input textarea */
  inputText: z.string().default(''),
  /** Hex output case: lowercase or uppercase */
  hexCase: z.enum(['lower', 'upper']).default('lower'),
  /** Output encoding: hex digits or Base64 */
  outputEncoding: z.enum(['hex', 'base64']).default('hex'),
  /** Whether the HMAC section is expanded */
  showHmac: z.boolean().default(false),
  /** HMAC secret key (plain text, will be UTF-8 encoded) */
  hmacKey: z.string().default(''),
  /** Active tab: 'text' or 'file' */
  activeTab: z.enum(['text', 'file']).default('text'),
})

export type HashGeneratorPersistedState = z.infer<typeof HashGeneratorSchema>

// ── Store state ───────────────────────────────────────────────────────────────

export interface HashGeneratorState extends HashGeneratorPersistedState {
  setInputText: (text: string) => void
  setHexCase: (v: HexCase) => void
  setOutputEncoding: (v: OutputEncoding) => void
  setShowHmac: (v: boolean) => void
  setHmacKey: (v: string) => void
  setActiveTab: (v: 'text' | 'file') => void
}

// ── Rehydration ───────────────────────────────────────────────────────────────

export function mergePersisted(
  persisted: unknown,
  current: HashGeneratorState,
): HashGeneratorState {
  const result = HashGeneratorSchema.partial().safeParse(persisted)
  if (!result.success) return current
  return { ...current, ...result.data }
}

const DEFAULT_STATE: HashGeneratorPersistedState = {
  inputText: '',
  hexCase: 'lower',
  outputEncoding: 'hex',
  showHmac: false,
  hmacKey: '',
  activeTab: 'text',
}

// ── Local (signed-out) store — unchanged behavior/localStorage key ─────────────

const useLocalHashGeneratorStore = create<HashGeneratorState>()(
  persist(
    (set) => ({
      ...DEFAULT_STATE,

      setInputText: (inputText) => set({ inputText }),
      setHexCase: (hexCase) => set({ hexCase }),
      setOutputEncoding: (outputEncoding) => set({ outputEncoding }),
      setShowHmac: (showHmac) => set({ showHmac }),
      setHmacKey: (hmacKey) => set({ hmacKey }),
      setActiveTab: (activeTab) => set({ activeTab }),
    }),
    {
      name: 'su:hash-generator',
      merge: (persisted, current) =>
        mergePersisted(persisted, current as HashGeneratorState),
    },
  ),
)

// ── Cloud-backed state (Phase 3 of google-auth-cloud-state) ─────────────────────

const TOOL_ID = 'hash-generator'

function useHashGeneratorStoreImpl(): HashGeneratorState {
  const { status } = useAuth()
  const local = useLocalHashGeneratorStore()
  const cloud = useToolState(TOOL_ID, 'default', HashGeneratorSchema, DEFAULT_STATE)

  if (status !== 'signed-in') return local

  const data = cloud.data
  return {
    inputText: data.inputText,
    hexCase: data.hexCase,
    outputEncoding: data.outputEncoding,
    showHmac: data.showHmac,
    hmacKey: data.hmacKey,
    activeTab: data.activeTab,
    setInputText: (inputText) => cloud.setData({ ...data, inputText }),
    setHexCase: (hexCase) => cloud.setData({ ...data, hexCase }),
    setOutputEncoding: (outputEncoding) => cloud.setData({ ...data, outputEncoding }),
    setShowHmac: (showHmac) => cloud.setData({ ...data, showHmac }),
    setHmacKey: (hmacKey) => cloud.setData({ ...data, hmacKey }),
    setActiveTab: (activeTab) => cloud.setData({ ...data, activeTab }),
  }
}

export const useHashGeneratorStore = Object.assign(useHashGeneratorStoreImpl, {
  getState: () => useLocalHashGeneratorStore.getState(),
  setState: (partial: Partial<HashGeneratorState>) => useLocalHashGeneratorStore.setState(partial),
})
