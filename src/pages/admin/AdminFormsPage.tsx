import { useEffect, useMemo, useState, type FormEvent } from 'react'
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  Building,
  CheckCircle2,
  CheckSquare,
  Layers,
  Paperclip,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Ticket,
  Trash2,
  User,
  Users,
  X,
} from 'lucide-react'
import { btnGhost, btnPrimary, Card, Field, inputClass, PageHeader } from '../../components/ui'
import { useDialogs } from '../../context/DialogContext'
import { formatDate } from '../../lib/format'
import { accountSessionToken } from '../../lib/store'
import {
  createApiForm,
  deleteApiForm,
  getApiForm,
  listApiForms,
  massApiFormAction,
  updateApiForm,
  type ApiFormDetail,
  type ApiFormDetailResponse,
  type ApiFormEntry,
  type ApiFormField,
  type ApiFormList,
  type ApiFormSummary,
  type ApiRequirementMode,
} from '../../lib/api'

type Tab = 'definition' | 'fields' | 'topics' | 'entries'
type TypeFilter = 'all' | 'builtin' | 'custom'

const REQUIREMENT_MODES: Array<{ key: ApiRequirementMode; label: string; desc: string }> = [
  { key: 'a', label: 'Optional', desc: 'Visible to users and staff, optional' },
  { key: 'b', label: 'Required', desc: 'Mandatory for both users and staff' },
  { key: 'c', label: 'Required for EndUsers', desc: 'Mandatory for users, optional for staff' },
  { key: 'd', label: 'Required for Agents', desc: 'Optional for users, mandatory for staff' },
  { key: 'e', label: 'Internal, Optional', desc: 'Agent-only visibility, optional' },
  { key: 'f', label: 'Internal, Required', desc: 'Agent-only visibility, mandatory' },
  { key: 'g', label: 'For EndUsers Only', desc: 'Client portal only, mandatory' },
]

const FIELD_TYPES = [
  { group: 'Standard Fields', types: [
    { value: 'text', label: 'Short Answer (text)' },
    { value: 'memo', label: 'Long Answer (textarea)' },
    { value: 'datetime', label: 'Date and Time' },
    { value: 'phone', label: 'Phone Number' },
    { value: 'choices', label: 'Choices / Dropdown' },
    { value: 'bool', label: 'Checkbox' },
    { value: 'int', label: 'Number' },
    { value: 'files', label: 'File Upload' },
    { value: 'break', label: 'Section Break' },
    { value: 'info', label: 'Information Notice' },
  ]},
]

function getFormIcon(type: string) {
  switch (type) {
    case 'U': return <User className="size-4 text-sky-600" />
    case 'T': return <Ticket className="size-4 text-emerald-600" />
    case 'C': return <Building className="size-4 text-purple-600" />
    case 'O': return <Users className="size-4 text-indigo-600" />
    case 'A': return <CheckSquare className="size-4 text-amber-600" />
    default: return <Layers className="size-4 text-brand-600" />
  }
}

export function AdminFormsPage() {
  const { confirm } = useDialogs()
  const token = accountSessionToken()

  // List view state
  const [forms, setForms] = useState<ApiFormSummary[]>([])
  const [availableLists, setAvailableLists] = useState<ApiFormList[]>([])
  const [availableTopics, setAvailableTopics] = useState<Array<{ id: string; name: string }>>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all')
  const [selectedIds, setSelectedIds] = useState<string[]>([])

  // Editor state
  const [editingFormId, setEditingFormId] = useState<string | null>(null)
  const [isNew, setIsNew] = useState(false)
  const [activeTab, setActiveTab] = useState<Tab>('definition')

  const [formDetail, setFormDetail] = useState<ApiFormDetail | null>(null)
  const [fieldsDraft, setFieldsDraft] = useState<ApiFormField[]>([])
  const [selectedTopicIds, setSelectedTopicIds] = useState<string[]>([])
  const [recentEntries, setRecentEntries] = useState<ApiFormEntry[]>([])
  const [title, setTitle] = useState('')
  const [instructions, setInstructions] = useState('')
  const [notes, setNotes] = useState('')

  // Config modal for a single field
  const [configuringFieldIdx, setConfiguringFieldIdx] = useState<number | null>(null)

  // 1. Load forms overview
  async function reloadList() {
    try {
      setLoading(true)
      const res = await listApiForms(token)
      setForms(res.forms)
      setAvailableLists(res.lists)
      setAvailableTopics(res.helpTopics)
      setError('')
    } catch (err: any) {
      setError(err?.message || 'Failed to load forms.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void reloadList()
  }, [])

  // 2. Open editor for form or new form
  async function openEditor(id: string | 'new') {
    setError('')
    setSuccess('')
    setActiveTab('definition')
    setConfiguringFieldIdx(null)

    if (id === 'new') {
      setIsNew(true)
      setEditingFormId('new')
      setFormDetail({
        id: 'new',
        title: '',
        instructions: '',
        name: '',
        type: 'G',
        isBuiltIn: false,
        builtInLabel: 'Custom Form',
        icon: 'Layers',
        flags: 1,
        enabled: true,
        deletable: true,
        notes: '',
        entryCount: 0,
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
      })
      setTitle('')
      setInstructions('')
      setNotes('')
      setFieldsDraft([
        {
          label: '',
          name: '',
          type: 'text',
          sort: 1,
          enabled: true,
          visibilityMode: 'a',
          hint: '',
          configuration: {},
          deletable: true,
          nameEditable: true,
          typeEditable: true,
        },
      ])
      setSelectedTopicIds([])
      setRecentEntries([])
      return
    }

    try {
      setSaving(true)
      setIsNew(false)
      setEditingFormId(id)
      const res: ApiFormDetailResponse = await getApiForm(id, token)
      setFormDetail(res.form)
      setTitle(res.form.title)
      setInstructions(res.form.instructions || '')
      setNotes(res.form.notes || '')
      setFieldsDraft(res.fields)
      setSelectedTopicIds(res.helpTopics.map(t => t.topicId))
      setRecentEntries(res.recentEntries || [])
      if (res.lists) setAvailableLists(res.lists)
      if (res.allHelpTopics) setAvailableTopics(res.allHelpTopics)
    } catch (err: any) {
      setError(err?.message || 'Could not load form details.')
      setEditingFormId(null)
    } finally {
      setSaving(false)
    }
  }

  function closeEditor() {
    setEditingFormId(null)
    setFormDetail(null)
    setConfiguringFieldIdx(null)
  }

  // 3. Save Form
  async function handleSave(e: FormEvent) {
    e.preventDefault()
    if (!title.trim()) {
      setError('Form title is required.')
      return
    }

    try {
      setSaving(true)
      setError('')

      const payload = {
        title: title.trim(),
        instructions: instructions.trim() || undefined,
        notes: notes.trim() || undefined,
        fields: fieldsDraft.map((f, idx) => ({
          ...f,
          sort: idx + 1,
          name: (f.name || f.label || `field_${idx + 1}`).toLowerCase().replace(/[^a-z0-9_]/g, '_'),
        })),
        helpTopicIds: selectedTopicIds,
      }

      if (isNew) {
        const created = await createApiForm(payload, token)
        setSuccess(`Custom form "${created.form.title}" created successfully.`)
        await reloadList()
        closeEditor()
      } else if (editingFormId) {
        const updated = await updateApiForm(editingFormId, payload, token)
        setSuccess(`Form "${updated.form.title}" updated successfully.`)
        await reloadList()
        // Refresh local details
        setFormDetail(updated.form)
        setFieldsDraft(updated.fields)
        setSelectedTopicIds(updated.helpTopics.map(t => t.topicId))
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to save form.')
    } finally {
      setSaving(false)
    }
  }

  // 4. Delete Form
  async function handleDelete(id: string, formTitle: string) {
    const ok = await confirm({
      title: 'Delete Custom Form?',
      description: `Are you sure you want to delete form "${formTitle}"? This will remove its field configurations.`,
      confirmLabel: 'Delete Form',
    })
    if (!ok) return

    try {
      setSaving(true)
      await deleteApiForm(id, token)
      setSuccess(`Form "${formTitle}" has been deleted.`)
      if (editingFormId === id) closeEditor()
      await reloadList()
    } catch (err: any) {
      setError(err?.message || 'Failed to delete form.')
    } finally {
      setSaving(false)
    }
  }

  // 5. Mass Delete
  async function handleMassDelete() {
    if (!selectedIds.length) return
    const ok = await confirm({
      title: 'Delete Selected Forms?',
      description: `Are you sure you want to delete ${selectedIds.length} custom forms? Built-in forms cannot be deleted.`,
      confirmLabel: 'Delete Forms',
    })
    if (!ok) return

    try {
      setSaving(true)
      const res = await massApiFormAction('delete', selectedIds, token)
      setSuccess(`Successfully deleted ${res.deleted || 0} form(s).`)
      setSelectedIds([])
      await reloadList()
    } catch (err: any) {
      setError(err?.message || 'Failed to delete forms.')
    } finally {
      setSaving(false)
    }
  }

  // Fields manipulation
  function addField() {
    setFieldsDraft(current => [
      ...current,
      {
        label: '',
        name: '',
        type: 'text',
        sort: current.length + 1,
        enabled: true,
        visibilityMode: 'a',
        hint: '',
        configuration: {},
        deletable: true,
        nameEditable: true,
        typeEditable: true,
      },
    ])
  }

  function removeField(index: number) {
    setFieldsDraft(current => {
      const target = current[index]
      if (target.id) {
        // Mark for deletion if saved
        return current.map((f, i) => i === index ? { ...f, delete: true } : f)
      }
      return current.filter((_, i) => i !== index)
    })
  }

  function moveField(index: number, direction: 'up' | 'down') {
    const targetIndex = direction === 'up' ? index - 1 : index + 1
    if (targetIndex < 0 || targetIndex >= fieldsDraft.length) return

    setFieldsDraft(current => {
      const next = [...current]
      const [moved] = next.splice(index, 1)
      next.splice(targetIndex, 0, moved)
      return next
    })
  }

  function updateField<K extends keyof ApiFormField>(index: number, key: K, value: ApiFormField[K]) {
    setFieldsDraft(current =>
      current.map((f, i) => (i === index ? { ...f, [key]: value } : f))
    )
  }

  // Filtered forms list
  const filteredForms = useMemo(() => {
    return forms.filter(f => {
      if (typeFilter === 'builtin' && !f.isBuiltIn) return false
      if (typeFilter === 'custom' && f.isBuiltIn) return false
      if (search.trim()) {
        const q = search.toLowerCase()
        return (
          f.title.toLowerCase().includes(q) ||
          f.builtInLabel.toLowerCase().includes(q) ||
          f.fieldsSummary.some(s => s.toLowerCase().includes(q))
        )
      }
      return true
    })
  }, [forms, typeFilter, search])

  // Split into built-in and custom
  const builtInForms = useMemo(() => filteredForms.filter(f => f.isBuiltIn), [filteredForms])
  const customForms = useMemo(() => filteredForms.filter(f => !f.isBuiltIn), [filteredForms])

  return (
    <div className="space-y-6">
      {/* Header */}
      <PageHeader
        title="Forms"
        subtitle="Manage built-in and custom form field definitions for tickets, users, organizations, and tasks."
        actions={
          editingFormId ? (
            <button type="button" onClick={closeEditor} className={btnGhost}>
              Back to Forms List
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => openEditor('new')}
                className={`${btnPrimary} flex items-center gap-2`}
              >
                <Plus className="size-4" />
                Add New Custom Form
              </button>
            </div>
          )
        }
      />

      {/* Notifications */}
      {error && (
        <div className="flex items-center gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
          <AlertCircle className="size-5 shrink-0 text-rose-600" />
          <div className="flex-1 font-medium">{error}</div>
          <button type="button" onClick={() => setError('')} className="text-rose-500 hover:text-rose-700">
            <X className="size-4" />
          </button>
        </div>
      )}
      {success && (
        <div className="flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
          <CheckCircle2 className="size-5 shrink-0 text-emerald-600" />
          <div className="flex-1 font-medium">{success}</div>
          <button type="button" onClick={() => setSuccess('')} className="text-emerald-500 hover:text-emerald-700">
            <X className="size-4" />
          </button>
        </div>
      )}

      {/* VIEW 1: Form Editor */}
      {editingFormId && formDetail ? (
        <form onSubmit={handleSave} className="space-y-6">
          <Card className="overflow-hidden">
            {/* Form Top Banner */}
            <div className="flex flex-col gap-4 border-b border-line pb-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3">
                <div className="grid size-10 place-items-center rounded-xl bg-brand-50 text-brand-600">
                  {getFormIcon(formDetail.type)}
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-ink-900">
                    {isNew ? 'Create Custom Form' : formDetail.title}
                  </h2>
                  <div className="flex items-center gap-2 text-xs text-ink-500">
                    <span className="font-medium text-ink-700">{formDetail.builtInLabel}</span>
                    <span>•</span>
                    <span>{fieldsDraft.filter(f => !f.delete).length} fields configured</span>
                    {!isNew && (
                      <>
                        <span>•</span>
                        <span>{formDetail.entryCount} submissions recorded</span>
                      </>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={closeEditor}
                  className={btnGhost}
                  disabled={saving}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className={btnPrimary}
                  disabled={saving}
                >
                  {saving ? 'Saving...' : isNew ? 'Create Form' : 'Save Changes'}
                </button>
              </div>
            </div>

            {/* Navigation Tabs */}
            <div className="mt-4 flex border-b border-line text-sm font-medium">
              <button
                type="button"
                onClick={() => setActiveTab('definition')}
                className={`border-b-2 px-4 py-2.5 transition-colors ${
                  activeTab === 'definition'
                    ? 'border-brand-600 text-brand-600'
                    : 'border-transparent text-ink-600 hover:text-ink-900'
                }`}
              >
                Form Settings
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('fields')}
                className={`border-b-2 px-4 py-2.5 transition-colors ${
                  activeTab === 'fields'
                    ? 'border-brand-600 text-brand-600'
                    : 'border-transparent text-ink-600 hover:text-ink-900'
                }`}
              >
                Fields ({fieldsDraft.filter(f => !f.delete).length})
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('topics')}
                className={`border-b-2 px-4 py-2.5 transition-colors ${
                  activeTab === 'topics'
                    ? 'border-brand-600 text-brand-600'
                    : 'border-transparent text-ink-600 hover:text-ink-900'
                }`}
              >
                Help Topics ({selectedTopicIds.length})
              </button>
              {!isNew && (
                <button
                  type="button"
                  onClick={() => setActiveTab('entries')}
                  className={`border-b-2 px-4 py-2.5 transition-colors ${
                    activeTab === 'entries'
                      ? 'border-brand-600 text-brand-600'
                      : 'border-transparent text-ink-600 hover:text-ink-900'
                  }`}
                >
                  Submissions ({recentEntries.length})
                </button>
              )}
            </div>

            {/* TAB 1: Definition */}
            {activeTab === 'definition' && (
              <div className="space-y-5 pt-5">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Form Title *">
                    <input
                      type="text"
                      className={inputClass}
                      value={title}
                      onChange={e => setTitle(e.target.value)}
                      placeholder="e.g. Asset Details, Feedback Survey"
                      required
                      autoFocus
                    />
                  </Field>

                  <Field label="Form Type">
                    <input
                      type="text"
                      className={`${inputClass} bg-paper/60 text-ink-500`}
                      value={formDetail.builtInLabel}
                      disabled
                    />
                  </Field>
                </div>

                <Field label="Instructions (Displayed to users/agents above form fields)">
                  <textarea
                    rows={3}
                    className={inputClass}
                    value={instructions}
                    onChange={e => setInstructions(e.target.value)}
                    placeholder="Enter guidance or instructions for people filling out this form..."
                  />
                </Field>

                <Field label="Internal Notes (Visible to administrators only)">
                  <textarea
                    rows={3}
                    className={inputClass}
                    value={notes}
                    onChange={e => setNotes(e.target.value)}
                    placeholder="Internal reference notes regarding this form..."
                  />
                </Field>

                {!isNew && formDetail.deletable && (
                  <div className="border-t border-line pt-5">
                    <h3 className="text-sm font-semibold text-rose-800">Danger Zone</h3>
                    <p className="mt-1 text-xs text-ink-500">
                      Deleting this custom form will detach it from all help topics and hide field definitions.
                    </p>
                    <button
                      type="button"
                      onClick={() => handleDelete(formDetail.id, formDetail.title)}
                      className="mt-3 inline-flex items-center gap-2 rounded-xl border border-rose-300 bg-rose-50 px-3.5 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-100"
                    >
                      <Trash2 className="size-3.5" />
                      Delete This Custom Form
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* TAB 2: Fields */}
            {activeTab === 'fields' && (
              <div className="space-y-4 pt-5">
                <div className="flex flex-col gap-2 rounded-xl border border-brand-100 bg-brand-50/50 p-4 text-xs text-brand-900 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <span className="font-semibold">Fields Configuration:</span> Adjust order, visibility, requirement
                    settings, and variable keys. Click <strong>Config</strong> to fine-tune field-specific parameters.
                  </div>
                  <button
                    type="button"
                    onClick={addField}
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-700"
                  >
                    <Plus className="size-3.5" />
                    Add Field
                  </button>
                </div>

                {/* Fields Table */}
                <div className="overflow-x-auto rounded-xl border border-line">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-paper font-semibold text-ink-700">
                      <tr>
                        <th className="w-10 px-3 py-2.5 text-center">Order</th>
                        <th className="min-w-[180px] px-3 py-2.5">Field Label</th>
                        <th className="min-w-[160px] px-3 py-2.5">Type</th>
                        <th className="min-w-[160px] px-3 py-2.5">Visibility / Requirement</th>
                        <th className="min-w-[130px] px-3 py-2.5">Variable</th>
                        <th className="w-20 px-3 py-2.5 text-center">Config</th>
                        <th className="w-16 px-3 py-2.5 text-center">Delete</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line bg-surface text-ink-800">
                      {fieldsDraft.map((field, idx) => {
                        if (field.delete) return null
                        return (
                          <tr key={field.id || `draft-${idx}`} className="hover:bg-paper/40">
                            {/* Sort / Move */}
                            <td className="px-2 py-2 text-center">
                              <div className="flex items-center justify-center gap-0.5">
                                <button
                                  type="button"
                                  disabled={idx === 0}
                                  onClick={() => moveField(idx, 'up')}
                                  className="rounded p-1 text-ink-400 hover:bg-paper hover:text-ink-700 disabled:opacity-30"
                                  title="Move Up"
                                >
                                  <ArrowUp className="size-3" />
                                </button>
                                <button
                                  type="button"
                                  disabled={idx === fieldsDraft.length - 1}
                                  onClick={() => moveField(idx, 'down')}
                                  className="rounded p-1 text-ink-400 hover:bg-paper hover:text-ink-700 disabled:opacity-30"
                                  title="Move Down"
                                >
                                  <ArrowDown className="size-3" />
                                </button>
                              </div>
                            </td>

                            {/* Label */}
                            <td className="px-3 py-2">
                              <input
                                type="text"
                                className="w-full rounded-lg border border-line bg-paper px-2.5 py-1.5 text-xs text-ink-800 outline-none focus:ring-1 focus:ring-brand-500"
                                value={field.label}
                                onChange={e => updateField(idx, 'label', e.target.value)}
                                placeholder="e.g. Asset Tag"
                                required
                              />
                            </td>

                            {/* Type */}
                            <td className="px-3 py-2">
                              <select
                                className="w-full rounded-lg border border-line bg-paper px-2 py-1.5 text-xs text-ink-800 outline-none focus:ring-1 focus:ring-brand-500 disabled:opacity-60"
                                value={field.type}
                                onChange={e => updateField(idx, 'type', e.target.value)}
                                disabled={field.typeEditable === false}
                              >
                                {FIELD_TYPES.map(grp => (
                                  <optgroup key={grp.group} label={grp.group}>
                                    {grp.types.map(t => (
                                      <option key={t.value} value={t.value}>
                                        {t.label}
                                      </option>
                                    ))}
                                  </optgroup>
                                ))}
                                {availableLists.length > 0 && (
                                  <optgroup label="Custom Lists">
                                    {availableLists.map(l => (
                                      <option key={`list-${l.id}`} value={`list-${l.id}`}>
                                        List: {l.name}
                                      </option>
                                    ))}
                                  </optgroup>
                                )}
                              </select>
                            </td>

                            {/* Visibility / Requirement Mode */}
                            <td className="px-3 py-2">
                              <select
                                className="w-full rounded-lg border border-line bg-paper px-2 py-1.5 text-xs text-ink-800 outline-none focus:ring-1 focus:ring-brand-500"
                                value={field.visibilityMode || 'a'}
                                onChange={e => updateField(idx, 'visibilityMode', e.target.value as ApiRequirementMode)}
                              >
                                {REQUIREMENT_MODES.map(mode => (
                                  <option key={mode.key} value={mode.key}>
                                    {mode.label}
                                  </option>
                                ))}
                              </select>
                            </td>

                            {/* Variable */}
                            <td className="px-3 py-2">
                              <input
                                type="text"
                                className="w-full rounded-lg border border-line bg-paper px-2.5 py-1.5 font-mono text-xs text-ink-800 outline-none focus:ring-1 focus:ring-brand-500 disabled:opacity-60"
                                value={field.name}
                                onChange={e => updateField(idx, 'name', e.target.value)}
                                placeholder="variable_name"
                                disabled={field.nameEditable === false}
                              />
                            </td>

                            {/* Config button */}
                            <td className="px-2 py-2 text-center">
                              <button
                                type="button"
                                onClick={() => setConfiguringFieldIdx(idx)}
                                className="inline-flex items-center gap-1 rounded-lg border border-line bg-paper px-2 py-1 text-xs font-medium text-ink-700 hover:bg-surface"
                                title="Configure field settings"
                              >
                                <Settings className="size-3" />
                                Config
                              </button>
                            </td>

                            {/* Delete button */}
                            <td className="px-2 py-2 text-center">
                              {field.deletable !== false ? (
                                <button
                                  type="button"
                                  onClick={() => removeField(idx)}
                                  className="rounded p-1 text-rose-500 hover:bg-rose-50 hover:text-rose-700"
                                  title="Delete field"
                                >
                                  <Trash2 className="size-3.5" />
                                </button>
                              ) : (
                                <span className="text-xs text-ink-400" title="Protected core field">—</span>
                              )}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>

                <button
                  type="button"
                  onClick={addField}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-dashed border-line bg-paper/50 px-4 py-2 text-xs font-semibold text-ink-700 hover:border-brand-500 hover:bg-brand-50 hover:text-brand-700"
                >
                  <Plus className="size-3.5" />
                  Add Another Field
                </button>
              </div>
            )}

            {/* TAB 3: Help Topics */}
            {activeTab === 'topics' && (
              <div className="space-y-4 pt-5">
                <div className="rounded-xl border border-line bg-paper/50 p-4 text-xs text-ink-600">
                  Select which <strong>Help Topics</strong> will automatically present this form to users and agents.
                  When an end-user or agent selects an attached topic, this form's fields will dynamically appear.
                </div>

                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {availableTopics.map(topic => {
                    const isChecked = selectedTopicIds.includes(topic.id)
                    return (
                      <label
                        key={topic.id}
                        className={`flex cursor-pointer items-center gap-3 rounded-xl border p-3 text-xs transition-colors ${
                          isChecked
                            ? 'border-brand-500 bg-brand-50/40 text-brand-900'
                            : 'border-line bg-surface text-ink-700 hover:bg-paper'
                        }`}
                      >
                        <input
                          type="checkbox"
                          className="size-4 rounded border-line text-brand-600 focus:ring-brand-500"
                          checked={isChecked}
                          onChange={e => {
                            if (e.target.checked) {
                              setSelectedTopicIds(curr => [...curr, topic.id])
                            } else {
                              setSelectedTopicIds(curr => curr.filter(id => id !== topic.id))
                            }
                          }}
                        />
                        <span className="font-medium">{topic.name}</span>
                      </label>
                    )
                  })}
                </div>
              </div>
            )}

            {/* TAB 4: Submissions */}
            {!isNew && activeTab === 'entries' && (
              <div className="space-y-4 pt-5">
                <div className="flex items-center justify-between text-xs text-ink-500">
                  <span>Recent entries recorded for this form ({recentEntries.length} displayed)</span>
                  <span className="font-semibold text-ink-700">Total Recorded: {formDetail.entryCount}</span>
                </div>

                {recentEntries.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-line p-8 text-center text-xs text-ink-500">
                    No submitted entries found for this form yet.
                  </div>
                ) : (
                  <div className="overflow-x-auto rounded-xl border border-line">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-paper font-semibold text-ink-700">
                        <tr>
                          <th className="px-3 py-2.5">Date</th>
                          <th className="px-3 py-2.5">Target</th>
                          <th className="px-3 py-2.5">Submitted Values</th>
                          <th className="px-3 py-2.5">Attachments</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-line bg-surface text-ink-800">
                        {recentEntries.map(entry => (
                          <tr key={entry.id} className="hover:bg-paper/40">
                            <td className="whitespace-nowrap px-3 py-2 text-ink-600">
                              {formatDate(entry.created)}
                            </td>
                            <td className="px-3 py-2">
                              <span className="rounded bg-paper px-2 py-0.5 font-mono text-[11px] text-ink-700">
                                {entry.objectType}:{entry.objectId}
                              </span>
                            </td>
                            <td className="px-3 py-2">
                              <div className="flex flex-wrap gap-1.5">
                                {Object.entries(entry.values).map(([fid, v]: [string, any]) => {
                                  if (!v) return null
                                  const text = typeof v === 'object' ? `${v.label || v.name}: ${v.value}` : String(v)
                                  return (
                                    <span key={fid} className="rounded-md border border-line bg-paper px-2 py-0.5 text-[11px]">
                                      {text}
                                    </span>
                                  )
                                })}
                              </div>
                            </td>
                            <td className="px-3 py-2">
                              {entry.attachments?.length > 0 ? (
                                <div className="flex flex-wrap gap-1">
                                  {entry.attachments.map(att => (
                                    <span
                                      key={att.id}
                                      className="inline-flex items-center gap-1 rounded bg-sky-50 px-2 py-0.5 text-[11px] text-sky-700"
                                    >
                                      <Paperclip className="size-3" />
                                      {att.name}
                                    </span>
                                  ))}
                                </div>
                              ) : (
                                <span className="text-ink-400">—</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </Card>
        </form>
      ) : (
        /* VIEW 2: Forms List */
        <div className="space-y-6">
          {/* Search and Filters */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <div className="relative w-72">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-400" />
                <input
                  type="text"
                  className={`${inputClass} pl-9`}
                  placeholder="Search forms or fields..."
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                />
              </div>

              {/* Type Filter Buttons */}
              <div className="flex rounded-xl border border-line bg-paper p-1 text-xs font-medium text-ink-600">
                <button
                  type="button"
                  onClick={() => setTypeFilter('all')}
                  className={`rounded-lg px-3 py-1.5 transition-colors ${
                    typeFilter === 'all' ? 'bg-surface text-ink-900 shadow-sm' : 'hover:text-ink-900'
                  }`}
                >
                  All ({forms.length})
                </button>
                <button
                  type="button"
                  onClick={() => setTypeFilter('builtin')}
                  className={`rounded-lg px-3 py-1.5 transition-colors ${
                    typeFilter === 'builtin' ? 'bg-surface text-ink-900 shadow-sm' : 'hover:text-ink-900'
                  }`}
                >
                  Built-in ({forms.filter(f => f.isBuiltIn).length})
                </button>
                <button
                  type="button"
                  onClick={() => setTypeFilter('custom')}
                  className={`rounded-lg px-3 py-1.5 transition-colors ${
                    typeFilter === 'custom' ? 'bg-surface text-ink-900 shadow-sm' : 'hover:text-ink-900'
                  }`}
                >
                  Custom ({forms.filter(f => !f.isBuiltIn).length})
                </button>
              </div>
            </div>

            {selectedIds.length > 0 && (
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-ink-600">{selectedIds.length} selected</span>
                <button
                  type="button"
                  onClick={handleMassDelete}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-rose-300 bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-100"
                >
                  <Trash2 className="size-3.5" />
                  Delete Selected
                </button>
              </div>
            )}
          </div>

          {loading ? (
            <div className="grid h-64 place-items-center text-sm text-ink-500">
              <div className="flex items-center gap-2">
                <RefreshCw className="size-4 animate-spin text-brand-600" />
                Loading forms configuration...
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              {/* SECTION 1: Built-in Forms */}
              {(typeFilter === 'all' || typeFilter === 'builtin') && builtInForms.length > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-ink-800">
                      Built-in Forms <span className="font-normal text-ink-500">({builtInForms.length})</span>
                    </h3>
                    <span className="text-xs text-ink-400">Core system forms processed with tickets and users</span>
                  </div>

                  <div className="overflow-hidden rounded-2xl border border-line bg-surface shadow-sm">
                    <table className="w-full text-left text-xs">
                      <thead className="border-b border-line bg-paper font-semibold text-ink-700">
                        <tr>
                          <th className="w-12 px-4 py-3 text-center">Type</th>
                          <th className="px-4 py-3">Form Title</th>
                          <th className="px-4 py-3">Fields</th>
                          <th className="px-4 py-3">Help Topics</th>
                          <th className="px-4 py-3">Submissions</th>
                          <th className="px-4 py-3">Last Updated</th>
                          <th className="w-24 px-4 py-3 text-right">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-line text-ink-800">
                        {builtInForms.map(form => (
                          <tr key={form.id} className="hover:bg-paper/50">
                            <td className="px-4 py-3 text-center">
                              <div className="mx-auto grid size-7 place-items-center rounded-lg bg-paper">
                                {getFormIcon(form.type)}
                              </div>
                            </td>
                            <td className="px-4 py-3">
                              <button
                                type="button"
                                onClick={() => openEditor(form.id)}
                                className="font-semibold text-brand-600 hover:underline"
                              >
                                {form.title}
                              </button>
                              <div className="mt-0.5 text-[11px] text-ink-400">{form.builtInLabel}</div>
                            </td>
                            <td className="px-4 py-3">
                              <span className="inline-flex items-center gap-1 rounded-md bg-paper px-2 py-0.5 font-medium text-ink-700">
                                {form.fieldCount} fields
                              </span>
                            </td>
                            <td className="px-4 py-3 text-ink-600">
                              {form.topicCount > 0 ? (
                                <span className="rounded-md bg-brand-50 px-2 py-0.5 font-medium text-brand-700">
                                  {form.topicCount} topics
                                </span>
                              ) : (
                                <span className="text-ink-400">—</span>
                              )}
                            </td>
                            <td className="px-4 py-3 text-ink-600">
                              <span className="font-mono">{form.entryCount}</span>
                            </td>
                            <td className="px-4 py-3 text-ink-500">
                              {formatDate(form.updated)}
                            </td>
                            <td className="px-4 py-3 text-right">
                              <button
                                type="button"
                                onClick={() => openEditor(form.id)}
                                className="inline-flex items-center gap-1 rounded-lg border border-line bg-paper px-2.5 py-1 text-xs font-semibold text-ink-700 hover:bg-surface"
                              >
                                Edit
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* SECTION 2: Custom Forms */}
              {(typeFilter === 'all' || typeFilter === 'custom') && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-ink-800">
                      Custom Forms <span className="font-normal text-ink-500">({customForms.length})</span>
                    </h3>
                    <span className="text-xs text-ink-400">User-defined forms attached to specific help topics</span>
                  </div>

                  {customForms.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-line bg-surface p-8 text-center text-xs text-ink-500">
                      No custom forms found. Click <strong>Add New Custom Form</strong> to create one.
                    </div>
                  ) : (
                    <div className="overflow-hidden rounded-2xl border border-line bg-surface shadow-sm">
                      <table className="w-full text-left text-xs">
                        <thead className="border-b border-line bg-paper font-semibold text-ink-700">
                          <tr>
                            <th className="w-10 px-4 py-3 text-center">
                              <input
                                type="checkbox"
                                className="size-4 rounded border-line text-brand-600 focus:ring-brand-500"
                                checked={
                                  customForms.length > 0 &&
                                  customForms.every(f => selectedIds.includes(f.id))
                                }
                                onChange={e => {
                                  if (e.target.checked) {
                                    setSelectedIds(customForms.map(f => f.id))
                                  } else {
                                    setSelectedIds([])
                                  }
                                }}
                              />
                            </th>
                            <th className="px-4 py-3">Form Title</th>
                            <th className="px-4 py-3">Fields</th>
                            <th className="px-4 py-3">Help Topics</th>
                            <th className="px-4 py-3">Submissions</th>
                            <th className="px-4 py-3">Last Updated</th>
                            <th className="w-28 px-4 py-3 text-right">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-line text-ink-800">
                          {customForms.map(form => {
                            const isSelected = selectedIds.includes(form.id)
                            return (
                              <tr key={form.id} className="hover:bg-paper/50">
                                <td className="px-4 py-3 text-center">
                                  <input
                                    type="checkbox"
                                    className="size-4 rounded border-line text-brand-600 focus:ring-brand-500"
                                    checked={isSelected}
                                    onChange={e => {
                                      if (e.target.checked) {
                                        setSelectedIds(c => [...c, form.id])
                                      } else {
                                        setSelectedIds(c => c.filter(id => id !== form.id))
                                      }
                                    }}
                                  />
                                </td>
                                <td className="px-4 py-3">
                                  <button
                                    type="button"
                                    onClick={() => openEditor(form.id)}
                                    className="font-semibold text-brand-600 hover:underline"
                                  >
                                    {form.title}
                                  </button>
                                  {form.instructions && (
                                    <div className="line-clamp-1 mt-0.5 text-[11px] text-ink-400">
                                      {form.instructions}
                                    </div>
                                  )}
                                </td>
                                <td className="px-4 py-3">
                                  <span className="inline-flex items-center gap-1 rounded-md bg-paper px-2 py-0.5 font-medium text-ink-700">
                                    {form.fieldCount} fields
                                  </span>
                                </td>
                                <td className="px-4 py-3 text-ink-600">
                                  {form.topicCount > 0 ? (
                                    <span className="rounded-md bg-brand-50 px-2 py-0.5 font-medium text-brand-700">
                                      {form.topicCount} topics
                                    </span>
                                  ) : (
                                    <span className="text-ink-400">None</span>
                                  )}
                                </td>
                                <td className="px-4 py-3 text-ink-600">
                                  <span className="font-mono">{form.entryCount}</span>
                                </td>
                                <td className="px-4 py-3 text-ink-500">
                                  {formatDate(form.updated)}
                                </td>
                                <td className="px-4 py-3 text-right">
                                  <div className="flex items-center justify-end gap-1.5">
                                    <button
                                      type="button"
                                      onClick={() => openEditor(form.id)}
                                      className="rounded-lg border border-line bg-paper px-2.5 py-1 text-xs font-semibold text-ink-700 hover:bg-surface"
                                    >
                                      Edit
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => handleDelete(form.id, form.title)}
                                      className="rounded-lg p-1 text-rose-500 hover:bg-rose-50 hover:text-rose-700"
                                      title="Delete Form"
                                    >
                                      <Trash2 className="size-3.5" />
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* MODAL: Field Configuration Settings */}
      {configuringFieldIdx !== null && fieldsDraft[configuringFieldIdx] && (
        <FieldConfigModal
          field={fieldsDraft[configuringFieldIdx]}
          onSave={cfg => {
            updateField(configuringFieldIdx, 'configuration', cfg.configuration)
            if (cfg.hint !== undefined) updateField(configuringFieldIdx, 'hint', cfg.hint)
            setConfiguringFieldIdx(null)
          }}
          onClose={() => setConfiguringFieldIdx(null)}
        />
      )}
    </div>
  )
}

/**
 * Field Configuration Modal for fine-tuning specific field parameters.
 */
function FieldConfigModal({
  field,
  onSave,
  onClose,
}: {
  field: ApiFormField
  onSave: (val: { configuration: Record<string, any>; hint?: string }) => void
  onClose: () => void
}) {
  const currentConfig = field.configuration || {}
  const [hint, setHint] = useState(field.hint || '')
  const [placeholder, setPlaceholder] = useState(currentConfig.placeholder || '')
  const [minLength, setMinLength] = useState(currentConfig.min_length || '')
  const [maxLength, setMaxLength] = useState(currentConfig.max_length || '')
  const [regex, setRegex] = useState(currentConfig.regex || '')
  const [allowHtml, setAllowHtml] = useState(Boolean(currentConfig.html))
  const [multiselect, setMultiselect] = useState(Boolean(currentConfig.multiselect))
  const [choices, setChoices] = useState(
    Array.isArray(currentConfig.choices)
      ? currentConfig.choices.join('\n')
      : String(currentConfig.choices || '')
  )
  const [maxFiles, setMaxFiles] = useState(currentConfig.max_files || '5')
  const [maxFileSize, setMaxFileSize] = useState(currentConfig.max_file_size || '10')
  const [extensions, setExtensions] = useState(currentConfig.extensions || '.pdf, .png, .jpg, .docx')

  function handleModalSubmit(e: FormEvent) {
    e.preventDefault()
    const config: Record<string, any> = {
      ...currentConfig,
      placeholder: placeholder.trim() || undefined,
    }

    if (field.type === 'text' || field.type === 'memo') {
      config.min_length = minLength ? Number(minLength) : undefined
      config.max_length = maxLength ? Number(maxLength) : undefined
      config.regex = regex.trim() || undefined
      if (field.type === 'memo') config.html = allowHtml
    }

    if (field.type === 'choices' || field.type.startsWith('list-')) {
      config.multiselect = multiselect
      if (field.type === 'choices') {
        config.choices = choices
          .split('\n')
          .map(c => c.trim())
          .filter(Boolean)
      }
    }

    if (field.type === 'files') {
      config.max_files = Number(maxFiles) || 5
      config.max_file_size = Number(maxFileSize) || 10
      config.extensions = extensions.trim()
    }

    onSave({ configuration: config, hint })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-xs">
      <div className="w-full max-w-lg rounded-2xl border border-line bg-surface p-6 shadow-xl">
        <div className="flex items-center justify-between border-b border-line pb-3">
          <div className="flex items-center gap-2">
            <Settings className="size-4 text-brand-600" />
            <h3 className="text-base font-semibold text-ink-900">
              Configure Field: {field.label || field.name || 'Untitled'}
            </h3>
          </div>
          <button type="button" onClick={onClose} className="text-ink-400 hover:text-ink-700">
            <X className="size-4" />
          </button>
        </div>

        <form onSubmit={handleModalSubmit} className="mt-4 space-y-4">
          <Field label="Help Text / Hint (Displayed under the field)">
            <input
              type="text"
              className={inputClass}
              value={hint}
              onChange={e => setHint(e.target.value)}
              placeholder="e.g. Enter serial number found on the back of the device"
            />
          </Field>

          <Field label="Placeholder Text">
            <input
              type="text"
              className={inputClass}
              value={placeholder}
              onChange={e => setPlaceholder(e.target.value)}
              placeholder="e.g. SN-000000"
            />
          </Field>

          {/* Text/Memo Specific Config */}
          {(field.type === 'text' || field.type === 'memo') && (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Min Length">
                  <input
                    type="number"
                    className={inputClass}
                    value={minLength}
                    onChange={e => setMinLength(e.target.value)}
                  />
                </Field>
                <Field label="Max Length">
                  <input
                    type="number"
                    className={inputClass}
                    value={maxLength}
                    onChange={e => setMaxLength(e.target.value)}
                  />
                </Field>
              </div>

              {field.type === 'text' && (
                <Field label="Validation Pattern / Regex">
                  <input
                    type="text"
                    className={inputClass}
                    value={regex}
                    onChange={e => setRegex(e.target.value)}
                    placeholder="e.g. ^[A-Z0-9]{6,}$"
                  />
                </Field>
              )}

              {field.type === 'memo' && (
                <label className="flex items-center gap-2.5 text-xs font-medium text-ink-700">
                  <input
                    type="checkbox"
                    className="size-4 rounded border-line text-brand-600 focus:ring-brand-500"
                    checked={allowHtml}
                    onChange={e => setAllowHtml(e.target.checked)}
                  />
                  Allow HTML / Rich Text formatting
                </label>
              )}
            </>
          )}

          {/* Choices Config */}
          {field.type === 'choices' && (
            <Field label="Choices (One option per line)">
              <textarea
                rows={4}
                className={inputClass}
                value={choices}
                onChange={e => setChoices(e.target.value)}
                placeholder="Option 1&#10;Option 2&#10;Option 3"
              />
            </Field>
          )}

          {/* Multiselect for Choices and Lists */}
          {(field.type === 'choices' || field.type.startsWith('list-')) && (
            <label className="flex items-center gap-2.5 text-xs font-medium text-ink-700">
              <input
                type="checkbox"
                className="size-4 rounded border-line text-brand-600 focus:ring-brand-500"
                checked={multiselect}
                onChange={e => setMultiselect(e.target.checked)}
              />
              Allow multiple selections
            </label>
          )}

          {/* File Upload Config */}
          {field.type === 'files' && (
            <div className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Max Files Allowed">
                  <input
                    type="number"
                    className={inputClass}
                    value={maxFiles}
                    onChange={e => setMaxFiles(e.target.value)}
                  />
                </Field>
                <Field label="Max File Size (MB)">
                  <input
                    type="number"
                    className={inputClass}
                    value={maxFileSize}
                    onChange={e => setMaxFileSize(e.target.value)}
                  />
                </Field>
              </div>
              <Field label="Allowed File Extensions">
                <input
                  type="text"
                  className={inputClass}
                  value={extensions}
                  onChange={e => setExtensions(e.target.value)}
                  placeholder=".pdf, .png, .jpg, .docx"
                />
              </Field>
            </div>
          )}

          <div className="flex items-center justify-end gap-2 border-t border-line pt-4">
            <button type="button" onClick={onClose} className={btnGhost}>
              Cancel
            </button>
            <button type="submit" className={btnPrimary}>
              Save Field Configuration
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
