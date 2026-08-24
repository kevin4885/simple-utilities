/**
 * QR Code Generator — logic tests
 *
 * Covers:
 *   – buildWifiPayload: normal WPA/WEP/nopass, escaping edge cases
 *     (semicolons, commas, quotes, backslashes, colons in SSID and password)
 *   – buildVCardPayload: field presence, escaping (comma, semicolon, backslash, newline)
 *   – buildEmailPayload: plain, with subject, with body, both, encoded chars
 *   – buildSmsPayload: with and without message
 *   – buildPhonePayload: basic
 *   – buildGeoPayload: plain, with query
 *   – validateGeo: lat/lng bounds, empty input
 *   – validateWifi: empty SSID, missing password for WPA/WEP, nopass no password
 *   – hexToRgb: valid, invalid inputs
 *   – contrastRatio / isLowContrast: black/white (max ratio), same color (ratio 1),
 *     known mid-tone, low-contrast guard
 *   – buildPayload dispatcher: each type
 *   – validatePayload dispatcher: each type
 */

import { describe, it, expect } from 'vitest'
import {
  escapeWifiField,
  buildWifiPayload,
  validateWifi,
  buildVCardPayload,
  validateVCard,
  escapeVCardValue,
  buildEmailPayload,
  validateEmail,
  buildSmsPayload,
  validateSms,
  buildPhonePayload,
  validatePhone,
  buildGeoPayload,
  validateGeo,
  buildPlainTextPayload,
  validatePlainText,
  buildPayload,
  validatePayload,
  hexToRgb,
  relativeLuminance,
  contrastRatio,
  isLowContrast,
  type WifiParams,
  type VCardParams,
  type GeoParams,
} from './logic'

// ── escapeWifiField ───────────────────────────────────────────────────────────

describe('escapeWifiField', () => {
  it('leaves plain alphanumeric unchanged', () => {
    expect(escapeWifiField('MyNetwork123')).toBe('MyNetwork123')
  })

  it('escapes backslash', () => {
    expect(escapeWifiField('path\\value')).toBe('path\\\\value')
  })

  it('escapes semicolon', () => {
    expect(escapeWifiField('a;b')).toBe('a\\;b')
  })

  it('escapes comma', () => {
    expect(escapeWifiField('a,b')).toBe('a\\,b')
  })

  it('escapes double quote', () => {
    expect(escapeWifiField('say "hi"')).toBe('say \\"hi\\"')
  })

  it('escapes colon', () => {
    expect(escapeWifiField('http://x')).toBe('http\\://x')
  })

  it('escapes single quote', () => {
    expect(escapeWifiField("it's")).toBe("it\\'s")
  })

  it('escapes multiple special chars in one string', () => {
    // SSID like: foo;bar,baz\qux
    expect(escapeWifiField('foo;bar,baz\\qux')).toBe('foo\\;bar\\,baz\\\\qux')
  })

  it('handles empty string', () => {
    expect(escapeWifiField('')).toBe('')
  })

  it('escapes all special chars in a password like p@ss;w"ord\\key:', () => {
    expect(escapeWifiField('p@ss;w"ord\\key:')).toBe('p@ss\\;w\\"ord\\\\key\\:')
  })
})

// ── buildWifiPayload ──────────────────────────────────────────────────────────

describe('buildWifiPayload', () => {
  const wpa: WifiParams = {
    ssid: 'HomeNet',
    password: 'secret123',
    security: 'WPA',
    hidden: false,
  }

  it('builds a basic WPA payload', () => {
    expect(buildWifiPayload(wpa)).toBe(
      'WIFI:T:WPA;S:HomeNet;P:secret123;H:false;;',
    )
  })

  it('builds a WEP payload', () => {
    const wep: WifiParams = { ...wpa, security: 'WEP' }
    expect(buildWifiPayload(wep)).toBe(
      'WIFI:T:WEP;S:HomeNet;P:secret123;H:false;;',
    )
  })

  it('builds a nopass payload (password ignored)', () => {
    const open: WifiParams = { ...wpa, security: 'nopass', password: 'ignored' }
    expect(buildWifiPayload(open)).toBe('WIFI:T:nopass;S:HomeNet;P:;H:false;;')
  })

  it('sets H:true when hidden=true', () => {
    const hidden: WifiParams = { ...wpa, hidden: true }
    expect(buildWifiPayload(hidden)).toBe(
      'WIFI:T:WPA;S:HomeNet;P:secret123;H:true;;',
    )
  })

  it('escapes semicolon in SSID', () => {
    const p: WifiParams = { ...wpa, ssid: 'Net;Work' }
    expect(buildWifiPayload(p)).toBe(
      'WIFI:T:WPA;S:Net\\;Work;P:secret123;H:false;;',
    )
  })

  it('escapes comma in SSID', () => {
    const p: WifiParams = { ...wpa, ssid: 'Net,Work' }
    expect(buildWifiPayload(p)).toBe(
      'WIFI:T:WPA;S:Net\\,Work;P:secret123;H:false;;',
    )
  })

  it('escapes backslash in password', () => {
    const p: WifiParams = { ...wpa, password: 'pass\\word' }
    expect(buildWifiPayload(p)).toBe(
      'WIFI:T:WPA;S:HomeNet;P:pass\\\\word;H:false;;',
    )
  })

  it('escapes double-quote in password', () => {
    const p: WifiParams = { ...wpa, password: 'my"pass' }
    expect(buildWifiPayload(p)).toBe(
      'WIFI:T:WPA;S:HomeNet;P:my\\"pass;H:false;;',
    )
  })

  it('escapes colon in SSID and password', () => {
    const p: WifiParams = { ...wpa, ssid: 'a:b', password: 'x:y' }
    expect(buildWifiPayload(p)).toBe(
      'WIFI:T:WPA;S:a\\:b;P:x\\:y;H:false;;',
    )
  })

  it('escapes all special chars together', () => {
    const p: WifiParams = {
      ssid: 'My;Net,work"2024',
      password: 'p\\w;d,"1:',
      security: 'WPA',
      hidden: true,
    }
    expect(buildWifiPayload(p)).toBe(
      'WIFI:T:WPA;S:My\\;Net\\,work\\"2024;P:p\\\\w\\;d\\,\\"1\\:;H:true;;',
    )
  })
})

// ── validateWifi ──────────────────────────────────────────────────────────────

describe('validateWifi', () => {
  it('returns null for valid WPA', () => {
    expect(
      validateWifi({ ssid: 'Net', password: 'pass', security: 'WPA', hidden: false }),
    ).toBeNull()
  })

  it('returns error for empty SSID', () => {
    expect(
      validateWifi({ ssid: '', password: 'pass', security: 'WPA', hidden: false }),
    ).toMatch(/ssid/i)
  })

  it('returns error for blank SSID (spaces only)', () => {
    expect(
      validateWifi({ ssid: '   ', password: 'pass', security: 'WPA', hidden: false }),
    ).toMatch(/ssid/i)
  })

  it('returns error for WPA with empty password', () => {
    expect(
      validateWifi({ ssid: 'Net', password: '', security: 'WPA', hidden: false }),
    ).toMatch(/password/i)
  })

  it('returns error for WEP with empty password', () => {
    expect(
      validateWifi({ ssid: 'Net', password: '', security: 'WEP', hidden: false }),
    ).toMatch(/password/i)
  })

  it('returns null for nopass with empty password', () => {
    expect(
      validateWifi({ ssid: 'Net', password: '', security: 'nopass', hidden: false }),
    ).toBeNull()
  })
})

// ── escapeVCardValue ──────────────────────────────────────────────────────────

describe('escapeVCardValue', () => {
  it('leaves plain text unchanged', () => {
    expect(escapeVCardValue('John Doe')).toBe('John Doe')
  })

  it('escapes backslash', () => {
    expect(escapeVCardValue('C:\\path')).toBe('C:\\\\path')
  })

  it('escapes comma', () => {
    expect(escapeVCardValue('Smith, John')).toBe('Smith\\, John')
  })

  it('escapes semicolon', () => {
    expect(escapeVCardValue('a;b')).toBe('a\\;b')
  })

  it('escapes newline', () => {
    expect(escapeVCardValue('line1\nline2')).toBe('line1\\nline2')
  })

  it('escapes multiple chars', () => {
    expect(escapeVCardValue('a;b,c\\d\ne')).toBe('a\\;b\\,c\\\\d\\ne')
  })
})

// ── buildVCardPayload ─────────────────────────────────────────────────────────

describe('buildVCardPayload', () => {
  const full: VCardParams = {
    name: 'Alice Smith',
    phone: '+1-555-0100',
    email: 'alice@example.com',
    org: 'ACME Corp',
  }

  it('builds a full vCard', () => {
    const card = buildVCardPayload(full)
    expect(card).toContain('BEGIN:VCARD')
    expect(card).toContain('VERSION:3.0')
    expect(card).toContain('FN:Alice Smith')
    expect(card).toContain('N:Alice Smith;;;;')
    expect(card).toContain('ORG:ACME Corp')
    expect(card).toContain('TEL:+1-555-0100')
    expect(card).toContain('EMAIL:alice@example.com')
    expect(card).toContain('END:VCARD')
  })

  it('omits empty fields', () => {
    const minimal: VCardParams = { name: 'Bob', phone: '', email: '', org: '' }
    const card = buildVCardPayload(minimal)
    expect(card).toContain('FN:Bob')
    expect(card).not.toContain('ORG:')
    expect(card).not.toContain('TEL:')
    expect(card).not.toContain('EMAIL:')
  })

  it('escapes comma in name', () => {
    const p: VCardParams = { ...full, name: 'Smith, John' }
    const card = buildVCardPayload(p)
    expect(card).toContain('FN:Smith\\, John')
  })

  it('escapes semicolon in org', () => {
    const p: VCardParams = { ...full, org: 'Corp;Inc' }
    const card = buildVCardPayload(p)
    expect(card).toContain('ORG:Corp\\;Inc')
  })

  it('escapes backslash in name', () => {
    const p: VCardParams = { ...full, name: 'Doe\\John' }
    const card = buildVCardPayload(p)
    expect(card).toContain('FN:Doe\\\\John')
  })

  it('starts with BEGIN:VCARD and ends with END:VCARD', () => {
    const card = buildVCardPayload(full)
    const lines = card.split('\n')
    expect(lines[0]).toBe('BEGIN:VCARD')
    expect(lines[lines.length - 1]).toBe('END:VCARD')
  })
})

// ── validateVCard ─────────────────────────────────────────────────────────────

describe('validateVCard', () => {
  it('returns null when name is provided', () => {
    expect(validateVCard({ name: 'Alice', phone: '', email: '', org: '' })).toBeNull()
  })

  it('returns null when only phone is provided', () => {
    expect(validateVCard({ name: '', phone: '555', email: '', org: '' })).toBeNull()
  })

  it('returns error when all fields are empty', () => {
    expect(validateVCard({ name: '', phone: '', email: '', org: '' })).not.toBeNull()
  })
})

// ── buildEmailPayload ─────────────────────────────────────────────────────────

describe('buildEmailPayload', () => {
  it('builds a plain mailto with no subject or body', () => {
    expect(
      buildEmailPayload({ to: 'a@b.com', subject: '', body: '' }),
    ).toBe('mailto:a@b.com')
  })

  it('includes subject when provided', () => {
    expect(
      buildEmailPayload({ to: 'a@b.com', subject: 'Hello World', body: '' }),
    ).toBe('mailto:a@b.com?subject=Hello%20World')
  })

  it('includes body when provided', () => {
    expect(
      buildEmailPayload({ to: 'a@b.com', subject: '', body: 'Hi there' }),
    ).toBe('mailto:a@b.com?body=Hi%20there')
  })

  it('includes both subject and body', () => {
    const result = buildEmailPayload({
      to: 'a@b.com',
      subject: 'Meeting',
      body: 'Please join',
    })
    expect(result).toContain('subject=Meeting')
    expect(result).toContain('body=Please%20join')
    expect(result).toMatch(/^mailto:a@b\.com\?/)
  })

  it('percent-encodes special chars in subject', () => {
    const result = buildEmailPayload({
      to: 'x@y.com',
      subject: 'Hello & Goodbye',
      body: '',
    })
    expect(result).toContain('subject=Hello%20%26%20Goodbye')
  })

  it('percent-encodes newlines in body', () => {
    const result = buildEmailPayload({
      to: 'x@y.com',
      subject: '',
      body: 'line1\nline2',
    })
    expect(result).toContain('body=line1%0Aline2')
  })
})

// ── validateEmail ─────────────────────────────────────────────────────────────

describe('validateEmail', () => {
  it('returns null for valid email', () => {
    expect(validateEmail({ to: 'a@b.com', subject: '', body: '' })).toBeNull()
  })

  it('returns error for empty to', () => {
    expect(validateEmail({ to: '', subject: '', body: '' })).not.toBeNull()
  })

  it('returns error for missing @', () => {
    expect(validateEmail({ to: 'notanemail', subject: '', body: '' })).not.toBeNull()
  })
})

// ── buildSmsPayload ───────────────────────────────────────────────────────────

describe('buildSmsPayload', () => {
  it('builds smsto with number only', () => {
    expect(buildSmsPayload({ phone: '+15550100', message: '' })).toBe(
      'smsto:+15550100',
    )
  })

  it('builds smsto with message', () => {
    expect(buildSmsPayload({ phone: '5550100', message: 'Hello!' })).toBe(
      'smsto:5550100:Hello!',
    )
  })
})

// ── validateSms ───────────────────────────────────────────────────────────────

describe('validateSms', () => {
  it('returns null when phone is provided', () => {
    expect(validateSms({ phone: '555', message: '' })).toBeNull()
  })

  it('returns error for empty phone', () => {
    expect(validateSms({ phone: '', message: 'hi' })).not.toBeNull()
  })
})

// ── buildPhonePayload ─────────────────────────────────────────────────────────

describe('buildPhonePayload', () => {
  it('builds a tel: URI', () => {
    expect(buildPhonePayload({ phone: '+15550100' })).toBe('tel:+15550100')
  })

  it('trims whitespace', () => {
    expect(buildPhonePayload({ phone: '  5550100  ' })).toBe('tel:5550100')
  })
})

// ── validatePhone ─────────────────────────────────────────────────────────────

describe('validatePhone', () => {
  it('returns null when phone is provided', () => {
    expect(validatePhone({ phone: '555' })).toBeNull()
  })

  it('returns error for empty phone', () => {
    expect(validatePhone({ phone: '' })).not.toBeNull()
  })
})

// ── buildGeoPayload ───────────────────────────────────────────────────────────

describe('buildGeoPayload', () => {
  const base: GeoParams = { lat: '40.7128', lng: '-74.0060', query: '' }

  it('builds a basic geo: URI', () => {
    expect(buildGeoPayload(base)).toBe('geo:40.7128,-74.0060')
  })

  it('appends encoded query when provided', () => {
    const p: GeoParams = { ...base, query: 'Empire State Building' }
    expect(buildGeoPayload(p)).toBe(
      'geo:40.7128,-74.0060?q=Empire%20State%20Building',
    )
  })

  it('encodes special chars in query', () => {
    const p: GeoParams = { ...base, query: 'Café & Bar' }
    expect(buildGeoPayload(p)).toContain('q=Caf%C3%A9%20%26%20Bar')
  })
})

// ── validateGeo ───────────────────────────────────────────────────────────────

describe('validateGeo', () => {
  it('returns null for valid coordinates', () => {
    expect(validateGeo({ lat: '40.7128', lng: '-74.0060', query: '' })).toBeNull()
  })

  it('returns null for extreme valid bounds', () => {
    expect(validateGeo({ lat: '90', lng: '180', query: '' })).toBeNull()
    expect(validateGeo({ lat: '-90', lng: '-180', query: '' })).toBeNull()
  })

  it('returns error for lat > 90', () => {
    expect(validateGeo({ lat: '91', lng: '0', query: '' })).toMatch(/latitude/i)
  })

  it('returns error for lat < -90', () => {
    expect(validateGeo({ lat: '-91', lng: '0', query: '' })).toMatch(/latitude/i)
  })

  it('returns error for lng > 180', () => {
    expect(validateGeo({ lat: '0', lng: '181', query: '' })).toMatch(/longitude/i)
  })

  it('returns error for lng < -180', () => {
    expect(validateGeo({ lat: '0', lng: '-181', query: '' })).toMatch(/longitude/i)
  })

  it('returns error for empty lat', () => {
    expect(validateGeo({ lat: '', lng: '0', query: '' })).not.toBeNull()
  })

  it('returns error for empty lng', () => {
    expect(validateGeo({ lat: '0', lng: '', query: '' })).not.toBeNull()
  })

  it('returns error for non-numeric lat', () => {
    expect(validateGeo({ lat: 'abc', lng: '0', query: '' })).toMatch(/latitude/i)
  })

  it('returns error for non-numeric lng', () => {
    expect(validateGeo({ lat: '0', lng: 'abc', query: '' })).toMatch(/longitude/i)
  })
})

// ── buildPlainTextPayload ─────────────────────────────────────────────────────

describe('buildPlainTextPayload', () => {
  it('returns the text unchanged', () => {
    expect(buildPlainTextPayload({ text: 'hello' })).toBe('hello')
  })

  it('returns a URL unchanged', () => {
    expect(buildPlainTextPayload({ text: 'https://example.com' })).toBe(
      'https://example.com',
    )
  })
})

// ── validatePlainText ─────────────────────────────────────────────────────────

describe('validatePlainText', () => {
  it('returns null for non-empty text', () => {
    expect(validatePlainText({ text: 'hello' })).toBeNull()
  })

  it('returns error for empty text', () => {
    expect(validatePlainText({ text: '' })).not.toBeNull()
  })

  it('returns error for whitespace-only text', () => {
    expect(validatePlainText({ text: '   ' })).not.toBeNull()
  })
})

// ── buildPayload dispatcher ───────────────────────────────────────────────────

describe('buildPayload', () => {
  it('routes text type', () => {
    expect(buildPayload({ type: 'text', params: { text: 'Hi' } })).toBe('Hi')
  })

  it('routes wifi type', () => {
    const result = buildPayload({
      type: 'wifi',
      params: { ssid: 'Net', password: 'pw', security: 'WPA', hidden: false },
    })
    expect(result).toMatch(/^WIFI:/)
  })

  it('routes vcard type', () => {
    const result = buildPayload({
      type: 'vcard',
      params: { name: 'Alice', phone: '', email: '', org: '' },
    })
    expect(result).toContain('BEGIN:VCARD')
  })

  it('routes email type', () => {
    const result = buildPayload({
      type: 'email',
      params: { to: 'a@b.com', subject: '', body: '' },
    })
    expect(result).toBe('mailto:a@b.com')
  })

  it('routes sms type', () => {
    const result = buildPayload({
      type: 'sms',
      params: { phone: '555', message: '' },
    })
    expect(result).toBe('smsto:555')
  })

  it('routes phone type', () => {
    const result = buildPayload({ type: 'phone', params: { phone: '555' } })
    expect(result).toBe('tel:555')
  })

  it('routes geo type', () => {
    const result = buildPayload({
      type: 'geo',
      params: { lat: '10', lng: '20', query: '' },
    })
    expect(result).toBe('geo:10,20')
  })
})

// ── validatePayload dispatcher ────────────────────────────────────────────────

describe('validatePayload', () => {
  it('returns error for empty text', () => {
    expect(validatePayload({ type: 'text', params: { text: '' } })).not.toBeNull()
  })

  it('returns null for valid text', () => {
    expect(validatePayload({ type: 'text', params: { text: 'x' } })).toBeNull()
  })

  it('returns error for wifi with empty ssid', () => {
    expect(
      validatePayload({
        type: 'wifi',
        params: { ssid: '', password: '', security: 'nopass', hidden: false },
      }),
    ).not.toBeNull()
  })

  it('returns error for geo out of bounds', () => {
    expect(
      validatePayload({
        type: 'geo',
        params: { lat: '200', lng: '0', query: '' },
      }),
    ).not.toBeNull()
  })
})

// ── hexToRgb ──────────────────────────────────────────────────────────────────

describe('hexToRgb', () => {
  it('parses #000000 as black', () => {
    expect(hexToRgb('#000000')).toEqual({ r: 0, g: 0, b: 0 })
  })

  it('parses #ffffff as white', () => {
    expect(hexToRgb('#ffffff')).toEqual({ r: 255, g: 255, b: 255 })
  })

  it('parses without leading #', () => {
    expect(hexToRgb('ff0000')).toEqual({ r: 255, g: 0, b: 0 })
  })

  it('parses mixed case', () => {
    expect(hexToRgb('#00FF80')).toEqual({ r: 0, g: 255, b: 128 })
  })

  it('returns null for invalid hex (3-char)', () => {
    expect(hexToRgb('#fff')).toBeNull()
  })

  it('returns null for non-hex chars', () => {
    expect(hexToRgb('#zzzzzz')).toBeNull()
  })

  it('returns null for empty string', () => {
    expect(hexToRgb('')).toBeNull()
  })
})

// ── relativeLuminance ─────────────────────────────────────────────────────────

describe('relativeLuminance', () => {
  it('black has luminance 0', () => {
    expect(relativeLuminance({ r: 0, g: 0, b: 0 })).toBeCloseTo(0, 5)
  })

  it('white has luminance 1', () => {
    expect(relativeLuminance({ r: 255, g: 255, b: 255 })).toBeCloseTo(1, 5)
  })
})

// ── contrastRatio ─────────────────────────────────────────────────────────────

describe('contrastRatio', () => {
  it('black on white has maximum ratio ~21', () => {
    const ratio = contrastRatio('#000000', '#ffffff')
    expect(ratio).not.toBeNull()
    expect(ratio!).toBeCloseTo(21, 0)
  })

  it('same color has ratio 1', () => {
    const ratio = contrastRatio('#ff0000', '#ff0000')
    expect(ratio).not.toBeNull()
    expect(ratio!).toBeCloseTo(1, 5)
  })

  it('returns null for invalid hex', () => {
    expect(contrastRatio('#gggggg', '#000000')).toBeNull()
  })

  it('is commutative (fg/bg order does not matter)', () => {
    const r1 = contrastRatio('#123456', '#abcdef')
    const r2 = contrastRatio('#abcdef', '#123456')
    expect(r1).toBeCloseTo(r2!, 10)
  })
})

// ── isLowContrast ─────────────────────────────────────────────────────────────

describe('isLowContrast', () => {
  it('black on white is NOT low contrast (ratio ~21)', () => {
    expect(isLowContrast('#000000', '#ffffff')).toBe(false)
  })

  it('same color IS low contrast (ratio 1)', () => {
    expect(isLowContrast('#ff0000', '#ff0000')).toBe(true)
  })

  it('uses the provided threshold', () => {
    // ratio ~21 — only exceeds threshold=21 if threshold is very high
    expect(isLowContrast('#000000', '#ffffff', 22)).toBe(true)
    expect(isLowContrast('#000000', '#ffffff', 20)).toBe(false)
  })

  it('returns false for invalid hex (cannot determine)', () => {
    expect(isLowContrast('#invalid', '#ffffff')).toBe(false)
  })
})
