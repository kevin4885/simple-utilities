import { Sun, Moon, Monitor, Wrench } from 'lucide-react'
import { Link } from 'react-router'
import { Button } from '@/components/ui/button'
import { useThemeStore } from '@/lib/theme'
import { categories } from '@/tools/registry'

type ThemeOption = 'light' | 'dark' | 'system'

const themeIcons: Record<ThemeOption, typeof Sun> = {
  light: Sun,
  dark: Moon,
  system: Monitor,
}

const themeOrder: ThemeOption[] = ['system', 'light', 'dark']

export function Header() {
  const { theme, setTheme } = useThemeStore()
  function cycleTheme() {
    const idx = themeOrder.indexOf(theme as ThemeOption)
    const next = themeOrder[(idx + 1) % themeOrder.length]
    setTheme(next)
  }

  const ThemeIcon = themeIcons[(theme as ThemeOption) ?? 'system']

  return (
    <header className="sticky top-0 z-50 border-b bg-card/80 backdrop-blur-sm">
      <div className="mx-auto flex max-w-5xl items-center gap-4 px-4 py-3">
        {/* Logo / title */}
        <Link
          to="/"
          className="flex items-center gap-2 font-bold text-foreground hover:text-primary transition-colors"
        >
          <Wrench className="h-5 w-5 text-primary" />
          <span>Simple Utilities</span>
        </Link>

        {/* Category nav */}
        <nav className="flex items-center gap-1 ml-4">
          <Link
            to="/"
            className="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          >
            All
          </Link>
          {categories.map((cat) => {
            const href = `/?category=${encodeURIComponent(cat)}`
            return (
              <Link
                key={cat}
                to={href}
                className="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              >
                {cat}
              </Link>
            )
          })}
        </nav>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Theme toggle */}
        <Button
          variant="ghost"
          size="icon"
          onClick={cycleTheme}
          title={`Theme: ${theme} (click to cycle)`}
          aria-label={`Current theme: ${theme}. Click to cycle.`}
        >
          <ThemeIcon className="h-4 w-4" />
        </Button>
      </div>
    </header>
  )
}
