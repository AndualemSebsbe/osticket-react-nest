import { useEffect, useMemo, useRef, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { ThemeToggle } from '../components/ThemeToggle'
import { UserAvatar } from '../components/UserAvatar'
import { adminGroupForPath, adminGroups, agentNav, type NavItem } from './staffNav'
import { useLogo } from '../hooks/useLogo'
import { useDb } from '../hooks/useDb'

import { inputClass } from "../components/ui"
const link = ({ isActive }: { isActive: boolean }) =>
  `flex min-h-11 items-center rounded-lg px-3 py-2 text-sm font-medium ${
    isActive ? 'bg-brand-600 text-white' : 'text-slate-300 hover:bg-slate-800 hover:text-white'
  }`

function matches(item: NavItem, query: string) {
  return !query || item.label.toLowerCase().includes(query)
}

export function StaffLayout() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const db = useDb()
  const [open, setOpen] = useState(false)
  const [avatarMenuOpen, setAvatarMenuOpen] = useState(false)
  const clickTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleAvatarClick = (e: React.MouseEvent) => {
    e.preventDefault()
    if (clickTimer.current) {
      clearTimeout(clickTimer.current)
      clickTimer.current = null
      setAvatarMenuOpen(false)
      navigate('/scp/profile')
    } else {
      clickTimer.current = setTimeout(() => {
        clickTimer.current = null
        setAvatarMenuOpen((v) => !v)
      }, 220)
    }
  }
  const [sidebarVisible, setSidebarVisible] = useState(() => {
    const saved = localStorage.getItem('scp_sidebar_visible')
    return saved !== null ? saved === 'true' : true
  })
  const [navQ, setNavQ] = useState('')
  const isAdmin = user?.role === 'admin'
  const inAdmin = location.pathname.startsWith('/scp/admin')
  const staffLogo = useLogo('staff')
  const [expanded, setExpanded] = useState<Record<string, boolean>>({
    agent: !inAdmin,
    admin: inAdmin,
    dashboard: true,
    settings: true,
    manage: true,
    emails: true,
    staff: true,
  })

  const toggleSidebar = () => {
    setSidebarVisible((prev) => {
      const next = !prev
      localStorage.setItem('scp_sidebar_visible', String(next))
      return next
    })
  }

  useEffect(() => {
    setOpen(false)
    if (location.pathname.startsWith('/scp/admin')) {
      setExpanded((e) => ({ ...e, admin: true, agent: false }))
    }
  }, [location.pathname])

  useEffect(() => {
    document.body.classList.toggle('nav-open', open)
    return () => document.body.classList.remove('nav-open')
  }, [open])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      if (clickTimer.current) clearTimeout(clickTimer.current)
    }
  }, [])

  const query = navQ.trim().toLowerCase()
  const filteredAgent = useMemo(() => agentNav.filter((item) => matches(item, query)), [query])
  const filteredAdmin = useMemo(
    () =>
      adminGroups
        .map((g) => ({ ...g, items: g.items.filter((item) => matches(item, query)) }))
        .filter((g) => g.items.length > 0),
    [query],
  )

  const activeAdminGroup = useMemo(() => adminGroupForPath(location.pathname), [location.pathname])

  const nav = (
    <>
      <div className="mb-4 flex items-start justify-between gap-2">
        <NavLink to="/scp" className="flex min-w-0 items-center gap-2 font-semibold text-white" end>
          {staffLogo ? (
            <img
              src={staffLogo}
              alt={db.settings.helpdeskName || 'osTicket'}
              className="h-9 w-auto max-w-[9rem] shrink-0 object-contain"
            />
          ) : (
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand-600 text-sm">SCP</span>
          )}
          <span className="leading-tight">
            Staff control panel
            <span className="block text-xs font-normal text-slate-400">osTicket</span>
          </span>
        </NavLink>
        <button
          type="button"
          className="rounded-lg px-2 py-1 text-sm text-slate-300 md:hidden"
          onClick={() => setOpen(false)}
        >
          Close
        </button>
      </div>
      <input
        value={navQ}
        onChange={(e) => setNavQ(e.target.value)}
        placeholder="Filter menu"
        className={inputClass + " mb-4"}
      />
      {inAdmin ? (
        <div className="mb-4">
          <p className="mb-2 px-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            Admin Navigation
          </p>
          <nav className="flex flex-col gap-1">
            {filteredAdmin.map((group) => {
              const isCurrentGroup = group.id === activeAdminGroup.id
              const isGroupExpanded = expanded[group.id] ?? isCurrentGroup
              return (
                <div key={group.id} className="rounded-lg bg-slate-900/40 p-1">
                  <button
                    type="button"
                    className={`flex min-h-9 w-full items-center justify-between rounded-md px-2.5 py-1.5 text-xs font-semibold uppercase tracking-wide transition ${
                      isCurrentGroup ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-slate-200'
                    }`}
                    onClick={() => setExpanded((e) => ({ ...e, [group.id]: !isGroupExpanded }))}
                  >
                    <span>{group.label}</span>
                    <span className="text-[10px] text-slate-400">
                      {isGroupExpanded || query ? '−' : '+'}
                    </span>
                  </button>
                  {isGroupExpanded || query ? (
                    <div className="mt-1 flex flex-col gap-0.5 pl-2 border-l border-slate-800">
                      {group.items.map((item) => (
                        <NavLink key={item.to} to={item.to} end={item.end} className={link}>
                          {item.label}
                        </NavLink>
                      ))}
                    </div>
                  ) : null}
                </div>
              )
            })}
          </nav>
        </div>
      ) : (
        <div className="mb-4">
          <p className="mb-2 px-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            Agent Navigation
          </p>
          <nav className="flex flex-col gap-0.5">
            {filteredAgent.map((item) => (
              <NavLink key={item.to} to={item.to} end={item.end} className={link}>
                {item.label}
              </NavLink>
            ))}
          </nav>
        </div>
      )}

      {/* Quick switcher link between panels */}
      <div className="mt-auto border-t border-slate-800/80 pt-4 flex flex-col gap-1">
        {isAdmin ? (
          inAdmin ? (
            <button
              type="button"
              onClick={() => navigate('/scp')}
              className="flex min-h-10 items-center justify-between rounded-lg px-3 py-2 text-xs font-medium text-slate-300 hover:bg-slate-800 hover:text-white"
            >
              <span>Switch to Agent Panel</span>
              <span className="text-slate-400">→</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => navigate('/scp/admin')}
              className="flex min-h-10 items-center justify-between rounded-lg px-3 py-2 text-xs font-medium text-slate-300 hover:bg-slate-800 hover:text-white"
            >
              <span>Switch to Admin Panel</span>
              <span className="text-slate-400">→</span>
            </button>
          )
        ) : null}
        <NavLink to="/" className={link}>
          Client portal
        </NavLink>
      </div>
    </>
  )

  return (
    <div
      className={`min-h-dvh bg-paper ${
        sidebarVisible ? 'md:grid md:grid-cols-[16.5rem_minmax(0,1fr)]' : 'block'
      }`}
    >
      {open ? (
        <button
          type="button"
          aria-label="Close menu"
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
          onClick={() => setOpen(false)}
        />
      ) : null}
      <aside
        className={`${
          open ? 'translate-x-0' : '-translate-x-full'
        } fixed inset-y-0 left-0 z-50 w-[min(20rem,88vw)] overflow-y-auto overscroll-contain bg-ink-950 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] text-white transition-transform ${
          sidebarVisible
            ? 'md:sticky md:top-0 md:z-20 md:h-dvh md:w-auto md:translate-x-0'
            : 'md:hidden'
        }`}
      >
        {nav}
      </aside>
      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-30 border-b border-line bg-surface/95 pt-[env(safe-area-inset-top)] backdrop-blur">
          <div className="flex items-center justify-between gap-2 px-3 py-2.5 sm:px-4 sm:py-3">
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="min-h-11 rounded-lg border border-line px-3 py-1.5 text-sm md:hidden"
                onClick={() => setOpen((v) => !v)}
              >
                Menu
              </button>
              <button
                type="button"
                title={sidebarVisible ? 'Collapse sidebar' : 'Expand sidebar'}
                aria-label={sidebarVisible ? 'Collapse sidebar' : 'Expand sidebar'}
                className="hidden h-9 w-9 items-center justify-center rounded-lg border border-line text-ink-600 transition hover:bg-paper hover:text-ink-950 md:inline-flex"
                onClick={toggleSidebar}
              >
                {sidebarVisible ? (
                  // Sidebar open: arrow pointing left to collapse
                  <svg
                    className="h-5 w-5"
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth={2}
                    stroke="currentColor"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                  </svg>
                ) : (
                  // Sidebar closed: arrow pointing right to expand
                  <svg
                    className="h-5 w-5"
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth={2}
                    stroke="currentColor"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                )}
              </button>
            </div>
            <div className="flex shrink-0 items-center gap-2 sm:gap-3">
              <ThemeToggle variant="ghost" />
              {/* Avatar dropdown — right side */}
              <div className="relative">
                <button
                  type="button"
                  onClick={handleAvatarClick}
                  className="group flex items-center rounded-full ring-2 ring-transparent transition hover:ring-brand-500 focus:outline-none"
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
                        <UserAvatar name={user?.name} avatar={user?.avatar} size="sm" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold text-ink-800">{user?.name}</p>
                          <p className="truncate text-xs text-ink-500">{user?.email}</p>
                          {isAdmin && (
                            <span className="mt-1 inline-block rounded-full bg-brand-50 px-2 py-0.5 text-[10px] font-semibold text-brand-700">
                              Admin
                            </span>
                          )}
                        </div>
                      </div>
                      <NavLink
                        to="/scp/profile"
                        onClick={() => setAvatarMenuOpen(false)}
                        className="flex items-center gap-2 px-4 py-2 text-sm text-ink-700 hover:bg-paper"
                      >
                        My profile
                      </NavLink>
                      {isAdmin && (
                        <button
                          type="button"
                          className="flex w-full items-center gap-2 px-4 py-2 text-sm text-ink-700 hover:bg-paper"
                          onClick={() => {
                            setAvatarMenuOpen(false)
                            navigate(inAdmin ? '/scp' : '/scp/admin')
                          }}
                        >
                          {inAdmin ? 'Agent panel' : 'Admin panel'}
                        </button>
                      )}
                      <div className="mt-1 border-t border-line pt-1">
                        <button
                          type="button"
                          className="flex w-full items-center gap-2 px-4 py-2 text-sm text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/20"
                          onClick={() => {
                            setAvatarMenuOpen(false)
                            logout()
                            navigate('/scp/login')
                          }}
                        >
                          Log out
                        </button>
                      </div>
                    </div>
                  </>
                ) : null}
              </div>
            </div>
          </div>
        </header>
        <main className="min-w-0 p-3 pb-[max(1rem,env(safe-area-inset-bottom))] sm:p-4 md:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
