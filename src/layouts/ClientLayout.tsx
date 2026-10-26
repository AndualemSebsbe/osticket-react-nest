import { NavLink, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useTheme } from '../context/ThemeContext'
import { ticketsForUser } from '../lib/store'
import { useDb } from '../hooks/useDb'
import { useEffect, useMemo, useState, type ReactNode } from 'react'

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `min-h-11 rounded-lg px-3 py-2 text-sm font-medium transition ${
    isActive ? 'bg-white/15 text-white' : 'text-blue-100 hover:bg-white/10 hover:text-white'
  }`

export function ClientLayout({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth()
  const { cycle, theme } = useTheme()
  const db = useDb()
  const location = useLocation()
  const [open, setOpen] = useState(false)
  const count = useMemo(() => (user?.role === 'client' ? ticketsForUser(user.id).length : 0), [user, db])
  const isClient = user?.role === 'client'

  useEffect(() => {
    setOpen(false)
  }, [location.pathname])

  return (
    <div className="min-h-dvh bg-paper text-slate-700">
      <header className="sticky top-0 z-40 bg-brand-700 pt-[env(safe-area-inset-top)] text-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
          <NavLink to="/" className="flex min-w-0 items-center gap-2 font-semibold tracking-tight">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-white/15 text-lg">✉</span>
            <span className="truncate">
              {db.settings.helpdeskName || 'osTicket'}
              <span className="hidden text-blue-100 sm:inline"> · {db.settings.companyName}</span>
            </span>
          </NavLink>
          <button
            type="button"
            className="min-h-11 rounded-lg p-2 md:hidden"
            aria-expanded={open}
            aria-label="Toggle navigation"
            onClick={() => setOpen((v) => !v)}
          >
            <span className="block h-0.5 w-5 bg-white" />
            <span className="mt-1 block h-0.5 w-5 bg-white" />
            <span className="mt-1 block h-0.5 w-5 bg-white" />
          </button>
          <nav className="hidden items-center gap-1 md:flex">
            <NavLink to="/" className={linkClass} end>
              Home
            </NavLink>
            {isClient ? (
              <>
                <NavLink to="/open" className={linkClass}>
                  New ticket
                </NavLink>
                <NavLink to="/status" className={linkClass}>
                  Check status
                </NavLink>
              </>
            ) : null}
            {db.settings.kbEnabled ? (
              <NavLink to="/kb" className={linkClass}>
                Knowledge base
              </NavLink>
            ) : null}
            {isClient ? (
              <NavLink to="/tickets" className={linkClass}>
                Tickets ({count})
              </NavLink>
            ) : null}
          </nav>
          <div className="hidden items-center gap-3 text-sm md:flex">
            <button
              type="button"
              onClick={cycle}
              className="rounded-lg bg-white/15 px-2.5 py-1.5 text-xs font-medium capitalize text-white hover:bg-white/25"
              title="Cycle theme (system / light / dark)"
            >
              {theme}
            </button>
            {isClient ? (
              <>
                <NavLink to="/profile" className="text-blue-100 hover:text-white">
                  {user.name}
                </NavLink>
                <button type="button" className="text-blue-100 hover:text-white" onClick={logout}>
                  Sign out
                </button>
              </>
            ) : (
              <>
                <NavLink to="/login" className="text-blue-100 hover:text-white">
                  Sign in
                </NavLink>
                <NavLink to="/scp/login" className="rounded-lg bg-white/15 px-3 py-1.5 text-white hover:bg-white/25">
                  Agent
                </NavLink>
              </>
            )}
          </div>
        </div>
        {open ? (
          <nav className="flex flex-col gap-1 border-t border-white/10 px-4 py-3 md:hidden">
            <NavLink to="/" className={linkClass} end>
              Home
            </NavLink>
            {isClient ? (
              <>
                <NavLink to="/open" className={linkClass}>
                  New ticket
                </NavLink>
                <NavLink to="/status" className={linkClass}>
                  Check status
                </NavLink>
              </>
            ) : null}
            {db.settings.kbEnabled ? (
              <NavLink to="/kb" className={linkClass}>
                Knowledge base
              </NavLink>
            ) : null}
            <button type="button" className="min-h-11 rounded-lg px-3 py-2 text-left text-sm text-blue-100" onClick={cycle}>
              Theme: {theme}
            </button>
            {isClient ? (
              <>
                <NavLink to="/tickets" className={linkClass}>
                  My tickets
                </NavLink>
                <NavLink to="/profile" className={linkClass}>
                  Profile
                </NavLink>
                <button
                  type="button"
                  className="min-h-11 rounded-lg px-3 py-2 text-left text-sm text-blue-100"
                  onClick={logout}
                >
                  Sign out
                </button>
              </>
            ) : (
              <>
                <NavLink to="/login" className={linkClass}>
                  Sign in
                </NavLink>
                <NavLink to="/scp/login" className={linkClass}>
                  Agent panel
                </NavLink>
              </>
            )}
          </nav>
        ) : null}
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6 sm:py-8">{children}</main>
      <footer className="border-t border-line bg-surface px-4 py-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] text-center text-sm text-ink-600">
        Powered by a React rebuild of osTicket · Ctrl/⌘ K to search · Demo data stays in your browser
      </footer>
    </div>
  )
}
