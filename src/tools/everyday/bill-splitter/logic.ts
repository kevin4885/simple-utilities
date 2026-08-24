/**
 * Tip & Bill Splitter — pure logic (no React, no side-effects)
 *
 * All money arithmetic is done in integer cents (or in the smallest minor unit
 * for the currency). Floating-point string ↔ cents conversions are the ONLY
 * place that touch parseFloat/Math.round, and they are isolated in
 * `parseCents` / `formatCents`.
 *
 * Exports:
 *   CURRENCIES           — supported currency definitions
 *   parseCents           — decimal string → integer minor units
 *   formatMoney          — integer minor units → Intl formatted string
 *   computeTip           — tip amount from base + percentage
 *   splitFair            — largest-remainder fair split into per-person amounts
 *   roundUpAmount        — round an amount up to nearest N cents
 *   computeSplit         — main entry point returning a full SplitResult
 */

// ── Currency ──────────────────────────────────────────────────────────────────

export interface CurrencyDef {
  /** ISO 4217 code */
  code: string
  /** Number of digits in the minor unit (e.g. 2 for USD, 0 for JPY) */
  minorDigits: number
  /** Intl locale hint for formatting */
  locale: string
}

export const CURRENCIES: readonly CurrencyDef[] = [
  { code: 'USD', minorDigits: 2, locale: 'en-US' },
  { code: 'EUR', minorDigits: 2, locale: 'de-DE' },
  { code: 'GBP', minorDigits: 2, locale: 'en-GB' },
  { code: 'CAD', minorDigits: 2, locale: 'en-CA' },
  { code: 'AUD', minorDigits: 2, locale: 'en-AU' },
  { code: 'JPY', minorDigits: 0, locale: 'ja-JP' },
]

export type CurrencyCode = 'USD' | 'EUR' | 'GBP' | 'CAD' | 'AUD' | 'JPY'

/** Lookup helper — always returns a valid CurrencyDef (falls back to USD). */
export function getCurrency(code: CurrencyCode): CurrencyDef {
  return CURRENCIES.find((c) => c.code === code) ?? CURRENCIES[0]
}

// ── Minor-unit helpers ────────────────────────────────────────────────────────

/**
 * Parse a decimal string like "42.50" into integer minor units (e.g. 4250 cents
 * for a 2-decimal currency, or 42 for a 0-decimal currency like JPY).
 *
 * Comma stripping removes thousands separators only — the decimal separator must
 * be a period (`.`), matching `<input type="number">` output.
 *
 * Returns 0 for empty / invalid / negative input.
 */
export function parseCents(value: string, minorDigits: number): number {
  const trimmed = value.trim().replace(/,/g, '')
  if (!trimmed) return 0
  const n = parseFloat(trimmed)
  if (!isFinite(n) || n < 0) return 0
  const factor = Math.pow(10, minorDigits)
  return Math.round(n * factor)
}

/**
 * Format integer minor units as a currency string using Intl.NumberFormat.
 * Example: formatMoney(4250, getCurrency('USD')) → "$42.50"
 */
export function formatMoney(amount: number, currency: CurrencyDef): string {
  const factor = Math.pow(10, currency.minorDigits)
  const value = amount / factor
  return new Intl.NumberFormat(currency.locale, {
    style: 'currency',
    currency: currency.code,
    minimumFractionDigits: currency.minorDigits,
    maximumFractionDigits: currency.minorDigits,
  }).format(value)
}

// ── Tip computation ───────────────────────────────────────────────────────────

/**
 * Compute tip amount in minor units.
 *
 * @param baseCents   The amount on which tip is calculated (pre-tax or full bill)
 * @param tipPct      Tip percentage as a plain number (e.g. 18 for 18%)
 */
export function computeTip(baseCents: number, tipPct: number): number {
  if (tipPct <= 0 || baseCents <= 0) return 0
  return Math.round(baseCents * tipPct / 100)
}

// ── Fair split (largest-remainder) ───────────────────────────────────────────

export interface SplitShare {
  /** Amount in minor units this person pays */
  amount: number
  /** Number of people paying this amount */
  count: number
}

/**
 * Split `totalCents` among `people` using the largest-remainder method.
 *
 * Guarantees:
 *   – sum(share.amount * share.count) === totalCents
 *   – max(amount) - min(amount) <= 1   (amounts differ by at most 1 minor unit)
 *
 * @returns An array of SplitShare objects (usually 1–2 entries).
 */
export function splitFair(totalCents: number, people: number): SplitShare[] {
  if (people <= 0) return []
  if (totalCents <= 0) return [{ amount: 0, count: people }]

  const base = Math.floor(totalCents / people)
  const remainder = totalCents - base * people // number of people who pay base+1

  const shares: SplitShare[] = []

  if (remainder > 0) {
    shares.push({ amount: base + 1, count: remainder })
  }

  const lowerCount = people - remainder
  if (lowerCount > 0) {
    shares.push({ amount: base, count: lowerCount })
  }

  return shares
}

// ── Round-up ──────────────────────────────────────────────────────────────────

export type RoundUpMode = 'none' | 'dollar' | 'half'

/**
 * Round `amount` (in minor units) up to the nearest multiple of `stepCents`.
 *
 * @param amount     Amount in minor units
 * @param stepCents  Rounding step in minor units (e.g. 100 for nearest dollar, 50 for nearest 50¢)
 */
export function roundUpAmount(amount: number, stepCents: number): number {
  if (stepCents <= 0) return amount
  return Math.ceil(amount / stepCents) * stepCents
}

// ── Main computation ──────────────────────────────────────────────────────────

export interface SplitInput {
  /** Full bill amount as decimal string (e.g. "85.00") */
  billStr: string
  /** Optional tax amount as decimal string. When provided and tipOnPreTax=true, tip is on (bill-tax). */
  taxStr: string
  /** Tip percentage (0–100+) */
  tipPct: number
  /** If true and taxStr is provided, compute tip on (bill − tax). Otherwise tip on full bill. */
  tipOnPreTax: boolean
  /** Number of people splitting the bill (1–100) */
  people: number
  /** Rounding mode for per-person amounts */
  roundUpMode: RoundUpMode
  /** Currency */
  currency: CurrencyDef
}

export interface SplitResult {
  /** Bill in minor units */
  billCents: number
  /** Tax in minor units (0 if not provided) */
  taxCents: number
  /** Amount on which tip was computed */
  tipBaseCents: number
  /** Computed tip in minor units */
  tipCents: number
  /** Total = bill + tip (before per-person rounding) */
  totalCents: number
  /** Fair split shares before any rounding */
  shares: SplitShare[]
  /** True when rounding is active */
  roundingActive: boolean
  /** Per-person rounded amount (minor units). 0 when rounding off. */
  roundedPerPerson: number
  /** Rounded total = roundedPerPerson * people */
  roundedTotal: number
  /** Extra paid due to rounding */
  roundingOverpay: number
  /** Effective tip % on the full bill after rounding (null when rounding off) */
  effectiveTipPct: number | null
}

/**
 * Main computation entry point — returns a complete SplitResult from raw inputs.
 */
export function computeSplit(input: SplitInput): SplitResult {
  const { billStr, taxStr, tipPct, tipOnPreTax, people, roundUpMode, currency } = input

  const billCents = parseCents(billStr, currency.minorDigits)
  const taxCents = parseCents(taxStr, currency.minorDigits)

  // The base on which tip is computed
  const hasTax = taxCents > 0 && taxStr.trim() !== ''
  const tipBaseCents = hasTax && tipOnPreTax
    ? Math.max(0, billCents - taxCents)
    : billCents

  const tipCents = computeTip(tipBaseCents, tipPct)
  const totalCents = billCents + tipCents

  const shares = splitFair(totalCents, Math.max(1, people))

  // Rounding
  const roundingActive = roundUpMode !== 'none' && currency.minorDigits >= 2
  let roundedPerPerson = 0
  let roundedTotal = 0
  let roundingOverpay = 0
  let effectiveTipPct: number | null = null

  if (roundingActive) {
    // Use highest share amount as base for rounding (so everyone rounds up consistently)
    const highShare = shares[0]?.amount ?? 0
    const stepCents = roundUpMode === 'dollar'
      ? Math.pow(10, currency.minorDigits) // 100 for 2-digit currencies
      : Math.pow(10, currency.minorDigits) / 2 // 50 for 2-digit currencies

    roundedPerPerson = roundUpAmount(highShare, stepCents)
    roundedTotal = roundedPerPerson * Math.max(1, people)
    roundingOverpay = roundedTotal - totalCents

    if (billCents > 0) {
      const tipAfterRound = roundedTotal - billCents
      effectiveTipPct = Math.round((tipAfterRound / billCents) * 10000) / 100
    }
  }

  return {
    billCents,
    taxCents,
    tipBaseCents,
    tipCents,
    totalCents,
    shares,
    roundingActive,
    roundedPerPerson,
    roundedTotal,
    roundingOverpay,
    effectiveTipPct,
  }
}
