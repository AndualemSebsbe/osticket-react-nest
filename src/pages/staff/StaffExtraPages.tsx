import { FormEvent, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { StatusBadge } from '../../components/Badges'
import { CollaboratorModal } from '../../components/CollaboratorModal'
import { btnGhost, btnPrimary, Card, Field, inputClass, PageHeader } from '../../components/ui'
import { useAuth } from '../../context/AuthContext'
import {
  closeApiTask,
  createApiFaqArticle,
  createApiTask,
  deleteApiFaqArticle,
  deleteApiOrganization,
  deleteApiTask,
  downloadApiTaskAttachment,
  getApiTask,
  getApiTaskOptions,
  listApiDirectoryUsers,
  listApiFaqArticles,
  listApiOrganizations,
  listApiTasks,
  postApiTaskMessage,
  reopenApiTask,
  saveApiDirectoryUser,
  saveApiOrganization,
  saveApiTaskCollaborators,
  updateApiAccountPassword,
  updateApiFaqArticle,
  updateApiProfile,
  updateApiTask,
  type ApiDirectoryUser,
  type ApiOrganization,
  type ApiTask,
  type ApiTaskListResult,
  type ApiTaskOptions,
  type ApiTaskQuery,
} from '../../lib/api'
import { useDb } from '../../hooks/useDb'
import { formatDate, relativeTime } from '../../lib/format'
import {
  accountSessionToken,
  hydrateTasksFromApi,
  removeCanned,
  removeFaq,
  removeRecord,
  replaceFaqs,
  updateProfile,
  upsertCanned,
  upsertFaq,
  upsertRecord,
  upsertUser,
} from '../../lib/store'
import type { CannedResponse, Faq } from '../../types'

export function StaffTasksPage() {
  const { user } = useAuth()
  const [options, setOptions] = useState<ApiTaskOptions | null>(null)
  const [result, setResult] = useState<ApiTaskListResult | null>(null)
  const [queue, setQueue] = useState<NonNullable<ApiTaskQuery['queue']>>('open')
  const [q, setQ] = useState('')
  const [departmentId, setDepartmentId] = useState('')
  const [assigneeId, setAssigneeId] = useState('')
  const [sort, setSort] = useState<NonNullable<ApiTaskQuery['sort']>>('updated')
  const [dir, setDir] = useState<'asc' | 'desc'>('desc')
  const [page, setPage] = useState(1)
  const [adding, setAdding] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    getApiTaskOptions()
      .then(setOptions)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Could not load task options.'))
  }, [])

  useEffect(() => {
    let active = true
    setLoading(true)
    listApiTasks({ queue, q, departmentId, assigneeId, sort, dir, page, perPage: 25 })
      .then((data) => {
        if (!active) return
        setResult(data)
        setError('')
      })
      .catch((err: unknown) => {
        if (active) setError(err instanceof Error ? err.message : 'Could not load tasks.')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => { active = false }
  }, [queue, q, departmentId, assigneeId, sort, dir, page, refreshKey])

  async function refresh() {
    setRefreshKey((value) => value + 1)
    const token = accountSessionToken()
    if (token) await hydrateTasksFromApi(token).catch(() => undefined)
  }

  async function onAdd(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const formElement = e.currentTarget
    const form = new FormData(formElement)
    setBusy('create')
    try {
      await createApiTask({
        title: String(form.get('title') || ''),
        description: String(form.get('description') || ''),
        deptId: String(form.get('deptId') || ''),
        assigneeId: String(form.get('assigneeId') || ''),
        teamId: String(form.get('teamId') || ''),
        ticketId: String(form.get('ticketId') || ''),
        dueAt: String(form.get('dueAt') || '') ? new Date(String(form.get('dueAt'))).toISOString() : '',
      }, files)
      formElement.reset()
      setFiles([])
      setAdding(false)
      setPage(1)
      await refresh()
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Could not create the task.')
    } finally {
      setBusy('')
    }
  }

  async function toggleStatus(task: ApiTask) {
    setBusy(task.id)
    try {
      if (task.status === 'open') await closeApiTask(task.id)
      else await reopenApiTask(task.id)
      await refresh()
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Could not update the task.')
    } finally {
      setBusy('')
    }
  }

  async function claim(task: ApiTask) {
    if (!user?.id) return
    setBusy(task.id)
    try {
      await updateApiTask(task.id, { assigneeId: user.id })
      await refresh()
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Could not claim the task.')
    } finally {
      setBusy('')
    }
  }

  const counts = result?.counts
  const rows = result?.tasks || []
  const queues: Array<{ id: NonNullable<ApiTaskQuery['queue']>; label: string; count?: number }> = [
    { id: 'open', label: 'Open', count: counts?.open },
    { id: 'overdue', label: 'Overdue', count: counts?.overdue },
    { id: 'assigned', label: 'Assigned to me', count: counts?.assigned },
    { id: 'closed', label: 'Closed', count: counts?.closed },
    { id: 'all', label: 'All', count: counts?.all },
  ]

  return (
    <div>
      <PageHeader
        title="Tasks"
        subtitle="Internal work items, optionally linked to tickets."
        actions={
          <button type="button" className={btnPrimary} onClick={() => setAdding((value) => !value)}>
            New task
          </button>
        }
      />

      <div className="mb-4 flex flex-wrap gap-2">
        {queues.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => { setQueue(item.id); setPage(1) }}
            className={`rounded-full px-3 py-1.5 text-sm ${queue === item.id ? 'bg-brand-600 text-white' : 'bg-surface ring-1 ring-line'}`}
          >
            {item.label}
            {typeof item.count === 'number' ? <span className="ml-1.5 opacity-75">({item.count})</span> : null}
          </button>
        ))}
      </div>

      {error ? <p role="alert" className="mb-4 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</p> : null}

      {adding ? (
        <Card className="mb-6">
          <form onSubmit={onAdd} className="grid gap-4 sm:grid-cols-2">
            <Field label="Title" className="sm:col-span-2">
              <input name="title" required maxLength={255} className={inputClass} />
            </Field>
            <Field label="Detail" className="sm:col-span-2">
              <textarea name="description" required rows={4} className={inputClass} />
            </Field>
            <Field label="Department">
              <select name="deptId" required className={inputClass}>
                {(options?.departments || []).map((department) => (
                  <option key={department.id} value={department.id}>{department.name}</option>
                ))}
              </select>
            </Field>
            <Field label="Assignee">
              <select name="assigneeId" className={inputClass}>
                <option value="">Unassigned</option>
                {(options?.staff || []).map((person) => (
                  <option key={person.id} value={person.id}>{person.name}</option>
                ))}
              </select>
            </Field>
            <Field label="Team">
              <select name="teamId" className={inputClass}>
                <option value="">No team</option>
                {(options?.teams || []).map((team) => (
                  <option key={team.id} value={team.id}>{team.name}</option>
                ))}
              </select>
            </Field>
            <Field label="Linked ticket">
              <select name="ticketId" className={inputClass}>
                <option value="">None</option>
                {(options?.tickets || []).map((ticket) => (
                  <option key={ticket.id} value={ticket.id}>#{ticket.number} {ticket.subject}</option>
                ))}
              </select>
            </Field>
            <Field label="Due">
              <input name="dueAt" type="datetime-local" className={inputClass} />
            </Field>
            <Field label="Attachments">
              <input
                type="file"
                multiple
                onChange={(e) => setFiles(Array.from(e.target.files || []))}
                className="block w-full text-sm text-ink-600"
              />
            </Field>
            <div className="flex flex-wrap gap-2 sm:col-span-2">
              <button className={btnPrimary} disabled={busy === 'create'}>{busy === 'create' ? 'Creating...' : 'Create task'}</button>
              <button type="button" className={btnGhost} onClick={() => { setAdding(false); setFiles([]) }}>Cancel</button>
            </div>
          </form>
        </Card>
      ) : null}

      <div className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        <input value={q} onChange={(e) => { setQ(e.target.value); setPage(1) }} placeholder="Search tasks" className={inputClass} />
        <select value={departmentId} onChange={(e) => { setDepartmentId(e.target.value); setPage(1) }} className={inputClass}>
          <option value="">All departments</option>
          {(options?.departments || []).map((department) => (
            <option key={department.id} value={department.id}>{department.name}</option>
          ))}
        </select>
        <select value={assigneeId} onChange={(e) => { setAssigneeId(e.target.value); setPage(1) }} className={inputClass}>
          <option value="">Anyone</option>
          <option value="unassigned">Unassigned</option>
          {(options?.staff || []).map((person) => (
            <option key={person.id} value={person.id}>{person.name}</option>
          ))}
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value as NonNullable<ApiTaskQuery['sort']>)} className={inputClass}>
          <option value="updated">Recently updated</option>
          <option value="created">Recently created</option>
          <option value="due">Due date</option>
          <option value="number">Task number</option>
          <option value="title">Title</option>
          <option value="assignee">Assignee</option>
          <option value="department">Department</option>
          <option value="closed">Recently closed</option>
        </select>
        <select value={dir} onChange={(e) => setDir(e.target.value as 'asc' | 'desc')} className={inputClass}>
          <option value="desc">Descending</option>
          <option value="asc">Ascending</option>
        </select>
      </div>

      {loading ? <Card><p className="text-sm text-ink-600">Loading tasks...</p></Card> : null}

      {!loading && rows.length === 0 ? <Card><p className="text-sm text-ink-600">No tasks in this view.</p></Card> : null}

      <div className="hidden overflow-x-auto lg:block">
        <div className="overflow-hidden rounded-2xl border border-line bg-surface">
          <table className="w-full min-w-[56rem] text-left text-sm">
            <thead className="bg-paper text-ink-600">
              <tr>
                <th className="px-4 py-3 font-medium">Task</th>
                <th className="px-4 py-3 font-medium">Department</th>
                <th className="px-4 py-3 font-medium">Assigned</th>
                <th className="px-4 py-3 font-medium">Ticket</th>
                <th className="px-4 py-3 font-medium">Due</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((task) => (
                <tr key={task.id} className="border-t border-line align-top">
                  <td className="px-4 py-3">
                    <Link to={`/scp/tasks/${task.id}`} className="font-medium text-brand-600 hover:underline">
                      #{task.number || task.id} {task.title}
                    </Link>
                    <p className="text-xs text-ink-400">Updated {relativeTime(task.updatedAt || task.createdAt)}</p>
                  </td>
                  <td className="px-4 py-3">{task.departmentName || '-'}</td>
                  <td className="px-4 py-3">{task.assigneeName || task.teamName || <span className="text-ink-400">Unassigned</span>}</td>
                  <td className="px-4 py-3">
                    {task.ticketId ? (
                      <Link to={`/scp/tickets/${task.ticketNumber || task.ticketId}`} className="text-brand-600 hover:underline">
                        #{task.ticketNumber || task.ticketId}
                      </Link>
                    ) : '-'}
                  </td>
                  <td className={`px-4 py-3 ${task.overdue ? 'font-medium text-rose-700' : ''}`}>
                    {task.dueAt ? formatDate(task.dueAt) : '-'}
                    {task.overdue ? <span className="ml-1 text-xs uppercase">Overdue</span> : null}
                  </td>
                  <td className="px-4 py-3"><StatusBadge status={task.status === 'open' ? 'open' : 'closed'} /></td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-2">
                      {task.status === 'open' && !task.assigneeId && !task.teamId ? (
                        <button type="button" className={btnGhost} disabled={busy === task.id} onClick={() => void claim(task)}>Claim</button>
                      ) : null}
                      <button type="button" className={btnGhost} disabled={busy === task.id} onClick={() => void toggleStatus(task)}>
                        {task.status === 'open' ? 'Close' : 'Reopen'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <ul className="grid gap-3 lg:hidden">
        {rows.map((task) => (
          <li key={task.id}>
            <Card>
              <div className="flex flex-col gap-3">
                <div>
                  <Link to={`/scp/tasks/${task.id}`} className="font-medium text-brand-600">
                    #{task.number || task.id} {task.title}
                  </Link>
                  <p className="mt-1 text-sm text-ink-600">
                    {task.departmentName || 'No department'}
                    {' / '}
                    {task.assigneeName || task.teamName || 'Unassigned'}
                  </p>
                  <p className="text-sm text-ink-600">
                    {task.dueAt ? `Due ${formatDate(task.dueAt)}` : 'No due date'}
                    {task.ticketId ? ` / Ticket #${task.ticketNumber || task.ticketId}` : ''}
                  </p>
                  {task.overdue ? <p className="text-xs font-semibold uppercase text-rose-700">Overdue</p> : null}
                </div>
                <div className="flex flex-wrap gap-2">
                  <StatusBadge status={task.status === 'open' ? 'open' : 'closed'} />
                  {task.status === 'open' && !task.assigneeId && !task.teamId ? (
                    <button type="button" className={btnGhost} disabled={busy === task.id} onClick={() => void claim(task)}>Claim</button>
                  ) : null}
                  <button type="button" className={btnGhost} disabled={busy === task.id} onClick={() => void toggleStatus(task)}>
                    {task.status === 'open' ? 'Close' : 'Reopen'}
                  </button>
                </div>
              </div>
            </Card>
          </li>
        ))}
      </ul>

      {result && result.pages > 1 ? (
        <div className="mt-4 flex items-center justify-between gap-3">
          <button type="button" className={btnGhost} disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>Previous</button>
          <p className="text-sm text-ink-600">Page {result.page} of {result.pages} ({result.total} tasks)</p>
          <button type="button" className={btnGhost} disabled={page >= result.pages} onClick={() => setPage((value) => value + 1)}>Next</button>
        </div>
      ) : null}
    </div>
  )
}

export function StaffUsersPage() {
  const db = useDb()
  const [clients, setClients] = useState<any[]>([])
  const [organizations, setOrganizations] = useState<ApiOrganization[]>([])
  const [q, setQ] = useState('')
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [sort, setSort] = useState<'name' | 'email' | 'status' | 'create' | 'update'>('name')
  const [order, setOrder] = useState<'asc' | 'desc'>('asc')

  async function refreshUsers() {
    const token = accountSessionToken()
    if (!token) { setError('Staff session expired. Sign in again.'); setLoading(false); return }
    try {
      const [result, orgResult] = await Promise.all([listApiDirectoryUsers(token), listApiOrganizations(token)])
      setClients(result.users)
      setOrganizations(orgResult.organizations)
      orgResult.organizations.forEach((org) => upsertRecord('organizations', { id: org.id, name: org.name, address: org.address, domain: org.domain || '', phone: org.phone || '', website: org.website, notes: org.notes || '' }))
      result.users.forEach((u: any) => upsertUser({ ...u, password: '', active: true, role: 'client' }))
      setError('')
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not load users from PostgreSQL.') }
    finally { setLoading(false) }
  }
  useEffect(() => { void refreshUsers() }, [])

  const filtered = useMemo(() => {
    let list = clients.filter((u: any) => {
      if (!q) return true
      const hay = `${u.name || ''} ${u.email || u.default_email || u.default_email__address || ''} ${u.org || u.organization || ''} ${u.phone || ''}`.toLowerCase()
      return hay.includes(q.toLowerCase())
    })
    list = [...list].sort((a: any, b: any) => {
      let av = '', bv = ''
      if (sort === 'name') { av = (a.name || '').toLowerCase(); bv = (b.name || '').toLowerCase() }
      else if (sort === 'email') { av = (a.email || a.default_email || '').toLowerCase(); bv = (b.email || b.default_email || '').toLowerCase() }
      else if (sort === 'status') { av = (a.status || a.user_status || '').toLowerCase(); bv = (b.status || b.user_status || '').toLowerCase() }
      else if (sort === 'create') { av = a.created || a.created_at || ''; bv = b.created || b.created_at || '' }
      else if (sort === 'update') { av = a.updated || a.updated_at || ''; bv = b.updated || b.updated_at || '' }
      if (av < bv) return order === 'asc' ? -1 : 1
      if (av > bv) return order === 'asc' ? 1 : -1
      return 0
    })
    return list
  }, [clients, q, sort, order])

  async function onAdd(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    const token = accountSessionToken()
    if (!token) { setError('Staff session expired. Sign in again.'); return }
    try {
      const result = await saveApiDirectoryUser({ name: String(form.get('name')), email: String(form.get('email')), phone: String(form.get('phone')), orgId: String(form.get('orgId')), org: String(form.get('org')) }, token)
      upsertUser({ ...(result.user as any), password: '', active: true, role: 'client' })
      if ((result.user as any).orgId && (result.user as any).org) upsertRecord('organizations', { id: (result.user as any).orgId, name: (result.user as any).org, domain: '', phone: '', notes: '' })
      await refreshUsers()
      setError('')
      setAdding(false)
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not save user to PostgreSQL.') }
  }

  async function massAction(action: string) {
    if (selected.size === 0) { window.alert('You need to select at least one item'); return }
    if (!confirm('You sure?')) return
    const token = accountSessionToken()
    if (!token) { setError('Staff session expired. Sign in again.'); return }
    try {
      await massActionApiDirectoryUsers(action, Array.from(selected), token)
      setSelected(new Set())
      await refreshUsers()
      setError('')
    } catch (err) { setError(err instanceof Error ? err.message : 'Mass action failed.') }
  }

  function toggleSort(field: typeof sort) {
    if (sort === field) setOrder(o => o === 'asc' ? 'desc' : 'asc')
    else { setSort(field); setOrder('asc') }
  }

  const sortIcon = (field: typeof sort) => sort === field ? (order === 'asc' ? ' ↑' : ' ↓') : ''

  return (
    <div>
      <PageHeader
        title="User Directory"
        subtitle="End users stored in PostgreSQL and linked to organizations."
        actions={
          <div className="flex flex-wrap gap-2">
            <button type="button" className={btnPrimary} onClick={() => setAdding((v) => !v)}>
              Add User
            </button>
            <button type="button" className={btnGhost} onClick={() => { void refreshUsers() }}>Refresh</button>
          </div>
        }
      />
      {error ? <p role="alert" className="mb-4 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</p> : null}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search users" className={`${inputClass} max-w-md`} />
      </div>
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
              <select name="orgId" className={inputClass}>
                <option value="">None</option>
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
            <div className="flex gap-2 sm:col-span-2">
              <button className={btnPrimary}>Save user</button>
              <button type="button" className={btnGhost} onClick={() => setAdding(false)}>Cancel</button>
            </div>
          </form>
        </Card>
      ) : null}
      {selected.size > 0 ? (
        <Card className="mb-4">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm">{selected.size} selected</span>
            <button type="button" className={btnGhost} onClick={() => void massAction('add-to-org')}>Add to Organization</button>
            <button type="button" className={btnGhost} onClick={() => void massAction('reset')}>Send Password Reset Email</button>
            <button type="button" className={btnGhost} onClick={() => void massAction('register')}>Register</button>
            <button type="button" className={btnGhost} onClick={() => void massAction('lock')}>Lock</button>
            <button type="button" className={btnGhost} onClick={() => void massAction('unlock')}>Unlock</button>
            <button type="button" className={btnGhost} onClick={() => void massAction('delete')}>Delete</button>
          </div>
        </Card>
      ) : null}
      {loading ? <Card className="mb-4"><p className="text-sm text-ink-600">Loading users…</p></Card> : null}
      <div className="-mx-3 overflow-x-auto px-3 lg:mx-0 lg:block lg:px-0">
        <div className="overflow-hidden rounded-2xl border border-line bg-surface">
        <table className="w-full min-w-[60rem] text-left text-sm">
          <thead className="bg-paper text-ink-600">
            <tr>
              <th className="px-4 py-3 font-medium">&nbsp;</th>
              <th className="px-4 py-3 font-medium cursor-pointer" onClick={() => toggleSort('name')}>Name{sortIcon('name')}</th>
              <th className="px-4 py-3 font-medium cursor-pointer" onClick={() => toggleSort('email')}>Email{sortIcon('email')}</th>
              <th className="px-4 py-3 font-medium">Organization</th>
              <th className="px-4 py-3 font-medium cursor-pointer" onClick={() => toggleSort('status')}>Status{sortIcon('status')}</th>
              <th className="px-4 py-3 font-medium cursor-pointer" onClick={() => toggleSort('create')}>Created{sortIcon('create')}</th>
              <th className="px-4 py-3 font-medium cursor-pointer" onClick={() => toggleSort('update')}>Updated{sortIcon('update')}</th>
              <th className="px-4 py-3 font-medium">Tickets</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((u: any) => {
              const email = u.email || u.default_email || u.default_email__address || ''
              const org = u.org || u.organization || (db.organizations.find((o: any) => o.id === u.orgId)?.name) || '—'
              const status = u.status || u.user_status || (u.account__id ? 'Registered' : 'Guest')
              const ticketCount = u.ticket_count ?? u.ticketCount ?? db.tickets.filter((t: any) => t.userId === u.id || t.user_id === u.id).length
              const created = u.created || u.created_at
              const updated = u.updated || u.updated_at
              const isSel = selected.has(u.id)
              return (
                <tr key={u.id} className="border-t border-line hover:bg-paper/50">
                  <td className="px-4 py-3">
                    <input type="checkbox" checked={isSel} onChange={() => {
                      setSelected(s => { const n = new Set(s); if (n.has(u.id)) n.delete(u.id); else n.add(u.id); return n })
                    }} />
                  </td>
                  <td className="px-4 py-3">
                    <Link to={`/scp/users/${u.id}`} className="text-brand-600 font-medium">
                      {u.name || email}
                    </Link>
                  </td>
                  <td className="px-4 py-3">{email}</td>
                  <td className="px-4 py-3">{org}</td>
                  <td className="px-4 py-3">{status}</td>
                  <td className="px-4 py-3">{created ? formatDate(created) : '—'}</td>
                  <td className="px-4 py-3">{updated ? formatDate(updated) : '—'}</td>
                  <td className="px-4 py-3">{ticketCount}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        </div>
      </div>
      {filtered.length === 0 && !loading ? <p className="mt-4 text-sm text-ink-600">No users found.</p> : null}
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
  const [organizations, setOrganizations] = useState<ApiOrganization[]>([])
  const [organizationError, setOrganizationError] = useState('')
  const [saved, setSaved] = useState(false)
  const [tab, setTab] = useState<'tickets' | 'notes'>('tickets')
  const [details, setDetails] = useState<any>(null)
  const [loadingDetails, setLoadingDetails] = useState(false)
  useEffect(() => {
    let active = true
    async function loadOrganizations() {
      const token = accountSessionToken()
      if (!token) { setOrganizationError('Staff session expired. Sign in again.'); return }
      try {
        const result = await listApiOrganizations(token)
        if (!active) return
        setOrganizations(result.organizations)
        result.organizations.forEach((organization) => upsertRecord('organizations', {
          id: organization.id,
          name: organization.name,
          address: organization.address,
          domain: organization.domain || '',
          phone: organization.phone || '',
          website: organization.website,
          notes: organization.notes || '',
        }))
        setOrganizationError('')
      } catch (err) {
        if (active) setOrganizationError(err instanceof Error ? err.message : 'Could not load organizations.')
      }
    }
    void loadOrganizations()
    return () => { active = false }
  }, [])
  useEffect(() => {
    let active = true
    async function loadDetails() {
      if (!id) return
      const token = accountSessionToken()
      if (!token) return
      setLoadingDetails(true)
      try {
        const res = await getApiDirectoryUser(id, token)
        if (active) setDetails(res)
      } catch (e) {
        // ignore
      } finally {
        if (active) setLoadingDetails(false)
      }
    }
    void loadDetails()
    return () => { active = false }
  }, [id])
  const person = db.users.find((u) => u.id === id) || details?.user
  if (!person && !loadingDetails) {
    return (
      <div>
        <PageHeader title="User not found" />
        <Link to="/scp/users" className="text-sm text-brand-600">
          Back to users
        </Link>
      </div>
    )
  }
  const tickets = details?.tickets?.length ? details.tickets : db.tickets.filter((t) => t.userId === person?.id)
  const notes = details?.notes || []
  const org = organizations.find((o) => o.id === person?.orgId) ?? db.organizations.find((o) => o.id === person?.orgId)

  async function onSave(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    const token = accountSessionToken()
    if (!token) return
    try {
      const result = await saveApiDirectoryUser({ id, name: String(form.get('name')), email: String(form.get('email')), phone: String(form.get('phone')), org: String(form.get('org')), orgId: String(form.get('orgId')) }, token)
      upsertUser({ ...(result.user as any), password: '', active: true, role: 'client' })
      setSaved(true)
    } catch (err) { window.alert(err instanceof Error ? err.message : 'Could not save user.') }
  }

  return (
    <div className="space-y-6">
      <Link to="/scp/users" className="text-sm text-brand-600">
        ← User Directory
      </Link>
      <PageHeader title={person?.name || 'User'} subtitle={person?.email || ''} />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <Card>
          <div className="mb-4 flex gap-4 border-b border-line">
            <button className={`pb-2 text-sm ${tab === 'tickets' ? 'border-b-2 border-brand-600 text-brand-700' : 'text-ink-600'}`} onClick={() => setTab('tickets')}>Tickets</button>
            <button className={`pb-2 text-sm ${tab === 'notes' ? 'border-b-2 border-brand-600 text-brand-700' : 'text-ink-600'}`} onClick={() => setTab('notes')}>Notes</button>
          </div>
          {tab === 'tickets' ? (
            <ul className="space-y-2 text-sm">
              {tickets.map((t: any) => (
                <li key={t.id}>
                  <Link to={`/scp/tickets/${t.id}`} className="text-brand-600">
                    #{t.number || t.id} {t.subject || ''}
                  </Link>
                  <span className="ml-2 text-ink-400">{t.status}</span>
                </li>
              ))}
              {tickets.length === 0 ? <li className="text-ink-400">No tickets.</li> : null}
            </ul>
          ) : (
            <ul className="space-y-2 text-sm">
              {notes.map((n: any) => (
                <li key={n.id} className="rounded-lg border border-line p-3">
                  <div className="text-ink-700 whitespace-pre-wrap">{n.body}</div>
                  <div className="mt-1 text-xs text-ink-400">{n.created ? formatDate(n.created) : ''}</div>
                </li>
              ))}
              {notes.length === 0 ? <li className="text-ink-400">No notes.</li> : null}
            </ul>
          )}
        </Card>
        <Card>
          <h2 className="font-semibold">User Information</h2>
          <form onSubmit={onSave} className="mt-3 grid gap-3 text-sm">
            <Field label="Name">
              <input name="name" defaultValue={person?.name || ''} required className={inputClass} />
            </Field>
            <Field label="Email">
              <input name="email" type="email" defaultValue={person?.email || ''} className={inputClass} />
            </Field>
            <Field label="Phone">
              <input name="phone" defaultValue={person?.phone || ''} className={inputClass} />
            </Field>
            <Field label="Organization">
              <select name="orgId" defaultValue={person?.orgId ?? ''} className={inputClass}>
                <option value="">None</option>
                {organizations.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            </Field>
            {organizationError ? <p role="alert" className="text-rose-700">{organizationError}</p> : null}
            <Field label="Org label">
              <input name="org" defaultValue={person?.org || org?.name || ''} className={inputClass} />
            </Field>
            <div className="text-xs text-ink-500">
              <div>Created: {person?.created ? formatDate(person.created) : '—'}</div>
              <div>Updated: {person?.updated ? formatDate(person.updated) : '—'}</div>
              <div>Status: {details?.user?.status || person?.status || (person?.account__id ? 'Registered' : 'Guest')}</div>
            </div>
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
  const navigate = useNavigate()
  const { user } = useAuth()
  const [task, setTask] = useState<ApiTask | null>(null)
  const [options, setOptions] = useState<ApiTaskOptions | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [toast, setToast] = useState('')
  const [busy, setBusy] = useState('')
  const [tab, setTab] = useState<'reply' | 'note'>('reply')
  const [files, setFiles] = useState<File[]>([])
  const [showCollaborators, setShowCollaborators] = useState(false)

  useEffect(() => {
    let active = true
    setLoading(true)
    if (!id) {
      setError('Task not found.')
      setLoading(false)
      return
    }
    Promise.all([getApiTask(id), getApiTaskOptions()])
      .then(([detail, taskOptions]) => {
        if (!active) return
        setTask(detail.task)
        setOptions(taskOptions)
        setError('')
      })
      .catch((err: unknown) => {
        if (active) setError(err instanceof Error ? err.message : 'Could not load the task.')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => { active = false }
  }, [id])

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(''), 4000)
    return () => window.clearTimeout(timer)
  }, [toast])

  async function reload() {
    if (!id) return
    const detail = await getApiTask(id)
    setTask(detail.task)
    const token = accountSessionToken()
    if (token) await hydrateTasksFromApi(token).catch(() => undefined)
  }

  async function run(action: () => Promise<unknown>, fallback: string) {
    setBusy('action')
    try {
      await action()
      await reload()
      setToast('Task updated.')
    } catch (err) {
      window.alert(err instanceof Error ? err.message : fallback)
    } finally {
      setBusy('')
    }
  }

  async function onSave(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!task) return
    const form = new FormData(e.currentTarget)
    const patch: Record<string, unknown> = {}
    const title = String(form.get('title') || '').trim()
    const description = String(form.get('description') || '').trim()
    const deptId = String(form.get('deptId') || '')
    const assigneeId = String(form.get('assigneeId') || '')
    const teamId = String(form.get('teamId') || '')
    const ticketId = String(form.get('ticketId') || '')
    const dueValue = String(form.get('dueAt') || '')
    const dueAt = dueValue ? new Date(dueValue).toISOString() : ''
    if (title !== task.title) patch.title = title
    if (description !== task.description) patch.description = description
    if (deptId !== task.deptId) patch.deptId = deptId
    if (assigneeId !== (task.assigneeId || '')) patch.assigneeId = assigneeId
    if (teamId !== (task.teamId || '')) patch.teamId = teamId
    if (ticketId !== (task.ticketId || '')) patch.ticketId = ticketId
    if (dueAt !== (task.dueAt || '')) patch.dueAt = dueAt
    if (Object.keys(patch).length === 0) {
      setToast('No changes to save.')
      return
    }
    setBusy('save')
    try {
      const result = await updateApiTask(task.id, patch)
      setTask(result.task)
      setToast('Task saved.')
      const token = accountSessionToken()
      if (token) await hydrateTasksFromApi(token).catch(() => undefined)
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Could not save the task.')
    } finally {
      setBusy('')
    }
  }

  async function onPost(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!task) return
    const formElement = e.currentTarget
    const form = new FormData(formElement)
    const message = String(form.get('message') || '').trim()
    if (!message) return
    const status = String(form.get('status') || '') as '' | 'open' | 'closed'
    setBusy('post')
    try {
      const result = await postApiTaskMessage(task.id, {
        message,
        internal: tab === 'note',
        ...(status ? { status } : {}),
      }, files)
      setTask(result.task)
      formElement.reset()
      setFiles([])
      setToast(tab === 'note' ? 'Note added.' : 'Reply posted.')
      const token = accountSessionToken()
      if (token) await hydrateTasksFromApi(token).catch(() => undefined)
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Could not post the message.')
    } finally {
      setBusy('')
    }
  }

  async function onDelete() {
    if (!task) return
    if (!window.confirm(`Delete task #${task.number || task.id}? This cannot be undone.`)) return
    setBusy('delete')
    try {
      await deleteApiTask(task.id)
      const token = accountSessionToken()
      if (token) await hydrateTasksFromApi(token).catch(() => undefined)
      navigate('/scp/tasks')
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Could not delete the task.')
      setBusy('')
    }
  }

  if (loading) {
    return (
      <div>
        <PageHeader title="Loading task..." />
        <Card><p className="text-sm text-ink-600">Fetching the task from the API.</p></Card>
      </div>
    )
  }

  if (!task || error) {
    return (
      <div>
        <PageHeader title="Task not found" subtitle={error || undefined} />
        <Link to="/scp/tasks" className="text-sm text-brand-600">Back to tasks</Link>
      </div>
    )
  }

  const permissions = task.permissions
  const canEditAny = permissions.canEdit || permissions.canAssign || permissions.canTransfer
  const collaboratorEntries = task.collaborators.map((person) => ({ userId: person.userId, name: person.name, email: person.email, active: person.active }))

  return (
    <div className="space-y-6">
      <Link to="/scp/tasks" className="text-sm text-brand-600">Back to tasks</Link>

      <PageHeader
        title={`#${task.number || task.id} ${task.title}`}
        subtitle={`${task.departmentName || 'No department'}${task.assigneeName ? ' / ' + task.assigneeName : task.teamName ? ' / ' + task.teamName : ' / Unassigned'}`}
        actions={
          <div className="flex flex-wrap gap-2">
            {task.status === 'open' && permissions.canAssign && !task.assigneeId && !task.teamId && user?.id ? (
              <button type="button" className={btnGhost} disabled={busy === 'action'} onClick={() => void run(() => updateApiTask(task.id, { assigneeId: user.id }), 'Could not claim the task.')}>Claim</button>
            ) : null}
            {permissions.canClose ? (
              <button
                type="button"
                className={btnGhost}
                disabled={busy === 'action'}
                onClick={() => void run(() => task.status === 'open' ? closeApiTask(task.id) : reopenApiTask(task.id), 'Could not change the task status.')}
              >
                {task.status === 'open' ? 'Close task' : 'Reopen task'}
              </button>
            ) : null}
            {permissions.canDelete ? (
              <button type="button" className={btnGhost + ' text-rose-700'} disabled={busy === 'delete'} onClick={() => void onDelete()}>Delete</button>
            ) : null}
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={task.status === 'open' ? 'open' : 'closed'} />
        {task.overdue ? <span className="rounded-full bg-rose-100 px-2.5 py-0.5 text-xs font-semibold uppercase text-rose-800">Overdue</span> : null}
        {task.ticketId ? (
          <Link to={`/scp/tickets/${task.ticketNumber || task.ticketId}`} className="text-sm text-brand-600">
            Linked ticket #{task.ticketNumber || task.ticketId}
          </Link>
        ) : null}
        <span className="text-sm text-ink-500">Created {formatDate(task.createdAt)}</span>
        {task.dueAt ? <span className={`text-sm ${task.overdue ? 'font-medium text-rose-700' : 'text-ink-500'}`}>Due {formatDate(task.dueAt)}</span> : null}
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-6">
          <Card>
            <h2 className="mb-4 text-base font-semibold text-ink-800">Task details</h2>
            <form onSubmit={onSave} className="grid gap-4 sm:grid-cols-2">
              <Field label="Title" className="sm:col-span-2">
                <input name="title" defaultValue={task.title} required maxLength={255} disabled={!permissions.canEdit} className={inputClass} />
              </Field>
              <Field label="Detail" className="sm:col-span-2">
                <textarea name="description" defaultValue={task.description} required rows={6} disabled={!permissions.canEdit} className={inputClass} />
              </Field>
              <Field label="Department">
                <select name="deptId" defaultValue={task.deptId} disabled={!permissions.canTransfer} className={inputClass}>
                  {(options?.departments || []).some((department) => department.id === task.deptId) ? null : (
                    <option value={task.deptId}>{task.departmentName || task.deptId}</option>
                  )}
                  {(options?.departments || []).map((department) => (
                    <option key={department.id} value={department.id}>{department.name}</option>
                  ))}
                </select>
              </Field>
              <Field label="Assignee">
                <select name="assigneeId" defaultValue={task.assigneeId} disabled={!permissions.canAssign} className={inputClass}>
                  <option value="">Unassigned</option>
                  {(options?.staff || []).some((person) => person.id === task.assigneeId) || !task.assigneeId ? null : (
                    <option value={task.assigneeId}>{task.assigneeName || task.assigneeId}</option>
                  )}
                  {(options?.staff || []).map((person) => (
                    <option key={person.id} value={person.id}>{person.name}</option>
                  ))}
                </select>
              </Field>
              <Field label="Team">
                <select name="teamId" defaultValue={task.teamId} disabled={!permissions.canAssign} className={inputClass}>
                  <option value="">No team</option>
                  {(options?.teams || []).some((team) => team.id === task.teamId) || !task.teamId ? null : (
                    <option value={task.teamId}>{task.teamName || task.teamId}</option>
                  )}
                  {(options?.teams || []).map((team) => (
                    <option key={team.id} value={team.id}>{team.name}</option>
                  ))}
                </select>
              </Field>
              <Field label="Linked ticket">
                <select name="ticketId" defaultValue={task.ticketId} disabled={!permissions.canEdit} className={inputClass}>
                  <option value="">None</option>
                  {(options?.tickets || []).some((ticket) => ticket.id === task.ticketId) || !task.ticketId ? null : (
                    <option value={task.ticketId}>#{task.ticketNumber || task.ticketId}</option>
                  )}
                  {(options?.tickets || []).map((ticket) => (
                    <option key={ticket.id} value={ticket.id}>#{ticket.number} {ticket.subject}</option>
                  ))}
                </select>
              </Field>
              <Field label="Due">
                <input name="dueAt" type="datetime-local" defaultValue={task.dueAt ? task.dueAt.slice(0, 16) : ''} disabled={!permissions.canEdit} className={inputClass} />
              </Field>
              {canEditAny ? (
                <div className="flex flex-wrap gap-2 sm:col-span-2">
                  <button className={btnPrimary} disabled={busy === 'save'}>{busy === 'save' ? 'Saving...' : 'Save task'}</button>
                </div>
              ) : null}
            </form>
          </Card>

          <Card>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-base font-semibold text-ink-800">Thread</h2>
              <span className="text-xs text-ink-500">{task.messages.length} entries</span>
            </div>
            {task.messages.length === 0 ? <p className="text-sm text-ink-600">No messages yet.</p> : null}
            <ol className="space-y-4">
              {task.messages.map((message) => (
                <li key={message.id} className={`rounded-2xl border p-4 ${message.internal ? 'border-amber-200 bg-amber-50' : message.kind === 'reply' ? 'border-brand-100 bg-brand-50' : 'border-line bg-paper'}`}>
                  <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                    <div>
                      <p className="font-semibold text-ink-800">{message.author || 'System'}</p>
                      <p className="text-xs uppercase tracking-wide text-ink-500">
                        {message.internal ? 'Internal note' : message.kind === 'reply' ? 'Agent reply' : 'Task detail'}
                      </p>
                    </div>
                    <p className="text-xs text-ink-500">{formatDate(message.createdAt)}</p>
                  </div>
                  <p className="whitespace-pre-wrap text-sm text-ink-800">{message.body}</p>
                  {message.attachments.length ? (
                    <ul className="mt-3 flex flex-wrap gap-2">
                      {message.attachments.map((attachment) => (
                        <li key={attachment.id}>
                          <button
                            type="button"
                            className={btnGhost + ' text-xs'}
                            onClick={() => { void downloadApiTaskAttachment(task.id, attachment.id, attachment.name).catch((err: unknown) => window.alert(err instanceof Error ? err.message : 'Could not download the attachment.')) }}
                          >
                            {attachment.name} ({Math.max(1, Math.round(attachment.size / 1024))} KB)
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              ))}
            </ol>
          </Card>

          {permissions.canReply ? (
            <Card>
              <div className="mb-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setTab('reply')}
                  className={`rounded-full px-3 py-1.5 text-sm ${tab === 'reply' ? 'bg-brand-600 text-white' : 'bg-surface ring-1 ring-line'}`}
                >
                  Reply
                </button>
                <button
                  type="button"
                  onClick={() => setTab('note')}
                  className={`rounded-full px-3 py-1.5 text-sm ${tab === 'note' ? 'bg-amber-600 text-white' : 'bg-surface ring-1 ring-line'}`}
                >
                  Internal note
                </button>
              </div>
              <form onSubmit={onPost} className="space-y-4">
                <Field label={tab === 'note' ? 'Internal note' : 'Reply'}>
                  <textarea name="message" required rows={4} placeholder={tab === 'note' ? 'Visible to agents only' : 'Posted to the task thread'} className={inputClass} />
                </Field>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Attachments">
                    <input type="file" multiple onChange={(e) => setFiles(Array.from(e.target.files || []))} className="block w-full text-sm text-ink-600" />
                  </Field>
                  {permissions.canClose ? (
                    <Field label="Status">
                      <select name="status" defaultValue="" className={inputClass}>
                        <option value="">Leave status unchanged</option>
                        <option value="closed">Close task</option>
                        <option value="open">Reopen task</option>
                      </select>
                    </Field>
                  ) : null}
                </div>
                <button className={btnPrimary} disabled={busy === 'post'}>{busy === 'post' ? 'Posting...' : tab === 'note' ? 'Add note' : 'Post reply'}</button>
              </form>
            </Card>
          ) : null}
        </div>

        <aside className="space-y-6">
          <Card>
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="text-base font-semibold text-ink-800">Collaborators</h2>
              {permissions.canEdit ? (
                <button type="button" className={btnGhost} onClick={() => setShowCollaborators(true)}>Edit</button>
              ) : null}
            </div>
            {task.collaborators.length === 0 ? <p className="text-sm text-ink-600">No collaborators.</p> : null}
            <ul className="space-y-2">
              {task.collaborators.map((person) => (
                <li key={person.userId} className="text-sm">
                  <p className="font-medium text-ink-800">{person.name || person.email}</p>
                  <p className="text-ink-500">{person.email}{person.active ? '' : ' (inactive)'}</p>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-ink-500">Third-party collaborators receive activity notices but cannot see tasks in the client portal.</p>
          </Card>

          <Card>
            <h2 className="mb-3 text-base font-semibold text-ink-800">Activity</h2>
            {task.events.length === 0 ? <p className="text-sm text-ink-600">No recorded events.</p> : null}
            <ol className="space-y-3">
              {task.events.map((event) => (
                <li key={event.id} className="border-l-2 border-line pl-3 text-sm">
                  <p className="font-medium capitalize text-ink-800">{event.event || 'Updated'}</p>
                  <p className="text-ink-500">{event.actor || 'System'} / {formatDate(event.at)}</p>
                </li>
              ))}
            </ol>
          </Card>
        </aside>
      </div>

      <CollaboratorModal
        open={showCollaborators}
        value={collaboratorEntries}
        onClose={() => setShowCollaborators(false)}
        onSave={async (entries) => {
          const result = await saveApiTaskCollaborators(task.id, entries)
          setTask(result.task)
          setShowCollaborators(false)
          setToast('Collaborators saved.')
        }}
      />

      {toast ? <div role="status" aria-live="polite" className="fixed bottom-5 right-5 z-[60] rounded-xl bg-emerald-700 px-4 py-3 text-sm font-medium text-white shadow-lg">{toast}</div> : null}
    </div>
  )
}
