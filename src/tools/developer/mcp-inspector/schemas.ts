import { z } from 'zod'

// Zod schemas + inferred types for everything the MCP Inspector persists (contract C1/C4).
// Secret header values are NEVER part of these blobs: `HeaderEntry.value` is '' whenever
// `secret === true` (enforced by logic.ts / store.ts; real values live in secrets.ts).

export const MAX_PROFILE_NAME = 80
export const MAX_HEADERS = 50
export const MAX_HISTORY = 200
export const MAX_ARGS_JSON = 20000
export const MAX_IMPORT_PROFILES = 100

export const TransportSchema = z.enum(['auto', 'streamable-http', 'sse'])

// Ids become parts of secret keys (`hdr:<profileId>:<headerId>`), so they must not contain ':'.
const IdSchema = z.string().min(1).regex(/^[^:]+$/, "id must not contain ':'")

export const HeaderEntrySchema = z.object({
  id: IdSchema,
  name: z.string(),
  value: z.string(),
  secret: z.boolean(),
  enabled: z.boolean(),
})
export type HeaderEntry = z.infer<typeof HeaderEntrySchema>

export const AuthSchema = z.object({
  mode: z.enum(['none', 'oauth']),
  scope: z.string().nullable(),
  clientId: z.string().nullable(),
})
export type ProfileAuth = z.infer<typeof AuthSchema>

export const ProfileSchema = z.object({
  id: IdSchema,
  name: z.string().trim().min(1).max(MAX_PROFILE_NAME),
  url: z.string(),
  transport: TransportSchema,
  protocolVersion: z.string().nullable(),
  headers: z
    .array(HeaderEntrySchema)
    .max(MAX_HEADERS)
    .refine((hs) => new Set(hs.map((h) => h.id)).size === hs.length, 'duplicate header id'),
  persistSecrets: z.boolean(),
  auth: AuthSchema,
  createdAt: z.number(),
  updatedAt: z.number(),
})
export type Profile = z.infer<typeof ProfileSchema>

export const HistoryEntrySchema = z.object({
  id: z.string().min(1),
  ts: z.number(),
  profileId: IdSchema,
  kind: z.enum(['tool', 'prompt', 'resource', 'raw']),
  name: z.string(),
  argsJson: z.string(),
  ok: z.boolean(),
  durationMs: z.number(),
})
export type HistoryEntry = z.infer<typeof HistoryEntrySchema>

export const PrefsSchema = z.object({
  saveHistory: z.boolean(),
})
export type Prefs = z.infer<typeof PrefsSchema>

export const DEFAULT_PREFS: Prefs = { saveHistory: true }

/** The slice of the store that is written to `su:mcp-inspector`. */
export interface PersistedSlice {
  profiles: Profile[]
  activeProfileId: string | null
  history: HistoryEntry[]
  prefs: Prefs
}

/**
 * Import is deliberately more forgiving than the stored shape: hand-written files may omit
 * ids and fields with an obvious default. Wrong TYPES still fail the profile. Ids and
 * timestamps are regenerated and persistSecrets is forced false by importProfiles.
 */
export const ImportHeaderSchema = z.object({
  name: z.string(),
  value: z.string().default(''),
  secret: z.boolean().optional(),
  enabled: z.boolean().default(true),
})

export const ImportProfileSchema = z.object({
  name: z.string(),
  url: z.string(),
  transport: TransportSchema.default('auto'),
  protocolVersion: z.string().nullable().default(null),
  headers: z.array(ImportHeaderSchema).max(MAX_HEADERS).default([]),
  auth: AuthSchema.default({ mode: 'none', scope: null, clientId: null }),
})
