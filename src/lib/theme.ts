import { create } from 'zustand'
import { persist } from 'zustand/middleware'

type Theme = 'light' | 'dark'

interface ThemeState {
  theme: Theme
  setTheme: (theme: Theme) => void
}

function getSystemTheme(): Theme {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle('dark', theme === 'dark')
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      theme: getSystemTheme(),
      setTheme: (theme: Theme) => {
        set({ theme })
        applyTheme(theme)
      },
    }),
    { name: 'su:theme' },
  ),
)

export function initTheme() {
  const state = useThemeStore.getState()
  // Migrate any old 'system' value that may be in localStorage
  if ((state.theme as string) === 'system') {
    const resolved = getSystemTheme()
    state.setTheme(resolved)
  } else {
    applyTheme(state.theme)
  }
}
