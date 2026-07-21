import { useState } from 'react'
import { ChevronDown, ChevronUp, Copy, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'
import { Checkbox } from '@/components/ui/checkbox'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import {
  calcDough,
  formatYeast,
  hydrationPct,
  getProTip,
  REGULAR_STEPS,
  GF_STEPS,
  type ThicknessName,
} from './logic'
import { usePizzaDoughStore } from './store'

const THICKNESS_LABELS: Record<ThicknessName, string> = {
  thin: 'Thin',
  regular: 'Regular',
  thick: 'Thick',
}

export default function PizzaDoughPage() {
  const {
    size,
    qty,
    thickness,
    glutenFree,
    hydration,
    setSize,
    setQty,
    setThickness,
    setGlutenFree,
    setHydration,
  } = usePizzaDoughStore()

  const [instructionsOpen, setInstructionsOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const [copyError, setCopyError] = useState(false)

  // Store hydration as integer percentage (50–90); logic expects a fraction
  const hydrationFraction = hydration / 100

  const result = calcDough({ size, qty, thickness, glutenFree, hydration: hydrationFraction })
  const tip = getProTip({ size, qty, thickness, glutenFree, hydration: hydrationFraction })
  const steps = glutenFree ? GF_STEPS : REGULAR_STEPS
  const flourLabel = glutenFree ? 'GF flour (Caputo GF recommended)' : 'Bread flour, 12–14% protein'

  const ingredients: Array<{ name: string; hint: string; amount: string; pct: string }> = [
    { name: 'Flour', hint: flourLabel, amount: `${result.flour}g`, pct: '100%' },
    {
      name: 'Water',
      hint: 'Cold, under 60°F',
      amount: `${result.water}g`,
      pct: hydrationPct(result.hydration),
    },
    {
      name: 'Yeast',
      hint: 'Active dry',
      amount: `${formatYeast(result.yeast)}g`,
      pct: '0.4%',
    },
    { name: 'Salt', hint: '', amount: `${result.salt}g`, pct: '2.5%' },
    { name: 'Sugar', hint: '', amount: `${result.sugar}g`, pct: '2%' },
    { name: 'Olive oil', hint: '', amount: `${result.oil}g`, pct: '3.3%' },
  ]

  function buildRecipeText() {
    const lines = [
      `Pizza Dough — ${qty}x ${size}" ${THICKNESS_LABELS[thickness]}${glutenFree ? ' (GF)' : ''} · ${hydration}% hydration`,
      '',
      'INGREDIENTS',
      ...ingredients.map((i) => `  ${i.name}: ${i.amount} (${i.pct})`),
      '',
      'INSTRUCTIONS',
      ...steps.map((s, i) => `  ${i + 1}. ${s}`),
      '',
      `Dough ball weight: ~${result.ballWeight}g each`,
    ]
    return lines.join('\n')
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(buildRecipeText())
      setCopied(true)
      setCopyError(false)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopyError(true)
      setTimeout(() => setCopyError(false), 3000)
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 px-4 py-8">
      <div>
        <h1 className="text-2xl font-bold">Pizza Dough Calculator</h1>
        <p className="mt-1 text-muted-foreground text-sm">
          Exact ingredients for homemade pizza dough, adapted from doughguy.co
        </p>
      </div>

      {/* ── Inputs ─────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>Settings</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Size */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="size-slider">Pizza size</Label>
              <span className="font-semibold text-primary">{size}&quot;</span>
            </div>
            <Slider id="size-slider" min={10} max={20} step={1} value={[size]} onValueChange={([v]) => setSize(v)} />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>10&quot;</span>
              <span>20&quot;</span>
            </div>
          </div>

          {/* Qty */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="qty-slider">Number of pizzas</Label>
              <span className="font-semibold text-primary">{qty}</span>
            </div>
            <Slider id="qty-slider" min={1} max={10} step={1} value={[qty]} onValueChange={([v]) => setQty(v)} />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>1</span>
              <span>10</span>
            </div>
          </div>

          {/* Hydration */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="hydration-slider">Hydration</Label>
              <span className="font-semibold text-primary">{hydration}%</span>
            </div>
            <Slider
              id="hydration-slider"
              min={50}
              max={90}
              step={1}
              value={[hydration]}
              onValueChange={([v]) => setHydration(v)}
            />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>50%</span>
              <span>70%</span>
              <span>90%</span>
            </div>
            <p className="text-xs text-muted-foreground">
              {glutenFree
                ? '80% = GF standard · higher values increase open crumb'
                : '62% = classic NY · 70%+ = airy, harder to handle'}
            </p>
          </div>

          {/* Thickness */}
          <div className="space-y-2">
            <Label>Thickness</Label>
            <ToggleGroup
              type="single"
              value={thickness}
              onValueChange={(v) => {
                if (v) setThickness(v as ThicknessName)
              }}
            >
              {(['thin', 'regular', 'thick'] as ThicknessName[]).map((t) => (
                <ToggleGroupItem key={t} value={t} className="flex-1">
                  {THICKNESS_LABELS[t]}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>

          {/* Gluten Free */}
          <div className="flex items-center gap-3">
            <Checkbox
              id="gf-check"
              checked={glutenFree}
              onCheckedChange={(v) => setGlutenFree(Boolean(v))}
            />
            <Label htmlFor="gf-check" className="cursor-pointer">
              Gluten free
            </Label>
          </div>
        </CardContent>
      </Card>

      {/* ── Stat cards ─────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: 'Dough ball', value: `${result.ballWeight}g`, sub: 'each' },
          { label: 'Total flour', value: `${result.flour}g`, sub: '' },
          { label: 'Total water', value: `${result.water}g`, sub: '' },
          { label: 'Hydration', value: hydrationPct(result.hydration), sub: '' },
        ].map(({ label, value, sub }) => (
          <Card key={label}>
            <CardContent className="p-4 text-center">
              <div className="text-2xl font-bold text-primary">{value}</div>
              <div className="text-xs text-muted-foreground">
                {label}
                {sub ? ` ${sub}` : ''}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* ── Ingredient table ───────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>Ingredients</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50 text-muted-foreground text-left">
                <th className="px-4 py-2 font-medium">Ingredient</th>
                <th className="px-4 py-2 font-medium text-right">Amount</th>
                <th className="px-4 py-2 font-medium text-right">Baker&apos;s %</th>
              </tr>
            </thead>
            <tbody>
              {ingredients.map((row, idx) => (
                <tr key={row.name} className={idx < ingredients.length - 1 ? 'border-b' : ''}>
                  <td className="px-4 py-2">
                    <div className="font-medium">{row.name}</div>
                    {row.hint && <div className="text-xs text-muted-foreground">{row.hint}</div>}
                  </td>
                  <td className="px-4 py-2 text-right font-mono">{row.amount}</td>
                  <td className="px-4 py-2 text-right text-muted-foreground">{row.pct}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* ── Info pills ────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-2">
        <span className="rounded-full border border-secondary/40 bg-secondary/10 px-3 py-1 text-xs font-medium text-secondary">
          {glutenFree ? 'Gluten-free' : 'Regular dough'}
        </span>
        <span className="rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
          {glutenFree ? 'Cold rest up to 48hrs' : 'Cold ferment 2–4 days'}
        </span>
        <span className="rounded-full border border-muted-foreground/30 bg-muted px-3 py-1 text-xs text-muted-foreground">
          {qty} {qty === 1 ? 'ball' : 'balls'} · {size}&quot; · {THICKNESS_LABELS[thickness]}
        </span>
      </div>

      {/* ── Pro tip ───────────────────────────────────────────── */}
      {tip && (
        <div className="rounded-lg border border-secondary/50 bg-secondary/10 px-4 py-3 text-sm text-secondary-foreground">
          <span className="font-semibold text-secondary">💡 Pro tip: </span>
          {tip}
        </div>
      )}

      {/* ── Instructions ──────────────────────────────────────── */}
      <Collapsible open={instructionsOpen} onOpenChange={setInstructionsOpen}>
        <Card>
          <CollapsibleTrigger asChild>
            <button className="flex w-full items-center justify-between p-6 text-left hover:bg-muted/30 transition-colors rounded-lg">
              <span className="font-semibold">Dough making instructions</span>
              {instructionsOpen ? (
                <ChevronUp className="h-4 w-4 text-muted-foreground" />
              ) : (
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              )}
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CardContent className="pt-0">
              <ol className="space-y-2 text-sm">
                {steps.map((step, i) => (
                  <li key={i} className="flex gap-3">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                      {i + 1}
                    </span>
                    <span className="leading-relaxed">{step}</span>
                  </li>
                ))}
              </ol>
            </CardContent>
          </CollapsibleContent>
        </Card>
      </Collapsible>

      {/* ── Copy button ────────────────────────────────────────── */}
      <Button onClick={handleCopy} variant="outline" className="w-full gap-2">
        {copied ? (
          <>
            <Check className="h-4 w-4 text-green-500" />
            <span className="text-green-500">Copied!</span>
          </>
        ) : copyError ? (
          <span className="text-destructive text-red-500">
            Copy failed — try selecting the text manually
          </span>
        ) : (
          <>
            <Copy className="h-4 w-4" />
            Copy recipe
          </>
        )}
      </Button>
    </div>
  )
}
