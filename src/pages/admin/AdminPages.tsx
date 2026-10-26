import { FormEvent, useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useSearchParams } from 'react-router-dom'
import { btnGhost, btnPrimary, Card, DataTable, Field, inputClass, PageHeader } from '../../components/ui'
import { useAuth } from '../../context/AuthContext'
import { useDb } from '../../hooks/useDb'
import { adminGroups } from '../../layouts/staffNav'
import { createApiBranch, createApiDepartment, createApiFaqCategory, createApiHelpTopic, deleteApiBranch, deleteApiDepartment, deleteApiFaqCategory, deleteApiHelpTopic, listApiAdminBranches, listApiDepartments, listApiHelpTopics, listApiStaff, listApiUsers, saveApiStaff, saveApiTicketVisibility, sendMailTest, updateApiBranch, updateApiDepartment, updateApiFaqCategory, updateApiHelpTopic, updateApiUserVerification, type ApiBranch, type ApiDepartment, type ApiHelpTopic, type ApiStaffAccount } from '../../lib/api'
import { formatDate } from '../../lib/format'
import { accountSessionToken, addLog, newId, removeRecord, saveSettings, syncUserVerification, upsertUser } from '../../lib/store'
import type { LogLevel, SystemSettings, User } from '../../types'
import { EntityManager } from './EntityManager'

export function RequireAdmin({ children }: { children: React.ReactNode }) {
  const { user, ready } = useAuth()
  if (!ready) return <div className="p-6 text-sm text-ink-500">Checking your session…</div>
  if (user?.role !== 'admin') return <Navigate to="/scp" replace />
  return children
}

export function AdminDashboardPage() {
  const db = useDb()
  const modules = [
    { to: '/scp/admin/users', title: 'User verification', body: `${db.users.filter((u) => u.role === 'client' && u.verificationStatus === 'pending').length} accounts awaiting approval.` },
    { to: '/scp/admin/settings', title: 'Settings', body: 'Company, system, tickets, tasks, agents, users, and knowledgebase options.' },
    { to: '/scp/admin/topics', title: 'Help topics', body: `${db.topics.length} topics route new tickets to departments.` },
    { to: '/scp/admin/filters', title: 'Ticket filters', body: `${db.filters.length} inbound matching rules.` },
    { to: '/scp/admin/slas', title: 'SLA plans', body: `${db.slas.length} grace-period plans.` },
    { to: '/scp/admin/schedules', title: 'Schedules', body: `${db.schedules.length} business-hour calendars.` },
    { to: '/scp/admin/apikeys', title: 'API keys', body: `${db.apiKeys.length} HTTP API credentials.` },
    { to: '/scp/admin/pages', title: 'Site pages', body: `${db.pages.length} landing and offline pages.` },
    { to: '/scp/admin/forms', title: 'Custom forms', body: `${db.forms.length} dynamic field sets.` },
    { to: '/scp/admin/lists', title: 'Custom lists', body: `${db.lists.length} reusable option lists.` },
    { to: '/scp/admin/categories', title: 'FAQ categories', body: `${db.categories.length} knowledgebase folders.` },
    { to: '/scp/admin/plugins', title: 'Plugins', body: `${db.plugins.filter((p) => p.enabled).length} enabled add-ons.` },
    { to: '/scp/admin/emails', title: 'Emails', body: `${db.emails.length} mailboxes.` },
    { to: '/scp/admin/email-settings', title: 'Email settings', body: 'Inbound and outbound defaults.' },
    { to: '/scp/admin/banlist', title: 'Banlist', body: `${db.banlist.length} blocked addresses.` },
    { to: '/scp/admin/templates', title: 'Templates', body: `${db.templates.length} notice packs.` },
    { to: '/scp/admin/diagnostic', title: 'Email diagnostic', body: 'Send a demo test message.' },
    { to: '/scp/admin/staff', title: 'Agents', body: `${db.users.filter((u) => u.role !== 'client').length} staff accounts.` },
    { to: '/scp/admin/teams', title: 'Teams', body: `${db.teams.length} assignment groups.` },
    { to: '/scp/admin/roles', title: 'Roles', body: `${db.roles.length} permission packs.` },
    { to: '/scp/admin/departments', title: 'Departments', body: `${db.departments.length} routing groups.` },
    { to: '/scp/admin/logs', title: 'System logs', body: `${db.logs.length} recorded events.` },
    { to: '/scp/admin/audits', title: 'Audit logs', body: `${db.audits.length} staff actions.` },
    { to: '/scp/admin/info', title: 'Information', body: 'About this React rebuild of osTicket.' },
  ]
  const byPath = Object.fromEntries(modules.map((m) => [m.to, m]))
  return (
    <div className="min-w-0 space-y-8">
      <PageHeader title="Admin panel" subtitle="Same Dashboard / Settings / Manage / Emails / Agents tabs as osTicket-develop — laid out for phones, tablets, and desktops." />
      {adminGroups.map((group) => {
        const items = group.items.filter((item) => item.to !== '/scp/admin')
        if (items.length === 0) return null
        return (
          <section key={group.id}>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-400">{group.label}</h2>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {items.map((item) => {
                const m = byPath[item.to] ?? { title: item.label, body: `Open ${item.label}.` }
                return (
                  <Link key={item.to} to={item.to} className="block min-w-0">
                    <Card className="h-full transition hover:border-brand-500">
                      <p className="font-semibold">{m.title}</p>
                      <p className="mt-1 text-sm text-ink-600">{m.body}</p>
                    </Card>
                  </Link>
                )
              })}
            </div>
          </section>
        )
      })}
    </div>
  )
}

export function AdminBranchesPage() {
  const [branches, setBranches] = useState<ApiBranch[]>([])
  const [editing, setEditing] = useState<ApiBranch | 'new' | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    void listApiAdminBranches().then((items) => {
      if (active) setBranches(items)
    }).catch((err: unknown) => {
      if (active) setError(err instanceof Error ? err.message : 'Could not load branches from PostgreSQL.')
    }).finally(() => {
      if (active) setLoading(false)
    })
    return () => { active = false }
  }, [])

  async function saveBranch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!editing) return
    const form = new FormData(event.currentTarget)
    const payload = { name: String(form.get('name') || ''), active: form.get('active') === 'on' }
    setSaving(true)
    setError('')
    try {
      const saved = editing === 'new' ? await createApiBranch(payload) : await updateApiBranch(editing.id, payload)
      setBranches((current) => [...current.filter((item) => item.id !== saved.id), saved].sort((a,b) => a.name.localeCompare(b.name)))
      setEditing(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the branch.')
    } finally { setSaving(false) }
  }

  async function deleteBranch(id: string) {
    if (!window.confirm('Delete this branch? This action cannot be undone.')) return
    setSaving(true)
    setError('')
    try {
      await deleteApiBranch(id)
      setBranches((current) => current.filter((item) => item.id !== id))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete the branch.')
    } finally { setSaving(false) }
  }

  const rows: Record<string, unknown>[] = branches.map((branch) => ({ ...branch, active: branch.active !== false }))
  const actions = (row: Record<string, unknown>) => (
    <div className="flex flex-wrap gap-3">
      <button type="button" disabled={saving} className="text-brand-600 disabled:opacity-50" onClick={() => setEditing(branches.find((branch) => branch.id === String(row.id)) || null)}>Edit</button>
      <button type="button" disabled={saving} className="text-rose-600 disabled:opacity-50" onClick={() => void deleteBranch(String(row.id))}>Delete</button>
    </div>
  )

  return (
    <div>
      <PageHeader title="Branches" subtitle="Manage ticket branches stored in ost_branch." actions={<button type="button" className={btnPrimary} onClick={() => setEditing('new')}>Add branch</button>} />
      {editing ? (
        <Card className="mb-6">
          <h2 className="mb-4 font-semibold">{editing === 'new' ? 'Add branch' : 'Edit branch'}</h2>
          <form onSubmit={(event) => void saveBranch(event)} className="grid gap-4 sm:grid-cols-2">
            <Field label="Branch name"><input name="name" required maxLength={128} defaultValue={editing === 'new' ? '' : editing.name} className={inputClass} /></Field>
            <Field label="Active"><input name="active" type="checkbox" defaultChecked={editing === 'new' || editing.active !== false} className="h-4 w-4" /></Field>
            <div className="flex gap-2 sm:col-span-2">
              <button type="submit" disabled={saving} className={btnPrimary}>{saving ? 'Saving…' : 'Save branch'}</button>
              <button type="button" disabled={saving} className={btnGhost} onClick={() => setEditing(null)}>Cancel</button>
            </div>
          </form>
        </Card>
      ) : null}
      {error ? <p role="alert" className="mb-4 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</p> : null}
      {loading ? <p className="text-sm text-ink-500">Loading branches…</p> : (
        <DataTable
          rows={rows}
          rowKey={(row) => String(row.id)}
          empty="No branches have been created."
          columns={[
            { key: 'name', label: 'Branch', render: (row) => String(row.name) },
            { key: 'active', label: 'Status', render: (row) => row.active ? 'Active' : 'Inactive' },
            { key: 'actions', label: 'Actions', render: actions },
          ]}
          renderCard={(row) => <Card><p className="font-medium">{String(row.name)}</p><p className="mt-1 text-sm text-ink-500">{row.active ? 'Active' : 'Inactive'}</p><div className="mt-3">{actions(row)}</div></Card>}
        />
      )}
    </div>
  )
}

export function AdminUserVerificationPage() {
  const { user: actor } = useAuth()
  const [filter, setFilter] = useState<'pending' | 'all'>('pending')
  const [error, setError] = useState('')
  const [clients, setClients] = useState<Array<{ id: string; name: string; email: string; phone?: string; verificationStatus: 'pending' | 'approved' | 'rejected'; registeredAt: string | null }>>([])
  const [loading, setLoading] = useState(true)

  async function refresh() {
    try {
      const token = accountSessionToken()
      if (!token) throw new Error('Administrator session expired. Sign in again.')
      const result = await listApiUsers(token)
      setClients(result.users)
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load accounts from PostgreSQL.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refresh()
    const timer = window.setInterval(() => { void refresh() }, 30_000)
    return () => window.clearInterval(timer)
  }, [])

  async function setStatus(person: (typeof clients)[number], status: 'approved' | 'rejected') {
    if (!actor) return
    try {
      const token = accountSessionToken()
      if (!token) throw new Error('Administrator session expired. Sign in again.')
      await updateApiUserVerification(person, status, actor.name, token)
      syncUserVerification(person.email, status, actor)
      setClients((items) => items.map((item) => item.id === person.id ? { ...item, verificationStatus: status } : item))
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update account verification.')
    }
  }

  return (
    <div>
      <PageHeader title="User verification" subtitle="Review client registrations before allowing account sign-in." />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-600">{clients.filter((u) => u.verificationStatus === 'pending').length} pending approval</p>
        <div className="flex flex-wrap gap-2">
          <select aria-label="Filter accounts" value={filter} onChange={(e) => setFilter(e.target.value as 'pending' | 'all')} className={inputClass}>
            <option value="pending">Pending review</option>
            <option value="all">All client accounts</option>
          </select>
          <button type="button" className={btnGhost} onClick={() => { setLoading(true); void refresh() }}>Refresh</button>
        </div>
      </div>
      {error ? <p role="alert" className="mb-4 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</p> : null}
      {loading ? <Card><p className="text-sm text-ink-600">Loading accounts from the server…</p></Card> : clients.length ? (
        <ul className="grid gap-3 lg:grid-cols-2">
          {clients.map((person) => {
            const status = person.verificationStatus
            return (
              <li key={person.id}>
                <Card>
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <h2 className="font-semibold">{person.name}</h2>
                      <p className="break-all text-sm text-ink-600">{person.email}</p>
                      {person.phone ? <p className="mt-1 text-xs text-ink-500">{person.phone}</p> : null}
                    </div>
                    <span className={`w-fit rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${status === 'approved' ? 'bg-emerald-100 text-emerald-800' : status === 'rejected' ? 'bg-rose-100 text-rose-800' : 'bg-amber-100 text-amber-900'}`}>
                      {status}
                    </span>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {status !== 'approved' ? <button type="button" className={btnPrimary} onClick={() => setStatus(person, 'approved')}>Approve account</button> : null}
                    {status !== 'rejected' ? <button type="button" className={btnGhost} onClick={() => setStatus(person, 'rejected')}>Reject account</button> : null}
                  </div>
                </Card>
              </li>
            )
          })}
        </ul>
      ) : error ? null : <Card><p className="text-sm text-ink-600">{filter === 'pending' ? 'No accounts need review.' : 'No registered accounts found.'}</p></Card>}
    </div>
  )
}

export function AdminCategoriesPage() {
  const db = useDb()
  const categoryPayload = (record: Record<string, unknown>) => ({ name: String(record.name || ''), description: String(record.description || ''), published: record.published !== false })
  return (
    <EntityManager
      title="FAQ categories"
      subtitle="Folders for the public knowledge base. Categories containing FAQ articles must be emptied before deletion."
      collection="categories"
      rows={db.categories}
      columns={[
        { key: 'name', label: 'Category' },
        { key: 'description', label: 'Description' },
        { key: 'published', label: 'Published', render: (r) => (r.published ? 'Yes' : 'No') },
      ]}
      fields={[
        { name: 'name', label: 'Name', type: 'text', required: true },
        { name: 'description', label: 'Description', type: 'textarea', span2: true },
        { name: 'published', label: 'Published', type: 'checkbox' },
      ]}
      defaults={{ name: '', description: '', published: true }}
      onCreate={async (record) => ({ ...await createApiFaqCategory(categoryPayload(record)) })}
      onUpdate={async (record) => ({ ...await updateApiFaqCategory(String(record.id), categoryPayload(record)) })}
      onDelete={async (id) => { await deleteApiFaqCategory(id) }}
    />
  )
}

export function AdminTopicsPage() {
  const [topics, setTopics] = useState<ApiHelpTopic[]>([])
  const [departments, setDepartments] = useState<Array<{ id: string; name: string }>>([])
  const [slas, setSlas] = useState<Array<{ id: string; name: string }>>([])
  const [priorities, setPriorities] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    const token = accountSessionToken()
    if (!token) {
      setError('Administrator session expired. Sign in again.')
      setLoading(false)
      return
    }
    void listApiHelpTopics(token)
      .then((result) => {
        if (!active) return
        setTopics(result.topics)
        setDepartments(result.departments)
        setSlas(result.slas)
        setPriorities(result.priorities)
        setError('')
      })
      .catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : 'Could not load help topics from PostgreSQL.') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [])

  return (
    <>
      {loading ? <p className="mb-4 text-sm text-ink-500">Loading help topics from PostgreSQL…</p> : null}
      {error ? <p role="alert" className="mb-4 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</p> : null}
      <EntityManager
        title="Help topics"
        subtitle="Route new tickets to a department."
        collection="topics"
        rows={topics}
        columns={[
          { key: 'name', label: 'Topic' },
          { key: 'deptId', label: 'Department', render: (r) => departments.find((department) => department.id === r.deptId)?.name ?? '—' },
          { key: 'priority', label: 'Priority' },
          { key: 'active', label: 'Status', render: (r) => (r.active ? 'Active' : 'Disabled') },
        ]}
        fields={[
          { name: 'name', label: 'Topic', type: 'text', required: true },
          { name: 'deptId', label: 'Department', type: 'select', options: departments.map((department) => ({ value: department.id, label: department.name })) },
          { name: 'priority', label: 'Priority', type: 'select', options: priorities.map((priority) => ({ value: priority, label: priority })) },
          { name: 'slaId', label: 'SLA', type: 'select', options: [{ value: '', label: 'None' }, ...slas.map((sla) => ({ value: sla.id, label: sla.name }))] },
          { name: 'hint', label: 'Help text', type: 'textarea', span2: true },
          { name: 'active', label: 'Active', type: 'checkbox' },
        ]}
        defaults={{ name: '', deptId: departments[0]?.id, hint: '', priority: priorities.includes('normal') ? 'normal' : priorities[0], active: true }}
        onCreate={async (record) => {
          const token = accountSessionToken()
          if (!token) throw new Error('Administrator session expired. Sign in again.')
          const topic = (await createApiHelpTopic(record as ApiHelpTopic, token)).topic
          setTopics((current) => [...current.filter((item) => item.id !== topic.id), topic])
          return topic
        }}
        onUpdate={async (record) => {
          const token = accountSessionToken()
          if (!token) throw new Error('Administrator session expired. Sign in again.')
          const topic = (await updateApiHelpTopic(record as ApiHelpTopic, token)).topic
          setTopics((current) => current.map((item) => item.id === topic.id ? topic : item))
          return topic
        }}
        onDelete={async (id) => {
          const token = accountSessionToken()
          if (!token) throw new Error('Administrator session expired. Sign in again.')
          await deleteApiHelpTopic(id, token)
          setTopics((current) => current.filter((item) => item.id !== id))
        }}
      />
    </>
  )
}

export function AdminFiltersPage() {
  const db = useDb()
  return (
    <EntityManager
      title="Ticket filters"
      subtitle="Match incoming tickets and apply actions."
      collection="filters"
      rows={db.filters}
      columns={[
        { key: 'name', label: 'Name' },
        { key: 'match', label: 'Match' },
        { key: 'action', label: 'Action' },
        { key: 'active', label: 'Active', render: (r) => (r.active ? 'Yes' : 'No') },
      ]}
      fields={[
        { name: 'name', label: 'Name', type: 'text', required: true },
        { name: 'match', label: 'Match rule', type: 'text', required: true },
        { name: 'action', label: 'Action', type: 'text', required: true, span2: true },
        { name: 'targetDeptId', label: 'Target department', type: 'select', options: [{ value: '', label: '—' }, ...db.departments.map((d) => ({ value: d.id, label: d.name }))] },
        { name: 'stopOnMatch', label: 'Stop on match', type: 'checkbox' },
        { name: 'active', label: 'Active', type: 'checkbox' },
      ]}
      defaults={{ name: '', match: '', action: '', stopOnMatch: false, active: true }}
    />
  )
}

export function AdminSlasPage() {
  const db = useDb()
  return (
    <EntityManager
      title="SLA plans"
      subtitle="Grace period before a ticket is overdue."
      collection="slas"
      rows={db.slas}
      columns={[
        { key: 'name', label: 'Plan' },
        { key: 'graceHours', label: 'Grace (hours)' },
        { key: 'transient', label: 'Transient', render: (r) => (r.transient ? 'Yes' : 'No') },
      ]}
      fields={[
        { name: 'name', label: 'Name', type: 'text', required: true },
        { name: 'graceHours', label: 'Grace hours', type: 'number', required: true },
        { name: 'notes', label: 'Notes', type: 'textarea', span2: true },
        { name: 'transient', label: 'Transient', type: 'checkbox' },
      ]}
      defaults={{ name: '', graceHours: 24, transient: false, notes: '' }}
    />
  )
}

export function AdminSchedulesPage() {
  const db = useDb()
  return (
    <EntityManager
      title="Schedules"
      subtitle="Business hours used with SLA plans."
      collection="schedules"
      rows={db.schedules}
      columns={[
        { key: 'name', label: 'Name' },
        { key: 'timezone', label: 'Timezone' },
        { key: 'hours', label: 'Hours' },
      ]}
      fields={[
        { name: 'name', label: 'Name', type: 'text', required: true },
        { name: 'timezone', label: 'Timezone', type: 'text', required: true },
        { name: 'hours', label: 'Hours', type: 'text', required: true, span2: true },
      ]}
      defaults={{ name: '', timezone: 'UTC', hours: 'Mon–Fri 09:00–17:00' }}
    />
  )
}

export function AdminApiKeysPage() {
  const db = useDb()
  return (
    <EntityManager
      title="API keys"
      subtitle="HTTP API access (demo keys stored in this browser)."
      collection="apiKeys"
      rows={db.apiKeys}
      columns={[
        { key: 'key', label: 'Key' },
        { key: 'ip', label: 'IP' },
        { key: 'notes', label: 'Notes' },
        { key: 'active', label: 'Active', render: (r) => (r.active ? 'Yes' : 'No') },
      ]}
      fields={[
        { name: 'key', label: 'Key', type: 'text', required: true },
        { name: 'ip', label: 'Allowed IP', type: 'text', required: true },
        { name: 'notes', label: 'Notes', type: 'text' },
        { name: 'active', label: 'Active', type: 'checkbox' },
      ]}
      defaults={{ key: `OST-${newId().slice(0, 8)}`, ip: '127.0.0.1', notes: '', active: true }}
    />
  )
}

export function AdminPagesPage() {
  const db = useDb()
  return (
    <EntityManager
      title="Site pages"
      subtitle="Landing, thank-you, offline, and registration copy."
      collection="pages"
      rows={db.pages}
      columns={[
        { key: 'name', label: 'Name' },
        { key: 'type', label: 'Type' },
        { key: 'active', label: 'Active', render: (r) => (r.active ? 'Yes' : 'No') },
      ]}
      fields={[
        { name: 'name', label: 'Name', type: 'text', required: true },
        { name: 'type', label: 'Type', type: 'select', options: ['landing', 'thank-you', 'offline', 'registration'].map((v) => ({ value: v, label: v })) },
        { name: 'body', label: 'Body', type: 'textarea', span2: true },
        { name: 'active', label: 'Active', type: 'checkbox' },
      ]}
      defaults={{ name: '', type: 'landing', body: '', active: true }}
    />
  )
}

export function AdminFormsPage() {
  const db = useDb()
  return (
    <EntityManager
      title="Custom forms"
      subtitle="Dynamic fields on tickets, users, organizations, and tasks."
      collection="forms"
      rows={db.forms}
      columns={[
        { key: 'name', label: 'Name' },
        { key: 'type', label: 'Type' },
        { key: 'fields', label: 'Fields' },
      ]}
      fields={[
        { name: 'name', label: 'Name', type: 'text', required: true },
        { name: 'type', label: 'Type', type: 'select', options: ['ticket', 'user', 'org', 'task'].map((v) => ({ value: v, label: v })) },
        { name: 'fields', label: 'Fields (comma separated)', type: 'textarea', span2: true },
      ]}
      defaults={{ name: '', type: 'ticket', fields: '' }}
    />
  )
}

export function AdminListsPage() {
  const db = useDb()
  return (
    <EntityManager
      title="Custom lists"
      subtitle="Reusable option lists for custom forms."
      collection="lists"
      rows={db.lists}
      columns={[
        { key: 'name', label: 'Name' },
        { key: 'items', label: 'Items' },
      ]}
      fields={[
        { name: 'name', label: 'Name', type: 'text', required: true },
        { name: 'items', label: 'Items', type: 'textarea', span2: true },
      ]}
      defaults={{ name: '', items: '' }}
    />
  )
}

export function AdminPluginsPage() {
  const db = useDb()
  return (
    <EntityManager
      title="Plugins"
      subtitle="Install and enable add-ons (demo flags only)."
      collection="plugins"
      rows={db.plugins}
      columns={[
        { key: 'name', label: 'Plugin' },
        { key: 'version', label: 'Version' },
        { key: 'installed', label: 'Installed', render: (r) => (r.installed ? 'Yes' : 'No') },
        { key: 'enabled', label: 'Enabled', render: (r) => (r.enabled ? 'Yes' : 'No') },
      ]}
      fields={[
        { name: 'name', label: 'Name', type: 'text', required: true },
        { name: 'version', label: 'Version', type: 'text', required: true },
        { name: 'installed', label: 'Installed', type: 'checkbox' },
        { name: 'enabled', label: 'Enabled', type: 'checkbox' },
      ]}
      defaults={{ name: '', version: '0.1', installed: true, enabled: false }}
    />
  )
}

export function AdminEmailsPage() {
  const db = useDb()
  return (
    <EntityManager
      title="Email addresses"
      subtitle="Mailboxes the help desk fetches and sends from."
      collection="emails"
      rows={db.emails}
      columns={[
        { key: 'email', label: 'Email' },
        { key: 'name', label: 'Name' },
        { key: 'protocol', label: 'Protocol' },
        { key: 'host', label: 'Host' },
        { key: 'active', label: 'Active', render: (r) => (r.active ? 'Yes' : 'No') },
      ]}
      fields={[
        { name: 'email', label: 'Email', type: 'email', required: true },
        { name: 'name', label: 'Name', type: 'text', required: true },
        { name: 'protocol', label: 'Protocol', type: 'select', options: ['IMAP', 'POP', 'SMTP'].map((v) => ({ value: v, label: v })) },
        { name: 'host', label: 'Host', type: 'text', required: true },
        { name: 'deptId', label: 'Department', type: 'select', options: [{ value: '', label: '—' }, ...db.departments.map((d) => ({ value: d.id, label: d.name }))] },
        { name: 'active', label: 'Active', type: 'checkbox' },
      ]}
      defaults={{ email: '', name: '', protocol: 'IMAP', host: '', active: true }}
    />
  )
}

export function AdminBanlistPage() {
  const db = useDb()
  return (
    <EntityManager
      title="Banned emails"
      subtitle="Reject tickets from these addresses."
      collection="banlist"
      rows={db.banlist}
      columns={[
        { key: 'email', label: 'Email' },
        { key: 'reason', label: 'Reason' },
      ]}
      fields={[
        { name: 'email', label: 'Email', type: 'email', required: true },
        { name: 'reason', label: 'Reason', type: 'text', span2: true },
      ]}
      defaults={{ email: '', reason: '' }}
    />
  )
}

export function AdminTemplatesPage() {
  const db = useDb()
  return (
    <EntityManager
      title="Email templates"
      subtitle="Notice packs sent for new tickets, replies, and assignments. Available ticket recipient variable: %{ticket.recipients}."
      collection="templates"
      rows={db.templates}
      columns={[
        { key: 'name', label: 'Name' },
        { key: 'language', label: 'Language' },
        { key: 'notes', label: 'Notes' },
      ]}
      fields={[
        { name: 'name', label: 'Name', type: 'text', required: true },
        { name: 'language', label: 'Language', type: 'text', required: true },
        { name: 'notes', label: 'Notes', type: 'textarea', span2: true },
      ]}
      defaults={{ name: '', language: 'en_US', notes: '' }}
    />
  )
}

export function AdminTeamsPage() {
  const db = useDb()
  return (
    <EntityManager
      title="Teams"
      subtitle="Groups of agents for assignment."
      collection="teams"
      rows={db.teams}
      columns={[
        { key: 'name', label: 'Team' },
        { key: 'leadId', label: 'Lead', render: (r) => db.users.find((u) => u.id === r.leadId)?.name ?? '—' },
        { key: 'enabled', label: 'Enabled', render: (r) => (r.enabled ? 'Yes' : 'No') },
      ]}
      fields={[
        { name: 'name', label: 'Name', type: 'text', required: true },
        { name: 'leadId', label: 'Lead', type: 'select', options: [{ value: '', label: '—' }, ...db.users.filter((u) => u.role !== 'client').map((u) => ({ value: u.id, label: u.name }))] },
        { name: 'memberIds', label: 'Member IDs (comma separated)', type: 'text', span2: true },
        { name: 'notes', label: 'Notes', type: 'textarea', span2: true },
        { name: 'enabled', label: 'Enabled', type: 'checkbox' },
      ]}
      defaults={{ name: '', memberIds: [], enabled: true, notes: '' }}
    />
  )
}

export function AdminRolesPage() {
  const db = useDb()
  return (
    <EntityManager
      title="Roles"
      subtitle="Permission packs assigned to agents."
      collection="roles"
      rows={db.roles}
      columns={[
        { key: 'name', label: 'Role' },
        { key: 'permissions', label: 'Permissions', render: (r) => (Array.isArray(r.permissions) ? r.permissions.join(', ') : String(r.permissions ?? '')) },
      ]}
      fields={[
        { name: 'name', label: 'Name', type: 'text', required: true },
        { name: 'permissions', label: 'Permissions (comma separated)', type: 'textarea', span2: true },
      ]}
      defaults={{ name: '', permissions: 'tickets' }}
    />
  )
}

export function AdminDepartmentsPage() {
  const db = useDb()
  const [departments, setDepartments] = useState<Array<{ id: string; name: string; email?: string; managerId?: string; slaId?: string; active: boolean }>>([])
  const [departmentManagers, setDepartmentManagers] = useState<ApiStaffAccount[]>([])
  const [departmentSlas, setDepartmentSlas] = useState<Array<{ id: string; name: string }>>([])
  const [loadingDepartments, setLoadingDepartments] = useState(true)
  const [departmentError, setDepartmentError] = useState('')

  useEffect(() => {
    let active = true
    const token = accountSessionToken()
    if (!token) {
      setDepartmentError('Administrator session expired. Sign in again.')
      setLoadingDepartments(false)
      return
    }
    void Promise.all([listApiDepartments(token), listApiStaff(token)])
      .then(([{ departments: persisted, slas }, { staff }]) => {
        if (!active) return
        setDepartmentManagers(staff)
        setDepartmentSlas(slas)
        setDepartments(persisted.map((department) => {
          const local = db.departments.find((item) => item.id === department.id || item.name.toLowerCase() === department.name.toLowerCase())
          return { ...local, ...department, active: department.active ?? local?.active ?? true }
        }))
        setDepartmentError('')
      })
      .catch((error: unknown) => {
        if (active) setDepartmentError(error instanceof Error ? error.message : 'Could not load departments from PostgreSQL.')
      })
      .finally(() => { if (active) setLoadingDepartments(false) })
    return () => { active = false }
  }, [])

  return (
    <>
      {loadingDepartments ? <p className="mb-4 text-sm text-ink-500">Loading departments from PostgreSQL…</p> : null}
      {departmentError ? <p role="alert" className="mb-4 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-800">{departmentError}</p> : null}
      <EntityManager
      title="Departments"
      subtitle="Routing, email, and managers."
      collection="departments"
      rows={departments}
      columns={[
        { key: 'name', label: 'Department' },
        { key: 'email', label: 'Email' },
        { key: 'managerId', label: 'Manager', render: (r) => departmentManagers.find((staff) => staff.id === r.managerId)?.name ?? '—' },
        { key: 'active', label: 'Active', render: (r) => (r.active ? 'Yes' : 'No') },
      ]}
      fields={[
        { name: 'name', label: 'Name', type: 'text', required: true },
        { name: 'email', label: 'Email', type: 'email' },
        { name: 'managerId', label: 'Manager', type: 'select', options: [{ value: '', label: '—' }, ...departmentManagers.map((staff) => ({ value: staff.id, label: staff.name }))] },
        { name: 'slaId', label: 'SLA', type: 'select', options: [{ value: '', label: '—' }, ...departmentSlas.map((sla) => ({ value: sla.id, label: sla.name }))] },
        { name: 'active', label: 'Active', type: 'checkbox' },
      ]}
      defaults={{ name: '', email: '', active: true }}
      onCreate={async (record) => {
        const token = accountSessionToken()
        if (!token) throw new Error('Administrator session expired. Sign in again.')
        const saved = (await createApiDepartment(record as ApiDepartment, token)).department
        const local = db.departments.find((item) => item.name.toLowerCase() === saved.name.toLowerCase())
        const department = { ...local, ...record, ...saved, active: saved.active ?? Boolean(record.active) }
        setDepartments((current) => [...current.filter((item) => item.id !== department.id), department])
        setDepartmentError('')
        return department
      }}
      onUpdate={async (record) => {
        const token = accountSessionToken()
        if (!token) throw new Error('Administrator session expired. Sign in again.')
        const saved = (await updateApiDepartment(record as ApiDepartment, token)).department
        setDepartments((current) => current.map((item) => item.id === saved.id ? { ...item, ...saved, active: saved.active !== false } : item))
        setDepartmentError('')
        return saved
      }}
      onDelete={async (id) => {
        const token = accountSessionToken()
        if (!token) throw new Error('Administrator session expired. Sign in again.')
        await deleteApiDepartment(id, token)
        setDepartments((current) => current.filter((item) => item.id !== id))
        setDepartmentError('')
      }}
      />
    </>
  )
}

export function AdminStaffPage() {
  const db = useDb()
  const [staff, setStaff] = useState<ApiStaffAccount[]>([])
  const [staffDepartments, setStaffDepartments] = useState<Array<{ id: string; name: string }>>([])
  const [staffRoles, setStaffRoles] = useState<Array<{ id: string; name: string }>>([])
  const [loadError, setLoadError] = useState('')
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<ApiStaffAccount | 'new' | null>(null)

  async function refreshStaff() {
    const token = accountSessionToken()
    if (!token) { setLoadError('Administrator session expired. Sign in again.'); setLoading(false); return }
    try {
      const result = await listApiStaff(token)
      setStaff(result.staff)
      setStaffDepartments(result.departments)
      setStaffRoles(result.roles)
      setLoadError('')
    } catch (error) { setLoadError(error instanceof Error ? error.message : 'Could not load staff accounts from PostgreSQL.') }
    finally { setLoading(false) }
  }

  useEffect(() => { void refreshStaff() }, [])

  async function deactivateStaff(person: ApiStaffAccount) {
    const token = accountSessionToken()
    if (!token) { setLoadError('Administrator session expired. Sign in again.'); return }
    try {
      await saveApiStaff({ staffId: person.id, name: person.name, email: person.email, role: person.role, active: false }, token)
      await refreshStaff()
    } catch (error) { setLoadError(error instanceof Error ? error.message : 'Could not deactivate staff account.') }
  }

  async function onSave(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    const next = {
      id: editing !== 'new' && editing ? editing.id : undefined,
      name: String(form.get('name')),
      email: String(form.get('email')),
      phone: String(form.get('phone')),
      password: String(form.get('password') || ''),
      title: String(form.get('title')),
      role: String(form.get('role')) as User['role'],
      deptName: String(form.get('deptName')),
      roleName: String(form.get('roleName')),
      departmentAccess: form.getAll('departmentAccess').map(String),
      deptId: db.departments.find((department) => department.name === String(form.get('deptName')))?.id,
      roleId: db.roles.find((staffRole) => staffRole.name === String(form.get('roleName')))?.id,
      active: form.get('active') === 'on',
    }
    try {
      const token = accountSessionToken()
      if (!token) throw new Error('Administrator session expired. Sign in again.')
      const saved = await saveApiStaff({ staffId: next.id, name: next.name, email: next.email, phone: next.phone, password: next.password || undefined, role: next.role as 'agent' | 'admin', active: next.active !== false, title: next.title, deptId: next.deptId, roleId: next.roleId, deptName: next.deptName, roleName: next.roleName, departmentAccess: next.departmentAccess }, token)
      upsertUser({ ...next, id: saved.id, password: '' })
      await refreshStaff()
      setEditing(null)
    } catch (error) { window.alert(error instanceof Error ? error.message : 'Could not save staff account.') }
  }

  const current = editing === 'new' ? null : editing

  return (
    <div>
      <PageHeader
        title="Agents"
        subtitle="Staff accounts loaded from PostgreSQL. Changes apply to account access immediately."
        actions={
          <button type="button" className={btnPrimary} onClick={() => setEditing('new')}>
            Add agent
          </button>
        }
      />
      {loadError ? <p role="alert" className="mb-4 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-800">{loadError}</p> : null}
      {loading ? <Card className="mb-4"><p className="text-sm text-ink-600">Loading staff accounts…</p></Card> : null}
      {editing ? (
        <Card className="mb-6">
          <form onSubmit={onSave} className="grid gap-4 sm:grid-cols-2">
            <Field label="Name">
              <input name="name" required defaultValue={current?.name} className={inputClass} />
            </Field>
            <Field label="Email">
              <input name="email" type="email" required defaultValue={current?.email} className={inputClass} />
            </Field>
            <Field label="Phone">
              <input name="phone" defaultValue={current?.phone} className={inputClass} />
            </Field>
            <Field label="Password">
              <input name="password" type="password" required={!current} minLength={8} autoComplete="new-password" placeholder={current ? 'Leave blank to keep current password' : 'At least 8 characters'} className={inputClass} />
            </Field>
            <Field label="Title">
              <input name="title" defaultValue={current?.title} className={inputClass} />
            </Field>
            <Field label="Account type">
              <select name="role" defaultValue={current?.role ?? 'agent'} className={inputClass}>
                <option value="agent">Agent</option>
                <option value="admin">Admin</option>
              </select>
            </Field>
            <Field label="Department">
              <select name="deptName" defaultValue={current?.deptName ?? ''} className={inputClass}>
                <option value="">—</option>
                {staffDepartments.map((d) => (
                  <option key={d.id} value={d.name}>
                    {d.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Department access">
              <select name="departmentAccess" multiple defaultValue={current?.departmentAccess ?? []} className={`${inputClass} min-h-28`}>
                {staffDepartments.map((d) => (
                  <option key={d.id} value={d.name}>{d.name}</option>
                ))}
              </select>
              <span className="mt-1 block text-xs text-ink-400">Use Ctrl or Command to select multiple departments.</span>
            </Field>
            <Field label="Role pack">
              <select name="roleName" defaultValue={current?.roleName ?? ''} className={inputClass}>
                <option value="">—</option>
                {staffRoles.map((r) => (
                  <option key={r.id} value={r.name}>
                    {r.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Active">
              <input name="active" type="checkbox" defaultChecked={current?.active !== false} />
            </Field>
            <div className="flex gap-2 sm:col-span-2">
              <button className={btnPrimary}>Save</button>
              <button type="button" className={btnGhost} onClick={() => setEditing(null)}>
                Cancel
              </button>
            </div>
          </form>
        </Card>
      ) : null}
      <DataTable
        rows={staff as unknown as Record<string, unknown>[]}
        rowKey={(row) => String(row.id)}
        columns={[
          { key: 'name', label: 'Name', render: (r) => String(r.name) },
          { key: 'email', label: 'Email', render: (r) => String(r.email) },
          {
            key: 'dept',
            label: 'Dept',
            render: (r) => String(r.deptName || '—'),
          },
          { key: 'departmentAccess', label: 'Department access', render: (r) => Array.isArray(r.departmentAccess) && r.departmentAccess.length ? r.departmentAccess.join(', ') : '—' },
          { key: 'role', label: 'Type', render: (r) => String(r.role) },
          { key: 'active', label: 'Active', render: (r) => (r.active === false ? 'No' : 'Yes') },
          {
            key: 'actions',
            label: 'Actions',
            render: (r) => (
              <div className="flex flex-wrap gap-3">
                 <button type="button" className="text-brand-600" onClick={() => setEditing(r as unknown as ApiStaffAccount)}>
                  Edit
                </button>
              <button type="button" className="text-rose-600" onClick={() => void deactivateStaff(r as unknown as ApiStaffAccount)}>
                  Deactivate
                </button>
              </div>
            ),
          },
        ]}
        renderCard={(r) => {
          const u = r as unknown as ApiStaffAccount
          return (
            <Card>
              <p className="font-medium">{u.name}</p>
              <p className="break-all text-sm text-ink-600">{u.email}</p>
              <p className="text-sm text-ink-600">{u.deptName || 'No primary department'} · Access: {u.departmentAccess?.join(', ') || '—'}</p>
              <p className="text-xs uppercase text-brand-700">{u.role}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                 <button type="button" className={btnGhost} onClick={() => setEditing(u as unknown as ApiStaffAccount)}>
                  Edit
                </button>
                <button type="button" className={`${btnGhost} text-rose-600`} onClick={() => void deactivateStaff(u as unknown as ApiStaffAccount)}>
                  Deactivate
                </button>
              </div>
            </Card>
          )
        }}
      />
    </div>
  )
}

const settingTabs: { id: keyof Pick<SystemSettings, never> | string; label: string; keys: (keyof SystemSettings)[] }[] = [
  { id: 'company', label: 'Company', keys: ['companyName', 'website', 'phone', 'address'] },
  { id: 'system', label: 'System', keys: ['helpdeskName', 'defaultDeptId', 'timezone', 'language', 'logLevel'] },
  { id: 'tickets', label: 'Tickets', keys: ['defaultPriority', 'maxOpenTickets', 'autolock', 'allowClientReopen', 'hideCollaboratorTickets'] },
  { id: 'tasks', label: 'Tasks', keys: ['tasksEnabled'] },
  { id: 'agents', label: 'Agents', keys: ['agentPwReset', 'twoFactor'] },
  { id: 'users', label: 'Users', keys: ['registrationMode', 'verifyEmail'] },
  { id: 'kb', label: 'Knowledgebase', keys: ['kbEnabled', 'kbPublishedOnly'] },
  { id: 'alerts', label: 'Alerts', keys: ['alertNewTicket', 'alertMessageActivity', 'alertAssignment'] },
  { id: 'autoresp', label: 'Autoresponder', keys: ['autorespNewTicket', 'autorespMessageActivity'] },
]

const labels: Record<string, string> = {
  companyName: 'Company name',
  website: 'Website',
  phone: 'Phone',
  address: 'Address',
  helpdeskName: 'Helpdesk name',
  defaultDeptId: 'Default department',
  timezone: 'Default timezone',
  language: 'Default language',
  logLevel: 'Default log level',
  defaultPriority: 'Default priority',
  maxOpenTickets: 'Max open tickets per user',
  autolock: 'Auto-lock tickets on view',
  tasksEnabled: 'Enable tasks',
  agentPwReset: 'Allow agent password reset',
  twoFactor: 'Require two-factor (demo flag)',
  registrationMode: 'Registration mode',
  verifyEmail: 'Require email verification',
  kbEnabled: 'Enable knowledgebase',
  kbPublishedOnly: 'Clients see published FAQs only',
  allowClientReopen: 'Allow clients to reopen closed tickets',
  hideCollaboratorTickets: 'Hide tickets where the user is only a collaborator',
  alertNewTicket: 'Alert staff on new tickets',
  alertMessageActivity: 'Alert staff on message activity',
  alertAssignment: 'Alert staff on assignment',
  autorespNewTicket: 'Autorespond when a ticket is created',
  autorespMessageActivity: 'Autorespond on message activity',
}

export function AdminSettingsPage() {
  const db = useDb()
  const [params, setParams] = useSearchParams()
  const tab = params.get('t') || 'company'
  const current = settingTabs.find((t) => t.id === tab) ?? settingTabs[0]

  function onSave(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    const patch: Partial<SystemSettings> = {}
    for (const key of current.keys) {
      const value = db.settings[key]
      if (typeof value === 'boolean') (patch as Record<string, unknown>)[key] = form.get(key) === 'on'
      else if (typeof value === 'number') (patch as Record<string, unknown>)[key] = Number(form.get(key))
      else (patch as Record<string, unknown>)[key] = String(form.get(key))
    }
    saveSettings(patch)
    if (typeof patch.hideCollaboratorTickets === 'boolean') void saveApiTicketVisibility(patch.hideCollaboratorTickets).catch((error) => window.alert(error instanceof Error ? error.message : 'Could not save collaborator visibility.'))
  }

  return (
    <div>
      <PageHeader title="Settings" subtitle="Company, system, ticket, agent, user, and knowledgebase options from settings.php." />
      <div className="mb-4 grid gap-2 sm:hidden">
        <select
          className={inputClass}
          value={current.id}
          onChange={(e) => setParams({ t: e.target.value })}
        >
          {settingTabs.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
      </div>
      <div className="mb-4 hidden gap-2 overflow-x-auto pb-1 sm:flex">
        {settingTabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setParams({ t: t.id })}
            className={`shrink-0 rounded-full px-3 py-1.5 text-sm ${current.id === t.id ? 'bg-brand-600 text-white' : 'bg-surface ring-1 ring-line'}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <Card>
        <form key={current.id} onSubmit={onSave} className="grid gap-4 sm:grid-cols-2">
          {current.keys.map((key) => {
            const value = db.settings[key]
            if (typeof value === 'boolean') {
              return (
                <Field key={key} label={labels[key]} className="sm:col-span-2">
                  <input name={key} type="checkbox" defaultChecked={value} key={`${tab}-${key}-${String(value)}`} />
                </Field>
              )
            }
            if (key === 'defaultDeptId') {
              return (
                <Field key={key} label={labels[key]}>
                  <select name={key} defaultValue={String(value)} className={inputClass}>
                    {db.departments.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                </Field>
              )
            }
            if (key === 'logLevel') {
              return (
                <Field key={key} label={labels[key]}>
                  <select name={key} defaultValue={String(value)} className={inputClass}>
                    {(['debug', 'info', 'warning', 'error'] as LogLevel[]).map((l) => (
                      <option key={l} value={l}>
                        {l}
                      </option>
                    ))}
                  </select>
                </Field>
              )
            }
            if (key === 'defaultPriority') {
              return (
                <Field key={key} label={labels[key]}>
                  <select name={key} defaultValue={String(value)} className={inputClass}>
                    {['low', 'normal', 'high', 'emergency'].map((l) => (
                      <option key={l} value={l}>
                        {l}
                      </option>
                    ))}
                  </select>
                </Field>
              )
            }
            if (key === 'registrationMode') {
              return (
                <Field key={key} label={labels[key]}>
                  <select name={key} defaultValue={String(value)} className={inputClass}>
                    <option value="public">Public</option>
                    <option value="closed">Closed (invite)</option>
                    <option value="disabled">Disabled</option>
                  </select>
                </Field>
              )
            }
            return (
              <Field key={key} label={labels[key]} className={key === 'address' ? 'sm:col-span-2' : ''}>
                <input name={key} type={typeof value === 'number' ? 'number' : 'text'} defaultValue={String(value)} className={inputClass} />
              </Field>
            )
          })}
          <div className="sm:col-span-2">
            <button className={btnPrimary}>Save changes</button>
          </div>
        </form>
      </Card>
    </div>
  )
}

export function AdminEmailSettingsPage() {
  const db = useDb()
  function onSave(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    saveSettings({
      defaultFromEmail: String(form.get('defaultFromEmail')),
      stripQuotedReply: form.get('stripQuotedReply') === 'on',
      acceptAllEmails: form.get('acceptAllEmails') === 'on',
    })
  }
  return (
    <div>
      <PageHeader title="Email settings" subtitle="Defaults for outbound mail and inbound fetching." />
      <Card>
        <form onSubmit={onSave} className="grid gap-4">
          <Field label="Default system email">
            <input name="defaultFromEmail" defaultValue={db.settings.defaultFromEmail} className={inputClass} />
          </Field>
          <Field label="Strip quoted replies">
            <input name="stripQuotedReply" type="checkbox" defaultChecked={db.settings.stripQuotedReply} />
          </Field>
          <Field label="Accept email on unknown users">
            <input name="acceptAllEmails" type="checkbox" defaultChecked={db.settings.acceptAllEmails} />
          </Field>
          <button className={btnPrimary}>Save</button>
        </form>
      </Card>
    </div>
  )
}

export function AdminAuditsPage() {
  const db = useDb()
  return (
    <div>
      <PageHeader title="Audit logs" subtitle="Who changed tickets, users, and settings — from osTicket audit.php." />
      <ul className="space-y-3">
        {db.audits.map((audit) => (
          <li key={audit.id}>
            <Card>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium">
                  {audit.actorName} · {audit.action}
                </p>
                <span className="rounded-full bg-paper px-2 py-0.5 text-xs uppercase text-ink-600">{audit.objectType}</span>
              </div>
              <p className="mt-1 text-sm text-ink-600">{audit.details}</p>
              <p className="mt-2 text-xs text-ink-400">{formatDate(audit.createdAt)}</p>
            </Card>
          </li>
        ))}
      </ul>
      {db.audits.length === 0 ? <p className="text-sm text-ink-600">No audit events yet.</p> : null}
    </div>
  )
}

export function AdminLogsPage() {
  const db = useDb()
  const [level, setLevel] = useState<'all' | LogLevel>('all')
  const logs = useMemo(
    () => db.logs.filter((l) => level === 'all' || l.type === level),
    [db.logs, level],
  )
  return (
    <div>
      <PageHeader title="System logs" subtitle="Login, mail, and SLA events stored with the demo data." />
      <div className="mb-4 flex flex-wrap gap-2">
        {(['all', 'debug', 'info', 'warning', 'error'] as const).map((l) => (
          <button
            key={l}
            type="button"
            onClick={() => setLevel(l)}
            className={`rounded-full px-3 py-1.5 text-sm capitalize ${level === l ? 'bg-brand-600 text-white' : 'bg-surface ring-1 ring-line'}`}
          >
            {l}
          </button>
        ))}
      </div>
      <ul className="space-y-3">
        {logs.map((log) => (
          <li key={log.id}>
            <Card>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium">{log.title}</p>
                <span className="rounded-full bg-paper px-2 py-0.5 text-xs uppercase text-ink-600">{log.type}</span>
              </div>
              <p className="mt-1 text-sm text-ink-600">{log.body}</p>
              <p className="mt-2 text-xs text-ink-400">
                {formatDate(log.createdAt)} {log.ip ? `· ${log.ip}` : ''}
              </p>
              <button type="button" className="mt-2 text-sm text-rose-600" onClick={() => removeRecord('logs', log.id)}>
                Delete
              </button>
            </Card>
          </li>
        ))}
      </ul>
      {logs.length === 0 ? <p className="text-sm text-ink-600">No log entries.</p> : null}
    </div>
  )
}

export function AdminInfoPage() {
  const db = useDb()
  return (
    <div>
      <PageHeader title="System information" subtitle="About this React rebuild of osTicket develop." />
      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <h2 className="font-semibold">Application</h2>
          <dl className="mt-3 space-y-2 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-ink-400">Product</dt>
              <dd>osTicket React</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-ink-400">Based on</dt>
              <dd>osTicket-develop</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-ink-400">Runtime</dt>
              <dd>Vite + React 19</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-ink-400">Storage</dt>
              <dd>Browser localStorage</dd>
            </div>
          </dl>
        </Card>
        <Card>
          <h2 className="font-semibold">Counts</h2>
          <dl className="mt-3 space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-ink-400">Tickets</dt>
              <dd>{db.tickets.length}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-ink-400">Users</dt>
              <dd>{db.users.length}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-ink-400">Agents</dt>
              <dd>{db.users.filter((u) => u.role !== 'client').length}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-ink-400">FAQs</dt>
              <dd>{db.faqs.length}</dd>
            </div>
          </dl>
        </Card>
      </div>
    </div>
  )
}

export function AdminDiagnosticPage() {
  const db = useDb()
  const [result, setResult] = useState('')
  const [error, setError] = useState('')
  const [sending, setSending] = useState(false)
  async function onSend(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    const to = String(form.get('to'))
    setSending(true); setError(''); setResult('')
    try {
      const sent = await sendMailTest(to)
      addLog({ type: 'info', title: 'Email diagnostic', body: 'SMTP test delivered to ' + sent.to })
      setResult('SMTP test email sent to ' + sent.to + '.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'SMTP test failed.')
    } finally { setSending(false) }
  }
  return (
    <div>
      <PageHeader title="Email diagnostic" subtitle="Send a real SMTP test message using the API server configuration." />
      <Card>
        <form onSubmit={onSend} className="grid gap-4">
          <Field label="Recipient"><input name="to" type="email" required placeholder="you@example.com" className={inputClass} /></Field>
          <Field label="Configured sender"><input readOnly value={db.settings.defaultFromEmail} className={inputClass} /></Field>
          <button disabled={sending} className={btnPrimary}>{sending ? 'Sending…' : 'Send test email'}</button>
        </form>
        {result ? <p className="mt-4 rounded-xl bg-brand-50 px-3 py-2 text-sm text-brand-700">{result}</p> : null}
        {error ? <p className="mt-4 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</p> : null}
      </Card>
    </div>
  )
}
