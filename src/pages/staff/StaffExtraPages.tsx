import { FormEvent, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { StatusBadge } from '../../components/Badges'
import { btnGhost, btnPrimary, Card, Field, inputClass, PageHeader } from '../../components/ui'
import { useAuth } from '../../context/AuthContext'
import { createApiFaqArticle, deleteApiFaqArticle, deleteApiOrganization, listApiDirectoryUsers, listApiFaqArticles, listApiOrganizations, saveApiDirectoryUser, saveApiOrganization, updateApiAccountPassword, updateApiFaqArticle, updateApiProfile, type ApiDirectoryUser, type ApiOrganization } from '../../lib/api'
import { useDb } from '../../hooks/useDb'
import { formatDate, relativeTime } from '../../lib/format'
import {
  accountSessionToken,
  createTask,
  removeCanned,
  removeFaq,
  removeRecord,
  replaceFaqs,
  updateProfile,
  updateTask,
  upsertCanned,
  upsertFaq,
  upsertRecord,
  upsertUser,
} from '../../lib/store'
import type { CannedResponse, Faq } from '../../types'
import type { TaskStatus } from '../../types'

export function StaffTasksPage() {
  const db = useDb()
  const [status, setStatus] = useState<TaskStatus | 'all'>('open')
  const [adding, setAdding] = useState(false)
  const tasks = useMemo(
    () => db.tasks.filter((t) => status === 'all' || t.status === status),
    [db.tasks, status],
  )

  function onAdd(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    createTask({
      title: String(form.get('title')),
      deptId: String(form.get('deptId')),
      assigneeId: String(form.get('assigneeId')) || undefined,
      ticketId: String(form.get('ticketId')) || undefined,
      dueAt: String(form.get('dueAt')) ? new Date(String(form.get('dueAt'))).toISOString() : undefined,
    })
    setAdding(false)
  }

  return (
    <div>
      <PageHeader
        title="Tasks"
        subtitle="Internal work items, optionally linked to tickets."
        actions={
          <button type="button" className={btnPrimary} onClick={() => setAdding((v) => !v)}>
            New task
          </button>
        }
      />
      <div className="mb-4 flex flex-wrap gap-2">
        {(['open', 'closed', 'all'] as const).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setStatus(s)}
            className={`rounded-full px-3 py-1.5 text-sm capitalize ${status === s ? 'bg-brand-600 text-white' : 'bg-surface ring-1 ring-line'}`}
          >
            {s}
          </button>
        ))}
      </div>
      {adding ? (
        <Card className="mb-6">
          <form onSubmit={onAdd} className="grid gap-4 sm:grid-cols-2">
            <Field label="Title" className="sm:col-span-2">
              <input name="title" required className={inputClass} />
            </Field>
            <Field label="Department">
              <select name="deptId" className={inputClass}>
                {db.departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Assignee">
              <select name="assigneeId" className={inputClass}>
                <option value="">Unassigned</option>
                {db.users
                  .filter((u) => u.role !== 'client')
                  .map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
              </select>
            </Field>
            <Field label="Linked ticket">
              <select name="ticketId" className={inputClass}>
                <option value="">None</option>
                {db.tickets.map((t) => (
                  <option key={t.id} value={t.id}>
                    #{t.number} {t.subject}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Due">
              <input name="dueAt" type="datetime-local" className={inputClass} />
            </Field>
            <div className="flex gap-2 sm:col-span-2">
              <button className={btnPrimary}>Create</button>
              <button type="button" className={btnGhost} onClick={() => setAdding(false)}>
                Cancel
              </button>
            </div>
          </form>
        </Card>
      ) : null}
      <ul className="grid gap-3">
        {tasks.map((task) => (
          <li key={task.id}>
            <Card>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="font-medium">
                    <Link to={`/scp/tasks/${task.id}`} className="hover:text-brand-600">
                      #{task.number} {task.title}
                    </Link>
                  </p>
                  <p className="text-sm text-ink-600">
                    {db.departments.find((d) => d.id === task.deptId)?.name}
                    {task.assigneeId ? ` · ${db.users.find((u) => u.id === task.assigneeId)?.name}` : ' · Unassigned'}
                    {task.dueAt ? ` · due ${formatDate(task.dueAt)}` : ''}
                  </p>
                  {task.ticketId ? (
                    <Link to={`/scp/tickets/${task.ticketId}`} className="text-sm text-brand-600">
                      Linked ticket
                    </Link>
                  ) : null}
                </div>
                <div className="flex flex-wrap gap-2">
                  <StatusBadge status={task.status === 'open' ? 'open' : 'closed'} />
                  <button
                    type="button"
                    className={btnGhost}
                    onClick={() => updateTask(task.id, { status: task.status === 'open' ? 'closed' : 'open' })}
                  >
                    {task.status === 'open' ? 'Close' : 'Reopen'}
                  </button>
                </div>
              </div>
            </Card>
          </li>
        ))}
      </ul>
      {tasks.length === 0 ? <p className="mt-4 text-sm text-ink-600">No tasks in this view.</p> : null}
    </div>
  )
}

export function StaffUsersPage() {
  const db = useDb()
  const [clients, setClients] = useState<ApiDirectoryUser[]>([])
  const [organizations, setOrganizations] = useState<ApiOrganization[]>([])
  const [q, setQ] = useState('')
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  async function refreshUsers() {
    const token = accountSessionToken()
    if (!token) { setError('Staff session expired. Sign in again.'); setLoading(false); return }
    try {
      const [result, orgResult] = await Promise.all([listApiDirectoryUsers(token), listApiOrganizations(token)])
      setClients(result.users)
      setOrganizations(orgResult.organizations)
      orgResult.organizations.forEach((org) => upsertRecord('organizations', { id: org.id, name: org.name, address: org.address, domain: org.domain || '', phone: org.phone || '', website: org.website, notes: org.notes || '' }))
      result.users.forEach((u) => upsertUser({ ...u, password: '', active: true, role: 'client' }))
      setError('')
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not load users from PostgreSQL.') }
    finally { setLoading(false) }
  }
  useEffect(() => { void refreshUsers() }, [])
  const filtered = clients.filter((u) => `${u.name} ${u.email} ${u.org}`.toLowerCase().includes(q.toLowerCase()))

  async function onAdd(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    const token = accountSessionToken()
    if (!token) { setError('Staff session expired. Sign in again.'); return }
    try {
      const result = await saveApiDirectoryUser({ name: String(form.get('name')), email: String(form.get('email')), phone: String(form.get('phone')), orgId: String(form.get('orgId')), org: String(form.get('org')) }, token)
      upsertUser({ ...result.user, password: '', active: true, role: 'client' })
      if (result.user.orgId && result.user.org) upsertRecord('organizations', { id: result.user.orgId, name: result.user.org, domain: '', phone: '', notes: '' })
      setClients((current) => [result.user, ...current.filter((u) => u.id !== result.user.id)])
      const orgResult = await listApiOrganizations(token)
      setOrganizations(orgResult.organizations)
      setError('')
      setAdding(false)
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not save user to PostgreSQL.') }
  }

  return (
    <div>
      <PageHeader
        title="User directory"
        subtitle="End users stored in PostgreSQL and linked to organizations."
        actions={
          <button type="button" className={btnPrimary} onClick={() => setAdding((v) => !v)}>
            Add user
          </button>
        }
      />
      {error ? <p role="alert" className="mb-4 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</p> : null}
      {loading ? <Card className="mb-4"><p className="text-sm text-ink-600">Loading users…</p></Card> : null}
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search users" className={`${inputClass} mb-4 max-w-md`} />
      {adding ? (
        <Card className="mb-6">
          <form onSubmit={onAdd} className="grid gap-4 sm:grid-cols-2">
            <Field label="Name">
              <input name="name" required className={inputClass} />
            </Field>
            <Field label="Email">
              <input name="email" type="email" required className={inputClass} />
            </Field>
            <Field label="Phone">
              <input name="phone" className={inputClass} />
            </Field>
            <Field label="Organization">
              <select name="orgId" className={inputClass} defaultValue="Ethiopian Customs Commission">
                
                {organizations.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Org label">
              <input name="org" className={inputClass} />
            </Field>
            <div className="sm:col-span-2">
              <button className={btnPrimary}>Save user</button>
            </div>
          </form>
        </Card>
      ) : null}
      <ul className="grid gap-3 lg:hidden">
        {filtered.map((u) => (
          <li key={u.id}>
            <Card>
              <Link to={`/scp/users/${u.id}`} className="font-medium hover:text-brand-600">
                {u.name}
              </Link>
              <p className="text-sm text-ink-600">
                {u.email}
                {u.org ? ` · ${u.org}` : ''}
              </p>
              <p className="text-xs text-ink-400">{db.tickets.filter((t) => t.userId === u.id).length} tickets</p>
            </Card>
          </li>
        ))}
      </ul>
      <div className="-mx-3 hidden overflow-x-auto px-3 lg:mx-0 lg:block lg:px-0">
        <div className="overflow-hidden rounded-2xl border border-line bg-surface">
        <table className="w-full min-w-[40rem] text-left text-sm">
          <thead className="bg-paper text-ink-600">
            <tr>
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-4 py-3 font-medium">Email</th>
              <th className="px-4 py-3 font-medium">Organization</th>
              <th className="px-4 py-3 font-medium">Tickets</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((u) => (
              <tr key={u.id} className="border-t border-line">
                <td className="px-4 py-3">
                  <Link to={`/scp/users/${u.id}`} className="text-brand-600">
                    {u.name}
                  </Link>
                </td>
                <td className="px-4 py-3">{u.email}</td>
                <td className="px-4 py-3">{u.org ?? db.organizations.find((o) => o.id === u.orgId)?.name ?? '—'}</td>
                <td className="px-4 py-3">{db.tickets.filter((t) => t.userId === u.id).length}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>
    </div>
  )
}

export function StaffOrgsPage() {
  const db = useDb()
  const [organizations, setOrganizations] = useState<ApiOrganization[]>([])
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  async function refreshOrganizations() {
    const token = accountSessionToken()
    if (!token) { setError('Staff session expired. Sign in again.'); setLoading(false); return }
    try {
      const result = await listApiOrganizations(token)
      setOrganizations(result.organizations)
      result.organizations.forEach((org) => upsertRecord('organizations', { id: org.id, name: org.name, address: org.address, domain: org.domain || '', phone: org.phone || '', website: org.website, notes: org.notes || '' }))
      setError('')
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not load organizations from PostgreSQL.') }
    finally { setLoading(false) }
  }
  useEffect(() => { void refreshOrganizations() }, [])
  async function onAdd(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    const token = accountSessionToken()
    if (!token) { setError('Staff session expired. Sign in again.'); return }
    try {
      const result = await saveApiOrganization({ name: String(form.get('name')), domain: String(form.get('domain')), phone: String(form.get('phone')), address: String(form.get('address')), website: String(form.get('website')), notes: String(form.get('notes')), status: 1 }, token)
      setOrganizations((current) => [result.organization, ...current])
      upsertRecord('organizations', { id: result.organization.id, name: result.organization.name, address: result.organization.address, domain: result.organization.domain || '', phone: result.organization.phone || '', website: result.organization.website, notes: result.organization.notes || '' })
      setError('')
      setAdding(false)
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not save organization to PostgreSQL.') }
  }
  return (
    <div>
      <PageHeader
        title="Organizations"
        subtitle="Organizations from the osTicket organization tables."
        actions={
          <button type="button" className={btnPrimary} onClick={() => setAdding((v) => !v)}>
            Add organization
          </button>
        }
      />
      {error ? <p role="alert" className="mb-4 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</p> : null}
      {loading ? <Card className="mb-4"><p className="text-sm text-ink-600">Loading organizations…</p></Card> : null}
      {adding ? (
        <Card className="mb-6">
          <OrgForm onSubmit={onAdd} onCancel={() => setAdding(false)} />
        </Card>
      ) : null}
      <ul className="grid gap-3 sm:grid-cols-2">
        {organizations.map((org) => (
          <li key={org.id}>
            <Card>
              <Link to={`/scp/orgs/${org.id}`} className="font-medium hover:text-brand-600">
                {org.name}
              </Link>
              <p className="text-sm text-ink-600">
                {org.domain} {org.phone ? `· ${org.phone}` : ''}
              </p>
              <p className="mt-2 text-sm text-ink-400">{org.notes}</p>
              <p className="mt-2 text-xs text-ink-400">{db.users.filter((u) => u.orgId === org.id).length} users</p>
              <button type="button" className="mt-3 text-sm text-rose-600" onClick={async () => { const token = accountSessionToken(); if (!token) { setError('Staff session expired. Sign in again.'); return }; try { await deleteApiOrganization(org.id, token); setOrganizations((items) => items.filter((item) => item.id !== org.id)); removeRecord('organizations', org.id); setError('') } catch (err) { setError(err instanceof Error ? err.message : 'Could not delete organization.') } }}>
                Delete
              </button>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  )
}

function OrgForm({ onSubmit, onCancel }: { onSubmit: (e: FormEvent<HTMLFormElement>) => void; onCancel: () => void }) {
  return (
    <form onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-2">
      <Field label="Name">
        <input name="name" required className={inputClass} />
      </Field>
      <Field label="Domain">
        <input name="domain" className={inputClass} />
      </Field>
      <Field label="Phone">
        <input name="phone" className={inputClass} />
      </Field>
      <Field label="Address">
        <input name="address" className={inputClass} />
      </Field>
      <Field label="Website">
        <input name="website" type="url" className={inputClass} />
      </Field>
      <Field label="Notes" className="sm:col-span-2">
        <textarea name="notes" className={inputClass} rows={3} />
      </Field>
      <div className="flex gap-2 sm:col-span-2">
        <button className={btnPrimary}>Save</button>
        <button type="button" className={btnGhost} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  )
}

export function StaffKbManagePage() {
  const db = useDb()
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<Faq | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    void listApiFaqArticles().then((articles) => {
      if (active) replaceFaqs(articles)
    }).catch((err: unknown) => {
      if (active) setError(err instanceof Error ? err.message : 'Could not load FAQ articles from PostgreSQL.')
    }).finally(() => {
      if (active) setLoading(false)
    })
    return () => { active = false }
  }, [])
  async function onSave(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    const payload = {
      question: String(form.get('question')),
      answer: String(form.get('answer')),
      categoryId: String(form.get('categoryId')),
      published: form.get('published') === 'on',
    }
    setSaving(true)
    setError('')
    try {
      const saved = editing ? await updateApiFaqArticle(editing.id, payload) : await createApiFaqArticle(payload)
      upsertFaq(saved)
      setAdding(false)
      setEditing(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the FAQ article.')
    } finally { setSaving(false) }
  }
  async function onDelete(id: string) {
    if (!window.confirm('Delete this FAQ article? This action cannot be undone.')) return
    setSaving(true)
    setError('')
    try {
      await deleteApiFaqArticle(id)
      removeFaq(id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete the FAQ article.')
    } finally { setSaving(false) }
  }
  return (
    <div>
      <PageHeader
        title="Knowledgebase"
        subtitle="FAQs visible on the client portal when published."
        actions={
          <button type="button" className={btnPrimary} onClick={() => setAdding((v) => !v)}>
            New FAQ
          </button>
        }
      />
      {adding || editing ? (
        <Card className="mb-6">
          <form onSubmit={(event) => void onSave(event)} className="grid gap-4">
            <Field label="Category">
              <select name="categoryId" required defaultValue={editing?.categoryId ?? ''} className={inputClass}>
                <option value="">Select a category</option>
                {db.categories.filter((c) => c.published !== false).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Question">
              <input name="question" required defaultValue={editing?.question} className={inputClass} />
            </Field>
            <Field label="Answer">
              <textarea name="answer" required rows={5} defaultValue={editing?.answer} className={inputClass} />
            </Field>
            <Field label="Published">
              <input name="published" type="checkbox" defaultChecked={editing?.published !== false} />
            </Field>
            <div className="flex gap-2">
              <button className={btnPrimary} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
              <button type="button" className={btnGhost} disabled={saving} onClick={() => { setAdding(false); setEditing(null) }}>
                Cancel
              </button>
            </div>
          </form>
        </Card>
      ) : null}
      {error ? <p role="alert" className="mb-4 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</p> : null}
      {loading ? <p className="text-sm text-ink-500">Loading FAQ articles from PostgreSQL…</p> : null}
      <ul className="space-y-3">
        {db.faqs.map((faq) => (
          <li key={faq.id}>
            <Card>
              <div className="flex flex-col gap-2 sm:flex-row sm:justify-between">
                <div>
                  <p className="font-medium">{faq.question}</p>
                  <p className="mt-1 line-clamp-2 text-sm text-ink-600">{faq.answer}</p>
                  <p className="mt-2 text-xs text-ink-400">
                    {db.categories.find((c) => c.id === faq.categoryId)?.name} · {faq.published === false ? 'Draft' : 'Published'}
                  </p>
                </div>
                <div className="flex gap-3">
                  <button type="button" className="text-sm text-brand-600" onClick={() => { setEditing(faq); setAdding(false) }}>
                    Edit
                  </button>
                  <button type="button" disabled={saving} className="text-sm text-rose-600 disabled:opacity-50" onClick={() => void onDelete(faq.id)}>
                    Delete
                  </button>
                </div>
              </div>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function StaffCannedPage() {
  const db = useDb()
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<CannedResponse | null>(null)
  function onSave(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    upsertCanned({
      id: editing?.id,
      title: String(form.get('title')),
      body: String(form.get('body')),
      deptId: String(form.get('deptId')) || undefined,
    })
    setAdding(false)
    setEditing(null)
  }
  return (
    <div>
      <PageHeader
        title="Canned responses"
        subtitle="Premade replies agents can insert on a ticket."
        actions={
          <button type="button" className={btnPrimary} onClick={() => setAdding((v) => !v)}>
            New response
          </button>
        }
      />
      {adding || editing ? (
        <Card className="mb-6">
          <form onSubmit={onSave} className="grid gap-4">
            <Field label="Title">
              <input name="title" required defaultValue={editing?.title} className={inputClass} />
            </Field>
            <Field label="Department">
              <select name="deptId" defaultValue={editing?.deptId ?? ''} className={inputClass}>
                <option value="">All departments</option>
                {db.departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Body">
              <textarea name="body" required rows={5} defaultValue={editing?.body} className={inputClass} />
            </Field>
            <div className="flex gap-2">
              <button className={btnPrimary}>Save</button>
              <button type="button" className={btnGhost} onClick={() => { setAdding(false); setEditing(null) }}>
                Cancel
              </button>
            </div>
          </form>
        </Card>
      ) : null}
      <ul className="space-y-3">
        {db.canned.map((c) => (
          <li key={c.id}>
            <Card>
              <p className="font-medium">{c.title}</p>
              <p className="mt-1 text-sm text-ink-600">{c.body}</p>
              <div className="mt-2 flex gap-3">
                <button type="button" className="text-sm text-brand-600" onClick={() => { setEditing(c); setAdding(false) }}>
                  Edit
                </button>
                <button type="button" className="text-sm text-rose-600" onClick={() => removeCanned(c.id)}>
                  Delete
                </button>
              </div>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function StaffProfilePage() {
  const { user } = useAuth()
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  if (!user) return null
  const staffUser = user
  async function onSave(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    const password = String(form.get('password'))
    const token = accountSessionToken()
    if (!token) { setError('Your session expired. Sign in again before saving your profile.'); return }
    try { await updateApiProfile(token, { name: String(form.get('name')), phone: String(form.get('phone')), org: staffUser.org || '', title: String(form.get('title')) }) }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not save profile.'); return }
    if (password) {
      try { await updateApiAccountPassword(token, password) }
      catch (err) { setError(err instanceof Error ? err.message : 'Could not update password.'); return }
    }
    updateProfile(staffUser.id, {
      name: String(form.get('name')),
      phone: String(form.get('phone')),
      title: String(form.get('title')),
    })
    setError('')
    setSaved(true)
  }
  return (
    <div>
      <PageHeader title="My profile" subtitle="Your agent account, saved to the help desk database." />
      <Card className="max-w-xl">
        {error ? <p role="alert" className="mb-4 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</p> : null}
        <form onSubmit={onSave} className="grid gap-4">
          <Field label="Name">
            <input name="name" defaultValue={staffUser.name} required className={inputClass} />
          </Field>
          <Field label="Email">
            <input readOnly value={staffUser.email} className={inputClass} />
          </Field>
          <Field label="Title">
            <input name="title" defaultValue={staffUser.title} className={inputClass} />
          </Field>
          <Field label="Phone">
            <input name="phone" defaultValue={staffUser.phone} className={inputClass} />
          </Field>
          <Field label="New password">
            <input name="password" type="password" minLength={8} placeholder="Leave blank to keep" className={inputClass} />
          </Field>
          <p className="text-sm text-ink-400">Signed in {relativeTime(new Date().toISOString())} · role {staffUser.role}</p>
          <button className={btnPrimary}>Save profile</button>
          {saved ? <p className="text-sm text-emerald-700">Saved.</p> : null}
        </form>
      </Card>
    </div>
  )
}

export function StaffUserPage() {
  const { id } = useParams()
  const db = useDb()
  const [saved, setSaved] = useState(false)
  const person = db.users.find((u) => u.id === id)
  if (!person) {
    return (
      <div>
        <PageHeader title="User not found" />
        <Link to="/scp/users" className="text-sm text-brand-600">
          Back to users
        </Link>
      </div>
    )
  }
  const tickets = db.tickets.filter((t) => t.userId === person.id)
  const org = db.organizations.find((o) => o.id === person.orgId)

  async function onSave(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    const token = accountSessionToken()
    if (!token) return
    try {
      const result = await saveApiDirectoryUser({ name: String(form.get('name')), email: String(form.get('email')), phone: String(form.get('phone')), org: String(form.get('org')), orgId: String(form.get('orgId')) }, token)
      upsertUser({ ...result.user, password: '', active: true, role: 'client' })
      setSaved(true)
    } catch (err) { window.alert(err instanceof Error ? err.message : 'Could not save user.') }
  }

  return (
    <div className="space-y-6">
      <Link to="/scp/users" className="text-sm text-brand-600">
        ← Users
      </Link>
      <PageHeader title={person.name} subtitle={person.email} />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <Card>
          <h2 className="font-semibold">Tickets</h2>
          <ul className="mt-3 space-y-2 text-sm">
            {tickets.map((t) => (
              <li key={t.id}>
                <Link to={`/scp/tickets/${t.id}`} className="text-brand-600">
                  #{t.number} {t.subject}
                </Link>
                <span className="ml-2 text-ink-400">{t.status}</span>
              </li>
            ))}
            {tickets.length === 0 ? <li className="text-ink-400">No tickets.</li> : null}
          </ul>
        </Card>
        <Card>
          <h2 className="font-semibold">Edit user</h2>
          <form onSubmit={onSave} className="mt-3 grid gap-3 text-sm">
            <Field label="Name">
              <input name="name" defaultValue={person.name} required className={inputClass} />
            </Field>
            <Field label="Email">
              <input name="email" type="email" value={person.email} readOnly className={inputClass} />
            </Field>
            <Field label="Phone">
              <input name="phone" defaultValue={person.phone} className={inputClass} />
            </Field>
            <Field label="Organization">
              <select name="orgId" defaultValue={person.orgId ?? ''} className={inputClass}>
                <option value="">None</option>
                {db.organizations.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Org label">
              <input name="org" defaultValue={person.org} className={inputClass} />
            </Field>
            <button className={btnPrimary}>Save</button>
            {saved ? <p className="text-emerald-700">Saved.</p> : null}
            {org ? (
              <p>
                Linked org:{' '}
                <Link to={`/scp/orgs/${org.id}`} className="text-brand-600">
                  {org.name}
                </Link>
              </p>
            ) : null}
          </form>
        </Card>
      </div>
    </div>
  )
}

export function StaffOrgPage() {
  const { id } = useParams()
  const db = useDb()
  const [saved, setSaved] = useState(false)
  const org = db.organizations.find((o) => o.id === id)
  if (!org) {
    return (
      <div>
        <PageHeader title="Organization not found" />
        <Link to="/scp/orgs" className="text-sm text-brand-600">
          Back to organizations
        </Link>
      </div>
    )
  }
  const members = db.users.filter((u) => u.orgId === org.id)

  async function onSave(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    const token = accountSessionToken()
    if (!token) return
    try {
      const result = await saveApiOrganization({ id: org!.id, name: String(form.get('name')), domain: String(form.get('domain')), phone: String(form.get('phone')), address: String(form.get('address')), website: String(form.get('website')), notes: String(form.get('notes')), status: 1 }, token)
      const updated = result.organization
      upsertRecord('organizations', { id: updated.id, name: updated.name, address: updated.address, domain: updated.domain, phone: updated.phone, website: updated.website, notes: updated.notes })
      setSaved(true)
    } catch (err) { window.alert(err instanceof Error ? err.message : 'Could not save organization.') }
  }

  return (
    <div className="space-y-6">
      <Link to="/scp/orgs" className="text-sm text-brand-600">
        ← Organizations
      </Link>
      <PageHeader title={org.name} subtitle={org.domain || 'No domain'} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <h2 className="font-semibold">Users</h2>
          <ul className="mt-3 space-y-2 text-sm">
            {members.map((u) => (
              <li key={u.id}>
                <Link to={`/scp/users/${u.id}`} className="text-brand-600">
                  {u.name}
                </Link>
                <span className="ml-2 break-all text-ink-400">{u.email}</span>
              </li>
            ))}
            {members.length === 0 ? <li className="text-ink-400">No users linked.</li> : null}
          </ul>
        </Card>
        <Card>
          <h2 className="font-semibold">Edit organization</h2>
          <form onSubmit={onSave} className="mt-3 grid gap-3 text-sm">
            <Field label="Name">
              <input name="name" defaultValue={org.name} required className={inputClass} />
            </Field>
            <Field label="Domain">
              <input name="domain" defaultValue={org.domain} className={inputClass} />
            </Field>
          <Field label="Address">
            <input name="address" defaultValue={org.address} className={inputClass} />
          </Field>
            <Field label="Phone">
              <input name="phone" defaultValue={org.phone} className={inputClass} />
            </Field>
          <Field label="Website">
            <input name="website" type="url" defaultValue={org.website} className={inputClass} />
          </Field>
            <Field label="Notes">
              <textarea name="notes" rows={3} defaultValue={org.notes} className={inputClass} />
            </Field>
            <button className={btnPrimary}>Save</button>
            {saved ? <p className="text-emerald-700">Saved.</p> : null}
          </form>
        </Card>
      </div>
    </div>
  )
}

export function StaffTaskPage() {
  const { id } = useParams()
  const db = useDb()
  const [saved, setSaved] = useState(false)
  const task = db.tasks.find((t) => t.id === id)
  if (!task) {
    return (
      <div>
        <PageHeader title="Task not found" />
        <Link to="/scp/tasks" className="text-sm text-brand-600">
          Back to tasks
        </Link>
      </div>
    )
  }

  function onSave(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    updateTask(task!.id, {
      title: String(form.get('title')),
      deptId: String(form.get('deptId')),
      assigneeId: String(form.get('assigneeId')) || undefined,
      ticketId: String(form.get('ticketId')) || undefined,
      dueAt: String(form.get('dueAt')) ? new Date(String(form.get('dueAt'))).toISOString() : undefined,
      status: String(form.get('status')) as TaskStatus,
    })
    setSaved(true)
  }

  return (
    <div className="space-y-6">
      <Link to="/scp/tasks" className="text-sm text-brand-600">
        ← Tasks
      </Link>
      <PageHeader title={`#${task.number} ${task.title}`} subtitle={db.departments.find((d) => d.id === task.deptId)?.name} />
      <Card>
        <form onSubmit={onSave} className="grid gap-4 sm:grid-cols-2">
          <Field label="Title" className="sm:col-span-2">
            <input name="title" defaultValue={task.title} required className={inputClass} />
          </Field>
          <Field label="Department">
            <select name="deptId" defaultValue={task.deptId} className={inputClass}>
              {db.departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Status">
            <select name="status" defaultValue={task.status} className={inputClass}>
              <option value="open">Open</option>
              <option value="closed">Closed</option>
            </select>
          </Field>
          <Field label="Assignee">
            <select name="assigneeId" defaultValue={task.assigneeId ?? ''} className={inputClass}>
              <option value="">Unassigned</option>
              {db.users.filter((u) => u.role !== 'client').map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Linked ticket">
            <select name="ticketId" defaultValue={task.ticketId ?? ''} className={inputClass}>
              <option value="">None</option>
              {db.tickets.map((t) => (
                <option key={t.id} value={t.id}>
                  #{t.number} {t.subject}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Due">
            <input name="dueAt" type="datetime-local" defaultValue={task.dueAt ? task.dueAt.slice(0, 16) : ''} className={inputClass} />
          </Field>
          <Field label="Created">
            <input readOnly value={formatDate(task.createdAt)} className={inputClass} />
          </Field>
          <div className="flex flex-wrap gap-2 sm:col-span-2">
            <button className={btnPrimary}>Save task</button>
            <button type="button" className={btnGhost} onClick={() => updateTask(task.id, { status: task.status === 'open' ? 'closed' : 'open' })}>
              {task.status === 'open' ? 'Close task' : 'Reopen task'}
            </button>
          </div>
          {saved ? <p className="text-sm text-emerald-700 sm:col-span-2">Saved.</p> : null}
        </form>
        {task.ticketId ? (
          <Link to={`/scp/tickets/${task.ticketId}`} className="mt-4 inline-block text-sm text-brand-600">
            Open linked ticket
          </Link>
        ) : null}
      </Card>
    </div>
  )
}
