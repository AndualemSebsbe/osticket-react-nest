import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { btnGhost, btnPrimary, Card, Field, inputClass, PageHeader } from '../../components/ui'
import { accountSessionToken, removeRecord, upsertRecord } from '../../lib/store'
import { createApiDepartment, deleteApiDepartment, listApiDepartments, updateApiDepartment, type ApiDepartment, type ApiDepartmentMember, type ApiDepartmentOptions } from '../../lib/api'

type Tab = 'settings' | 'access'
const emptyOptions: ApiDepartmentOptions = { departments: [], staff: [], slas: [], schedules: [], emails: [], templates: [], roles: [] }
const selectClass = inputClass

export function AdminDepartmentsPage() {
  const [options, setOptions] = useState(emptyOptions)
  const [editing, setEditing] = useState<ApiDepartment | 'new' | null>(null)
  const [tab, setTab] = useState<Tab>('settings')
  const [members, setMembers] = useState<ApiDepartmentMember[]>([])
  const [addStaff, setAddStaff] = useState('')
  const [addRole, setAddRole] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const token = accountSessionToken()

  async function reload() {
    if (!token) throw new Error('Administrator session expired. Sign in again.')
    const result = await listApiDepartments(token)
    setOptions(result)
  }
  useEffect(() => {
    let live = true
    if (!token) { setError('Administrator session expired. Sign in again.'); setLoading(false); return }
    void listApiDepartments(token).then(result => { if (live) setOptions(result) }).catch(reason => { if (live) setError(reason instanceof Error ? reason.message : 'Could not load departments.') }).finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [])

  function open(department: ApiDepartment | 'new') {
    setEditing(department); setTab('settings'); setError('')
    setMembers(department === 'new' ? [] : department.extendedMembers || [])
    setAddStaff(''); setAddRole(options.roles[0]?.id || '')
  }
  function addMember() {
    const agent = options.staff.find(s => s.id === addStaff)
    if (!agent || !addRole || members.some(m => m.id === agent.id) || (editing && editing !== 'new' && agent.departmentId === editing.id)) return
    setMembers(current => [...current, { id: agent.id, name: agent.name, primary: false, roleId: addRole, alerts: true }])
    setAddStaff('')
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!editing) return
    const form = new FormData(event.currentTarget)
    const data: Partial<ApiDepartment> & { name: string } = {
      name: String(form.get('name') || '').trim(), parentId: String(form.get('parentId') || ''),
      status: String(form.get('status') || 'active') as ApiDepartment['status'],
      type: String(form.get('type') || 'public') as ApiDepartment['type'], signature: String(form.get('signature') || ''),
      slaId: String(form.get('slaId') || '0'), scheduleId: String(form.get('scheduleId') || '0'), managerId: String(form.get('managerId') || '0'),
      emailId: String(form.get('emailId') || '0'), templateId: String(form.get('templateId') || '0'), autoresponderEmailId: String(form.get('autoresponderEmailId') || '0'),
      assignment: String(form.get('assignment') || 'all') as ApiDepartment['assignment'],
      disableAutoClaim: form.get('disableAutoClaim') === 'on', disableReopenAutoAssign: form.get('disableReopenAutoAssign') === 'on',
      alertRecipients: Number(form.get('alertRecipients') || 0), ticketAutoResponse: form.get('ticketAutoResponse') === 'on',
      messageAutoResponse: form.get('messageAutoResponse') === 'on', extendedMembers: members,
    }
    if (!data.name) { setError('Department name is required.'); setTab('settings'); return }
    if (data.type === 'private' && !options.departments.some(d => d.id !== (editing === 'new' ? '' : editing.id) && d.type === 'public')) { setError('At least one department must remain public.'); return }
    setSaving(true); setError('')
    try {
      if (!token) throw new Error('Administrator session expired. Sign in again.')
      if (editing !== 'new' && editing.type === 'public' && data.type === 'private' && !options.departments.some(d => d.id !== editing.id && d.type === 'public')) throw new Error('At least one department must remain public.')
      if (data.parentId === (editing === 'new' ? '' : editing.id)) throw new Error('A department cannot be its own parent.')
      const saved = editing === 'new'
        ? (await createApiDepartment(data, token)).department
        : (await updateApiDepartment({ ...editing, ...data, id: editing.id } as ApiDepartment, token)).department
      upsertRecord('departments', { id: saved.id, name: saved.name, active: saved.status === 'active' })
      await reload()
      setEditing(null)
      setError('')
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not save the department.') }
    finally { setSaving(false) }
  }
  async function remove(id: string) {
    if (!token || !window.confirm('Delete this department? Departments used by tickets or staff may not be removable.')) return
    setSaving(true); setError('')
    try { await deleteApiDepartment(id, token); removeRecord('departments', id); await reload() }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not delete the department.') }
    finally { setSaving(false) }
  }

  const parentChoices = useMemo(() => options.departments.filter(d => d.status === 'active' && (editing === 'new' || !editing || d.id !== editing.id)), [options.departments, editing])
  const initial = editing === 'new' ? undefined : editing
  const availableStaff = options.staff.filter(s => !members.some(m => m.id === s.id) && (editing === 'new' || !editing || s.departmentId !== editing.id))
  const optionsFor = (items: Array<{id:string;name:string}>, none = 'System Default') => <><option value="0">— {none} —</option>{items.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</>

  return <div>
    <PageHeader title="Departments" subtitle="Route tickets, set department email and response behavior, and control agent access." actions={<button type="button" className={btnPrimary} onClick={() => open('new')}>Add department</button>} />
    {error && !editing ? <p role="alert" className="mb-4 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</p> : null}
    {editing ? <Card className="mb-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><h2 className="font-semibold">{editing === 'new' ? 'Add department' : `Edit ${editing.name}`}</h2><div className="flex gap-2">{(['settings','access'] as Tab[]).map(t => <button type="button" key={t} onClick={() => setTab(t)} className={`rounded-full px-3 py-1.5 text-sm capitalize ${tab === t ? 'bg-brand-600 text-white' : 'bg-paper text-ink-600'}`}>{t}</button>)}</div></div>
      <form onSubmit={event => void submit(event)}>
        {tab === 'settings' ? <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Parent department"><select name="parentId" defaultValue={initial?.parentId || ''} className={selectClass}><option value="">— Top-level department —</option>{parentChoices.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></Field>
          <Field label="Name"><input name="name" required maxLength={128} defaultValue={initial?.name || ''} className={inputClass} /></Field>
          <Field label="Status"><select name="status" defaultValue={initial?.status || 'active'} className={selectClass}><option value="active">Active</option><option value="disabled">Disabled</option><option value="archived">Archived</option></select></Field>
          <Field label="Type"><select name="type" defaultValue={initial?.type || 'public'} className={selectClass}><option value="public">Public</option><option value="private">Private</option></select></Field>
          <Field label="SLA"><select name="slaId" defaultValue={initial?.slaId || '0'} className={selectClass}>{optionsFor(options.slas)}</select></Field>
          <Field label="Schedule"><select name="scheduleId" defaultValue={initial?.scheduleId || '0'} className={selectClass}>{optionsFor(options.schedules, "SLA's Default")}</select></Field>
          <Field label="Manager"><select name="managerId" defaultValue={initial?.managerId || '0'} className={selectClass}>{optionsFor(options.staff)}</select></Field>
          <Field label="Ticket assignment"><select name="assignment" defaultValue={initial?.assignment || 'all'} className={selectClass}><option value="all">All agents</option><option value="members">Department members</option><option value="primary">Primary members</option></select></Field>
          <Field label="Outgoing email"><select name="emailId" defaultValue={initial?.emailId || '0'} className={selectClass}>{optionsFor(options.emails)}</select></Field>
          <Field label="Template set"><select name="templateId" defaultValue={initial?.templateId || '0'} className={selectClass}>{optionsFor(options.templates)}</select></Field>
          <Field label="New ticket auto-response"><input name="ticketAutoResponse" type="checkbox" defaultChecked={initial?.ticketAutoResponse ?? true} className="h-4 w-4" /> <span className="ml-2 text-sm">Enable for this department</span></Field>
          <Field label="New message auto-response"><input name="messageAutoResponse" type="checkbox" defaultChecked={initial?.messageAutoResponse ?? true} className="h-4 w-4" /> <span className="ml-2 text-sm">Enable for this department</span></Field>
          <Field label="Auto-response email"><select name="autoresponderEmailId" defaultValue={initial?.autoresponderEmailId || '0'} className={selectClass}><option value="0">— Department email —</option>{options.emails.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}</select></Field>
          <Field label="Alerts and notices recipients"><select name="alertRecipients" defaultValue={String(initial?.alertRecipients ?? 1)} className={selectClass}><option value="2">No one (disable alerts)</option><option value="3">Admin email only</option><option value="0">Department members only</option><option value="1">Department and extended access members</option></select></Field>
          <Field label="Disable auto-claim on response"><input name="disableAutoClaim" type="checkbox" defaultChecked={initial?.disableAutoClaim} className="h-4 w-4" /></Field>
          <Field label="Disable auto-assignment on reopen"><input name="disableReopenAutoAssign" type="checkbox" defaultChecked={initial?.disableReopenAutoAssign} className="h-4 w-4" /></Field>
          <Field label="Department signature" className="sm:col-span-2"><textarea name="signature" rows={4} defaultValue={initial?.signature || ''} className={inputClass} /></Field>
        </div> : <div className="space-y-4">
          {initial?.primaryMembers?.length ? <section><h3 className="mb-2 text-sm font-semibold">Primary members</h3><ul className="divide-y divide-line rounded-lg border border-line">{initial.primaryMembers.map(m => <li key={m.id} className="px-3 py-2 text-sm">{m.name} <span className="text-ink-500">(primary)</span></li>)}</ul></section> : <p className="text-sm text-ink-500">No primary members are assigned.</p>}
          <section><h3 className="mb-2 text-sm font-semibold">Extended access members</h3><div className="flex flex-wrap gap-2"><select aria-label="Agent" value={addStaff} onChange={e => setAddStaff(e.target.value)} className={selectClass}><option value="">Select agent</option>{availableStaff.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select><select aria-label="Role" value={addRole} onChange={e => setAddRole(e.target.value)} className={selectClass}><option value="">Select role</option>{options.roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select><button type="button" onClick={addMember} className={btnGhost}>Add agent</button></div>
            {members.length ? <ul className="mt-3 divide-y divide-line rounded-lg border border-line">{members.map(m => <li key={m.id} className="flex flex-wrap items-center justify-between gap-3 px-3 py-2"><span className="text-sm">{m.name}</span><div className="flex items-center gap-3"><select aria-label={`Role for ${m.name}`} value={m.roleId} onChange={e => setMembers(list => list.map(x => x.id === m.id ? {...x, roleId: e.target.value} : x))} className={selectClass}>{options.roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select><label className="flex items-center gap-1 text-sm"><input type="checkbox" checked={m.alerts} onChange={e => setMembers(list => list.map(x => x.id === m.id ? {...x, alerts: e.target.checked} : x))} /> Alerts</label><button type="button" aria-label={`Remove ${m.name}`} className="text-rose-600" onClick={() => setMembers(list => list.filter(x => x.id !== m.id))}>Remove</button></div></li>)}</ul> : <p className="mt-3 text-sm text-ink-500">No agents have extended access.</p>}</section>
        </div>}
        {error ? <p role="alert" className="mt-4 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</p> : null}
        <div className="mt-5 flex flex-wrap gap-2"><button type="submit" disabled={saving} className={btnPrimary}>{saving ? 'Saving…' : editing === 'new' ? 'Create department' : 'Save changes'}</button><button type="button" disabled={saving} className={btnGhost} onClick={() => setEditing(null)}>Cancel</button></div>
      </form>
    </Card> : null}
    {loading ? <p className="text-sm text-ink-500">Loading departments…</p> : <ul className="grid gap-3 lg:grid-cols-2">{options.departments.map(d => <li key={d.id}><Card><div className="flex items-start justify-between gap-3"><div className="min-w-0"><h2 className="font-semibold">{d.name} <span className="ml-1 rounded-full bg-paper px-2 py-0.5 text-xs font-normal capitalize text-ink-600">{d.status}</span></h2><p className="mt-1 text-sm text-ink-600">{d.parentName ? `${d.parentName} › ` : ''}{d.type} · {d.primaryMembers.length} primary · {d.extendedMembers.length} extended</p><p className="mt-1 text-xs text-ink-500">Manager: {d.managerName || 'None'} · SLA: {d.slaName || 'System default'} · Schedule: {d.scheduleName || "SLA's default"}</p><p className="mt-1 text-xs text-ink-500">Email: {d.emailName || 'System default'} · Template: {d.templateName || 'System default'}</p></div><div className="flex shrink-0 gap-3"><button type="button" disabled={saving} className="text-brand-700" onClick={() => open(d)}>Edit</button><button type="button" disabled={saving} className="text-rose-600" onClick={() => void remove(d.id)}>Delete</button></div></div></Card></li>)}{options.departments.length === 0 ? <li><Card>No departments have been created.</Card></li> : null}</ul>}
  </div>
}
