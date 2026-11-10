import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

export type Theme = 'light' | 'dark'

const KEY = 'osticket-react-theme'

function readTheme(): Theme {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw === 'light' || raw === 'dark') return raw
    if (typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
      return 'dark'
    }
  } catch {
    // ignore localStorage errors
  }
  return 'light'
}

function apply(theme: Theme) {
  const dark = theme === 'dark'
  document.documentElement.classList.toggle('dark', dark)
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
}

interface ThemeValue {
  theme: Theme
  dark: boolean
  setTheme: (theme: Theme) => void
  toggle: () => void
  cycle: () => void
}

const ThemeContext = createContext<ThemeValue | null>(null)

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(readTheme)

  useEffect(() => {
    apply(theme)
  }, [theme])

  const value = useMemo<ThemeValue>(() => {
    const dark = theme === 'dark'
    const toggle = () => {
      const next: Theme = theme === 'dark' ? 'light' : 'dark'
      try {
        localStorage.setItem(KEY, next)
      } catch {
        // ignore storage errors
      }
      setThemeState(next)
    }

    return {
      theme,
      dark,
      setTheme: (next: Theme) => {
        try {
          localStorage.setItem(KEY, next)
        } catch {}
        setThemeState(next)
      },
      toggle,
      cycle: toggle,
    }
  }, [theme])

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider')
  return ctx
}
