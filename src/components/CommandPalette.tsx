import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useDb } from '../hooks/useDb'
import { adminNavItems, agentNav } from '../layouts/staffNav'

import { inputClass } from "./ui"
export function CommandPalette() {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const navigate = useNavigate()
  const { user } = useAuth()
  const db = useDb()
  const staff = user?.role === 'agent' || user?.role === 'admin'

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen((v) => !v)
      }
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const items = useMemo(() => {
    const query = q.trim().toLowerCase()
    const links = [
      { label: 'Home', to: '/' },
      { label: 'Open a ticket', to: '/open' },
      { label: 'Check status', to: '/status' },
      { label: 'Knowledge base', to: '/kb' },
      ...(staff ? agentNav.map((l) => ({ label: l.label, to: l.to })) : []),
      ...(user?.role === 'admin' ? adminNavItems.map((l) => ({ label: `Admin · ${l.label}`, to: l.to })) : []),
    ]
    const tickets = db.tickets
      .filter((t) => !query || `${t.number} ${t.subject}`.toLowerCase().includes(query))
      .slice(0, 8)
      .map((t) => ({
        label: `#${t.number} ${t.subject}`,
        to: staff ? `/scp/tickets/${t.id}` : `/tickets/${t.id}`,
      }))
    const faqs = db.faqs
      .filter((f) => !query || f.question.toLowerCase().includes(query))
      .slice(0, 6)
      .map((f) => ({ label: f.question, to: `/kb/${f.id}` }))
    const pages = links.filter((l) => !query || l.label.toLowerCase().includes(query))
    return [...pages, ...tickets, ...faqs]
  }, [db, q, staff, user?.role])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 grid place-items-start bg-black/40 p-3 pt-[max(12vh,env(safe-area-inset-top))] sm:p-4" onClick={() => setOpen(false)}>
      <div
        className="w-full max-w-lg overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Jump to a page, ticket, or article…"
          className={inputClass}
        />
        <ul className="max-h-80 overflow-auto p-2">
          {items.length === 0 ? <li className="px-3 py-2 text-sm text-ink-600">Nothing matched.</li> : null}
          {items.map((item) => (
            <li key={item.to + item.label}>
              <button
                type="button"
                className="w-full rounded-xl px-3 py-2 text-left text-sm hover:bg-paper"
                onClick={() => {
                  navigate(item.to)
                  setOpen(false)
                  setQ('')
                }}
              >
                {item.label}
              </button>
            </li>
          ))}
        </ul>
        <p className="border-t border-line px-4 py-2 text-xs text-ink-400">Esc to close · Ctrl/⌘ K anytime</p>
      </div>
    </div>
  )
}
