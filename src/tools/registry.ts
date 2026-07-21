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
    id: 'pizza-dough',
    category: 'Food',
    title: 'Pizza Dough Calculator',
    description:
      'Calculate exact ingredient amounts for homemade pizza dough. Supports thin, regular, and thick crust; gluten-free option included.',
    keywords: ['pizza', 'dough', 'recipe', 'flour', 'baking', 'food', 'ingredients'],
    component: lazy(() => import('./food/pizza-dough/index')),
  },
  {
    id: 'llano-castell',
    category: 'Rivers',
    title: 'Llano River @ Castell',
    description:
      'River level and CFS readings for the Llano River at Castell, TX (USGS gauge 08150700).',
    keywords: ['llano', 'river', 'texas', 'usgs', 'gauge', 'cfs', 'water level', 'castell'],
    component: lazy(() => import('./rivers/llano-castell/index')),
  },
]

/** Unique categories in display order */
export const categories = [...new Set(tools.map((t) => t.category))]

/** Look up a tool by id */
export function getToolById(id: string): ToolDef | undefined {
  return tools.find((t) => t.id === id)
}
