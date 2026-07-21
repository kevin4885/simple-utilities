# How to add a new tool — CLAUDE.md

Follow these exact steps every time. Do not deviate.

---

## Step 1 — Create the tool folder

Pick a category (e.g. `food`, `rivers`, `math`, `text`) and a kebab-case id.

```
src/tools/<category>/<tool-id>/
  index.tsx       # React component (default export)
  logic.ts        # Pure functions (no React, no side-effects)
  logic.test.ts   # Vitest unit tests for logic.ts
  store.ts        # (optional) Zustand persist store
```

Rules:

- `index.tsx` must have a `default export` (React component).
- `logic.ts` must contain only pure functions — no imports from React, no side-effects.
- `store.ts` is required if the tool persists user input. Use the naming convention:
  ```ts
  // localStorage key: su:<tool-id>
  persist(fn, { name: 'su:<tool-id>' })
  ```
- Validate localStorage on rehydrate with Zod (see pizza-dough/store.ts for the pattern).

---

## Step 2 — Register the tool in registry.ts

Open `src/tools/registry.ts` and add **one entry** to the `tools` array:

```ts
{
  id: '<tool-id>',                       // kebab-case, must be unique, becomes the URL slug
  category: '<Category>',                // Title-case, groups the tool on the home page
  title: '<Human-readable title>',
  description: '<One or two sentence description shown on the home-page card>',
  keywords: ['keyword1', 'keyword2'],    // Used for future search; be generous
  component: lazy(() => import('./<category>/<tool-id>/index')),
}
```

**That's the only change needed outside the tool folder.**
The route (`/tools/<tool-id>`), home-page card, and nav entry are all derived automatically.

---

## Step 3 — Write logic tests first (TDD recommended)

Add tests in `logic.test.ts` before wiring up the UI:

```ts
import { describe, it, expect } from 'vitest'
import { myFunction } from './logic'

describe('myFunction', () => {
  it('returns expected output for known input', () => {
    expect(myFunction(input)).toEqual(expected)
  })
})
```

Run with:

```powershell
npm test
```

---

## Step 4 — Build the UI (index.tsx)

- Use shared components from `@/components/ui/`.
- Consume the Zustand store from `./store`.
- Use Tailwind token classes (`bg-primary`, `text-muted-foreground`, etc.) so both light and dark themes work automatically.
- Lazy-loading is handled by the router; you do **not** need to add a Suspense wrapper inside the tool.

---

## Step 5 — Verify

```powershell
npm run build    # zero TS errors
npm test         # all tests green
npm run lint     # no lint errors
```

---

## Checklist

- [ ] `src/tools/<category>/<tool-id>/index.tsx` — default export component
- [ ] `src/tools/<category>/<tool-id>/logic.ts` — pure functions
- [ ] `src/tools/<category>/<tool-id>/logic.test.ts` — unit tests pass
- [ ] `src/tools/<category>/<tool-id>/store.ts` — Zustand store (if stateful), key `su:<tool-id>`
- [ ] `src/tools/registry.ts` — one new entry added
- [ ] `npm run build` passes
- [ ] `npm test` passes
- [ ] `npm run lint` passes

---

## Example: adding a "Word Counter" tool

```
src/tools/text/word-counter/
  index.tsx
  logic.ts
  logic.test.ts
```

```ts
// registry.ts — add to the tools array:
{
  id: 'word-counter',
  category: 'Text',
  title: 'Word Counter',
  description: 'Count words, characters, sentences, and reading time.',
  keywords: ['words', 'characters', 'text', 'writing', 'count'],
  component: lazy(() => import('./text/word-counter/index')),
}
```
