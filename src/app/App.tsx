import { BrowserRouter, Routes, Route } from 'react-router'
import { AppShell } from './AppShell'
import { LandingPage } from './LandingPage'
import { AppHomePage } from './AppHomePage'
import { ToolPage } from './ToolPage'
import { NotFoundPage } from './NotFoundPage'
import { initTheme } from '@/lib/theme'

// Apply persisted theme immediately on mount
initTheme()

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route element={<AppShell />}>
          <Route path="/app" element={<AppHomePage />} />
          <Route path="/tools/:id" element={<ToolPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
