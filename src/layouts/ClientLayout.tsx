import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { ThemeToggle } from '../components/ThemeToggle'
import { UserAvatar } from '../components/UserAvatar'
import { ticketsForUser } from '../lib/store'
import { useDb } from '../hooks/useDb'
import { useLogo } from '../hooks/useLogo'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `min-h-11 rounded-lg px-3 py-2 text-sm font-medium transition ${
    isActive ? 'bg-white/15 text-white' : 'text-blue-100 hover:bg-white/10 hover:text-white'
  }`

export function ClientLayout({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth()
  const db = useDb()
  const location = useLocation()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [avatarMenuOpen, setAvatarMenuOpen] = useState(false)
  const clickTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleAvatarClick = (e: React.MouseEvent) => {
    e.preventDefault()
    if (clickTimer.current) {
      clearTimeout(clickTimer.current)
      clickTimer.current = null
      setAvatarMenuOpen(false)
      navigate('/profile')
    } else {
      clickTimer.current = setTimeout(() => {
        clickTimer.current = null
        setAvatarMenuOpen((v) => !v)
      }, 220)
    }
  }
  const count = useMemo(() => (user?.role === 'client' ? ticketsForUser(user.id).length : 0), [user, db])
  const isClient = user?.role === 'client'
  const clientLogo = useLogo('client')

  useEffect(() => {
    setOpen(false)
  }, [location.pathname])

  return (
    <div className="min-h-dvh bg-paper text-ink-800">
      <header className="sticky top-0 z-40 bg-brand-700 pt-[env(safe-area-inset-top)] text-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-2.5">
            <NavLink to="/" className="flex min-w-0 items-center gap-2 font-semibold tracking-tight">
            {clientLogo ? (
              <img
                src={clientLogo}
                alt={db.settings.helpdeskName || 'osTicket'}
                className="h-9 w-auto max-w-[10rem] shrink-0 object-contain"
              />
            ) : (
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-white/15 text-lg">✉</span>
            )}
            <span className="truncate">
              {db.settings.helpdeskName || 'osTicket'}
              <span className="hidden text-blue-100 sm:inline"> · {db.settings.companyName}</span>
            </span>
            </NavLink>
          </div>
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
            <ThemeToggle variant="header" />
            {isClient ? (
              <div className="relative">
                <button
                  type="button"
                  onClick={handleAvatarClick}
                  className="group flex items-center rounded-full ring-2 ring-transparent transition hover:ring-white/60 focus:outline-none"
                  aria-label="Account menu"
                  title="Click for menu, double-click to open profile"
                  aria-expanded={avatarMenuOpen}
                >
                  <UserAvatar name={user?.name} avatar={user?.avatar} size="md" />
                </button>
                {avatarMenuOpen ? (
                  <>
                    {/* backdrop */}
                    <div className="fixed inset-0 z-10" onClick={() => setAvatarMenuOpen(false)} />
                    {/* dropdown panel */}
                    <div className="absolute right-0 z-20 mt-2 w-60 rounded-xl border border-line bg-surface py-1 shadow-lg">
                      <div className="flex items-center gap-3 border-b border-line px-4 py-3">
                        <UserAvatar name={user.name} avatar={user.avatar} size="sm" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold text-ink-800">{user.name}</p>
                          <p className="truncate text-xs text-ink-500">{user.email}</p>
                        </div>
                      </div>
                      <NavLink
                        to="/profile"
                        onClick={() => setAvatarMenuOpen(false)}
                        className="flex items-center px-4 py-2 text-sm text-ink-700 hover:bg-paper"
                      >
                        My profile
                      </NavLink>
                      <div className="mt-1 border-t border-line pt-1">
                        <button
                          type="button"
                          className="flex w-full items-center px-4 py-2 text-sm text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/20"
                          onClick={() => {
                            setAvatarMenuOpen(false)
                            logout()
                          }}
                        >
                          Sign out
                        </button>
                      </div>
                    </div>
                  </>
                ) : null}
              </div>
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
            <ThemeToggle variant="nav" />
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
