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
  app/              # Shell: Layout, routing, Header, theme toggle, CommandPalette
  lib/              # cn() helper, Zustand theme store, search.ts (Fuse.js tool search)
  components/
    ui/             # shadcn/ui components — source of truth is the files themselves
    editor/         # Shared editor components: CodeEditor, MarkdownRenderer (see editor/CLAUDE.md)
  tools/
    registry.ts     # THE source of truth for all tools, routes, and nav
    <category>/
      <tool-id>/    # One folder per tool — see src/tools/CLAUDE.md for the pattern
  main.tsx
  index.css         # Tailwind v4 @import + @theme inline + OKLCH tokens
```

## Command palette (global tool search)

A Ctrl+K / Cmd+K command palette is mounted once in `App.tsx` and provides fuzzy
search across all tools via Fuse.js.

- **Search logic:** `src/lib/search.ts` — exports `searchTools(query)` backed by a
  Fuse.js index over all tools with weighted keys (title 0.5, keywords 0.35,
  description 0.15). Empty query returns all tools in registry order; non-empty
  returns ranked fuzzy matches.
- **UI:** `src/app/CommandPalette.tsx` — uses shadcn `CommandDialog` pattern
  (Dialog + Command with `shouldFilter={false}`) so Fuse drives filtering.
  Results are grouped by category, ranked by Fuse score within each group.
- **Trigger:** search button in `Header.tsx` (Search icon + "Search tools…" label +
  Ctrl+K / ⌘K hint). Keyboard shortcut is also registered globally in `App.tsx`.

**Always check `registry.ts` for the current tool list — do not rely on documentation.**
**Always check `src/components/ui/` for the current shadcn component list — do not rely on documentation.**

## Theming

Theme is controlled via a CSS class on `<html>`: no class or `.light` = light mode; `.dark` = dark mode.

Colors are **OKLCH** CSS variables defined in `src/index.css`, exposed to Tailwind via `@theme inline`.
Use semantic utility classes everywhere (`bg-background`, `text-muted-foreground`, etc.) — never hardcode raw colors.
The full token set is the source of truth in `src/index.css`.

Theme choice is stored in localStorage under key `su:theme`.

### Dark-mode border gotcha (`--border` vs `--input`)

In dark mode this theme intentionally sets `--border` **equal to** `--background` — structural
borders (panel dividers, card outlines) disappear and contrast comes from surface colors
(`bg-card`, `bg-muted/40`) instead. `--input` remains a visible lighter tone in dark mode.

Consequence — **form controls must never use `border-border`**, or they become invisible in
dark mode:

- Prefer the shadcn `Input` / `Textarea` components from `src/components/ui/` (they use
  `border-input` and dark-mode `bg-input/30` correctly, plus `aria-invalid` styling for errors).
- If you must hand-roll a control, use `border-input`, never `border-border`.
- `border-border` is fine for structural separators where invisibility in dark mode is the
  intended design.

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

## Scrolling & layout model

The app uses a **fixed-viewport flex column** — the page body never overflows or scrolls.
There is exactly one scroll origin per page type.

### Shell chain (App → ToolPage → tool)

```
<div class="h-screen flex flex-col overflow-hidden">   ← App.tsx — pins to viewport
  <Header />                                            ← shrinks to content (sticky)
  <main class="flex-1 min-h-0">                        ← fills remaining height
    <div class="flex flex-col h-full">                  ← ToolPage.tsx
      <div class="shrink-0">breadcrumb</div>            ← shrinks to content
      <div class="flex-1 min-h-0 overflow-y-auto">      ← THE scroll origin for normal tools
        <ToolComponent />
      </div>
    </div>
  </main>
</div>
```

### Rules for tool components

**Normal (scrollable) tool** — the tool fills as much vertical space as it needs.
The `overflow-y-auto` wrapper in `ToolPage` handles scrolling automatically.
No special height classes needed in the tool component itself.

```tsx
// ✅ correct — just render content, ToolPage scrolls it
export default function MyTool() {
  return <div className="mx-auto max-w-2xl px-4 py-8 space-y-5">…</div>
}
```

**Full-bleed tool** — the tool must fill the available height exactly and manage its own
internal scroll (e.g. a split-pane editor). The tool must opt out of the ToolPage scroll wrapper
by filling its container and hiding overflow at the top level.

```tsx
// ✅ correct — fills container, internal panes manage their own scroll
export default function MyFullBleedTool() {
  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* toolbar, status bar — shrink-0 */}
      {/* scrollable panes — flex-1 min-h-0 overflow-y-auto (or overflow-hidden for CodeMirror) */}
    </div>
  )
}
```

**Never use** `h-screen`, `min-h-screen`, or `h-[calc(100vh-…)]` inside a tool component —
the viewport is already accounted for by the shell. Use `h-full` to fill the allocated space.

### Scrollbar appearance

Scrollbars are globally styled in `src/index.css` to match the shadcn `ScrollArea` component —
10px track, `border-radius: 9999px` rounded thumb, transparent track, 2px inset gap.

Token mapping:
- **Light:** thumb = `var(--border)`
- **Dark:** thumb = `var(--muted-foreground)` — `var(--border)` equals `var(--background)` in dark
  mode (intentional design choice), so it would be invisible.

Do not add per-component `::-webkit-scrollbar` overrides — the global rules cover everything
including CodeMirror's scroller, preview panes, sidebars, and the ToolPage scroll wrapper.

## PWA

Installable PWA via `vite-plugin-pwa` (see `vite.config.ts` for the full config):

- Workbox `generateSW` with `autoUpdate`; all built assets precached; SPA falls back to `index.html`
- Service worker only generated in production builds — dev mode is unaffected
- Manifest, icons, and runtime caching rules are all in `vite.config.ts`
