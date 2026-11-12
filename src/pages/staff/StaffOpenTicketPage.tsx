import { FormEvent, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { btnGhost, btnPrimary, Card, Field, inputClass, PageHeader } from '../../components/ui'
import { CollaboratorModal } from '../../components/CollaboratorModal'
import { RichTextEditor } from '../../components/RichTextEditor'
import { useAuth } from '../../context/AuthContext'
import { useAgents } from '../../hooks/useAgents'
import { useDb } from '../../hooks/useDb'
import { listApiBranches, listApiPublicHelpTopics, type ApiHelpTopicFormField } from '../../lib/api'
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
  const [ticketDetailsFields, setTicketDetailsFields] = useState<ApiHelpTopicFormField[]>([])
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')

  const topic = useMemo(() => db.topics.find((t) => t.id === topicId), [db.topics, topicId])
  const clients = db.users.filter((u) => u.role === 'client')

  useEffect(() => {
    let active = true
    void listApiBranches().then(({ branches: persisted }) => { if (active) setBranches(persisted) })
      .catch((err: unknown) => { if (active) setError(err instanceof Error ? err.message : 'Could not load branches.') })
    void listApiPublicHelpTopics().then((res) => {
      if (!active) return
      if (res.ticketDetailsForm?.fields) {
        setTicketDetailsFields(res.ticketDetailsForm.fields)
      }
    }).catch(() => {})
    return () => { active = false }
  }, [])

  const subjectField = useMemo(() => ticketDetailsFields.find((f) => f.name === 'subject'), [ticketDetailsFields])
  const issueDetailsField = useMemo(
    () => ticketDetailsFields.find((f) => f.name === 'issue_details' || f.name === 'message'),
    [ticketDetailsFields]
  )

  const subjectPlaceholder = (subjectField?.configuration?.placeholder as string) || 'Brief summary of the issue...'
  const bodyPlaceholder =
    (issueDetailsField?.configuration?.placeholder as string) ||
    'Please provide full details, error messages, and steps to reproduce ...'
  const isBodyHtml = issueDetailsField?.configuration?.html !== false

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!user) return
    const form = new FormData(e.currentTarget)
    setSaving(true)
    try {
      const { ticket } = await createTicket({
        userId: String(form.get('userId')),
        name: String(form.get('name')),
        email: String(form.get('email')),
        phone: String(form.get('phone')),
        employeeId: String(form.get('employeeId') || ''),
        branchId: String(form.get('branchId') || ''),
        branchName: branches.find((branch) => branch.id === String(form.get('branchId') || ''))?.name || '',
        topicId: String(form.get('topicId')),
        subject: subject.trim() || String(form.get('subject') || ''),
        body: body.trim() || String(form.get('body') || ''),
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
      <PageHeader title="Open a ticket" subtitle="Create a ticket on behalf of a user." />
      {error ? <p className="mb-4 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</p> : null}
      <Card>
        <form onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-2">
          <Field label="User">
            <select name="userId" required className={inputClass} defaultValue="">
              <option value="" disabled>Select client</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} &lt;{c.email}&gt;
                </option>
              ))}
            </select>
          </Field>
          <Field label="Source">
            <select name="source" className={inputClass} defaultValue="Phone">
              {['Phone', 'Email', 'Other'].map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Contact name (if overriding client)">
            <input name="name" className={inputClass} />
          </Field>
          <Field label="Contact email">
            <input name="email" type="email" className={inputClass} />
          </Field>
          <Field label="Phone">
            <input name="phone" className={inputClass} />
          </Field>
          <Field label="Branch (office)">
            <select name="branchId" className={inputClass} defaultValue="">
              <option value="">(No branch)</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Employee ID">
            <input name="employeeId" className={inputClass} />
          </Field>
          <div className="flex items-end sm:col-span-2">
            <button type="button" className={btnGhost} onClick={() => setShowCollaborators(true)}>
              Manage collaborators ({collaborators.filter((c) => c.active).length})
            </button>
          </div>
          <Field label="Collaborator notice" className="sm:col-span-2">
            <select name="collaboratorNotice" className={inputClass} defaultValue="all">
              <option value="all">Send notices to all collaborators</option>
              <option value="user">Only notify ticket owner</option>
              <option value="none">No email notices</option>
            </select>
          </Field>
          <Field label="Help topic">
            <select name="topicId" required className={inputClass} value={topicId} onChange={(e) => setTopicId(e.target.value)}>
              <option value="" disabled>Select topic</option>
              {db.topics.map((t) => (
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
          <Field label={subjectField?.label || "Subject"} className="sm:col-span-2">
            <input
              name="subject"
              required
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder={subjectPlaceholder}
              className={inputClass}
            />
          </Field>
          <Field label={issueDetailsField?.label || "Issue details"} className="sm:col-span-2">
            {isBodyHtml ? (
              <div className="space-y-1">
                <RichTextEditor
                  value={body}
                  onChange={setBody}
                  placeholder={bodyPlaceholder}
                />
                <input type="hidden" name="body" value={body} />
              </div>
            ) : (
              <textarea
                name="body"
                required
                rows={6}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder={bodyPlaceholder}
                className={inputClass}
              />
            )}
          </Field>
          <Field label="Attach files (up to 5; 8 MB each)" className="sm:col-span-2">
            <input
              name="attachments"
              type="file"
              multiple
              accept=".pdf,.png,.jpg,.jpeg,.gif,.webp,.txt,.csv,.doc,.docx,.xls,.xlsx,.zip"
              className={inputClass}
            />
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
