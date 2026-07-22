import { useState, useCallback, useEffect, useRef } from 'react'
import { Copy, Check, AlertCircle, Trash2 } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { cn } from '@/lib/utils'
import {
  parseColor,
  generateFormats,
  generatePalette,
  getContrastColor,
  rgbToHsl,
  hslToRgb,
  rgbToHsv,
  hsvToRgb,
  rgbToHexStr,
  clamp,
  type RgbaColor,
  type SliderMode,
  type InputFormat,
} from './logic'
import { useColorConverterStore } from './store'

// ── Constants ──────────────────────────────────────────────────────
const DEFAULT_COLOR: RgbaColor = { r: 10, g: 17, b: 32, a: 1 }

const FORMAT_LABELS: Record<InputFormat, string> = {
  hex:         'HEX',
  rgb:         'RGB',
  'rgb-l4':    'RGB L4',
  hsl:         'HSL',
  'hsl-l4':    'HSL L4',
  'hsl-raw':   'HSL Raw',
  hsb:         'HSB',
  hwb:         'HWB',
  oklch:       'OKLCH',
  cmyk:        'CMYK',
  named:       'Named',
  'tw-bracket':'TW Bracket',
  'tw-var':    'TW Var',
  unknown:     'Unknown',
}

// ── Slider track gradient helpers ──────────────────────────────────
function rgbChannelGradient(channel: 'r' | 'g' | 'b', color: RgbaColor): string {
  const { r, g, b } = color
  const from = channel === 'r' ? rgbToHexStr(0, g, b)   : channel === 'g' ? rgbToHexStr(r, 0, b)   : rgbToHexStr(r, g, 0)
  const to   = channel === 'r' ? rgbToHexStr(255, g, b) : channel === 'g' ? rgbToHexStr(r, 255, b) : rgbToHexStr(r, g, 255)
  return `linear-gradient(to right, ${from}, ${to})`
}

function hslChannelGradient(channel: 'h' | 's' | 'l', color: RgbaColor): string {
  const [h, s, l] = rgbToHsl(color.r, color.g, color.b)
  if (channel === 'h') {
    const stops = Array.from({ length: 7 }, (_, i) => rgbToHexStr(...hslToRgb(i * 60, s, l)))
    return `linear-gradient(to right, ${stops.join(', ')})`
  }
  if (channel === 's') {
    return `linear-gradient(to right, ${rgbToHexStr(...hslToRgb(h, 0, l))}, ${rgbToHexStr(...hslToRgb(h, 100, l))})`
  }
  return `linear-gradient(to right, #000000, ${rgbToHexStr(...hslToRgb(h, s, 50))}, #ffffff)`
}

function hsvChannelGradient(channel: 'h' | 's' | 'v', color: RgbaColor): string {
  const [h, s, v] = rgbToHsv(color.r, color.g, color.b)
  if (channel === 'h') {
    const stops = Array.from({ length: 7 }, (_, i) => rgbToHexStr(...hsvToRgb(i * 60, 100, 100)))
    return `linear-gradient(to right, ${stops.join(', ')})`
  }
  if (channel === 's') {
    return `linear-gradient(to right, ${rgbToHexStr(...hsvToRgb(h, 0, v))}, ${rgbToHexStr(...hsvToRgb(h, 100, v))})`
  }
  return `linear-gradient(to right, #000000, ${rgbToHexStr(...hsvToRgb(h, s, 100))})`
}

function alphaGradient(color: RgbaColor): string {
  return `linear-gradient(to right, transparent, ${rgbToHexStr(color.r, color.g, color.b)})`
}

// ── FancySlider ────────────────────────────────────────────────────
interface FancySliderProps {
  id?: string
  min: number
  max: number
  step?: number
  value: number
  onChange: (v: number) => void
  gradient: string
  label: string
  displayValue: string | number
  unit?: string
  checkerboard?: boolean
}

function FancySlider({
  id, min, max, step = 1, value, onChange,
  gradient, label, displayValue, unit = '', checkerboard = false,
}: FancySliderProps) {
  const pct = ((value - min) / (max - min)) * 100

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <Label htmlFor={id} className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          {label}
        </Label>
        <span className="text-xs font-mono font-semibold text-foreground tabular-nums">
          {displayValue}{unit}
        </span>
      </div>
      <div className="relative h-6 flex items-center">
        {/* Track */}
        <div
          className="absolute inset-x-0 h-3 rounded-full overflow-hidden"
          style={checkerboard ? {
            backgroundSize: '8px 8px',
            backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='8'%3E%3Crect width='4' height='4' fill='%23aaa'/%3E%3Crect x='4' y='4' width='4' height='4' fill='%23aaa'/%3E%3C/svg%3E")`,
          } : undefined}
        >
          <div className="absolute inset-0 rounded-full" style={{ background: gradient }} />
        </div>
        {/* Thumb */}
        <div
          className="absolute top-1/2 -translate-y-1/2 w-0.5 h-5 rounded-full bg-white shadow-md ring-1 ring-black/20 pointer-events-none z-10"
          style={{ left: `calc(${pct}% - 1px)` }}
        />
        <input
          id={id}
          type="range"
          min={min} max={max} step={step} value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
          style={{ touchAction: 'none' }}
        />
      </div>
    </div>
  )
}

// ── CopyRow ────────────────────────────────────────────────────────
interface CopyRowProps {
  label: string
  value: string
  highlight?: boolean
  labelWidth?: string
}

function CopyRow({ label, value, highlight = false, labelWidth = 'w-16' }: CopyRowProps) {
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch { /* silent */ }
  }

  return (
    <div
      className={cn(
        'group flex items-center gap-2 rounded-md px-3 py-2 transition-colors',
        highlight ? 'bg-primary/10 ring-1 ring-primary/30' : 'hover:bg-muted/60',
      )}
    >
      <span className={cn('shrink-0 text-xs font-medium text-muted-foreground uppercase tracking-wide', labelWidth)}>
        {label}
      </span>
      <span className="flex-1 min-w-0 font-mono text-sm truncate text-foreground">{value}</span>
      <button
        onClick={handleCopy}
        className={cn(
          'shrink-0 rounded p-1 transition-colors',
          copied
            ? 'text-green-500'
            : 'text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-foreground hover:bg-muted focus-visible:opacity-100',
        )}
        title={`Copy ${label}`}
        aria-label={`Copy ${label}`}
      >
        {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      </button>
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────
export default function ColorConverterPage() {
  const { inputValue, sliderMode, history, setInputValue, setSliderMode, addToHistory, clearHistory } = useColorConverterStore()

  const parseResult = parseColor(inputValue)
  const [color, setColor] = useState<RgbaColor>(parseResult?.color ?? DEFAULT_COLOR)
  const [detectedFormat, setDetectedFormat] = useState<InputFormat>(parseResult?.format ?? 'hex')
  const [inputError, setInputError] = useState(false)
  const lastValidInput = useRef(inputValue)

  // Sync on first load
  useEffect(() => {
    const res = parseColor(inputValue)
    if (res) {
      setColor(res.color)
      setDetectedFormat(res.format)
      setInputError(false)
      lastValidInput.current = inputValue
    } else if (inputValue.trim()) {
      setInputError(true)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleInputChange = useCallback(
    (raw: string) => {
      setInputValue(raw)
      if (!raw.trim()) { setInputError(false); return }
      const res = parseColor(raw)
      if (res) {
        setColor(res.color)
        setDetectedFormat(res.format)
        setInputError(false)
        lastValidInput.current = raw
      } else {
        setInputError(true)
      }
    },
    [setInputValue],
  )

  // Commits the current valid color to history (Enter or blur on text input only)
  const commitCurrentColor = useCallback(() => {
    if (!inputError && inputValue.trim()) {
      addToHistory(rgbToHexStr(color.r, color.g, color.b))
    }
  }, [inputError, inputValue, color, addToHistory])

  const updateColorFromSliders = useCallback(
    (newColor: RgbaColor) => {
      setColor(newColor)
      const hex = rgbToHexStr(newColor.r, newColor.g, newColor.b)
      const val = newColor.a < 1
        ? `rgb(${newColor.r} ${newColor.g} ${newColor.b} / ${newColor.a.toFixed(2)})`
        : hex
      setInputValue(val)
      setDetectedFormat(newColor.a < 1 ? 'rgb-l4' : 'hex')
      setInputError(false)
    },
    [setInputValue],
  )

  // Derived
  const formats = generateFormats(color)
  const palette = generatePalette(color)
  const contrastColor = getContrastColor(color)
  const [h, s, l] = rgbToHsl(color.r, color.g, color.b)
  const [hv, sv, v] = rgbToHsv(color.r, color.g, color.b)
  const swatchBg = color.a < 1
    ? `rgba(${color.r}, ${color.g}, ${color.b}, ${color.a})`
    : rgbToHexStr(color.r, color.g, color.b)

  // Copy all
  const [copiedAll, setCopiedAll] = useState(false)
  async function handleCopyAll() {
    const lines = [
      `HEX:        ${formats.hex}`,
      `HEX8:       ${formats.hex8}`,
      `RGB:        ${formats.rgb}`,
      `RGBA:       ${formats.rgba}`,
      `RGB L4:     ${formats.rgbL4}`,
      `RGB L4+α:   ${formats.rgbL4a}`,
      `HSL:        ${formats.hsl}`,
      `HSLA:       ${formats.hsla}`,
      `HSL L4:     ${formats.hslL4}`,
      `HSL L4+α:   ${formats.hslL4a}`,
      `HSB:        ${formats.hsb}`,
      `HWB:        ${formats.hwb}`,
      `OKLCH:      ${formats.oklch}`,
      `CMYK:       ${formats.cmyk}`,
      `CSS var:    ${formats.cssVar}`,
      `Decimal:    ${formats.decimal}`,
    ]
    await navigator.clipboard.writeText(lines.join('\n'))
    setCopiedAll(true)
    setTimeout(() => setCopiedAll(false), 2000)
  }

  // ── Format table rows ─────────────────────────────────────────────
  const universalRows: Array<{ label: string; key: keyof typeof formats }> = [
    { label: 'HEX',      key: 'hex' },
    { label: 'HEX ↑',   key: 'hexUpper' },
    { label: 'HEX 8',   key: 'hex8' },
    { label: 'DEC',      key: 'decimal' },
    { label: 'RGB',      key: 'rgb' },
    { label: 'RGBA',     key: 'rgba' },
    { label: 'RGB L4',   key: 'rgbL4' },
    { label: 'RGB L4 α', key: 'rgbL4a' },
    { label: 'HSL',      key: 'hsl' },
    { label: 'HSLA',     key: 'hsla' },
    { label: 'HSL L4',   key: 'hslL4' },
    { label: 'HSL L4 α', key: 'hslL4a' },
    { label: 'HSB',      key: 'hsb' },
    { label: 'HWB',      key: 'hwb' },
    { label: 'HWB α',    key: 'hwba' },
    { label: 'OKLCH',    key: 'oklch' },
    { label: 'OKLCH α',  key: 'oklcha' },
    { label: 'CMYK',     key: 'cmyk' },
    { label: 'CSS Var',  key: 'cssVar' },
  ]

  const twRows: Array<{ label: string; key: keyof typeof formats; desc: string }> = [
    { label: 'HSL Raw',   key: 'twHslRaw',   desc: 'v3 CSS-var value' },
    { label: 'Var v3',    key: 'twCssVarV3', desc: 'v3 custom property' },
    { label: 'Var v4',    key: 'twCssVarV4', desc: 'v4 oklch custom property' },
    { label: 'Bracket',   key: 'twBracket',  desc: 'arbitrary value' },
    { label: 'Utility',   key: 'twBgUtil',   desc: 'bg utility class' },
  ]

  return (
    <div className="mx-auto max-w-2xl space-y-5 px-4 py-8">

      {/* ── Header ────────────────────────────────────────────────── */}
      <div>
        <h1 className="text-2xl font-bold">Color Converter</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Paste any color — HEX, RGB, HSL, HWB, OKLCH, CMYK, CSS name, or Tailwind notation.
        </p>
      </div>

      {/* ── Input + swatch ────────────────────────────────────────── */}
      <Card>
        <CardContent className="pt-5 pb-5 space-y-3">
          <div className="flex items-center gap-3">
            {/* Live swatch dot */}
            <div className="relative shrink-0 h-11 w-11 rounded-xl border border-border overflow-hidden shadow-sm">
              <div
                className="absolute inset-0"
                style={{
                  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='8'%3E%3Crect width='4' height='4' fill='%23ccc'/%3E%3Crect x='4' y='4' width='4' height='4' fill='%23ccc'/%3E%3C/svg%3E")`,
                  backgroundSize: '8px 8px',
                }}
              />
              <div className="absolute inset-0" style={{ backgroundColor: swatchBg }} />
            </div>
            {/* Input */}
            <div className="flex-1 min-w-0">
              <input
                type="text"
                value={inputValue}
                onChange={(e) => handleInputChange(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') commitCurrentColor() }}
                onBlur={commitCurrentColor}
                spellCheck={false}
                placeholder="#0a1120 · hsl(221 52% 8%) · oklch(…) · navy"
                className={cn(
                  'w-full rounded-md border bg-background px-3 py-2.5 font-mono text-sm shadow-sm',
                  'focus:outline-none focus:ring-2 focus:ring-ring',
                  'placeholder:text-muted-foreground/50 text-foreground transition-colors',
                  inputError ? 'border-red-400 focus:ring-red-400/50' : 'border-input',
                )}
              />
            </div>
          </div>

          {/* Status row */}
          <div className="flex items-center gap-2 min-h-[1.25rem]">
            {inputError ? (
              <span className="flex items-center gap-1.5 text-xs text-red-500">
                <AlertCircle className="h-3.5 w-3.5" />
                Unrecognised format
              </span>
            ) : (
              <>
                <span className="inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary ring-1 ring-primary/20">
                  {FORMAT_LABELS[detectedFormat]}
                </span>
                <span className="text-xs text-muted-foreground truncate font-mono">
                  {formats.hex}
                </span>
              </>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ── Preview swatch ────────────────────────────────────────── */}
      <Card className="overflow-hidden">
        <div className="relative h-28 sm:h-36">
          <div
            className="absolute inset-0"
            style={{
              backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12'%3E%3Crect width='6' height='6' fill='%23e0e0e0'/%3E%3Crect x='6' y='6' width='6' height='6' fill='%23e0e0e0'/%3E%3Crect x='6' width='6' height='6' fill='%23f5f5f5'/%3E%3Crect y='6' width='6' height='6' fill='%23f5f5f5'/%3E%3C/svg%3E")`,
            }}
          />
          <div className="absolute inset-0" style={{ backgroundColor: swatchBg }} />
          <div className="absolute inset-0 flex items-center justify-between px-5">
            <div className={cn('space-y-0.5', contrastColor === 'white' ? 'text-white' : 'text-black')}>
              <div className="text-2xl font-bold tracking-tight font-mono">{formats.hex}</div>
              <div className="text-xs opacity-75">{formats.rgb}</div>
              <div className="text-xs opacity-75">{formats.hsl}</div>
            </div>
            <div className={cn('flex flex-col items-end gap-1', contrastColor === 'white' ? 'text-white' : 'text-black')}>
              <span className="text-3xl font-bold opacity-60 select-none leading-none">Aa</span>
              <span className="text-xs opacity-50">
                {contrastColor === 'white' ? 'Light text' : 'Dark text'}
              </span>
            </div>
          </div>
        </div>
      </Card>

      {/* ── Sliders ───────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Adjust</CardTitle>
            <ToggleGroup
              type="single"
              value={sliderMode}
              onValueChange={(val) => { if (val) setSliderMode(val as SliderMode) }}
              className="gap-1"
            >
              {(['rgb', 'hsl', 'hsv'] as SliderMode[]).map((m) => (
                <ToggleGroupItem key={m} value={m} className="px-2.5 py-1 text-xs h-7 uppercase">
                  {m}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>
        </CardHeader>
        <CardContent className="space-y-4 pt-0">

          {sliderMode === 'rgb' && (
            <>
              <FancySlider id="s-r" min={0} max={255} value={color.r} label="R" displayValue={color.r}
                gradient={rgbChannelGradient('r', color)} onChange={(r) => updateColorFromSliders({ ...color, r })} />
              <FancySlider id="s-g" min={0} max={255} value={color.g} label="G" displayValue={color.g}
                gradient={rgbChannelGradient('g', color)} onChange={(g) => updateColorFromSliders({ ...color, g })} />
              <FancySlider id="s-b" min={0} max={255} value={color.b} label="B" displayValue={color.b}
                gradient={rgbChannelGradient('b', color)} onChange={(b) => updateColorFromSliders({ ...color, b })} />
            </>
          )}

          {sliderMode === 'hsl' && (
            <>
              <FancySlider id="s-h" min={0} max={360} value={h} label="H" displayValue={h} unit="°"
                gradient={hslChannelGradient('h', color)}
                onChange={(nh) => { const [r, g, b] = hslToRgb(nh, s, l); updateColorFromSliders({ ...color, r, g, b }) }} />
              <FancySlider id="s-s" min={0} max={100} value={s} label="S" displayValue={s} unit="%"
                gradient={hslChannelGradient('s', color)}
                onChange={(ns) => { const [r, g, b] = hslToRgb(h, ns, l); updateColorFromSliders({ ...color, r, g, b }) }} />
              <FancySlider id="s-l" min={0} max={100} value={l} label="L" displayValue={l} unit="%"
                gradient={hslChannelGradient('l', color)}
                onChange={(nl) => { const [r, g, b] = hslToRgb(h, s, nl); updateColorFromSliders({ ...color, r, g, b }) }} />
            </>
          )}

          {sliderMode === 'hsv' && (
            <>
              <FancySlider id="s-hv" min={0} max={360} value={hv} label="H" displayValue={hv} unit="°"
                gradient={hsvChannelGradient('h', color)}
                onChange={(nh) => { const [r, g, b] = hsvToRgb(nh, sv, v); updateColorFromSliders({ ...color, r, g, b }) }} />
              <FancySlider id="s-sv" min={0} max={100} value={sv} label="S" displayValue={sv} unit="%"
                gradient={hsvChannelGradient('s', color)}
                onChange={(ns) => { const [r, g, b] = hsvToRgb(hv, ns, v); updateColorFromSliders({ ...color, r, g, b }) }} />
              <FancySlider id="s-v" min={0} max={100} value={v} label="V" displayValue={v} unit="%"
                gradient={hsvChannelGradient('v', color)}
                onChange={(nv) => { const [r, g, b] = hsvToRgb(hv, sv, nv); updateColorFromSliders({ ...color, r, g, b }) }} />
            </>
          )}

          {/* Alpha — always visible */}
          <div className="border-t pt-4">
            <FancySlider
              id="s-a" min={0} max={100} step={1}
              value={Math.round(color.a * 100)} label="Alpha"
              displayValue={Math.round(color.a * 100)} unit="%" checkerboard
              gradient={alphaGradient(color)}
              onChange={(val) => updateColorFromSliders({ ...color, a: clamp(val / 100, 0, 1) })}
            />
          </div>
        </CardContent>
      </Card>

      {/* ── Shades & Tints ────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Shades &amp; Tints</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            {palette.map(({ hex, isBase }, i) => (
              <button
                key={i}
                title={hex}
                onClick={() => handleInputChange(hex)}
                className={cn(
                  'relative shrink-0 rounded-lg transition-all hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  isBase ? 'h-12 w-12 ring-2 ring-primary ring-offset-2 ring-offset-card scale-105' : 'h-10 w-10',
                )}
                style={{ backgroundColor: hex }}
                aria-label={`Select ${hex}`}
              >
                {isBase && (
                  <span className="absolute inset-0 flex items-center justify-center">
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{
                        backgroundColor: getContrastColor(parseColor(hex)?.color ?? DEFAULT_COLOR) === 'white'
                          ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.4)',
                      }}
                    />
                  </span>
                )}
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">Click a swatch to select it</p>
        </CardContent>
      </Card>

      {/* ── History ───────────────────────────────────────────────── */}
      {history.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">History</CardTitle>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1.5 text-xs text-muted-foreground hover:text-destructive"
                onClick={clearHistory}
                aria-label="Clear history"
              >
                <Trash2 className="h-3 w-3" />
                Clear
              </Button>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="flex flex-wrap gap-1.5">
              {history.map((hex, i) => {
                const isActive = hex === formats.hex
                const c = parseColor(hex)?.color ?? DEFAULT_COLOR
                return (
                  <button
                    key={`${hex}-${i}`}
                    title={hex}
                    onClick={() => handleInputChange(hex)}
                    className={cn(
                      'h-8 w-8 rounded-lg shrink-0 transition-all hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      isActive
                        ? 'ring-2 ring-primary ring-offset-2 ring-offset-card scale-105'
                        : 'ring-1 ring-black/10 dark:ring-white/10',
                    )}
                    style={{ backgroundColor: hex }}
                    aria-label={`Restore ${hex}`}
                  >
                    {isActive && (
                      <span className="flex h-full w-full items-center justify-center">
                        <span
                          className="h-1.5 w-1.5 rounded-full"
                          style={{
                            backgroundColor:
                              getContrastColor(c) === 'white'
                                ? 'rgba(255,255,255,0.7)'
                                : 'rgba(0,0,0,0.4)',
                          }}
                        />
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Last {history.length} color{history.length !== 1 ? 's' : ''} · click to restore
            </p>
          </CardContent>
        </Card>
      )}

      {/* ── All Formats ───────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">All Formats</CardTitle>
            <Button variant="ghost" size="sm" className="h-7 gap-1.5 text-xs" onClick={handleCopyAll}>
              {copiedAll
                ? <><Check className="h-3 w-3 text-green-500" /><span className="text-green-500">Copied!</span></>
                : <><Copy className="h-3 w-3" />Copy all</>}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="pt-0 space-y-0.5">
          {universalRows.map(({ label, key }) => (
            <CopyRow key={key} label={label} value={formats[key]} labelWidth="w-20" />
          ))}
        </CardContent>
      </Card>

      {/* ── Tailwind ──────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center gap-2">
            <CardTitle className="text-base">Tailwind</CardTitle>
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground font-medium">
              v3 + v4
            </span>
          </div>
        </CardHeader>
        <CardContent className="pt-0 space-y-0.5">
          {twRows.map(({ label, key, desc }) => (
            <div key={key} className="group flex items-center gap-2 rounded-md px-3 py-2 hover:bg-muted/60 transition-colors">
              <div className="w-20 shrink-0">
                <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{label}</div>
                <div className="text-xs text-muted-foreground/60 leading-none mt-0.5">{desc}</div>
              </div>
              <span className="flex-1 min-w-0 font-mono text-sm truncate text-foreground">{formats[key]}</span>
              <CopyIconButton value={formats[key]} label={label} />
            </div>
          ))}
        </CardContent>
      </Card>

      {/* ── Quick picks ───────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Try These</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="flex flex-wrap gap-2">
            {[
              { label: 'Crimson',  value: '#dc143c' },
              { label: 'Sky',      value: '#0ea5e9' },
              { label: 'Emerald',  value: '#10b981' },
              { label: 'Amber',    value: '#f59e0b' },
              { label: 'Violet',   value: '#7c3aed' },
              { label: 'Rose',     value: '#f43f5e' },
              { label: 'Slate',    value: '#475569' },
              { label: 'Navy',     value: '#0a1120' },
            ].map(({ label, value }) => {
              const c = parseColor(value)?.color ?? DEFAULT_COLOR
              const contrast = getContrastColor(c)
              return (
                <button
                  key={value}
                  onClick={() => handleInputChange(value)}
                  className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-all hover:scale-105 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  style={{ backgroundColor: value, color: contrast === 'white' ? '#fff' : '#000' }}
                >
                  {label}
                </button>
              )
            })}
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Also try: <code className="font-mono">hsl(221 52% 8%)</code> · <code className="font-mono">--bg: 220 45% 10%</code> · <code className="font-mono">bg-[#0a1120]</code> · <code className="font-mono">oklch(0.21 0.048 221)</code>
          </p>
        </CardContent>
      </Card>

    </div>
  )
}

// ── Standalone copy icon (used in TW rows) ─────────────────────────
function CopyIconButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false)
  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch { /* silent */ }
  }
  return (
    <button
      onClick={handleCopy}
      className={cn(
        'shrink-0 rounded p-1 transition-colors',
        copied
          ? 'text-green-500'
          : 'text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-foreground hover:bg-muted focus-visible:opacity-100',
      )}
      title={`Copy ${label}`}
      aria-label={`Copy ${label}`}
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  )
}
