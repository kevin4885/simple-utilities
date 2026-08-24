/**
 * Date Calculator
 *
 * Four sections:
 *   1. Days between dates — total days, year/month/day breakdown, weeks+days, business days
 *   2. Add / subtract from a date — date + amount + unit + direction → result date
 *   3. Age calculator — birth date → exact age, total days lived, next birthday
 *   4. Countdown — target datetime → live ticking countdown
 *
 * State persisted via Zustand store (su:date-calculator).
 * All date math in pure logic.ts; no timezone/DST pitfalls.
 */

import { useState, useEffect, useMemo } from 'react'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'
import {
  Calendar,
  CalendarClock,
  CalendarDays,
  Cake,
  Timer,
  ArrowRightLeft,
  Briefcase,
  Info,
} from 'lucide-react'
import {
  parseYMD,
  formatYMD,
  weekdayName,
  daysBetween,
  businessDaysBetween,
  breakdown,
  weeksAndDays,
  addToDate,
  calcAge,
  countdownTo,
} from './logic'
import type { AddUnit } from './logic'
import { useDateCalculatorStore } from './store'

// ── helpers ────────────────────────────────────────────────────────────────────

/** Returns today as "YYYY-MM-DD" for date input `max` attribute. */
function todayString(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${dd}`
}

/** Formats a number with locale thousands separators. */
function fmt(n: number): string {
  return n.toLocaleString()
}

/** Plural helper. */
function plural(n: number, word: string): string {
  return `${fmt(n)} ${word}${n === 1 ? '' : 's'}`
}

/** Zero-pad to 2 digits for countdown display. */
function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

// ── ResultGrid ─────────────────────────────────────────────────────────────────

function ResultGrid({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-4 rounded-lg border border-input bg-muted/40 divide-y divide-input">
      {children}
    </div>
  )
}

function ResultRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-start gap-3 px-4 py-2.5">
      <span className="shrink-0 w-36 text-xs font-medium text-muted-foreground pt-0.5">{label}</span>
      <span className={cn('flex-1 text-sm text-foreground', mono && 'font-mono')}>{value}</span>
    </div>
  )
}

// ── SectionHeader ──────────────────────────────────────────────────────────────

function SectionHeader({
  icon: Icon,
  title,
  description,
}: {
  icon: React.ElementType
  title: string
  description: string
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
        <Icon className="h-4 w-4" />
      </div>
      <div>
        <h2 className="text-base font-semibold">{title}</h2>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
    </div>
  )
}

// ── NoteBanner ─────────────────────────────────────────────────────────────────

function NoteBanner({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-md border border-input bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
      <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span>{children}</span>
    </div>
  )
}

// ── Section 1: Days Between ────────────────────────────────────────────────────

function DaysBetweenSection() {
  const {
    betweenStartDate,
    setBetweenStartDate,
    betweenEndDate,
    setBetweenEndDate,
    betweenIncludeEnd,
    setBetweenIncludeEnd,
  } = useDateCalculatorStore()

  const result = useMemo(() => {
    const a = parseYMD(betweenStartDate)
    const b = parseYMD(betweenEndDate)
    if (!a || !b) return null

    const total = daysBetween(a, b, betweenIncludeEnd)
    const bd = breakdown(a, b)
    const wd = weeksAndDays(total)
    const bizDays = businessDaysBetween(a, b, betweenIncludeEnd)

    // Which comes first?
    const startLabel = formatYMD(a) <= formatYMD(b) ? formatYMD(a) : formatYMD(b)
    const endLabel = formatYMD(a) <= formatYMD(b) ? formatYMD(b) : formatYMD(a)

    // Breakdown string
    const parts: string[] = []
    if (bd.years > 0) parts.push(plural(bd.years, 'year'))
    if (bd.months > 0) parts.push(plural(bd.months, 'month'))
    if (bd.days > 0) parts.push(plural(bd.days, 'day'))
    const breakdownStr = parts.length === 0 ? '0 days' : parts.join(', ')

    return { total, bd, wd, bizDays, startLabel, endLabel, breakdownStr }
  }, [betweenStartDate, betweenEndDate, betweenIncludeEnd])

  return (
    <div className="space-y-5">
      <SectionHeader
        icon={CalendarDays}
        title="Days Between Dates"
        description="Calculate the number of days between two calendar dates."
      />

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="between-start">Start date</Label>
          <Input
            id="between-start"
            type="date"
            value={betweenStartDate}
            onChange={(e) => setBetweenStartDate(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="between-end">End date</Label>
          <Input
            id="between-end"
            type="date"
            value={betweenEndDate}
            onChange={(e) => setBetweenEndDate(e.target.value)}
          />
        </div>
      </div>

      <div className="flex items-center gap-2">
        <input
          id="include-end"
          type="checkbox"
          checked={betweenIncludeEnd}
          onChange={(e) => setBetweenIncludeEnd(e.target.checked)}
          className="h-4 w-4 rounded border-input accent-primary"
        />
        <Label htmlFor="include-end" className="cursor-pointer font-normal">
          Include end date
        </Label>
      </div>

      {!result && (
        <p className="text-sm text-muted-foreground">Enter both dates above to see results.</p>
      )}

      {result && (
        <ResultGrid>
          <ResultRow
            label="Total days"
            value={`${fmt(result.total)} day${result.total === 1 ? '' : 's'}${result.bd.negative ? ' (end is before start)' : ''}`}
          />
          <ResultRow label="Breakdown" value={result.breakdownStr} />
          <ResultRow
            label="Weeks + days"
            value={
              result.wd.weeks === 0
                ? plural(result.wd.days, 'day')
                : result.wd.days === 0
                  ? plural(result.wd.weeks, 'week')
                  : `${plural(result.wd.weeks, 'week')}, ${plural(result.wd.days, 'day')}`
            }
          />
          <ResultRow
            label="Business days"
            value={`${fmt(result.bizDays)} business day${result.bizDays === 1 ? '' : 's'}`}
          />
          <ResultRow label="From" value={result.startLabel} />
          <ResultRow label="To" value={result.endLabel} />
        </ResultGrid>
      )}

      <NoteBanner>Business days count Mon–Fri only. Public holidays are not excluded.</NoteBanner>
    </div>
  )
}

// ── Section 2: Add / Subtract ──────────────────────────────────────────────────

const ADD_UNITS: { value: AddUnit; label: string }[] = [
  { value: 'days', label: 'Days' },
  { value: 'weeks', label: 'Weeks' },
  { value: 'months', label: 'Months' },
  { value: 'years', label: 'Years' },
  { value: 'businessDays', label: 'Business days' },
]

function AddSubtractSection() {
  const {
    addBaseDate,
    setAddBaseDate,
    addAmount,
    setAddAmount,
    addUnit,
    setAddUnit,
    addDirection,
    setAddDirection,
  } = useDateCalculatorStore()

  const result = useMemo(() => {
    const base = parseYMD(addBaseDate)
    if (!base) return null
    const amount = parseInt(addAmount, 10)
    if (isNaN(amount) || amount < 0) return null
    const signed = addDirection === 'subtract' ? -amount : amount
    try {
      const out = addToDate(base, signed, addUnit)
      const weekday = weekdayName(out)
      return { out, weekday }
    } catch {
      return null
    }
  }, [addBaseDate, addAmount, addUnit, addDirection])

  const amountNum = parseInt(addAmount, 10)
  const isAmountInvalid = addAmount !== '' && (isNaN(amountNum) || amountNum < 0)

  return (
    <div className="space-y-5">
      <SectionHeader
        icon={CalendarClock}
        title="Add / Subtract from a Date"
        description="Find a date by adding or subtracting an amount from a starting date."
      />

      <div className="space-y-1.5">
        <Label htmlFor="add-base-date">Starting date</Label>
        <Input
          id="add-base-date"
          type="date"
          value={addBaseDate}
          onChange={(e) => setAddBaseDate(e.target.value)}
        />
      </div>

      <div className="flex flex-wrap items-end gap-3">
        {/* Direction toggle */}
        <div className="space-y-1.5">
          <Label>Direction</Label>
          <div className="flex rounded-md border border-input overflow-hidden">
            {(['add', 'subtract'] as const).map((dir) => (
              <button
                key={dir}
                type="button"
                onClick={() => setAddDirection(dir)}
                className={cn(
                  'px-4 py-2 text-sm font-medium transition-colors',
                  addDirection === dir
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-background text-foreground hover:bg-muted',
                )}
              >
                {dir === 'add' ? '+ Add' : '− Subtract'}
              </button>
            ))}
          </div>
        </div>

        {/* Amount */}
        <div className="space-y-1.5 w-28">
          <Label htmlFor="add-amount">Amount</Label>
          <Input
            id="add-amount"
            type="number"
            min="0"
            value={addAmount}
            onChange={(e) => setAddAmount(e.target.value)}
            className={cn(isAmountInvalid && 'border-destructive')}
          />
        </div>

        {/* Unit */}
        <div className="space-y-1.5">
          <Label htmlFor="add-unit">Unit</Label>
          <div className="flex flex-wrap gap-1.5">
            {ADD_UNITS.map(({ value, label }) => (
              <button
                key={value}
                type="button"
                onClick={() => setAddUnit(value)}
                className={cn(
                  'rounded-md border px-3 py-1.5 text-sm transition-colors',
                  addUnit === value
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-input bg-background text-foreground hover:bg-muted',
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {!result && !isAmountInvalid && (
        <p className="text-sm text-muted-foreground">Enter a starting date and amount to see the result.</p>
      )}

      {isAmountInvalid && (
        <p className="text-sm text-destructive">Amount must be a non-negative integer.</p>
      )}

      {result && (
        <ResultGrid>
          <ResultRow label="Result date" value={formatYMD(result.out)} />
          <ResultRow label="Weekday" value={result.weekday} />
          <ResultRow
            label="Operation"
            value={`${addDirection === 'add' ? '+' : '−'} ${fmt(amountNum)} ${ADD_UNITS.find((u) => u.value === addUnit)?.label.toLowerCase() ?? addUnit}`}
          />
        </ResultGrid>
      )}

      <NoteBanner>
        Month-end clamping: adding 1 month to Jan 31 gives Feb 28/29.
        Business days skip Sat/Sun; public holidays are not excluded.
      </NoteBanner>
    </div>
  )
}

// ── Section 3: Age Calculator ──────────────────────────────────────────────────

function AgeSection() {
  const { ageBirthDate, setAgeBirthDate } = useDateCalculatorStore()

  const result = useMemo(() => {
    const birth = parseYMD(ageBirthDate)
    if (!birth) return null
    // Guard: birth date in the future
    const todayStr = todayString()
    if (ageBirthDate > todayStr) return { future: true } as const
    return { future: false, age: calcAge(birth) } as const
  }, [ageBirthDate])

  return (
    <div className="space-y-5">
      <SectionHeader
        icon={Cake}
        title="Age Calculator"
        description="Calculate exact age in years, months, and days, plus your next birthday."
      />

      <div className="space-y-1.5">
        <Label htmlFor="age-birth">Date of birth</Label>
        <Input
          id="age-birth"
          type="date"
          value={ageBirthDate}
          max={todayString()}
          onChange={(e) => setAgeBirthDate(e.target.value)}
        />
      </div>

      {!result && (
        <p className="text-sm text-muted-foreground">Enter your date of birth to see your age.</p>
      )}

      {result && result.future && (
        <p className="text-sm text-destructive">Date of birth cannot be in the future.</p>
      )}

      {result && !result.future && (() => {
        const { age } = result
        const ageParts: string[] = []
        if (age.years > 0) ageParts.push(plural(age.years, 'year'))
        if (age.months > 0) ageParts.push(plural(age.months, 'month'))
        if (age.days > 0 || ageParts.length === 0) ageParts.push(plural(age.days, 'day'))
        const ageStr = ageParts.join(', ')

        const nextBdStr = formatYMD(age.nextBirthdayDate)
        const nextBdWeekday = weekdayName(age.nextBirthdayDate)
        const nextBdLabel =
          age.daysUntilNextBirthday === 0
            ? `Today! (${nextBdWeekday})`
            : age.daysUntilNextBirthday === 1
              ? `Tomorrow — ${nextBdStr} (${nextBdWeekday})`
              : `${nextBdStr} (${nextBdWeekday}) — in ${plural(age.daysUntilNextBirthday, 'day')}`

        return (
          <div className="space-y-3">
            <ResultGrid>
              <ResultRow label="Age" value={ageStr} />
              <ResultRow label="Days lived" value={plural(age.totalDaysLived, 'day')} />
              <ResultRow label="Next birthday" value={nextBdLabel} />
            </ResultGrid>
            {age.feb29Note && <NoteBanner>{age.feb29Note}</NoteBanner>}
          </div>
        )
      })()}
    </div>
  )
}

// ── Section 4: Countdown ───────────────────────────────────────────────────────

function CountdownSection() {
  const { countdownTarget, setCountdownTarget } = useDateCalculatorStore()
  const [nowMs, setNowMs] = useState(() => Date.now())

  // Tick every second
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  const result = useMemo(() => {
    if (!countdownTarget) return null
    // Parse "YYYY-MM-DDTHH:MM" or "YYYY-MM-DD"
    let targetMs: number
    if (countdownTarget.includes('T')) {
      const d = new Date(countdownTarget)
      if (isNaN(d.getTime())) return null
      targetMs = d.getTime()
    } else {
      const ymd = parseYMD(countdownTarget)
      if (!ymd) return null
      // Treat as local midnight
      const d = new Date(ymd.y, ymd.m - 1, ymd.d, 0, 0, 0, 0)
      targetMs = d.getTime()
    }
    return countdownTo(targetMs, nowMs)
  }, [countdownTarget, nowMs])

  // Friendly target label
  const targetLabel = useMemo(() => {
    if (!countdownTarget) return ''
    if (countdownTarget.includes('T')) {
      const d = new Date(countdownTarget)
      if (isNaN(d.getTime())) return ''
      return d.toLocaleDateString(undefined, {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    }
    const ymd = parseYMD(countdownTarget)
    if (!ymd) return ''
    return `${weekdayName(ymd)}, ${new Date(ymd.y, ymd.m - 1, ymd.d).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    })}`
  }, [countdownTarget])

  return (
    <div className="space-y-5">
      <SectionHeader
        icon={Timer}
        title="Countdown"
        description="Count down to any date or datetime. Updates live every second."
      />

      <div className="space-y-1.5">
        <Label htmlFor="countdown-target">Target date / time</Label>
        <Input
          id="countdown-target"
          type="datetime-local"
          value={countdownTarget}
          onChange={(e) => setCountdownTarget(e.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          The time component is optional — clear the time fields to count down to midnight of that day.
        </p>
      </div>

      {!result && (
        <p className="text-sm text-muted-foreground">Set a target date or datetime to start the countdown.</p>
      )}

      {result && (
        <div className="space-y-4">
          {targetLabel && (
            <p className="text-sm font-medium text-foreground">{targetLabel}</p>
          )}

          {/* Big countdown display */}
          <div
            className={cn(
              'rounded-xl border px-6 py-5 text-center',
              result.isPast
                ? 'border-destructive/30 bg-destructive/5'
                : 'border-primary/30 bg-primary/5',
            )}
          >
            {result.isPast ? (
              <p className="mb-3 text-sm font-medium text-destructive">This date is in the past</p>
            ) : null}
            <div className="flex items-end justify-center gap-4">
              {[
                { value: result.days, label: 'days' },
                { value: result.hours, label: 'hrs' },
                { value: result.minutes, label: 'min' },
                { value: result.seconds, label: 'sec' },
              ].map(({ value, label }) => (
                <div key={label} className="flex flex-col items-center">
                  <span
                    className={cn(
                      'font-mono text-4xl font-bold tabular-nums leading-none',
                      result.isPast ? 'text-destructive' : 'text-primary',
                    )}
                  >
                    {label === 'days' ? fmt(value) : pad2(value)}
                  </span>
                  <span className="mt-1 text-xs text-muted-foreground">{label}</span>
                </div>
              ))}
            </div>
            {!result.isPast && result.days === 0 && result.hours === 0 && result.minutes === 0 && result.seconds === 0 && (
              <p className="mt-3 text-sm font-medium text-primary">🎉 It's time!</p>
            )}
          </div>

          <ResultGrid>
            <ResultRow
              label="Total remaining"
              value={
                result.isPast
                  ? `${plural(result.days * 24 * 60 + result.hours * 60 + result.minutes, 'minute')} ago`
                  : `${plural(result.days, 'day')}, ${pad2(result.hours)}:${pad2(result.minutes)}:${pad2(result.seconds)}`
              }
            />
          </ResultGrid>
        </div>
      )}
    </div>
  )
}

// ── Main Component ─────────────────────────────────────────────────────────────

export default function DateCalculator() {
  const { activeTab, setActiveTab } = useDateCalculatorStore()

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <div className="mb-6 flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Calendar className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-xl font-semibold">Date Calculator</h1>
          <p className="text-sm text-muted-foreground">
            Days between dates, add/subtract, age, and countdown.
          </p>
        </div>
      </div>

      <Tabs
        value={activeTab}
        onValueChange={(v) => setActiveTab(v as typeof activeTab)}
      >
        <TabsList className="mb-6 w-full">
          <TabsTrigger value="between" className="flex-1 gap-1.5">
            <ArrowRightLeft className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Between</span>
          </TabsTrigger>
          <TabsTrigger value="add" className="flex-1 gap-1.5">
            <CalendarClock className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Add / Sub</span>
          </TabsTrigger>
          <TabsTrigger value="age" className="flex-1 gap-1.5">
            <Cake className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Age</span>
          </TabsTrigger>
          <TabsTrigger value="countdown" className="flex-1 gap-1.5">
            <Timer className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Countdown</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="between">
          <DaysBetweenSection />
        </TabsContent>

        <TabsContent value="add">
          <AddSubtractSection />
        </TabsContent>

        <TabsContent value="age">
          <AgeSection />
        </TabsContent>

        <TabsContent value="countdown">
          <CountdownSection />
        </TabsContent>
      </Tabs>

      <Separator className="mt-8 mb-4" />
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Briefcase className="h-3.5 w-3.5 shrink-0" />
        <span>Business day calculations skip weekends only — public holidays are not excluded.</span>
      </div>
    </div>
  )
}
