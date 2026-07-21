export type ThicknessName = 'thin' | 'regular' | 'thick'

export const THICKNESS_FACTORS: Record<ThicknessName, number> = {
  thin: 1.8,
  regular: 2.11,
  thick: 2.75,
}

export interface DoughInputs {
  size: number // inches, 10–20
  qty: number // number of pizzas, 1–10
  thickness: ThicknessName
  glutenFree: boolean
}

export interface DoughResult {
  flour: number // grams (rounded)
  water: number // grams (rounded)
  yeast: number // grams (1 decimal)
  salt: number // grams (rounded)
  sugar: number // grams (rounded)
  oil: number // grams (rounded)
  ballWeight: number // grams per ball (rounded)
  hydration: number // fraction (e.g. 0.62)
}

// Constants derived from doughguy.co
// BASE_FLOUR_REGULAR is the scaled flour used for ingredient amounts (~1705g at defaults)
const BASE_FLOUR_REGULAR = 1509.797685 * (480 / 425)
// BASE_FLOUR_BALL_REGULAR is the unscaled baseline used for ball weight, so that
//   ballWeight = round(1509.797685 * doughFactor / 6) = round(2550/6) = 425
const BASE_FLOUR_BALL_REGULAR = 1509.797685
const BASE_FLOUR_GF = 333 * 6
// doughFactor represents total dough weight per gram of (unscaled) base flour
const DOUGH_FACTOR = 2550 / 1509.797685

export function calcDough(inputs: DoughInputs): DoughResult {
  const { size, qty, thickness, glutenFree } = inputs
  const thicknessFactor = THICKNESS_FACTORS[thickness]
  const scaleFactor = Math.pow(size / 16, 2) * (qty / 6) * (thicknessFactor / 2.11)

  // Recipe flour (scaled for ingredient amounts)
  const baseFlour = glutenFree ? BASE_FLOUR_GF : BASE_FLOUR_REGULAR
  const flour = baseFlour * scaleFactor

  const hydration = glutenFree ? 0.8 : 0.62
  const water = Math.round(flour * hydration)
  const yeast = flour * 0.004
  const salt = Math.round(flour * 0.025)
  const sugar = Math.round(flour * 0.02)
  const oil = Math.round(flour * 0.033)

  // Ball weight uses the same DOUGH_FACTOR (2550 / BASE_FLOUR_BALL_REGULAR).
  // For regular dough: this gives exactly 425g/ball at defaults, matching doughguy.co.
  // For GF dough: we apply the same factor to keep the displayed ball weight proportional
  // to flour amount (and consistent with the stat cards). Note the GF ingredient sum per
  // ball will be slightly higher due to 80% hydration; the displayed weight reflects the
  // doughguy.co convention for reference, not a scale-verified figure.
  const ballBaseFlour = glutenFree ? BASE_FLOUR_GF : BASE_FLOUR_BALL_REGULAR
  const ballWeight = Math.round((ballBaseFlour * scaleFactor * DOUGH_FACTOR) / qty)

  return {
    flour: Math.round(flour),
    water,
    yeast,
    salt,
    sugar,
    oil,
    ballWeight,
    hydration,
  }
}

export function formatYeast(grams: number): string {
  return grams.toFixed(1)
}

export function hydrationPct(hydration: number): string {
  return Math.round(hydration * 100) + '%'
}

export function getProTip(inputs: DoughInputs): string | null {
  const { glutenFree, size, qty, thickness } = inputs
  if (glutenFree) return 'GF dough is stickier — oil your hands before shaping.'
  if (size >= 18)
    return 'Preheat your oven and stone/steel for at least 1 hour at max temp for big pies.'
  if (qty >= 8)
    return 'Making a big batch? Dough balls keep up to 4 days in the fridge in separate covered containers.'
  if (thickness === 'thick') return 'Drop to 450°F and give it 10–12 min instead of 6–8.'
  if (thickness === 'thin') return 'Thin crust cooks fast — 4–5 minutes. Watch it closely.'
  return null
}

export const REGULAR_STEPS = [
  'Cool water to under 60°F (ice water works well).',
  'Mix water and active dry yeast; let stand 5 minutes.',
  'Add bread flour and olive oil; mix on low for 2 minutes.',
  'Add sugar and salt on low speed.',
  'Mix for 10 more minutes until smooth and elastic.',
  'Cover and rest at room temperature for 1–3 hours.',
  'Divide into balls, seal the seam, and smooth.',
  'Refrigerate in covered containers for 2–4 days (3 is ideal).',
  'Remove from fridge and bring to room temperature before stretching.',
]

export const GF_STEPS = [
  'Add cold water and active dry yeast to your mixing bowl.',
  'Add GF flour (Caputo GF recommended) and olive oil; mix on low for 2 minutes.',
  'Add sugar and salt; mix for 3–4 minutes until well combined.',
  'Refrigerate the dough for 15 minutes to firm up.',
  'Oil your hands, divide, and shape into smooth balls.',
  'Refrigerate in covered containers for up to 48 hours.',
  'Remove from fridge and bring to room temperature before using.',
]
