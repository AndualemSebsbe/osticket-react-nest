import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { btnGhost, btnPrimary, Card, Field, inputClass, PageHeader } from '../../components/ui'
import { formatDate } from '../../lib/format'
import { accountSessionToken } from '../../lib/store'
import {
  createApiRole,
  deleteApiRole,
  listApiRoles,
  massApiRoleAction,
  updateApiRole,
  type ApiRole,
  type ApiRolePermissionGroup,
} from '../../lib/api'

type Tab = 'definition' | 'permissions'
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

function selectedGroupCount(group: ApiRolePermissionGroup, selected: string[]) {
  const keys = new Set(group.permissions.map(permission => permission.key))
  return selected.filter(key => keys.has(key)).length
}

export function AdminRolesPage() {
  const [roles, setRoles] = useState<ApiRole[]>([])
  const [permissionGroups, setPermissionGroups] = useState<ApiRolePermissionGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const [editing, setEditing] = useState<ApiRole | 'new' | null>(null)
  const [tab, setTab] = useState<Tab>('definition')
  const [name, setName] = useState('')
  const [notes, setNotes] = useState('')
  const [enabled, setEnabled] = useState(true)
  const [selectedPermissions, setSelectedPermissions] = useState<string[]>([])

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [selectedIds, setSelectedIds] = useState<string[]>([])

  const token = accountSessionToken()

  async function reload() {
    if (!token) throw new Error('Administrator session expired. Sign in again.')
    const result = await listApiRoles(token)
    setRoles(result.roles)
    setPermissionGroups(result.permissionGroups)
  }

  useEffect(() => {
    let live = true
    if (!token) {
      setError('Administrator session expired. Sign in again.')
      setLoading(false)
      return
    }
    void listApiRoles(token)
      .then(result => {
        if (!live) return
        setRoles(result.roles)
        setPermissionGroups(result.permissionGroups)
      })
      .catch(reason => {
        if (live) setError(reason instanceof Error ? reason.message : 'Could not load roles.')
      })
      .finally(() => {
        if (live) setLoading(false)
      })
    return () => { live = false }
  }, [])

  function open(role: ApiRole | 'new') {
    setEditing(role)
    setTab('definition')
    setError('')
    setSuccess('')
    if (role === 'new') {
      setName('')
      setNotes('')
      setEnabled(true)
      setSelectedPermissions([])
    } else {
      setName(role.name)
      setNotes(role.notes)
      setEnabled(role.enabled)
      setSelectedPermissions([...role.permissions])
    }
  }

  function closeEditor() {
    setEditing(null)
    setTab('definition')
    setError('')
  }

  function togglePermission(key: string) {
    setSelectedPermissions(current => current.includes(key)
      ? current.filter(item => item !== key)
      : [...current, key])
  }

  function toggleGroup(group: ApiRolePermissionGroup) {
    const keys = group.permissions.map(permission => permission.key)
    const allSelected = selectedGroupCount(group, selectedPermissions) === group.permissions.length
    setSelectedPermissions(current => allSelected
      ? current.filter(key => !keys.includes(key))
      : Array.from(new Set([...current, ...keys])))
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!editing) return

    const trimmedName = name.trim()
    if (!trimmedName) {
      setError('Role name is required.')
      setTab('definition')
      return
    }
    if (!selectedPermissions.length) {
      setError('Select at least one permission for the role.')
      setTab('permissions')
      return
    }

    setSaving(true)
    setError('')
    setSuccess('')
    try {
      if (!token) throw new Error('Administrator session expired. Sign in again.')
      const payload = { name: trimmedName, notes, enabled, permissions: selectedPermissions }
      if (editing === 'new') {
        await createApiRole(payload, token)
        setSuccess(`Role “${trimmedName}” created.`)
      } else {
        await updateApiRole(editing.id, payload, token)
        setSuccess(`Role “${trimmedName}” updated.`)
      }
      await reload()
      setEditing(null)
      setTab('definition')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not save the role.')
    } finally {
      setSaving(false)
    }
  }

  async function remove(role: ApiRole) {
    if (!token) {
      setError('Administrator session expired. Sign in again.')
      return
    }
    if (!window.confirm(`Delete “${role.name}”? Roles assigned to agents cannot be deleted.`)) return
    setSaving(true)
    setError('')
    setSuccess('')
    try {
      await deleteApiRole(role.id, token)
      setSuccess(`Role “${role.name}” deleted.`)
      setSelectedIds(current => current.filter(id => id !== role.id))
      if (editing !== 'new' && editing?.id === role.id) setEditing(null)
      await reload()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not delete the role.')
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
      setError('Select at least one role.')
      return
    }
    if (action === 'delete' && !window.confirm(`Delete ${selectedIds.length} selected ${selectedIds.length === 1 ? 'role' : 'roles'}? Roles assigned to agents will be skipped.`)) return

    setSaving(true)
    setError('')
    setSuccess('')
    try {
      const result = await massApiRoleAction(action, selectedIds, token)
      if (action === 'delete') {
        const skipped = result.skipped || 0
        setSuccess(`Deleted ${result.deleted || 0} ${result.deleted === 1 ? 'role' : 'roles'}.${skipped ? ` ${skipped} could not be deleted because ${skipped === 1 ? 'it is' : 'they are'} assigned to agents.` : ''}`)
        if (editing !== 'new' && editing && selectedIds.includes(editing.id)) setEditing(null)
      } else {
        setSuccess(`${action === 'enable' ? 'Enabled' : 'Disabled'} ${result.updated || 0} ${result.updated === 1 ? 'role' : 'roles'}.`)
      }
      setSelectedIds([])
      await reload()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not update the selected roles.')
    } finally {
      setSaving(false)
    }
  }

  const permissionTitles = useMemo(() => {
    const map = new Map<string, string>()
    for (const group of permissionGroups) {
      for (const permission of group.permissions) map.set(permission.key, permission.title)
    }
    return map
  }, [permissionGroups])

  const visibleRoles = useMemo(() => {
    const query = search.trim().toLowerCase()
    return roles.filter(role => {
      if (statusFilter === 'active' && !role.enabled) return false
      if (statusFilter === 'disabled' && role.enabled) return false
      if (query && !role.name.toLowerCase().includes(query)) return false
      return true
    })
  }, [roles, search, statusFilter])

  const visibleIds = visibleRoles.map(role => role.id)
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every(id => selectedIds.includes(id))

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

  const activeCount = roles.filter(role => role.enabled).length
  const selectedRole = editing === 'new' ? undefined : editing
  const selectedPermissionCount = selectedPermissions.length

  return (
    <div>
      <PageHeader
        title="Roles"
        subtitle="Roles define the permissions agents receive for the departments they can access."
        actions={<button type="button" className={btnPrimary} onClick={() => open('new')}>Add role</button>}
      />

      {success ? <p role="status" className="mb-4 rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{success}</p> : null}
      {error && !editing ? <p role="alert" className="mb-4 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</p> : null}

      {editing ? (
        <Card className="mb-6">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-semibold">{editing === 'new' ? 'Add new role' : `Update ${editing.name}`}</h2>
              <p className="mt-1 text-xs text-ink-500">
                {editing === 'new'
                  ? 'Create a permission set and assign it to agents or department access.'
                  : `Role #${editing.id} · ${editing.primaryAgentCount + editing.deptAccessCount} assignment${editing.primaryAgentCount + editing.deptAccessCount === 1 ? '' : 's'}`}
              </p>
            </div>
            <div role="tablist" aria-label="Role settings" className="flex gap-2">
              {(['definition', 'permissions'] as Tab[]).map(value => (
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
            <div className={tab === 'definition' ? 'space-y-5' : 'hidden'}>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Name">
                  <input
                    value={name}
                    onChange={event => setName(event.target.value)}
                    required
                    maxLength={64}
                    autoFocus
                    className={inputClass}
                    placeholder="e.g. Support agent"
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
                      <span className="mt-0.5 block text-xs text-ink-500">Disabled roles remain assigned but cannot be used by agents.</span>
                    </span>
                  </label>
                </Field>
              </div>

              <Field label="Internal notes">
                <textarea
                  value={notes}
                  onChange={event => setNotes(event.target.value)}
                  rows={5}
                  className={inputClass}
                  placeholder="Optional notes about what this role is for."
                />
              </Field>

              <div className="rounded-xl border border-line bg-paper px-4 py-3 text-sm text-ink-600">
                Permissions apply to every department where an agent uses this role. A role can be assigned as an agent’s
                primary role or as the role for extended department access.
              </div>
            </div>

            <div className={tab === 'permissions' ? 'space-y-4' : 'hidden'}>
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-paper px-4 py-3">
                <p className="text-sm text-ink-600">
                  <span className="font-semibold text-ink-800">{selectedPermissionCount}</span>{' '}
                  {selectedPermissionCount === 1 ? 'permission' : 'permissions'} selected
                </p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="text-sm font-medium text-brand-700 disabled:opacity-50"
                    disabled={permissionGroups.every(group => selectedGroupCount(group, selectedPermissions) === group.permissions.length)}
                    onClick={() => setSelectedPermissions(permissionGroups.flatMap(group => group.permissions.map(permission => permission.key)))}
                  >
                    Select all
                  </button>
                  <button
                    type="button"
                    className="text-sm font-medium text-rose-600 disabled:opacity-50"
                    disabled={!selectedPermissionCount}
                    onClick={() => setSelectedPermissions([])}
                  >
                    Clear all
                  </button>
                </div>
              </div>

              {permissionGroups.map(group => {
                const groupSelected = selectedGroupCount(group, selectedPermissions)
                const allGroupSelected = groupSelected === group.permissions.length
                return (
                  <section key={group.id} className="overflow-hidden rounded-xl border border-line">
                    <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-paper px-4 py-3">
                      <div>
                        <h3 className="text-sm font-semibold text-ink-800">{group.label}</h3>
                        <p className="text-xs text-ink-500">{groupSelected} of {group.permissions.length} selected</p>
                      </div>
                      <button type="button" className="text-sm font-medium text-brand-700" onClick={() => toggleGroup(group)}>
                        {allGroupSelected ? 'Clear all' : 'Select all'}
                      </button>
                    </header>
                    <div className="grid gap-2 p-4 sm:grid-cols-2">
                      {group.permissions.map(permission => (
                        <label
                          key={permission.key}
                          className="flex gap-3 rounded-lg border border-line px-3 py-2 text-sm hover:bg-paper"
                        >
                          <input
                            type="checkbox"
                            checked={selectedPermissions.includes(permission.key)}
                            onChange={() => togglePermission(permission.key)}
                            className="mt-0.5 h-4 w-4 shrink-0 rounded border-line"
                          />
                          <span className="min-w-0">
                            <span className="font-medium text-ink-800">{permission.title}</span>
                            <span className="mt-0.5 block text-xs text-ink-500">{permission.description}</span>
                          </span>
                        </label>
                      ))}
                    </div>
                  </section>
                )
              })}

              {!selectedPermissionCount ? (
                <p role="alert" className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800">
                  Select at least one permission before saving the role.
                </p>
              ) : null}
            </div>

            {error ? <p role="alert" className="mt-4 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</p> : null}

            <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-line pt-4">
              <button type="submit" disabled={saving} className={btnPrimary}>
                {saving ? 'Saving…' : editing === 'new' ? 'Create role' : 'Save changes'}
              </button>
              <button type="button" disabled={saving} className={btnGhost} onClick={closeEditor}>Cancel</button>
              {selectedRole ? (
                <button
                  type="button"
                  disabled={saving}
                  className="ml-auto text-sm font-medium text-rose-600 disabled:opacity-50"
                  onClick={() => void remove(selectedRole)}
                >
                  Delete role
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
                placeholder="Filter by role name"
              />
            </Field>
            <Field label="Status">
              <select value={statusFilter} onChange={event => setStatusFilter(event.target.value as StatusFilter)} className={`${inputClass} sm:w-40`}>
                <option value="all">All roles</option>
                <option value="active">Active</option>
                <option value="disabled">Disabled</option>
              </select>
            </Field>
          </div>
          <p className="text-sm text-ink-500">
            {roles.length} {roles.length === 1 ? 'role' : 'roles'} · {activeCount} active
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
        <p className="text-sm text-ink-500">Loading roles…</p>
      ) : visibleRoles.length === 0 ? (
        <Card>
          <p className="text-sm text-ink-600">
            {roles.length === 0
              ? 'No roles have been created. Add the first role to start granting agent permissions.'
              : 'No roles match the current filters.'}
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
                        aria-label="Select all visible roles"
                        checked={allVisibleSelected}
                        onChange={toggleAllVisible}
                        className="h-4 w-4 rounded border-line"
                      />
                    </th>
                    <th className="px-4 py-3 font-medium">Name</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium">Permissions</th>
                    <th className="px-4 py-3 font-medium">Assigned</th>
                    <th className="px-4 py-3 font-medium">Created</th>
                    <th className="px-4 py-3 font-medium">Last Updated</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {visibleRoles.map(role => (
                    <tr key={role.id} className="border-t border-line align-top">
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          aria-label={`Select ${role.name}`}
                          checked={selectedIds.includes(role.id)}
                          onChange={() => toggleSelected(role.id)}
                          className="h-4 w-4 rounded border-line"
                        />
                      </td>
                      <td className="max-w-xs px-4 py-3">
                        <button type="button" onClick={() => open(role)} className="text-left font-semibold text-brand-700 hover:underline">
                          {role.name}
                        </button>
                        {role.notes ? <p className="mt-1 line-clamp-2 text-xs text-ink-500">{role.notes}</p> : null}
                      </td>
                      <td className="px-4 py-3"><StatusBadge enabled={role.enabled} /></td>
                      <td className="max-w-xs px-4 py-3">
                        <p className="font-medium text-ink-700">{role.permissionCount} {role.permissionCount === 1 ? 'permission' : 'permissions'}</p>
                        <p className="mt-1 text-xs text-ink-500">
                          {role.permissions.slice(0, 4).map(key => permissionTitles.get(key) || key).join(', ')}
                          {role.permissionCount > 4 ? ` +${role.permissionCount - 4} more` : ''}
                        </p>
                      </td>
                      <td className="max-w-xs px-4 py-3">
                        <p className="text-ink-700">{role.primaryAgentCount} primary · {role.deptAccessCount} extended</p>
                        <p className="mt-1 text-xs text-ink-500">
                          {role.assignedDepartments.length ? role.assignedDepartments.join(', ') : 'No departments'}
                        </p>
                        <p className="mt-0.5 text-xs text-ink-400">
                          {role.assignedAgents.length
                            ? `${role.assignedAgents.slice(0, 3).join(', ')}${role.assignedAgents.length > 3 ? ` +${role.assignedAgents.length - 3} more` : ''}`
                            : 'Unassigned'}
                        </p>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-ink-600">{formatTimestamp(role.created)}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-ink-600">{formatTimestamp(role.updated)}</td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <div className="flex items-center justify-end gap-3">
                          <button type="button" className="text-sm font-medium text-brand-700" onClick={() => open(role)}>Edit</button>
                          {role.canDelete ? (
                            <button type="button" disabled={saving} className="text-sm text-rose-600 disabled:opacity-50" onClick={() => void remove(role)}>Delete</button>
                          ) : (
                            <span className="text-xs text-ink-400">In use</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <ul className="grid gap-3 lg:hidden">
            {visibleRoles.map(role => (
              <li key={role.id}>
                <Card>
                  <div className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      aria-label={`Select ${role.name}`}
                      checked={selectedIds.includes(role.id)}
                      onChange={() => toggleSelected(role.id)}
                      className="mt-1 h-4 w-4 rounded border-line"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <button type="button" onClick={() => open(role)} className="text-left font-semibold text-brand-700 hover:underline">{role.name}</button>
                        <StatusBadge enabled={role.enabled} />
                      </div>
                      {role.notes ? <p className="mt-1 text-xs text-ink-500">{role.notes}</p> : null}
                      <p className="mt-2 text-sm text-ink-600">
                        {role.permissionCount} {role.permissionCount === 1 ? 'permission' : 'permissions'} · {role.primaryAgentCount} primary · {role.deptAccessCount} extended
                      </p>
                      <p className="mt-1 text-xs text-ink-500">
                        Departments: {role.assignedDepartments.length ? role.assignedDepartments.join(', ') : 'None'}
                      </p>
                      <p className="mt-0.5 text-xs text-ink-400">
                        Agents: {role.assignedAgents.length ? role.assignedAgents.join(', ') : 'Unassigned'}
                      </p>
                      <p className="mt-1 text-xs text-ink-400">
                        Created {formatTimestamp(role.created)} · Updated {formatTimestamp(role.updated)}
                      </p>
                      <div className="mt-3 flex flex-wrap items-center gap-3">
                        <button type="button" className="text-sm font-medium text-brand-700" onClick={() => open(role)}>Edit</button>
                        {role.canDelete ? (
                          <button type="button" disabled={saving} className="text-sm text-rose-600 disabled:opacity-50" onClick={() => void remove(role)}>Delete</button>
                        ) : (
                          <span className="text-xs text-ink-400">Assigned to agents — cannot delete</span>
                        )}
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
