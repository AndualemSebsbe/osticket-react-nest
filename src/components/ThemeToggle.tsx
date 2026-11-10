import { useTheme } from '../context/ThemeContext'

export interface ThemeToggleProps {
  className?: string
  showLabel?: boolean
  variant?: 'header' | 'ghost' | 'floating' | 'nav' | 'simple'
}

function SunIcon({ className = 'h-3.5 w-3.5' }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2" />
      <path d="M12 20v2" />
      <path d="m4.93 4.93 1.41 1.41" />
      <path d="m17.66 17.66 1.41 1.41" />
      <path d="M2 12h2" />
      <path d="M20 12h2" />
      <path d="m6.34 17.66-1.41 1.41" />
      <path d="m19.07 4.93-1.41 1.41" />
    </svg>
  )
}

function MoonIcon({ className = 'h-3.5 w-3.5' }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="currentColor"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
    </svg>
  )
}

/**
 * SwitchToggle: A physical toggle switch component (On = Dark mode, Off = Light mode)
 */
export function ThemeToggle({
  className = '',
  showLabel = true,
  variant = 'ghost',
}: ThemeToggleProps) {
  const { theme, toggle } = useTheme()
  const isDark = theme === 'dark'

  if (variant === 'nav') {
    return (
      <div className={`flex min-h-11 items-center justify-between rounded-lg px-3 py-2 text-sm text-blue-100 ${className}`}>
        <span className="flex items-center gap-2">
          {isDark ? <MoonIcon className="h-4 w-4 text-amber-300" /> : <SunIcon className="h-4 w-4 text-amber-300" />}
          <span>Dark mode</span>
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={isDark}
          aria-label="Toggle dark mode"
          onClick={toggle}
          className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-white/50 ${
            isDark ? 'bg-blue-400' : 'bg-white/30'
          }`}
        >
          <span
            className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-md ring-0 transition duration-200 ease-in-out ${
              isDark ? 'translate-x-5' : 'translate-x-0'
            }`}
          />
        </button>
      </div>
    )
  }

  // Header variant (light pill track on brand header)
  if (variant === 'header') {
    return (
      <div className={`inline-flex items-center gap-2 ${className}`}>
        {showLabel ? (
          <span className="text-xs font-medium text-blue-100 flex items-center gap-1 select-none">
            {isDark ? <MoonIcon className="text-amber-300" /> : <SunIcon className="text-amber-300" />}
            <span className="hidden sm:inline">{isDark ? 'Dark' : 'Light'}</span>
          </span>
        ) : null}
        <button
          type="button"
          role="switch"
          aria-checked={isDark}
          aria-label={isDark ? 'Switch off dark mode' : 'Switch on dark mode'}
          title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
          onClick={toggle}
          className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-white/50 ${
            isDark ? 'bg-blue-500' : 'bg-white/25'
          }`}
        >
          <span
            className={`pointer-events-none flex h-5 w-5 transform items-center justify-center rounded-full bg-white text-slate-800 shadow-md ring-0 transition duration-200 ease-in-out ${
              isDark ? 'translate-x-5' : 'translate-x-0'
            }`}
          >
            {isDark ? (
              <MoonIcon className="h-3 w-3 text-blue-600" />
            ) : (
              <SunIcon className="h-3 w-3 text-amber-500" />
            )}
          </span>
        </button>
      </div>
    )
  }

  // Floating variant (for staff login and password reset pages)
  if (variant === 'floating') {
    return (
      <div
        className={`inline-flex items-center gap-2.5 rounded-full border border-slate-200/80 bg-white/90 py-1.5 pl-3 pr-2 shadow-lg backdrop-blur-md dark:border-slate-700/80 dark:bg-slate-900/90 ${className}`}
      >
        <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200 select-none">
          {isDark ? <MoonIcon className="text-blue-400" /> : <SunIcon className="text-amber-500" />}
          <span>{isDark ? 'Dark' : 'Light'}</span>
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={isDark}
          aria-label={isDark ? 'Switch off dark mode' : 'Switch on dark mode'}
          title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
          onClick={toggle}
          className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 ${
            isDark ? 'bg-blue-600' : 'bg-slate-300 dark:bg-slate-700'
          }`}
        >
          <span
            className={`pointer-events-none flex h-5 w-5 transform items-center justify-center rounded-full bg-white text-slate-800 shadow-md ring-0 transition duration-200 ease-in-out ${
              isDark ? 'translate-x-5' : 'translate-x-0'
            }`}
          >
            {isDark ? (
              <MoonIcon className="h-3 w-3 text-blue-600" />
            ) : (
              <SunIcon className="h-3 w-3 text-amber-500" />
            )}
          </span>
        </button>
      </div>
    )
  }

  // Standard ghost variant (staff layout header and default)
  return (
    <div className={`inline-flex items-center gap-2 ${className}`}>
      {showLabel ? (
        <span className="flex items-center gap-1 text-xs font-medium text-ink-600 dark:text-ink-400 select-none">
          {isDark ? <MoonIcon className="text-blue-400" /> : <SunIcon className="text-amber-500" />}
          <span className="hidden sm:inline">{isDark ? 'Dark' : 'Light'}</span>
        </span>
      ) : null}
      <button
        type="button"
        role="switch"
        aria-checked={isDark}
        aria-label={isDark ? 'Switch off dark mode' : 'Switch on dark mode'}
        title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
        onClick={toggle}
        className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-brand-500 ${
          isDark ? 'bg-brand-600' : 'bg-slate-300 dark:bg-slate-700'
        }`}
      >
        <span
          className={`pointer-events-none flex h-5 w-5 transform items-center justify-center rounded-full bg-white text-slate-800 shadow-md ring-0 transition duration-200 ease-in-out ${
            isDark ? 'translate-x-5' : 'translate-x-0'
          }`}
        >
          {isDark ? (
            <MoonIcon className="h-3 w-3 text-brand-600" />
          ) : (
            <SunIcon className="h-3 w-3 text-amber-500" />
          )}
        </span>
      </button>
    </div>
  )
}
