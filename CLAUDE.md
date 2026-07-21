# Simple Utilities — CLAUDE.md

## Project overview

A single-page frontend-only app hosting small utility tools, organised by category.
No backend, no database. State persists via localStorage. May call public APIs from individual tools.

## Tech stack

| Concern             | Library                                      |
| ------------------- | -------------------------------------------- |
| Framework           | React 19 + TypeScript (strict)               |
| Build / dev server  | Vite 8                                       |
| Styling             | Tailwind CSS v4 (CSS-first, `@import "tailwindcss"`, OKLCH tokens, no `tailwind.config.js`) |
| UI components       | shadcn/ui (new-york style) on `radix-ui`     |
| Routing             | React Router v7 (import from `react-router`) |
| State / persistence | Zustand v5 with `persist` middleware         |
| Validation          | Zod v4 (localStorage reads, API responses)   |
| Testing             | Vitest v3 + Testing Library                  |
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
    App.tsx         # BrowserRouter + Routes (react-router v7)
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
  index.css         # Tailwind v4: @import + @theme inline + OKLCH tokens (no tailwind.config.js)
  test-setup.ts     # Vitest + Testing Library global setup
```

## Theming

Theme is controlled via a CSS class on `<html>`:

- No class / `.light` → light mode
- `.dark` → dark mode

Colors are defined as **OKLCH** CSS variables in `src/index.css` and exposed to Tailwind
via `@theme inline`. Use semantic utilities everywhere — never hardcode raw colors.

### Token reference

| Token                      | Light                           | Dark                            |
| -------------------------- | ------------------------------- | ------------------------------- |
| `--background`             | `oklch(0.9848 0.0001 263.3)`    | `oklch(0.177 0.032 264.5)` (navy) |
| `--foreground`             | `oklch(0.2064 0.0388 265.6)`    | `oklch(0.9367 0.0112 78.2)` (warm white) |
| `--primary`                | `oklch(0.5449 0.2154 262.7)` (blue) | `oklch(0.7574 0.1398 85.8)` (gold) |
| `--secondary` / `--accent` | `oklch(0.7066 0.1859 48.1)` (orange) | same                        |
| `--card`                   | `oklch(1.0 0.0 0)`              | `oklch(0.225 0.0487 264.1)`     |
| `--muted`                  | `oklch(0.9514 0.0106 248.1)`    | `oklch(0.2799 0.0426 263.5)`    |
| `--border` / `--input`     | `oklch(0.9008 0.0178 255.1)`    | `oklch(0.177 / 0.3195 ...)`     |

Theme choice is stored in localStorage under key `su:theme`.

## shadcn/ui components

Components live in `src/components/ui/` and are managed by the shadcn CLI (`components.json`).
To add a new component: `npx shadcn@latest add <name>`

Current components: `button`, `card`, `checkbox`, `collapsible`, `label`, `slider`, `toggle`, `toggle-group`

All components import from the unified `radix-ui` package (not individual `@radix-ui/*` packages).

### Slider API
The shadcn Slider uses the Radix array API. Always pass arrays:
```tsx
<Slider value={[n]} onValueChange={([v]) => setState(v)} min={0} max={100} step={1} />
```

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
- Add shadcn components via CLI (`npx shadcn@latest add <name>`), never hand-roll them
- All localStorage reads must be validated with Zod before use
- Every tool with non-trivial logic gets a `logic.test.ts`
- Import from `react-router` (not `react-router-dom` — that is the legacy v6 package)
