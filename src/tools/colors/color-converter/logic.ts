// ── Types ──────────────────────────────────────────────────────────

export interface RgbaColor {
  r: number // 0–255
  g: number // 0–255
  b: number // 0–255
  a: number // 0–1
}

export interface ColorFormats {
  // ── Hex ────────────────────────────────────────────────────────
  hex: string         // #0a1120
  hexUpper: string    // #0A1120
  hex8: string        // #0a1120ff
  // ── Decimal ────────────────────────────────────────────────────
  decimal: string     // 657184
  // ── RGB Level 3 (comma) ────────────────────────────────────────
  rgb: string         // rgb(10, 17, 32)
  rgba: string        // rgba(10, 17, 32, 1.00)
  // ── RGB Level 4 (space / slash) ────────────────────────────────
  rgbL4: string       // rgb(10 17 32)
  rgbL4a: string      // rgb(10 17 32 / 1.00)
  // ── HSL Level 3 (comma) ────────────────────────────────────────
  hsl: string         // hsl(221, 52%, 8%)
  hsla: string        // hsla(221, 52%, 8%, 1.00)
  // ── HSL Level 4 (space / slash) ────────────────────────────────
  hslL4: string       // hsl(221 52% 8%)
  hslL4a: string      // hsl(221 52% 8% / 1.00)
  // ── Other colour models ─────────────────────────────────────────
  hsb: string         // hsb(221, 69%, 13%)
  hwb: string         // hwb(221 4% 87%)
  hwba: string        // hwb(221 4% 87% / 1.00)
  oklch: string       // oklch(21.1% 0.0482 221.5)
  oklcha: string      // oklch(21.1% 0.0482 221.5 / 1.00)
  cmyk: string        // cmyk(69%, 47%, 0%, 87%)
  // ── CSS / generic ──────────────────────────────────────────────
  cssVar: string      // --color: #0a1120;
  // ── Tailwind-specific ──────────────────────────────────────────
  twHslRaw: string    // 221 52% 8%          (TW v3 CSS-var value)
  twCssVarV3: string  // --color: 221 52% 8%;
  twCssVarV4: string  // --color: oklch(21.1% 0.0482 221.5);
  twBracket: string   // [#0a1120]
  twBgUtil: string    // bg-[#0a1120]
}

export type InputFormat =
  | 'hex'
  | 'rgb'       // Level 3 comma
  | 'rgb-l4'    // Level 4 space
  | 'hsl'       // Level 3 comma
  | 'hsl-l4'    // Level 4 space
  | 'hsl-raw'   // bare "H S% L%" triplet  (Tailwind v3 CSS-var value)
  | 'hsb'
  | 'hwb'
  | 'oklch'
  | 'cmyk'
  | 'named'
  | 'tw-bracket' // [#hex] or bg-[#hex]
  | 'tw-var'     // --name: value;
  | 'unknown'

export type SliderMode = 'rgb' | 'hsl' | 'hsv'

// ── Helpers ────────────────────────────────────────────────────────

export function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n))
}

function toHexByte(n: number): string {
  return Math.round(clamp(n, 0, 255))
    .toString(16)
    .padStart(2, '0')
}

export function rgbToHexStr(r: number, g: number, b: number): string {
  return `#${toHexByte(r)}${toHexByte(g)}${toHexByte(b)}`
}

/** Parse alpha string: "0.5" → 0.5 | "50%" → 0.5 | undefined → 1 */
function parseAlpha(s: string | undefined): number {
  if (s == null) return 1
  if (s.endsWith('%')) return clamp(parseFloat(s) / 100, 0, 1)
  return clamp(parseFloat(s), 0, 1)
}

// ── RGB ↔ HSL ──────────────────────────────────────────────────────

export function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rr = r / 255
  const gg = g / 255
  const bb = b / 255
  const max = Math.max(rr, gg, bb)
  const min = Math.min(rr, gg, bb)
  let h = 0
  let s = 0
  const l = (max + min) / 2

  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    switch (max) {
      case rr: h = ((gg - bb) / d + (gg < bb ? 6 : 0)) / 6; break
      case gg: h = ((bb - rr) / d + 2) / 6; break
      case bb: h = ((rr - gg) / d + 4) / 6; break
    }
  }

  return [Math.round(h * 360), Math.round(s * 100), Math.round(l * 100)]
}

export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const hh = h / 360
  const ss = s / 100
  const ll = l / 100

  if (ss === 0) {
    const v = Math.round(ll * 255)
    return [v, v, v]
  }

  const q = ll < 0.5 ? ll * (1 + ss) : ll + ss - ll * ss
  const p = 2 * ll - q

  function hue2rgb(t: number): number {
    let tt = t
    if (tt < 0) tt += 1
    if (tt > 1) tt -= 1
    if (tt < 1 / 6) return p + (q - p) * 6 * tt
    if (tt < 1 / 2) return q
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6
    return p
  }

  return [
    Math.round(hue2rgb(hh + 1 / 3) * 255),
    Math.round(hue2rgb(hh) * 255),
    Math.round(hue2rgb(hh - 1 / 3) * 255),
  ]
}

// ── RGB ↔ HSV ──────────────────────────────────────────────────────

export function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  const rr = r / 255
  const gg = g / 255
  const bb = b / 255
  const max = Math.max(rr, gg, bb)
  const min = Math.min(rr, gg, bb)
  const v = max
  const d = max - min
  const s = max === 0 ? 0 : d / max
  let h = 0

  if (max !== min) {
    switch (max) {
      case rr: h = ((gg - bb) / d + (gg < bb ? 6 : 0)) / 6; break
      case gg: h = ((bb - rr) / d + 2) / 6; break
      case bb: h = ((rr - gg) / d + 4) / 6; break
    }
  }

  return [Math.round(h * 360), Math.round(s * 100), Math.round(v * 100)]
}

export function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const hh = h / 360
  const ss = s / 100
  const vv = v / 100
  const i = Math.floor(hh * 6)
  const f = hh * 6 - i
  const p = vv * (1 - ss)
  const q = vv * (1 - f * ss)
  const t = vv * (1 - (1 - f) * ss)
  let r = 0, g = 0, b = 0

  switch (i % 6) {
    case 0: r = vv; g = t;  b = p;  break
    case 1: r = q;  g = vv; b = p;  break
    case 2: r = p;  g = vv; b = t;  break
    case 3: r = p;  g = q;  b = vv; break
    case 4: r = t;  g = p;  b = vv; break
    case 5: r = vv; g = p;  b = q;  break
  }

  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)]
}

// ── RGB ↔ HWB ──────────────────────────────────────────────────────

export function rgbToHwb(r: number, g: number, b: number): [number, number, number] {
  const [h] = rgbToHsl(r, g, b)
  const w = Math.round((Math.min(r, g, b) / 255) * 100)
  const bk = Math.round((1 - Math.max(r, g, b) / 255) * 100)
  return [h, w, bk]
}

export function hwbToRgb(h: number, w: number, bk: number): [number, number, number] {
  const ww = w / 100
  const bb = bk / 100

  // Achromatic: whiteness + blackness >= 1
  if (ww + bb >= 1) {
    const gray = Math.round((ww / (ww + bb)) * 255)
    return [gray, gray, gray]
  }

  // Get pure hue at full saturation/value then mix with white and black
  const [rh, gh, bh] = hsvToRgb(h, 100, 100)
  const f = 1 - ww - bb
  return [
    Math.round((rh / 255) * f * 255 + ww * 255),
    Math.round((gh / 255) * f * 255 + ww * 255),
    Math.round((bh / 255) * f * 255 + ww * 255),
  ]
}

// ── RGB ↔ OKLCH ────────────────────────────────────────────────────
// Uses Björn Ottosson's Oklab matrices (https://bottosson.github.io/posts/oklab/)

function linearize(c: number): number {
  const s = c / 255
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
}

function delinearize(c: number): number {
  const cl = Math.max(0, c)
  return cl <= 0.0031308
    ? Math.round(cl * 12.92 * 255)
    : Math.round((1.055 * Math.pow(cl, 1 / 2.4) - 0.055) * 255)
}

/** Returns [L (0–1), C, H (deg 0–360)] */
export function rgbToOklch(r: number, g: number, b: number): [number, number, number] {
  const rl = linearize(r)
  const gl = linearize(g)
  const bl = linearize(b)

  // Linear sRGB → LMS (M1)
  const lms_l = 0.4122214708 * rl + 0.5363325363 * gl + 0.0514459929 * bl
  const lms_m = 0.2119034982 * rl + 0.6806995451 * gl + 0.1073969566 * bl
  const lms_s = 0.0883024619 * rl + 0.2817188376 * gl + 0.6299787005 * bl

  // Cube-root
  const l_ = Math.cbrt(lms_l)
  const m_ = Math.cbrt(lms_m)
  const s_ = Math.cbrt(lms_s)

  // LMS^1/3 → OKLab (M2)
  const L =  0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_
  const a =  1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_
  const bOk = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_

  // OKLab → OKLCH
  const C = Math.sqrt(a * a + bOk * bOk)
  let H = Math.atan2(bOk, a) * (180 / Math.PI)
  if (H < 0) H += 360

  return [L, C, H]
}

/** L is 0–1, C is chroma (~0–0.4 for sRGB), H is degrees 0–360 */
export function oklchToRgb(L: number, C: number, H: number): [number, number, number] {
  const hRad = H * (Math.PI / 180)
  const a = C * Math.cos(hRad)
  const bOk = C * Math.sin(hRad)

  // OKLab → LMS^1/3 (M2 inverse)
  const l_ = L + 0.3963377774 * a + 0.2158037573 * bOk
  const m_ = L - 0.1055613458 * a - 0.0638541728 * bOk
  const s_ = L - 0.0894841775 * a - 1.2914855480 * bOk

  // Cube
  const lms_l = l_ * l_ * l_
  const lms_m = m_ * m_ * m_
  const lms_s = s_ * s_ * s_

  // LMS → Linear sRGB (M1 inverse)
  const rl =  4.0767416621 * lms_l - 3.3077115913 * lms_m + 0.2309699292 * lms_s
  const gl = -1.2684380046 * lms_l + 2.6097574011 * lms_m - 0.3413193965 * lms_s
  const bl = -0.0041960863 * lms_l - 0.7034186147 * lms_m + 1.7076147010 * lms_s

  return [
    clamp(delinearize(rl), 0, 255),
    clamp(delinearize(gl), 0, 255),
    clamp(delinearize(bl), 0, 255),
  ]
}

// ── CMYK / Decimal ─────────────────────────────────────────────────

export function rgbToCmyk(r: number, g: number, b: number): [number, number, number, number] {
  const rr = r / 255
  const gg = g / 255
  const bb = b / 255
  const k = 1 - Math.max(rr, gg, bb)
  if (k >= 1) return [0, 0, 0, 100]
  return [
    Math.round(((1 - rr - k) / (1 - k)) * 100),
    Math.round(((1 - gg - k) / (1 - k)) * 100),
    Math.round(((1 - bb - k) / (1 - k)) * 100),
    Math.round(k * 100),
  ]
}

export function rgbToDecimal(r: number, g: number, b: number): number {
  return (r << 16) | (g << 8) | b
}

// ── Named colors ───────────────────────────────────────────────────

export const NAMED_COLORS: Record<string, string> = {
  black: '#000000', white: '#ffffff', red: '#ff0000', green: '#008000',
  blue: '#0000ff', yellow: '#ffff00', cyan: '#00ffff', magenta: '#ff00ff',
  silver: '#c0c0c0', gray: '#808080', grey: '#808080', maroon: '#800000',
  olive: '#808000', purple: '#800080', teal: '#008080', navy: '#000080',
  orange: '#ffa500', lime: '#00ff00', aqua: '#00ffff', fuchsia: '#ff00ff',
  aliceblue: '#f0f8ff', antiquewhite: '#faebd7', aquamarine: '#7fffd4',
  azure: '#f0ffff', beige: '#f5f5dc', bisque: '#ffe4c4',
  blanchedalmond: '#ffebcd', blueviolet: '#8a2be2', brown: '#a52a2a',
  burlywood: '#deb887', cadetblue: '#5f9ea0', chartreuse: '#7fff00',
  chocolate: '#d2691e', coral: '#ff7f50', cornflowerblue: '#6495ed',
  cornsilk: '#fff8dc', crimson: '#dc143c', darkblue: '#00008b',
  darkcyan: '#008b8b', darkgoldenrod: '#b8860b', darkgray: '#a9a9a9',
  darkgreen: '#006400', darkkhaki: '#bdb76b', darkmagenta: '#8b008b',
  darkolivegreen: '#556b2f', darkorange: '#ff8c00', darkorchid: '#9932cc',
  darkred: '#8b0000', darksalmon: '#e9967a', darkseagreen: '#8fbc8f',
  darkslateblue: '#483d8b', darkslategray: '#2f4f4f', darkturquoise: '#00ced1',
  darkviolet: '#9400d3', deeppink: '#ff1493', deepskyblue: '#00bfff',
  dimgray: '#696969', dodgerblue: '#1e90ff', firebrick: '#b22222',
  floralwhite: '#fffaf0', forestgreen: '#228b22', gainsboro: '#dcdcdc',
  ghostwhite: '#f8f8ff', gold: '#ffd700', goldenrod: '#daa520',
  greenyellow: '#adff2f', honeydew: '#f0fff0', hotpink: '#ff69b4',
  indianred: '#cd5c5c', indigo: '#4b0082', ivory: '#fffff0',
  khaki: '#f0e68c', lavender: '#e6e6fa', lavenderblush: '#fff0f5',
  lawngreen: '#7cfc00', lemonchiffon: '#fffacd', lightblue: '#add8e6',
  lightcoral: '#f08080', lightcyan: '#e0ffff',
  lightgoldenrodyellow: '#fafad2', lightgray: '#d3d3d3',
  lightgreen: '#90ee90', lightpink: '#ffb6c1', lightsalmon: '#ffa07a',
  lightseagreen: '#20b2aa', lightskyblue: '#87cefa',
  lightslategray: '#778899', lightsteelblue: '#b0c4de',
  lightyellow: '#ffffe0', limegreen: '#32cd32', linen: '#faf0e6',
  mediumaquamarine: '#66cdaa', mediumblue: '#0000cd',
  mediumorchid: '#ba55d3', mediumpurple: '#9370db',
  mediumseagreen: '#3cb371', mediumslateblue: '#7b68ee',
  mediumspringgreen: '#00fa9a', mediumturquoise: '#48d1cc',
  mediumvioletred: '#c71585', midnightblue: '#191970',
  mintcream: '#f5fffa', mistyrose: '#ffe4e1', moccasin: '#ffe4b5',
  navajowhite: '#ffdead', oldlace: '#fdf5e6', olivedrab: '#6b8e23',
  orangered: '#ff4500', orchid: '#da70d6', palegoldenrod: '#eee8aa',
  palegreen: '#98fb98', paleturquoise: '#afeeee', palevioletred: '#db7093',
  papayawhip: '#ffefd5', peachpuff: '#ffdab9', peru: '#cd853f',
  pink: '#ffc0cb', plum: '#dda0dd', powderblue: '#b0e0e6',
  rosybrown: '#bc8f8f', royalblue: '#4169e1', saddlebrown: '#8b4513',
  salmon: '#fa8072', sandybrown: '#f4a460', seagreen: '#2e8b57',
  seashell: '#fff5ee', sienna: '#a0522d', skyblue: '#87ceeb',
  slateblue: '#6a5acd', slategray: '#708090', snow: '#fffafa',
  springgreen: '#00ff7f', steelblue: '#4682b4', tan: '#d2b48c',
  thistle: '#d8bfd8', tomato: '#ff6347', turquoise: '#40e0d0',
  violet: '#ee82ee', wheat: '#f5deb3', yellowgreen: '#9acd32',
}

// ── Parse ──────────────────────────────────────────────────────────

export function parseColor(input: string): { color: RgbaColor; format: InputFormat } | null {
  const s = input.trim().toLowerCase()
  if (!s) return null

  // ── 1. Named CSS color ──────────────────────────────────────────
  const namedHex = NAMED_COLORS[s]
  if (namedHex) {
    return { color: parseHexStr(namedHex), format: 'named' }
  }

  // ── 2. CSS custom-property declaration  --name: value[;] ───────
  //    Strip the variable name and recursively parse the value,
  //    tagging the result as 'tw-var'.
  const cssVarM = s.match(/^--[\w-]+\s*:\s*(.+?)\s*;?\s*$/)
  if (cssVarM) {
    const inner = parseColor(cssVarM[1].trim())
    if (inner) return { color: inner.color, format: 'tw-var' }
    return null
  }

  // ── 3. Tailwind bracket / utility  [color] | bg-[color] ────────
  //    Matches bare [value] or any <utility>-[value], e.g. text-[#ff0000]
  const bracketBare    = s.match(/^\[(.+)\]$/)
  const bracketUtility = s.match(/^[\w-]+-\[(.+)\]$/)
  const bracketInner   = bracketBare?.[1] ?? bracketUtility?.[1]
  if (bracketInner != null) {
    const inner = parseColor(bracketInner.trim())
    if (inner) return { color: inner.color, format: 'tw-bracket' }
    return null
  }

  // ── 4. Hex  #rgb | #rrggbb | #rrggbbaa  (with or without #) ───
  const hexRaw = s.startsWith('#') ? s.slice(1) : s
  if (/^[0-9a-f]{3}$/.test(hexRaw)) {
    return {
      color: {
        r: parseInt(hexRaw[0] + hexRaw[0], 16),
        g: parseInt(hexRaw[1] + hexRaw[1], 16),
        b: parseInt(hexRaw[2] + hexRaw[2], 16),
        a: 1,
      },
      format: 'hex',
    }
  }
  if (/^[0-9a-f]{6}$/.test(hexRaw)) {
    return { color: parseHexStr('#' + hexRaw), format: 'hex' }
  }
  if (/^[0-9a-f]{8}$/.test(hexRaw)) {
    return {
      color: {
        r: parseInt(hexRaw.slice(0, 2), 16),
        g: parseInt(hexRaw.slice(2, 4), 16),
        b: parseInt(hexRaw.slice(4, 6), 16),
        a: parseInt(hexRaw.slice(6, 8), 16) / 255,
      },
      format: 'hex',
    }
  }

  // ── 5. oklch(L C H [/ alpha])  ─────────────────────────────────
  //    L may be "0.211" or "21.1%"; alpha may be "0.5" or "50%"
  const oklchM = s.match(
    /^oklch\(\s*([\d.]+%?)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+%?))?\s*\)$/,
  )
  if (oklchM) {
    const rawL = oklchM[1]
    const Lval = rawL.endsWith('%') ? parseFloat(rawL) / 100 : parseFloat(rawL)
    const C = parseFloat(oklchM[2])
    const H = parseFloat(oklchM[3])
    const [r, g, b] = oklchToRgb(clamp(Lval, 0, 1), C, H)
    return { color: { r, g, b, a: parseAlpha(oklchM[4]) }, format: 'oklch' }
  }

  // ── 6. hwb(H W% B% [/ alpha]) ──────────────────────────────────
  const hwbM = s.match(
    /^hwb\(\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%(?:\s*\/\s*([\d.]+%?))?\s*\)$/,
  )
  if (hwbM) {
    const [r, g, b] = hwbToRgb(
      clamp(parseFloat(hwbM[1]), 0, 360),
      clamp(parseFloat(hwbM[2]), 0, 100),
      clamp(parseFloat(hwbM[3]), 0, 100),
    )
    return { color: { r, g, b, a: parseAlpha(hwbM[4]) }, format: 'hwb' }
  }

  // ── 7. rgb/rgba  Level 3 (comma) ───────────────────────────────
  //    rgb(10, 17, 32) | rgba(10, 17, 32, 0.5)
  const rgbL3M = s.match(
    /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)$/,
  )
  if (rgbL3M) {
    return {
      color: {
        r: clamp(parseInt(rgbL3M[1]), 0, 255),
        g: clamp(parseInt(rgbL3M[2]), 0, 255),
        b: clamp(parseInt(rgbL3M[3]), 0, 255),
        a: rgbL3M[4] != null ? clamp(parseFloat(rgbL3M[4]), 0, 1) : 1,
      },
      format: 'rgb',
    }
  }

  // ── 8. rgb/rgba  Level 4 (space / slash) ───────────────────────
  //    rgb(10 17 32) | rgb(10 17 32 / 0.5) | rgb(10 17 32 / 50%)
  const rgbL4M = s.match(
    /^rgba?\(\s*(\d+)\s+(\d+)\s+(\d+)(?:\s*\/\s*([\d.]+%?))?\s*\)$/,
  )
  if (rgbL4M) {
    return {
      color: {
        r: clamp(parseInt(rgbL4M[1]), 0, 255),
        g: clamp(parseInt(rgbL4M[2]), 0, 255),
        b: clamp(parseInt(rgbL4M[3]), 0, 255),
        a: parseAlpha(rgbL4M[4]),
      },
      format: 'rgb-l4',
    }
  }

  // ── 9. hsl/hsla  Level 3 (comma) ───────────────────────────────
  //    hsl(221, 52%, 8%) | hsla(221, 52%, 8%, 0.5)
  const hslL3M = s.match(
    /^hsla?\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)%?\s*,\s*(\d+(?:\.\d+)?)%?(?:\s*,\s*([\d.]+))?\s*\)$/,
  )
  if (hslL3M) {
    const [r, g, b] = hslToRgb(
      clamp(parseFloat(hslL3M[1]), 0, 360),
      clamp(parseFloat(hslL3M[2]), 0, 100),
      clamp(parseFloat(hslL3M[3]), 0, 100),
    )
    return {
      color: { r, g, b, a: hslL3M[4] != null ? clamp(parseFloat(hslL3M[4]), 0, 1) : 1 },
      format: 'hsl',
    }
  }

  // ── 10. hsl/hsla  Level 4 (space / slash) ──────────────────────
  //    hsl(221 52% 8%) | hsl(221 52% 8% / 0.5) | hsl(221 52% 8% / 50%)
  const hslL4M = s.match(
    /^hsla?\(\s*(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)%\s+(\d+(?:\.\d+)?)%(?:\s*\/\s*([\d.]+%?))?\s*\)$/,
  )
  if (hslL4M) {
    const [r, g, b] = hslToRgb(
      clamp(parseFloat(hslL4M[1]), 0, 360),
      clamp(parseFloat(hslL4M[2]), 0, 100),
      clamp(parseFloat(hslL4M[3]), 0, 100),
    )
    return {
      color: { r, g, b, a: parseAlpha(hslL4M[4]) },
      format: 'hsl-l4',
    }
  }

  // ── 11. hsb/hsv (comma) ────────────────────────────────────────
  const hsbM = s.match(/^hs[bv]\(\s*(\d+)\s*,\s*(\d+)%?\s*,\s*(\d+)%?\s*\)$/)
  if (hsbM) {
    const [r, g, b] = hsvToRgb(
      clamp(parseInt(hsbM[1]), 0, 360),
      clamp(parseInt(hsbM[2]), 0, 100),
      clamp(parseInt(hsbM[3]), 0, 100),
    )
    return { color: { r, g, b, a: 1 }, format: 'hsb' }
  }

  // ── 12. cmyk(c%, m%, y%, k%) ───────────────────────────────────
  const cmykM = s.match(
    /^cmyk\(\s*(\d+)%?\s*,\s*(\d+)%?\s*,\s*(\d+)%?\s*,\s*(\d+)%?\s*\)$/,
  )
  if (cmykM) {
    const c = clamp(parseInt(cmykM[1]), 0, 100) / 100
    const m = clamp(parseInt(cmykM[2]), 0, 100) / 100
    const y = clamp(parseInt(cmykM[3]), 0, 100) / 100
    const k = clamp(parseInt(cmykM[4]), 0, 100) / 100
    return {
      color: {
        r: Math.round(255 * (1 - c) * (1 - k)),
        g: Math.round(255 * (1 - m) * (1 - k)),
        b: Math.round(255 * (1 - y) * (1 - k)),
        a: 1,
      },
      format: 'cmyk',
    }
  }

  // ── 13. Bare HSL triplet  "H S% L%"  (Tailwind v3 CSS-var value)
  //    Must have % on both S and L, space-separated, no parens.
  const hslRawM = s.match(
    /^(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)%\s+(\d+(?:\.\d+)?)%$/,
  )
  if (hslRawM) {
    const [r, g, b] = hslToRgb(
      clamp(parseFloat(hslRawM[1]), 0, 360),
      clamp(parseFloat(hslRawM[2]), 0, 100),
      clamp(parseFloat(hslRawM[3]), 0, 100),
    )
    return { color: { r, g, b, a: 1 }, format: 'hsl-raw' }
  }

  return null
}

function parseHexStr(hex: string): RgbaColor {
  const h = hex.replace('#', '')
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
    a: 1,
  }
}

// ── Formats ────────────────────────────────────────────────────────

export function generateFormats(color: RgbaColor): ColorFormats {
  const { r, g, b, a } = color
  const hex = rgbToHexStr(r, g, b)
  const [h, s, l] = rgbToHsl(r, g, b)
  const [hv, sv, v] = rgbToHsv(r, g, b)
  const [hwbH, hwbW, hwbB] = rgbToHwb(r, g, b)
  const [c, m, y, k] = rgbToCmyk(r, g, b)
  const [okL, okC, okH] = rgbToOklch(r, g, b)
  const aStr = a.toFixed(2)

  const okLPct = (okL * 100).toFixed(1)
  const okCStr = okC.toFixed(4)
  const okHStr = okH.toFixed(1)
  const oklchBase = `${okLPct}% ${okCStr} ${okHStr}`

  return {
    // Hex
    hex,
    hexUpper: hex.toUpperCase(),
    hex8: `${hex}${toHexByte(Math.round(a * 255))}`,
    // Decimal
    decimal: String(rgbToDecimal(r, g, b)),
    // RGB L3
    rgb:  `rgb(${r}, ${g}, ${b})`,
    rgba: `rgba(${r}, ${g}, ${b}, ${aStr})`,
    // RGB L4
    rgbL4:  `rgb(${r} ${g} ${b})`,
    rgbL4a: `rgb(${r} ${g} ${b} / ${aStr})`,
    // HSL L3
    hsl:  `hsl(${h}, ${s}%, ${l}%)`,
    hsla: `hsla(${h}, ${s}%, ${l}%, ${aStr})`,
    // HSL L4
    hslL4:  `hsl(${h} ${s}% ${l}%)`,
    hslL4a: `hsl(${h} ${s}% ${l}% / ${aStr})`,
    // Other colour models
    hsb:  `hsb(${hv}, ${sv}%, ${v}%)`,
    hwb:  `hwb(${hwbH} ${hwbW}% ${hwbB}%)`,
    hwba: `hwb(${hwbH} ${hwbW}% ${hwbB}% / ${aStr})`,
    oklch:  `oklch(${oklchBase})`,
    oklcha: `oklch(${oklchBase} / ${aStr})`,
    cmyk: `cmyk(${c}%, ${m}%, ${y}%, ${k}%)`,
    // CSS generic
    cssVar: `--color: ${hex};`,
    // Tailwind
    twHslRaw:   `${h} ${s}% ${l}%`,
    twCssVarV3: `--color: ${h} ${s}% ${l}%;`,
    twCssVarV4: `--color: oklch(${oklchBase});`,
    twBracket:  `[${hex}]`,
    twBgUtil:   `bg-[${hex}]`,
  }
}

// ── Palette ────────────────────────────────────────────────────────

export function generatePalette(color: RgbaColor): Array<{ hex: string; isBase: boolean }> {
  const { r, g, b } = color
  const baseHex = rgbToHexStr(r, g, b)
  const amounts = [-0.75, -0.55, -0.38, -0.22, -0.1, 0, 0.15, 0.32, 0.5, 0.67, 0.82]

  return amounts.map((amt) => {
    if (amt === 0) return { hex: baseHex, isBase: true }
    if (amt < 0) {
      const f = 1 + amt
      return {
        hex: rgbToHexStr(Math.round(r * f), Math.round(g * f), Math.round(b * f)),
        isBase: false,
      }
    }
    return {
      hex: rgbToHexStr(
        Math.round(r + (255 - r) * amt),
        Math.round(g + (255 - g) * amt),
        Math.round(b + (255 - b) * amt),
      ),
      isBase: false,
    }
  })
}

// ── Color Harmonies ────────────────────────────────────────────────

export type HarmonyType =
  | 'complementary'
  | 'split-complementary'
  | 'analogous'
  | 'triadic'
  | 'tetradic'
  | 'double-split'
  | 'monochromatic'

export interface HarmonyColor {
  hex: string
  label: string
  isBase: boolean
}

function shiftHue(h: number, s: number, l: number, degrees: number): string {
  const [r, g, b] = hslToRgb((h + degrees + 360) % 360, s, l)
  return rgbToHexStr(r, g, b)
}

export function generateHarmony(color: RgbaColor, type: HarmonyType): HarmonyColor[] {
  const [h, s, l] = rgbToHsl(color.r, color.g, color.b)
  const base = rgbToHexStr(color.r, color.g, color.b)

  switch (type) {
    case 'complementary':
      return [
        { hex: base,               label: 'Base',        isBase: true  },
        { hex: shiftHue(h,s,l,180), label: 'Complement',  isBase: false },
      ]

    case 'split-complementary':
      return [
        { hex: base,                label: 'Base',    isBase: true  },
        { hex: shiftHue(h,s,l,150), label: '+150°',   isBase: false },
        { hex: shiftHue(h,s,l,210), label: '+210°',   isBase: false },
      ]

    case 'analogous':
      return [
        { hex: shiftHue(h,s,l,-60), label: '−60°',   isBase: false },
        { hex: shiftHue(h,s,l,-30), label: '−30°',   isBase: false },
        { hex: base,                label: 'Base',    isBase: true  },
        { hex: shiftHue(h,s,l, 30), label: '+30°',   isBase: false },
        { hex: shiftHue(h,s,l, 60), label: '+60°',   isBase: false },
      ]

    case 'triadic':
      return [
        { hex: base,                label: 'Base',    isBase: true  },
        { hex: shiftHue(h,s,l,120), label: '+120°',  isBase: false },
        { hex: shiftHue(h,s,l,240), label: '+240°',  isBase: false },
      ]

    case 'tetradic':
      return [
        { hex: base,                label: 'Base',    isBase: true  },
        { hex: shiftHue(h,s,l, 90), label: '+90°',   isBase: false },
        { hex: shiftHue(h,s,l,180), label: '+180°',  isBase: false },
        { hex: shiftHue(h,s,l,270), label: '+270°',  isBase: false },
      ]

    case 'double-split':
      return [
        { hex: base,                label: 'Base',    isBase: true  },
        { hex: shiftHue(h,s,l, 30), label: '+30°',   isBase: false },
        { hex: shiftHue(h,s,l,150), label: '+150°',  isBase: false },
        { hex: shiftHue(h,s,l,180), label: '+180°',  isBase: false },
        { hex: shiftHue(h,s,l,210), label: '+210°',  isBase: false },
        { hex: shiftHue(h,s,l,330), label: '+330°',  isBase: false },
      ]

    case 'monochromatic': {
      const steps = [-30, -20, -10, 0, 10, 20, 30]
      return steps.map((dl) => {
        const newL = clamp(l + dl, 5, 95)
        const [r, g, b] = hslToRgb(h, s, newL)
        return {
          hex: rgbToHexStr(r, g, b),
          label: dl === 0 ? 'Base' : `L${dl > 0 ? '+' : ''}${dl}`,
          isBase: dl === 0,
        }
      })
    }
  }
}

export function getContrastColor(color: RgbaColor): 'white' | 'black' {
  const toLinear = (c: number): number => {
    const ss = c / 255
    return ss <= 0.04045 ? ss / 12.92 : Math.pow((ss + 0.055) / 1.055, 2.4)
  }
  const lum =
    0.2126 * toLinear(color.r) +
    0.7152 * toLinear(color.g) +
    0.0722 * toLinear(color.b)
  return lum > 0.179 ? 'black' : 'white'
}

// ── Color name lookup ──────────────────────────────────────────────

export function getColorName(color: RgbaColor): string | null {
  const hex = rgbToHexStr(color.r, color.g, color.b)
  return Object.entries(NAMED_COLORS).find(([, h]) => h === hex)?.[0] ?? null
}
