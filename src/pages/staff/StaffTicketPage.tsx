import { FormEvent, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { PriorityBadge, StatusBadge } from '../../components/Badges'
import { EmptyState, TicketThread } from '../../components/TicketThread'
import { CollaboratorModal } from '../../components/CollaboratorModal'
import { btnGhost, btnPrimary, inputClass} from '../../components/ui'
import { useAuth } from '../../context/AuthContext'
import { useAgents } from '../../hooks/useAgents'
import { useStaffDepartments } from '../../hooks/useStaffDepartments'
import { useStaffTicketOptions } from '../../hooks/useStaffTicketOptions'
import { useDb } from '../../hooks/useDb'
import { listApiBranches, updateApiTicket, updateApiTicketBranch } from '../../lib/api'
import { formatDate } from '../../lib/format'
import { printTicket } from '../../lib/printTicket'
import {
  acquireTicketLock,
  addReply,
  banEmailFromTicket,
  createTask,
  deleteTicket,
  getTicket,
  hydrateTicketDetailFromApi,
  markOverdue,
  mergeTickets,
  messagesFor,
  releaseTicket,
  releaseTicketLock,
  setTicketAssignee,
  setTicketBranch,
  setTicketCollaborators,
  setTicketDepartment,
  setTicketPriority,
  reopenTicket,
  setTicketStatus,
  tasksForTicket,
  updateTicket,
} from '../../lib/store'

export function StaffTicketPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const db = useDb()
  const agents = useAgents()
  const departments = useStaffDepartments()
  const ticketOptions = useStaffTicketOptions()
  const ticket = id ? getTicket(id) : undefined
  const [body, setBody] = useState('')
  const [isOverdue, setIsOverdue] = useState(Boolean(ticket?.overdue))
  const [mergeNumber, setMergeNumber] = useState('')
  const [showMerge, setShowMerge] = useState(false)
  const [showCollaborators, setShowCollaborators] = useState(false)
  const [toast, setToast] = useState('')
  const [taskTitle, setTaskTitle] = useState('')
  const [branches, setBranches] = useState<Array<{ id: string; name: string }>>([])
  const [branchSaving, setBranchSaving] = useState(false)
  const [statusSaving, setStatusSaving] = useState(false)
  const [deptSaving, setDeptSaving] = useState(false)
  const [assigneeSaving, setAssigneeSaving] = useState(false)
  const [prioritySaving, setPrioritySaving] = useState(false)

  useEffect(() => {
    setIsOverdue(Boolean(ticket?.overdue))
  }, [ticket?.id, ticket?.overdue])

  useEffect(() => {
    if (!id || !user) return
    let active = true
    const prepare = async () => {
      if (/^\d+$/.test(id)) {
        try {
          await hydrateTicketDetailFromApi(id)
        } catch (error) {
          if (active) setToast(error instanceof Error ? error.message : 'Could not refresh the ticket.')
        }
      }
      if (!active) return
      try {
        await acquireTicketLock(id, user)
        if (!active) void releaseTicketLock(id, user)
      } catch (error) {
        if (active) setToast(error instanceof Error ? error.message : 'Could not lock the ticket.')
      }
    }
    void prepare()
    return () => {
      active = false
      void releaseTicketLock(id, user)
    }
  }, [id, user?.id])

  useEffect(() => {
    let active = true
    void listApiBranches().then(({ branches: items }) => {
      if (active) setBranches(items)
    }).catch((error: unknown) => {
      if (active) setToast(error instanceof Error ? error.message : 'Could not load branches.')
    })
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (!toast) return
    const timeout = window.setTimeout(() => setToast(''), 3000)
    return () => window.clearTimeout(timeout)
  }, [toast])

  if (!ticket || !user) return <EmptyState title="Ticket not found" body="It may have been removed from the demo set." to="/scp/tickets" cta="Back to queue" />

  const current = ticket
  const actor = user
  const currentAssignee = current.assigneeId ? db.users.find((person) => person.id === current.assigneeId) : undefined
  const currentDepartment = db.departments.find((department) => department.id === current.deptId)
  const currentTopicName = db.topics.find((topic) => topic.id === current.topicId)?.name
  const selectedTopic = ticketOptions.topics.find((topic) =>
    topic.id === current.topicId || topic.name.toLowerCase() === currentTopicName?.toLowerCase(),
  )
  const statusChoices = ticketOptions.statuses.length
    ? ticketOptions.statuses
    : (['open', 'pending', 'closed'] as const).map((state) => ({ id: state, name: state[0].toUpperCase() + state.slice(1), state, sort: 0 }))
  const selectedStatus = statusChoices.find((status) => status.id === current.statusId)
    ?? statusChoices.find((status) => status.name.toLowerCase() === (current.statusName || '').toLowerCase())
    ?? statusChoices.find((status) => status.state.toLowerCase() === current.status)
  const currentStatusValue = selectedStatus?.id ?? current.statusId ?? current.status
  const owner = db.users.find((u) => u.id === current.userId)
  const collaboratorEntries = current.collaborators || (current.collaboratorIds || []).map((cid) => db.users.find((u) => u.id === cid)).filter((person) => Boolean(person)).map((person) => ({ userId: person!.id, name: person!.name, email: person!.email, active: true }))
  const thread = messagesFor(current.id, true)
  const linkedTasks = tasksForTicket(current.id)
  const locker = current.lockedBy ? db.users.find((u) => u.id === current.lockedBy) : undefined
  const lockedByOther = current.lockedBy && current.lockedBy !== actor.id

  async function onReply(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget
    const data = new FormData(form)
    const files = data.getAll('files') as File[]
    try {
      await addReply({
        ticketId: current.id,
        author: actor,
        body: String(data.get('body')),
        internal: data.get('internal') === 'on',
        close: data.get('action') === 'close',
        pending: data.get('action') === 'pending',
        attachments: files.filter((f) => f.name).map((f) => f.name),
        files: files.filter((f) => f.name),
        recipients: data.getAll('toRecipients').map(String),
        fromEmail: String(data.get('fromEmail') || db.settings.defaultFromEmail),
      })
      form.reset()
      setBody('')
    } catch (error) {
      setToast(error instanceof Error ? error.message : 'Could not post the reply.')
    }
  }

  async function onBranchChange(branchId: string) {
    setBranchSaving(true)
    try {
      const updated = await updateApiTicketBranch(current.number, branchId)
      setTicketBranch(current.id, updated.ticket.branchId || '', updated.ticket.branchName || '', actor)
      setToast('Ticket branch updated.')
    } catch (error) {
      setToast(error instanceof Error ? error.message : 'Could not update the ticket branch.')
    } finally { setBranchSaving(false) }
  }

  async function onStatusChange(statusId: string) {
    const status = statusChoices.find((item) => item.id === statusId)
    if (!status) return
    setStatusSaving(true)
    try {
      const updated = /^\d+$/.test(current.id)
        ? await updateApiTicket(current.number, status.id && /^\d+$/.test(status.id) ? { statusId: status.id } : { status: status.name })
        : undefined
      setTicketStatus(current.id, {
        ...status,
        id: updated?.ticket?.statusId || status.id,
        name: updated?.ticket?.statusName || status.name,
        state: updated?.ticket?.status || status.state,
      }, actor)
      setToast('Ticket status updated.')
    } catch (error) {
      setToast(error instanceof Error ? error.message : 'Could not update the ticket status.')
    } finally { setStatusSaving(false) }
  }

  async function onDepartmentChange(deptId: string) {
    const dept = departments.find((item) => item.id === deptId) ?? db.departments.find((item) => item.id === deptId)
    if (!dept) return
    setDeptSaving(true)
    try {
      if (/^\d+$/.test(current.id)) await updateApiTicket(current.number, { department: dept.name, assigneeEmail: '' })
      setTicketDepartment(current.id, dept.id, dept.name, actor)
      setToast('Ticket transferred.')
    } catch (error) {
      setToast(error instanceof Error ? error.message : 'Could not transfer the ticket.')
    } finally { setDeptSaving(false) }
  }

  async function onAssigneeChange(assigneeId: string) {
    const assignee = assigneeId
      ? agents.find((person) => person.id === assigneeId) ?? db.users.find((person) => person.id === assigneeId)
      : undefined
    setAssigneeSaving(true)
    try {
      if (/^\d+$/.test(current.id)) await updateApiTicket(current.number, { assigneeEmail: assignee?.email ?? '' })
      setTicketAssignee(current.id, assigneeId || undefined, assignee?.name, actor)
      setToast(assignee ? 'Ticket assigned.' : 'Ticket released.')
    } catch (error) {
      setToast(error instanceof Error ? error.message : 'Could not assign the ticket.')
    } finally { setAssigneeSaving(false) }
  }

  async function onPriorityChange(priority: typeof current.priority) {
    setPrioritySaving(true)
    try {
      if (/^\d+$/.test(current.id)) await updateApiTicket(current.number, { priority })
      setTicketPriority(current.id, priority, actor)
      setToast('Ticket priority updated.')
    } catch (error) {
      setToast(error instanceof Error ? error.message : 'Could not update the ticket priority.')
    } finally { setPrioritySaving(false) }
  }

  async function onMerge() {
    try {
      await mergeTickets(current.id, mergeNumber, actor)
      setMergeNumber('')
      setShowMerge(false)
      setToast('Ticket merged successfully.')
    } catch (err) {
      setToast(err instanceof Error ? err.message : 'Merge failed.')
    }
  }

  async function onAddTask(e: FormEvent) {
    e.preventDefault()
    if (!taskTitle.trim() || !db.settings.tasksEnabled) return
    try {
      await createTask({ title: taskTitle.trim(), deptId: current.deptId, ticketId: current.id, assigneeId: actor.id })
      setTaskTitle('')
      setToast('Task created.')
    } catch (error) {
      setToast(error instanceof Error ? error.message : 'Could not create the task.')
    }
  }

  async function runAction(action: () => Promise<unknown>, fallback: string) {
    try {
      await action()
    } catch (error) {
      setToast(error instanceof Error ? error.message : fallback)
    }
  }

  async function onDelete() {
    if (!window.confirm(`Delete ticket #${current.number} from the database? This cannot be undone.`)) return
    try {
      await deleteTicket(current.id, actor)
      navigate('/scp/tickets')
    } catch (error) {
      setToast(error instanceof Error ? error.message : 'Could not delete ticket.')
    }
  }

  async function onToggleOverdue() {
    const nextOverdue = !isOverdue
    setIsOverdue(nextOverdue)
    try {
      await markOverdue(current.id, actor, nextOverdue)
    } catch (error) {
      setIsOverdue(!nextOverdue)
      setToast(error instanceof Error ? error.message : 'Could not update overdue status.')
    }
  }

  return (
    <div className="space-y-6">
      <Link to="/scp/tickets" className="text-sm text-brand-600">
        ← Queue
      </Link>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <h1 className="text-2xl font-semibold">
          {current.subject} <span className="text-ink-400">#{current.number}</span>
        </h1>
        <div className="flex flex-wrap gap-2">
          <StatusBadge status={current.status} label={current.statusName} />
          <PriorityBadge priority={current.priority} />
          {isOverdue ? <span className="rounded-full bg-rose-100 px-2.5 py-0.5 text-xs font-semibold text-rose-800">Overdue</span> : null}
          {locker ? (
            <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-900">
              Locked{locker.id === actor.id ? ' by you' : ` by ${locker.name}`}
            </span>
          ) : null}
        </div>
      </div>
      {lockedByOther ? (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          This ticket is locked by {locker?.name}. You can still view it, but be careful editing concurrently.
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <button type="button" className={btnGhost} onClick={() => printTicket(current, thread, db)}>
          Print
        </button>
        {current.assigneeId ? (
          <button type="button" className={btnGhost} onClick={() => { void runAction(() => releaseTicket(current.id, actor), 'Could not release the ticket.') }}>
            Release
          </button>
        ) : null}
        {current.status === 'closed' ? (
          <button type="button" className={btnGhost} onClick={() => { void runAction(() => reopenTicket(current.id, actor), 'Could not reopen the ticket.') }}>
            Reopen
          </button>
        ) : null}
        <button type="button" className={btnGhost} onClick={() => { void onToggleOverdue() }}>
          {isOverdue ? 'Clear overdue' : 'Mark overdue'}
        </button>
        <button type="button" className={btnGhost} onClick={() => setShowMerge((v) => !v)}>
          Merge
        </button>
        <button type="button" className={btnGhost} onClick={() => { void banEmailFromTicket(current.id, actor).catch((error: unknown) => setToast(error instanceof Error ? error.message : 'Could not ban requester email.')) }}>
          Ban email
        </button>
        <button type="button" className={`${btnGhost} text-rose-600`} onClick={onDelete}>
          Delete
        </button>
      </div>
      {showMerge ? (
        <div className="flex flex-wrap items-end gap-2 rounded-2xl border border-line bg-surface p-4">
          <label className="text-sm font-medium">
            Merge ticket #
            <input
              value={mergeNumber}
              onChange={(e) => setMergeNumber(e.target.value)}
              placeholder="481188"
              className={inputClass + " mt-1 block"}
            />
          </label>
          <button type="button" className={btnPrimary} onClick={onMerge}>
            Merge into this ticket
          </button>
          <button type="button" className={btnGhost} onClick={() => setShowMerge(false)}>
            Cancel
          </button>
        </div>
      ) : null}
      {(current.mergedTicketIds?.length ?? 0) > 0 ? (
        <p className="text-sm text-ink-600">Merged tickets: {current.mergedTicketIds!.length} child ticket(s) folded into this thread.</p>
      ) : null}
      {current.parentTicketId ? (
        <p className="text-sm text-ink-600">
          Merged into{' '}
          <Link to={`/scp/tickets/${current.parentTicketId}`} className="text-brand-600">
            parent ticket
          </Link>
          .
        </p>
      ) : null}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="space-y-4">
           <TicketThread messages={thread} includeInternal ticketNumber={current.number} />
          <form onSubmit={onReply} className="rounded-2xl border border-line bg-surface p-4">
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-ink-400">Canned replies</p>
            <div className="mb-3 flex flex-wrap gap-2">
              {db.canned.map((c) => (
                <button key={c.id} type="button" className="rounded-full bg-paper px-3 py-1 text-xs ring-1 ring-line" onClick={() => setBody(c.body)}>
                  {c.title}
                </button>
              ))}
            </div>
            <label className="block text-sm font-medium">
              Reply / note
              <textarea required name="body" rows={5} value={body} onChange={(e) => setBody(e.target.value)} className={inputClass + " mt-1"} />
            </label>
            <label className="mt-3 block text-sm">
              Attachments
              <input name="files" type="file" multiple className="mt-1 block w-full text-sm" />
            </label>
            <label className="mt-3 block text-sm font-medium">From email
              <select name="fromEmail" className={inputClass + ' mt-1'} defaultValue={current.fromEmail || db.settings.defaultFromEmail}>
                <option value={db.settings.defaultFromEmail}>{db.settings.defaultFromEmail} (default)</option>
                {db.emails.filter((mail) => mail.active && mail.email !== db.settings.defaultFromEmail).map((mail) => <option key={mail.id} value={mail.email}>{mail.name} &lt;{mail.email}&gt;</option>)}
              </select>
            </label>
            <fieldset className="mt-3 rounded-xl border border-line p-3">
              <legend className="px-1 text-sm font-medium">Email recipients</legend>
              {[...(owner ? [{ name: owner.name, email: owner.email }] : []), ...collaboratorEntries.filter((person) => person.active)].map((person) => <label key={person.email} className="flex items-center gap-2 py-1 text-sm"><input type="checkbox" name="toRecipients" value={person.email} defaultChecked />{person.name} &lt;{person.email}&gt;</label>)}
            </fieldset>
            <label className="mt-3 flex items-center gap-2 text-sm">
              <input type="checkbox" name="internal" />
              Internal note (hidden from client)
            </label>
            <div className="mt-3 flex flex-wrap gap-2">
              <button name="action" value="reply" className="rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white">
                Post reply
              </button>
              <button name="action" value="pending" className="rounded-xl border border-line px-4 py-2 text-sm">
                Reply & pending
              </button>
              <button name="action" value="close" className="rounded-xl border border-line px-4 py-2 text-sm">
                Reply & close
              </button>
            </div>
          </form>
        
        </div>
        <aside className="space-y-4">
          <section className="rounded-2xl border border-line bg-surface p-4 text-sm">
            <h2 className="font-semibold">Details</h2>
            <dl className="mt-3 space-y-2">
              <div>
                <dt className="text-ink-400">User</dt>
                <dd>
                  {owner?.name}
                  <br />
                  {owner?.email}
                </dd>
              </div>
              <div>
                <dt className="text-ink-400">Created</dt>
                <dd>{formatDate(current.createdAt)}</dd>
              </div>
              <div>
                <dt className="text-ink-400">Department</dt>
                <dd>{db.departments.find((d) => d.id === current.deptId)?.name}</dd>
              </div>
              <div>
                <dt className="text-ink-400">Branch</dt>
                <dd>{current.branchName || '—'}</dd>
              </div>
            </dl>
            <label className="mt-4 block text-sm font-medium">
              Ticket branch
              <select className={inputClass + ' mt-1'} value={current.branchId || ''} disabled={branchSaving} onChange={(event) => void onBranchChange(event.target.value)}>
                <option value="">No branch</option>
                {current.branchId && !branches.some((branch) => branch.id === current.branchId) ? <option value={current.branchId}>{current.branchName || `Branch ${current.branchId}`} (inactive)</option> : null}
                {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
              </select>
              {branchSaving ? <span className="mt-1 block text-xs text-ink-400">Saving branch…</span> : null}
            </label>
            <button type="button" className="mt-4 w-full rounded-xl border border-line px-3 py-2 text-sm" disabled={assigneeSaving} onClick={() => void onAssigneeChange(actor.id)}>
              Claim ticket
            </button>
            <label className="mt-4 block text-sm font-medium">
              Assign
              <select
                className={inputClass + " mt-1"}
                value={current.assigneeId ?? ''}
                disabled={assigneeSaving}
                onChange={(e) => void onAssigneeChange(e.target.value)}
              >
                <option value="">Unassigned</option>
                {current.assigneeId && !agents.some((agent) => agent.id === current.assigneeId) ? (
                  <option value={current.assigneeId}>{currentAssignee?.name || current.assigneeId} (current)</option>
                ) : null}
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
              {assigneeSaving ? <span className="mt-1 block text-xs text-ink-400">Saving assignee…</span> : null}
            </label>
            <label className="mt-3 block text-sm font-medium">
              Transfer to department
              <select
                className={inputClass + " mt-1"}
                value={current.deptId}
                disabled={deptSaving}
                onChange={(e) => void onDepartmentChange(e.target.value)}
              >
                {current.deptId && !departments.some((department) => department.id === current.deptId) ? (
                  <option value={current.deptId}>{currentDepartment?.name || current.deptId} (current)</option>
                ) : null}
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
              {deptSaving ? <span className="mt-1 block text-xs text-ink-400">Saving department…</span> : null}
            </label>
            <label className="mt-3 block text-sm font-medium">
              Status
              <select
                className={inputClass + " mt-1"}
                value={currentStatusValue}
                disabled={statusSaving}
                onChange={(e) => void onStatusChange(e.target.value)}
              >
                {!selectedStatus ? <option value={currentStatusValue}>{current.statusName || current.status}</option> : null}
                {statusChoices.map((status) => (
                  <option key={status.id} value={status.id}>{status.name}</option>
                ))}
              </select>
              {statusSaving ? <span className="mt-1 block text-xs text-ink-400">Saving status…</span> : null}
            </label>
            <label className="mt-3 block text-sm font-medium">
              Help topic
              <select className={inputClass + " mt-1"} value={selectedTopic?.id || current.topicId || ''} onChange={(e) => {
                const topic = ticketOptions.topics.find((item) => item.id === e.target.value)
                if (topic) void runAction(() => updateTicket(current.id, { topicId: topic.id, topicName: topic.name }, actor), 'Could not update the ticket topic.')
              }}>
                {current.topicId && !selectedTopic ? <option value={current.topicId}>{currentTopicName || current.topicId} (current)</option> : null}
                {ticketOptions.topics.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="mt-3 block text-sm font-medium">
              Priority
              <select
                className={inputClass + " mt-1"}
                value={current.priority}
                disabled={prioritySaving}
                onChange={(e) => void onPriorityChange(e.target.value as typeof current.priority)}
              >
                {!ticketOptions.priorities.includes(current.priority) ? <option value={current.priority}>{current.priority}</option> : null}
                {ticketOptions.priorities.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
              {prioritySaving ? <span className="mt-1 block text-xs text-ink-400">Saving priority…</span> : null}
            </label>
            <label className="mt-3 block text-sm font-medium">
              Subject
              <input
                className={inputClass + " mt-1"}
                defaultValue={current.subject}
                onBlur={(e) => {
                  if (e.target.value.trim() && e.target.value !== current.subject) void runAction(() => updateTicket(current.id, { subject: e.target.value.trim() }, actor), 'Could not update the ticket subject.')
                }}
              />
            </label>
            <div className="mt-4"><button type="button" className={`${btnGhost} w-full`} onClick={() => setShowCollaborators(true)}>👥 {collaboratorEntries.length} · Manage collaborators</button></div>
            {owner ? (
              <Link to={`/scp/users/${owner.id}`} className="mt-4 inline-block text-brand-600">
                View user profile
              </Link>
            ) : null}
          </section>
          {db.settings.tasksEnabled ? (
            <section className="rounded-2xl border border-line bg-surface p-4 text-sm">
              <h2 className="font-semibold">Tasks</h2>
              <ul className="mt-2 space-y-1">
                {linkedTasks.map((task) => (
                  <li key={task.id}>
                    <Link to={`/scp/tasks/${task.id}`} className="text-brand-600">
                      #{task.number} {task.title}
                    </Link>
                    <span className="ml-2 text-ink-400">{task.status}</span>
                  </li>
                ))}
                {linkedTasks.length === 0 ? <li className="text-ink-400">No linked tasks.</li> : null}
              </ul>
              <form onSubmit={onAddTask} className="mt-3 flex gap-2">
                <input value={taskTitle} onChange={(e) => setTaskTitle(e.target.value)} placeholder="New task title" className={inputClass + " flex-1"} />
                <button type="submit" className={btnPrimary}>
                  Add
                </button>
              </form>
            </section>
          ) : null}
        </aside>
      </div>
      <CollaboratorModal
        open={showCollaborators}
        value={collaboratorEntries}
        onClose={() => setShowCollaborators(false)}
        onSave={async (entries) => {
          await setTicketCollaborators(current.id, entries, actor)
          setToast('Collaborators saved successfully.')
        }}
      />
      {toast ? <div role="status" aria-live="polite" className="fixed bottom-5 right-5 z-[60] rounded-xl bg-emerald-700 px-4 py-3 text-sm font-medium text-white shadow-lg">{toast}</div> : null}
    </div>
  )
}
