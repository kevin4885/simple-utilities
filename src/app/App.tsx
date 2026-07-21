import { Suspense } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router'
import { Header } from './Header'
import { HomePage } from './HomePage'
import { ToolPage } from './ToolPage'
import { NotFoundPage } from './NotFoundPage'
import { initTheme } from '@/lib/theme'

// Apply persisted theme immediately on mount
initTheme()

export function App() {
  return (
    <BrowserRouter>
      <div className="min-h-screen bg-background text-foreground">
        <Header />
        <main>
          <Suspense
            fallback={
              <div className="flex items-center justify-center py-24 text-muted-foreground">
                Loading…
              </div>
            }
          >
            <Routes>
              <Route path="/" element={<HomePage />} />
              <Route path="/tools/:id" element={<ToolPage />} />
              <Route path="*" element={<NotFoundPage />} />
            </Routes>
          </Suspense>
        </main>
      </div>
    </BrowserRouter>
  )
}
