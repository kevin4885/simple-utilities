import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router'
import { AppShell } from './AppShell'
import { LandingPage } from './LandingPage'
import { AppHomePage } from './AppHomePage'
import { ToolPage } from './ToolPage'
import { NotFoundPage } from './NotFoundPage'
import { initTheme } from '@/lib/theme'

// Apply persisted theme immediately on mount
initTheme()

// OAuth redirect target for the MCP Inspector. Lazy so its chunk stays tiny: its only imports are the
// SDK-free auth/callback.ts and secrets.ts, so the MCP SDK is not pulled into the main entry chunk.
const OAuthCallbackPage = lazy(() => import('@/tools/developer/mcp-inspector/auth/OAuthCallbackPage'))

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        {/* Sibling of "/", outside AppShell (no Header, no Ctrl+K); declared before the catch-all. */}
        <Route
          path="/oauth/callback"
          element={
            <Suspense fallback={null}>
              <OAuthCallbackPage />
            </Suspense>
          }
        />
        <Route element={<AppShell />}>
          <Route path="/app" element={<AppHomePage />} />
          <Route path="/tools/:id" element={<ToolPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
