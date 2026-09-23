import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { z } from 'zod'
import type { EncodeDecodeMode } from './logic'

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

// ── Store ─────────────────────────────────────────────────────────────────────

export const useUrlParserStore = create<UrlParserState>()(
  persist(
    (set) => ({
      urlInput: '',
      encodeInput: '',
      encodeMode: 'encodeURIComponent',

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
