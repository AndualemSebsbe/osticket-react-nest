import { FormEvent, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { btnGhost, btnPrimary, Card, Field, inputClass, PageHeader } from '../../components/ui'
import { CollaboratorModal } from '../../components/CollaboratorModal'
import { useAuth } from '../../context/AuthContext'
import { useAgents } from '../../hooks/useAgents'
import { useDb } from '../../hooks/useDb'
import { listApiBranches } from '../../lib/api'
import { createTicket } from '../../lib/store'
import type { Priority, Source } from '../../types'

export function StaffOpenTicketPage() {
  const db = useDb()
  const { user } = useAuth()
  const agents = useAgents()
  const navigate = useNavigate()
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [topicId, setTopicId] = useState('')
  const [branches, setBranches] = useState<Array<{ id: string; name: string }>>([])
  const [showCollaborators, setShowCollaborators] = useState(false)
  const [collaborators, setCollaborators] = useState<Array<{ name: string; email: string; active: boolean }>>([])
  const topic = useMemo(() => db.topics.find((t) => t.id === topicId), [db.topics, topicId])
  const clients = db.users.filter((u) => u.role === 'client')

  useEffect(() => {
    let active = true
    void listApiBranches().then(({ branches: persisted }) => { if (active) setBranches(persisted) })
      .catch((err: unknown) => { if (active) setError(err instanceof Error ? err.message : 'Could not load branches.') })
    return () => { active = false }
  }, [])

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!user) return
    const form = new FormData(e.currentTarget)
    setSaving(true)
    try {
      const ticket = await createTicket({
        userId: String(form.get('userId')),
        name: String(form.get('name')),
        email: String(form.get('email')),
        phone: String(form.get('phone')),
        employeeId: String(form.get('employeeId') || ''),
        branchId: String(form.get('branchId') || ''),
        branchName: branches.find((branch) => branch.id === String(form.get('branchId') || ''))?.name || '',
        topicId: String(form.get('topicId')),
        subject: String(form.get('subject')),
        body: String(form.get('body')),
        priority: String(form.get('priority')) as Priority,
        source: String(form.get('source')) as Source,
        assigneeId: String(form.get('assigneeId')) || undefined,
        collaborators,
        fromEmail: String(form.get('fromEmail') || db.settings.defaultFromEmail),
        collaboratorNotice: String(form.get('collaboratorNotice') || 'all') as 'all' | 'user' | 'none',
        attachments: form.getAll('attachments').filter((item): item is File => item instanceof File && item.size > 0),
      })
      navigate(`/scp/tickets/${ticket.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create ticket.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <PageHeader title="Open a ticket" subtitle="Create a ticket on behalf of a user — same flow as osTicket staff tickets.php?a=open." />
      {error ? <p className="mb-4 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</p> : null}
      <Card>
        <form onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-2">
          <Field label="Existing user">
            <select name="userId" className={inputClass} defaultValue="">
              <option value="">New / guest contact</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.email})
                </option>
              ))}
            </select>
          </Field>
          <Field label="Source">
            <select name="source" className={inputClass} defaultValue="phone">
              <option value="phone">Phone</option>
              <option value="email">Email</option>
              <option value="web">Web</option>
            </select>
          </Field>
          <Field label="Name">
            <input name="name" className={inputClass} placeholder="Required if new user" />
          </Field>
          <Field label="Email">
            <input name="email" type="email" className={inputClass} placeholder="Required if new user" />
          </Field>
          <Field label="Phone" className="sm:col-span-2">
            <input name="phone" className={inputClass} />
          </Field>
          <Field label="Employee ID">
            <input name="employeeId" maxLength={64} className={inputClass} />
          </Field>
          <Field label="Branch">
            <select name="branchId" className={inputClass} defaultValue="">
              <option value="">— Select a branch —</option>
              {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
            </select>
          </Field>
          <Field label="Collaborators" className="sm:col-span-2">
            <button type="button" className={btnGhost} onClick={() => setShowCollaborators(true)}>👥 {collaborators.length} selected · Manage collaborators</button>
          </Field>
          <Field label="From email">
            <select name="fromEmail" className={inputClass} defaultValue={db.settings.defaultFromEmail}>
              <option value={db.settings.defaultFromEmail}>{db.settings.defaultFromEmail} (default)</option>
              {db.emails.filter((mail) => mail.active && mail.email !== db.settings.defaultFromEmail).map((mail) => <option key={mail.id} value={mail.email}>{mail.name} &lt;{mail.email}&gt;</option>)}
            </select>
          </Field>
          <Field label="Ticket notice">
            <select name="collaboratorNotice" className={inputClass} defaultValue="all">
              <option value="all">Email requester and collaborators</option>
              <option value="user">Email requester only</option>
              <option value="none">Do not send an email notice</option>
            </select>
          </Field>
          <Field label="Help topic">
            <select required name="topicId" value={topicId} onChange={(e) => setTopicId(e.target.value)} className={inputClass}>
              <option value="">— Select —</option>
              {db.topics.filter((t) => t.active !== false).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Assign">
            <select name="assigneeId" className={inputClass} defaultValue={user?.id}>
              <option value="">Unassigned</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </Field>
          {topic ? <p className="text-sm text-ink-600 sm:col-span-2">{topic.hint}</p> : null}
          <Field label="Priority">
            <select name="priority" className={inputClass} defaultValue={db.settings.defaultPriority}>
              {['low', 'normal', 'high', 'emergency'].map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Subject" className="sm:col-span-2">
            <input name="subject" required className={inputClass} />
          </Field>
          <Field label="Issue details" className="sm:col-span-2">
            <textarea name="body" required rows={6} className={inputClass} />
          </Field>
          <Field label="Attach files (up to 5; 8 MB each)" className="sm:col-span-2">
            <input name="attachments" type="file" multiple accept=".pdf,.png,.jpg,.jpeg,.gif,.webp,.txt,.csv,.doc,.docx,.xls,.xlsx,.zip" className={inputClass} />
          </Field>
          <div className="flex flex-wrap gap-2 sm:col-span-2">
            <button className={btnPrimary} disabled={saving}>{saving ? 'Saving…' : 'Create ticket'}</button>
            <button type="button" className={btnGhost} onClick={() => navigate('/scp/tickets')}>
              Cancel
            </button>
          </div>
        </form>
      </Card>
      <CollaboratorModal open={showCollaborators} value={collaborators} onClose={() => setShowCollaborators(false)} onSave={setCollaborators} />
    </div>
  )
}
