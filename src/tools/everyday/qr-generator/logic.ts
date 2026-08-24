/**
 * QR Code Generator — pure logic (no React, no side-effects)
 *
 * Exports:
 *   QrContentType        — union of all supported content types
 *   buildPayload         — dispatcher: routes to the correct builder by type
 *   buildPlainTextPayload  — plain text / URL (identity)
 *   buildWifiPayload     — WIFI:T:...;S:...;P:...;H:..;; format
 *   buildVCardPayload    — minimal vCard 3.0
 *   buildEmailPayload    — mailto: URI
 *   buildSmsPayload      — smsto: URI
 *   buildPhonePayload    — tel: URI
 *   buildGeoPayload      — geo: URI
 *   validateGeo          — bounds-check lat/lng
 *   contrastRatio        — WCAG relative luminance ratio
 *   hexToRgb             — #rrggbb → { r, g, b }
 *   isLowContrast        — true when ratio < threshold
 */

// ── Content types ─────────────────────────────────────────────────────────────

export const QR_CONTENT_TYPES = [
  'text',
  'wifi',
  'vcard',
  'email',
  'sms',
  'phone',
  'geo',
] as const

export type QrContentType = (typeof QR_CONTENT_TYPES)[number]

// ── WiFi security types ───────────────────────────────────────────────────────

export const WIFI_SECURITY_TYPES = ['WPA', 'WEP', 'nopass'] as const
export type WifiSecurityType = (typeof WIFI_SECURITY_TYPES)[number]

// ── WiFi payload ──────────────────────────────────────────────────────────────

/**
 * Characters that must be escaped with a backslash in WiFi QR payloads.
 * Spec: \ ; , " :
 * Single quote (') is also escaped for maximum compatibility.
 * Reference: https://github.com/zxing/zxing/wiki/Barcode-Contents#wifi-network-config-android
 */
const WIFI_SPECIAL_CHARS_RE = /[\\;,"':]/g

/**
 * Escape special characters in a WiFi field value.
 * Each of \  ;  ,  "  :  ' must be preceded by a backslash.
 */
export function escapeWifiField(value: string): string {
  return value.replace(WIFI_SPECIAL_CHARS_RE, (ch) => `\\${ch}`)
}

export interface WifiParams {
  ssid: string
  password: string
  security: WifiSecurityType
  hidden: boolean
}

/**
 * Build a WiFi QR code payload.
 *
 * Format: WIFI:T:<security>;S:<ssid>;P:<password>;H:<hidden>;;
 *
 * Special characters in SSID and password (\  ;  ,  "  :) are escaped with a
 * leading backslash.
 */
export function buildWifiPayload(params: WifiParams): string {
  const { ssid, password, security, hidden } = params
  const escapedSsid = escapeWifiField(ssid)
  const escapedPassword = escapeWifiField(password)
  const hiddenStr = hidden ? 'true' : 'false'

  if (security === 'nopass') {
    return `WIFI:T:nopass;S:${escapedSsid};P:;H:${hiddenStr};;`
  }

  return `WIFI:T:${security};S:${escapedSsid};P:${escapedPassword};H:${hiddenStr};;`
}

export function validateWifi(params: WifiParams): string | null {
  if (!params.ssid.trim()) return 'SSID is required'
  if (params.security !== 'nopass' && !params.password.trim()) {
    return 'Password is required for WPA/WEP networks'
  }
  return null
}

// ── vCard payload ─────────────────────────────────────────────────────────────

export interface VCardParams {
  name: string
  phone: string
  email: string
  org: string
}

/**
 * Build a minimal vCard 3.0 payload.
 *
 * Property values containing commas, semicolons, backslashes, or newlines are
 * escaped per RFC 6350 §3.4.
 */
export function escapeVCardValue(value: string): string {
  // RFC 6350 §3.4: \ , ; \n must be escaped
  return value
    .replace(/\\/g, '\\\\')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;')
    .replace(/\n/g, '\\n')
}

export function buildVCardPayload(params: VCardParams): string {
  const { name, phone, email, org } = params
  const lines: string[] = ['BEGIN:VCARD', 'VERSION:3.0']

  if (name.trim()) {
    lines.push(`FN:${escapeVCardValue(name.trim())}`)
    // N field: last;first;additional;prefix;suffix (simplified — treat full name as FN only)
    lines.push(`N:${escapeVCardValue(name.trim())};;;;`)
  }

  if (org.trim()) {
    lines.push(`ORG:${escapeVCardValue(org.trim())}`)
  }

  if (phone.trim()) {
    lines.push(`TEL:${phone.trim()}`)
  }

  if (email.trim()) {
    lines.push(`EMAIL:${email.trim()}`)
  }

  lines.push('END:VCARD')
  return lines.join('\n')
}

export function validateVCard(params: VCardParams): string | null {
  const hasAny =
    params.name.trim() ||
    params.phone.trim() ||
    params.email.trim() ||
    params.org.trim()
  if (!hasAny) return 'At least one field (name, phone, email, or org) is required'
  return null
}

// ── Email payload ─────────────────────────────────────────────────────────────

export interface EmailParams {
  to: string
  subject: string
  body: string
}

/**
 * Build a mailto: URI.
 * Subject and body are percent-encoded via encodeURIComponent.
 * The `to` address is left as-is (it must be a valid e-mail address).
 */
export function buildEmailPayload(params: EmailParams): string {
  const { to, subject, body } = params
  const parts: string[] = []

  if (subject.trim()) {
    parts.push(`subject=${encodeURIComponent(subject)}`)
  }

  if (body.trim()) {
    parts.push(`body=${encodeURIComponent(body)}`)
  }

  const qs = parts.length > 0 ? `?${parts.join('&')}` : ''
  return `mailto:${to.trim()}${qs}`
}

export function validateEmail(params: EmailParams): string | null {
  if (!params.to.trim()) return 'Email address is required'
  // Very light check — just needs an @
  if (!params.to.includes('@')) return 'Enter a valid email address'
  return null
}

// ── SMS payload ───────────────────────────────────────────────────────────────

export interface SmsParams {
  phone: string
  message: string
}

/**
 * Build an smsto: URI.
 * Format: smsto:<phone>:<message>
 */
export function buildSmsPayload(params: SmsParams): string {
  const { phone, message } = params
  if (message.trim()) {
    return `smsto:${phone.trim()}:${message}`
  }
  return `smsto:${phone.trim()}`
}

export function validateSms(params: SmsParams): string | null {
  if (!params.phone.trim()) return 'Phone number is required'
  return null
}

// ── Phone payload ─────────────────────────────────────────────────────────────

export interface PhoneParams {
  phone: string
}

/**
 * Build a tel: URI.
 */
export function buildPhonePayload(params: PhoneParams): string {
  return `tel:${params.phone.trim()}`
}

export function validatePhone(params: PhoneParams): string | null {
  if (!params.phone.trim()) return 'Phone number is required'
  return null
}

// ── Geo payload ───────────────────────────────────────────────────────────────

export interface GeoParams {
  lat: string
  lng: string
  /** Optional label / query string (e.g. place name) */
  query: string
}

/**
 * Validate geo coordinate bounds.
 * Returns an error string or null if valid.
 */
export function validateGeo(params: GeoParams): string | null {
  const lat = parseFloat(params.lat)
  const lng = parseFloat(params.lng)

  if (params.lat.trim() === '' || params.lng.trim() === '') {
    return 'Latitude and longitude are required'
  }

  if (!isFinite(lat) || lat < -90 || lat > 90) {
    return 'Latitude must be between -90 and 90'
  }

  if (!isFinite(lng) || lng < -180 || lng > 180) {
    return 'Longitude must be between -180 and 180'
  }

  return null
}

/**
 * Build a geo: URI.
 * Format: geo:<lat>,<lng>
 * If a query is provided: geo:<lat>,<lng>?q=<encodedQuery>
 */
export function buildGeoPayload(params: GeoParams): string {
  const { lat, lng, query } = params
  const base = `geo:${lat.trim()},${lng.trim()}`
  if (query.trim()) {
    return `${base}?q=${encodeURIComponent(query.trim())}`
  }
  return base
}

// ── Plain text / URL payload ──────────────────────────────────────────────────

export interface PlainTextParams {
  text: string
}

export function buildPlainTextPayload(params: PlainTextParams): string {
  return params.text
}

export function validatePlainText(params: PlainTextParams): string | null {
  if (!params.text.trim()) return 'Text or URL is required'
  return null
}

// ── Payload dispatcher ────────────────────────────────────────────────────────

export type QrParams =
  | { type: 'text'; params: PlainTextParams }
  | { type: 'wifi'; params: WifiParams }
  | { type: 'vcard'; params: VCardParams }
  | { type: 'email'; params: EmailParams }
  | { type: 'sms'; params: SmsParams }
  | { type: 'phone'; params: PhoneParams }
  | { type: 'geo'; params: GeoParams }

/**
 * Build the QR payload string for any content type.
 * Returns the raw string that will be encoded into the QR code.
 */
export function buildPayload(input: QrParams): string {
  switch (input.type) {
    case 'text':
      return buildPlainTextPayload(input.params)
    case 'wifi':
      return buildWifiPayload(input.params)
    case 'vcard':
      return buildVCardPayload(input.params)
    case 'email':
      return buildEmailPayload(input.params)
    case 'sms':
      return buildSmsPayload(input.params)
    case 'phone':
      return buildPhonePayload(input.params)
    case 'geo':
      return buildGeoPayload(input.params)
  }
}

/**
 * Validate the params for a given content type.
 * Returns an error string or null if valid.
 */
export function validatePayload(input: QrParams): string | null {
  switch (input.type) {
    case 'text':
      return validatePlainText(input.params)
    case 'wifi':
      return validateWifi(input.params)
    case 'vcard':
      return validateVCard(input.params)
    case 'email':
      return validateEmail(input.params)
    case 'sms':
      return validateSms(input.params)
    case 'phone':
      return validatePhone(input.params)
    case 'geo':
      return validateGeo(input.params)
  }
}

// ── Color contrast helpers ────────────────────────────────────────────────────

export interface RgbColor {
  r: number
  g: number
  b: number
}

/**
 * Parse a 6-digit hex color string (#rrggbb or rrggbb) into { r, g, b }.
 * Returns null for invalid input.
 */
export function hexToRgb(hex: string): RgbColor | null {
  const cleaned = hex.replace(/^#/, '')
  if (!/^[0-9a-fA-F]{6}$/.test(cleaned)) return null
  return {
    r: parseInt(cleaned.slice(0, 2), 16),
    g: parseInt(cleaned.slice(2, 4), 16),
    b: parseInt(cleaned.slice(4, 6), 16),
  }
}

/**
 * Compute the relative luminance of an sRGB color as per WCAG 2.1.
 * Input values must be in the range [0, 255].
 */
export function relativeLuminance({ r, g, b }: RgbColor): number {
  const toLinear = (c: number): number => {
    const s = c / 255
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b)
}

/**
 * Compute the WCAG contrast ratio between two hex colors.
 * Returns a value in the range [1, 21].
 * Returns null if either color is invalid.
 */
export function contrastRatio(hex1: string, hex2: string): number | null {
  const c1 = hexToRgb(hex1)
  const c2 = hexToRgb(hex2)
  if (!c1 || !c2) return null
  const L1 = relativeLuminance(c1)
  const L2 = relativeLuminance(c2)
  const lighter = Math.max(L1, L2)
  const darker = Math.min(L1, L2)
  return (lighter + 0.05) / (darker + 0.05)
}

/**
 * Returns true when the contrast ratio between two colors is below the given
 * threshold (default 3.0 — below this QR codes become hard to scan).
 */
export function isLowContrast(
  fgHex: string,
  bgHex: string,
  threshold = 3.0,
): boolean {
  const ratio = contrastRatio(fgHex, bgHex)
  if (ratio === null) return false
  return ratio < threshold
}
