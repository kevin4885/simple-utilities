import { useState } from 'react'
import { ChevronDown, ChevronUp, Copy, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import {
  calcRolls,
  formatYeast,
  BAKER_PERCENTAGES,
  BAKE_TEMP_F,
  BAKE_TIME_MIN,
  ROLL_STEPS,
} from './logic'
import { usePepperoniRollsStore } from './store'

export default function PepperoniRollsPage() {
  const { rolls, ballWeight, setRolls, setBallWeight } = usePepperoniRollsStore()

  const [instructionsOpen, setInstructionsOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const [copyError, setCopyError] = useState(false)

  const result = calcRolls({ rolls, ballWeight })

  const ingredients: Array<{ name: string; hint: string; amount: string; pct: string }> = [
    { name: 'Bread Flour', hint: '12–14% protein', amount: `${result.flour}g`, pct: '100%' },
    {
      name: 'Water',
      hint: 'Warm, ~90°F',
      amount: `${result.water}g`,
      pct: `${Math.round(BAKER_PERCENTAGES.water * 100)}%`,
    },
    {
      name: 'Olive Oil',
      hint: '',
      amount: `${result.oil}g`,
      pct: `${Math.round(BAKER_PERCENTAGES.oil * 100)}%`,
    },
    {
      name: 'Sugar',
      hint: 'Or honey',
      amount: `${result.sugar}g`,
      pct: `${Math.round(BAKER_PERCENTAGES.sugar * 100)}%`,
    },
    {
      name: 'Fine Sea Salt',
      hint: '',
      amount: `${result.salt}g`,
      pct: `${Math.round(BAKER_PERCENTAGES.salt * 100)}%`,
    },
    {
      name: 'Instant Dry Yeast',
      hint: '',
      amount: `${formatYeast(result.yeast)}g`,
      pct: `${(BAKER_PERCENTAGES.yeast * 100).toFixed(1)}%`,
    },
  ]

  function buildRecipeText() {
    const lines = [
      `Pepperoni Rolls — ${rolls} rolls · ${ballWeight}g each`,
      '',
      `Total dough: ${result.totalDough}g (includes 2% scaling-loss buffer)`,
      `Bake: ${BAKE_TEMP_F}°F for ${BAKE_TIME_MIN} min · brush with garlic butter after baking`,
      '',
      "INGREDIENTS (baker's percentages)",
      ...ingredients.map((i) => `  ${i.name}: ${i.amount} (${i.pct})`),
      '',
      'INSTRUCTIONS',
      ...ROLL_STEPS.map((s, i) => `  ${i + 1}. ${s}`),
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
        <h1 className="text-2xl font-bold">Pepperoni Rolls Calculator</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Exact ingredient amounts for homemade pepperoni roll dough using baker&apos;s percentages.
          Bake at {BAKE_TEMP_F}°F for {BAKE_TIME_MIN} min; brush with garlic butter after.
        </p>
      </div>

      {/* ── Inputs ─────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>Settings</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Number of rolls */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="rolls-slider">Number of rolls</Label>
              <span className="font-semibold text-primary">{rolls}</span>
            </div>
            <Slider
              id="rolls-slider"
              min={1}
              max={96}
              step={1}
              value={rolls}
              onChange={setRolls}
            />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>1</span>
              <span>48</span>
              <span>96</span>
            </div>
          </div>

          {/* Dough ball weight */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="weight-slider">Dough ball weight</Label>
              <span className="font-semibold text-primary">{ballWeight}g</span>
            </div>
            <Slider
              id="weight-slider"
              min={30}
              max={300}
              step={5}
              value={ballWeight}
              onChange={setBallWeight}
            />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>30g</span>
              <span>165g</span>
              <span>300g</span>
            </div>
            <p className="text-xs text-muted-foreground">
              80g = standard dinner roll · 100g+ = heartier, deli-style roll
            </p>
          </div>
        </CardContent>
      </Card>

      {/* ── Stat cards ─────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: 'Rolls', value: `${rolls}`, sub: 'count' },
          { label: 'Each ball', value: `${ballWeight}g`, sub: 'target' },
          { label: 'Total dough', value: `${result.totalDough}g`, sub: 'w/ buffer' },
          { label: 'Total flour', value: `${result.flour}g`, sub: '' },
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
              <tr className="border-b bg-muted/50 text-left text-muted-foreground">
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

      {/* ── Info pills ─────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-2">
        <span className="rounded-full border border-secondary/40 bg-secondary/10 px-3 py-1 text-xs font-medium text-secondary">
          {rolls} {rolls === 1 ? 'roll' : 'rolls'} · {ballWeight}g each
        </span>
        <span className="rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
          Bake {BAKE_TEMP_F}°F · {BAKE_TIME_MIN} min
        </span>
        <span className="rounded-full border border-muted-foreground/30 bg-muted px-3 py-1 text-xs text-muted-foreground">
          Garlic butter finish
        </span>
      </div>

      {/* ── Instructions ──────────────────────────────────────── */}
      <Collapsible open={instructionsOpen} onOpenChange={setInstructionsOpen}>
        <Card>
          <CollapsibleTrigger asChild>
            <button className="flex w-full items-center justify-between rounded-lg p-6 text-left transition-colors hover:bg-muted/30">
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
                {ROLL_STEPS.map((step, i) => (
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
          <span className="text-destructive">
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
