/**
 * Unit Converter — logic unit tests
 */

import { describe, it, expect } from 'vitest'
import {
  convert,
  formatResult,
  isAbsoluteZeroWarning,
  CATEGORIES,
  UNIT_CATEGORIES,
} from './logic'

// ── helpers ───────────────────────────────────────────────────────────────────

/** Expect a conversion result to be close enough (relative tolerance 1e-9). */
function expectClose(actual: number, expected: number, relTol = 1e-9) {
  if (expected === 0) {
    expect(Math.abs(actual)).toBeLessThan(1e-12)
  } else {
    expect(Math.abs(actual - expected) / Math.abs(expected)).toBeLessThan(relTol)
  }
}

// ── CATEGORIES structure ──────────────────────────────────────────────────────

describe('CATEGORIES / UNIT_CATEGORIES', () => {
  it('exports 7 categories', () => {
    expect(UNIT_CATEGORIES).toHaveLength(7)
  })

  it('every category id is in CATEGORIES map', () => {
    for (const id of UNIT_CATEGORIES) {
      expect(CATEGORIES[id]).toBeDefined()
    }
  })

  it('every category has at least 2 units', () => {
    for (const id of UNIT_CATEGORIES) {
      expect(CATEGORIES[id].units.length).toBeGreaterThanOrEqual(2)
    }
  })
})

// ── Length ────────────────────────────────────────────────────────────────────

describe('convert — length', () => {
  it('1 m → 1 m (identity)', () => {
    expect(convert('length', 'm', 'm', 1)).toBe(1)
  })

  it('1 mi → 1.609344 km', () => {
    expectClose(convert('length', 'mi', 'km', 1), 1.609344)
  })

  it('1 km = 1000 m', () => {
    expectClose(convert('length', 'km', 'm', 1), 1000)
  })

  it('1 ft = 12 in', () => {
    expectClose(convert('length', 'ft', 'in', 1), 12)
  })

  it('1 in = 2.54 cm', () => {
    expectClose(convert('length', 'in', 'cm', 1), 2.54)
  })

  it('1 yd = 3 ft', () => {
    expectClose(convert('length', 'yd', 'ft', 1), 3)
  })

  it('1 mi = 5280 ft', () => {
    expectClose(convert('length', 'mi', 'ft', 1), 5280)
  })

  it('round-trip: km → mi → km', () => {
    const start = 42
    const result = convert('length', 'mi', 'km', convert('length', 'km', 'mi', start))
    expectClose(result, start)
  })
})

// ── Weight / Mass ─────────────────────────────────────────────────────────────

describe('convert — weight', () => {
  it('1 kg = 1000 g', () => {
    expectClose(convert('weight', 'kg', 'g', 1), 1000)
  })

  it('1 lb = 453.59237 g', () => {
    expectClose(convert('weight', 'lb', 'g', 1), 453.59237)
  })

  it('1 stone = 14 lb', () => {
    expectClose(convert('weight', 'stone', 'lb', 1), 14)
  })

  it('1 oz = 28.349523125 g', () => {
    expectClose(convert('weight', 'oz', 'g', 1), 28.349523125)
  })

  it('1 tonne = 1e6 mg', () => {
    expectClose(convert('weight', 'tonne', 'mg', 1), 1e9)
  })

  it('round-trip: lb → kg → lb', () => {
    const start = 75
    const result = convert('weight', 'kg', 'lb', convert('weight', 'lb', 'kg', start))
    expectClose(result, start)
  })
})

// ── Temperature ───────────────────────────────────────────────────────────────

describe('convert — temperature', () => {
  it('32°F = 0°C', () => {
    expectClose(convert('temperature', 'f', 'c', 32), 0)
  })

  it('100°C = 212°F', () => {
    expectClose(convert('temperature', 'c', 'f', 100), 212)
  })

  it('100°C = 373.15 K', () => {
    expectClose(convert('temperature', 'c', 'k', 100), 373.15)
  })

  it('0°C = 273.15 K', () => {
    expectClose(convert('temperature', 'c', 'k', 0), 273.15)
  })

  it('373.15 K = 212°F', () => {
    expectClose(convert('temperature', 'k', 'f', 373.15), 212)
  })

  it('-40°C = -40°F', () => {
    expectClose(convert('temperature', 'c', 'f', -40), -40)
  })

  it('0 K = -273.15°C', () => {
    expectClose(convert('temperature', 'k', 'c', 0), -273.15)
  })

  it('round-trip: °C → K → °C', () => {
    const start = 37
    const result = convert('temperature', 'k', 'c', convert('temperature', 'c', 'k', start))
    expectClose(result, start)
  })

  it('round-trip: °F → °C → °F', () => {
    const start = 98.6
    const result = convert('temperature', 'c', 'f', convert('temperature', 'f', 'c', start))
    expectClose(result, start)
  })
})

// ── Volume ────────────────────────────────────────────────────────────────────

describe('convert — volume', () => {
  it('1 gal = 3.785411784 L', () => {
    expectClose(convert('volume', 'gal', 'l', 1), 3.785411784)
  })

  it('1 L = 1000 ml', () => {
    expectClose(convert('volume', 'l', 'ml', 1), 1000)
  })

  it('1 cup = 16 tbsp', () => {
    expectClose(convert('volume', 'cup', 'tbsp', 1), 16)
  })

  it('1 tbsp = 3 tsp', () => {
    expectClose(convert('volume', 'tbsp', 'tsp', 1), 3)
  })

  it('1 pint = 2 cups', () => {
    expectClose(convert('volume', 'pint', 'cup', 1), 2)
  })

  it('1 quart = 2 pints', () => {
    expectClose(convert('volume', 'quart', 'pint', 1), 2)
  })

  it('1 gal = 4 quarts', () => {
    expectClose(convert('volume', 'gal', 'quart', 1), 4)
  })

  it('1 fl oz = 2 tbsp', () => {
    expectClose(convert('volume', 'floz', 'tbsp', 1), 2)
  })

  it('round-trip: gal → ml → gal', () => {
    const start = 2.5
    const result = convert('volume', 'ml', 'gal', convert('volume', 'gal', 'ml', start))
    expectClose(result, start)
  })
})

// ── Area ──────────────────────────────────────────────────────────────────────

describe('convert — area', () => {
  it('1 acre = 4046.8564224 m²', () => {
    expectClose(convert('area', 'acre', 'm2', 1), 4046.8564224)
  })

  it('1 hectare = 10000 m²', () => {
    expectClose(convert('area', 'hectare', 'm2', 1), 10000)
  })

  it('1 km² = 1e6 m²', () => {
    expectClose(convert('area', 'km2', 'm2', 1), 1e6)
  })

  it('1 ft² = 144 in²', () => {
    expectClose(convert('area', 'ft2', 'in2', 1), 144)
  })

  it('1 acre = 0.404686 hectares', () => {
    expectClose(convert('area', 'acre', 'hectare', 1), 0.40468564224, 1e-8)
  })

  it('round-trip: acre → m² → acre', () => {
    const start = 5
    const result = convert('area', 'm2', 'acre', convert('area', 'acre', 'm2', start))
    expectClose(result, start)
  })
})

// ── Speed ─────────────────────────────────────────────────────────────────────

describe('convert — speed', () => {
  it('1 m/s = 3.6 km/h', () => {
    expectClose(convert('speed', 'ms', 'kmh', 1), 3.6)
  })

  it('1 mph = 1.60934 km/h', () => {
    expectClose(convert('speed', 'mph', 'kmh', 1), 1.609344)
  })

  it('1 knot = 1.852 km/h', () => {
    expectClose(convert('speed', 'knots', 'kmh', 1), 1.852, 1e-6)
  })

  it('1 ft/s = 0.3048 m/s', () => {
    expectClose(convert('speed', 'fts', 'ms', 1), 0.3048)
  })

  it('round-trip: mph → m/s → mph', () => {
    const start = 60
    const result = convert('speed', 'ms', 'mph', convert('speed', 'mph', 'ms', start))
    expectClose(result, start)
  })
})

// ── Data ──────────────────────────────────────────────────────────────────────

describe('convert — data', () => {
  it('1 byte = 8 bits', () => {
    expectClose(convert('data', 'byte', 'bit', 1), 8)
  })

  it('1 KB = 1000 bytes (decimal)', () => {
    expectClose(convert('data', 'kb', 'byte', 1), 1000)
  })

  it('1 MB = 1000 KB (decimal)', () => {
    expectClose(convert('data', 'mb', 'kb', 1), 1000)
  })

  it('1 GB = 1e9 bytes (decimal)', () => {
    expectClose(convert('data', 'gb', 'byte', 1), 1e9)
  })

  it('1 TB = 1e12 bytes (decimal)', () => {
    expectClose(convert('data', 'tb', 'byte', 1), 1e12)
  })

  it('1 KiB = 1024 bytes (binary)', () => {
    expectClose(convert('data', 'kib', 'byte', 1), 1024)
  })

  it('1 MiB = 1024 KiB (binary)', () => {
    expectClose(convert('data', 'mib', 'kib', 1), 1024)
  })

  it('1 GiB = 1073741824 bytes (binary)', () => {
    expectClose(convert('data', 'gib', 'byte', 1), 1073741824)
  })

  it('1 TiB = 1024 GiB (binary)', () => {
    expectClose(convert('data', 'tib', 'gib', 1), 1024)
  })

  it('round-trip: GiB → bits → GiB', () => {
    const start = 3
    const result = convert('data', 'bit', 'gib', convert('data', 'gib', 'bit', start))
    expectClose(result, start)
  })
})

// ── convert — error handling ──────────────────────────────────────────────────

describe('convert — error handling', () => {
  it('returns NaN for unknown category', () => {
    expect(isNaN(convert('nope', 'm', 'km', 1))).toBe(true)
  })

  it('returns NaN for unknown fromUnit', () => {
    expect(isNaN(convert('length', 'nope', 'km', 1))).toBe(true)
  })

  it('returns NaN for unknown toUnit', () => {
    expect(isNaN(convert('length', 'm', 'nope', 1))).toBe(true)
  })
})

// ── formatResult ──────────────────────────────────────────────────────────────

describe('formatResult', () => {
  it('formats a clean integer', () => {
    expect(formatResult(1000)).toBe('1000')
  })

  it('trims floating-point noise (1/3 * 3)', () => {
    // 0.1 + 0.2 produces 0.30000000000000004 in JS
    expect(formatResult(0.1 + 0.2)).toBe('0.3')
  })

  it('trims to 10 significant figures', () => {
    // pi to 15 sig figs → should show 10
    expect(formatResult(Math.PI)).toBe('3.141592654')
  })

  it('strips trailing zeros after decimal', () => {
    expect(formatResult(1.50000)).toBe('1.5')
  })

  it('returns empty string for NaN', () => {
    expect(formatResult(NaN)).toBe('')
  })

  it('returns ∞ for Infinity', () => {
    expect(formatResult(Infinity)).toBe('∞')
  })

  it('returns -∞ for -Infinity', () => {
    expect(formatResult(-Infinity)).toBe('-∞')
  })

  it('formats zero as "0"', () => {
    expect(formatResult(0)).toBe('0')
  })

  it('uses exponential notation for large values (≥1e15)', () => {
    const s = formatResult(1e15)
    expect(s).toContain('e')
  })

  it('uses exponential notation for very small non-zero values (<1e-7)', () => {
    const s = formatResult(1e-8)
    expect(s).toContain('e')
  })

  it('does NOT use exponential for 1e14 (below threshold)', () => {
    const s = formatResult(1e14)
    expect(s).not.toContain('e')
  })

  it('formats 1609.344 cleanly', () => {
    expect(formatResult(1609.344)).toBe('1609.344')
  })

  it('formats 273.15 cleanly (°C → K offset)', () => {
    expect(formatResult(273.15)).toBe('273.15')
  })
})

// ── isAbsoluteZeroWarning ─────────────────────────────────────────────────────

describe('isAbsoluteZeroWarning', () => {
  it('returns false for a normal Celsius value', () => {
    expect(isAbsoluteZeroWarning('temperature', 'c', 20)).toBe(false)
  })

  it('returns false for exactly 0 K (boundary — not below)', () => {
    expect(isAbsoluteZeroWarning('temperature', 'k', 0)).toBe(false)
  })

  it('returns true for -1 K (below absolute zero in K)', () => {
    expect(isAbsoluteZeroWarning('temperature', 'k', -1)).toBe(true)
  })

  it('returns true for -274°C (below absolute zero)', () => {
    expect(isAbsoluteZeroWarning('temperature', 'c', -274)).toBe(true)
  })

  it('returns true for -460°F (below absolute zero)', () => {
    // absolute zero is -459.67°F; -460 is just below
    expect(isAbsoluteZeroWarning('temperature', 'f', -460)).toBe(true)
  })

  it('returns false for -273.15°C (absolute zero, not below)', () => {
    expect(isAbsoluteZeroWarning('temperature', 'c', -273.15)).toBe(false)
  })

  it('returns false for length category', () => {
    expect(isAbsoluteZeroWarning('length', 'm', -1)).toBe(false)
  })

  it('returns false for weight category', () => {
    expect(isAbsoluteZeroWarning('weight', 'kg', -1)).toBe(false)
  })
})
