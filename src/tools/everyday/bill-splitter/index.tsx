/**
 * Tip & Bill Splitter
 *
 * Features:
 *   – Bill amount + optional tax amount inputs
 *   – Tip quick-pick buttons (10/15/18/20/25%) + custom input + slider
 *   – People stepper (1–100)
 *   – Tip-on-pre-tax toggle (when tax provided)
 *   – Round-up options (none / nearest 50¢ / nearest $1)
 *   – Currency selector (USD, EUR, GBP, CAD, AUD, JPY)
 *   – Live results: tip, total, per-person breakdown (largest-remainder)
 *   – All inputs persisted via Zustand store (su:bill-splitter)
 */

import { useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Slider } from '@/components/ui/slider'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'
import {
  computeSplit,
  formatMoney,
  getCurrency,
  CURRENCIES,
  type CurrencyCode,
  type RoundUpMode,
} from './logic'
import { useBillSplitterStore } from './store'

// ── Constants ─────────────────────────────────────────────────────────────────

const QUICK_TIP_PCTS = [10, 15, 18, 20, 25]

const ROUND_UP_OPTIONS: { value: RoundUpMode; label: string }[] = [
  { value: 'none', label: 'Off' },
  { value: 'half', label: '50¢' },
  { value: 'dollar', label: '$1' },
]

// ── Main component ────────────────────────────────────────────────────────────

export default function BillSplitter() {
  const {
    billStr,
    taxStr,
    tipPct,
    tipOnPreTax,
    people,
    roundUpMode,
    currency: currencyCode,
    setBillStr,
    setTaxStr,
    setTipPct,
    setTipOnPreTax,
    setPeople,
    setRoundUpMode,
    setCurrency,
  } = useBillSplitterStore()

  const currency = getCurrency(currencyCode as CurrencyCode)

  // ── Live computation ──────────────────────────────────────────────────────

  const result = useMemo(
    () =>
      computeSplit({
        billStr,
        taxStr,
        tipPct,
        tipOnPreTax,
        people,
        roundUpMode,
        currency,
      }),
    [billStr, taxStr, tipPct, tipOnPreTax, people, roundUpMode, currency],
  )

  const hasBill = result.billCents > 0
  const hasTax = result.taxCents > 0

  // ── People stepper ────────────────────────────────────────────────────────

  function adjustPeople(delta: number) {
    setPeople(Math.max(1, Math.min(100, people + delta)))
  }

  // ── Tip input clamping ────────────────────────────────────────────────────

  function handleTipInput(raw: string) {
    const v = parseFloat(raw)
    if (isNaN(v) || raw === '') {
      setTipPct(0)
      return
    }
    setTipPct(Math.max(0, Math.min(200, Math.round(v * 10) / 10)))
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="mx-auto max-w-lg px-4 py-8 space-y-6">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="space-y-1">
        <h1 className="text-xl font-semibold">Tip &amp; Bill Splitter</h1>
        <p className="text-sm text-muted-foreground">
          Calculate tip and split the bill fairly — per-person amounts differ by at&nbsp;most&nbsp;1¢.
        </p>
      </div>

      {/* ── Currency ───────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3">
        <Label className="text-sm font-medium shrink-0">Currency</Label>
        <div className="flex flex-wrap gap-1">
          {CURRENCIES.map((c) => (
            <button
              type="button"
              key={c.code}
              onClick={() => setCurrency(c.code as CurrencyCode)}
              aria-pressed={currencyCode === c.code}
              className={cn(
                'h-7 rounded px-2.5 text-xs font-medium transition-colors',
                currencyCode === c.code
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground',
              )}
            >
              {c.code}
            </button>
          ))}
        </div>
      </div>

      {/* ── Bill + Tax inputs ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="bill-amount" className="text-sm font-medium">
            Bill amount
          </Label>
          <Input
            id="bill-amount"
            type="number"
            min={0}
            step={0.01}
            placeholder="0.00"
            value={billStr}
            onChange={(e) => setBillStr(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="tax-amount" className="text-sm font-medium">
            Tax <span className="text-muted-foreground font-normal">(optional)</span>
          </Label>
          <Input
            id="tax-amount"
            type="number"
            min={0}
            step={0.01}
            placeholder="0.00"
            value={taxStr}
            onChange={(e) => setTaxStr(e.target.value)}
          />
        </div>
      </div>

      {/* Tip on pre-tax toggle — only shown when tax is provided */}
      {hasTax && (
        <div className="flex items-start gap-2.5">
          <Checkbox
            id="tip-on-pretax"
            checked={tipOnPreTax}
            onCheckedChange={(checked) => setTipOnPreTax(checked === true)}
            className="mt-0.5"
          />
          <div className="space-y-0.5">
            <Label htmlFor="tip-on-pretax" className="text-sm font-medium cursor-pointer">
              Tip on pre-tax amount
            </Label>
            <p className="text-xs text-muted-foreground">
              When checked, tip is calculated on the bill minus tax
            </p>
          </div>
        </div>
      )}

      {/* ── Tip percentage ─────────────────────────────────────────────────── */}
      <div className="space-y-3">
        <Label className="text-sm font-medium">Tip percentage</Label>

        {/* Quick-pick buttons */}
        <div className="flex flex-wrap gap-1.5">
          {QUICK_TIP_PCTS.map((pct) => (
            <button
              type="button"
              key={pct}
              onClick={() => setTipPct(pct)}
              aria-pressed={tipPct === pct}
              className={cn(
                'h-8 rounded px-3 text-sm font-medium transition-colors',
                tipPct === pct
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground',
              )}
            >
              {pct}%
            </button>
          ))}
          {/* Custom input */}
          <div className="relative flex items-center">
            <Input
              id="tip-custom"
              type="number"
              min={0}
              max={200}
              step={0.5}
              value={tipPct === 0 ? '' : tipPct}
              onChange={(e) => handleTipInput(e.target.value)}
              placeholder="Custom"
              className="w-24 pr-6"
              aria-label="Custom tip percentage"
            />
            <span className="pointer-events-none absolute right-2.5 text-xs text-muted-foreground">%</span>
          </div>
        </div>

        {/* Slider */}
        <Slider
          value={[tipPct]}
          onValueChange={([v]) => setTipPct(v)}
          min={0}
          max={50}
          step={1}
          aria-label="Tip percentage slider"
          className="py-1"
        />
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>0%</span>
          <span>50%</span>
        </div>
      </div>

      {/* ── Number of people ───────────────────────────────────────────────── */}
      <div className="space-y-1.5">
        <Label className="text-sm font-medium">Number of people</Label>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon-sm"
            onClick={() => adjustPeople(-1)}
            disabled={people <= 1}
            aria-label="Decrease people"
          >
            <span className="text-lg leading-none">−</span>
          </Button>
          <Input
            type="number"
            min={1}
            max={100}
            value={people}
            onChange={(e) => {
              const v = parseInt(e.target.value, 10)
              if (!isNaN(v)) setPeople(Math.max(1, Math.min(100, v)))
            }}
            className="w-16 text-center"
            aria-label="Number of people"
          />
          <Button
            variant="outline"
            size="icon-sm"
            onClick={() => adjustPeople(1)}
            disabled={people >= 100}
            aria-label="Increase people"
          >
            <span className="text-lg leading-none">+</span>
          </Button>
          <span className="text-sm text-muted-foreground">
            {people === 1 ? 'person' : 'people'}
          </span>
        </div>
      </div>

      {/* ── Round-up option (only for currencies with decimals) ────────────── */}
      {currency.minorDigits >= 2 && (
        <div className="space-y-1.5">
          <Label className="text-sm font-medium">Round up per person</Label>
          <div className="flex gap-1.5">
            {ROUND_UP_OPTIONS.map((opt) => (
              <button
                type="button"
                key={opt.value}
                onClick={() => setRoundUpMode(opt.value)}
                aria-pressed={roundUpMode === opt.value}
                className={cn(
                  'h-8 rounded px-3 text-sm font-medium transition-colors',
                  roundUpMode === opt.value
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Round each person&apos;s share up to the nearest amount
          </p>
        </div>
      )}

      {/* ── Results ────────────────────────────────────────────────────────── */}
      {hasBill && (
        <>
          <Separator />

          <div className="space-y-4">
            <h2 className="text-sm font-semibold">Results</h2>

            {/* Summary grid */}
            <div className="grid grid-cols-2 gap-x-6 gap-y-3">
              <ResultRow
                label="Tip amount"
                value={formatMoney(result.tipCents, currency)}
                sub={
                  hasTax && tipOnPreTax
                    ? `on ${formatMoney(result.tipBaseCents, currency)} pre-tax`
                    : undefined
                }
              />
              <ResultRow
                label="Total bill"
                value={formatMoney(result.totalCents, currency)}
              />
            </div>

            <Separator className="opacity-50" />

            {/* Per-person breakdown */}
            <div className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Per person
              </h3>

              {!result.roundingActive ? (
                // Normal split breakdown
                <PerPersonBreakdown shares={result.shares} currency={currency} people={people} />
              ) : (
                // Rounded split
                <div className="space-y-2">
                  {/* Rounded amount */}
                  <div className="flex items-baseline justify-between rounded-lg bg-primary/5 border border-primary/20 px-4 py-3">
                    <span className="text-sm font-medium text-primary">Rounded per person</span>
                    <span className="text-2xl font-bold text-primary tabular-nums">
                      {formatMoney(result.roundedPerPerson, currency)}
                    </span>
                  </div>

                  {/* Effective tip and overpayment */}
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div className="rounded-md bg-muted/50 px-3 py-2">
                      <div className="text-xs text-muted-foreground mb-0.5">Effective tip</div>
                      <div className="font-semibold tabular-nums">
                        {result.effectiveTipPct !== null
                          ? `${result.effectiveTipPct.toFixed(2)}%`
                          : '—'}
                      </div>
                    </div>
                    <div className="rounded-md bg-muted/50 px-3 py-2">
                      <div className="text-xs text-muted-foreground mb-0.5">Total overpay</div>
                      <div className="font-semibold tabular-nums">
                        {formatMoney(result.roundingOverpay, currency)}
                      </div>
                    </div>
                  </div>

                  {/* Rounded total */}
                  <p className="text-xs text-muted-foreground">
                    Rounded total: <span className="font-medium text-foreground">{formatMoney(result.roundedTotal, currency)}</span>
                    {' '}({people} × {formatMoney(result.roundedPerPerson, currency)})
                  </p>
                </div>
              )}
            </div>

            {/* Tip per person (non-rounded) */}
            {!result.roundingActive && result.tipCents > 0 && (
              <div className="text-xs text-muted-foreground">
                Tip per person:{' '}
                {people > 1
                  ? formatMoney(Math.round(result.tipCents / people), currency)
                  : formatMoney(result.tipCents, currency)}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

interface ResultRowProps {
  label: string
  value: string
  sub?: string
}

function ResultRow({ label, value, sub }: ResultRowProps) {
  return (
    <div className="space-y-0.5">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold tabular-nums">{value}</div>
      {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
    </div>
  )
}

interface PerPersonBreakdownProps {
  shares: { amount: number; count: number }[]
  currency: import('./logic').CurrencyDef
  people: number
}

function PerPersonBreakdown({ shares, currency, people }: PerPersonBreakdownProps) {
  const isEven = shares.length === 1

  if (isEven) {
    return (
      <div className="flex items-baseline justify-between rounded-lg bg-muted/50 px-4 py-3">
        <span className="text-sm font-medium text-muted-foreground">
          {people} {people === 1 ? 'person' : 'people'} pay
        </span>
        <span className="text-2xl font-bold tabular-nums">
          {formatMoney(shares[0].amount, currency)}
        </span>
      </div>
    )
  }

  // Uneven split: show the breakdown
  return (
    <div className="space-y-2">
      {shares.map((share, i) => (
        <div
          key={i}
          className="flex items-baseline justify-between rounded-lg bg-muted/50 px-4 py-2.5"
        >
          <span className="text-sm text-muted-foreground">
            {share.count} {share.count === 1 ? 'person' : 'people'} pay
          </span>
          <span className="text-xl font-bold tabular-nums">
            {formatMoney(share.amount, currency)}
          </span>
        </div>
      ))}
      <p className="text-xs text-muted-foreground">
        Amounts differ by at most 1¢ so the total is exact.
      </p>
    </div>
  )
}
