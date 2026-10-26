import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

export type Theme = 'light' | 'dark' | 'system'

const KEY = 'osticket-react-theme'

function readTheme(): Theme {
  const raw = localStorage.getItem(KEY)
  if (raw === 'light' || raw === 'dark' || raw === 'system') return raw
  return 'system'
}

function isDark(theme: Theme) {
  if (theme === 'dark') return true
  if (theme === 'light') return false
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

function apply(theme: Theme) {
  const dark = isDark(theme)
  document.documentElement.classList.toggle('dark', dark)
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
  document.body.style.color = dark ? '#fff' : ''
}

interface ThemeValue {
  theme: Theme
  dark: boolean
  setTheme: (theme: Theme) => void
  cycle: () => void
}

const ThemeContext = createContext<ThemeValue | null>(null)

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(readTheme)
  const [dark, setDark] = useState(() => isDark(readTheme()))

  useEffect(() => {
    apply(theme)
    setDark(isDark(theme))
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => {
      apply(theme)
      setDark(isDark(theme))
    }
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [theme])

  const value = useMemo<ThemeValue>(
    () => ({
      theme,
      dark,
      setTheme: (next) => {
        localStorage.setItem(KEY, next)
        setThemeState(next)
      },
      cycle: () => {
        const order: Theme[] = ['system', 'light', 'dark']
        const next = order[(order.indexOf(theme) + 1) % order.length]
        localStorage.setItem(KEY, next)
        setThemeState(next)
      },
    }),
    [theme, dark],
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider')
  return ctx
}
