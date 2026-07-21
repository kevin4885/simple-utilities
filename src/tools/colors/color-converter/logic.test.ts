import { describe, it, expect } from 'vitest'
import {
  rgbToHsl, hslToRgb,
  rgbToHsv, hsvToRgb,
  rgbToHwb, hwbToRgb,
  rgbToOklch, oklchToRgb,
  rgbToCmyk,
  rgbToDecimal,
  parseColor,
  generateFormats,
  generatePalette,
  getContrastColor,
  clamp,
} from './logic'

// ── clamp ──────────────────────────────────────────────────────────
describe('clamp', () => {
  it('in-range passes through', () => expect(clamp(5, 0, 10)).toBe(5))
  it('below min → min',        () => expect(clamp(-5, 0, 10)).toBe(0))
  it('above max → max',        () => expect(clamp(15, 0, 10)).toBe(10))
})

// ── rgbToHsl / hslToRgb ────────────────────────────────────────────
describe('rgbToHsl', () => {
  it('black  → [0, 0, 0]',    () => expect(rgbToHsl(0, 0, 0)).toEqual([0, 0, 0]))
  it('white  → [0, 0, 100]',  () => expect(rgbToHsl(255, 255, 255)).toEqual([0, 0, 100]))
  it('red    → [0, 100, 50]', () => expect(rgbToHsl(255, 0, 0)).toEqual([0, 100, 50]))
  it('blue   → [240, 100, 50]', () => expect(rgbToHsl(0, 0, 255)).toEqual([240, 100, 50]))
  it('#0a1120 hue ≈ 221', () => {
    const [h] = rgbToHsl(10, 17, 32)
    expect(h).toBeGreaterThanOrEqual(218)
    expect(h).toBeLessThanOrEqual(224)
  })
})

describe('hslToRgb', () => {
  it('black',  () => expect(hslToRgb(0, 0, 0)).toEqual([0, 0, 0]))
  it('white',  () => expect(hslToRgb(0, 0, 100)).toEqual([255, 255, 255]))
  it('red',    () => expect(hslToRgb(0, 100, 50)).toEqual([255, 0, 0]))
  it('roundtrip red', () => {
    const [r, g, b] = hslToRgb(0, 100, 50)
    expect(rgbToHsl(r, g, b)).toEqual([0, 100, 50])
  })
})

// ── rgbToHsv / hsvToRgb ────────────────────────────────────────────
describe('rgbToHsv', () => {
  it('black → [0, 0, 0]',    () => expect(rgbToHsv(0, 0, 0)).toEqual([0, 0, 0]))
  it('white → [0, 0, 100]',  () => expect(rgbToHsv(255, 255, 255)).toEqual([0, 0, 100]))
  it('red   → [0, 100, 100]',() => expect(rgbToHsv(255, 0, 0)).toEqual([0, 100, 100]))
  it('blue  → [240, 100, 100]', () => expect(rgbToHsv(0, 0, 255)).toEqual([240, 100, 100]))
})

describe('hsvToRgb roundtrip', () => {
  it('blue', () => {
    const [r, g, b] = hsvToRgb(240, 100, 100)
    expect(rgbToHsv(r, g, b)).toEqual([240, 100, 100])
  })
})

// ── rgbToHwb / hwbToRgb ────────────────────────────────────────────
describe('rgbToHwb', () => {
  it('white → whiteness 100', () => {
    const [, w] = rgbToHwb(255, 255, 255)
    expect(w).toBe(100)
  })
  it('black → blackness 100', () => {
    const [,, bk] = rgbToHwb(0, 0, 0)
    expect(bk).toBe(100)
  })
  it('red hue ≈ 0', () => {
    const [h] = rgbToHwb(255, 0, 0)
    expect(h).toBe(0)
  })
})

describe('hwbToRgb', () => {
  it('achromatic: w+b ≥ 1 → gray', () => {
    const [r, g, b] = hwbToRgb(0, 60, 60)
    expect(r).toBe(g)
    expect(g).toBe(b)
  })
  it('hwb(0 0% 0%) → red (255,0,0)', () => {
    const [r, g, b] = hwbToRgb(0, 0, 0)
    expect(r).toBe(255)
    expect(g).toBe(0)
    expect(b).toBe(0)
  })
  it('hwb(0 100% 0%) → white', () => {
    const [r, g, b] = hwbToRgb(0, 100, 0)
    expect(r).toBe(255)
    expect(g).toBe(255)
    expect(b).toBe(255)
  })
})

// ── rgbToOklch / oklchToRgb ────────────────────────────────────────
describe('rgbToOklch', () => {
  it('black → L ≈ 0', () => {
    const [L] = rgbToOklch(0, 0, 0)
    expect(L).toBeCloseTo(0, 3)
  })
  it('white → L ≈ 1', () => {
    const [L] = rgbToOklch(255, 255, 255)
    expect(L).toBeCloseTo(1, 2)
  })
  it('white → C ≈ 0 (no chroma)', () => {
    const [, C] = rgbToOklch(255, 255, 255)
    expect(C).toBeLessThan(0.001)
  })
  it('#0a1120 → L between 0.1 and 0.3', () => {
    const [L] = rgbToOklch(10, 17, 32)
    expect(L).toBeGreaterThan(0.1)
    expect(L).toBeLessThan(0.3)
  })
})

describe('oklchToRgb roundtrip', () => {
  it('red roundtrip within ±2', () => {
    const [L, C, H] = rgbToOklch(255, 0, 0)
    const [r, g, b] = oklchToRgb(L, C, H)
    expect(r).toBeGreaterThan(250)
    expect(g).toBeLessThan(5)
    expect(b).toBeLessThan(5)
  })
  it('navy roundtrip within ±2', () => {
    const [L, C, H] = rgbToOklch(0, 0, 128)
    const [r, g, b] = oklchToRgb(L, C, H)
    expect(r).toBeLessThan(5)
    expect(g).toBeLessThan(5)
    expect(b).toBeGreaterThan(123)
  })
})

// ── rgbToCmyk ─────────────────────────────────────────────────────
describe('rgbToCmyk', () => {
  it('black → [0, 0, 0, 100]', () => expect(rgbToCmyk(0, 0, 0)).toEqual([0, 0, 0, 100]))
  it('white → [0, 0, 0, 0]',   () => expect(rgbToCmyk(255, 255, 255)).toEqual([0, 0, 0, 0]))
  it('red   → [0, 100, 100, 0]', () => expect(rgbToCmyk(255, 0, 0)).toEqual([0, 100, 100, 0]))
})

// ── rgbToDecimal ──────────────────────────────────────────────────
describe('rgbToDecimal', () => {
  it('black → 0',        () => expect(rgbToDecimal(0, 0, 0)).toBe(0))
  it('white → 16777215', () => expect(rgbToDecimal(255, 255, 255)).toBe(16777215))
  it('red   → 16711680', () => expect(rgbToDecimal(255, 0, 0)).toBe(16711680))
})

// ── parseColor — hex ───────────────────────────────────────────────
describe('parseColor — hex', () => {
  it('#rrggbb', () => {
    const r = parseColor('#0a1120')!
    expect(r.color).toMatchObject({ r: 10, g: 17, b: 32, a: 1 })
    expect(r.format).toBe('hex')
  })
  it('#rgb shorthand', () => {
    expect(parseColor('#abc')!.color.r).toBe(0xaa)
  })
  it('without # prefix', () => {
    const r = parseColor('ff0000')!
    expect(r.color).toMatchObject({ r: 255, g: 0, b: 0 })
  })
  it('uppercase', () => {
    expect(parseColor('#FF0000')!.color.r).toBe(255)
  })
  it('#rrggbbaa with ff alpha', () => {
    expect(parseColor('#0a1120ff')!.color.a).toBeCloseTo(1, 1)
  })
  it('#rrggbbaa with 80 alpha ≈ 0.5', () => {
    expect(parseColor('#0a112080')!.color.a).toBeCloseTo(0.502, 2)
  })
})

// ── parseColor — RGB Level 3 (comma) ──────────────────────────────
describe('parseColor — rgb L3', () => {
  it('rgb()',  () => {
    const r = parseColor('rgb(10, 17, 32)')!
    expect(r.color).toMatchObject({ r: 10, g: 17, b: 32, a: 1 })
    expect(r.format).toBe('rgb')
  })
  it('rgba()',  () => {
    expect(parseColor('rgba(10, 17, 32, 0.5)')!.color.a).toBeCloseTo(0.5)
  })
})

// ── parseColor — RGB Level 4 (space / slash) ──────────────────────
describe('parseColor — rgb L4', () => {
  it('rgb(10 17 32)',           () => {
    const r = parseColor('rgb(10 17 32)')!
    expect(r.color).toMatchObject({ r: 10, g: 17, b: 32, a: 1 })
    expect(r.format).toBe('rgb-l4')
  })
  it('rgb(10 17 32 / 0.5)',     () => {
    expect(parseColor('rgb(10 17 32 / 0.5)')!.color.a).toBeCloseTo(0.5)
  })
  it('rgb(10 17 32 / 50%)',     () => {
    expect(parseColor('rgb(10 17 32 / 50%)')!.color.a).toBeCloseTo(0.5)
  })
  it('rgba space alias',        () => {
    expect(parseColor('rgba(10 17 32 / 0.5)')!.format).toBe('rgb-l4')
  })
})

// ── parseColor — HSL Level 3 (comma) ──────────────────────────────
describe('parseColor — hsl L3', () => {
  it('hsl(0, 100%, 50%) → red', () => {
    const r = parseColor('hsl(0, 100%, 50%)')!
    expect(r.color.r).toBe(255)
    expect(r.color.g).toBe(0)
    expect(r.format).toBe('hsl')
  })
  it('hsla(0, 100%, 50%, 0.5)', () => {
    expect(parseColor('hsla(0, 100%, 50%, 0.5)')!.color.a).toBeCloseTo(0.5)
  })
})

// ── parseColor — HSL Level 4 (space / slash) ──────────────────────
describe('parseColor — hsl L4', () => {
  it('hsl(0 100% 50%)',         () => {
    const r = parseColor('hsl(0 100% 50%)')!
    expect(r.color.r).toBe(255)
    expect(r.format).toBe('hsl-l4')
  })
  it('hsl(221 52% 8%)',         () => {
    expect(parseColor('hsl(221 52% 8%)')!.format).toBe('hsl-l4')
  })
  it('hsl(0 100% 50% / 0.5)',   () => {
    expect(parseColor('hsl(0 100% 50% / 0.5)')!.color.a).toBeCloseTo(0.5)
  })
  it('hsl(0 100% 50% / 50%)',   () => {
    expect(parseColor('hsl(0 100% 50% / 50%)')!.color.a).toBeCloseTo(0.5)
  })
  it('hsla space alias',        () => {
    expect(parseColor('hsla(0 100% 50% / 0.5)')!.format).toBe('hsl-l4')
  })
})

// ── parseColor — Bare HSL triplet (Tailwind v3) ───────────────────
describe('parseColor — hsl-raw', () => {
  it('220 45% 10%', () => {
    const r = parseColor('220 45% 10%')!
    expect(r.format).toBe('hsl-raw')
    expect(r.color.r).toBeGreaterThan(0)
  })
  it('0 100% 50% → red', () => {
    const r = parseColor('0 100% 50%')!
    expect(r.color.r).toBe(255)
    expect(r.color.g).toBe(0)
  })
})

// ── parseColor — HSB ──────────────────────────────────────────────
describe('parseColor — hsb', () => {
  it('hsb(0, 100%, 100%) → red', () => {
    const r = parseColor('hsb(0, 100%, 100%)')!
    expect(r.color.r).toBe(255)
    expect(r.format).toBe('hsb')
  })
  it('hsv alias', () => {
    expect(parseColor('hsv(0, 100%, 100%)')!.format).toBe('hsb')
  })
})

// ── parseColor — HWB ──────────────────────────────────────────────
describe('parseColor — hwb', () => {
  it('hwb(0 0% 0%) → red', () => {
    const r = parseColor('hwb(0 0% 0%)')!
    expect(r.color.r).toBe(255)
    expect(r.format).toBe('hwb')
  })
  it('hwb(0 100% 0%) → white', () => {
    const r = parseColor('hwb(0 100% 0%)')!
    expect(r.color.r).toBe(255)
    expect(r.color.g).toBe(255)
    expect(r.color.b).toBe(255)
  })
  it('hwb with alpha', () => {
    expect(parseColor('hwb(0 0% 0% / 0.5)')!.color.a).toBeCloseTo(0.5)
  })
  it('hwb with % alpha', () => {
    expect(parseColor('hwb(0 0% 0% / 50%)')!.color.a).toBeCloseTo(0.5)
  })
})

// ── parseColor — OKLCH ────────────────────────────────────────────
describe('parseColor — oklch', () => {
  it('oklch(0% 0 0) → near black', () => {
    const r = parseColor('oklch(0% 0 0)')!
    expect(r.format).toBe('oklch')
    expect(r.color.r).toBeLessThan(5)
  })
  it('oklch(1 0 0) → near white', () => {
    const r = parseColor('oklch(1 0 0)')!
    expect(r.color.r).toBeGreaterThan(250)
  })
  it('oklch with % lightness', () => {
    expect(parseColor('oklch(100% 0 0)')!.color.r).toBeGreaterThan(250)
  })
  it('oklch with alpha', () => {
    expect(parseColor('oklch(0.5 0.1 220 / 0.5)')!.color.a).toBeCloseTo(0.5)
  })
  it('oklch with % alpha', () => {
    expect(parseColor('oklch(0.5 0.1 220 / 50%)')!.color.a).toBeCloseTo(0.5)
  })
})

// ── parseColor — CMYK ─────────────────────────────────────────────
describe('parseColor — cmyk', () => {
  it('cmyk(0%, 0%, 0%, 0%) → white', () => {
    const r = parseColor('cmyk(0%, 0%, 0%, 0%)')!
    expect(r.color).toMatchObject({ r: 255, g: 255, b: 255 })
    expect(r.format).toBe('cmyk')
  })
  it('cmyk(0%, 100%, 100%, 0%) → red', () => {
    expect(parseColor('cmyk(0%, 100%, 100%, 0%)')!.color.r).toBe(255)
  })
})

// ── parseColor — Named ────────────────────────────────────────────
describe('parseColor — named', () => {
  it('"red"',   () => { const r = parseColor('red')!; expect(r.color.r).toBe(255); expect(r.format).toBe('named') })
  it('"navy"',  () => expect(parseColor('navy')!.color.b).toBe(128))
  it('unknown name → null', () => expect(parseColor('notacolor')).toBeNull())
})

// ── parseColor — CSS var declaration ──────────────────────────────
describe('parseColor — css var declaration (tw-var)', () => {
  it('--background: 220 45% 10%', () => {
    const r = parseColor('--background: 220 45% 10%')!
    expect(r.format).toBe('tw-var')
    expect(r.color.r).toBeGreaterThan(0)
  })
  it('--color: #ff0000;', () => {
    const r = parseColor('--color: #ff0000;')!
    expect(r.format).toBe('tw-var')
    expect(r.color.r).toBe(255)
  })
  it('--c: oklch(0.5 0.1 220)', () => {
    expect(parseColor('--c: oklch(0.5 0.1 220)')!.format).toBe('tw-var')
  })
  it('--c: hsl(0 100% 50%)', () => {
    const r = parseColor('--c: hsl(0 100% 50%)')!
    expect(r.format).toBe('tw-var')
    expect(r.color.r).toBe(255)
  })
  it('--c: rgb(10, 17, 32)', () => {
    expect(parseColor('--c: rgb(10, 17, 32)')!.color).toMatchObject({ r: 10, g: 17, b: 32 })
  })
})

// ── parseColor — Tailwind bracket ─────────────────────────────────
describe('parseColor — tw-bracket', () => {
  it('[#0a1120]', () => {
    const r = parseColor('[#0a1120]')!
    expect(r.format).toBe('tw-bracket')
    expect(r.color).toMatchObject({ r: 10, g: 17, b: 32 })
  })
  it('bg-[#ff0000]', () => {
    const r = parseColor('bg-[#ff0000]')!
    expect(r.format).toBe('tw-bracket')
    expect(r.color.r).toBe(255)
  })
  it('text-[rgb(10,17,32)]', () => {
    expect(parseColor('text-[rgb(10,17,32)]')!.color).toMatchObject({ r: 10, g: 17, b: 32 })
  })
  it('border-[hsl(0,100%,50%)]', () => {
    expect(parseColor('border-[hsl(0,100%,50%)]')!.color.r).toBe(255)
  })
})

// ── parseColor — invalid ───────────────────────────────────────────
describe('parseColor — invalid', () => {
  it('empty string → null', () => expect(parseColor('')).toBeNull())
  it('garbage → null',      () => expect(parseColor('xyzzy')).toBeNull())
  it('partial hex → null',  () => expect(parseColor('#12')).toBeNull())
})

// ── generateFormats ────────────────────────────────────────────────
describe('generateFormats — #0a1120', () => {
  const f = generateFormats({ r: 10, g: 17, b: 32, a: 1 })

  it('hex',       () => expect(f.hex).toBe('#0a1120'))
  it('hexUpper',  () => expect(f.hexUpper).toBe('#0A1120'))
  it('hex8',      () => expect(f.hex8).toMatch(/ff$/))
  it('rgb L3',    () => expect(f.rgb).toBe('rgb(10, 17, 32)'))
  it('rgba L3',   () => expect(f.rgba).toContain('1.00'))
  it('rgbL4',     () => expect(f.rgbL4).toBe('rgb(10 17 32)'))
  it('rgbL4a',    () => expect(f.rgbL4a).toBe('rgb(10 17 32 / 1.00)'))
  it('hsl L3',    () => expect(f.hsl).toContain('%'))
  it('hslL4',     () => expect(f.hslL4).not.toContain(','))
  it('hslL4a',    () => expect(f.hslL4a).toContain(' / '))
  it('hsb',       () => expect(f.hsb).toContain('hsb('))
  it('hwb',       () => expect(f.hwb).toContain('hwb('))
  it('hwba',      () => expect(f.hwba).toContain(' / '))
  it('oklch',     () => expect(f.oklch).toContain('oklch('))
  it('oklcha',    () => expect(f.oklcha).toContain(' / '))
  it('cmyk K≈87', () => expect(f.cmyk).toContain('87%'))
  it('cssVar',    () => expect(f.cssVar).toMatch(/^--color:/))
  it('twHslRaw',  () => expect(f.twHslRaw).not.toContain('hsl'))
  it('twCssVarV3 has raw triplet', () => expect(f.twCssVarV3).toMatch(/--color: \d+ \d+% \d+%;/))
  it('twCssVarV4 has oklch',       () => expect(f.twCssVarV4).toContain('oklch'))
  it('twBracket', () => expect(f.twBracket).toBe('[#0a1120]'))
  it('twBgUtil',  () => expect(f.twBgUtil).toBe('bg-[#0a1120]'))
  it('decimal',   () => expect(Number(f.decimal)).toBeGreaterThanOrEqual(0))
})

// ── generatePalette ────────────────────────────────────────────────
describe('generatePalette', () => {
  const p = generatePalette({ r: 10, g: 17, b: 32, a: 1 })

  it('11 swatches',     () => expect(p).toHaveLength(11))
  it('one base',        () => expect(p.filter((s) => s.isBase)).toHaveLength(1))
  it('base = #0a1120',  () => expect(p.find((s) => s.isBase)!.hex).toBe('#0a1120'))
  it('all valid hex',   () => p.forEach((s) => expect(s.hex).toMatch(/^#[0-9a-f]{6}$/)))
})

// ── getContrastColor ───────────────────────────────────────────────
describe('getContrastColor', () => {
  it('white bg → black text', () => expect(getContrastColor({ r: 255, g: 255, b: 255, a: 1 })).toBe('black'))
  it('black bg → white text', () => expect(getContrastColor({ r: 0, g: 0, b: 0, a: 1 })).toBe('white'))
  it('#0a1120 → white',       () => expect(getContrastColor({ r: 10, g: 17, b: 32, a: 1 })).toBe('white'))
  it('light yellow → black',  () => expect(getContrastColor({ r: 255, g: 255, b: 200, a: 1 })).toBe('black'))
})
