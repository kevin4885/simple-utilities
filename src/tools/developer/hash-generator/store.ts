import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { z } from 'zod'
import type { HexCase, OutputEncoding } from './logic'

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

// ── Store ─────────────────────────────────────────────────────────────────────

export const useHashGeneratorStore = create<HashGeneratorState>()(
  persist(
    (set) => ({
      inputText: '',
      hexCase: 'lower',
      outputEncoding: 'hex',
      showHmac: false,
      hmacKey: '',
      activeTab: 'text',

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
