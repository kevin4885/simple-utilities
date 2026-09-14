/**
 * src/app/App.test.tsx
 *
 * Route-tree tests for the `/` (LandingPage) vs `/app` + `/tools/:id` +
 * unknown-path (AppShell) split. `App` owns its own `BrowserRouter`, so each
 * test navigates via `window.history.pushState` before rendering — the
 * standard way to drive a `BrowserRouter`-based tree from a given URL.
 */
import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import type { App as AppComponent } from './App'

// jsdom has no matchMedia implementation. `theme.ts`'s Zustand store calls
// it at *module load time* (getSystemTheme()), and `App` transitively
// imports `theme.ts` via AppShell -> Header. Because ES module imports are
// evaluated before any test/beforeAll code runs, the stub must be installed
// before `./App` is imported — a plain top-level `beforeAll` is too late.
// Stubbing here (mirroring the pattern already used in
// `useMediaQuery.test.ts`) and dynamically importing `App` afterwards
// avoids editing the shared `test-setup.ts` (out of scope for this phase).
if (typeof window.matchMedia !== 'function') {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
}

let App: typeof AppComponent

function renderAt(path: string) {
  window.history.pushState({}, '', path)
  return render(<App />)
}

describe('App route tree', () => {
  beforeAll(async () => {
    ;({ App } = await import('./App'))
  })

  afterEach(() => {
    cleanup()
  })

  it('renders LandingPage at "/" with no app Header/Ctrl+K shell', async () => {
    renderAt('/')

    // LandingPage's own hero copy, not AppHomePage's heading.
    expect(await screen.findByRole('link', { name: /browse tools/i })).toBeInTheDocument()
    // The app shell's search trigger (Header) must not be present.
    expect(screen.queryByLabelText('Search tools')).not.toBeInTheDocument()
  })

  it('renders the tool grid inside AppShell at "/app"', async () => {
    renderAt('/app')

    expect(await screen.findByRole('heading', { name: /browse all tools/i })).toBeInTheDocument()
    // AppShell's Header (with search trigger) is present.
    expect(screen.getByLabelText('Search tools')).toBeInTheDocument()
  })

  it('renders a real tool inside AppShell at "/tools/:id" with a breadcrumb to /app', async () => {
    renderAt('/tools/word-counter')

    expect(await screen.findByText('All tools')).toBeInTheDocument()
    expect(screen.getByText('All tools').closest('a')).toHaveAttribute('href', '/app')
    // Still inside the app shell.
    expect(screen.getByLabelText('Search tools')).toBeInTheDocument()
  })

  it('renders NotFoundPage inside AppShell for an unknown path', async () => {
    renderAt('/nonsense')

    expect(await screen.findByText('Page not found')).toBeInTheDocument()
    // Header (and therefore the app shell) is still visible around it.
    expect(screen.getByLabelText('Search tools')).toBeInTheDocument()
    // "Go home" link on NotFoundPage still points at "/", not "/app".
    expect(screen.getByText('Go home').closest('a')).toHaveAttribute('href', '/')
  })
})
