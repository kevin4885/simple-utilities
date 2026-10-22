// Pure helpers for the MCP Inspector persistence area (contract C4 / C8).
// No React, no storage access. Ids and clocks come from the platform globals.

import {
  ImportProfileSchema,
  MAX_ARGS_JSON,
  MAX_IMPORT_PROFILES,
  MAX_PROFILE_NAME,
  type HeaderEntry,
  type Profile,
} from './schemas'

const TRUNCATION_SUFFIX = '…[truncated]'

// ── Header classification (C8) ────────────────────────────────────────────────

const EXACT_SECRET_NAMES = new Set(['authorization', 'proxy-authorization', 'cookie', 'set-cookie'])
const SECRET_NAME_PATTERN = /(token|secret|key|password|auth)/i

/** True when a header name almost certainly carries a credential (case-insensitive). */
export function isSecretHeaderName(name: string): boolean {
  const n = name.trim().toLowerCase()
  if (n === '') return false
  return EXACT_SECRET_NAMES.has(n) || SECRET_NAME_PATTERN.test(n)
}

/** RFC 9110 token. */
const HEADER_NAME_TOKEN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/

const FETCH_FORBIDDEN = new Set([
  'accept-charset',
  'accept-encoding',
  'access-control-request-headers',
  'access-control-request-method',
  'connection',
  'content-length',
  'cookie',
  'cookie2',
  'date',
  'dnt',
  'expect',
  'host',
  'keep-alive',
  'origin',
  'referer',
  'set-cookie',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'via',
])

const TRANSPORT_MANAGED = new Set(['accept', 'content-type', 'mcp-session-id', 'mcp-protocol-version'])

function isFetchForbidden(lower: string): boolean {
  return FETCH_FORBIDDEN.has(lower) || lower.startsWith('proxy-') || lower.startsWith('sec-')
}

/** Key under which a secret header's real value lives in secrets.ts. */
export function headerSecretKey(profileId: string, headerId: string): string {
  return `hdr:${profileId}:${headerId}`
}

/**
 * Secret key prefixes that may live in persisted (localStorage) storage for a profile.
 * `oauth:<id>:verifier|state` and `oauth:pending-return` are session-only, so they are excluded.
 */
export function persistableSecretPrefixes(profileId: string): string[] {
  return [`hdr:${profileId}:`, `oauth:${profileId}:tokens`, `oauth:${profileId}:client`]
}

/** Every secret key prefix belonging to a profile (used on delete). */
export function allSecretPrefixes(profileId: string): string[] {
  return [`hdr:${profileId}:`, `oauth:${profileId}:`]
}

export interface ResolvedHeaders {
  headers: { name: string; value: string }[]
  invalid: string[]
  warnings: string[]
}

/**
 * Turns a profile's header rows into the `{name,value}[]` handed to the connection layer.
 * Secret values are fetched through `get` (never read from the profile). Order is preserved.
 */
export function resolveHeaders(profile: Profile, get: (key: string) => string | null): ResolvedHeaders {
  const headers: { name: string; value: string }[] = []
  const invalid: string[] = []
  const warnings: string[] = []

  for (const h of profile.headers) {
    if (!h.enabled) continue
    const name = h.name.trim()
    if (name === '') continue
    if (!HEADER_NAME_TOKEN.test(name)) {
      invalid.push(name)
      continue
    }
    const lower = name.toLowerCase()
    if (isFetchForbidden(lower)) {
      warnings.push(`Header "${name}" is ignored: browsers do not allow scripts to set it.`)
    } else if (TRANSPORT_MANAGED.has(lower)) {
      warnings.push(`Header "${name}" will be overridden by the MCP transport.`)
    }
    const value = h.secret ? (get(headerSecretKey(profile.id, h.id)) ?? '') : h.value
    headers.push({ name, value })
  }

  return { headers, invalid, warnings }
}

// ── Names, ids, history ───────────────────────────────────────────────────────

export function newId(): string {
  return crypto.randomUUID()
}

/** Trim and clamp a profile name to 80 chars; returns '' when nothing usable remains. */
export function clampName(name: string): string {
  return name.trim().slice(0, MAX_PROFILE_NAME).trim()
}

/** `"<base><suffix>"`, shortening the base so the result never exceeds the name limit. */
export function nameWithSuffix(base: string, suffix: string): string {
  const room = MAX_PROFILE_NAME - suffix.length
  return `${base.slice(0, Math.max(0, room)).trimEnd()}${suffix}`
}

export function truncateArgsJson(text: string): string {
  return text.length > MAX_ARGS_JSON ? text.slice(0, MAX_ARGS_JSON) + TRUNCATION_SUFFIX : text
}

// ── Secret stripping / export / import ────────────────────────────────────────

/** A copy of the header with its value blanked when it is (or, with `alsoByName`, looks like) a secret. */
function blankedHeader(h: HeaderEntry, alsoByName: boolean): HeaderEntry {
  const blank = h.secret || (alsoByName && isSecretHeaderName(h.name))
  return { id: h.id, name: h.name, value: blank ? '' : h.value, secret: h.secret, enabled: h.enabled }
}

/** Copy of a profile that is safe for the persisted blob: secret header values are ''. */
export function sanitizeProfileForStorage(p: Profile): Profile {
  return {
    id: p.id,
    name: p.name,
    url: p.url,
    transport: p.transport,
    protocolVersion: p.protocolVersion,
    headers: p.headers.map((h) => blankedHeader(h, false)),
    persistSecrets: p.persistSecrets,
    auth: { mode: p.auth.mode, scope: p.auth.scope, clientId: p.auth.clientId },
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  }
}

/**
 * Serialises profiles for sharing. Secret header values (flagged secret OR secret by name) are
 * forced to '' and `persistSecrets` to false, whatever the stored profile says.
 */
export function exportProfiles(profiles: Profile[]): string {
  const out = profiles.map((p) => ({
    id: p.id,
    name: p.name,
    url: p.url,
    transport: p.transport,
    protocolVersion: p.protocolVersion,
    headers: p.headers.map((h) => blankedHeader(h, true)),
    persistSecrets: false,
    auth: { mode: p.auth.mode, scope: p.auth.scope, clientId: p.auth.clientId },
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  }))
  return JSON.stringify({ version: 1, profiles: out }, null, 2)
}

export type ImportResult =
  | { ok: true; profiles: Profile[]; skipped: number }
  | { ok: false; error: string }

function uniqueName(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base
  for (let n = 2; ; n++) {
    const candidate = nameWithSuffix(base, ` (${n})`)
    if (!taken.has(candidate)) return candidate
  }
}

/**
 * Parses an exported file. Everything identifying is regenerated (profile ids, header ids,
 * timestamps), `persistSecrets` is forced false, secret header values are dropped, unknown
 * fields are stripped, and duplicate names get " (2)", " (3)", ...
 */
export function importProfiles(text: string): ImportResult {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch (e) {
    return { ok: false, error: `Invalid JSON: ${e instanceof Error ? e.message : String(e)}` }
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return { ok: false, error: 'Expected an object like {"version":1,"profiles":[...]}.' }
  }
  const root = data as Record<string, unknown>
  if (root.version !== 1) {
    return { ok: false, error: `Unsupported file version: ${JSON.stringify(root.version) ?? 'missing'} (expected 1).` }
  }
  if (!Array.isArray(root.profiles)) {
    return { ok: false, error: 'Expected a "profiles" array.' }
  }

  const raw: unknown[] = root.profiles
  const considered = raw.slice(0, MAX_IMPORT_PROFILES)
  let skipped = raw.length - considered.length

  const now = Date.now()
  const taken = new Set<string>()
  const profiles: Profile[] = []

  for (const item of considered) {
    const parsed = ImportProfileSchema.safeParse(item)
    const baseName = parsed.success ? clampName(parsed.data.name) : ''
    if (!parsed.success || baseName === '') {
      skipped++
      continue
    }
    const p = parsed.data
    const name = uniqueName(baseName, taken)
    taken.add(name)
    profiles.push({
      id: newId(),
      name,
      url: p.url,
      transport: p.transport,
      protocolVersion: p.protocolVersion,
      headers: p.headers.map((h) => {
        const secret = h.secret ?? isSecretHeaderName(h.name)
        // A header that is secret by name never keeps its value, even if the file says secret:false.
        const blank = secret || isSecretHeaderName(h.name)
        return { id: newId(), name: h.name, value: blank ? '' : h.value, secret, enabled: h.enabled }
      }),
      persistSecrets: false,
      auth: { mode: p.auth.mode, scope: p.auth.scope, clientId: p.auth.clientId },
      createdAt: now,
      updatedAt: now,
    })
  }

  return { ok: true, profiles, skipped }
}
