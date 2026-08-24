/**
 * Lorem Ipsum Generator
 *
 * Features:
 *   – Unit selector (paragraphs / sentences / words) + count input
 *   – "Start with 'Lorem ipsum…'" toggle
 *   – Output format selector: plain text / HTML <p> / HTML <ul>
 *   – Read-only output textarea with copy and regenerate buttons
 *   – Word / character count of the output
 *   – Settings persisted via Zustand store (su:lorem-ipsum); output is transient
 */

import { useCallback, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { cn } from '@/lib/utils'
import { generateLoremIpsum, mulberry32, countWords, countChars } from './logic'
import type { GenerateUnit, OutputFormat } from './logic'
import { useLoremIpsumStore } from './store'
import { Copy, Check, RefreshCw } from 'lucide-react'

// ── Constants ─────────────────────────────────────────────────────────────────

const UNIT_OPTIONS: { value: GenerateUnit; label: string; max: number }[] = [
  { value: 'paragraphs', label: 'Paragraphs', max: 50 },
  { value: 'sentences', label: 'Sentences', max: 200 },
  { value: 'words', label: 'Words', max: 2000 },
]

const FORMAT_OPTIONS: { value: OutputFormat; label: string; description: string }[] = [
  { value: 'plain', label: 'Plain text', description: 'Raw text with blank-line paragraph breaks' },
  { value: 'html-p', label: 'HTML <p>', description: 'Each paragraph wrapped in <p>…</p>' },
  { value: 'html-ul', label: 'HTML <ul>', description: 'Items in a <ul> with <li> entries' },
]

// ── Main component ────────────────────────────────────────────────────────────

export default function LoremIpsumGenerator() {
  const { unit, count, classicStart, format, setUnit, setCount, setClassicStart, setFormat } =
    useLoremIpsumStore()

  const [output, setOutput] = useState('')
  const [copied, setCopied] = useState(false)

  const currentUnitOption = UNIT_OPTIONS.find((u) => u.value === unit) ?? UNIT_OPTIONS[0]

  const handleGenerate = useCallback(() => {
    const seed = (Math.random() * 0xffffffff) >>> 0
    const text = generateLoremIpsum({
      unit,
      count,
      classicStart,
      format,
      rng: mulberry32(seed),
    })
    setOutput(text)
    setCopied(false)
  }, [unit, count, classicStart, format])

  const handleCopy = useCallback(() => {
    if (!output || !navigator.clipboard) return
    navigator.clipboard.writeText(output).then(
      () => {
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      },
      () => {
        /* clipboard access denied — silently ignore */
      },
    )
  }, [output])

  const handleCountChange = useCallback(
    (raw: string) => {
      const v = parseInt(raw, 10)
      if (isNaN(v)) return
      const clamped = Math.max(1, Math.min(currentUnitOption.max, v))
      setCount(clamped)
    },
    [currentUnitOption.max, setCount],
  )

  const handleUnitChange = useCallback(
    (newUnit: GenerateUnit) => {
      setUnit(newUnit)
      // Clamp count to the new unit's max if needed
      const newMax = UNIT_OPTIONS.find((u) => u.value === newUnit)?.max ?? 50
      if (count > newMax) setCount(newMax)
    },
    [count, setUnit, setCount],
  )

  const wordCount = countWords(output)
  const charCount = countChars(output)

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 space-y-6">

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="space-y-1">
        <h1 className="text-xl font-semibold">Lorem Ipsum Generator</h1>
        <p className="text-sm text-muted-foreground">
          Generate placeholder text by paragraphs, sentences, or words. Supports plain
          text and HTML output formats.
        </p>
      </div>

      {/* ── Unit + Count row ─────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-end gap-4">

        {/* Unit selector */}
        <div className="space-y-1.5">
          <Label className="text-sm font-medium">Generate by</Label>
          <div className="flex items-center gap-1">
            {UNIT_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => handleUnitChange(opt.value)}
                aria-pressed={unit === opt.value}
                className={cn(
                  'h-8 rounded px-3 text-sm font-medium transition-colors',
                  unit === opt.value
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Count input */}
        <div className="space-y-1.5">
          <Label htmlFor="lorem-count" className="text-sm font-medium">
            Count
          </Label>
          <Input
            id="lorem-count"
            type="number"
            min={1}
            max={currentUnitOption.max}
            value={count}
            onChange={(e) => handleCountChange(e.target.value)}
            className="w-24"
          />
          <p className="text-xs text-muted-foreground">1–{currentUnitOption.max}</p>
        </div>
      </div>

      {/* ── Options ──────────────────────────────────────────────────────────── */}
      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-foreground">Options</h2>

        {/* Classic opening toggle */}
        <div className="flex items-start gap-2.5">
          <Checkbox
            id="classic-start"
            checked={classicStart}
            onCheckedChange={(checked) => setClassicStart(checked === true)}
            className="mt-0.5"
          />
          <div className="space-y-0.5">
            <Label htmlFor="classic-start" className="text-sm font-medium cursor-pointer">
              Start with "Lorem ipsum dolor sit amet…"
            </Label>
            <p className="text-xs text-muted-foreground">
              Prepend the classic opening to the first sentence
            </p>
          </div>
        </div>

        {/* Format selector */}
        <div className="space-y-2">
          <Label className="text-sm font-medium">Output format</Label>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {FORMAT_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setFormat(opt.value)}
                aria-pressed={format === opt.value}
                className={cn(
                  'flex flex-col items-start rounded-lg border px-3 py-2.5 text-left transition-colors',
                  format === opt.value
                    ? 'border-primary bg-primary/5 text-primary'
                    : 'border-input bg-background text-foreground hover:border-primary/50 hover:bg-muted/40',
                )}
              >
                <span className="text-sm font-semibold font-mono">{opt.label}</span>
                <span
                  className={cn(
                    'text-xs mt-0.5',
                    format === opt.value ? 'text-primary/70' : 'text-muted-foreground',
                  )}
                >
                  {opt.description}
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Generate button ───────────────────────────────────────────────────── */}
      <Button onClick={handleGenerate} className="gap-2">
        <RefreshCw className="h-4 w-4" />
        Generate
      </Button>

      {/* ── Output ───────────────────────────────────────────────────────────── */}
      {output && (
        <div className="space-y-2">
          {/* Toolbar row */}
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground tabular-nums">
              {wordCount.toLocaleString()} {wordCount === 1 ? 'word' : 'words'}&ensp;·&ensp;
              {charCount.toLocaleString()} {charCount === 1 ? 'char' : 'chars'}
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleGenerate}
                className="gap-1.5 text-xs"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Regenerate
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleCopy}
                disabled={!output}
                className={cn('gap-1.5 text-xs', copied && 'text-green-600 dark:text-green-400')}
              >
                {copied ? (
                  <Check className="h-3.5 w-3.5" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
                {copied ? 'Copied!' : 'Copy'}
              </Button>
            </div>
          </div>

          {/* Output textarea */}
          <Textarea
            readOnly
            value={output}
            className="min-h-48 resize-y font-mono text-sm leading-relaxed"
            aria-label="Generated lorem ipsum text"
          />
        </div>
      )}
    </div>
  )
}
