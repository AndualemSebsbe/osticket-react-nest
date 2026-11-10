import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { btnGhost, btnPrimary, Card, Field, inputClass, PageHeader } from '../../components/ui'
import { useDialogs } from '../../context/DialogContext'
import { accountSessionToken } from '../../lib/store'
import {
  createApiHelpTopic,
  deleteApiHelpTopic,
  listApiHelpTopics,
  massActionApiHelpTopics,
  updateApiHelpTopic,
  type ApiHelpTopic,
  type ApiHelpTopicFormLink,
  type ApiHelpTopicInput,
  type ApiHelpTopicOptions,
} from '../../lib/api'

type Tab = 'information' | 'new-ticket' | 'forms'
type TopicStatus = ApiHelpTopic['status']

const emptyOptions: ApiHelpTopicOptions = {
  topics: [],
  departments: [],
  statuses: [],
  priorities: [],
  slas: [],
  pages: [],
  sequences: [],
  staff: [],
  teams: [],
  forms: [],
}

const statusTone: Record<TopicStatus, string> = {
  active: 'bg-emerald-50 text-emerald-700',
  disabled: 'bg-amber-50 text-amber-700',
  archived: 'bg-slate-100 text-slate-600',
}

function OptionList({ items, none }: { items: Array<{ id: string; name: string }>; none: string }) {
  return (
    <>
      <option value="0">— {none} —</option>
      {items.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
    </>
  )
}

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="border-t border-line pt-4 first:border-t-0 first:pt-0">
      <h3 className="text-sm font-semibold text-ink-800">{title}</h3>
      {description ? <p className="mt-1 text-xs text-ink-500">{description}</p> : null}
      <div className="mt-3 grid gap-4 sm:grid-cols-2">{children}</div>
    </section>
  )
}

function StatusBadge({ status }: { status: TopicStatus }) {
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold capitalize ${statusTone[status]}`}>{status}</span>
}

function orderTopics(items: ApiHelpTopic[]) {
  const ids = new Set(items.map(item => item.id))
  const byParent = new Map<string, ApiHelpTopic[]>()
  for (const item of items) {
    const parentId = item.parentId && ids.has(item.parentId) ? item.parentId : ''
    const siblings = byParent.get(parentId) || []
    siblings.push(item)
    byParent.set(parentId, siblings)
  }
  for (const siblings of byParent.values()) siblings.sort((a, b) => a.name.localeCompare(b.name))

  const ordered: Array<{ topic: ApiHelpTopic; depth: number }> = []
  const seen = new Set<string>()
  const visit = (parentId: string, depth: number) => {
    for (const topic of byParent.get(parentId) || []) {
      if (seen.has(topic.id)) continue
      seen.add(topic.id)
      ordered.push({ topic, depth })
      visit(topic.id, depth + 1)
    }
  }
  visit('', 0)
  for (const topic of items) {
    if (!seen.has(topic.id)) ordered.push({ topic, depth: 0 })
  }
  return ordered
}

function newTopicForms(options: ApiHelpTopicOptions): ApiHelpTopicFormLink[] {
  return options.forms
    .filter(form => form.type === 'T' && !form.deleted)
    .map((form, index) => ({
      formId: form.id,
      sort: index + 1,
      title: form.title,
      instructions: form.instructions,
      type: form.type,
      fields: form.fields.map(field => ({ ...field, disabled: false })),
      disabledFieldIds: [],
    }))
}

export function AdminHelpTopicsPage() {
  const { confirm } = useDialogs()
  const [options, setOptions] = useState<ApiHelpTopicOptions>(emptyOptions)
  const [editing, setEditing] = useState<ApiHelpTopic | 'new' | null>(null)
  const [tab, setTab] = useState<Tab>('information')
  const [formsDraft, setFormsDraft] = useState<ApiHelpTopicFormLink[]>([])
  const [addFormId, setAddFormId] = useState('')
  const [customNumbers, setCustomNumbers] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [search, setSearch] = useState('')
  const [departmentFilter, setDepartmentFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const token = accountSessionToken()

  async function reload() {
    if (!token) throw new Error('Administrator session expired. Sign in again.')
    setOptions(await listApiHelpTopics(token))
  }

  useEffect(() => {
    let live = true
    if (!token) {
      setError('Administrator session expired. Sign in again.')
      setLoading(false)
      return
    }
    void listApiHelpTopics(token)
      .then(result => { if (live) setOptions(result) })
      .catch(reason => { if (live) setError(reason instanceof Error ? reason.message : 'Could not load help topics.') })
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [])

  function open(topic: ApiHelpTopic | 'new') {
    setEditing(topic)
    setTab('information')
    setError('')
    setNotice('')
    setAddFormId('')
    if (topic === 'new') {
      setFormsDraft(newTopicForms(options))
      setCustomNumbers(false)
    } else {
      setFormsDraft(topic.forms.map(link => ({ ...link, fields: link.fields.map(field => ({ ...field })) })))
      setCustomNumbers(topic.customNumbers)
    }
  }

  function addForm() {
    const form = options.forms.find(item => item.id === addFormId)
    if (!form) return
    if (formsDraft.some(link => link.formId === form.id)) {
      setError('That form is already attached to this help topic.')
      return
    }
    setFormsDraft(current => [
      ...current,
      {
        formId: form.id,
        sort: current.length + 1,
        title: form.title,
        instructions: form.instructions,
        type: form.type,
        fields: form.fields.map(field => ({ ...field, disabled: false })),
        disabledFieldIds: [],
      },
    ])
    setAddFormId('')
    setError('')
  }

  function moveForm(index: number, delta: number) {
    setFormsDraft(current => {
      const next = [...current]
      const target = index + delta
      if (target < 0 || target >= next.length) return current
      const [item] = next.splice(index, 1)
      next.splice(target, 0, item)
      return next
    })
  }

  function toggleField(formId: string, fieldId: string) {
    setFormsDraft(current => current.map(link => {
      if (link.formId !== formId) return link
      const disabled = link.disabledFieldIds.includes(fieldId)
      return {
        ...link,
        disabledFieldIds: disabled
          ? link.disabledFieldIds.filter(id => id !== fieldId)
          : [...link.disabledFieldIds, fieldId],
      }
    }))
  }

  function buildInput(form: FormData): ApiHelpTopicInput {
    const assign = String(form.get('assign') || '0')
    const staffId = assign.startsWith('s') ? assign.slice(1) : '0'
    const teamId = assign.startsWith('t') ? assign.slice(1) : '0'
    return {
      name: String(form.get('name') || '').trim(),
      parentId: String(form.get('parentId') || '0'),
      departmentId: String(form.get('departmentId') || '0'),
      status: String(form.get('status') || 'active') as TopicStatus,
      isPublic: form.get('isPublic') === 'on',
      statusId: String(form.get('statusId') || '0'),
      priorityId: String(form.get('priorityId') || '0'),
      slaId: String(form.get('slaId') || '0'),
      pageId: String(form.get('pageId') || '0'),
      sequenceId: customNumbers ? String(form.get('sequenceId') || '0') : '0',
      numberFormat: String(form.get('numberFormat') || '').trim(),
      customNumbers,
      staffId,
      teamId,
      noautoresp: form.get('noautoresp') === 'on',
      notes: String(form.get('notes') || ''),
      forms: formsDraft.map(link => ({ formId: link.formId, disabledFieldIds: link.disabledFieldIds })),
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!editing) return
    if (!token) { setError('Administrator session expired. Sign in again.'); return }
    const data = buildInput(new FormData(event.currentTarget))
    if (!data.name) { setError('Help topic name is required.'); setTab('information'); return }
    if (data.name.length < 5) { setError('Topic is too short. Five characters minimum.'); setTab('information'); return }
    if (data.customNumbers && !/(?<!\\)#/.test(data.numberFormat || '')) {
      setError('Ticket number format requires at least one hash character (#).')
      setTab('new-ticket')
      return
    }
    setSaving(true)
    setError('')
    setNotice('')
    try {
      if (editing === 'new') await createApiHelpTopic(data, token)
      else await updateApiHelpTopic(editing.id, data, token)
      await reload()
      setNotice(editing === 'new' ? 'Help topic created.' : 'Help topic saved.')
      setEditing(null)
      setFormsDraft([])
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not save the help topic.')
    } finally {
      setSaving(false)
    }
  }

  async function remove(topic: ApiHelpTopic) {
    if (!token) { setError('Administrator session expired. Sign in again.'); return }
    if (!(await confirm({
      title: 'Delete help topic',
      description: `Delete the “${topic.name}” help topic? Tickets using it keep their history but become unassigned from the topic.`,
      confirmLabel: 'Delete',
    }))) return
    setSaving(true)
    setError('')
    setNotice('')
    try {
      await deleteApiHelpTopic(topic.id, token)
      await reload()
      setNotice('Help topic deleted.')
      if (editing !== 'new' && editing?.id === topic.id) setEditing(null)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not delete the help topic.')
    } finally {
      setSaving(false)
    }
  }

  async function runMassAction(action: 'enable' | 'disable' | 'archive' | 'delete') {
    if (!selected.size) { setError('Select one or more help topics first.'); return }
    if (!token) { setError('Administrator session expired. Sign in again.'); return }
    if (action === 'delete' && !(await confirm({
      title: 'Delete help topics',
      description: `Delete ${selected.size} selected help topic(s)?`,
      confirmLabel: 'Delete',
    }))) return
    setSaving(true)
    setError('')
    setNotice('')
    try {
      const result = await massActionApiHelpTopics(action, Array.from(selected), token)
      await reload()
      setSelected(new Set())
      if (action === 'delete') setNotice(`Deleted ${result.deleted ?? 0} help topic(s)${result.skipped ? `; ${result.skipped} could not be deleted` : ''}.`)
      else setNotice(`Updated ${result.updated ?? 0} help topic(s).`)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not apply the selected action.')
    } finally {
      setSaving(false)
    }
  }

  const initial = editing === 'new' ? undefined : editing
  const editingId = initial?.id || ''
  const descendantIds = useMemo(() => {
    const childrenByParent = new Map<string, string[]>()
    for (const topic of options.topics) {
      if (!topic.parentId) continue
      const children = childrenByParent.get(topic.parentId) || []
      children.push(topic.id)
      childrenByParent.set(topic.parentId, children)
    }
    const result = new Set<string>()
    const stack = editingId ? [editingId] : []
    while (stack.length) {
      const current = stack.pop() as string
      for (const child of childrenByParent.get(current) || []) {
        if (result.has(child)) continue
        result.add(child)
        stack.push(child)
      }
    }
    return result
  }, [options.topics, editingId])
  const parentChoices = options.topics.filter(topic =>
    topic.id !== editingId
    && !descendantIds.has(topic.id)
    && (topic.status !== 'archived' || topic.id === initial?.parentId),
  )
  const availableForms = options.forms.filter(form => !form.deleted && !formsDraft.some(link => link.formId === form.id))
  const filteredTopics = options.topics.filter(topic => {
    const needle = search.trim().toLowerCase()
    return (!needle || `${topic.name} ${topic.departmentName}`.toLowerCase().includes(needle))
      && (!departmentFilter || topic.departmentId === departmentFilter)
      && (!statusFilter || topic.status === statusFilter)
  })
  const orderedTopics = useMemo(() => orderTopics(filteredTopics), [filteredTopics])
  const allVisibleSelected = filteredTopics.length > 0 && filteredTopics.every(topic => selected.has(topic.id))

  function toggleSelected(id: string) {
    setSelected(current => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleAllVisible() {
    setSelected(current => {
      const next = new Set(current)
      if (allVisibleSelected) for (const topic of filteredTopics) next.delete(topic.id)
      else for (const topic of filteredTopics) next.add(topic.id)
      return next
    })
  }

  return (
    <div>
      <PageHeader
        title="Help topics"
        subtitle="Configure ticket routing, auto-assignment, custom numbers, and the forms shown when a ticket is opened."
        actions={<button type="button" className={btnPrimary} onClick={() => open('new')}>Add help topic</button>}
      />

      {error && !editing ? <p role="alert" className="mb-4 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</p> : null}
      {notice ? <p className="mb-4 rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{notice}</p> : null}

      {editing ? (
        <Card className="mb-6">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-semibold">{editing === 'new' ? 'Add new help topic' : `Update ${editing.name}`}</h2>
              <p className="mt-1 text-xs text-ink-500">
                {editing === 'new' ? 'Create a topic and choose where new tickets are routed.' : `Topic #${editing.id}${editing.sequenceName ? ` · ${editing.sequenceName}` : ''}`}
              </p>
            </div>
            <div role="tablist" aria-label="Help topic settings" className="flex flex-wrap gap-2">
              {([
                ['information', 'Help Topic Information'],
                ['new-ticket', 'New Ticket Options'],
                ['forms', 'Forms'],
              ] as Array<[Tab, string]>).map(([value, label]) => (
                <button
                  type="button"
                  role="tab"
                  aria-selected={tab === value}
                  key={value}
                  onClick={() => setTab(value)}
                  className={`rounded-full px-3 py-1.5 text-sm ${tab === value ? 'bg-brand-600 text-white' : 'bg-paper text-ink-600'}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <form key={editing === 'new' ? 'new' : editing.id} onSubmit={event => void submit(event)}>
            <div className={tab === 'information' ? 'space-y-6' : 'hidden'}>
              <Section title="Help topic information">
                <Field label="Parent topic">
                  <select name="parentId" defaultValue={initial?.parentId || '0'} className={inputClass}>
                    <option value="0">— Top-level topic —</option>
                    {parentChoices.map(topic => (
                      <option key={topic.id} value={topic.id}>
                        {topic.name}{topic.status !== 'active' ? ` (${topic.status})` : ''}
                      </option>
                    ))}
                  </select>
                  <span className="mt-1 block text-xs font-normal text-ink-500">Nested topics are displayed as Parent / Child in the client portal.</span>
                </Field>

                <Field label="Topic name">
                  <input name="name" required minLength={5} maxLength={128} defaultValue={initial?.name || ''} className={inputClass} />
                </Field>

                <Field label="Status">
                  <select name="status" defaultValue={initial?.status || 'active'} className={inputClass}>
                    <option value="active">Active</option>
                    <option value="disabled">Disabled</option>
                    <option value="archived">Archived</option>
                  </select>
                  <span className="mt-1 block text-xs font-normal text-ink-500">Only active topics accept new tickets. At least one topic must remain active.</span>
                </Field>

                <Field label="Visibility">
                  <label className="flex items-start gap-2 text-sm font-normal">
                    <input name="isPublic" type="checkbox" defaultChecked={initial ? initial.isPublic : true} className="mt-0.5 h-4 w-4" />
                    <span><strong>Public</strong> — show this topic in the client portal</span>
                  </label>
                  <span className="mt-1 block text-xs font-normal text-ink-500">At least one help topic must remain public.</span>
                </Field>

                <Field label="Internal notes" className="sm:col-span-2">
                  <textarea name="notes" rows={4} defaultValue={initial?.notes || ''} className={inputClass} placeholder="Notes are visible to agents only and are never shown in the client portal." />
                </Field>
              </Section>
            </div>

            <div className={tab === 'new-ticket' ? 'space-y-6' : 'hidden'}>
              <Section title="Ticket routing" description="These defaults are applied when a client opens a ticket with this help topic.">
                <Field label="Department">
                  <select name="departmentId" defaultValue={initial?.departmentId || '0'} className={inputClass}>
                    <OptionList items={options.departments.filter(item => !item.archived)} none="System default" />
                  </select>
                </Field>

                <Field label="Ticket status">
                  <select name="statusId" defaultValue={initial?.statusId || '0'} className={inputClass}>
                    <OptionList items={options.statuses.filter(item => item.enabled)} none="System default" />
                  </select>
                </Field>

                <Field label="Priority">
                  <select name="priorityId" defaultValue={initial?.priorityId || '0'} className={inputClass}>
                    <OptionList items={options.priorities} none="System default" />
                  </select>
                </Field>

                <Field label="SLA plan">
                  <select name="slaId" defaultValue={initial?.slaId || '0'} className={inputClass}>
                    <OptionList items={options.slas} none="System default" />
                  </select>
                </Field>

                <Field label="Thank-you page">
                  <select name="pageId" defaultValue={initial?.pageId || '0'} className={inputClass}>
                    <OptionList items={options.pages} none="System default" />
                  </select>
                </Field>

                <Field label="Auto-assignment">
                  <select name="assign" defaultValue={initial?.assign || '0'} className={inputClass}>
                    <option value="0">— Unassigned —</option>
                    {options.staff.length ? (
                      <optgroup label="Agents">
                        {options.staff.map(staff => <option key={`s${staff.id}`} value={`s${staff.id}`}>{staff.name}{staff.departmentId ? ` · ${options.departments.find(dept => dept.id === staff.departmentId)?.name || ''}` : ''}</option>)}
                      </optgroup>
                    ) : null}
                    {options.teams.length ? (
                      <optgroup label="Teams">
                        {options.teams.map(team => <option key={`t${team.id}`} value={`t${team.id}`}>{team.name}</option>)}
                      </optgroup>
                    ) : null}
                  </select>
                  <span className="mt-1 block text-xs font-normal text-ink-500">Agents take precedence over teams when a ticket is created.</span>
                </Field>
              </Section>

              <Section title="Ticket number" description="Override the system ticket number for tickets opened with this topic.">
                <Field label="Custom numbers">
                  <label className="flex items-start gap-2 text-sm font-normal">
                    <input type="checkbox" checked={customNumbers} onChange={event => setCustomNumbers(event.target.checked)} className="mt-0.5 h-4 w-4" />
                    <span>Use a custom ticket number format for this topic</span>
                  </label>
                </Field>

                <Field label="Sequence">
                  <select name="sequenceId" defaultValue={initial?.sequenceId || '0'} className={inputClass} disabled={!customNumbers}>
                    <OptionList items={options.sequences} none="Random" />
                  </select>
                  <span className="mt-1 block text-xs font-normal text-ink-500">Random generates a fresh number for each ticket. A sequence advances a stored counter.</span>
                </Field>

                <Field label="Number format" className="sm:col-span-2">
                  <input name="numberFormat" defaultValue={initial?.numberFormat || ''} placeholder="######" maxLength={20} className={inputClass} disabled={!customNumbers} />
                  <span className="mt-1 block text-xs font-normal text-ink-500">
                    Use hash characters (#) for sequence digits, for example <code>TX-######-US</code>. Escape a literal hash with a backslash.
                  </span>
                </Field>
              </Section>

              <Section title="Auto-responder">
                <Field label="New ticket auto-response">
                  <label className="flex items-start gap-2 text-sm font-normal">
                    <input name="noautoresp" type="checkbox" defaultChecked={initial?.noautoresp} className="mt-0.5 h-4 w-4" />
                    <span><strong>Disable</strong> the new-ticket auto-response for this help topic</span>
                  </label>
                </Field>
              </Section>
            </div>

            <div className={tab === 'forms' ? 'space-y-6' : 'hidden'}>
              <Section title="Custom forms" description="Choose the forms shown when a client opens a ticket with this help topic. System ticket forms are always included.">
                <div className="flex flex-col gap-2 sm:col-span-2 sm:flex-row sm:items-center">
                  <select aria-label="Add form" value={addFormId} onChange={event => setAddFormId(event.target.value)} className={`${inputClass} sm:w-72`}>
                    <option value="">Select a form to add…</option>
                    {availableForms.map(form => <option key={form.id} value={form.id}>{form.title || form.name || `Form #${form.id}`} ({form.type})</option>)}
                  </select>
                  <button type="button" className={btnGhost} onClick={addForm} disabled={!addFormId}>Add form</button>
                </div>

                <div className="sm:col-span-2">
                  {formsDraft.length ? (
                    <ul className="space-y-3">
                      {formsDraft.map((link, index) => (
                        <li key={link.formId} className="rounded-xl border border-line">
                          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3 py-2">
                            <div>
                              <p className="text-sm font-semibold">{link.title || link.formId}</p>
                              <p className="text-xs text-ink-500">
                                {link.type === 'T' ? 'System ticket form' : 'Custom form'}
                                {link.instructions ? ` · ${link.instructions}` : ''}
                              </p>
                            </div>
                            <div className="flex items-center gap-2">
                              <button type="button" className="text-sm text-ink-600 disabled:opacity-40" disabled={index === 0} onClick={() => moveForm(index, -1)}>Move up</button>
                              <button type="button" className="text-sm text-ink-600 disabled:opacity-40" disabled={index === formsDraft.length - 1} onClick={() => moveForm(index, 1)}>Move down</button>
                              {link.type === 'T' ? (
                                <span className="text-xs text-ink-400">Required</span>
                              ) : (
                                <button type="button" className="text-sm text-rose-600" onClick={() => setFormsDraft(current => current.filter(item => item.formId !== link.formId))}>Remove</button>
                              )}
                            </div>
                          </div>
                          {link.fields.length ? (
                            <div className="grid gap-2 px-3 py-3 sm:grid-cols-2">
                              {link.fields.map(field => (
                                <label key={field.id} className="flex items-center gap-2 text-sm">
                                  <input
                                    type="checkbox"
                                    checked={!link.disabledFieldIds.includes(field.id)}
                                    onChange={() => toggleField(link.formId, field.id)}
                                    className="h-4 w-4"
                                  />
                                  <span>{field.label || field.name || `Field #${field.id}`} <span className="text-xs text-ink-400">({field.type})</span></span>
                                </label>
                              ))}
                            </div>
                          ) : (
                            <p className="px-3 py-2 text-sm text-ink-500">This form has no fields.</p>
                          )}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-ink-500">No custom forms have been attached. Add a form above to collect additional information.</p>
                  )}
                </div>
              </Section>
            </div>

            {error ? <p role="alert" className="mt-4 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</p> : null}

            <div className="mt-5 flex flex-wrap gap-2">
              <button type="submit" disabled={saving} className={btnPrimary}>
                {saving ? 'Saving…' : editing === 'new' ? 'Create help topic' : 'Save changes'}
              </button>
              <button type="button" disabled={saving} className={btnGhost} onClick={() => { setEditing(null); setFormsDraft([]); setError('') }}>Cancel</button>
            </div>
          </form>
        </Card>
      ) : null}

      <Card className="mb-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Search">
            <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Topic or department" className={inputClass} />
          </Field>
          <Field label="Department">
            <select value={departmentFilter} onChange={event => setDepartmentFilter(event.target.value)} className={inputClass}>
              <option value="">All departments</option>
              {options.departments.map(department => <option key={department.id} value={department.id}>{department.name}</option>)}
            </select>
          </Field>
          <Field label="Status">
            <select value={statusFilter} onChange={event => setStatusFilter(event.target.value)} className={inputClass}>
              <option value="">All statuses</option>
              <option value="active">Active</option>
              <option value="disabled">Disabled</option>
              <option value="archived">Archived</option>
            </select>
          </Field>
          <Field label="Selected">
            <div className="flex flex-wrap gap-2 pt-1">
              <button type="button" disabled={saving || !selected.size} className={btnGhost} onClick={() => void runMassAction('enable')}>Enable</button>
              <button type="button" disabled={saving || !selected.size} className={btnGhost} onClick={() => void runMassAction('disable')}>Disable</button>
              <button type="button" disabled={saving || !selected.size} className={btnGhost} onClick={() => void runMassAction('archive')}>Archive</button>
              <button type="button" disabled={saving || !selected.size} className="rounded-xl border border-rose-200 px-4 py-2 text-sm text-rose-700 disabled:opacity-50" onClick={() => void runMassAction('delete')}>Delete</button>
            </div>
          </Field>
        </div>
      </Card>

      {loading ? (
        <p className="text-sm text-ink-500">Loading help topics…</p>
      ) : orderedTopics.length === 0 ? (
        <Card>
          <p className="text-sm text-ink-600">No help topics match the current filters.</p>
        </Card>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-line bg-paper text-xs uppercase tracking-wide text-ink-500">
              <tr>
                <th className="w-10 px-3 py-3">
                  <input type="checkbox" aria-label="Select all visible help topics" checked={allVisibleSelected} onChange={toggleAllVisible} className="h-4 w-4" />
                </th>
                <th className="px-3 py-3">Topic</th>
                <th className="px-3 py-3">Status</th>
                <th className="px-3 py-3">Department</th>
                <th className="px-3 py-3">Priority</th>
                <th className="px-3 py-3">Visibility</th>
                <th className="px-3 py-3">Forms</th>
                <th className="px-3 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {orderedTopics.map(({ topic, depth }) => (
                <tr key={topic.id} className="align-top">
                  <td className="px-3 py-3">
                    <input type="checkbox" aria-label={`Select ${topic.name}`} checked={selected.has(topic.id)} onChange={() => toggleSelected(topic.id)} className="h-4 w-4" />
                  </td>
                  <td className="px-3 py-3">
                    <div style={{ paddingLeft: depth ? `${depth * 1.25}rem` : undefined }} className={depth ? 'border-l-2 border-line pl-3' : ''}>
                      <button type="button" className="font-medium text-brand-700 hover:underline" onClick={() => open(topic)}>
                        {topic.name}
                      </button>
                      {topic.notes ? <p className="mt-0.5 line-clamp-2 text-xs text-ink-500">{topic.notes}</p> : null}
                    </div>
                  </td>
                  <td className="px-3 py-3"><StatusBadge status={topic.status} /></td>
                  <td className="px-3 py-3 text-ink-600">{topic.departmentName || 'System default'}</td>
                  <td className="px-3 py-3 capitalize text-ink-600">{topic.priorityName || topic.priority || 'Normal'}</td>
                  <td className="px-3 py-3 text-ink-600">{topic.isPublic ? 'Public' : 'Private'}</td>
                  <td className="px-3 py-3 text-ink-600">{topic.forms.length}</td>
                  <td className="whitespace-nowrap px-3 py-3 text-right">
                    <button type="button" disabled={saving} className="text-sm font-medium text-brand-700 disabled:opacity-50" onClick={() => open(topic)}>Edit</button>
                    <button type="button" disabled={saving} className="ml-3 text-sm text-rose-600 disabled:opacity-50" onClick={() => void remove(topic)}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
