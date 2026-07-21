import { lazy, type ComponentType } from 'react'

export interface ToolDef {
  id: string
  category: string
  title: string
  description: string
  keywords: string[]
  component: ReturnType<typeof lazy<ComponentType>>
}

export const tools: ToolDef[] = [
  {
    id: 'color-converter',
    category: 'Colors',
    title: 'Color Converter',
    description:
      'Convert any color between HEX, RGB, RGBA, HSL, HSB, CMYK, and more. Includes live sliders, shade/tint palette, and one-click copy for every format.',
    keywords: [
      'color',
      'hex',
      'rgb',
      'hsl',
      'hsb',
      'hsv',
      'cmyk',
      'converter',
      'palette',
      'picker',
      'css',
      'tailwind',
    ],
    component: lazy(() => import('./colors/color-converter/index')),
  },
  {
    id: 'pizza-dough',
    category: 'Food',
    title: 'Pizza Dough Calculator',
    description:
      'Calculate exact ingredient amounts for homemade pizza dough. Supports thin, regular, and thick crust; gluten-free option included.',
    keywords: ['pizza', 'dough', 'recipe', 'flour', 'baking', 'food', 'ingredients'],
    component: lazy(() => import('./food/pizza-dough/index')),
  },
  {
    id: 'pepperoni-rolls',
    category: 'Food',
    title: 'Pepperoni Rolls Calculator',
    description:
      "Calculate exact ingredient amounts for homemade pepperoni roll dough using baker's percentages. Bakes at 475°F for 12 minutes; brush with garlic butter after.",
    keywords: [
      'pepperoni',
      'rolls',
      'bread',
      'dough',
      'recipe',
      'flour',
      'baking',
      'food',
      'ingredients',
      'garlic butter',
    ],
    component: lazy(() => import('./food/pepperoni-rolls/index')),
  },
  {
    id: 'llano-castell',
    category: 'Rivers',
    title: 'Llano River @ Castell',
    description:
      'Trip planner for Kevin\'s annual Castell fishing trip. Live USGS gauge data, Castell flow estimate (no gauge there — interpolated via DAR), per-day forecast, wading verdict, and 10-year history chart.',
    keywords: [
      'llano',
      'river',
      'texas',
      'usgs',
      'gauge',
      'cfs',
      'water level',
      'castell',
      'fishing',
      'wading',
      'forecast',
      'recession',
    ],
    component: lazy(() => import('./rivers/llano-castell/index')),
  },
]

/** Unique categories in display order */
export const categories = [...new Set(tools.map((t) => t.category))]

/** Look up a tool by id */
export function getToolById(id: string): ToolDef | undefined {
  return tools.find((t) => t.id === id)
}
