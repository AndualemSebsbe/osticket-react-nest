import { useEffect, useMemo, useState } from 'react'
import { Plus, Trash2, ArrowUp, ArrowDown, Settings, Filter, Columns3, ArrowUpDown, Bookmark, X } from 'lucide-react'
import { btnGhost, btnPrimary, Card, Field, inputClass } from './ui'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from './ui/dialog'
import { useDialogs } from '../context/DialogContext'
import {
  createApiPersonalQueue,
  deleteApiPersonalQueue,
  getApiAdvancedSearchOptions,
  listApiPersonalQueues,
  updateApiPersonalQueue,
  type ApiAdvancedSearchOptions,
  type ApiPersonalQueue,
  type ApiPersonalQueueInput,
  type ApiSearchColumn,
  type ApiSearchCriterion,
  type ApiSearchField,
  type ApiSearchSort,
} from '../lib/api'

interface PersonalQueueModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialQueueId?: string | null
  parentQueueOptions?: Array<{ id: string; title: string }>
  onSaved?: (queueId: string) => void
  onDeleted?: (queueId: string) => void
  onSelectQueue?: (queueId: string) => void
}

type Tab = 'settings' | 'criteria' | 'columns' | 'sort'

const DEFAULT_COLUMNS: ApiSearchColumn[] = [
  { path: 'number', label: 'Ticket', type: 'text', sortable: true },
  { path: 'subject', label: 'Subject', type: 'text', sortable: true },
  { path: 'priority', label: 'Priority', type: 'select', sortable: true },
  { path: 'status', label: 'Status', type: 'select', sortable: true },
  { path: 'department', label: 'Department', type: 'select', sortable: true },
  { path: 'assignee', label: 'Assigned To', type: 'select', sortable: true },
  { path: 'updated', label: 'Last Updated', type: 'date', sortable: true },
]

const DEFAULT_SORT: ApiSearchSort = { field: 'updated', direction: 'desc' }
const VALUE_FREE_OPERATORS = new Set(['set', 'not_set', 'empty', 'not_empty'])

function columnFromField(field: ApiSearchField): ApiSearchColumn {
  return { path: field.path, label: field.label, type: field.type, sortable: true }
}

function splitValues(value: unknown): string[] {
  return String(value ?? '').split(',').map((item) => item.trim()).filter(Boolean)
}

function criterionNeedsValue(operator: string | undefined) {
  return !VALUE_FREE_OPERATORS.has(operator || 'equals')
}

export function PersonalQueueModal({
  open,
  onOpenChange,
  initialQueueId,
  parentQueueOptions = [],
  onSaved,
  onDeleted,
  onSelectQueue,
}: PersonalQueueModalProps) {
  const { confirm } = useDialogs()
  const [mode, setMode] = useState<'list' | 'edit'>('list')
  const [personalQueues, setPersonalQueues] = useState<ApiPersonalQueue[]>([])
  const [options, setOptions] = useState<ApiAdvancedSearchOptions | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  // Editor states
  const [editingId, setEditingId] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<Tab>('settings')
  const [title, setTitle] = useState('')
  const [parentId, setParentId] = useState('0')
  const [pageSize, setPageSize] = useState(25)
  const [notes, setNotes] = useState('')
  const [criteria, setCriteria] = useState<ApiSearchCriterion[]>([])
  const [columns, setColumns] = useState<ApiSearchColumn[]>(DEFAULT_COLUMNS)
  const [sort, setSort] = useState<ApiSearchSort>(DEFAULT_SORT)

  useEffect(() => {
    if (!open) return
    let active = true
    setLoading(true)
    setError('')
    setNotice('')

    Promise.allSettled([listApiPersonalQueues(), getApiAdvancedSearchOptions()]).then(([queuesRes, optionsRes]) => {
      if (!active) return
      if (queuesRes.status === 'fulfilled') {
        setPersonalQueues(queuesRes.value)
        if (initialQueueId) {
          const target = queuesRes.value.find((q) => q.id === initialQueueId)
          if (target) {
            startEdit(target)
            setLoading(false)
            return
          }
        }
      }
      if (optionsRes.status === 'fulfilled') {
        setOptions(optionsRes.value)
      }
      setLoading(false)
    })

    return () => { active = false }
  }, [open, initialQueueId])

  const fields = useMemo(() => options?.fields ?? [], [options])

  function resetForm() {
    setEditingId(null)
    setTitle('')
    setParentId('0')
    setPageSize(25)
    setNotes('')
    setCriteria([])
    setColumns(options?.defaults.columns?.length ? options.defaults.columns.map(columnFromField) : DEFAULT_COLUMNS)
    setSort(options?.defaults.sort || DEFAULT_SORT)
    setActiveTab('settings')
    setError('')
    setNotice('')
  }

  function startCreate() {
    resetForm()
    setMode('edit')
  }

  function startEdit(queue: ApiPersonalQueue) {
    setEditingId(queue.id)
    setTitle(queue.title)
    setParentId(queue.parentId || '0')
    setNotes(queue.notes || '')
    setCriteria(queue.criteria || [])
    setColumns(queue.columns && queue.columns.length ? queue.columns : DEFAULT_COLUMNS)
    setSort(queue.sortBy && queue.sortBy.field ? queue.sortBy : DEFAULT_SORT)
    setActiveTab('settings')
    setError('')
    setNotice('')
    setMode('edit')
  }

  function addCriterion() {
    const firstField = fields.find((f) => f.path === 'status') || fields[0] || { path: 'status', label: 'Status', type: 'select' }
    const defaultOperator = options?.operators[firstField.type]?.[0]?.value || 'equals'
    setCriteria((current) => [...current, { field: firstField.path, operator: defaultOperator, value: '' }])
  }

  function updateCriterion(index: number, patch: Partial<ApiSearchCriterion>) {
    setCriteria((current) =>
      current.map((criterion, position) => {
        if (position !== index) return criterion
        const updated = { ...criterion, ...patch }
        if (patch.field && patch.field !== criterion.field) {
          const targetField = fields.find((f) => f.path === patch.field)
          const validOp = targetField ? options?.operators[targetField.type]?.[0]?.value || 'equals' : 'equals'
          updated.operator = validOp
          updated.value = ''
          delete updated.value2
        }
        return updated
      })
    )
  }

  function removeCriterion(index: number) {
    setCriteria((current) => current.filter((_, position) => position !== index))
  }

  function addColumn(field: ApiSearchField) {
    if (columns.some((col) => col.path === field.path)) return
    setColumns((current) => [...current, columnFromField(field)])
  }

  function removeColumn(path: string) {
    setColumns((current) => current.filter((col) => col.path !== path))
  }

  function moveColumn(index: number, direction: -1 | 1) {
    setColumns((current) => {
      const next = [...current]
      const target = index + direction
      if (target < 0 || target >= next.length) return current
      const item = next[index]
      next[index] = next[target]
      next[target] = item
      return next
    })
  }

  async function handleSave() {
    const trimmedTitle = title.trim()
    if (!trimmedTitle) {
      setError('Queue title is required.')
      setActiveTab('settings')
      return
    }

    setSaving(true)
    setError('')
    setNotice('')

    const payload: ApiPersonalQueueInput = {
      title: trimmedTitle,
      parentId: parentId !== '0' ? parentId : undefined,
      criteria,
      columns,
      sortBy: sort,
      pageSize,
      notes: notes.trim(),
    }

    try {
      if (editingId) {
        const updated = await updateApiPersonalQueue(editingId, payload)
        setPersonalQueues((current) => current.map((q) => (q.id === editingId ? updated : q)))
        setNotice('Personal queue updated.')
        onSaved?.(updated.id)
      } else {
        const created = await createApiPersonalQueue(payload)
        setPersonalQueues((current) => [...current, created])
        setNotice('Personal queue created.')
        onSaved?.(created.id)
      }
      setMode('list')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save personal queue.')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(queue: ApiPersonalQueue) {
    if (!(await confirm({
      title: 'Delete Personal Queue',
      description: `Are you sure you want to delete the personal queue "${queue.title}"? This cannot be undone.`,
      confirmLabel: 'Delete Queue',
    }))) return

    try {
      await deleteApiPersonalQueue(queue.id)
      setPersonalQueues((current) => current.filter((q) => q.id !== queue.id))
      setNotice('Queue deleted.')
      onDeleted?.(queue.id)
      if (editingId === queue.id) {
        setMode('list')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete personal queue.')
    }
  }

  function renderCriterionValue(criterion: ApiSearchCriterion, index: number) {
    const field = fields.find((f) => f.path === criterion.field) || { path: criterion.field, label: criterion.field, type: 'text' }
    const operator = criterion.operator || 'equals'
    if (!criterionNeedsValue(operator)) {
      return <span className="text-xs text-ink-500 italic">No value needed for this operator</span>
    }
    const renderSecond = operator === 'between'

    if (field.type === 'boolean') {
      return (
        <select
          className={inputClass}
          value={String(criterion.value ?? 'true')}
          onChange={(e) => updateCriterion(index, { value: e.target.value })}
        >
          <option value="true">Yes</option>
          <option value="false">No</option>
        </select>
      )
    }

    if (field.type === 'select' && field.options?.length) {
      if (operator === 'in' || operator === 'not_in') {
        return (
          <select
            multiple
            className={inputClass + ' min-h-20'}
            value={splitValues(criterion.value)}
            onChange={(e) => updateCriterion(index, { value: [...e.target.selectedOptions].map((opt) => opt.value).join(',') })}
          >
            {field.options.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        )
      }
      return (
        <select
          className={inputClass}
          value={String(criterion.value ?? '')}
          onChange={(e) => updateCriterion(index, { value: e.target.value })}
        >
          <option value="">Any</option>
          {field.options.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      )
    }

    if (field.type === 'date') {
      return (
        <div className={renderSecond ? 'grid grid-cols-2 gap-2' : ''}>
          <input
            type="date"
            className={inputClass}
            value={String(criterion.value ?? '')}
            onChange={(e) => updateCriterion(index, { value: e.target.value })}
          />
          {renderSecond ? (
            <input
              type="date"
              className={inputClass}
              value={String(criterion.value2 ?? '')}
              onChange={(e) => updateCriterion(index, { value2: e.target.value })}
            />
          ) : null}
        </div>
      )
    }

    if (field.type === 'number') {
      return (
        <div className={renderSecond ? 'grid grid-cols-2 gap-2' : ''}>
          <input
            type="number"
            className={inputClass}
            value={String(criterion.value ?? '')}
            onChange={(e) => updateCriterion(index, { value: e.target.value })}
          />
          {renderSecond ? (
            <input
              type="number"
              className={inputClass}
              value={String(criterion.value2 ?? '')}
              onChange={(e) => updateCriterion(index, { value2: e.target.value })}
            />
          ) : null}
        </div>
      )
    }

    return (
      <input
        type="text"
        placeholder="Value"
        className={inputClass}
        value={String(criterion.value ?? '')}
        onChange={(e) => updateCriterion(index, { value: e.target.value })}
      />
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Bookmark className="h-5 w-5 text-brand-600" />
              <DialogTitle>
                {mode === 'list' ? 'Personal Queues' : editingId ? 'Edit Personal Queue' : 'New Personal Queue'}
              </DialogTitle>
            </div>
            {mode === 'edit' && (
              <button
                type="button"
                className={btnGhost + ' text-xs'}
                onClick={() => setMode('list')}
              >
                Back to list
              </button>
            )}
          </div>
          <DialogDescription>
            {mode === 'list'
              ? 'Personal queues are customized ticket views visible only to your agent account.'
              : 'Configure search criteria, result columns, and sorting for this queue.'}
          </DialogDescription>
        </DialogHeader>

        {notice ? <p className="text-sm font-medium text-emerald-700 bg-emerald-50 p-2.5 rounded-xl border border-emerald-200">{notice}</p> : null}
        {error ? <p className="text-sm font-medium text-rose-600 bg-rose-50 p-2.5 rounded-xl border border-rose-200">{error}</p> : null}

        {mode === 'list' ? (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-xs text-ink-500 font-medium">
                {personalQueues.length} {personalQueues.length === 1 ? 'queue' : 'queues'} defined
              </p>
              <button
                type="button"
                className={btnPrimary + ' text-xs flex items-center gap-1.5'}
                onClick={startCreate}
              >
                <Plus className="h-3.5 w-3.5" />
                New Personal Queue
              </button>
            </div>

            {loading ? (
              <div className="py-8 text-center text-sm text-ink-500">Loading queues…</div>
            ) : personalQueues.length === 0 ? (
              <div className="py-12 text-center rounded-2xl border border-dashed border-line p-6">
                <Bookmark className="mx-auto h-8 w-8 text-ink-300" />
                <h3 className="mt-2 text-sm font-semibold text-ink-800">No personal queues yet</h3>
                <p className="mt-1 text-xs text-ink-500">
                  Create personal queues with custom filters, columns, and sort orders for your daily workflow.
                </p>
                <button
                  type="button"
                  className={btnPrimary + ' mt-4 text-xs'}
                  onClick={startCreate}
                >
                  Create your first personal queue
                </button>
              </div>
            ) : (
              <div className="grid gap-3">
                {personalQueues.map((queue) => {
                  const parent = parentQueueOptions.find((p) => p.id === queue.parentId)
                  return (
                    <Card key={queue.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <h4 className="font-semibold text-ink-800 truncate">{queue.title}</h4>
                          {parent && (
                            <span className="text-[11px] font-medium bg-paper px-2 py-0.5 rounded-md border border-line text-ink-600">
                              under {parent.title}
                            </span>
                          )}
                        </div>
                        <p className="mt-1 text-xs text-ink-500">
                          {queue.criteria.length ? `${queue.criteria.length} condition${queue.criteria.length > 1 ? 's' : ''}` : 'No conditions'}
                          {' · '}
                          {queue.columns.length} columns
                          {queue.sortBy ? ` · sorted by ${queue.sortBy.field} (${queue.sortBy.direction})` : ''}
                        </p>
                        {queue.notes ? <p className="mt-1 text-xs text-ink-400 italic line-clamp-1">{queue.notes}</p> : null}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {onSelectQueue && (
                          <button
                            type="button"
                            className={btnPrimary + ' text-xs px-3 py-1.5'}
                            onClick={() => {
                              onSelectQueue(queue.id)
                              onOpenChange(false)
                            }}
                          >
                            View
                          </button>
                        )}
                        <button
                          type="button"
                          className={btnGhost + ' text-xs px-3 py-1.5'}
                          onClick={() => startEdit(queue)}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className={btnGhost + ' text-xs text-rose-600 hover:text-rose-700 px-2.5 py-1.5'}
                          onClick={() => void handleDelete(queue)}
                          title="Delete queue"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </Card>
                  )
                })}
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {/* Tabs */}
            <div className="flex border-b border-line gap-2">
              <button
                type="button"
                className={`flex items-center gap-1.5 pb-2.5 text-xs font-medium border-b-2 transition-colors ${
                  activeTab === 'settings' ? 'border-brand-600 text-brand-600' : 'border-transparent text-ink-500 hover:text-ink-800'
                }`}
                onClick={() => setActiveTab('settings')}
              >
                <Settings className="h-3.5 w-3.5" />
                Settings
              </button>
              <button
                type="button"
                className={`flex items-center gap-1.5 pb-2.5 text-xs font-medium border-b-2 transition-colors ${
                  activeTab === 'criteria' ? 'border-brand-600 text-brand-600' : 'border-transparent text-ink-500 hover:text-ink-800'
                }`}
                onClick={() => setActiveTab('criteria')}
              >
                <Filter className="h-3.5 w-3.5" />
                Criteria ({criteria.length})
              </button>
              <button
                type="button"
                className={`flex items-center gap-1.5 pb-2.5 text-xs font-medium border-b-2 transition-colors ${
                  activeTab === 'columns' ? 'border-brand-600 text-brand-600' : 'border-transparent text-ink-500 hover:text-ink-800'
                }`}
                onClick={() => setActiveTab('columns')}
              >
                <Columns3 className="h-3.5 w-3.5" />
                Columns ({columns.length})
              </button>
              <button
                type="button"
                className={`flex items-center gap-1.5 pb-2.5 text-xs font-medium border-b-2 transition-colors ${
                  activeTab === 'sort' ? 'border-brand-600 text-brand-600' : 'border-transparent text-ink-500 hover:text-ink-800'
                }`}
                onClick={() => setActiveTab('sort')}
              >
                <ArrowUpDown className="h-3.5 w-3.5" />
                Sort
              </button>
            </div>

            {/* Tab: Settings */}
            {activeTab === 'settings' && (
              <div className="space-y-4 py-2">
                <Field label="Queue Name *">
                  <input
                    type="text"
                    required
                    maxLength={60}
                    placeholder="e.g. My Urgent Billing Tickets"
                    className={inputClass}
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                  />
                </Field>

                <div className="grid sm:grid-cols-2 gap-4">
                  <Field label="Parent Queue">
                    <select
                      className={inputClass}
                      value={parentId}
                      onChange={(e) => setParentId(e.target.value)}
                    >
                      <option value="0">Top-Level (No parent)</option>
                      {parentQueueOptions.map((q) => (
                        <option key={q.id} value={q.id}>
                          {q.title}
                        </option>
                      ))}
                    </select>
                  </Field>

                  <Field label="Tickets Per Page">
                    <select
                      className={inputClass}
                      value={pageSize}
                      onChange={(e) => setPageSize(Number(e.target.value))}
                    >
                      {[10, 25, 50, 100, 200].map((size) => (
                        <option key={size} value={size}>
                          {size} tickets
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>

                <Field label="Notes / Description">
                  <textarea
                    rows={2}
                    maxLength={500}
                    placeholder="Optional notes or details about when to use this personal queue."
                    className={inputClass}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                  />
                </Field>
              </div>
            )}

            {/* Tab: Criteria */}
            {activeTab === 'criteria' && (
              <div className="space-y-3 py-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs text-ink-500">
                    Define conditions that tickets must match to be included in this personal queue.
                  </p>
                  <button
                    type="button"
                    className={btnGhost + ' text-xs flex items-center gap-1'}
                    onClick={addCriterion}
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Add condition
                  </button>
                </div>

                {criteria.length === 0 ? (
                  <div className="py-8 text-center rounded-xl border border-dashed border-line p-4 text-xs text-ink-500">
                    No conditions configured. All tickets visible to you will match this queue unless conditions are added.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {criteria.map((criterion, idx) => {
                      const field = fields.find((f) => f.path === criterion.field) || { path: criterion.field, label: criterion.field, type: 'text' }
                      const operators = options?.operators[field.type] || [
                        { value: 'equals', label: 'is' },
                        { value: 'not_equals', label: 'is not' },
                      ]

                      return (
                        <div key={idx} className="flex flex-col sm:flex-row items-start sm:items-center gap-2 p-3 rounded-xl border border-line bg-paper">
                          <select
                            className={inputClass + ' sm:w-44'}
                            value={criterion.field}
                            onChange={(e) => updateCriterion(idx, { field: e.target.value })}
                          >
                            {fields.map((f) => (
                              <option key={f.path} value={f.path}>{f.label}</option>
                            ))}
                          </select>

                          <select
                            className={inputClass + ' sm:w-36'}
                            value={criterion.operator || operators[0]?.value}
                            onChange={(e) => updateCriterion(idx, { operator: e.target.value })}
                          >
                            {operators.map((op) => (
                              <option key={op.value} value={op.value}>{op.label}</option>
                            ))}
                          </select>

                          <div className="flex-1 min-w-0 w-full sm:w-auto">
                            {renderCriterionValue(criterion, idx)}
                          </div>

                          <button
                            type="button"
                            className="p-1.5 text-ink-400 hover:text-rose-600 rounded-lg hover:bg-rose-50"
                            onClick={() => removeCriterion(idx)}
                            title="Remove condition"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Tab: Columns */}
            {activeTab === 'columns' && (
              <div className="space-y-4 py-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs text-ink-500">
                    Choose which columns to show in the ticket table and their display order.
                  </p>
                  <button
                    type="button"
                    className="text-xs text-brand-600 hover:underline"
                    onClick={() => setColumns(DEFAULT_COLUMNS)}
                  >
                    Reset to default
                  </button>
                </div>

                <div className="flex gap-2">
                  <select
                    className={inputClass + ' flex-1'}
                    defaultValue=""
                    onChange={(e) => {
                      const selected = fields.find((f) => f.path === e.target.value)
                      if (selected) addColumn(selected)
                      e.target.value = ''
                    }}
                  >
                    <option value="">+ Add a column from available fields…</option>
                    {fields
                      .filter((f) => !columns.some((c) => c.path === f.path))
                      .map((f) => (
                        <option key={f.path} value={f.path}>{f.label} ({f.group})</option>
                      ))}
                  </select>
                </div>

                <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
                  {columns.map((col, idx) => (
                    <div key={col.path} className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl border border-line bg-surface text-sm">
                      <span className="font-medium text-ink-800">{col.label}</span>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          disabled={idx === 0}
                          className="p-1 text-ink-400 hover:text-ink-800 disabled:opacity-30"
                          onClick={() => moveColumn(idx, -1)}
                          title="Move up"
                        >
                          <ArrowUp className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          disabled={idx === columns.length - 1}
                          className="p-1 text-ink-400 hover:text-ink-800 disabled:opacity-30"
                          onClick={() => moveColumn(idx, 1)}
                          title="Move down"
                        >
                          <ArrowDown className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          className="p-1 text-ink-400 hover:text-rose-600"
                          onClick={() => removeColumn(col.path)}
                          title="Remove column"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Tab: Sort */}
            {activeTab === 'sort' && (
              <div className="space-y-4 py-2">
                <p className="text-xs text-ink-500">
                  Select the default field and direction used to sort tickets in this personal queue.
                </p>

                <div className="grid sm:grid-cols-2 gap-4">
                  <Field label="Sort Field">
                    <select
                      className={inputClass}
                      value={sort.field}
                      onChange={(e) => setSort((s) => ({ ...s, field: e.target.value }))}
                    >
                      {fields.length > 0
                        ? fields.map((f) => (
                            <option key={f.path} value={f.path}>{f.label}</option>
                          ))
                        : [
                            { path: 'updated', label: 'Last Updated' },
                            { path: 'created', label: 'Date Created' },
                            { path: 'priority', label: 'Priority' },
                            { path: 'due', label: 'Due Date' },
                            { path: 'number', label: 'Ticket Number' },
                          ].map((f) => (
                            <option key={f.path} value={f.path}>{f.label}</option>
                          ))}
                    </select>
                  </Field>

                  <Field label="Direction">
                    <select
                      className={inputClass}
                      value={sort.direction}
                      onChange={(e) => setSort((s) => ({ ...s, direction: e.target.value as 'asc' | 'desc' }))}
                    >
                      <option value="desc">Descending (newest / highest first)</option>
                      <option value="asc">Ascending (oldest / lowest first)</option>
                    </select>
                  </Field>
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="flex items-center justify-end gap-2 pt-4 border-t border-line">
              <button
                type="button"
                className={btnGhost}
                disabled={saving}
                onClick={() => setMode('list')}
              >
                Cancel
              </button>
              <button
                type="button"
                className={btnPrimary}
                disabled={saving}
                onClick={() => void handleSave()}
              >
                {saving ? 'Saving…' : editingId ? 'Update Queue' : 'Save Personal Queue'}
              </button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
