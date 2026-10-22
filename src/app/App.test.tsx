/**
 * src/app/App.test.tsx
 *
 * Route-tree tests for the `/` (LandingPage) vs `/app` + `/tools/:id` +
 * unknown-path (AppShell) split, plus the shell-less `/oauth/callback` route. `App` owns its own `BrowserRouter`, so each
 * test navigates via `window.history.pushState` before rendering — the
 * standard way to drive a `BrowserRouter`-based tree from a given URL.
 */
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest'
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

  it('renders the OAuth callback page at "/oauth/callback" WITHOUT the app Header', async () => {
    // The page closes its own window (jsdom would really tear the test window down); stub it.
    const close = vi.spyOn(window, 'close').mockImplementation(() => undefined)
    try {
      renderAt('/oauth/callback?code=x&state=y')

      // Lazy route: the chunk resolves asynchronously.
      expect(await screen.findByText('Authorization complete - you can close this window')).toBeInTheDocument()
      expect(screen.queryByLabelText('Search tools')).not.toBeInTheDocument()
      // Not the catch-all 404 either.
      expect(screen.queryByText('Page not found')).not.toBeInTheDocument()
      expect(close).toHaveBeenCalled()
    } finally {
      close.mockRestore()
    }
  })

  it('still renders "/tools/mcp-inspector" inside AppShell with the Header', async () => {
    renderAt('/tools/mcp-inspector')

    expect(await screen.findByText('All tools')).toBeInTheDocument()
    expect(screen.getByLabelText('Search tools')).toBeInTheDocument()
    // The tool itself (lazy chunk) renders inside the shell.
    expect(await screen.findByLabelText('Message log')).toBeInTheDocument()
  })

  it('declares /oauth/callback as a lazy route before the catch-all, and keeps the prerender route list unchanged', async () => {
    const source = (await import('./App.tsx?raw')).default
    expect(source).toMatch(/const OAuthCallbackPage = lazy\(\(\) => import\(/)
    expect(source.indexOf('path="/oauth/callback"')).toBeGreaterThan(-1)
    expect(source.indexOf('path="/oauth/callback"')).toBeLessThan(source.indexOf('path="*"'))

    const { getStaticRoutes } = await import('../../scripts/prerender/logic')
    const { tools } = await import('@/tools/registry')
    const routes = getStaticRoutes()
    expect(routes).toHaveLength(2 + tools.length)
    expect(routes.some((r) => r.path.includes('oauth'))).toBe(false)
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
