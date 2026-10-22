// Two-tier secret storage for the MCP Inspector (contract C1/C4, plan "Security surfaces" 1).
//
// This is the ONLY module that touches the two secret storages:
//   - sessionStorage `su:mcp-inspector-session`  (default; cleared when the tab session ends)
//   - localStorage   `su:mcp-inspector-secrets`  (only for profiles with persistSecrets: true)
// Both hold a flat `Record<string,string>` validated with Zod on every read. No function here
// throws: storage can be disabled, full, or tampered with.
//
// Key namespaces: `hdr:<profileId>:<headerId>`, `oauth:<profileId>:tokens|client|verifier|state`,
// `oauth:pending-return`. `verifier`, `state` and `pending-return` are always written with
// `persist: false` by their callers.

import { z } from 'zod'

export const SESSION_SECRETS_KEY = 'su:mcp-inspector-session'
export const PERSISTED_SECRETS_KEY = 'su:mcp-inspector-secrets'

const SecretMapSchema = z.record(z.string(), z.string())
type SecretMap = Record<string, string>

type Tier = 'session' | 'persisted'

function storageFor(tier: Tier): Storage {
  return tier === 'session' ? window.sessionStorage : window.localStorage
}

function keyFor(tier: Tier): string {
  return tier === 'session' ? SESSION_SECRETS_KEY : PERSISTED_SECRETS_KEY
}

/** Reads one tier. `null` = storage unavailable or content unusable; callers decide what that means. */
function readTier(tier: Tier): SecretMap | null {
  try {
    const raw = storageFor(tier).getItem(keyFor(tier))
    if (raw === null) return {}
    const parsed = SecretMapSchema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

/** Writes one tier; an empty map removes the item. Returns false when storage refuses. */
function writeTier(tier: Tier, map: SecretMap): boolean {
  try {
    const storage = storageFor(tier)
    if (Object.keys(map).length === 0) storage.removeItem(keyFor(tier))
    else storage.setItem(keyFor(tier), JSON.stringify(map))
    return true
  } catch {
    return false
  }
}

/** Existing entries of a tier for read-modify-write; unusable content is replaced, not merged. */
function readForUpdate(tier: Tier): SecretMap {
  return readTier(tier) ?? {}
}

function has(map: SecretMap, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(map, key)
}

/** The stored secret, or null. A session value wins over a persisted value. */
export function getSecret(key: string): string | null {
  const session = readTier('session')
  if (session && has(session, key)) return session[key]
  const persisted = readTier('persisted')
  if (persisted && has(persisted, key)) return persisted[key]
  return null
}

/** Stores a secret in exactly one tier. Returns false (never throws) if that storage refuses. */
export function setSecret(key: string, value: string, o: { persist: boolean }): boolean {
  const tier: Tier = o.persist ? 'persisted' : 'session'
  const map = readForUpdate(tier)
  map[key] = value
  return writeTier(tier, map)
}

/**
 * Like setSecret, but also removes the key from the other tier so a stale copy can never shadow
 * (session wins on read) or outlive the value the user just set. Used when a user edits a value.
 */
export function replaceSecret(key: string, value: string, o: { persist: boolean }): boolean {
  const ok = setSecret(key, value, o)
  if (!ok) return false
  removeFromTier(o.persist ? 'session' : 'persisted', (k) => k === key)
  return true
}

function removeFromTier(tier: Tier, match: (key: string) => boolean): void {
  const map = readTier(tier)
  if (!map) {
    // Unreadable (corrupt/tampered) content cannot be selectively cleaned: drop the whole item.
    try {
      storageFor(tier).removeItem(keyFor(tier))
    } catch {
      // storage unavailable: nothing more we can do
    }
    return
  }
  const kept: SecretMap = {}
  let changed = false
  for (const k of Object.keys(map)) {
    if (match(k)) changed = true
    else kept[k] = map[k]
  }
  if (changed) writeTier(tier, kept)
}

/** Deletes a secret from BOTH tiers. */
export function deleteSecret(key: string): void {
  const match = (k: string) => k === key
  removeFromTier('session', match)
  removeFromTier('persisted', match)
}

/** Deletes every secret whose key starts with `prefix` from BOTH tiers. */
export function deleteSecretsWithPrefix(prefix: string): void {
  const match = (k: string) => k.startsWith(prefix)
  removeFromTier('session', match)
  removeFromTier('persisted', match)
}

/**
 * Re-homes the secrets under the given key prefixes when a profile's `persistSecrets` flips.
 *  - persist=false: the persisted copies are removed from localStorage; session copies stay.
 *  - persist=true: session values are MOVED into the persisted tier. The session copy is removed
 *    because the session tier wins on read: a stale session copy would otherwise shadow every
 *    later persisted write (e.g. a refreshed OAuth token).
 * Returns false if the persisted write was refused (nothing is removed from the session then).
 */
export function syncPersistedTier(prefixes: string[], persist: boolean): boolean {
  const match = (k: string) => prefixes.some((p) => k.startsWith(p))
  if (!persist) {
    removeFromTier('persisted', match)
    return true
  }
  const session = readTier('session')
  if (!session) return true
  const moving = Object.keys(session).filter(match)
  if (moving.length === 0) return true
  const persisted = readForUpdate('persisted')
  for (const k of moving) persisted[k] = session[k]
  if (!writeTier('persisted', persisted)) return false
  removeFromTier('session', (k) => moving.includes(k))
  return true
}