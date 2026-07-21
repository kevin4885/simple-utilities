# Simple Utilities — CLAUDE.md

## Project overview

A single-page frontend-only app hosting small utility tools, organised by category.
No backend, no database. State persists via localStorage. May call public APIs from individual tools.

## Tech stack

| Concern             | Library                                      |
| ------------------- | -------------------------------------------- |
| Framework           | React 18 + TypeScript (strict)               |
| Build / dev server  | Vite 6                                       |
| Styling             | Tailwind CSS v3 (CSS variable tokens)        |
| UI primitives       | Radix UI (only the components actually used) |
| Routing             | React Router v6                              |
| State / persistence | Zustand v5 with `persist` middleware         |
| Validation          | Zod (localStorage reads, API responses)      |
| Testing             | Vitest + Testing Library                     |
| Lint / format       | ESLint 9 (flat config) + Prettier            |

## Commands

```powershell
# Install
npm install

# Dev server (hot reload)
npm run dev

# Type-check + production build
npm run build

# Run all tests once
npm test

# Run tests in watch mode
npm run test:watch

# Lint
npm run lint

# Format
npm run format
```

## Architecture

```
src/
  app/              # Shell: Layout, routing, Header, theme toggle
    App.tsx         # BrowserRouter + Routes + Suspense wrapper
    Header.tsx      # Sticky header: title, category nav, theme toggle
    HomePage.tsx    # Tool grid grouped by category
    ToolPage.tsx    # Lazy-loads a tool by registry id
    NotFoundPage.tsx
  lib/
    utils.ts        # cn() helper (clsx + tailwind-merge)
    theme.ts        # Zustand theme store + initTheme()
  components/
    ui/             # Shared UI components (button, card, slider, checkbox, etc.)
  tools/
    registry.ts     # THE source of truth — all tools declared here
    food/
      pizza-dough/
        index.tsx      # Pizza Dough Calculator UI
        logic.ts       # Pure dough math functions
        logic.test.ts  # Vitest unit tests
        store.ts       # Zustand persist store (key: su:pizza-dough)
      pepperoni-rolls/
        index.tsx      # Pepperoni Rolls Calculator UI
        logic.ts       # Pure dough math functions
        logic.test.ts  # Vitest unit tests
        store.ts       # Zustand persist store (key: su:pepperoni-rolls)
    rivers/
      llano-castell/
        index.tsx      # Llano @ Castell trip tool (live USGS + DAR forecast + history chart)
        logic.ts       # Pure functions: trip window, DAR interpolation, MRC, wading
        logic.test.ts  # 88 Vitest unit tests (incl. cross-check acceptance tests)
        schemas.ts     # Zod schemas for USGS IV API response + localStorage cache
        store.ts       # Zustand persist store (key: su:llano-castell)
        useGaugeData.ts # React hook: USGS fetch + 15-min cache + stale detection
        HistoryChart.tsx # Hand-rolled SVG log-scale bar chart (11 years + forecast)
        trip_stats.json  # Static: 10 historical trip years (exported from llano repo)
        mrc_params.json  # Static: MRC τ params + DAR constants (exported from llano repo)
  main.tsx
  index.css         # Tailwind directives + CSS variable tokens
  test-setup.ts     # Vitest + Testing Library global setup
```

## Theming

Theme is controlled via a CSS class on `<html>`:

- No class / `.light` → light mode
- `.dark` → dark mode

### Token reference

| Token                      | Light                           | Dark                            |
| -------------------------- | ------------------------------- | ------------------------------- |
| `--background`             | `0 0% 98%`                      | `220 45% 10%` (navy `~#0a1428`) |
| `--foreground`             | `222 47% 11%`                   | `36 27% 91%` (warm off-white)   |
| `--primary`                | `221 83% 53%` (blue `#2563eb`)  | `43 68% 52%` (gold `#d4af37`)   |
| `--secondary` / `--accent` | `25 95% 53%` (orange `#f97316`) | same                            |
| `--card`                   | `0 0% 100%`                     | `220 40% 14%`                   |
| `--muted`                  | `210 40% 94%`                   | `220 35% 18%`                   |
| `--border` / `--input`     | `214 32% 88%`                   | `220 30% 22%`                   |

Tokens are consumed by Tailwind config (`tailwind.config.js`) so you can use
`bg-primary`, `text-primary-foreground`, `border-border`, etc. anywhere.

Theme choice is stored in localStorage under key `su:theme`.

## Tool registry pattern

Every tool is:

1. A folder under `src/tools/<category>/<tool-id>/`
2. A single entry in `src/tools/registry.ts`

Routes (`/tools/:id`), the home-page grid, and the nav are all derived from `registry.ts`.
See `src/tools/CLAUDE.md` for step-by-step instructions on adding a new tool.

## localStorage key convention

All keys are prefixed `su:` to avoid collisions.

- `su:theme` — theme preference
- `su:pizza-dough` — Pizza Dough Calculator inputs
- `su:pepperoni-rolls` — Pepperoni Rolls Calculator inputs
- `su:llano-castell` — Llano @ Castell: cached USGS gauge readings (P7D) + fetch timestamp

## Constraints

- Frontend only — no server-side code, no build-time secrets
- Keep Radix imports minimal — only add what a component actually uses
- All localStorage reads must be validated with Zod before use
- Every tool with non-trivial logic gets a `logic.test.ts`
