import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { inputClass } from '../components/ui'
import { adminGroupForPath, adminGroups, adminItemForPath } from './staffNav'

export function AdminBar() {
  const location = useLocation()
  const navigate = useNavigate()
  const activeGroup = adminGroupForPath(location.pathname)
  const activeItem = adminItemForPath(location.pathname)

  return (
    <div className="border-t border-line bg-surface">
      <div className="grid gap-2 px-4 py-3 lg:hidden">
        <label className="block text-xs font-medium uppercase tracking-wide text-ink-400">
          Admin section
          <select
            className={`${inputClass} mt-1`}
            value={activeGroup.id}
            onChange={(e) => {
              const group = adminGroups.find((g) => g.id === e.target.value)
              if (group) navigate(group.items[0].to)
            }}
          >
            {adminGroups.map((group) => (
              <option key={group.id} value={group.id}>
                {group.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-xs font-medium uppercase tracking-wide text-ink-400">
          Page
          <select
            className={`${inputClass} mt-1`}
            value={activeItem.to}
            onChange={(e) => navigate(e.target.value)}
          >
            {activeGroup.items.map((item) => (
              <option key={item.to} value={item.to}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="hidden px-4 py-2 lg:block md:px-8">
        <nav className="flex flex-wrap gap-1 border-b border-line pb-2" aria-label="Admin tabs">
          {adminGroups.map((group) => {
            const active = group.id === activeGroup.id
            return (
              <button
                key={group.id}
                type="button"
                onClick={() => navigate(group.items[0].to)}
                className={`rounded-t-lg px-3 py-2 text-sm font-medium ${
                  active ? 'bg-brand-600 text-white' : 'text-ink-600 hover:bg-paper'
                }`}
              >
                {group.label}
              </button>
            )
          })}
        </nav>
        <nav className="flex flex-wrap gap-2 pt-2" aria-label="Admin pages">
          {activeGroup.items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `rounded-lg px-2.5 py-1.5 text-sm font-medium ${isActive ? 'bg-brand-50 text-brand-700' : 'text-ink-600 hover:bg-paper'}`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      </div>
    </div>
  )
}
