import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { z } from 'zod'
import {
  DEFAULT_SETTINGS,
  LOGGING_LEVELS,
  MAX_ROOTS,
  MAX_ROOT_NAME_CHARS,
  normalizeRootName,
  validateRootUri,
  type ClientSettings,
  type LoggingLevel,
  type RootItem,
} from './logic'

export const CLIENT_SETTINGS_KEY = 'su:mcp-inspector-client'

const RootItemSchema = z.object({
  uri: z.string().refine((u) => validateRootUri(u) === null),
  name: z.string().max(MAX_ROOT_NAME_CHARS).nullable(),
})

const FlagSchema = z.boolean()
const LevelSchema = z.enum(LOGGING_LEVELS)

export interface ClientSettingsState extends ClientSettings {
  setRootsEnabled(enabled: boolean): void
  setSamplingEnabled(enabled: boolean): void
  setElicitationEnabled(enabled: boolean): void
  setLoggingLevel(level: LoggingLevel): void
  /** Returns an inline error message, or null when the root was added. */
  addRoot(uri: string, name: string): string | null
  removeRoot(index: number): void
}

function isRec(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function flag(v: unknown, fallback: boolean): boolean {
  const r = FlagSchema.safeParse(v)
  return r.success ? r.data : fallback
}

/**
 * Validates persisted settings field by field: anything missing or invalid falls back to its default, and
 * invalid / duplicate root rows are dropped. Never throws. Exported for unit tests.
 */
export function parseSettings(persisted: unknown): ClientSettings {
  const p = isRec(persisted) ? persisted : {}
  const roots = isRec(p.roots) ? p.roots : {}
  const items: RootItem[] = []
  const seen = new Set<string>()
  if (Array.isArray(roots.items)) {
    for (const raw of roots.items) {
      const r = RootItemSchema.safeParse(raw)
      if (!r.success || seen.has(r.data.uri) || items.length >= MAX_ROOTS) continue
      seen.add(r.data.uri)
      items.push({ uri: r.data.uri, name: r.data.name === null || r.data.name.trim() === '' ? null : r.data.name.trim() })
    }
  }
  const level = LevelSchema.safeParse(p.loggingLevel)
  return {
    roots: { enabled: flag(roots.enabled, DEFAULT_SETTINGS.roots.enabled), items },
    sampling: { enabled: flag(isRec(p.sampling) ? p.sampling.enabled : undefined, DEFAULT_SETTINGS.sampling.enabled) },
    elicitation: { enabled: flag(isRec(p.elicitation) ? p.elicitation.enabled : undefined, DEFAULT_SETTINGS.elicitation.enabled) },
    loggingLevel: level.success ? level.data : DEFAULT_SETTINGS.loggingLevel,
  }
}

export function mergePersisted(persisted: unknown, current: ClientSettingsState): ClientSettingsState {
  return { ...current, ...parseSettings(persisted) }
}

export const useClientSettings = create<ClientSettingsState>()(
  persist(
    (set, get) => ({
      ...DEFAULT_SETTINGS,
      setRootsEnabled: (enabled) => set((s) => ({ roots: { ...s.roots, enabled } })),
      setSamplingEnabled: (enabled) => set({ sampling: { enabled } }),
      setElicitationEnabled: (enabled) => set({ elicitation: { enabled } }),
      setLoggingLevel: (loggingLevel) => set({ loggingLevel }),
      addRoot: (uriText, nameText) => {
        const uri = uriText.trim()
        const uriError = validateRootUri(uri)
        if (uriError) return uriError
        const name = normalizeRootName(nameText)
        if (!name.ok) return name.error
        const { items } = get().roots
        if (items.length >= MAX_ROOTS) return `At most ${MAX_ROOTS} roots are supported`
        if (items.some((r) => r.uri === uri)) return 'This root is already in the list'
        set((s) => ({ roots: { ...s.roots, items: [...s.roots.items, { uri, name: name.name }] } }))
        return null
      },
      removeRoot: (index) =>
        set((s) => ({ roots: { ...s.roots, items: s.roots.items.filter((_, i) => i !== index) } })),
    }),
    {
      name: CLIENT_SETTINGS_KEY,
      merge: (persisted, current) => mergePersisted(persisted, current as ClientSettingsState),
    },
  ),
)
