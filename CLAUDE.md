# Simple Utilities — CLAUDE.md

## Project overview

A single-page frontend-only app hosting small utility tools, organised by category.
No backend, no database. State persists via localStorage. May call public APIs from individual tools.

## Tech stack

| Concern             | Library                                                                                     |
| ------------------- | ------------------------------------------------------------------------------------------- |
| Framework           | React 19 + TypeScript (strict)                                                              |
| Build / dev server  | Vite 8                                                                                      |
| Styling             | Tailwind CSS v4 (CSS-first, `@import "tailwindcss"`, OKLCH tokens, no `tailwind.config.js`) |
| UI components       | shadcn/ui (new-york style) on `radix-ui`                                                    |
| Routing             | React Router v7 (import from `react-router`)                                                |
| State / persistence | Zustand v5 with `persist` middleware                                                        |
| Validation          | Zod v4 (localStorage reads, API responses)                                                  |
| Testing             | Vitest v3 + Testing Library                                                                 |
| Lint / format       | ESLint 9 (flat config) + Prettier                                                           |

> Tool-specific libraries (e.g. CodeMirror, react-markdown, gpt-tokenizer) are listed in each
> tool's own folder — check the source files there, not here.

## Commands

```powershell
npm install          # Install deps
npm run dev          # Dev server (hot reload)
npm run build        # Type-check + production build
npm test             # Run all tests once
npm run test:watch   # Tests in watch mode
npm run lint         # Lint
npm run format       # Format
```

## Architecture

```
src/
  app/              # Shell: Layout, routing, Header, theme toggle
  lib/              # cn() helper, Zustand theme store
  components/ui/    # shadcn/ui components — source of truth is the files themselves
  tools/
    registry.ts     # THE source of truth for all tools, routes, and nav
    <category>/
      <tool-id>/    # One folder per tool — see src/tools/CLAUDE.md for the pattern
  main.tsx
  index.css         # Tailwind v4 @import + @theme inline + OKLCH tokens
```

**Always check `registry.ts` for the current tool list — do not rely on documentation.**
**Always check `src/components/ui/` for the current shadcn component list — do not rely on documentation.**

## Theming

Theme is controlled via a CSS class on `<html>`: no class or `.light` = light mode; `.dark` = dark mode.

Colors are **OKLCH** CSS variables defined in `src/index.css`, exposed to Tailwind via `@theme inline`.
Use semantic utility classes everywhere (`bg-background`, `text-muted-foreground`, etc.) — never hardcode raw colors.
The full token set is the source of truth in `src/index.css`.

Theme choice is stored in localStorage under key `su:theme`.

## shadcn/ui components

Components live in `src/components/ui/` and are managed by the shadcn CLI.

```powershell
npx shadcn@latest add <name>   # Add or update a component
```

**Never hand-roll shadcn components.** Always use the CLI.
The installed component list is whatever is in `src/components/ui/` — that is the source of truth.

All components import from the unified `radix-ui` package (not individual `@radix-ui/*` packages).

### Slider API gotcha

The shadcn Slider uses the Radix array API. Always pass arrays:

```tsx
<Slider value={[n]} onValueChange={([v]) => setState(v)} min={0} max={100} step={1} />
```

## Tool registry pattern

Every tool is a folder under `src/tools/<category>/<tool-id>/` plus one entry in `registry.ts`.
Routes, the home-page grid, and the nav are all derived from `registry.ts` automatically.
See `src/tools/CLAUDE.md` for step-by-step instructions on adding a new tool.

## localStorage key convention

All keys are prefixed `su:` to avoid collisions. Each tool's `store.ts` is the source of truth
for its own key. The only global key is `su:theme`.

## Constraints

- Frontend only — no server-side code, no build-time secrets
- All localStorage reads must be validated with Zod before use
- Every tool with non-trivial logic gets a `logic.test.ts`
- Import from `react-router` (not `react-router-dom` — that is the legacy v6 package)

## PWA

Installable PWA via `vite-plugin-pwa` (see `vite.config.ts` for the full config):

- Workbox `generateSW` with `autoUpdate`; all built assets precached; SPA falls back to `index.html`
- Service worker only generated in production builds — dev mode is unaffected
- Manifest, icons, and runtime caching rules are all in `vite.config.ts`
