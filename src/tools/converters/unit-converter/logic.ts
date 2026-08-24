/**
 * Unit Converter — pure logic (no React, no side-effects)
 *
 * Supports:
 *   Length      — mm, cm, m, km, in, ft, yd, mi
 *   Weight/Mass — mg, g, kg, tonne, oz, lb, stone
 *   Temperature — °C, °F, K  (affine — toBase/fromBase functions)
 *   Volume      — ml, l, tsp, tbsp, fl oz US, cup US, pint US, quart US, gallon US
 *   Area        — mm², cm², m², km², in², ft², acre, hectare
 *   Speed       — m/s, km/h, mph, knots, ft/s
 *   Data        — bit, byte, KB, MB, GB, TB (decimal), KiB, MiB, GiB, TiB (binary)
 *
 * Exports:
 *   UNIT_CATEGORIES       — ordered list of category ids
 *   CATEGORIES            — map of category id → CategoryDef
 *   convert               — convert(category, fromUnit, toUnit, value) → number
 *   formatResult          — trim floating-point noise, return a clean string
 *   isAbsoluteZeroWarning — warn when a temperature is below absolute zero
 */

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * A unit defined by a simple multiplicative factor relative to the category's
 * base unit.  `toBase(v) = v * factor`, `fromBase(v) = v / factor`.
 */
export interface FactorUnit {
  id: string
  label: string
  /** How many base units is 1 of this unit? */
  factor: number
}

/**
 * A unit defined by arbitrary affine functions (e.g. temperature).
 * `toBase` converts a value in this unit to the base unit.
 * `fromBase` converts a value in the base unit back to this unit.
 */
export interface AffineUnit {
  id: string
  label: string
  toBase: (v: number) => number
  fromBase: (v: number) => number
}

export type UnitDef = FactorUnit | AffineUnit

export interface CategoryDef {
  id: string
  label: string
  units: UnitDef[]
}

// ── Type guards ───────────────────────────────────────────────────────────────

function isAffine(u: UnitDef): u is AffineUnit {
  return typeof (u as AffineUnit).toBase === 'function'
}

// ── Category definitions ──────────────────────────────────────────────────────

const LENGTH: CategoryDef = {
  id: 'length',
  label: 'Length',
  units: [
    // Base unit: metre (m)
    { id: 'mm', label: 'mm',     factor: 0.001 },
    { id: 'cm', label: 'cm',     factor: 0.01 },
    { id: 'm',  label: 'm',      factor: 1 },
    { id: 'km', label: 'km',     factor: 1000 },
    { id: 'in', label: 'in',     factor: 0.0254 },
    { id: 'ft', label: 'ft',     factor: 0.3048 },
    { id: 'yd', label: 'yd',     factor: 0.9144 },
    { id: 'mi', label: 'mi',     factor: 1609.344 },
  ],
}

const WEIGHT: CategoryDef = {
  id: 'weight',
  label: 'Weight / Mass',
  units: [
    // Base unit: gram (g)
    { id: 'mg',     label: 'mg',     factor: 0.001 },
    { id: 'g',      label: 'g',      factor: 1 },
    { id: 'kg',     label: 'kg',     factor: 1000 },
    { id: 'tonne',  label: 'tonne',  factor: 1_000_000 },
    { id: 'oz',     label: 'oz',     factor: 28.349523125 },
    { id: 'lb',     label: 'lb',     factor: 453.59237 },
    { id: 'stone',  label: 'stone',  factor: 6350.29318 },
  ],
}

const TEMPERATURE: CategoryDef = {
  id: 'temperature',
  label: 'Temperature',
  units: [
    // Base unit: Kelvin (K)
    {
      id: 'c',
      label: '°C',
      toBase:   (v) => v + 273.15,
      fromBase: (v) => v - 273.15,
    },
    {
      id: 'f',
      label: '°F',
      toBase:   (v) => (v - 32) * (5 / 9) + 273.15,
      fromBase: (v) => (v - 273.15) * (9 / 5) + 32,
    },
    {
      id: 'k',
      label: 'K',
      toBase:   (v) => v,
      fromBase: (v) => v,
    },
  ],
}

const VOLUME: CategoryDef = {
  id: 'volume',
  label: 'Volume',
  units: [
    // Base unit: litre (l)
    { id: 'ml',     label: 'ml',         factor: 0.001 },
    { id: 'l',      label: 'l',          factor: 1 },
    { id: 'tsp',    label: 'tsp (US)',    factor: 0.00492892159375 },
    { id: 'tbsp',   label: 'tbsp (US)',   factor: 0.01478676478125 },
    { id: 'floz',   label: 'fl oz (US)',  factor: 0.0295735295625 },
    { id: 'cup',    label: 'cup (US)',    factor: 0.2365882365 },
    { id: 'pint',   label: 'pint (US)',   factor: 0.473176473 },
    { id: 'quart',  label: 'quart (US)',  factor: 0.946352946 },
    { id: 'gal',    label: 'gal (US)',    factor: 3.785411784 },
  ],
}

const AREA: CategoryDef = {
  id: 'area',
  label: 'Area',
  units: [
    // Base unit: m²
    { id: 'mm2',      label: 'mm²',      factor: 1e-6 },
    { id: 'cm2',      label: 'cm²',      factor: 1e-4 },
    { id: 'm2',       label: 'm²',       factor: 1 },
    { id: 'km2',      label: 'km²',      factor: 1e6 },
    { id: 'in2',      label: 'in²',      factor: 6.4516e-4 },
    { id: 'ft2',      label: 'ft²',      factor: 0.09290304 },
    { id: 'acre',     label: 'acre',     factor: 4046.8564224 },
    { id: 'hectare',  label: 'hectare',  factor: 10000 },
  ],
}

const SPEED: CategoryDef = {
  id: 'speed',
  label: 'Speed',
  units: [
    // Base unit: m/s
    { id: 'ms',    label: 'm/s',    factor: 1 },
    { id: 'kmh',   label: 'km/h',   factor: 1 / 3.6 },
    { id: 'mph',   label: 'mph',    factor: 0.44704 },
    { id: 'knots', label: 'knots',  factor: 0.514444444 },
    { id: 'fts',   label: 'ft/s',   factor: 0.3048 },
  ],
}

const DATA: CategoryDef = {
  id: 'data',
  label: 'Data',
  units: [
    // Base unit: bit
    { id: 'bit',  label: 'bit',  factor: 1 },
    { id: 'byte', label: 'byte', factor: 8 },
    // Decimal (SI) — powers of 1000
    { id: 'kb',   label: 'KB',   factor: 8 * 1e3 },
    { id: 'mb',   label: 'MB',   factor: 8 * 1e6 },
    { id: 'gb',   label: 'GB',   factor: 8 * 1e9 },
    { id: 'tb',   label: 'TB',   factor: 8 * 1e12 },
    // Binary (IEC) — powers of 1024
    { id: 'kib',  label: 'KiB',  factor: 8 * 1024 },
    { id: 'mib',  label: 'MiB',  factor: 8 * 1024 ** 2 },
    { id: 'gib',  label: 'GiB',  factor: 8 * 1024 ** 3 },
    { id: 'tib',  label: 'TiB',  factor: 8 * 1024 ** 4 },
  ],
}

// ── Exports ───────────────────────────────────────────────────────────────────

export const UNIT_CATEGORIES: string[] = [
  LENGTH.id,
  WEIGHT.id,
  TEMPERATURE.id,
  VOLUME.id,
  AREA.id,
  SPEED.id,
  DATA.id,
]

export const CATEGORIES: Record<string, CategoryDef> = {
  [LENGTH.id]:      LENGTH,
  [WEIGHT.id]:      WEIGHT,
  [TEMPERATURE.id]: TEMPERATURE,
  [VOLUME.id]:      VOLUME,
  [AREA.id]:        AREA,
  [SPEED.id]:       SPEED,
  [DATA.id]:        DATA,
}

// ── convert ───────────────────────────────────────────────────────────────────

/**
 * Convert `value` from `fromUnitId` to `toUnitId` within `categoryId`.
 *
 * Returns NaN if either unit is not found in the category.
 */
export function convert(
  categoryId: string,
  fromUnitId: string,
  toUnitId:   string,
  value:      number,
): number {
  const cat = CATEGORIES[categoryId]
  if (!cat) return NaN

  const fromUnit = cat.units.find((u) => u.id === fromUnitId)
  const toUnit   = cat.units.find((u) => u.id === toUnitId)
  if (!fromUnit || !toUnit) return NaN

  // Convert to base, then from base to target
  const baseValue = isAffine(fromUnit) ? fromUnit.toBase(value) : value * fromUnit.factor
  const result    = isAffine(toUnit)   ? toUnit.fromBase(baseValue) : baseValue / toUnit.factor

  return result
}

// ── formatResult ──────────────────────────────────────────────────────────────

/**
 * Format a conversion result as a clean string.
 *
 * Rules:
 *   - Up to 10 significant figures (avoids floating-point noise like 0.30000000000000004)
 *   - Trailing zeros after decimal point are stripped
 *   - Numbers ≥ 1e15 or ≤ 1e-7 (non-zero) are shown in exponential notation
 *   - NaN → ''
 *   - Infinity → '∞' / '-∞'
 */
export function formatResult(value: number): string {
  if (isNaN(value)) return ''
  if (!isFinite(value)) return value > 0 ? '∞' : '-∞'

  const abs = Math.abs(value)

  // Use exponential notation for very large or very small non-zero values
  if (abs !== 0 && (abs >= 1e15 || abs < 1e-7)) {
    // toPrecision returns e.g. "1.23456789e+15" — trim trailing zeros in mantissa
    return trimExp(value.toPrecision(10))
  }

  // For normal range: round to 10 significant figures, strip trailing zeros
  return stripTrailingZeros(parseFloat(value.toPrecision(10)).toString())
}

/** Remove trailing zeros after a decimal point (e.g. "1.50000" → "1.5", "2.0" → "2"). */
function stripTrailingZeros(s: string): string {
  if (!s.includes('.')) return s
  return s.replace(/\.?0+$/, '')
}

/** Trim trailing zeros from the mantissa of exponential notation strings. */
function trimExp(s: string): string {
  // e.g. "1.23400000e+15" → "1.234e+15"
  return s.replace(/(\.\d*?)0+(e)/, '$1$2').replace(/\.(e)/, '$1')
}

// ── isAbsoluteZeroWarning ─────────────────────────────────────────────────────

/** Absolute zero in Kelvin */
export const ABSOLUTE_ZERO_K = 0

/**
 * Returns true when a value in the given unit is below absolute zero.
 * Only meaningful for temperature units; returns false for all other categories.
 */
export function isAbsoluteZeroWarning(
  categoryId: string,
  unitId:     string,
  value:      number,
): boolean {
  if (categoryId !== TEMPERATURE.id) return false

  // Convert to Kelvin (the base unit for temperature in this implementation)
  const kelvin = convert(categoryId, unitId, 'k', value)
  return kelvin < ABSOLUTE_ZERO_K
}
