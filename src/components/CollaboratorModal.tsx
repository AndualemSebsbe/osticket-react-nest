import { useEffect, useMemo, useState } from 'react'
import { listApiDirectoryUsers, type ApiDirectoryUser } from '../lib/api'
import { accountSessionToken } from '../lib/store'
import { btnGhost, btnPrimary, inputClass } from './ui'

export interface CollaboratorEntry { userId?: string; name: string; email: string; active: boolean }

export function CollaboratorModal({ open, value, onClose, onSave }: {
  open: boolean
  value: CollaboratorEntry[]
  onClose: () => void
  onSave: (next: CollaboratorEntry[]) => void | Promise<void>
}) {
  const [people, setPeople] = useState<ApiDirectoryUser[]>([])
  const [peopleLoading, setPeopleLoading] = useState(false)
  const [peopleError, setPeopleError] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [entries, setEntries] = useState<CollaboratorEntry[]>(value)
  const [selected, setSelected] = useState('')
  const [search, setSearch] = useState('')
  const [comboOpen, setComboOpen] = useState(false)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  useEffect(() => {
    if (!open) return
    setEntries(value)
    setSearch('')
    setSelected('')
    setSaveError('')
    const token = accountSessionToken()
    if (!token) {
      setPeopleError('Staff session is not available. Please sign in again.')
      return
    }
    let active = true
    setPeopleLoading(true)
    setPeopleError('')
    void listApiDirectoryUsers(token)
      .then(({ users }) => { if (active) setPeople(users) })
      .catch((error: unknown) => {
        if (!active) return
        setPeopleError(error instanceof Error ? error.message : 'Could not load users from ost_user.')
      })
      .finally(() => { if (active) setPeopleLoading(false) })
    return () => { active = false }
  }, [open, value])
  const availablePeople = useMemo(() => {
    const query = search.trim().toLowerCase()
    return people.filter((person) =>
      !entries.some((item) => item.email.toLowerCase() === person.email.toLowerCase() && item.active) &&
      (!query || `${person.name} ${person.email}`.toLowerCase().includes(query)),
    )
  }, [people, entries, search])
  if (!open) return null

  function add(nameValue: string, emailValue: string, userId?: string) {
    const normalized = emailValue.trim().toLowerCase()
    if (!normalized || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) return
    setEntries((current) => {
      const existing = current.find((item) => item.email.toLowerCase() === normalized)
      if (existing) return current.map((item) => item.email.toLowerCase() === normalized ? { ...item, active: true } : item)
      return [...current, { userId, name: nameValue.trim() || normalized, email: normalized, active: true }]
    })
    setName('')
    setEmail('')
    setSelected('')
    setSearch('')
    setComboOpen(false)
  }

  async function save() {
    setSaving(true)
    setSaveError('')
    try {
      await onSave(entries)
      onClose()
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Could not save collaborators.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section role="dialog" aria-modal="true" aria-labelledby="collaborator-modal-title" className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-t-2xl bg-surface p-5 shadow-2xl sm:rounded-2xl">
        <div className="flex items-start justify-between gap-4">
          <div><h2 id="collaborator-modal-title" className="text-lg font-semibold">Manage collaborators</h2><p className="mt-1 text-sm text-ink-500">Enable participants to receive replies, or remove them from this ticket.</p></div>
          <button type="button" className={btnGhost} onClick={onClose} aria-label="Close">×</button>
        </div>
        <ul className="mt-4 divide-y divide-line rounded-xl border border-line">
          {entries.map((entry) => <li key={entry.email} className="flex items-center gap-3 p-3">
            <input type="checkbox" checked={entry.active} aria-label={`Enable ${entry.email}`} onChange={(event) => setEntries((current) => current.map((item) => item.email === entry.email ? { ...item, active: event.target.checked } : item))} />
            <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{entry.name}</span><span className="block truncate text-xs text-ink-500">{entry.email}</span></span>
            <button type="button" className="text-sm text-rose-600" onClick={() => setEntries((current) => current.filter((item) => item.email !== entry.email))}>Remove</button>
          </li>)}
          {!entries.length ? <li className="p-4 text-sm text-ink-500">No collaborators yet.</li> : null}
        </ul>
        <div className="mt-4 grid gap-2 sm:grid-cols-[1fr_auto]">
          <div className="relative">
            <input
              className={inputClass}
              type="text"
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={comboOpen}
              aria-controls="collaborator-user-options"
              aria-label="Select an existing collaborator"
              value={search}
              onFocus={() => setComboOpen(true)}
              onChange={(event) => { setSearch(event.target.value); setSelected(''); setComboOpen(true) }}
              onKeyDown={(event) => {
                if (event.key === 'Escape') setComboOpen(false)
                if (event.key === 'Enter' && comboOpen && availablePeople.length) {
                  event.preventDefault()
                  const person = availablePeople[0]
                  setSelected(person.id)
                  setSearch(`${person.name} (${person.email})`)
                  setComboOpen(false)
                }
              }}
              placeholder={peopleLoading ? 'Loading users…' : 'Select or search all users…'}
              disabled={peopleLoading || Boolean(peopleError)}
            />
            {comboOpen && !peopleLoading && !peopleError ? (
              <ul id="collaborator-user-options" role="listbox" className="absolute z-10 mt-1 max-h-56 w-full overflow-y-auto rounded-xl border border-line bg-surface py-1 shadow-lg">
                {availablePeople.map((person) => (
                  <li key={person.id} role="option" aria-selected={selected === person.id}>
                    <button type="button" className="w-full px-3 py-2 text-left text-sm hover:bg-paper" onMouseDown={(event) => event.preventDefault()} onClick={() => { setSelected(person.id); setSearch(`${person.name} (${person.email})`); setComboOpen(false) }}>
                      <span className="block font-medium">{person.name}</span>
                      <span className="block text-xs text-ink-500">{person.email}</span>
                    </button>
                  </li>
                ))}
                {!availablePeople.length ? <li className="px-3 py-2 text-sm text-ink-500">No matching users found.</li> : null}
              </ul>
            ) : null}
            {peopleError ? <p className="text-sm text-rose-700">{peopleError}</p> : null}
          </div>
          <button type="button" className={btnGhost} disabled={!selected} onClick={() => { const person = people.find((item) => item.id === selected); if (person) add(person.name, person.email, person.id) }}>Add user</button>
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
          <input className={inputClass} value={name} onChange={(event) => setName(event.target.value)} placeholder="Name (optional)" />
          <input className={inputClass} type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Email address" />
          <button type="button" className={btnGhost} onClick={() => add(name, email)}>Add email</button>
        </div>
        {saveError ? <p role="alert" className="mt-3 text-sm text-rose-700">{saveError}</p> : null}
        <div className="mt-5 flex justify-end gap-2"><button type="button" className={btnGhost} disabled={saving} onClick={onClose}>Cancel</button><button type="button" className={btnPrimary} disabled={saving} onClick={() => void save()}>{saving ? 'Saving…' : 'Save collaborators'}</button></div>
      </section>
    </div>
  )
}
