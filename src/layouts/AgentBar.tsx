import { NavLink, useLocation } from 'react-router-dom'
import { agentTabs } from './staffNav'

function tabActive(pathname: string, id: string) {
  if (id === 'dashboard') return pathname === '/scp' || pathname === '/scp/directory' || pathname === '/scp/profile'
  if (id === 'users') return pathname.startsWith('/scp/users') || pathname.startsWith('/scp/orgs')
  if (id === 'tasks') return pathname.startsWith('/scp/tasks')
  if (id === 'tickets') return pathname.startsWith('/scp/tickets') || pathname.startsWith('/scp/search')
  if (id === 'kb') return pathname.startsWith('/scp/kb') || pathname.startsWith('/scp/canned')
  return false
}

export function AgentBar() {
  const { pathname } = useLocation()
  if (pathname.startsWith('/scp/admin')) return null

  return (
    <div className="border-t border-line bg-surface">
      <nav className="flex gap-1 overflow-x-auto px-3 py-2 sm:px-4" aria-label="Agent tabs">
        {agentTabs.map((tab) => {
          const active = tabActive(pathname, tab.id)
          return (
            <NavLink
              key={tab.id}
              to={tab.to}
              end={tab.id === 'dashboard'}
              className={`shrink-0 rounded-lg px-3 py-2 text-sm font-medium ${
                active ? 'bg-brand-600 text-white' : 'text-ink-600 hover:bg-paper'
              }`}
            >
              {tab.label}
            </NavLink>
          )
        })}
      </nav>
    </div>
  )
}
