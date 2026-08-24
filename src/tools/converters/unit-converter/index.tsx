/**
 * Unit Converter
 *
 * Features:
 *   – 7 categories: Length, Weight/Mass, Temperature, Volume, Area, Speed, Data
 *   – Category tabs for quick switching
 *   – From/to unit selects + numeric input → live converted output
 *   – Swap button, copy button for the result
 *   – "All units" table — shows the input converted to every unit in the category
 *   – Non-numeric input → friendly inline message
 *   – Temperature below absolute zero → warning banner
 *   – State persisted via Zustand store (su:unit-converter)
 */

import { useMemo, useCallback, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import {
  UNIT_CATEGORIES,
  CATEGORIES,
  convert,
  formatResult,
  isAbsoluteZeroWarning,
} from './logic'
import { useUnitConverterStore } from './store'
import { ArrowLeftRight, Copy, Check, AlertTriangle, AlertCircle } from 'lucide-react'

// ── useCopyToClipboard ────────────────────────────────────────────────────────

function useCopyToClipboard(timeoutMs = 1500) {
  const [copiedKey, setCopiedKey] = useState<string | null>(null)

  const copy = useCallback(
    (text: string, key: string) => {
      if (!navigator.clipboard) return
      navigator.clipboard.writeText(text).then(
        () => {
          setCopiedKey(key)
          setTimeout(() => setCopiedKey((k) => (k === key ? null : k)), timeoutMs)
        },
        () => { /* clipboard access denied — silently ignore */ },
      )
    },
    [timeoutMs],
  )

  return { copiedKey, copy }
}

// ── parseInputValue ───────────────────────────────────────────────────────────

type ParsedInput =
  | { ok: true;  value: number }
  | { ok: false; error: string }

function parseInputValue(raw: string): ParsedInput {
  const trimmed = raw.trim()
  if (!trimmed) return { ok: false, error: '' } // empty — no error message
  if (!/^-?\d*\.?\d+([eE][+-]?\d+)?$/.test(trimmed)) {
    return { ok: false, error: 'Enter a valid number (e.g. 100, 3.14, or 1.5e3).' }
  }
  const n = parseFloat(trimmed)
  if (!isFinite(n)) return { ok: false, error: 'Value is out of range.' }
  return { ok: true, value: n }
}

// ── CategoryTabs ──────────────────────────────────────────────────────────────

function CategoryTabs({
  active,
  onChange,
}: {
  active: string
  onChange: (id: string) => void
}) {
  return (
    <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Unit categories">
      {UNIT_CATEGORIES.map((id) => {
        const cat = CATEGORIES[id]
        const isActive = id === active
        return (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(id)}
            className={cn(
              'px-3 py-1 rounded-full text-xs font-medium transition-colors border',
              isActive
                ? 'bg-primary text-primary-foreground border-primary'
                : 'bg-transparent text-muted-foreground border-input hover:bg-accent hover:text-accent-foreground',
            )}
          >
            {cat.label}
          </button>
        )
      })}
    </div>
  )
}

// ── UnitSelect ────────────────────────────────────────────────────────────────

function UnitSelect({
  id,
  categoryId,
  value,
  onChange,
  label,
}: {
  id: string
  categoryId: string
  value: string
  onChange: (unit: string) => void
  label: string
}) {
  const cat = CATEGORIES[categoryId]
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-xs font-medium text-muted-foreground">
        {label}
      </Label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1',
          'text-sm shadow-xs transition-colors',
          'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
          'disabled:cursor-not-allowed disabled:opacity-50',
        )}
      >
        {cat.units.map((u) => (
          <option key={u.id} value={u.id}>
            {u.label}
          </option>
        ))}
      </select>
    </div>
  )
}

// ── AllUnitsTable ─────────────────────────────────────────────────────────────

function AllUnitsTable({
  categoryId,
  fromUnitId,
  value,
  activeToUnitId,
  onSelectToUnit,
}: {
  categoryId:    string
  fromUnitId:    string
  value:         number
  activeToUnitId: string
  onSelectToUnit: (unit: string) => void
}) {
  const cat = CATEGORIES[categoryId]

  return (
    <div className="overflow-hidden rounded-lg border border-input">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-input bg-muted/30">
            <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Unit</th>
            <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">Value</th>
          </tr>
        </thead>
        <tbody>
          {cat.units.map((unit) => {
            const converted = convert(categoryId, fromUnitId, unit.id, value)
            const formatted = formatResult(converted)
            const isActive  = unit.id === activeToUnitId
            return (
              <tr
                key={unit.id}
                className={cn(
                  'border-b border-input last:border-0 cursor-pointer transition-colors',
                  isActive
                    ? 'bg-primary/10'
                    : 'hover:bg-muted/40',
                )}
                onClick={() => onSelectToUnit(unit.id)}
                title={`Use ${unit.label} as the target unit`}
              >
                <td
                  className={cn(
                    'px-3 py-2 font-medium',
                    isActive ? 'text-primary' : 'text-foreground',
                  )}
                >
                  {unit.label}
                </td>
                <td
                  className={cn(
                    'px-3 py-2 text-right font-mono',
                    isActive ? 'text-primary font-semibold' : 'text-foreground',
                  )}
                >
                  {formatted || '—'}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function UnitConverter() {
  const {
    activeCategory,
    setActiveCategory,
    unitSelections,
    setFromUnit,
    setToUnit,
    inputValue,
    setInputValue,
    swapUnits,
  } = useUnitConverterStore()

  const { copiedKey, copy } = useCopyToClipboard()

  // Derive current unit selections for the active category
  const cat = CATEGORIES[activeCategory]

  const sel = unitSelections[activeCategory]
  const fromUnitId = sel?.fromUnit || (cat?.units[0]?.id ?? '')
  const toUnitId   = sel?.toUnit   || (cat?.units[1]?.id ?? '')

  // Parse the raw input string
  const parsed = useMemo(() => parseInputValue(inputValue), [inputValue])

  // The converted result
  const resultValue = useMemo(() => {
    if (!parsed.ok) return null
    const r = convert(activeCategory, fromUnitId, toUnitId, parsed.value)
    return isNaN(r) ? null : r
  }, [parsed, activeCategory, fromUnitId, toUnitId])

  const resultString = resultValue !== null ? formatResult(resultValue) : ''

  // Absolute-zero warning
  const showAbsZeroWarning = useMemo(() => {
    if (!parsed.ok) return false
    return isAbsoluteZeroWarning(activeCategory, fromUnitId, parsed.value)
  }, [parsed, activeCategory, fromUnitId])

  // Input validation error (only if the input is non-empty)
  const showError = inputValue.trim() !== '' && !parsed.ok && parsed.error !== ''

  // Ref for result input so we can select-all on focus
  const resultRef = useRef<HTMLInputElement>(null)

  const handleCategoryChange = useCallback(
    (id: string) => {
      setActiveCategory(id)
    },
    [setActiveCategory],
  )

  const handleSwap = useCallback(() => {
    swapUnits(activeCategory)
  }, [swapUnits, activeCategory])

  const handleCopyResult = useCallback(() => {
    if (resultString) copy(resultString, 'result')
  }, [resultString, copy])

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 space-y-6">

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="space-y-1">
        <h1 className="text-xl font-semibold">Unit Converter</h1>
        <p className="text-sm text-muted-foreground">
          Convert between units of length, weight, temperature, volume, area, speed, and data.
        </p>
      </div>

      {/* ── Category tabs ────────────────────────────────────────────────────── */}
      <CategoryTabs active={activeCategory} onChange={handleCategoryChange} />

      {/* ── Converter card ───────────────────────────────────────────────────── */}
      <div className="rounded-lg border border-input bg-muted/10 p-4 space-y-4">

        {/* From / To unit row */}
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <UnitSelect
              id="from-unit"
              categoryId={activeCategory}
              value={fromUnitId}
              onChange={(u) => setFromUnit(activeCategory, u)}
              label="From"
            />
          </div>

          {/* Swap button */}
          <Button
            variant="ghost"
            size="sm"
            onClick={handleSwap}
            className="h-9 w-9 p-0 shrink-0 mb-0 self-end"
            title="Swap units"
            aria-label="Swap from and to units"
          >
            <ArrowLeftRight className="h-4 w-4" />
          </Button>

          <div className="flex-1">
            <UnitSelect
              id="to-unit"
              categoryId={activeCategory}
              value={toUnitId}
              onChange={(u) => setToUnit(activeCategory, u)}
              label="To"
            />
          </div>
        </div>

        {/* Input / output row */}
        <div className="flex items-end gap-2">
          {/* Value input */}
          <div className="flex-1 space-y-1.5">
            <Label htmlFor="value-input" className="text-xs font-medium text-muted-foreground">
              Value
            </Label>
            <Input
              id="value-input"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder="Enter a number…"
              className="font-mono text-base"
              inputMode="decimal"
              spellCheck={false}
              aria-invalid={showError}
            />
          </div>

          <span className="text-muted-foreground text-sm font-medium pb-2 shrink-0">=</span>

          {/* Result output */}
          <div className="flex-1 space-y-1.5">
            <Label htmlFor="result-output" className="text-xs font-medium text-muted-foreground">
              Result
            </Label>
            <div className="flex items-center gap-1">
              <Input
                id="result-output"
                ref={resultRef}
                value={resultString}
                readOnly
                onFocus={() => resultRef.current?.select()}
                placeholder="—"
                className={cn(
                  'font-mono text-base',
                  resultString && 'text-primary font-semibold',
                )}
                aria-live="polite"
                aria-label="Conversion result"
              />
              <Button
                variant="ghost"
                size="sm"
                onClick={handleCopyResult}
                disabled={!resultString}
                className={cn(
                  'h-9 w-9 p-0 shrink-0',
                  copiedKey === 'result' && 'text-green-600 dark:text-green-400',
                )}
                title={copiedKey === 'result' ? 'Copied!' : 'Copy result'}
                aria-label={copiedKey === 'result' ? 'Copied' : 'Copy result to clipboard'}
              >
                {copiedKey === 'result'
                  ? <Check className="h-4 w-4" />
                  : <Copy className="h-4 w-4" />
                }
              </Button>
            </div>
          </div>
        </div>

        {/* Unit labels beneath inputs */}
        {(fromUnitId || toUnitId) && (
          <div className="flex gap-2 -mt-1">
            <div className="flex-1 text-xs text-muted-foreground text-right pr-1">
              {cat?.units.find((u) => u.id === fromUnitId)?.label ?? ''}
            </div>
            {/* spacer for = sign + copy button */}
            <div className="w-[4.5rem]" />
            <div className="flex-1 text-xs text-muted-foreground">
              {cat?.units.find((u) => u.id === toUnitId)?.label ?? ''}
            </div>
          </div>
        )}

        {/* Validation error */}
        {showError && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
            <span>{parsed.error}</span>
          </div>
        )}

        {/* Absolute-zero warning */}
        {showAbsZeroWarning && (
          <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
            <span>
              This temperature is below absolute zero (0 K / −273.15°C / −459.67°F),
              which is physically impossible.
            </span>
          </div>
        )}
      </div>

      {/* ── All units table ──────────────────────────────────────────────────── */}
      {parsed.ok && (
        <div className="space-y-2">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            All {CATEGORIES[activeCategory]?.label} Units
          </h2>
          <AllUnitsTable
            categoryId={activeCategory}
            fromUnitId={fromUnitId}
            value={parsed.value}
            activeToUnitId={toUnitId}
            onSelectToUnit={(unit) => setToUnit(activeCategory, unit)}
          />
        </div>
      )}

      {/* Empty state */}
      {!parsed.ok && !showError && (
        <div className="rounded-lg border border-input bg-muted/20 px-4 py-6 text-center text-sm text-muted-foreground">
          Enter a value above to see conversions for all{' '}
          {CATEGORIES[activeCategory]?.label.toLowerCase()} units.
        </div>
      )}
    </div>
  )
}
