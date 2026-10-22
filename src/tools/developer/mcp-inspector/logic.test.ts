import { describe, expect, it } from 'vitest'
import {
  allSecretPrefixes,
  clampName,
  exportProfiles,
  headerSecretKey,
  importProfiles,
  isSecretHeaderName,
  nameWithSuffix,
  persistableSecretPrefixes,
  resolveHeaders,
  sanitizeProfileForStorage,
  truncateArgsJson,
} from './logic'
import type { HeaderEntry, Profile } from './schemas'

function header(over: Partial<HeaderEntry> = {}): HeaderEntry {
  return { id: 'h1', name: 'X-Test', value: 'v', secret: false, enabled: true, ...over }
}

function profile(over: Partial<Profile> = {}): Profile {
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

describe('isSecretHeaderName', () => {
  it.each(['Authorization', 'Proxy-Authorization', 'Cookie', 'Set-Cookie', 'X-Auth-Token', 'api-key', 'X-Secret', 'X-Password'])(
    '%s is secret',
    (n) => expect(isSecretHeaderName(n)).toBe(true),
  )
  it.each(['Accept', 'Content-Type', 'X-Request-Id', '', '   '])('%j is not secret', (n) =>
    expect(isSecretHeaderName(n)).toBe(false),
  )
})

describe('key helpers', () => {
  it('builds keys and prefixes', () => {
    expect(headerSecretKey('p', 'h')).toBe('hdr:p:h')
    expect(persistableSecretPrefixes('p')).toEqual(['hdr:p:', 'oauth:p:tokens', 'oauth:p:client'])
    expect(allSecretPrefixes('p')).toEqual(['hdr:p:', 'oauth:p:'])
  })
})

describe('resolveHeaders', () => {
  const none = () => null

  it('includes only enabled headers with non-empty trimmed names, preserving order', () => {
    const p = profile({
      headers: [
        header({ id: 'a', name: 'X-A', value: '1' }),
        header({ id: 'b', name: 'X-B', value: '2', enabled: false }),
        header({ id: 'c', name: '   ', value: '3' }),
        header({ id: 'd', name: '  X-D  ', value: '4' }),
        header({ id: 'e', name: 'X-E', value: '5' }),
      ],
    })
    const r = resolveHeaders(p, none)
    expect(r.headers).toEqual([
      { name: 'X-A', value: '1' },
      { name: 'X-D', value: '4' },
      { name: 'X-E', value: '5' },
    ])
    expect(r.invalid).toEqual([])
    expect(r.warnings).toEqual([])
  })

  it('reads a secret header value through get(), empty string when missing', () => {
    const seen: string[] = []
    const get = (k: string) => {
      seen.push(k)
      return k === 'hdr:p1:s1' ? 'TOKEN' : null
    }
    const p = profile({
      headers: [
        header({ id: 's1', name: 'Authorization', value: 'ignored-in-profile', secret: true }),
        header({ id: 's2', name: 'X-Api-Key', value: '', secret: true }),
      ],
    })
    const r = resolveHeaders(p, get)
    expect(r.headers).toEqual([
      { name: 'Authorization', value: 'TOKEN' },
      { name: 'X-Api-Key', value: '' },
    ])
    expect(seen).toEqual(['hdr:p1:s1', 'hdr:p1:s2'])
  })

  it('does not read the secret of a disabled header (or of a non-secret header)', () => {
    const seen: string[] = []
    const p = profile({
      headers: [
        header({ id: 's1', name: 'Authorization', secret: true, enabled: false }),
        header({ id: 'n1', name: 'X-Plain', secret: false, value: 'plain' }),
      ],
    })
    const r = resolveHeaders(p, (k) => (seen.push(k), 'x'))
    expect(seen).toEqual([])
    expect(r.headers).toEqual([{ name: 'X-Plain', value: 'plain' }])
  })

  it.each(['Bad Name', 'X:Y', 'a/b', 'né'])('puts invalid name %j in invalid and excludes it', (name) => {
    const r = resolveHeaders(profile({ headers: [header({ name }), header({ id: 'ok', name: 'X-Ok' })] }), none)
    expect(r.invalid).toEqual([name])
    expect(r.headers).toEqual([{ name: 'X-Ok', value: 'v' }])
  })

  it.each(['Host', 'Origin', 'Cookie', 'proxy-x', 'sec-fetch-x', 'ORIGIN'])('warns that %s is ignored', (name) => {
    const r = resolveHeaders(profile({ headers: [header({ name })] }), none)
    expect(r.warnings).toHaveLength(1)
    expect(r.warnings[0]).toContain(name)
    expect(r.warnings[0]).toContain('ignored')
    expect(r.invalid).toEqual([])
    expect(r.headers).toHaveLength(1)
  })

  it.each(['Accept', 'Content-Type', 'Mcp-Session-Id', 'mcp-protocol-version'])('warns that %s is overridden', (name) => {
    const r = resolveHeaders(profile({ headers: [header({ name })] }), none)
    expect(r.warnings).toHaveLength(1)
    expect(r.warnings[0]).toContain(name)
    expect(r.warnings[0]).toContain('overridden')
    expect(r.warnings[0]).not.toContain('ignored')
  })

  it('does not warn for ordinary headers', () => {
    expect(resolveHeaders(profile({ headers: [header({ name: 'X-Custom' })] }), none).warnings).toEqual([])
  })
})

describe('name and history helpers', () => {
  it('clampName trims and clamps to 80', () => {
    expect(clampName('  hi  ')).toBe('hi')
    expect(clampName('a'.repeat(100))).toHaveLength(80)
    expect(clampName('   ')).toBe('')
  })

  it('nameWithSuffix keeps the result within 80 chars', () => {
    expect(nameWithSuffix('Prod', ' (copy)')).toBe('Prod (copy)')
    const long = nameWithSuffix('a'.repeat(80), ' (copy)')
    expect(long).toHaveLength(80)
    expect(long.endsWith(' (copy)')).toBe(true)
  })

  it('truncateArgsJson leaves 20000 chars alone and cuts longer text', () => {
    const exact = 'x'.repeat(20000)
    expect(truncateArgsJson(exact)).toBe(exact)
    const cut = truncateArgsJson('x'.repeat(20001))
    expect(cut).toBe('x'.repeat(20000) + '…[truncated]')
  })
})

describe('sanitizeProfileForStorage', () => {
  it('copies only known profile fields', () => {
    const s = sanitizeProfileForStorage({ ...profile(), evil: 'LEAK' } as Profile) as unknown as Record<string, unknown>
    expect(s.evil).toBeUndefined()
    expect(Object.keys(s).sort()).toEqual(
      ['auth', 'createdAt', 'headers', 'id', 'name', 'persistSecrets', 'protocolVersion', 'transport', 'updatedAt', 'url'].sort(),
    )
  })

  it('blanks flagged-secret values only and does not mutate the input', () => {
    const p = profile({
      headers: [header({ id: 'a', name: 'Authorization', value: 'SECRET', secret: true }), header({ id: 'b', value: 'plain' })],
    })
    const s = sanitizeProfileForStorage(p)
    expect(s.headers.map((h) => h.value)).toEqual(['', 'plain'])
    expect(p.headers[0].value).toBe('SECRET')
  })
})

describe('exportProfiles', () => {
  it('emits {version:1, profiles} with secret values blank and persistSecrets false', () => {
    const p = profile({
      persistSecrets: true,
      headers: [
        header({ id: 'a', name: 'X-Flagged', value: 'LEAK1', secret: true }),
        header({ id: 'b', name: 'Authorization', value: 'LEAK2', secret: false }),
        header({ id: 'c', name: 'X-Plain', value: 'keep' }),
      ],
    })
    const text = exportProfiles([p])
    const parsed = JSON.parse(text)
    expect(parsed.version).toBe(1)
    expect(parsed.profiles).toHaveLength(1)
    expect(parsed.profiles[0].persistSecrets).toBe(false)
    expect(parsed.profiles[0].headers.map((h: HeaderEntry) => h.value)).toEqual(['', '', 'keep'])
    expect(text).not.toContain('LEAK1')
    expect(text).not.toContain('LEAK2')
    expect(p.persistSecrets).toBe(true)
  })

  it('exports an empty list', () => {
    expect(JSON.parse(exportProfiles([]))).toEqual({ version: 1, profiles: [] })
  })
})

describe('importProfiles', () => {
  const file = (profiles: unknown[], version: unknown = 1) => JSON.stringify({ version, profiles })

  it('rejects invalid JSON', () => {
    const r = importProfiles('{nope')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/invalid json/i)
  })

  it('rejects a missing version', () => {
    expect(importProfiles(JSON.stringify({ profiles: [] })).ok).toBe(false)
  })

  it.each([[2], [0], ['1'], [null]])('rejects version %j', (v) => {
    expect(importProfiles(file([], v)).ok).toBe(false)
  })

  it('rejects non-object roots and a missing profiles array', () => {
    expect(importProfiles('[]').ok).toBe(false)
    expect(importProfiles('null').ok).toBe(false)
    expect(importProfiles('"x"').ok).toBe(false)
    expect(importProfiles(JSON.stringify({ version: 1 })).ok).toBe(false)
    expect(importProfiles(JSON.stringify({ version: 1, profiles: {} })).ok).toBe(false)
  })

  it('round-trips an export, assigning fresh profile and header ids', () => {
    const p = profile({ headers: [header({ id: 'hh', name: 'X-A', value: 'a' })] })
    const r = importProfiles(exportProfiles([p]))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.skipped).toBe(0)
    expect(r.profiles).toHaveLength(1)
    const q = r.profiles[0]
    expect(q.id).not.toBe('p1')
    expect(q.headers[0].id).not.toBe('hh')
    expect(q.name).toBe('Prod')
    expect(q.url).toBe('https://x.test/mcp')
    expect(q.headers[0]).toMatchObject({ name: 'X-A', value: 'a', secret: false, enabled: true })
    expect(q.persistSecrets).toBe(false)
  })

  it('suffixes duplicate names with (2), (3) in the file and avoids collisions', () => {
    const items = [{ name: 'A', url: 'u' }, { name: 'A', url: 'u' }, { name: 'A', url: 'u' }, { name: 'A (2)', url: 'u' }]
    const r = importProfiles(file(items))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const names = r.profiles.map((p) => p.name)
    expect(names.slice(0, 3)).toEqual(['A', 'A (2)', 'A (3)'])
    expect(new Set(names).size).toBe(names.length)
  })

  it('strips unknown fields and forces persistSecrets false', () => {
    const r = importProfiles(file([{ name: 'A', url: 'u', evil: 'x', persistSecrets: true, id: 'chosen', headers: [{ name: 'H', value: 'v', extra: 1 }] }]))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const p = r.profiles[0] as unknown as Record<string, unknown>
    expect(p.evil).toBeUndefined()
    expect(p.persistSecrets).toBe(false)
    expect(p.id).not.toBe('chosen')
    expect((p.headers as Record<string, unknown>[])[0].extra).toBeUndefined()
  })

  it('drops secret header values found in a hand-edited file (flagged or by name)', () => {
    const r = importProfiles(
      file([
        {
          name: 'A',
          url: 'u',
          headers: [
            { name: 'X-One', value: 'LEAK1', secret: true },
            { name: 'Authorization', value: 'LEAK2' },
            { name: 'X-Api-Key', value: 'LEAK3', secret: false },
            { name: 'X-Plain', value: 'ok', secret: false },
          ],
        },
      ]),
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.profiles[0].headers.map((h) => [h.secret, h.value])).toEqual([
      [true, ''],
      [true, ''],
      [false, ''],
      [false, 'ok'],
    ])
  })

  it('clamps names to 80 chars', () => {
    const r = importProfiles(file([{ name: 'n'.repeat(120), url: 'u' }]))
    expect(r.ok && r.profiles[0].name).toBe('n'.repeat(80))
  })

  it('keeps the first 100 profiles and counts the rest as skipped', () => {
    const items = Array.from({ length: 105 }, (_, i) => ({ name: `P${i}`, url: 'u' }))
    const r = importProfiles(file(items))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.profiles).toHaveLength(100)
    expect(r.skipped).toBe(5)
    expect(r.profiles[99].name).toBe('P99')
  })

  it('skips and counts profiles failing the schema', () => {
    const items = [
      { name: 'ok', url: 'u' },
      { name: 5, url: 'u' },
      'string',
      null,
      { name: 'no-url' },
      { name: '   ', url: 'u' },
      { name: 'bad-transport', url: 'u', transport: 'carrier-pigeon' },
      { name: 'too-many', url: 'u', headers: Array.from({ length: 51 }, () => ({ name: 'H', value: '' })) },
    ]
    const r = importProfiles(file(items))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.profiles.map((p) => p.name)).toEqual(['ok'])
    expect(r.skipped).toBe(7)
  })

  it('applies defaults for omitted optional fields', () => {
    const r = importProfiles(file([{ name: 'A', url: 'u' }]))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.profiles[0]).toMatchObject({
      transport: 'auto',
      protocolVersion: null,
      headers: [],
      persistSecrets: false,
      auth: { mode: 'none', scope: null, clientId: null },
    })
  })
})
