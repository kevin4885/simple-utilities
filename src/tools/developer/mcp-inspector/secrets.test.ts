import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  PERSISTED_SECRETS_KEY,
  SESSION_SECRETS_KEY,
  deleteSecret,
  deleteSecretsWithPrefix,
  getSecret,
  replaceSecret,
  setSecret,
  syncPersistedTier,
} from './secrets'

function allLocalText(): string {
  let out = ''
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)!
    out += k + '=' + localStorage.getItem(k) + '\n'
  }
  return out
}

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
})
afterEach(() => {
  vi.restoreAllMocks()
})

describe('setSecret / getSecret', () => {
  it('session default: value only in sessionStorage, never in localStorage', () => {
    expect(setSecret('hdr:p:h', 'TOPSECRET', { persist: false })).toBe(true)
    expect(allLocalText()).not.toContain('TOPSECRET')
    expect(sessionStorage.getItem(SESSION_SECRETS_KEY)).toContain('TOPSECRET')
    expect(getSecret('hdr:p:h')).toBe('TOPSECRET')
  })

  it('persist:true: value under su:mcp-inspector-secrets, not in the main blob, not in session', () => {
    localStorage.setItem('su:mcp-inspector', JSON.stringify({ state: {}, version: 1 }))
    expect(setSecret('hdr:p:h', 'PERSISTED', { persist: true })).toBe(true)
    expect(localStorage.getItem(PERSISTED_SECRETS_KEY)).toContain('PERSISTED')
    expect(localStorage.getItem('su:mcp-inspector')).not.toContain('PERSISTED')
    expect(sessionStorage.getItem(SESSION_SECRETS_KEY)).toBeNull()
    expect(getSecret('hdr:p:h')).toBe('PERSISTED')
  })

  it('session value wins over persisted value', () => {
    setSecret('k', 'from-local', { persist: true })
    setSecret('k', 'from-session', { persist: false })
    expect(getSecret('k')).toBe('from-session')
  })

  it('returns null for an unknown key', () => {
    expect(getSecret('nope')).toBeNull()
  })

  it('does not treat prototype names as stored keys', () => {
    setSecret('a', '1', { persist: false })
    expect(getSecret('constructor')).toBeNull()
    expect(getSecret('toString')).toBeNull()
  })

  it('stores an empty-string value (not confused with missing)', () => {
    setSecret('k', '', { persist: false })
    expect(getSecret('k')).toBe('')
  })
})

describe('storage failures', () => {
  it('setSecret returns false (no throw) when the target storage throws on write', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError')
    })
    expect(setSecret('k', 'v', { persist: false })).toBe(false)
    expect(setSecret('k', 'v', { persist: true })).toBe(false)
  })

  it('setSecret returns false when only the persisted tier is unavailable', () => {
    const real = Storage.prototype.setItem
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, k: string, v: string) {
      if (this === window.localStorage) throw new Error('disabled')
      return real.call(this, k, v)
    })
    expect(setSecret('k', 'v', { persist: true })).toBe(false)
    expect(setSecret('k', 'v', { persist: false })).toBe(true)
  })

  it('getSecret returns null when storage throws on read', () => {
    setSecret('k', 'v', { persist: false })
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied')
    })
    expect(getSecret('k')).toBeNull()
  })

  it('getSecret returns null for invalid JSON or wrong shape in either tier', () => {
    sessionStorage.setItem(SESSION_SECRETS_KEY, '{not json')
    localStorage.setItem(PERSISTED_SECRETS_KEY, JSON.stringify({ k: 42 }))
    expect(getSecret('k')).toBeNull()
    localStorage.setItem(PERSISTED_SECRETS_KEY, JSON.stringify(['k']))
    expect(getSecret('k')).toBeNull()
  })

  it('setSecret overwrites an unusable tier instead of failing', () => {
    sessionStorage.setItem(SESSION_SECRETS_KEY, 'garbage')
    expect(setSecret('k', 'v', { persist: false })).toBe(true)
    expect(getSecret('k')).toBe('v')
  })

  it('delete helpers do not throw when storage throws', () => {
    setSecret('k', 'v', { persist: true })
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied')
    })
    expect(() => deleteSecret('k')).not.toThrow()
    expect(() => deleteSecretsWithPrefix('k')).not.toThrow()
  })
})

describe('deleteSecret / deleteSecretsWithPrefix', () => {
  it('deleteSecret removes from both tiers and leaves other keys', () => {
    setSecret('a', '1', { persist: true })
    setSecret('a', '2', { persist: false })
    setSecret('b', '3', { persist: false })
    deleteSecret('a')
    expect(getSecret('a')).toBeNull()
    expect(getSecret('b')).toBe('3')
  })

  it('removes the storage item entirely when the last secret goes', () => {
    setSecret('a', '1', { persist: true })
    deleteSecret('a')
    expect(localStorage.getItem(PERSISTED_SECRETS_KEY)).toBeNull()
  })

  it('deleteSecretsWithPrefix removes matching keys in both tiers only', () => {
    setSecret('hdr:p1:a', 'x', { persist: true })
    setSecret('hdr:p1:b', 'y', { persist: false })
    setSecret('hdr:p10:a', 'keep-p10', { persist: false })
    setSecret('hdr:p2:a', 'keep-p2', { persist: true })
    deleteSecretsWithPrefix('hdr:p1:')
    expect(getSecret('hdr:p1:a')).toBeNull()
    expect(getSecret('hdr:p1:b')).toBeNull()
    expect(getSecret('hdr:p10:a')).toBe('keep-p10')
    expect(getSecret('hdr:p2:a')).toBe('keep-p2')
  })
})

describe('replaceSecret', () => {
  it('writes the new tier and drops the stale copy in the other tier', () => {
    setSecret('k', 'old', { persist: true })
    expect(replaceSecret('k', 'new', { persist: false })).toBe(true)
    expect(localStorage.getItem(PERSISTED_SECRETS_KEY)).toBeNull()
    expect(getSecret('k')).toBe('new')
    expect(replaceSecret('k', 'newer', { persist: true })).toBe(true)
    expect(sessionStorage.getItem(SESSION_SECRETS_KEY)).toBeNull()
    expect(getSecret('k')).toBe('newer')
  })

  it('keeps the old copy in the other tier when the write fails', () => {
    setSecret('k', 'old', { persist: false })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('full')
    })
    expect(replaceSecret('k', 'new', { persist: true })).toBe(false)
    expect(getSecret('k')).toBe('old')
  })
})

describe('syncPersistedTier', () => {
  it('persist=false removes persisted matches, keeps session copies and non-matching keys', () => {
    setSecret('hdr:p:a', 'persisted-only', { persist: true })
    setSecret('hdr:p:b', 'both-local', { persist: true })
    setSecret('hdr:p:b', 'both-session', { persist: false })
    setSecret('hdr:other:a', 'other', { persist: true })
    expect(syncPersistedTier(['hdr:p:'], false)).toBe(true)
    const local = JSON.parse(localStorage.getItem(PERSISTED_SECRETS_KEY)!)
    expect(local).toEqual({ 'hdr:other:a': 'other' })
    expect(getSecret('hdr:p:b')).toBe('both-session')
  })

  it('persist=true copies matching session values into persisted storage, keeping session copies', () => {
    setSecret('hdr:p:a', 'S1', { persist: false })
    setSecret('oauth:p:verifier', 'VERIFIER', { persist: false })
    expect(syncPersistedTier(['hdr:p:'], true)).toBe(true)
    const local = JSON.parse(localStorage.getItem(PERSISTED_SECRETS_KEY)!)
    expect(local).toEqual({ 'hdr:p:a': 'S1' })
    expect(sessionStorage.getItem(SESSION_SECRETS_KEY)).toContain('S1')
  })

  it('persist=true with nothing to copy writes nothing', () => {
    expect(syncPersistedTier(['hdr:p:'], true)).toBe(true)
    expect(localStorage.getItem(PERSISTED_SECRETS_KEY)).toBeNull()
  })
})
