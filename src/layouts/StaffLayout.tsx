import { useEffect, useMemo, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useTheme } from '../context/ThemeContext'
import { AdminBar } from './AdminBar'
import { AgentBar } from './AgentBar'
import { adminGroups, agentNav, type NavItem } from './staffNav'

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
  const { cycle, theme } = useTheme()
  const navigate = useNavigate()
  const location = useLocation()
  const [open, setOpen] = useState(false)
  const [navQ, setNavQ] = useState('')
  const isAdmin = user?.role === 'admin'
  const inAdmin = location.pathname.startsWith('/scp/admin')
  const [expanded, setExpanded] = useState<Record<string, boolean>>({
    agent: !inAdmin,
    admin: inAdmin,
    dashboard: true,
    settings: true,
    manage: true,
    emails: true,
    staff: true,
  })

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
    return () => window.removeEventListener('keydown', onKey)
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

  const nav = (
    <>
      <div className="mb-4 flex items-start justify-between gap-2">
        <NavLink to="/scp" className="flex min-w-0 items-center gap-2 font-semibold text-white" end>
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand-600 text-sm">SCP</span>
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
      <div className="mb-4">
        <button
          type="button"
          className="mb-1 flex min-h-10 w-full items-center justify-between px-3 text-xs font-semibold uppercase tracking-wide text-slate-400"
          onClick={() => setExpanded((e) => ({ ...e, agent: !e.agent }))}
        >
          Agent panel
          <span>{expanded.agent || query ? '−' : '+'}</span>
        </button>
        {expanded.agent || query ? (
          <nav className="flex flex-col gap-0.5">
            {filteredAgent.map((item) => (
              <NavLink key={item.to} to={item.to} end={item.end} className={link}>
                {item.label}
              </NavLink>
            ))}
          </nav>
        ) : null}
      </div>
      {isAdmin ? (
        <div className="mb-4">
          <button
            type="button"
            className="mb-1 flex min-h-10 w-full items-center justify-between px-3 text-xs font-semibold uppercase tracking-wide text-slate-400"
            onClick={() => setExpanded((e) => ({ ...e, admin: !e.admin }))}
          >
            Admin panel
            <span>{expanded.admin || query ? '−' : '+'}</span>
          </button>
          {expanded.admin || query
            ? filteredAdmin.map((group) => (
                <div key={group.id} className="mb-2">
                  <button
                    type="button"
                    className="mb-0.5 flex min-h-9 w-full items-center justify-between px-3 text-[11px] font-medium uppercase tracking-wide text-slate-500"
                    onClick={() => setExpanded((e) => ({ ...e, [group.id]: !e[group.id] }))}
                  >
                    {group.label}
                    <span>{expanded[group.id] || query ? '−' : '+'}</span>
                  </button>
                  {expanded[group.id] || query ? (
                    <nav className="flex flex-col gap-0.5">
                      {group.items.map((item) => (
                        <NavLink key={item.to} to={item.to} end={item.end} className={link}>
                          {item.label}
                        </NavLink>
                      ))}
                    </nav>
                  ) : null}
                </div>
              ))
            : null}
        </div>
      ) : null}
      <NavLink to="/" className={link}>
        Client portal
      </NavLink>
    </>
  )

  return (
    <div className="min-h-dvh bg-paper md:grid md:grid-cols-[16.5rem_minmax(0,1fr)]">
      {open ? (
        <button
          type="button"
          aria-label="Close menu"
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
          onClick={() => setOpen(false)}
        />
      ) : null}
      <aside
        className={`${open ? 'translate-x-0' : '-translate-x-full'} fixed inset-y-0 left-0 z-50 w-[min(20rem,88vw)] overflow-y-auto overscroll-contain bg-ink-950 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] text-white transition-transform md:static md:z-0 md:w-auto md:translate-x-0`}
      >
        {nav}
      </aside>
      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-30 border-b border-line bg-surface/95 pt-[env(safe-area-inset-top)] backdrop-blur">
          <div className="flex items-center justify-between gap-2 px-3 py-2.5 sm:px-4 sm:py-3">
            <button
              type="button"
              className="min-h-11 rounded-lg border border-line px-3 py-1.5 text-sm md:hidden"
              onClick={() => setOpen((v) => !v)}
            >
              Menu
            </button>
            <p className="min-w-0 flex-1 truncate text-sm text-ink-600">
              Welcome, <strong className="text-ink-800">{user?.name}</strong>
              {isAdmin ? (
                <span className="ml-2 hidden rounded-full bg-brand-50 px-2 py-0.5 text-xs font-semibold text-brand-700 xs:inline sm:inline">
                  Admin
                </span>
              ) : null}
            </p>
            <div className="flex shrink-0 items-center gap-2 sm:gap-3">
              {isAdmin ? (
                inAdmin ? (
                  <button type="button" className="hidden text-sm text-brand-600 sm:inline" onClick={() => navigate('/scp')}>
                    Agent panel
                  </button>
                ) : (
                  <button type="button" className="hidden text-sm text-brand-600 sm:inline" onClick={() => navigate('/scp/admin')}>
                    Admin panel
                  </button>
                )
              ) : null}
              <button type="button" onClick={cycle} className="text-sm capitalize text-ink-600">
                {theme}
              </button>
              <button
                type="button"
                className="text-sm text-brand-600"
                onClick={() => {
                  logout()
                  navigate('/scp/login')
                }}
              >
                Log out
              </button>
            </div>
          </div>
          {isAdmin && inAdmin ? <AdminBar /> : <AgentBar />}
        </header>
        <main className="min-w-0 p-3 pb-[max(1rem,env(safe-area-inset-bottom))] sm:p-4 md:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
