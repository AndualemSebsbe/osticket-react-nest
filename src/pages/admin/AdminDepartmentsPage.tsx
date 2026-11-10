import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { btnGhost, btnPrimary, Card, Field, inputClass, PageHeader } from '../../components/ui'
import { useDialogs } from '../../context/DialogContext'
import { accountSessionToken, removeRecord, upsertRecord } from '../../lib/store'
import {
  createApiDepartment,
  deleteApiDepartment,
  listApiDepartments,
  updateApiDepartment,
  type ApiDepartment,
  type ApiDepartmentMember,
  type ApiDepartmentOptions,
} from '../../lib/api'

type Tab = 'settings' | 'access'

const emptyOptions: ApiDepartmentOptions = {
  departments: [],
  staff: [],
  slas: [],
  schedules: [],
  emails: [],
  templates: [],
  roles: [],
  defaultDeptId: '',
}

const selectClass = inputClass
const statusTone: Record<ApiDepartment['status'], string> = {
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

function RoleOptions({ roles }: { roles: Array<{ id: string; name: string }> }) {
  return (
    <>
      <option value="0">— Select role —</option>
      {roles.map(role => <option key={role.id} value={role.id}>{role.name || `Role ${role.id}`}</option>)}
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

function StatusBadge({ status }: { status: ApiDepartment['status'] }) {
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold capitalize ${statusTone[status]}`}>{status}</span>
}

function orderDepartments(items: ApiDepartment[]) {
  const ids = new Set(items.map(item => item.id))
  const byParent = new Map<string, ApiDepartment[]>()
  for (const item of items) {
    const parentId = item.parentId && ids.has(item.parentId) ? item.parentId : ''
    const siblings = byParent.get(parentId) || []
    siblings.push(item)
    byParent.set(parentId, siblings)
  }
  for (const siblings of byParent.values()) siblings.sort((a, b) => a.name.localeCompare(b.name))

  const ordered: Array<{ department: ApiDepartment; depth: number }> = []
  const seen = new Set<string>()
  const visit = (parentId: string, depth: number) => {
    for (const department of byParent.get(parentId) || []) {
      if (seen.has(department.id)) continue
      seen.add(department.id)
      ordered.push({ department, depth })
      visit(department.id, depth + 1)
    }
  }
  visit('', 0)
  for (const department of items) {
    if (!seen.has(department.id)) ordered.push({ department, depth: 0 })
  }
  return ordered
}

export function AdminDepartmentsPage() {
  const { confirm } = useDialogs()
  const [options, setOptions] = useState<ApiDepartmentOptions>(emptyOptions)
  const [editing, setEditing] = useState<ApiDepartment | 'new' | null>(null)
  const [tab, setTab] = useState<Tab>('settings')
  const [primaryMembers, setPrimaryMembers] = useState<ApiDepartmentMember[]>([])
  const [extendedMembers, setExtendedMembers] = useState<ApiDepartmentMember[]>([])
  const [addStaff, setAddStaff] = useState('')
  const [addRole, setAddRole] = useState('')
  const [addAlerts, setAddAlerts] = useState(true)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const token = accountSessionToken()

  async function reload() {
    if (!token) throw new Error('Administrator session expired. Sign in again.')
    setOptions(await listApiDepartments(token))
  }

  useEffect(() => {
    let live = true
    if (!token) {
      setError('Administrator session expired. Sign in again.')
      setLoading(false)
      return
    }
    void listApiDepartments(token)
      .then(result => { if (live) setOptions(result) })
      .catch(reason => { if (live) setError(reason instanceof Error ? reason.message : 'Could not load departments.') })
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [])

  function open(department: ApiDepartment | 'new') {
    setEditing(department)
    setTab('settings')
    setError('')
    setPrimaryMembers(department === 'new' ? [] : [...(department.primaryMembers || [])])
    setExtendedMembers(department === 'new' ? [] : [...(department.extendedMembers || [])])
    setAddStaff('')
    setAddRole(options.roles[0]?.id || '')
    setAddAlerts(true)
  }

  function addExtendedMember() {
    const agent = options.staff.find(item => item.id === addStaff)
    if (!agent || !addRole) {
      setError('Select an agent and role before adding extended access.')
      return
    }
    if (primaryMembers.some(member => member.id === agent.id) || extendedMembers.some(member => member.id === agent.id)) {
      setError('That agent already has access to this department.')
      return
    }
    setExtendedMembers(current => [...current, { id: agent.id, name: agent.name, departmentId: agent.departmentId, primary: false, roleId: addRole, alerts: addAlerts }])
    setAddStaff('')
    setAddAlerts(true)
    setError('')
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!editing) return
    const form = new FormData(event.currentTarget)
    const current = editing === 'new' ? undefined : editing
    const isDefault = Boolean(current?.isDefault)
    const data: Partial<ApiDepartment> & { name: string } = {
      name: String(form.get('name') || '').trim(),
      parentId: String(form.get('parentId') || ''),
      status: String(form.get('status') || 'active') as ApiDepartment['status'],
      type: String(form.get('type') || 'public') as ApiDepartment['type'],
      signature: String(form.get('signature') || ''),
      slaId: String(form.get('slaId') || '0'),
      scheduleId: String(form.get('scheduleId') || '0'),
      managerId: String(form.get('managerId') || '0'),
      emailId: String(form.get('emailId') || '0'),
      templateId: String(form.get('templateId') || '0'),
      autoresponderEmailId: String(form.get('autoresponderEmailId') || '0'),
      assignment: String(form.get('assignment') || 'all') as ApiDepartment['assignment'],
      disableAutoClaim: form.get('disableAutoClaim') === 'on',
      disableReopenAutoAssign: form.get('disableReopenAutoAssign') === 'on',
      alertRecipients: Number(form.get('alertRecipients') || 1),
      ticketAutoResponse: form.get('disableTicketAutoResponse') !== 'on',
      messageAutoResponse: form.get('disableMessageAutoResponse') !== 'on',
      primaryMembers,
      extendedMembers,
    }

    if (!data.name) {
      setError('Department name is required.')
      setTab('settings')
      return
    }
    if (isDefault && data.status !== 'active') {
      setError('The system default department must remain active.')
      return
    }
    if (isDefault && data.type === 'private') {
      setError('The system default department cannot be private.')
      return
    }
    if (data.parentId && data.parentId === current?.id) {
      setError('A department cannot be its own parent.')
      return
    }
    const parent = options.departments.find(department => department.id === data.parentId)
    if (parent && parent.status !== 'active') {
      setError('The selected parent department must be active.')
      return
    }
    if (data.type === 'private' && !options.departments.some(department => department.id !== current?.id && department.type === 'public')) {
      setError('At least one department must remain public.')
      return
    }

    setSaving(true)
    setError('')
    try {
      if (!token) throw new Error('Administrator session expired. Sign in again.')
      const saved = editing === 'new'
        ? (await createApiDepartment(data, token)).department
        : (await updateApiDepartment({ ...editing, ...data, id: editing.id } as ApiDepartment, token)).department
      upsertRecord('departments', { id: saved.id, name: saved.name, active: saved.status === 'active' })
      await reload()
      setEditing(null)
      setPrimaryMembers([])
      setExtendedMembers([])
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not save the department.')
    } finally {
      setSaving(false)
    }
  }

  async function remove(department: ApiDepartment) {
    if (!token) {
      setError('Administrator session expired. Sign in again.')
      return
    }
    if (!(await confirm({
      title: 'Delete department',
      description: `Delete “${department.name}”? Departments with agents, child departments, tickets, or help topics cannot be deleted.`,
      confirmLabel: 'Delete',
    }))) return
    setSaving(true)
    setError('')
    try {
      await deleteApiDepartment(department.id, token)
      removeRecord('departments', department.id)
      await reload()
      if (editing !== 'new' && editing?.id === department.id) setEditing(null)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not delete the department.')
    } finally {
      setSaving(false)
    }
  }

  const initial = editing === 'new' ? undefined : editing
  const editingId = initial?.id || ''
  const isDefault = Boolean(initial?.isDefault)
  const descendantIds = useMemo(() => {
    const childrenByParent = new Map<string, string[]>()
    for (const department of options.departments) {
      if (!department.parentId) continue
      const children = childrenByParent.get(department.parentId) || []
      children.push(department.id)
      childrenByParent.set(department.parentId, children)
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
  }, [options.departments, editingId])
  const parentChoices = useMemo(
    () => options.departments.filter(department =>
      department.id !== editingId
      && !descendantIds.has(department.id)
      && (department.status === 'active' || department.id === initial?.parentId)),
    [options.departments, editingId, descendantIds, initial?.parentId],
  )
  const availableStaff = options.staff.filter(staff =>
    !primaryMembers.some(member => member.id === staff.id) &&
    !extendedMembers.some(member => member.id === staff.id),
  )
  const orderedDepartments = useMemo(() => orderDepartments(options.departments), [options.departments])

  return (
    <div>
      <PageHeader
        title="Departments"
        subtitle="Route tickets, configure department email and auto-responders, and control agent access."
        actions={<button type="button" className={btnPrimary} onClick={() => open('new')}>Add department</button>}
      />

      {error && !editing ? <p role="alert" className="mb-4 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</p> : null}

      {editing ? (
        <Card className="mb-6">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-semibold">{editing === 'new' ? 'Add new department' : `Update ${editing.name}`}</h2>
              <p className="mt-1 text-xs text-ink-500">
                {editing === 'new' ? 'Create a department and optionally assign agents after saving.' : `Department #${editing.id}${isDefault ? ' · System default' : ''}`}
              </p>
            </div>
            <div role="tablist" aria-label="Department settings" className="flex gap-2">
              {(['settings', 'access'] as Tab[]).map(value => (
                <button
                  type="button"
                  role="tab"
                  aria-selected={tab === value}
                  key={value}
                  onClick={() => setTab(value)}
                  className={`rounded-full px-3 py-1.5 text-sm capitalize ${tab === value ? 'bg-brand-600 text-white' : 'bg-paper text-ink-600'}`}
                >
                  {value}
                </button>
              ))}
            </div>
          </div>

          <form key={editing === 'new' ? 'new' : editing.id} onSubmit={event => void submit(event)}>
            <div className={tab === 'settings' ? 'space-y-6' : 'hidden'}>
              <Section title="Department information">
                <Field label="Parent department">
                  <select name="parentId" defaultValue={initial?.parentId || ''} className={selectClass}>
                    <option value="">— Top-level department —</option>
                    {parentChoices.map(department => (
                      <option key={department.id} value={department.id}>
                        {department.name}{department.status !== 'active' ? ` (${department.status})` : ''}
                      </option>
                    ))}
                  </select>
                  <span className="mt-1 block text-xs font-normal text-ink-500">Agents with access to the parent also see its nested departments.</span>
                </Field>

                <Field label="Name">
                  <input name="name" required maxLength={128} defaultValue={initial?.name || ''} className={inputClass} />
                </Field>

                <Field label="Status">
                  <select name="status" defaultValue={initial?.status || 'active'} className={selectClass} disabled={isDefault}>
                    <option value="active">Active</option>
                    <option value="disabled">Disabled</option>
                    <option value="archived">Archived</option>
                  </select>
                  <span className="mt-1 block text-xs font-normal text-ink-500">
                    {isDefault ? 'The system default department always remains active.' : 'Only active departments can receive transferred tickets.'}
                  </span>
                </Field>

                <Field label="Type">
                  <select name="type" defaultValue={initial?.type || 'public'} className={selectClass} disabled={isDefault}>
                    <option value="public">Public</option>
                    <option value="private">Private (internal)</option>
                  </select>
                  <span className="mt-1 block text-xs font-normal text-ink-500">
                    {isDefault ? 'The system default department is always public.' : 'Private departments hide their signature and assignments in the client portal.'}
                  </span>
                </Field>

                <Field label="SLA">
                  <select name="slaId" defaultValue={initial?.slaId || '0'} className={selectClass}>
                    <OptionList items={options.slas} none="System default" />
                  </select>
                </Field>

                <Field label="Schedule">
                  <select name="scheduleId" defaultValue={initial?.scheduleId || '0'} className={selectClass}>
                    <OptionList items={options.schedules} none="SLA's default" />
                  </select>
                </Field>

                <Field label="Manager">
                  <select name="managerId" defaultValue={initial?.managerId || '0'} className={selectClass}>
                    <OptionList items={options.staff} none="None" />
                  </select>
                </Field>

                <Field label="Ticket assignment">
                  <select name="assignment" defaultValue={initial?.assignment || 'all'} className={selectClass}>
                    <option value="all">All agents</option>
                    <option value="members">Department members</option>
                    <option value="primary">Primary members</option>
                  </select>
                </Field>

                <Field label="Claim on response">
                  <label className="flex items-start gap-2 text-sm font-normal">
                    <input name="disableAutoClaim" type="checkbox" defaultChecked={initial?.disableAutoClaim} className="mt-0.5 h-4 w-4" />
                    <span><strong>Disable</strong> auto-claim when an agent responds</span>
                  </label>
                </Field>

                <Field label="Reopen auto assignment">
                  <label className="flex items-start gap-2 text-sm font-normal">
                    <input name="disableReopenAutoAssign" type="checkbox" defaultChecked={initial?.disableReopenAutoAssign} className="mt-0.5 h-4 w-4" />
                    <span><strong>Disable</strong> auto-assignment when a ticket is reopened</span>
                  </label>
                </Field>
              </Section>

              <Section title="Outgoing email settings" description="Used when agents post replies to tickets routed to this department.">
                <Field label="Outgoing email">
                  <select name="emailId" defaultValue={initial?.emailId || '0'} className={selectClass}>
                    <OptionList items={options.emails} none="System default" />
                  </select>
                </Field>

                <Field label="Template set">
                  <select name="templateId" defaultValue={initial?.templateId || '0'} className={selectClass}>
                    <OptionList items={options.templates} none="System default" />
                  </select>
                </Field>
              </Section>

              <Section title="Auto responder settings" description="Override the global autoresponder settings for this department.">
                <Field label="New ticket">
                  <label className="flex items-start gap-2 text-sm font-normal">
                    <input name="disableTicketAutoResponse" type="checkbox" defaultChecked={initial ? !initial.ticketAutoResponse : false} className="mt-0.5 h-4 w-4" />
                    <span><strong>Disable</strong> the new-ticket auto-response for this department</span>
                  </label>
                </Field>

                <Field label="New message">
                  <label className="flex items-start gap-2 text-sm font-normal">
                    <input name="disableMessageAutoResponse" type="checkbox" defaultChecked={initial ? !initial.messageAutoResponse : false} className="mt-0.5 h-4 w-4" />
                    <span><strong>Disable</strong> the new-message auto-response for this department</span>
                  </label>
                </Field>

                <Field label="Auto-response email">
                  <select name="autoresponderEmailId" defaultValue={initial?.autoresponderEmailId || '0'} className={selectClass}>
                    <OptionList items={options.emails} none="Department email" />
                  </select>
                </Field>
              </Section>

              <Section title="Alerts and notices" description="Choose who receives alerts and notices for tickets routed to this department.">
                <Field label="Recipients">
                  <select name="alertRecipients" defaultValue={String(initial?.alertRecipients ?? 1)} className={selectClass}>
                    <option value="2">No one (disable alerts and notices)</option>
                    <option value="3">Admin email only</option>
                    <option value="0">Department members only</option>
                    <option value="1">Department and extended access members</option>
                  </select>
                </Field>
              </Section>

              <Section title="Department signature" description="Shown on email replies. Private department signatures are never included.">
                <Field label="Signature" className="sm:col-span-2">
                  <textarea name="signature" rows={5} defaultValue={initial?.signature || ''} className={inputClass} />
                </Field>
              </Section>
            </div>

            <div className={tab === 'access' ? 'space-y-6' : 'hidden'}>
              <Section title="Department members" description={`Agents who are primary members${initial ? ` of ${initial.name}` : ' of this department'}. Primary members always have access.`}>
                <div className="sm:col-span-2">
                  {primaryMembers.length ? (
                    <ul className="divide-y divide-line rounded-xl border border-line">
                      {primaryMembers.map(member => (
                        <li key={member.id} className="flex flex-col gap-2 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
                          <span className="text-sm">{member.name} <span className="text-xs text-ink-400">(primary)</span></span>
                          <select
                            aria-label={`Role for ${member.name}`}
                            value={member.roleId}
                            onChange={event => setPrimaryMembers(list => list.map(item => item.id === member.id ? { ...item, roleId: event.target.value } : item))}
                            className={`${selectClass} sm:w-56`}
                          >
                            <RoleOptions roles={options.roles} />
                          </select>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-ink-500">This department has no primary members. Assign an agent's primary department from the Agents page.</p>
                  )}
                </div>
              </Section>

              <Section title="Extended access members" description="Agents from other departments who can also access tickets in this department.">
                <div className="flex flex-col gap-2 sm:col-span-2 sm:flex-row sm:flex-wrap sm:items-center">
                  <select aria-label="Agent" value={addStaff} onChange={event => setAddStaff(event.target.value)} className={`${selectClass} sm:w-56`}>
                    <option value="">Select agent</option>
                    {availableStaff.map(staff => <option key={staff.id} value={staff.id}>{staff.name}</option>)}
                  </select>
                  <select aria-label="Role" value={addRole} onChange={event => setAddRole(event.target.value)} className={`${selectClass} sm:w-56`}>
                    <RoleOptions roles={options.roles} />
                  </select>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={addAlerts} onChange={event => setAddAlerts(event.target.checked)} className="h-4 w-4" />
                    Alerts
                  </label>
                  <button type="button" onClick={addExtendedMember} className={btnGhost} disabled={!addStaff || !addRole}>Add agent</button>
                </div>

                <div className="sm:col-span-2">
                  {extendedMembers.length ? (
                    <ul className="divide-y divide-line rounded-xl border border-line">
                      {extendedMembers.map(member => (
                        <li key={member.id} className="flex flex-col gap-2 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
                          <span className="text-sm">{member.name}</span>
                          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                            <select
                              aria-label={`Role for ${member.name}`}
                              value={member.roleId}
                              onChange={event => setExtendedMembers(list => list.map(item => item.id === member.id ? { ...item, roleId: event.target.value } : item))}
                              className={`${selectClass} sm:w-48`}
                            >
                              <RoleOptions roles={options.roles} />
                            </select>
                            <label className="flex items-center gap-2 text-sm">
                              <input
                                type="checkbox"
                                checked={member.alerts}
                                onChange={event => setExtendedMembers(list => list.map(item => item.id === member.id ? { ...item, alerts: event.target.checked } : item))}
                                className="h-4 w-4"
                              />
                              Alerts
                            </label>
                            <button type="button" className="text-sm text-rose-600" onClick={() => setExtendedMembers(list => list.filter(item => item.id !== member.id))}>
                              Remove
                            </button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-ink-500">No agents have extended access.</p>
                  )}
                </div>
              </Section>
            </div>

            {error ? <p role="alert" className="mt-4 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</p> : null}

            <div className="mt-5 flex flex-wrap gap-2">
              <button type="submit" disabled={saving} className={btnPrimary}>
                {saving ? 'Saving…' : editing === 'new' ? 'Create department' : 'Save changes'}
              </button>
              <button type="button" disabled={saving} className={btnGhost} onClick={() => setEditing(null)}>Cancel</button>
            </div>
          </form>
        </Card>
      ) : null}

      {loading ? (
        <p className="text-sm text-ink-500">Loading departments…</p>
      ) : orderedDepartments.length === 0 ? (
        <Card>
          <p className="text-sm text-ink-600">No departments have been created. Add the first department to start routing tickets.</p>
        </Card>
      ) : (
        <ul className="grid gap-3">
          {orderedDepartments.map(({ department, depth }) => (
            <li key={department.id}>
              <Card>
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0" style={{ paddingLeft: depth ? `${depth * 1.25}rem` : undefined }}>
                    <div className={`flex min-w-0 flex-wrap items-center gap-2 ${depth ? 'border-l-2 border-line pl-3' : ''}`}>
                      <h2 className="font-semibold">{department.name}</h2>
                      <StatusBadge status={department.status} />
                      <span className="rounded-full bg-paper px-2 py-0.5 text-xs font-medium capitalize text-ink-600">{department.type}</span>
                      {department.isDefault ? <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-semibold text-brand-700">System default</span> : null}
                    </div>
                    <p className="mt-1 text-sm text-ink-600">
                      {department.parentName ? `${department.parentName} › ` : ''}
                      {department.primaryMembers.length} primary · {department.extendedMembers.length} extended access
                    </p>
                    <p className="mt-1 text-xs text-ink-500">
                      Manager: {department.managerName || 'None'} · SLA: {department.slaName || 'System default'} · Schedule: {department.scheduleName || "SLA's default"}
                    </p>
                    <p className="mt-1 text-xs text-ink-500">
                      Outgoing email: {department.emailName || 'System default'} · Template: {department.templateName || 'System default'} · Auto-response email: {department.autoresponderEmailName || 'Department email'}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-3">
                    <button type="button" disabled={saving} className="text-sm font-medium text-brand-700 disabled:opacity-50" onClick={() => open(department)}>Edit</button>
                    {department.isDefault ? (
                      <span className="text-xs text-ink-400">Default department</span>
                    ) : (
                      <button type="button" disabled={saving} className="text-sm text-rose-600 disabled:opacity-50" onClick={() => void remove(department)}>Delete</button>
                    )}
                  </div>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
