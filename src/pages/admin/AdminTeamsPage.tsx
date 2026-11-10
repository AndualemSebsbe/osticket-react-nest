import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { btnGhost, btnPrimary, Card, Field, inputClass, PageHeader } from '../../components/ui'
import { useDialogs } from '../../context/DialogContext'
import { formatDate } from '../../lib/format'
import { accountSessionToken } from '../../lib/store'
import {
  createApiTeam,
  deleteApiTeam,
  listApiTeams,
  massApiTeamAction,
  updateApiTeam,
  type ApiTeam,
  type ApiTeamMember,
  type ApiTeamStaffOption,
  type ApiTeamsResponse,
} from '../../lib/api'

type Tab = 'team' | 'members'
type StatusFilter = 'all' | 'active' | 'disabled'
type MassAction = 'enable' | 'disable' | 'delete'

const statusTone = {
  active: 'bg-emerald-50 text-emerald-700',
  disabled: 'bg-amber-50 text-amber-700',
}

function StatusBadge({ enabled }: { enabled: boolean }) {
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${enabled ? statusTone.active : statusTone.disabled}`}>
      {enabled ? 'Active' : 'Disabled'}
    </span>
  )
}

function formatTimestamp(value: string) {
  return value ? formatDate(value) : '—'
}

function toMember(staff: ApiTeamStaffOption, alerts: boolean): ApiTeamMember {
  return {
    staffId: staff.staffId,
    name: staff.name,
    username: staff.username,
    email: staff.email,
    departmentId: staff.departmentId,
    departmentName: staff.departmentName,
    active: staff.active,
    onvacation: staff.onvacation,
    alerts,
  }
}

function usageSummary(team: ApiTeam) {
  const parts: string[] = []
  if (team.ticketCount) parts.push(`${team.ticketCount} ticket${team.ticketCount === 1 ? '' : 's'}`)
  if (team.taskCount) parts.push(`${team.taskCount} task${team.taskCount === 1 ? '' : 's'}`)
  if (team.helpTopicCount) parts.push(`${team.helpTopicCount} topic${team.helpTopicCount === 1 ? '' : 's'}`)
  if (team.filterActionCount) parts.push(`${team.filterActionCount} filter${team.filterActionCount === 1 ? '' : 's'}`)
  return parts.length ? parts.join(' · ') : 'Not in use'
}

export function AdminTeamsPage() {
  const { confirm } = useDialogs()
  const [data, setData] = useState<ApiTeamsResponse>({ teams: [], staff: [] })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const [editing, setEditing] = useState<ApiTeam | 'new' | null>(null)
  const [tab, setTab] = useState<Tab>('team')
  const [name, setName] = useState('')
  const [notes, setNotes] = useState('')
  const [enabled, setEnabled] = useState(true)
  const [disableAlerts, setDisableAlerts] = useState(false)
  const [leadId, setLeadId] = useState('0')
  const [draftMembers, setDraftMembers] = useState<ApiTeamMember[]>([])
  const [addMemberId, setAddMemberId] = useState('')
  const [addMemberAlerts, setAddMemberAlerts] = useState(true)

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [selectedIds, setSelectedIds] = useState<string[]>([])

  const token = accountSessionToken()

  async function reload() {
    if (!token) throw new Error('Administrator session expired. Sign in again.')
    setData(await listApiTeams(token))
  }

  useEffect(() => {
    let live = true
    if (!token) {
      setError('Administrator session expired. Sign in again.')
      setLoading(false)
      return
    }
    void listApiTeams(token)
      .then(result => { if (live) setData(result) })
      .catch(reason => { if (live) setError(reason instanceof Error ? reason.message : 'Could not load teams.') })
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [])

  function open(team: ApiTeam | 'new') {
    setEditing(team)
    setTab('team')
    setError('')
    setSuccess('')
    if (team === 'new') {
      setName('')
      setNotes('')
      setEnabled(true)
      setDisableAlerts(false)
      setLeadId('0')
      setDraftMembers([])
    } else {
      const members = team.members.map(member => ({ ...member }))
      setName(team.name)
      setNotes(team.notes)
      setEnabled(team.enabled)
      setDisableAlerts(team.disableAlerts)
      // The team lead must be a member; legacy data may point at a removed agent.
      setLeadId(members.some(member => member.staffId === team.leadId) ? team.leadId : '0')
      setDraftMembers(members)
    }
    setAddMemberId('')
    setAddMemberAlerts(true)
  }

  function closeEditor() {
    setEditing(null)
    setTab('team')
    setError('')
  }

  function addMember() {
    const staff = data.staff.find(item => item.id === addMemberId)
    if (!staff) {
      setError('Select an agent to add to the team.')
      return
    }
    if (draftMembers.some(member => member.staffId === staff.staffId)) {
      setError('That agent is already a member of this team.')
      return
    }
    setDraftMembers(current => [...current, toMember(staff, addMemberAlerts)])
    setAddMemberId('')
    setAddMemberAlerts(true)
    setError('')
  }

  function removeMember(staffId: string) {
    setDraftMembers(current => current.filter(member => member.staffId !== staffId))
    if (leadId === staffId) setLeadId('0')
  }

  function chooseLead(value: string) {
    setLeadId(value)
    if (value === '0' || draftMembers.some(member => member.staffId === value)) return
    const staff = data.staff.find(item => item.id === value)
    if (staff) setDraftMembers(current => [...current, toMember(staff, true)])
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!editing) return

    const trimmedName = name.trim()
    if (!trimmedName) {
      setError('Team name is required.')
      setTab('team')
      return
    }

    setSaving(true)
    setError('')
    setSuccess('')
    try {
      if (!token) throw new Error('Administrator session expired. Sign in again.')
      const payload = {
        name: trimmedName,
        notes,
        enabled,
        disableAlerts,
        leadId,
        members: draftMembers.map(member => ({ staffId: member.staffId, alerts: member.alerts })),
      }
      if (editing === 'new') {
        await createApiTeam(payload, token)
        setSuccess(`Team “${trimmedName}” created.`)
      } else {
        await updateApiTeam(editing.id, payload, token)
        setSuccess(`Team “${trimmedName}” updated.`)
      }
      await reload()
      setEditing(null)
      setTab('team')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not save the team.')
    } finally {
      setSaving(false)
    }
  }

  async function remove(team: ApiTeam) {
    if (!token) {
      setError('Administrator session expired. Sign in again.')
      return
    }
    if (!(await confirm({
      title: 'Delete team',
      description: `Delete “${team.name}”? Its members will be removed and tickets, tasks, help topics, and filter actions assigned to this team will be unassigned.`,
      confirmLabel: 'Delete',
    }))) return
    setSaving(true)
    setError('')
    setSuccess('')
    try {
      await deleteApiTeam(team.id, token)
      setSuccess(`Team “${team.name}” deleted.`)
      setSelectedIds(current => current.filter(id => id !== team.id))
      await reload()
      if (editing !== 'new' && editing?.id === team.id) setEditing(null)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not delete the team.')
    } finally {
      setSaving(false)
    }
  }

  async function runMassAction(action: MassAction) {
    if (!token) {
      setError('Administrator session expired. Sign in again.')
      return
    }
    if (!selectedIds.length) {
      setError('Select at least one team.')
      return
    }
    if (action === 'delete' && !(await confirm({
      title: 'Delete teams',
      description: `Delete ${selectedIds.length} selected ${selectedIds.length === 1 ? 'team' : 'teams'}? Their members will be removed and assignments cleared.`,
      confirmLabel: 'Delete',
    }))) return

    setSaving(true)
    setError('')
    setSuccess('')
    try {
      const result = await massApiTeamAction(action, selectedIds, token)
      if (action === 'delete') {
        setSuccess(`Deleted ${result.deleted || 0} ${result.deleted === 1 ? 'team' : 'teams'}.`)
        if (editing !== 'new' && editing && selectedIds.includes(editing.id)) setEditing(null)
      } else {
        setSuccess(`${action === 'enable' ? 'Enabled' : 'Disabled'} ${result.updated || 0} ${result.updated === 1 ? 'team' : 'teams'}.`)
      }
      setSelectedIds([])
      await reload()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not update the selected teams.')
    } finally {
      setSaving(false)
    }
  }

  const visibleTeams = useMemo(() => {
    const query = search.trim().toLowerCase()
    return data.teams.filter(team => {
      if (statusFilter === 'active' && !team.enabled) return false
      if (statusFilter === 'disabled' && team.enabled) return false
      if (!query) return true
      const haystack = [team.name, team.leadName, ...team.members.map(member => member.name)].join(' ').toLowerCase()
      return haystack.includes(query)
    })
  }, [data.teams, search, statusFilter])

  const visibleIds = visibleTeams.map(team => team.id)
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every(id => selectedIds.includes(id))
  const availableStaff = data.staff.filter(staff => !draftMembers.some(member => member.staffId === staff.staffId))
  const selectedTeam = editing === 'new' ? undefined : editing
  const activeCount = data.teams.filter(team => team.enabled).length

  function toggleAllVisible() {
    setSelectedIds(current => allVisibleSelected
      ? current.filter(id => !visibleIds.includes(id))
      : Array.from(new Set([...current, ...visibleIds])))
  }

  function toggleSelected(id: string) {
    setSelectedIds(current => current.includes(id)
      ? current.filter(item => item !== id)
      : [...current, id])
  }

  return (
    <div>
      <PageHeader
        title="Teams"
        subtitle="Teams group agents for ticket and task assignment. Assignment alerts notify teams when work is assigned to them."
        actions={<button type="button" className={btnPrimary} onClick={() => open('new')}>Add team</button>}
      />

      {success ? <p role="status" className="mb-4 rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{success}</p> : null}
      {error && !editing ? <p role="alert" className="mb-4 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</p> : null}

      {editing ? (
        <Card className="mb-6">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-semibold">{editing === 'new' ? 'Add new team' : `Update ${editing.name}`}</h2>
              <p className="mt-1 text-xs text-ink-500">
                {editing === 'new'
                  ? 'Create a group of agents that can be assigned tickets, tasks, and help topics.'
                  : `Team #${editing.id} · ${editing.memberCount} ${editing.memberCount === 1 ? 'member' : 'members'}`}
              </p>
            </div>
            <div role="tablist" aria-label="Team settings" className="flex gap-2">
              {(['team', 'members'] as Tab[]).map(value => (
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

          <form onSubmit={event => void submit(event)}>
            <div className={tab === 'team' ? 'space-y-5' : 'hidden'}>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Name">
                  <input
                    value={name}
                    onChange={event => setName(event.target.value)}
                    required
                    maxLength={125}
                    autoFocus
                    className={inputClass}
                    placeholder="e.g. Tier 2 support"
                  />
                </Field>

                <Field label="Status">
                  <label className="flex items-start gap-2 rounded-xl border border-line bg-paper px-3 py-2.5 text-sm font-normal">
                    <input
                      type="checkbox"
                      checked={enabled}
                      onChange={event => setEnabled(event.target.checked)}
                      className="mt-0.5 h-4 w-4 rounded border-line"
                    />
                    <span>
                      <strong>Active</strong>
                      <span className="mt-0.5 block text-xs text-ink-500">Disabled teams remain configured but cannot receive new assignments.</span>
                    </span>
                  </label>
                </Field>

                <Field label="Team lead">
                  <select value={leadId} onChange={event => chooseLead(event.target.value)} className={inputClass}>
                    <option value="0">— None —</option>
                    {data.staff.map(staff => (
                      <option key={staff.id} value={staff.id}>
                        {staff.name}{staff.active ? '' : ' (inactive)'}{staff.onvacation ? ' (on vacation)' : ''}
                      </option>
                    ))}
                  </select>
                  <span className="mt-1 block text-xs font-normal text-ink-500">Selecting an agent who is not yet a member adds them to the team with alerts enabled.</span>
                </Field>

                <Field label="Assignment alerts">
                  <label className="flex items-start gap-2 rounded-xl border border-line bg-paper px-3 py-2.5 text-sm font-normal">
                    <input
                      type="checkbox"
                      checked={disableAlerts}
                      onChange={event => setDisableAlerts(event.target.checked)}
                      className="mt-0.5 h-4 w-4 rounded border-line"
                    />
                    <span>
                      <strong>Disable</strong> assignment alerts for this team
                      <span className="mt-0.5 block text-xs text-ink-500">Team members with alerts enabled will not be notified when work is assigned.</span>
                    </span>
                  </label>
                </Field>
              </div>

              <Field label="Admin notes">
                <textarea
                  value={notes}
                  onChange={event => setNotes(event.target.value)}
                  rows={5}
                  className={inputClass}
                  placeholder="Internal notes about this team, viewable by administrators."
                />
              </Field>

              {selectedTeam ? (
                <div className="rounded-xl border border-line bg-paper px-4 py-3 text-sm text-ink-600">
                  <p className="font-semibold text-ink-800">Usage</p>
                  <p className="mt-1">{usageSummary(selectedTeam)}</p>
                  {selectedTeam.helpTopicNames.length ? (
                    <p className="mt-1 text-xs text-ink-500">Help topics: {selectedTeam.helpTopicNames.join(', ')}{selectedTeam.helpTopicCount > selectedTeam.helpTopicNames.length ? '…' : ''}</p>
                  ) : null}
                  <p className="mt-1 text-xs text-ink-500">Deleting this team removes its member list and unassigns its tickets, tasks, help topics, and ticket filter actions.</p>
                </div>
              ) : null}
            </div>

            <div className={tab === 'members' ? 'space-y-4' : 'hidden'}>
              <div className="flex flex-wrap items-end gap-3 rounded-xl border border-line bg-paper px-4 py-3">
                <Field label="Add agent" className="min-w-48 flex-1">
                  <select value={addMemberId} onChange={event => setAddMemberId(event.target.value)} className={inputClass}>
                    <option value="">— Select agent —</option>
                    {availableStaff.map(staff => (
                      <option key={staff.id} value={staff.id}>
                        {staff.name}{staff.departmentName ? ` · ${staff.departmentName}` : ''}{staff.active ? '' : ' (inactive)'}
                      </option>
                    ))}
                  </select>
                </Field>
                <label className="flex items-center gap-2 pb-2 text-sm">
                  <input type="checkbox" checked={addMemberAlerts} onChange={event => setAddMemberAlerts(event.target.checked)} className="h-4 w-4" />
                  Alerts
                </label>
                <button type="button" className={btnGhost} disabled={!addMemberId} onClick={addMember}>Add member</button>
              </div>

              {draftMembers.length ? (
                <ul className="divide-y divide-line rounded-xl border border-line">
                  {draftMembers.map(member => (
                    <li key={member.staffId} className="flex flex-col gap-2 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <p className="text-sm font-medium">
                          {member.name}
                          {member.staffId === leadId ? <span className="ml-2 rounded-full bg-brand-50 px-2 py-0.5 text-xs font-semibold text-brand-700">Team lead</span> : null}
                          {!member.active ? <span className="ml-2 text-xs text-ink-400">inactive</span> : null}
                          {member.onvacation ? <span className="ml-2 text-xs text-ink-400">on vacation</span> : null}
                        </p>
                        <p className="text-xs text-ink-500">{member.email || member.username}{member.departmentName ? ` · ${member.departmentName}` : ''}</p>
                      </div>
                      <div className="flex items-center gap-3">
                        <label className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={member.alerts}
                            onChange={event => setDraftMembers(current => current.map(item => item.staffId === member.staffId ? { ...item, alerts: event.target.checked } : item))}
                            className="h-4 w-4"
                          />
                          Alerts
                        </label>
                        <button type="button" className="text-sm text-rose-600" onClick={() => removeMember(member.staffId)}>Remove</button>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="rounded-xl border border-dashed border-line px-4 py-6 text-sm text-ink-500">
                  This team has no members. Add agents to make the team available for assignment.
                </p>
              )}
            </div>

            {error ? <p role="alert" className="mt-4 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</p> : null}

            <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-line pt-4">
              <button type="submit" disabled={saving} className={btnPrimary}>
                {saving ? 'Saving…' : editing === 'new' ? 'Create team' : 'Save changes'}
              </button>
              <button type="button" disabled={saving} className={btnGhost} onClick={closeEditor}>Cancel</button>
              {selectedTeam ? (
                <button
                  type="button"
                  disabled={saving}
                  className="ml-auto text-sm font-medium text-rose-600 disabled:opacity-50"
                  onClick={() => void remove(selectedTeam)}
                >
                  Delete team
                </button>
              ) : null}
            </div>
          </form>
        </Card>
      ) : null}

      <Card className="mb-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <Field label="Search">
              <input
                value={search}
                onChange={event => setSearch(event.target.value)}
                className={`${inputClass} sm:w-64`}
                placeholder="Filter by team, lead, or member"
              />
            </Field>
            <Field label="Status">
              <select value={statusFilter} onChange={event => setStatusFilter(event.target.value as StatusFilter)} className={`${inputClass} sm:w-40`}>
                <option value="all">All teams</option>
                <option value="active">Active</option>
                <option value="disabled">Disabled</option>
              </select>
            </Field>
          </div>
          <p className="text-sm text-ink-500">
            {data.teams.length} {data.teams.length === 1 ? 'team' : 'teams'} · {activeCount} active
          </p>
        </div>

        {selectedIds.length ? (
          <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-brand-100 bg-brand-50 px-3 py-2">
            <p className="text-sm font-medium text-brand-800">{selectedIds.length} selected</p>
            <button type="button" disabled={saving} className="text-sm font-medium text-emerald-700 disabled:opacity-50" onClick={() => void runMassAction('enable')}>Enable</button>
            <button type="button" disabled={saving} className="text-sm font-medium text-amber-700 disabled:opacity-50" onClick={() => void runMassAction('disable')}>Disable</button>
            <button type="button" disabled={saving} className="text-sm font-medium text-rose-600 disabled:opacity-50" onClick={() => void runMassAction('delete')}>Delete</button>
            <button type="button" className="ml-auto text-sm text-ink-500" onClick={() => setSelectedIds([])}>Clear selection</button>
          </div>
        ) : null}
      </Card>

      {loading ? (
        <p className="text-sm text-ink-500">Loading teams…</p>
      ) : visibleTeams.length === 0 ? (
        <Card>
          <p className="text-sm text-ink-600">
            {data.teams.length === 0
              ? 'No teams have been created. Add the first team to start grouping agents for assignment.'
              : 'No teams match the current filters.'}
          </p>
        </Card>
      ) : (
        <>
          <div className="-mx-4 hidden overflow-x-auto px-4 lg:mx-0 lg:block lg:px-0">
            <div className="min-w-full overflow-hidden rounded-2xl border border-line bg-surface">
              <table className="w-full min-w-[64rem] text-left text-sm">
                <thead className="bg-paper text-ink-600">
                  <tr>
                    <th className="w-10 px-4 py-3">
                      <input
                        type="checkbox"
                        aria-label="Select all visible teams"
                        checked={allVisibleSelected}
                        onChange={toggleAllVisible}
                        className="h-4 w-4 rounded border-line"
                      />
                    </th>
                    <th className="px-4 py-3 font-medium">Team</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium">Members</th>
                    <th className="px-4 py-3 font-medium">Team Lead</th>
                    <th className="px-4 py-3 font-medium">Usage</th>
                    <th className="px-4 py-3 font-medium">Created</th>
                    <th className="px-4 py-3 font-medium">Last Updated</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {visibleTeams.map(team => (
                    <tr key={team.id} className="border-t border-line align-top">
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          aria-label={`Select ${team.name}`}
                          checked={selectedIds.includes(team.id)}
                          onChange={() => toggleSelected(team.id)}
                          className="h-4 w-4 rounded border-line"
                        />
                      </td>
                      <td className="max-w-xs px-4 py-3">
                        <button type="button" onClick={() => open(team)} className="text-left font-semibold text-brand-700 hover:underline">
                          {team.name}
                        </button>
                        {team.notes ? <p className="mt-1 line-clamp-2 text-xs text-ink-500">{team.notes}</p> : null}
                      </td>
                      <td className="px-4 py-3"><StatusBadge enabled={team.enabled} /></td>
                      <td className="max-w-xs px-4 py-3">
                        <p className="font-medium text-ink-700">{team.memberCount} {team.memberCount === 1 ? 'member' : 'members'}</p>
                        <p className="mt-1 text-xs text-ink-500">{team.alertMemberCount} with alerts</p>
                        <p className="mt-0.5 text-xs text-ink-400">
                          {team.members.length
                            ? `${team.members.slice(0, 3).map(member => member.name).join(', ')}${team.members.length > 3 ? ` +${team.members.length - 3} more` : ''}`
                            : 'No members'}
                        </p>
                      </td>
                      <td className="px-4 py-3 text-ink-700">{team.leadName || <span className="text-ink-400">None</span>}</td>
                      <td className="max-w-xs px-4 py-3 text-ink-600">{usageSummary(team)}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-ink-600">{formatTimestamp(team.created)}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-ink-600">{formatTimestamp(team.updated)}</td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <div className="flex items-center justify-end gap-3">
                          <button type="button" className="text-sm font-medium text-brand-700" onClick={() => open(team)}>Edit</button>
                          <button type="button" disabled={saving} className="text-sm text-rose-600 disabled:opacity-50" onClick={() => void remove(team)}>Delete</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <ul className="grid gap-3 lg:hidden">
            {visibleTeams.map(team => (
              <li key={team.id}>
                <Card>
                  <div className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      aria-label={`Select ${team.name}`}
                      checked={selectedIds.includes(team.id)}
                      onChange={() => toggleSelected(team.id)}
                      className="mt-1 h-4 w-4 rounded border-line"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <button type="button" onClick={() => open(team)} className="text-left font-semibold text-brand-700 hover:underline">{team.name}</button>
                        <StatusBadge enabled={team.enabled} />
                      </div>
                      {team.notes ? <p className="mt-1 text-xs text-ink-500">{team.notes}</p> : null}
                      <p className="mt-2 text-sm text-ink-600">
                        {team.memberCount} {team.memberCount === 1 ? 'member' : 'members'} · Lead: {team.leadName || 'None'}
                      </p>
                      <p className="mt-1 text-xs text-ink-500">{usageSummary(team)}</p>
                      <p className="mt-1 text-xs text-ink-400">
                        Members: {team.members.length ? team.members.map(member => member.name).join(', ') : 'None'}
                      </p>
                      <p className="mt-1 text-xs text-ink-400">
                        Created {formatTimestamp(team.created)} · Updated {formatTimestamp(team.updated)}
                      </p>
                      <div className="mt-3 flex flex-wrap items-center gap-3">
                        <button type="button" className="text-sm font-medium text-brand-700" onClick={() => open(team)}>Edit</button>
                        <button type="button" disabled={saving} className="text-sm text-rose-600 disabled:opacity-50" onClick={() => void remove(team)}>Delete</button>
                      </div>
                    </div>
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
