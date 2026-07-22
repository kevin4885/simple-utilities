import { useState, useCallback, useEffect, useRef } from 'react'
import { Copy, Check, AlertCircle, Trash2 } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { cn } from '@/lib/utils'
import {
  parseColor,
  generateFormats,
  generatePalette,
  generateHarmony,
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
  type HarmonyType,
} from './logic'
import { useColorConverterStore } from './store'

// ── Constants ──────────────────────────────────────────────────────
const DEFAULT_COLOR: RgbaColor = { r: 10, g: 17, b: 32, a: 1 }

// Tailwind v4 default palette — one representative hex per shade step
// Converted from the official OKLCH values
const TW_PALETTE: Array<{ name: string; shades: Array<{ shade: number; hex: string }> }> = [
  { name: 'red',     shades: [{ shade:50,hex:'#fef2f2' },{ shade:100,hex:'#fee2e2' },{ shade:200,hex:'#fecaca' },{ shade:300,hex:'#fca5a5' },{ shade:400,hex:'#f87171' },{ shade:500,hex:'#ef4444' },{ shade:600,hex:'#dc2626' },{ shade:700,hex:'#b91c1c' },{ shade:800,hex:'#991b1b' },{ shade:900,hex:'#7f1d1d' },{ shade:950,hex:'#450a0a' }] },
  { name: 'orange',  shades: [{ shade:50,hex:'#fff7ed' },{ shade:100,hex:'#ffedd5' },{ shade:200,hex:'#fed7aa' },{ shade:300,hex:'#fdba74' },{ shade:400,hex:'#fb923c' },{ shade:500,hex:'#f97316' },{ shade:600,hex:'#ea580c' },{ shade:700,hex:'#c2410c' },{ shade:800,hex:'#9a3412' },{ shade:900,hex:'#7c2d12' },{ shade:950,hex:'#431407' }] },
  { name: 'amber',   shades: [{ shade:50,hex:'#fffbeb' },{ shade:100,hex:'#fef3c7' },{ shade:200,hex:'#fde68a' },{ shade:300,hex:'#fcd34d' },{ shade:400,hex:'#fbbf24' },{ shade:500,hex:'#f59e0b' },{ shade:600,hex:'#d97706' },{ shade:700,hex:'#b45309' },{ shade:800,hex:'#92400e' },{ shade:900,hex:'#78350f' },{ shade:950,hex:'#451a03' }] },
  { name: 'yellow',  shades: [{ shade:50,hex:'#fefce8' },{ shade:100,hex:'#fef9c3' },{ shade:200,hex:'#fef08a' },{ shade:300,hex:'#fde047' },{ shade:400,hex:'#facc15' },{ shade:500,hex:'#eab308' },{ shade:600,hex:'#ca8a04' },{ shade:700,hex:'#a16207' },{ shade:800,hex:'#854d0e' },{ shade:900,hex:'#713f12' },{ shade:950,hex:'#422006' }] },
  { name: 'lime',    shades: [{ shade:50,hex:'#f7fee7' },{ shade:100,hex:'#ecfccb' },{ shade:200,hex:'#d9f99d' },{ shade:300,hex:'#bef264' },{ shade:400,hex:'#a3e635' },{ shade:500,hex:'#84cc16' },{ shade:600,hex:'#65a30d' },{ shade:700,hex:'#4d7c0f' },{ shade:800,hex:'#3f6212' },{ shade:900,hex:'#365314' },{ shade:950,hex:'#1a2e05' }] },
  { name: 'green',   shades: [{ shade:50,hex:'#f0fdf4' },{ shade:100,hex:'#dcfce7' },{ shade:200,hex:'#bbf7d0' },{ shade:300,hex:'#86efac' },{ shade:400,hex:'#4ade80' },{ shade:500,hex:'#22c55e' },{ shade:600,hex:'#16a34a' },{ shade:700,hex:'#15803d' },{ shade:800,hex:'#166534' },{ shade:900,hex:'#14532d' },{ shade:950,hex:'#052e16' }] },
  { name: 'emerald', shades: [{ shade:50,hex:'#ecfdf5' },{ shade:100,hex:'#d1fae5' },{ shade:200,hex:'#a7f3d0' },{ shade:300,hex:'#6ee7b7' },{ shade:400,hex:'#34d399' },{ shade:500,hex:'#10b981' },{ shade:600,hex:'#059669' },{ shade:700,hex:'#047857' },{ shade:800,hex:'#065f46' },{ shade:900,hex:'#064e3b' },{ shade:950,hex:'#022c22' }] },
  { name: 'teal',    shades: [{ shade:50,hex:'#f0fdfa' },{ shade:100,hex:'#ccfbf1' },{ shade:200,hex:'#99f6e4' },{ shade:300,hex:'#5eead4' },{ shade:400,hex:'#2dd4bf' },{ shade:500,hex:'#14b8a6' },{ shade:600,hex:'#0d9488' },{ shade:700,hex:'#0f766e' },{ shade:800,hex:'#115e59' },{ shade:900,hex:'#134e4a' },{ shade:950,hex:'#042f2e' }] },
  { name: 'cyan',    shades: [{ shade:50,hex:'#ecfeff' },{ shade:100,hex:'#cffafe' },{ shade:200,hex:'#a5f3fc' },{ shade:300,hex:'#67e8f9' },{ shade:400,hex:'#22d3ee' },{ shade:500,hex:'#06b6d4' },{ shade:600,hex:'#0891b2' },{ shade:700,hex:'#0e7490' },{ shade:800,hex:'#155e75' },{ shade:900,hex:'#164e63' },{ shade:950,hex:'#083344' }] },
  { name: 'sky',     shades: [{ shade:50,hex:'#f0f9ff' },{ shade:100,hex:'#e0f2fe' },{ shade:200,hex:'#bae6fd' },{ shade:300,hex:'#7dd3fc' },{ shade:400,hex:'#38bdf8' },{ shade:500,hex:'#0ea5e9' },{ shade:600,hex:'#0284c7' },{ shade:700,hex:'#0369a1' },{ shade:800,hex:'#075985' },{ shade:900,hex:'#0c4a6e' },{ shade:950,hex:'#082f49' }] },
  { name: 'blue',    shades: [{ shade:50,hex:'#eff6ff' },{ shade:100,hex:'#dbeafe' },{ shade:200,hex:'#bfdbfe' },{ shade:300,hex:'#93c5fd' },{ shade:400,hex:'#60a5fa' },{ shade:500,hex:'#3b82f6' },{ shade:600,hex:'#2563eb' },{ shade:700,hex:'#1d4ed8' },{ shade:800,hex:'#1e40af' },{ shade:900,hex:'#1e3a8a' },{ shade:950,hex:'#172554' }] },
  { name: 'indigo',  shades: [{ shade:50,hex:'#eef2ff' },{ shade:100,hex:'#e0e7ff' },{ shade:200,hex:'#c7d2fe' },{ shade:300,hex:'#a5b4fc' },{ shade:400,hex:'#818cf8' },{ shade:500,hex:'#6366f1' },{ shade:600,hex:'#4f46e5' },{ shade:700,hex:'#4338ca' },{ shade:800,hex:'#3730a3' },{ shade:900,hex:'#312e81' },{ shade:950,hex:'#1e1b4b' }] },
  { name: 'violet',  shades: [{ shade:50,hex:'#f5f3ff' },{ shade:100,hex:'#ede9fe' },{ shade:200,hex:'#ddd6fe' },{ shade:300,hex:'#c4b5fd' },{ shade:400,hex:'#a78bfa' },{ shade:500,hex:'#8b5cf6' },{ shade:600,hex:'#7c3aed' },{ shade:700,hex:'#6d28d9' },{ shade:800,hex:'#5b21b6' },{ shade:900,hex:'#4c1d95' },{ shade:950,hex:'#2e1065' }] },
  { name: 'purple',  shades: [{ shade:50,hex:'#faf5ff' },{ shade:100,hex:'#f3e8ff' },{ shade:200,hex:'#e9d5ff' },{ shade:300,hex:'#d8b4fe' },{ shade:400,hex:'#c084fc' },{ shade:500,hex:'#a855f7' },{ shade:600,hex:'#9333ea' },{ shade:700,hex:'#7e22ce' },{ shade:800,hex:'#6b21a8' },{ shade:900,hex:'#581c87' },{ shade:950,hex:'#3b0764' }] },
  { name: 'fuchsia', shades: [{ shade:50,hex:'#fdf4ff' },{ shade:100,hex:'#fae8ff' },{ shade:200,hex:'#f5d0fe' },{ shade:300,hex:'#f0abfc' },{ shade:400,hex:'#e879f9' },{ shade:500,hex:'#d946ef' },{ shade:600,hex:'#c026d3' },{ shade:700,hex:'#a21caf' },{ shade:800,hex:'#86198f' },{ shade:900,hex:'#701a75' },{ shade:950,hex:'#4a044e' }] },
  { name: 'pink',    shades: [{ shade:50,hex:'#fdf2f8' },{ shade:100,hex:'#fce7f3' },{ shade:200,hex:'#fbcfe8' },{ shade:300,hex:'#f9a8d4' },{ shade:400,hex:'#f472b6' },{ shade:500,hex:'#ec4899' },{ shade:600,hex:'#db2777' },{ shade:700,hex:'#be185d' },{ shade:800,hex:'#9d174d' },{ shade:900,hex:'#831843' },{ shade:950,hex:'#500724' }] },
  { name: 'rose',    shades: [{ shade:50,hex:'#fff1f2' },{ shade:100,hex:'#ffe4e6' },{ shade:200,hex:'#fecdd3' },{ shade:300,hex:'#fda4af' },{ shade:400,hex:'#fb7185' },{ shade:500,hex:'#f43f5e' },{ shade:600,hex:'#e11d48' },{ shade:700,hex:'#be123c' },{ shade:800,hex:'#9f1239' },{ shade:900,hex:'#881337' },{ shade:950,hex:'#4c0519' }] },
  { name: 'slate',   shades: [{ shade:50,hex:'#f8fafc' },{ shade:100,hex:'#f1f5f9' },{ shade:200,hex:'#e2e8f0' },{ shade:300,hex:'#cbd5e1' },{ shade:400,hex:'#94a3b8' },{ shade:500,hex:'#64748b' },{ shade:600,hex:'#475569' },{ shade:700,hex:'#334155' },{ shade:800,hex:'#1e293b' },{ shade:900,hex:'#0f172a' },{ shade:950,hex:'#020617' }] },
  { name: 'gray',    shades: [{ shade:50,hex:'#f9fafb' },{ shade:100,hex:'#f3f4f6' },{ shade:200,hex:'#e5e7eb' },{ shade:300,hex:'#d1d5db' },{ shade:400,hex:'#9ca3af' },{ shade:500,hex:'#6b7280' },{ shade:600,hex:'#4b5563' },{ shade:700,hex:'#374151' },{ shade:800,hex:'#1f2937' },{ shade:900,hex:'#111827' },{ shade:950,hex:'#030712' }] },
  { name: 'zinc',    shades: [{ shade:50,hex:'#fafafa' },{ shade:100,hex:'#f4f4f5' },{ shade:200,hex:'#e4e4e7' },{ shade:300,hex:'#d4d4d8' },{ shade:400,hex:'#a1a1aa' },{ shade:500,hex:'#71717a' },{ shade:600,hex:'#52525b' },{ shade:700,hex:'#3f3f46' },{ shade:800,hex:'#27272a' },{ shade:900,hex:'#18181b' },{ shade:950,hex:'#09090b' }] },
  { name: 'neutral', shades: [{ shade:50,hex:'#fafafa' },{ shade:100,hex:'#f5f5f5' },{ shade:200,hex:'#e5e5e5' },{ shade:300,hex:'#d4d4d4' },{ shade:400,hex:'#a3a3a3' },{ shade:500,hex:'#737373' },{ shade:600,hex:'#525252' },{ shade:700,hex:'#404040' },{ shade:800,hex:'#262626' },{ shade:900,hex:'#171717' },{ shade:950,hex:'#0a0a0a' }] },
  { name: 'stone',   shades: [{ shade:50,hex:'#fafaf9' },{ shade:100,hex:'#f5f5f4' },{ shade:200,hex:'#e7e5e4' },{ shade:300,hex:'#d6d3d1' },{ shade:400,hex:'#a8a29e' },{ shade:500,hex:'#78716c' },{ shade:600,hex:'#57534e' },{ shade:700,hex:'#44403c' },{ shade:800,hex:'#292524' },{ shade:900,hex:'#1c1917' },{ shade:950,hex:'#0c0a09' }] },
]

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

  // committedColor = the last accepted color (what input field + history reflect)
  const [committedColor, setCommittedColor] = useState<RgbaColor>(parseResult?.color ?? DEFAULT_COLOR)
  // color = live preview (may differ from committedColor while user is exploring)
  const [color, setColor] = useState<RgbaColor>(parseResult?.color ?? DEFAULT_COLOR)
  const [detectedFormat, setDetectedFormat] = useState<InputFormat>(parseResult?.format ?? 'hex')
  const [inputError, setInputError] = useState(false)
  const lastValidInput = useRef(inputValue)

  // Whether the user is in a pending/preview state (slider or shade tweak not yet accepted)
  const isPending = rgbToHexStr(color.r, color.g, color.b) !== rgbToHexStr(committedColor.r, committedColor.g, committedColor.b)
    || color.a !== committedColor.a

  // Confirm dialog state — holds the raw value the user tried to navigate to
  const [confirmPending, setConfirmPending] = useState<string | null>(null)

  // Sync on first load
  useEffect(() => {
    const res = parseColor(inputValue)
    if (res) {
      setColor(res.color)
      setCommittedColor(res.color)
      setDetectedFormat(res.format)
      setInputError(false)
      lastValidInput.current = inputValue
    } else if (inputValue.trim()) {
      setInputError(true)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Core commit — updates both color states, input, and history
  const commitRaw = useCallback(
    (raw: string) => {
      setInputValue(raw)
      if (!raw.trim()) { setInputError(false); return }
      const res = parseColor(raw)
      if (res) {
        setColor(res.color)
        setCommittedColor(res.color)
        setDetectedFormat(res.format)
        setInputError(false)
        lastValidInput.current = raw
        addToHistory(rgbToHexStr(res.color.r, res.color.g, res.color.b))
      } else {
        setInputError(true)
      }
    },
    [setInputValue, addToHistory],
  )

  // Typing in the input: auto-commits if not pending; shows confirm dialog if pending
  const handleInputChange = useCallback(
    (raw: string) => {
      if (isPending) {
        // Store what they want to navigate to and open the dialog
        setConfirmPending(raw)
        return
      }
      commitRaw(raw)
    },
    [isPending, commitRaw],
  )

  // Input box typing — always flows through (no guard) so the field stays responsive
  const handleInputTyping = useCallback(
    (raw: string) => {
      setInputValue(raw)
      if (!raw.trim()) { setInputError(false); return }
      const res = parseColor(raw)
      if (res) {
        setColor(res.color)
        setCommittedColor(res.color)
        setDetectedFormat(res.format)
        setInputError(false)
        lastValidInput.current = raw
        addToHistory(rgbToHexStr(res.color.r, res.color.g, res.color.b))
      } else {
        setInputError(true)
      }
    },
    [setInputValue, addToHistory],
  )

  // Sliders / shade-tint: preview only — does NOT commit or touch history
  const updateColorFromSliders = useCallback(
    (newColor: RgbaColor) => {
      setColor(newColor)
    },
    [],
  )

  // Accept: promote preview color → committed, record to history, sync input
  const handleAccept = useCallback(() => {
    const hex = rgbToHexStr(color.r, color.g, color.b)
    const val = color.a < 1
      ? `rgb(${color.r} ${color.g} ${color.b} / ${color.a.toFixed(2)})`
      : hex
    setCommittedColor(color)
    setInputValue(val)
    setDetectedFormat(color.a < 1 ? 'rgb-l4' : 'hex')
    addToHistory(hex)
  }, [color, setInputValue, addToHistory])

  // Discard: snap preview back to committed color
  const handleDiscard = useCallback(() => {
    setColor(committedColor)
  }, [committedColor])

  // Confirm dialog actions
  const handleConfirmSave = useCallback(() => {
    // Accept the pending preview first, then navigate
    handleAccept()
    if (confirmPending !== null) {
      const target = confirmPending
      setConfirmPending(null)
      commitRaw(target)
    }
  }, [handleAccept, confirmPending, commitRaw])

  const handleConfirmDiscard = useCallback(() => {
    // Discard the preview, then navigate
    setColor(committedColor)
    if (confirmPending !== null) {
      const target = confirmPending
      setConfirmPending(null)
      commitRaw(target)
    }
  }, [committedColor, confirmPending, commitRaw])

  const handleConfirmCancel = useCallback(() => {
    setConfirmPending(null)
  }, [])

  // Escape key discards while exploring
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && isPending && confirmPending === null) handleDiscard()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isPending, confirmPending, handleDiscard])

  // Derived — always off the live preview color
  const formats = generateFormats(color)
  const committedFormats = generateFormats(committedColor)
  const palette = generatePalette(color)
  const contrastColor = getContrastColor(color)
  const [h, s, l] = rgbToHsl(color.r, color.g, color.b)
  const [hv, sv, v] = rgbToHsv(color.r, color.g, color.b)
  const swatchBg = color.a < 1
    ? `rgba(${color.r}, ${color.g}, ${color.b}, ${color.a})`
    : rgbToHexStr(color.r, color.g, color.b)
  const committedSwatchBg = committedColor.a < 1
    ? `rgba(${committedColor.r}, ${committedColor.g}, ${committedColor.b}, ${committedColor.a})`
    : rgbToHexStr(committedColor.r, committedColor.g, committedColor.b)

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
    <>
    <div className={cn('mx-auto max-w-2xl space-y-5 px-4 py-8', isPending && 'pb-24')}>

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
                onChange={(e) => handleInputTyping(e.target.value)}
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
                  {committedFormats.hex}
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

      {/* ── Accept / Discard — sticky bottom bar ─────────────────── */}
      <div className="fixed bottom-0 left-0 right-0 z-50 overflow-hidden pointer-events-none">
        <div
          className={cn(
            'pointer-events-auto transition-transform duration-200 ease-in-out',
            isPending ? 'translate-y-0' : 'translate-y-full',
          )}
        >
          <div className="border-t border-primary/30 bg-card/95 backdrop-blur-sm shadow-[0_-4px_24px_rgba(0,0,0,0.12)]">
            <div className="mx-auto flex max-w-2xl items-center gap-3 px-4 py-3">
              {/* Before → After swatches */}
              <div className="flex items-center gap-2 shrink-0">
                <div
                  className="h-8 w-8 rounded-lg ring-1 ring-black/10 dark:ring-white/10 shrink-0"
                  style={{ backgroundColor: committedSwatchBg }}
                  title={`Original: ${committedFormats.hex}`}
                />
                <span className="text-muted-foreground text-sm select-none">→</span>
                <div
                  className="h-8 w-8 rounded-lg ring-2 ring-primary shrink-0"
                  style={{ backgroundColor: swatchBg }}
                  title={`New: ${formats.hex}`}
                />
              </div>
              {/* Hex diff */}
              <div className="flex-1 min-w-0 hidden sm:flex items-center gap-2 font-mono text-xs">
                <span className="line-through text-muted-foreground/60 truncate">{committedFormats.hex}</span>
                <span className="text-muted-foreground">→</span>
                <span className="font-semibold text-foreground truncate">{formats.hex}</span>
              </div>
              {/* Hint */}
              <span className="text-xs text-muted-foreground/50 hidden md:block shrink-0">Esc to discard</span>
              {/* Actions */}
              <div className="flex items-center gap-2 shrink-0 ml-auto sm:ml-0">
                <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={handleDiscard}>
                  Discard
                </Button>
                <Button size="sm" className="h-8 text-xs gap-1.5" onClick={handleAccept}>
                  <Check className="h-3 w-3" />
                  Accept
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>

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
          <div className="flex gap-1.5 overflow-x-auto py-2 px-0.5">
            {palette.map(({ hex, isBase }, i) => (
              <button
                key={i}
                title={hex}
                onClick={() => {
                  const res = parseColor(hex)
                  if (res) setColor(res.color)
                }}
                className={cn(
                  'relative shrink-0 rounded-lg transition-all hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  isBase ? 'h-12 w-12 ring-2 ring-primary ring-offset-2 ring-offset-card scale-105' : 'h-10 w-10',
                )}
                style={{ backgroundColor: hex }}
                aria-label={`Preview ${hex}`}
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
          <p className="mt-2 text-xs text-muted-foreground">Click a swatch to preview · Accept to commit</p>
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
                const isActive = hex === committedFormats.hex
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

      {/* ── Color Harmonies ──────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Color Harmonies</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <Tabs defaultValue="complementary">
            <TabsList className="flex-wrap h-auto gap-y-1 w-full justify-start">
              {([
                ['complementary',     'Complementary'],
                ['split-complementary','Split Comp.'],
                ['analogous',         'Analogous'],
                ['triadic',           'Triadic'],
                ['tetradic',          'Tetradic'],
                ['double-split',      'Double Split'],
                ['monochromatic',     'Mono'],
              ] as [HarmonyType, string][]).map(([value, label]) => (
                <TabsTrigger key={value} value={value} className="h-7 text-xs">
                  {label}
                </TabsTrigger>
              ))}
            </TabsList>
            {(['complementary','split-complementary','analogous','triadic','tetradic','double-split','monochromatic'] as HarmonyType[]).map((type) => {
              const swatches = generateHarmony(color, type)
              return (
                <TabsContent key={type} value={type}>
                  <div className="flex flex-wrap gap-2 pt-1">
                    {swatches.map(({ hex, label, isBase }) => {
                      const c = parseColor(hex)?.color ?? DEFAULT_COLOR
                      const contrast = getContrastColor(c)
                      return (
                        <button
                          key={hex + label}
                          title={hex}
                          onClick={() => handleInputChange(hex)}
                          className={cn(
                            'flex flex-col items-center gap-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-lg p-1 transition-all hover:scale-105',
                            isBase && 'ring-2 ring-primary ring-offset-2 ring-offset-card',
                          )}
                          aria-label={`${label} ${hex}`}
                        >
                          <div
                            className="h-12 w-12 rounded-lg ring-1 ring-black/10 dark:ring-white/10"
                            style={{ backgroundColor: hex }}
                          />
                          <span
                            className="text-[10px] font-mono leading-none px-1 py-0.5 rounded"
                            style={{
                              backgroundColor: hex,
                              color: contrast === 'white' ? 'rgba(255,255,255,0.85)' : 'rgba(0,0,0,0.6)',
                            }}
                          >
                            {hex}
                          </span>
                          <span className="text-[10px] text-muted-foreground">{label}</span>
                        </button>
                      )
                    })}
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">Click a swatch to set it as the active color</p>
                </TabsContent>
              )
            })}
          </Tabs>
        </CardContent>
      </Card>

      {/* ── Tailwind v4 Palette ───────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Tailwind v4 Palette</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          {TW_PALETTE.map(({ name, shades }) => (
            <div key={name} className="flex items-center gap-1 mb-1">
              <span className="w-16 shrink-0 text-xs text-muted-foreground capitalize">{name}</span>
              <div className="flex gap-0.5">
                {shades.map(({ hex, shade }) => (
                  <button
                    key={shade}
                    title={`${name}-${shade} ${hex}`}
                    onClick={() => handleInputChange(hex)}
                    className="h-5 w-5 rounded-sm ring-1 ring-black/10 dark:ring-white/10 transition-all hover:scale-125 hover:z-10 hover:ring-2 hover:ring-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    style={{ backgroundColor: hex }}
                    aria-label={`${name}-${shade}`}
                  />
                ))}
              </div>
            </div>
          ))}
          <p className="mt-3 text-xs text-muted-foreground">
            Also try: <code className="font-mono">hsl(221 52% 8%)</code> · <code className="font-mono">--bg: 220 45% 10%</code> · <code className="font-mono">bg-[#0a1120]</code> · <code className="font-mono">oklch(0.21 0.048 221)</code>
          </p>
        </CardContent>
      </Card>

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


    </div>

    {/* ── Unsaved-changes confirm dialog ────────────────────────── */}
    <AlertDialog open={confirmPending !== null} onOpenChange={(open: boolean) => { if (!open) handleConfirmCancel() }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Unsaved adjustment</AlertDialogTitle>
          <AlertDialogDescription>
            You have an unapplied color change{' '}
            <span className="font-mono font-semibold text-foreground">{committedFormats.hex} → {formats.hex}</span>.
            What would you like to do?
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="flex items-center gap-3 py-1">
          <div className="h-10 w-10 rounded-lg ring-1 ring-black/10 dark:ring-white/10 shrink-0" style={{ backgroundColor: committedSwatchBg }} />
          <span className="text-muted-foreground">→</span>
          <div className="h-10 w-10 rounded-lg ring-2 ring-primary shrink-0" style={{ backgroundColor: swatchBg }} />
        </div>
        <AlertDialogFooter className="flex-col gap-2 sm:flex-row">
          <AlertDialogCancel onClick={handleConfirmCancel}>Cancel</AlertDialogCancel>
          <Button variant="ghost" onClick={handleConfirmDiscard}>
            Discard &amp; continue
          </Button>
          <AlertDialogAction onClick={handleConfirmSave}>
            Save &amp; continue
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
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
