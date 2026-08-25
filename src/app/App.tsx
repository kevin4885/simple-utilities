import { Suspense, useState, useCallback, useEffect, useRef } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router'
import { Header } from './Header'
import { HomePage } from './HomePage'
import { ToolPage } from './ToolPage'
import { NotFoundPage } from './NotFoundPage'
import { CommandPalette } from './CommandPalette'
import { initTheme } from '@/lib/theme'

// Apply persisted theme immediately on mount
initTheme()

export function App() {
  const [paletteOpen, setPaletteOpen] = useState(false)
  // Incrementing key forces CommandPalette to remount on each open, resetting
  // the query input — this covers both Radix-driven closes (Esc, overlay) and
  // parent-driven closes (Ctrl+K toggle), since neither path is guaranteed to
  // call an internal reset handler.
  const openCountRef = useRef(0)
  const [paletteKey, setPaletteKey] = useState(0)

  const openPalette = useCallback(() => {
    openCountRef.current += 1
    setPaletteKey(openCountRef.current)
    setPaletteOpen(true)
  }, [])

  // Global Ctrl+K / Cmd+K shortcut
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        if (paletteOpen) {
          setPaletteOpen(false)
        } else {
          openPalette()
        }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [paletteOpen, openPalette])

  return (
    <BrowserRouter>
      <div className="h-dvh flex flex-col overflow-hidden overscroll-none bg-background text-foreground">
        <Header onSearchClick={openPalette} />
        <main className="flex-1 min-h-0">
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

        {/* Command palette — mounted once so the keyboard shortcut works on every page.
            key resets internal query state on each open (covers Ctrl+K re-open and
            Radix-driven close paths alike). */}
        <CommandPalette
          key={paletteKey}
          open={paletteOpen}
          onOpenChange={setPaletteOpen}
        />
      </div>
    </BrowserRouter>
  )
}
