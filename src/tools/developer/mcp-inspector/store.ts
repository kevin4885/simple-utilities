import { create } from 'zustand'
import { persist, type PersistStorage } from 'zustand/middleware'
import {
  DEFAULT_PREFS,
  HistoryEntrySchema,
  MAX_HEADERS,
  MAX_HISTORY,
  PrefsSchema,
  ProfileSchema,
  type HistoryEntry,
  type PersistedSlice,
  type Prefs,
  type Profile,
} from './schemas'
import {
  allSecretPrefixes,
  clampName,
  headerSecretKey,
  nameWithSuffix,
  newId,
  persistableSecretPrefixes,
  sanitizeProfileForStorage,
  truncateArgsJson,
} from './logic'
import { deleteSecret, deleteSecretsWithPrefix, replaceSecret, syncPersistedTier } from './secrets'

export const STORE_KEY = 'su:mcp-inspector'
export const STORE_VERSION = 1

export interface McpInspectorState extends PersistedSlice {
  addProfile(partial?: Partial<Pick<Profile, 'name' | 'url'>>): Profile
  /**
   * Patches a profile. Secret header values passed in `patch.headers` (`secret: true`, non-empty
   * `value`) are moved into secrets.ts using the profile's resulting `persistSecrets`; the stored
   * header keeps `value: ''`. A secret header with an empty `value` leaves the stored secret
   * untouched; secrets of headers no longer present (or no longer secret) are deleted.
   * `headers` beyond 50 entries are ignored (previous headers kept).
   */
  updateProfile(id: string, patch: Partial<Omit<Profile, 'id' | 'createdAt'>>): void
  deleteProfile(id: string): void
  duplicateProfile(id: string): Profile | null
  setActiveProfile(id: string | null): void
  setPrefs(patch: Partial<Prefs>): void
  pushHistory(e: Omit<HistoryEntry, 'id' | 'ts'>): void
  clearHistory(profileId?: string): void
}

// ── Rehydration ───────────────────────────────────────────────────────────────

/**
 * Validates a persisted `state` object item by item: invalid profiles/history rows are dropped,
 * unknown fields are stripped (Zod objects strip), and any secret header value is blanked.
 * Never throws; anything unusable yields `current` unchanged.
 */
export function mergePersisted(persisted: unknown, current: McpInspectorState): McpInspectorState {
  if (typeof persisted !== 'object' || persisted === null || Array.isArray(persisted)) return current
  const raw = persisted as Record<string, unknown>

  const profiles: Profile[] = []
  const seen = new Set<string>()
  if (Array.isArray(raw.profiles)) {
    for (const item of raw.profiles) {
      const parsed = ProfileSchema.safeParse(item)
      if (!parsed.success || seen.has(parsed.data.id)) continue
      seen.add(parsed.data.id)
      profiles.push(sanitizeProfileForStorage(parsed.data))
    }
  }

  const history: HistoryEntry[] = []
  if (Array.isArray(raw.history)) {
    for (const item of raw.history) {
      const parsed = HistoryEntrySchema.safeParse(item)
      if (!parsed.success || !seen.has(parsed.data.profileId)) continue
      history.push({ ...parsed.data, argsJson: truncateArgsJson(parsed.data.argsJson) })
    }
  }

  const prefs = PrefsSchema.safeParse(raw.prefs)
  const activeProfileId =
    typeof raw.activeProfileId === 'string' && seen.has(raw.activeProfileId) ? raw.activeProfileId : null

  return {
    ...current,
    profiles,
    activeProfileId,
    history: history.slice(-MAX_HISTORY),
    prefs: prefs.success ? prefs.data : { ...DEFAULT_PREFS },
  }
}

/**
 * localStorage adapter that treats anything without the expected `{state, version: 1}` envelope
 * (non-JSON, wrong shape, missing/other version) as "nothing stored", and never throws.
 */
const storage: PersistStorage<PersistedSlice> = {
  getItem(name) {
    try {
      const text = window.localStorage.getItem(name)
      if (text === null) return null
      const parsed: unknown = JSON.parse(text)
      if (typeof parsed !== 'object' || parsed === null) return null
      const env = parsed as { state?: unknown; version?: unknown }
      if (env.version !== STORE_VERSION || typeof env.state !== 'object' || env.state === null) return null
      return { state: env.state as PersistedSlice, version: STORE_VERSION }
    } catch {
      return null
    }
  },
  setItem(name, value) {
    try {
      window.localStorage.setItem(name, JSON.stringify(value))
    } catch {
      // quota / disabled storage: persistence is best effort
    }
  },
  removeItem(name) {
    try {
      window.localStorage.removeItem(name)
    } catch {
      // ignore
    }
  },
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const DEFAULT_PROFILE_NAME = 'New profile'

/** Moves secret header values out of `headers` into secrets.ts and returns the blanked copy. */
function stashHeaderSecrets(profileId: string, headers: Profile['headers'], persist: boolean): Profile['headers'] {
  return headers.map((h) => {
    if (!h.secret) return h
    if (h.value !== '') replaceSecret(headerSecretKey(profileId, h.id), h.value, { persist })
    return { ...h, value: '' }
  })
}

// ── Store ─────────────────────────────────────────────────────────────────────

export const useMcpInspectorStore = create<McpInspectorState>()(
  persist(
    (set, get) => ({
      profiles: [],
      activeProfileId: null,
      history: [],
      prefs: { ...DEFAULT_PREFS },

      addProfile: (partial) => {
        const now = Date.now()
        const profile: Profile = {
          id: newId(),
          name: clampName(partial?.name ?? '') || DEFAULT_PROFILE_NAME,
          url: partial?.url ?? '',
          transport: 'auto',
          protocolVersion: null,
          headers: [],
          persistSecrets: false,
          auth: { mode: 'none', scope: null, clientId: null },
          createdAt: now,
          updatedAt: now,
        }
        set((s) => ({ profiles: [...s.profiles, profile], activeProfileId: profile.id }))
        return profile
      },

      updateProfile: (id, patch) => {
        const old = get().profiles.find((p) => p.id === id)
        if (!old) return

        const safePatch: Partial<Profile> = { ...patch }
        delete (safePatch as { id?: string }).id
        delete (safePatch as { createdAt?: number }).createdAt
        if (safePatch.headers && safePatch.headers.length > MAX_HEADERS) delete safePatch.headers
        if (safePatch.name !== undefined) {
          const name = clampName(safePatch.name)
          if (name === '') delete safePatch.name
          else safePatch.name = name
        }

        const merged: Profile = {
          ...old,
          ...safePatch,
          id: old.id,
          createdAt: old.createdAt,
          updatedAt: Math.max(Date.now(), old.updatedAt + 1),
        }
        const checked = ProfileSchema.safeParse(merged)
        if (!checked.success) return

        // Side effects on the secret storages only after the update is known to be valid.
        const persist = checked.data.persistSecrets
        let headers = checked.data.headers
        if (safePatch.headers) {
          const keep = new Set(safePatch.headers.filter((h) => h.secret).map((h) => h.id))
          for (const h of old.headers) {
            if (!keep.has(h.id)) deleteSecret(headerSecretKey(id, h.id))
          }
          headers = stashHeaderSecrets(id, safePatch.headers, persist)
        }
        if (old.persistSecrets !== persist) {
          syncPersistedTier(persistableSecretPrefixes(id), persist)
        }

        const next = sanitizeProfileForStorage({ ...checked.data, headers })
        set((s) => ({ profiles: s.profiles.map((p) => (p.id === id ? next : p)) }))
      },

      deleteProfile: (id) => {
        for (const prefix of allSecretPrefixes(id)) deleteSecretsWithPrefix(prefix)
        set((s) => ({
          profiles: s.profiles.filter((p) => p.id !== id),
          history: s.history.filter((h) => h.profileId !== id),
          activeProfileId: s.activeProfileId === id ? null : s.activeProfileId,
        }))
      },

      duplicateProfile: (id) => {
        const src = get().profiles.find((p) => p.id === id)
        if (!src) return null
        const now = Date.now()
        const copy: Profile = {
          ...src,
          id: newId(),
          name: nameWithSuffix(src.name, ' (copy)'),
          headers: src.headers.map((h) => ({ ...h, id: newId(), value: h.secret ? '' : h.value })),
          persistSecrets: false,
          auth: { ...src.auth },
          createdAt: now,
          updatedAt: now,
        }
        set((s) => ({ profiles: [...s.profiles, copy] }))
        return copy
      },

      setActiveProfile: (id) => {
        if (id !== null && !get().profiles.some((p) => p.id === id)) return
        set({ activeProfileId: id })
      },

      setPrefs: (patch) => {
        const next = PrefsSchema.safeParse({ ...get().prefs, ...patch })
        if (next.success) set({ prefs: next.data })
      },

      pushHistory: (e) => {
        if (!get().prefs.saveHistory) return
        const entry: HistoryEntry = {
          ...e,
          id: newId(),
          ts: Date.now(),
          argsJson: truncateArgsJson(e.argsJson),
        }
        set((s) => ({ history: [...s.history, entry].slice(-MAX_HISTORY) }))
      },

      clearHistory: (profileId) => {
        set((s) => ({
          history: profileId === undefined ? [] : s.history.filter((h) => h.profileId !== profileId),
        }))
      },
    }),
    {
      name: STORE_KEY,
      version: STORE_VERSION,
      storage,
      partialize: (s): PersistedSlice => ({
        profiles: s.profiles.map(sanitizeProfileForStorage),
        activeProfileId: s.activeProfileId,
        history: s.history,
        prefs: s.prefs,
      }),
      merge: (persisted, current) => mergePersisted(persisted, current as McpInspectorState),
    },
  ),
)
