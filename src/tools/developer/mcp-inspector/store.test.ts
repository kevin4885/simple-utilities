import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PERSISTED_SECRETS_KEY, SESSION_SECRETS_KEY, getSecret, setSecret } from './secrets'
import { STORE_KEY, mergePersisted, useMcpInspectorStore } from './store'
import type { HeaderEntry, HistoryEntry, Profile } from './schemas'

type StoreModule = typeof import('./store')

function allLocalText(): string {
  let out = ''
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)!
    out += k + '=' + localStorage.getItem(k) + '\n'
  }
  return out
}

function mainBlob(): string {
  return localStorage.getItem(STORE_KEY) ?? ''
}

function validProfile(over: Partial<Profile> = {}): Profile {
  return {
    id: 'p1',
    name: 'Prod',
    url: 'https://x.test/mcp',
    transport: 'auto',
    protocolVersion: null,
    headers: [],
    persistSecrets: false,
    auth: { mode: 'none', scope: null, clientId: null },
    createdAt: 1,
    updatedAt: 2,
    ...over,
  }
}

function hdr(over: Partial<HeaderEntry> = {}): HeaderEntry {
  return { id: 'h1', name: 'Authorization', value: '', secret: true, enabled: true, ...over }
}

function entry(profileId: string, n = 0): Omit<HistoryEntry, 'id' | 'ts'> {
  return { profileId, kind: 'tool', name: `tool${n}`, argsJson: '{}', ok: true, durationMs: 5 }
}

/** A freshly evaluated store module, hydrated from whatever is in localStorage right now. */
async function freshStore(): Promise<StoreModule['useMcpInspectorStore']> {
  vi.resetModules()
  const mod = (await import('./store')) as StoreModule
  return mod.useMcpInspectorStore
}

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  useMcpInspectorStore.setState({ profiles: [], activeProfileId: null, history: [], prefs: { saveHistory: true } })
})

afterEach(() => {
  vi.restoreAllMocks()
})

const get = () => useMcpInspectorStore.getState()

describe('rehydration', () => {
  it.each([
    ['non-JSON garbage', '%%% not json'],
    ['a JSON string', JSON.stringify('hello')],
    ['an array', JSON.stringify([1, 2])],
    ['missing version', JSON.stringify({ state: { profiles: [validProfile()], history: [] } })],
    ['wrong version', JSON.stringify({ state: { profiles: [validProfile()] }, version: 2 })],
    ['state of the wrong type', JSON.stringify({ state: 'oops', version: 1 })],
    ['null state', JSON.stringify({ state: null, version: 1 })],
  ])('%s yields defaults and does not throw', async (_label, text) => {
    localStorage.setItem(STORE_KEY, text)
    const store = await freshStore()
    const s = store.getState()
    expect(s.profiles).toEqual([])
    expect(s.history).toEqual([])
    expect(s.prefs.saveHistory).toBe(true)
    expect(s.activeProfileId).toBeNull()
  })

  it('wrong field types inside state yield defaults for those fields', async () => {
    localStorage.setItem(
      STORE_KEY,
      JSON.stringify({ state: { profiles: 'nope', history: 5, prefs: { saveHistory: 'yes' }, activeProfileId: 3 }, version: 1 }),
    )
    const s = (await freshStore()).getState()
    expect(s.profiles).toEqual([])
    expect(s.history).toEqual([])
    expect(s.prefs.saveHistory).toBe(true)
    expect(s.activeProfileId).toBeNull()
  })

  it('keeps the valid profile and drops the invalid one', async () => {
    localStorage.setItem(
      STORE_KEY,
      JSON.stringify({
        version: 1,
        state: {
          profiles: [validProfile({ id: 'good' }), { ...validProfile({ id: 'bad' }), transport: 'carrier-pigeon' }, 'junk'],
          activeProfileId: 'good',
          history: [],
          prefs: { saveHistory: false },
        },
      }),
    )
    const s = (await freshStore()).getState()
    expect(s.profiles.map((p) => p.id)).toEqual(['good'])
    expect(s.activeProfileId).toBe('good')
    expect(s.prefs.saveHistory).toBe(false)
  })

  it('drops unknown extra fields', async () => {
    localStorage.setItem(
      STORE_KEY,
      JSON.stringify({
        version: 1,
        state: { profiles: [{ ...validProfile(), evil: 'x', headers: [{ ...hdr({ secret: false, value: 'v' }), extra: 1 }] }], extraTop: 1 },
      }),
    )
    const s = (await freshStore()).getState() as unknown as Record<string, unknown>
    const p = (s.profiles as Record<string, unknown>[])[0]
    expect(p.evil).toBeUndefined()
    expect((p.headers as Record<string, unknown>[])[0].extra).toBeUndefined()
    expect(s.extraTop).toBeUndefined()
  })

  it('blanks a secret header value found in a tampered blob', async () => {
    localStorage.setItem(
      STORE_KEY,
      JSON.stringify({ version: 1, state: { profiles: [validProfile({ headers: [hdr({ value: 'LEAKED' })] })] } }),
    )
    const s = (await freshStore()).getState()
    expect(s.profiles[0].headers[0].value).toBe('')
  })

  it('drops history for unknown profiles, invalid rows and clears a dangling active id', async () => {
    const good = { id: 'e1', ts: 1, profileId: 'p1', kind: 'tool', name: 'n', argsJson: '{}', ok: true, durationMs: 1 }
    localStorage.setItem(
      STORE_KEY,
      JSON.stringify({
        version: 1,
        state: {
          profiles: [validProfile()],
          activeProfileId: 'ghost',
          history: [good, { ...good, id: 'e2', profileId: 'ghost' }, { ...good, id: 'e3', kind: 'bogus' }],
        },
      }),
    )
    const s = (await freshStore()).getState()
    expect(s.history.map((h) => h.id)).toEqual(['e1'])
    expect(s.activeProfileId).toBeNull()
  })

  it('mergePersisted returns current for non-object input', () => {
    const current = get()
    expect(mergePersisted(undefined, current)).toBe(current)
    expect(mergePersisted('x', current)).toBe(current)
    expect(mergePersisted([], current)).toBe(current)
  })
})

describe('addProfile / updateProfile', () => {
  it('addProfile applies defaults and activates the profile', () => {
    const p = get().addProfile()
    expect(p).toMatchObject({
      transport: 'auto',
      protocolVersion: null,
      headers: [],
      persistSecrets: false,
      auth: { mode: 'none', scope: null, clientId: null },
      name: 'New profile',
      url: '',
    })
    expect(p.id).toBeTruthy()
    expect(get().profiles).toEqual([p])
    expect(get().activeProfileId).toBe(p.id)
  })

  it('addProfile honours name and url, falling back to the default for a blank name', () => {
    const a = get().addProfile({ name: '  Staging  ', url: 'https://s.test' })
    expect(a.name).toBe('Staging')
    expect(a.url).toBe('https://s.test')
    expect(get().addProfile({ name: '   ' }).name).toBe('New profile')
    expect(get().activeProfileId).toBe(get().profiles[1].id)
  })

  it('updateProfile bumps updatedAt and never changes id/createdAt', () => {
    const p = get().addProfile({ name: 'A' })
    get().updateProfile(p.id, { url: 'https://new.test', id: 'hijack', createdAt: 0 } as Partial<Profile>)
    const q = get().profiles[0]
    expect(q.id).toBe(p.id)
    expect(q.createdAt).toBe(p.createdAt)
    expect(q.url).toBe('https://new.test')
    expect(q.updatedAt).toBeGreaterThan(p.updatedAt)
  })

  it('updateProfile on an unknown id is a no-op', () => {
    get().addProfile()
    const before = get().profiles
    get().updateProfile('nope', { url: 'x' })
    expect(get().profiles).toBe(before)
  })

  it('rejects more than 50 headers and keeps the previous headers', () => {
    const p = get().addProfile()
    get().updateProfile(p.id, { headers: [hdr({ id: 'h1', secret: false, name: 'X-A', value: 'a' })] })
    const tooMany = Array.from({ length: 51 }, (_, i) => hdr({ id: `h${i}`, secret: false, name: `X-${i}`, value: '' }))
    get().updateProfile(p.id, { headers: tooMany, url: 'https://still-applied.test' })
    expect(get().profiles[0].headers).toHaveLength(1)
    expect(get().profiles[0].headers[0].name).toBe('X-A')
    get().updateProfile(p.id, { headers: tooMany.slice(0, 50) })
    expect(get().profiles[0].headers).toHaveLength(50)
  })

  it('clamps names to 80 chars and ignores a blank rename', () => {
    const p = get().addProfile({ name: 'Keep' })
    get().updateProfile(p.id, { name: 'n'.repeat(200) })
    expect(get().profiles[0].name).toHaveLength(80)
    get().updateProfile(p.id, { name: '   ' })
    expect(get().profiles[0].name).toHaveLength(80)
  })

  it('never stores unknown patch fields in the persisted blob', () => {
    const p = get().addProfile()
    get().updateProfile(p.id, { url: 'https://u.test', evil: 'LEAKFIELD' } as unknown as Partial<Profile>)
    expect(mainBlob()).not.toContain('LEAKFIELD')
    expect((get().profiles[0] as unknown as Record<string, unknown>).evil).toBeUndefined()
    expect(get().profiles[0].url).toBe('https://u.test')
  })

  it('ignores a patch with duplicate header ids or an id containing a colon', () => {
    const p = get().addProfile()
    get().updateProfile(p.id, { headers: [hdr({ id: 'a', secret: false, value: '1' })] })
    get().updateProfile(p.id, {
      headers: [hdr({ id: 'd', secret: false, value: 'x' }), hdr({ id: 'd', secret: false, value: 'y' })],
    })
    expect(get().profiles[0].headers.map((h) => h.id)).toEqual(['a'])
    get().updateProfile(p.id, { headers: [hdr({ id: 'a:b', secret: false, value: 'x' })] })
    expect(get().profiles[0].headers.map((h) => h.id)).toEqual(['a'])
  })

  it('ignores a patch that would make the profile invalid', () => {
    const p = get().addProfile()
    get().updateProfile(p.id, { transport: 'carrier-pigeon' } as unknown as Partial<Profile>)
    expect(get().profiles[0].transport).toBe('auto')
  })
})

describe('secret separation in the persisted blob', () => {
  it('moves a secret header value into session storage; the stored blob has value ""', () => {
    const p = get().addProfile()
    get().updateProfile(p.id, { headers: [hdr({ id: 'h1', value: 'abcSECRET' })] })
    expect(get().profiles[0].headers[0].value).toBe('')
    expect(mainBlob()).not.toBe('')
    expect(allLocalText()).not.toContain('abcSECRET')
    expect(sessionStorage.getItem(SESSION_SECRETS_KEY)).toContain('abcSECRET')
    expect(getSecret(`hdr:${p.id}:h1`)).toBe('abcSECRET')
    const stored = JSON.parse(mainBlob()).state.profiles[0].headers[0]
    expect(stored).toMatchObject({ secret: true, value: '' })
  })

  it('with persistSecrets the value goes to su:mcp-inspector-secrets but never into the main blob', () => {
    const p = get().addProfile()
    get().updateProfile(p.id, { persistSecrets: true, headers: [hdr({ id: 'h1', value: 'abcSECRET' })] })
    expect(localStorage.getItem(PERSISTED_SECRETS_KEY)).toContain('abcSECRET')
    expect(mainBlob()).not.toContain('abcSECRET')
    expect(sessionStorage.getItem(SESSION_SECRETS_KEY)).toBeNull()
    expect(getSecret(`hdr:${p.id}:h1`)).toBe('abcSECRET')
  })

  it('keeps a non-secret header value in the profile', () => {
    const p = get().addProfile()
    get().updateProfile(p.id, { headers: [hdr({ id: 'n', secret: false, name: 'X-Plain', value: 'visible' })] })
    expect(get().profiles[0].headers[0].value).toBe('visible')
    expect(mainBlob()).toContain('visible')
  })

  it('an empty value on a secret header leaves the stored secret untouched', () => {
    const p = get().addProfile()
    get().updateProfile(p.id, { headers: [hdr({ id: 'h1', value: 'abcSECRET' })] })
    get().updateProfile(p.id, { headers: [hdr({ id: 'h1', value: '', name: 'Authorization' })] })
    expect(getSecret(`hdr:${p.id}:h1`)).toBe('abcSECRET')
  })

  it('removing a header, or un-flagging it as secret, deletes its stored secret', () => {
    const p = get().addProfile()
    get().updateProfile(p.id, { headers: [hdr({ id: 'h1', value: 'S1' }), hdr({ id: 'h2', value: 'S2', name: 'X-Key' })] })
    get().updateProfile(p.id, { headers: [hdr({ id: 'h2', value: '', name: 'X-Key', secret: false })] })
    expect(getSecret(`hdr:${p.id}:h1`)).toBeNull()
    expect(getSecret(`hdr:${p.id}:h2`)).toBeNull()
  })

  it('re-entering a secret after switching tier does not leave a stale copy behind', () => {
    const p = get().addProfile()
    get().updateProfile(p.id, { persistSecrets: true, headers: [hdr({ id: 'h1', value: 'OLD' })] })
    get().updateProfile(p.id, { persistSecrets: false })
    get().updateProfile(p.id, { headers: [hdr({ id: 'h1', value: 'NEW' })] })
    expect(getSecret(`hdr:${p.id}:h1`)).toBe('NEW')
    expect(allLocalText()).not.toContain('OLD')
  })

  it('a rejected 51-header patch does not write any secret', () => {
    const p = get().addProfile()
    const many = Array.from({ length: 51 }, (_, i) => hdr({ id: `h${i}`, value: 'REJECTED' }))
    get().updateProfile(p.id, { headers: many })
    expect(sessionStorage.getItem(SESSION_SECRETS_KEY)).toBeNull()
    expect(allLocalText()).not.toContain('REJECTED')
  })
})

describe('persistSecrets transitions', () => {
  it('true -> false deletes persisted hdr/oauth tokens+client copies, keeps session copies and other keys', () => {
    const p = get().addProfile()
    get().updateProfile(p.id, { persistSecrets: true })
    const id = p.id
    setSecret(`hdr:${id}:h1`, 'H-PERSISTED', { persist: true })
    setSecret(`oauth:${id}:tokens`, 'T-PERSISTED', { persist: true })
    setSecret(`oauth:${id}:client`, 'C-PERSISTED', { persist: true })
    setSecret(`hdr:${id}:h2`, 'H2-SESSION', { persist: false })
    setSecret(`oauth:${id}:verifier`, 'VERIFIER', { persist: false })
    setSecret('hdr:other:h', 'OTHER', { persist: true })

    get().updateProfile(id, { persistSecrets: false })

    const local = localStorage.getItem(PERSISTED_SECRETS_KEY) ?? ''
    expect(local).not.toContain('H-PERSISTED')
    expect(local).not.toContain('T-PERSISTED')
    expect(local).not.toContain('C-PERSISTED')
    expect(local).toContain('OTHER')
    expect(getSecret(`hdr:${id}:h2`)).toBe('H2-SESSION')
    expect(getSecret(`oauth:${id}:verifier`)).toBe('VERIFIER')
    expect(getSecret('hdr:other:h')).toBe('OTHER')
  })

  it('true -> false while the value exists in both tiers keeps the session copy readable', () => {
    const p = get().addProfile()
    get().updateProfile(p.id, { persistSecrets: true })
    setSecret(`hdr:${p.id}:h1`, 'BOTH', { persist: true })
    setSecret(`hdr:${p.id}:h1`, 'BOTH', { persist: false })
    get().updateProfile(p.id, { persistSecrets: false })
    expect(localStorage.getItem(PERSISTED_SECRETS_KEY)).toBeNull()
    expect(getSecret(`hdr:${p.id}:h1`)).toBe('BOTH')
  })

  it('false -> true copies session values (hdr, tokens, client) into persisted storage, not verifier/state', () => {
    const p = get().addProfile()
    const id = p.id
    setSecret(`hdr:${id}:h1`, 'H1', { persist: false })
    setSecret(`oauth:${id}:tokens`, 'TOK', { persist: false })
    setSecret(`oauth:${id}:client`, 'CLI', { persist: false })
    setSecret(`oauth:${id}:verifier`, 'VER', { persist: false })
    setSecret(`oauth:${id}:state`, 'STA', { persist: false })
    setSecret('hdr:other:h', 'OTHER-SESSION', { persist: false })

    get().updateProfile(id, { persistSecrets: true })

    const local = JSON.parse(localStorage.getItem(PERSISTED_SECRETS_KEY)!)
    expect(local).toEqual({ [`hdr:${id}:h1`]: 'H1', [`oauth:${id}:tokens`]: 'TOK', [`oauth:${id}:client`]: 'CLI' })
    expect(mainBlob()).not.toContain('H1')
    // moved, not copied: verifier/state/other profiles stay session-only, persisted values are not shadowed
    const session = JSON.parse(sessionStorage.getItem(SESSION_SECRETS_KEY)!)
    expect(Object.keys(session).sort()).toEqual(['hdr:other:h', `oauth:${id}:state`, `oauth:${id}:verifier`].sort())
    setSecret(`oauth:${id}:tokens`, 'TOK2', { persist: true })
    expect(getSecret(`oauth:${id}:tokens`)).toBe('TOK2')
  })

  it('updating other fields does not touch secret storage', () => {
    const p = get().addProfile()
    setSecret(`hdr:${p.id}:h1`, 'KEEP', { persist: false })
    get().updateProfile(p.id, { url: 'https://u.test' })
    expect(localStorage.getItem(PERSISTED_SECRETS_KEY)).toBeNull()
    expect(getSecret(`hdr:${p.id}:h1`)).toBe('KEEP')
  })
})

describe('deleteProfile', () => {
  it('removes the profile secrets from both storages, its history, and clears the active id', () => {
    const a = get().addProfile({ name: 'A' })
    const b = get().addProfile({ name: 'B' })
    setSecret(`hdr:${a.id}:h`, 'A-S', { persist: false })
    setSecret(`hdr:${a.id}:g`, 'A-L', { persist: true })
    setSecret(`oauth:${a.id}:tokens`, 'A-TOK', { persist: true })
    setSecret(`oauth:${a.id}:verifier`, 'A-VER', { persist: false })
    setSecret(`hdr:${b.id}:h`, 'B-S', { persist: false })
    setSecret(`oauth:${b.id}:client`, 'B-L', { persist: true })
    get().pushHistory(entry(a.id, 1))
    get().pushHistory(entry(b.id, 2))
    get().setActiveProfile(a.id)

    get().deleteProfile(a.id)

    expect(get().profiles.map((p) => p.id)).toEqual([b.id])
    expect(get().activeProfileId).toBeNull()
    expect(get().history.map((h) => h.profileId)).toEqual([b.id])
    for (const k of [`hdr:${a.id}:h`, `hdr:${a.id}:g`, `oauth:${a.id}:tokens`, `oauth:${a.id}:verifier`]) {
      expect(getSecret(k)).toBeNull()
    }
    expect(getSecret(`hdr:${b.id}:h`)).toBe('B-S')
    expect(getSecret(`oauth:${b.id}:client`)).toBe('B-L')
    expect(allLocalText()).not.toContain('A-L')
    expect(sessionStorage.getItem(SESSION_SECRETS_KEY) ?? '').not.toContain('A-S')
  })

  it('keeps activeProfileId when another profile is deleted', () => {
    const a = get().addProfile()
    const b = get().addProfile()
    get().deleteProfile(a.id)
    expect(get().activeProfileId).toBe(b.id)
  })

  it('does not match a profile whose id merely starts with the deleted id', () => {
    const a = get().addProfile()
    useMcpInspectorStore.setState((s) => ({ profiles: [...s.profiles, { ...a, id: `${a.id}-longer` }] }))
    setSecret(`hdr:${a.id}-longer:h`, 'LONGER', { persist: false })
    get().deleteProfile(a.id)
    expect(getSecret(`hdr:${a.id}-longer:h`)).toBe('LONGER')
  })
})

describe('duplicateProfile', () => {
  it('copies with new ids, "(copy)" name, persistSecrets false and blank secret values; copies no secrets', () => {
    const p = get().addProfile({ name: 'Prod', url: 'https://x.test' })
    get().updateProfile(p.id, {
      persistSecrets: true,
      transport: 'sse',
      auth: { mode: 'oauth', scope: 'read', clientId: 'cid' },
      headers: [hdr({ id: 'h1', value: 'DUPSECRET' }), hdr({ id: 'h2', secret: false, name: 'X-Plain', value: 'plain' })],
    })
    setSecret(`oauth:${p.id}:tokens`, 'DUPTOKEN', { persist: true })
    const before = {
      local: localStorage.getItem(PERSISTED_SECRETS_KEY),
      session: sessionStorage.getItem(SESSION_SECRETS_KEY),
    }
    const src = get().profiles[0]

    const copy = get().duplicateProfile(p.id)!

    expect(copy).not.toBeNull()
    expect(copy.id).not.toBe(p.id)
    expect(copy.name).toBe('Prod (copy)')
    expect(copy.persistSecrets).toBe(false)
    expect(copy.url).toBe('https://x.test')
    expect(copy.transport).toBe('sse')
    expect(copy.auth).toEqual({ mode: 'oauth', scope: 'read', clientId: 'cid' })
    expect(copy.headers.map((h) => h.id)).not.toContain('h1')
    expect(copy.headers.map((h) => h.id)).not.toContain('h2')
    expect(copy.headers[0]).toMatchObject({ secret: true, value: '' })
    expect(copy.headers[1]).toMatchObject({ secret: false, value: 'plain' })
    expect(get().profiles).toHaveLength(2)
    expect(get().profiles[0]).toEqual(src)
    // no secret copied in either storage
    expect(localStorage.getItem(PERSISTED_SECRETS_KEY)).toBe(before.local)
    expect(sessionStorage.getItem(SESSION_SECRETS_KEY)).toBe(before.session)
    expect(getSecret(`hdr:${copy.id}:${copy.headers[0].id}`)).toBeNull()
    expect(getSecret(`oauth:${copy.id}:tokens`)).toBeNull()
  })

  it('returns null for an unknown id and adds nothing', () => {
    get().addProfile()
    expect(get().duplicateProfile('nope')).toBeNull()
    expect(get().profiles).toHaveLength(1)
  })

  it('keeps a long name within 80 chars', () => {
    const p = get().addProfile({ name: 'x'.repeat(80) })
    const copy = get().duplicateProfile(p.id)!
    expect(copy.name).toHaveLength(80)
    expect(copy.name.endsWith('(copy)')).toBe(true)
  })
})

describe('setActiveProfile / setPrefs', () => {
  it('sets and clears the active profile; ignores an unknown id', () => {
    const p = get().addProfile()
    get().setActiveProfile(null)
    expect(get().activeProfileId).toBeNull()
    get().setActiveProfile(p.id)
    expect(get().activeProfileId).toBe(p.id)
    get().setActiveProfile('ghost')
    expect(get().activeProfileId).toBe(p.id)
  })

  it('setPrefs merges and rejects wrong types', () => {
    get().setPrefs({ saveHistory: false })
    expect(get().prefs.saveHistory).toBe(false)
    get().setPrefs({ saveHistory: 'yes' } as never)
    expect(get().prefs.saveHistory).toBe(false)
  })
})

describe('history', () => {
  it('pushHistory assigns id/ts and stores the entry', () => {
    get().pushHistory(entry('p1', 1))
    const h = get().history[0]
    expect(h.id).toBeTruthy()
    expect(h.ts).toBeGreaterThan(0)
    expect(h).toMatchObject({ profileId: 'p1', kind: 'tool', name: 'tool1', ok: true, durationMs: 5 })
  })

  it('caps at 200 and drops the oldest', () => {
    for (let i = 0; i < 205; i++) get().pushHistory(entry('p1', i))
    expect(get().history).toHaveLength(200)
    expect(get().history[0].name).toBe('tool5')
    expect(get().history[199].name).toBe('tool204')
  })

  it('truncates argsJson longer than 20000 chars', () => {
    get().pushHistory({ ...entry('p1'), argsJson: 'a'.repeat(30000) })
    expect(get().history[0].argsJson).toBe('a'.repeat(20000) + '…[truncated]')
    get().pushHistory({ ...entry('p1'), argsJson: 'b'.repeat(20000) })
    expect(get().history[1].argsJson).toBe('b'.repeat(20000))
  })

  it('is a no-op when prefs.saveHistory is false', () => {
    get().setPrefs({ saveHistory: false })
    get().pushHistory(entry('p1'))
    expect(get().history).toEqual([])
    get().setPrefs({ saveHistory: true })
    get().pushHistory(entry('p1'))
    expect(get().history).toHaveLength(1)
  })

  it('clearHistory(profileId) removes only that profile; clearHistory() removes all', () => {
    get().pushHistory(entry('p1', 1))
    get().pushHistory(entry('p2', 2))
    get().pushHistory(entry('p1', 3))
    get().clearHistory('p1')
    expect(get().history.map((h) => h.profileId)).toEqual(['p2'])
    get().clearHistory()
    expect(get().history).toEqual([])
  })
})

describe('persistence round trip', () => {
  it('writes a {state, version:1} envelope and a fresh store reads it back without secrets', async () => {
    const p = get().addProfile({ name: 'RT' })
    get().updateProfile(p.id, { headers: [hdr({ id: 'h1', value: 'RTSECRET' })] })
    get().pushHistory(entry(p.id, 1))

    const raw = JSON.parse(mainBlob())
    expect(raw.version).toBe(1)
    expect(Object.keys(raw.state).sort()).toEqual(['activeProfileId', 'history', 'prefs', 'profiles'])

    const s = (await freshStore()).getState()
    expect(s.profiles).toHaveLength(1)
    expect(s.profiles[0].headers[0].value).toBe('')
    expect(s.history).toHaveLength(1)
    expect(s.activeProfileId).toBe(p.id)
    expect(getSecret(`hdr:${p.id}:h1`)).toBe('RTSECRET')
  })

  it('does not throw when localStorage refuses the write', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError')
    })
    expect(() => get().addProfile()).not.toThrow()
  })
})
