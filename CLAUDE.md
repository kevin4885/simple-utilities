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
  app/              # Shell: LandingPage (marketing root "/"), AppShell (pathless layout route
                    #   for "/app" + "/tools/:id" + unknown paths — owns Header, Ctrl+K,
                    #   CommandPalette), AppHomePage (tool grid at "/app"), ToolPage, routing
  lib/              # cn() helper, Zustand theme store, search.ts (Fuse.js tool search),
                    #   content.ts (SITE_URL, LANDING_COPY, truncateDescription — shared SEO
                    #   copy source), useDocumentMeta.ts (sets document.title / meta description
                    #   on client-side navigation), useMediaQuery.ts, useDebouncedValue.ts
    supabase/       # client.ts — the single shared Supabase client instance (reads
                    #   VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY)
    auth/           # useAuth.tsx — AuthProvider + useAuth() context/hook wrapping Supabase
                    #   Auth (Google sign-in). One onAuthStateChange subscription for the whole
                    #   app; also fires the first-sign-in import sweep (see cloudState/).
    cloudState/     # useToolState / useToolItemList — the generic auth-aware per-tool cloud
                    #   state adapter (signed out: existing per-tool Zustand store, unchanged;
                    #   signed in: React Query + Supabase `tool_state` table). importSweep.ts
                    #   (pure decide-import-or-skip logic) + importSweep.io.ts (thin I/O,
                    #   registerSweepTarget/runImportSweep) — the silent, idempotent, first
                    #   sign-in local→cloud import. See src/lib/cloudState/CLAUDE.md-equivalent
                    #   doc comments in each file for the full contract.
  components/
    ui/             # shadcn/ui components — source of truth is the files themselves
    editor/         # Shared editor components: CodeEditor, MarkdownRenderer (see editor/CLAUDE.md)
                    #   wysiwyg/ — TipTap WYSIWYG editor + extensions, toolbar, menus, forms
                    #   wysiwyg/WysiwygErrorBoundary.tsx — error boundary for WYSIWYG crashes
  tools/
    registry.ts     # THE source of truth for all tools, routes, and nav
    <category>/
      <tool-id>/    # One folder per tool — see src/tools/CLAUDE.md for the pattern
      writing/markdown-editor/export/  # export pipeline (pure builders + exportIo.ts) — reference pattern for export in any tool
  main.tsx          # Mounts QueryClientProvider + AuthProvider above the router
  index.css         # Tailwind v4 @import + @theme inline + OKLCH tokens
```

## Cloud state (Google sign-in, per-user Supabase storage)

Signed out, every tool behaves exactly as it always has: state lives only in
localStorage via each tool's own Zustand `persist` store. Signed in with
Google, a tool built on `useToolState` (see `src/lib/cloudState/useToolState.ts`)
instead reads/writes one row per `(user_id, tool_id, item_id)` in Supabase
Postgres — `item_id` is `'default'` for single-blob tools, or a doc/item id
for tools that manage several independent items. The two paths never sync or
merge; a one-time, silent, idempotent import sweep (`src/lib/cloudState/
importSweep.ts` + `.io.ts`) copies any existing local data into the cloud on
first sign-in only, and only for a tool/item that has no cloud row yet.

`supabase/migrations/0001_tool_state.sql` defines the `tool_state` table and
its Row Level Security policies (every operation scoped to `auth.uid() =
user_id`) — applied manually via the Supabase SQL editor/CLI, not by any
build or test step in this repo. Every stateful tool (all `store.ts`-backed
tools in `registry.ts`, including `markdown-editor`) is migrated onto
`useToolState` and registered with the import sweep (`registerSweepTarget`)
— see `swe/google-auth-cloud-state/` for the migration history.

## Route structure

`/` is a standalone marketing `LandingPage` — own minimal header/footer, normal document
scroll, no Ctrl+K. Everything else (`/app` — the tool browser, `/tools/:id`, and any unknown
path) lives under `AppShell`, a **pathless** React Router layout route that owns the sticky
`Header`, the Ctrl+K command palette, and the fixed-viewport scroll-lock shell — so those
routes' own paths are unaffected by the layout route wrapping them.

`src/lib/content.ts` is the single source of truth for SEO/marketing copy (`SITE_URL`,
`LANDING_COPY`, `truncateDescription`) — read by both the live client (`useDocumentMeta`,
called once per page in `LandingPage`/`AppHomePage`/`ToolPage`) and, in a later phase, a
build-time static-HTML prerender step. Never duplicate title/description text elsewhere.


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

Diff colours: use the `diff-insert` / `diff-delete` semantic tokens (`bg-diff-insert/10`,
`text-diff-delete`, …) — never raw greens/reds. Used by the Markdown Editor's version
history diff view and the Diff Viewer tool.

VME version history: automatic "Before restore" snapshots are capped at 5 per doc
(`RESTORE_SNAPSHOT_CAP`); renaming one exempts it. (VME = legacy internal prefix for the
Markdown Editor — folder `src/tools/writing/markdown-editor/`.)

Theme choice is stored in localStorage under key `su:theme`.

### Dark-mode borders (`--border` vs `--input`)

In dark mode `--border` is a **subtle hairline** tone (distinct from both `--background` and
`--card`) so structural borders — panel dividers, card outlines, `<hr>`, table cell borders —
stay visible. `--input` is a slightly lighter tone used for form-control outlines. Both are
visible in light and dark mode.

> History: `--border` used to equal `--background` in dark mode (borders were intentionally
> invisible, with contrast coming from surface colors). That made borders vanish app-wide in
> dark mode, so `--border` was given its own visible value. If you see old code that avoided
> `border-border` to dodge that bug, it can now safely use it.

Guidance:
- Use `border-border` for structural separators, card/panel outlines, dividers, and rules.
- Use `border-input` (or the shadcn `Input` / `Textarea` components) for form controls — they
  also carry `bg-input/30` and `aria-invalid` styling.
- Never hardcode raw colors; always use the semantic token utilities.

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

- A Supabase backend now exists for per-user cloud state and Google sign-in (external — not
  hosted or run by this repo; see `src/lib/supabase/`, `src/lib/auth/`, `src/lib/cloudState/`,
  and `supabase/migrations/`). Build-time env vars `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`
  are required (see `.env.example`) — both are safe to expose client-side, since Supabase's anon
  key relies on Postgres Row Level Security for safety, not secrecy. Signed out, every tool still
  behaves exactly as before: localStorage only, no network calls.
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
- **Dark:** thumb = `var(--muted-foreground)` — a deliberately higher-contrast thumb than
  the subtle `var(--border)` hairline used elsewhere.

Do not add per-component `::-webkit-scrollbar` overrides — the global rules cover everything
including CodeMirror's scroller, preview panes, sidebars, and the ToolPage scroll wrapper.

## PWA

Installable PWA via `vite-plugin-pwa` (see `vite.config.ts` for the full config):

- Workbox `generateSW` with `autoUpdate`; all built assets precached; SPA falls back to `index.html`
- Service worker only generated in production builds — dev mode is unaffected
- Manifest, icons, and runtime caching rules are all in `vite.config.ts`
