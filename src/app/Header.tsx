import { useState } from 'react'
import { Sun, Moon, Wrench, Menu, X } from 'lucide-react'
import { Link, useSearchParams } from 'react-router'
import { Button } from '@/components/ui/button'
import { useThemeStore } from '@/lib/theme'
import { categories } from '@/tools/registry'

export function Header() {
  const { theme, setTheme } = useThemeStore()
  const [menuOpen, setMenuOpen] = useState(false)
  const [searchParams] = useSearchParams()
  const activeCategory = searchParams.get('category')

  function toggleTheme() {
    setTheme(theme === 'light' ? 'dark' : 'light')
  }

  const ThemeIcon = theme === 'dark' ? Moon : Sun
  const nextThemeLabel = theme === 'dark' ? 'light' : 'dark'

  function pillClass(isActive: boolean) {
    return isActive
      ? 'rounded-full px-3 py-1 text-sm font-medium bg-primary text-primary-foreground transition-colors'
      : 'rounded-full px-3 py-1 text-sm font-medium bg-muted text-muted-foreground hover:bg-muted/70 hover:text-foreground transition-colors'
  }

  return (
    <header className="sticky top-0 z-50 border-b bg-card/80 backdrop-blur-sm">
      <div className="flex items-center gap-4 px-6 py-3">
        {/* Logo / title */}
        <Link
          to="/"
          className="flex items-center gap-2 font-bold text-foreground hover:text-primary transition-colors shrink-0"
        >
          <Wrench className="h-5 w-5 text-primary" />
          <span>Simple Utilities</span>
        </Link>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Theme toggle */}
        <Button
          variant="ghost"
          size="icon"
          onClick={toggleTheme}
          title={`Switch to ${nextThemeLabel} mode`}
          aria-label={`Switch to ${nextThemeLabel} mode`}
          className="shrink-0"
        >
          <ThemeIcon className="h-4 w-4" />
        </Button>

        {/* Hamburger — mobile only */}
        <Button
          variant="ghost"
          size="icon"
          className="md:hidden shrink-0"
          onClick={() => setMenuOpen((o) => !o)}
          aria-label={menuOpen ? 'Close menu' : 'Open menu'}
        >
          {menuOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
        </Button>
      </div>

      {/* Mobile category dropdown */}
      {menuOpen && (
        <div className="md:hidden border-t bg-card/95 px-6 py-4">
          <div className="flex flex-wrap gap-2">
            <Link
              to="/"
              onClick={() => setMenuOpen(false)}
              className={pillClass(activeCategory === null)}
            >
              All
            </Link>
            {categories.map((cat) => (
              <Link
                key={cat}
                to={`/?category=${encodeURIComponent(cat)}`}
                onClick={() => setMenuOpen(false)}
                className={pillClass(activeCategory === cat)}
              >
                {cat}
              </Link>
            ))}
          </div>
        </div>
      )}
    </header>
  )
}
