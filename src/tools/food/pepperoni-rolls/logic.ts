/** Baker's percentages for pepperoni roll dough (flour = 100%). */
export const BAKER_PERCENTAGES = {
  flour: 1.0,
  water: 0.63,
  oil: 0.04,
  sugar: 0.03,
  salt: 0.02,
  yeast: 0.008,
} as const

/** Sum of all baker's percentages (used to derive flour from total dough weight). */
export const SUM_OF_PERCENTAGES =
  BAKER_PERCENTAGES.flour +
  BAKER_PERCENTAGES.water +
  BAKER_PERCENTAGES.oil +
  BAKER_PERCENTAGES.sugar +
  BAKER_PERCENTAGES.salt +
  BAKER_PERCENTAGES.yeast // 1.728

/**
 * Fractional scaling loss applied to account for dough sticking to bowl/hands.
 * total dough needed = target / (1 - SCALING_LOSS)
 */
export const SCALING_LOSS = 0.02

/** Baking temperature in °F. */
export const BAKE_TEMP_F = 475

/** Baking time in minutes. */
export const BAKE_TIME_MIN = 12

export interface RollsInputs {
  rolls: number // number of rolls, ≥ 1
  ballWeight: number // grams per roll, ≥ 1
}

export interface RollsResult {
  flour: number // grams (rounded)
  water: number // grams (rounded)
  oil: number // grams (rounded)
  sugar: number // grams (rounded)
  salt: number // grams (rounded)
  yeast: number // grams (1 decimal — raw float; use formatYeast() to display)
  totalDough: number // grams (rounded) — actual dough prepared including loss buffer
  targetDough: number // grams (rounded) — rolls × ballWeight (intended yield)
}

/**
 * Calculate pepperoni roll dough ingredient amounts.
 *
 * Formula:
 *   targetDough = rolls × ballWeight
 *   totalDough  = targetDough / (1 − SCALING_LOSS)  ← adds loss buffer
 *   flour       = totalDough / SUM_OF_PERCENTAGES
 *   each ingredient = flour × its baker's percentage
 */
export function calcRolls(inputs: RollsInputs): RollsResult {
  const { rolls, ballWeight } = inputs
  const targetDough = rolls * ballWeight
  const totalDough = targetDough / (1 - SCALING_LOSS)

  const flourExact = totalDough / SUM_OF_PERCENTAGES

  const flour = Math.round(flourExact)
  const water = Math.round(flourExact * BAKER_PERCENTAGES.water)
  const oil = Math.round(flourExact * BAKER_PERCENTAGES.oil)
  const sugar = Math.round(flourExact * BAKER_PERCENTAGES.sugar)
  const salt = Math.round(flourExact * BAKER_PERCENTAGES.salt)
  const yeast = flourExact * BAKER_PERCENTAGES.yeast // keep as float; display with formatYeast()

  return {
    flour,
    water,
    oil,
    sugar,
    salt,
    yeast,
    totalDough: Math.round(totalDough),
    targetDough: Math.round(targetDough),
  }
}

/** Format yeast weight to 1 decimal place (matches pizza-dough pattern). */
export function formatYeast(grams: number): string {
  return grams.toFixed(1)
}

export const ROLL_STEPS = [
  'Warm the water to ~90°F (feels comfortably warm to the touch).',
  'Combine warm water, yeast, and sugar; stir and let stand 5 minutes until foamy.',
  'Add bread flour, olive oil, and salt; mix on low for 2 minutes.',
  'Knead on medium speed for 8–10 minutes until smooth and slightly tacky.',
  'Cover and let rise at room temperature for 1–1½ hours until doubled.',
  'Punch down and divide into dough balls of the chosen weight.',
  'Flatten each ball, add pepperoni filling, fold and pinch seams tightly.',
  'Place on parchment-lined sheet pans, seam-side down.',
  'Cover and proof 30 minutes while oven preheats to 475°F.',
  'Bake for 12 minutes until deep golden brown.',
  'Brush immediately with garlic butter after baking.',
]
