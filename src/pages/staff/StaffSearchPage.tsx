import { FormEvent, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { PriorityBadge, StatusBadge } from '../../components/Badges'
import { btnGhost, btnPrimary, Card, Field, inputClass, PageHeader } from '../../components/ui'
import { useDialogs } from '../../context/DialogContext'
import {
  createApiSavedSearch,
  deleteApiSavedSearch,
  getApiAdvancedSearchOptions,
  saveApiSearchSettings,
  searchApiTickets,
  updateApiSavedSearch,
  type ApiAdvancedSearchInput,
  type ApiAdvancedSearchOptions,
  type ApiAdvancedSearchResult,
  type ApiSavedSearch,
  type ApiSavedSearchInput,
  type ApiSearchColumn,
  type ApiSearchCriterion,
  type ApiSearchField,
  type ApiSearchSort,
  type ApiSearchTicket,
} from '../../lib/api'
import { formatDate } from '../../lib/format'
import type { Priority, TicketStatus } from '../../types'

type Tab = 'criteria' | 'columns' | 'settings'

const FALLBACK_COLUMNS: ApiSearchColumn[] = [
  { path: 'number', label: 'Ticket Number', type: 'text', sortable: true },
  { path: 'subject', label: 'Subject', type: 'text', sortable: true },
  { path: 'status', label: 'Status', type: 'select', sortable: true },
  { path: 'priority', label: 'Priority', type: 'select', sortable: true },
  { path: 'department', label: 'Department', type: 'select', sortable: true },
  { path: 'assignee', label: 'Assigned Staff', type: 'select', sortable: true },
  { path: 'updated', label: 'Last Updated', type: 'date', sortable: true },
]
const VALUE_FREE_OPERATORS = new Set(['set', 'not_set', 'empty', 'not_empty'])
const PAGE_SIZES = [10, 25, 50, 100, 200]
const DEFAULT_SORT: ApiSearchSort = { field: 'updated', direction: 'desc' }

function columnFromField(field: ApiSearchField): ApiSearchColumn {
  return { path: field.path, label: field.label, type: field.type, sortable: true }
}

function splitValues(value: unknown): string[] {
  return String(value ?? '').split(',').map((item) => item.trim()).filter(Boolean)
}

function criterionNeedsValue(operator: string | undefined) {
  return !VALUE_FREE_OPERATORS.has(operator || 'equals')
}

function isCriterionUsable(criterion: ApiSearchCriterion) {
  if (!criterion.field) return false
  const operator = criterion.operator || 'equals'
  if (!criterionNeedsValue(operator)) return true
  if (criterion.value === undefined || criterion.value === null || String(criterion.value).trim() === '') return false
  if (operator === 'between' && String(criterion.value2 ?? '').trim() === '') return false
  return true
}

function formatCellValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (Array.isArray(value)) return value.join(', ')
  return String(value)
}

function escapeCsv(value: string) {
  const text = value.replace(/\r?\n/g, ' ')
  return /[",]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text
}

function timestamp(value: string) {
  const parsed = new Date(value)
  return Number.isFinite(parsed.getTime()) ? formatDate(value) : value
}

export function StaffSearchPage() {
  const { confirm } = useDialogs()
  const [options, setOptions] = useState<ApiAdvancedSearchOptions | null>(null)
  const [optionsError, setOptionsError] = useState('')
  const [savedSearches, setSavedSearches] = useState<ApiSavedSearch[]>([])
  const [activeSavedId, setActiveSavedId] = useState('')
  const [tab, setTab] = useState<Tab>('criteria')
  const [q, setQ] = useState('')
  const [criteria, setCriteria] = useState<ApiSearchCriterion[]>([])
  const [columns, setColumns] = useState<ApiSearchColumn[]>(FALLBACK_COLUMNS)
  const [sort, setSort] = useState<ApiSearchSort>(DEFAULT_SORT)
  const [pageSize, setPageSize] = useState(25)
  const [quickFilter, setQuickFilter] = useState('')
  const [quickFilterValue, setQuickFilterValue] = useState('')
  const [settings, setSettings] = useState<Record<string, unknown>>({})
  const [exportConfig, setExportConfig] = useState<Record<string, unknown>>({})
  const [title, setTitle] = useState('')
  const [results, setResults] = useState<ApiAdvancedSearchResult | null>(null)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    let active = true
    getApiAdvancedSearchOptions()
      .then((result) => {
        if (!active) return
        setOptions(result)
        setSavedSearches(result.savedSearches)
        const stored = result.settings as { columns?: ApiSearchColumn[]; sort?: ApiSearchSort; pageSize?: number; quickFilter?: string }
        const defaultColumns = result.defaults.columns.length ? result.defaults.columns.map(columnFromField) : FALLBACK_COLUMNS
        setColumns(stored.columns?.length ? stored.columns : defaultColumns)
        setSort(stored.sort?.field ? stored.sort : result.defaults.sort || DEFAULT_SORT)
        setPageSize(Number(stored.pageSize) || result.defaults.pageSize || 25)
        setQuickFilter(stored.quickFilter || '')
      })
      .catch((err: unknown) => {
        if (!active) return
        setOptionsError(err instanceof Error ? err.message : 'Could not load search options.')
      })
    return () => { active = false }
  }, [])

  const fields = options?.fields || []
  const fieldByPath = useMemo(() => new Map(fields.map((field) => [field.path, field])), [fields])
  const groupedFields = useMemo(() => {
    const groups = new Map<string, ApiSearchField[]>()
    for (const field of fields) {
      if (!groups.has(field.group)) groups.set(field.group, [])
      groups.get(field.group)!.push(field)
    }
    return [...groups.entries()]
  }, [fields])
  const selectedColumnPaths = useMemo(() => new Set(columns.map((column) => column.path)), [columns])
  const quickFilterField = options?.quickFilters.find((item) => item.path === quickFilter)

  function usableCriteria() {
    return criteria.filter(isCriterionUsable)
  }

  function buildInput(nextPage = page, overrides: Partial<ApiAdvancedSearchInput> = {}): ApiAdvancedSearchInput {
    return {
      q,
      criteria: usableCriteria(),
      columns,
      sort,
      page: nextPage,
      pageSize,
      quickFilter: quickFilter || undefined,
      quickFilterValue: quickFilterValue || undefined,
      ...overrides,
    }
  }

  async function performSearch(input: ApiAdvancedSearchInput) {
    setLoading(true)
    setError('')
    setNotice('')
    try {
      const result = await searchApiTickets(input)
      setResults(result)
      setPage(result.page)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed.')
    } finally {
      setLoading(false)
    }
  }

  function runSearch(nextPage = 1, overrides: Partial<ApiAdvancedSearchInput> = {}) {
    return performSearch(buildInput(nextPage, overrides))
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    void runSearch(1)
  }

  function newSearch() {
    const defaultColumns = options?.defaults.columns.length ? options.defaults.columns.map(columnFromField) : FALLBACK_COLUMNS
    setTitle('')
    setActiveSavedId('')
    setQ('')
    setCriteria([])
    setColumns(defaultColumns)
    setSort(options?.defaults.sort || DEFAULT_SORT)
    setPageSize(options?.defaults.pageSize || 25)
    setQuickFilter('')
    setQuickFilterValue('')
    setSettings(options?.settings || {})
    setExportConfig({})
    setResults(null)
    setPage(1)
    setError('')
    setNotice('')
    setTab('criteria')
  }

  function addCriterion() {
    const first = fields.find((field) => field.path === 'number') || fields[0]
    if (!first) return
    setCriteria((current) => [...current, { field: first.path, operator: options?.operators[first.type]?.[0]?.value || 'contains', value: '' }])
  }

  function updateCriterion(index: number, patch: Partial<ApiSearchCriterion>) {
    setCriteria((current) => current.map((criterion, position) => position === index ? { ...criterion, ...patch } : criterion))
  }

  function removeCriterion(index: number) {
    setCriteria((current) => current.filter((_, position) => position !== index))
  }

  function addColumn(field: ApiSearchField) {
    setColumns((current) => current.some((column) => column.path === field.path) ? current : [...current, columnFromField(field)])
  }

  function removeColumn(path: string) {
    setColumns((current) => current.filter((column) => column.path !== path))
  }

  function updateColumn(path: string, patch: Partial<ApiSearchColumn>) {
    setColumns((current) => current.map((column) => column.path === path ? { ...column, ...patch } : column))
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

  function loadSaved(search: ApiSavedSearch) {
    const config = search.config
    const nextColumns = config.columns?.length ? config.columns : (options?.defaults.columns.length ? options.defaults.columns.map(columnFromField) : FALLBACK_COLUMNS)
    const nextSort = config.sort?.field ? config.sort : options?.defaults.sort || DEFAULT_SORT
    setTitle(search.title)
    setActiveSavedId(search.id)
    setQ(config.q || '')
    setCriteria(config.criteria || [])
    setColumns(nextColumns)
    setSort(nextSort)
    setPageSize(config.pageSize || 25)
    setQuickFilter(config.quickFilter || '')
    setQuickFilterValue('')
    setSettings(config.settings || {})
    setExportConfig(config.exportConfig || {})
    setTab('criteria')
    setError('')
    void performSearch({
      q: config.q || '',
      criteria: (config.criteria || []).filter(isCriterionUsable),
      columns: nextColumns,
      sort: nextSort,
      page: 1,
      pageSize: config.pageSize || 25,
      quickFilter: config.quickFilter || undefined,
      savedSearchId: search.id,
    })
  }

  async function saveSearch() {
    if (!title.trim()) {
      setError('Enter a title before saving this search.')
      setTab('settings')
      return
    }
    setSaving(true)
    setError('')
    setNotice('')
    const input: ApiSavedSearchInput = {
      title: title.trim(),
      q,
      criteria: usableCriteria(),
      columns,
      sort,
      pageSize,
      quickFilter,
      settings,
      exportConfig,
    }
    try {
      const search = activeSavedId
        ? await updateApiSavedSearch(activeSavedId, input)
        : await createApiSavedSearch(input)
      setActiveSavedId(search.id)
      setTitle(search.title)
      setSavedSearches((current) => current.some((item) => item.id === search.id) ? current.map((item) => item.id === search.id ? search : item) : [...current, search])
      setNotice(activeSavedId ? 'Saved search updated.' : 'Saved search created.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save this search.')
    } finally {
      setSaving(false)
    }
  }

  async function removeSaved(search: ApiSavedSearch) {
    if (!(await confirm({
      title: 'Delete saved search',
      description: `Delete the saved search “${search.title}”?`,
      confirmLabel: 'Delete',
    }))) return
    setError('')
    try {
      await deleteApiSavedSearch(search.id)
      setSavedSearches((current) => current.filter((item) => item.id !== search.id))
      if (activeSavedId === search.id) newSearch()
      setNotice('Saved search deleted.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete this search.')
    }
  }

  async function saveDefaults() {
    setSaving(true)
    setError('')
    setNotice('')
    try {
      await saveApiSearchSettings({ columns, sort, pageSize, quickFilter })
      setNotice('Default search display settings saved.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save display settings.')
    } finally {
      setSaving(false)
    }
  }

  function changeSort(field: ApiSearchField) {
    const next: ApiSearchSort = sort.field === field.path && sort.direction === 'desc'
      ? { field: field.path, direction: 'asc' }
      : { field: field.path, direction: 'desc' }
    setSort(next)
    void runSearch(1, { sort: next })
  }

  async function exportCsv() {
    if (!results) return
    setError('')
    try {
      let rows = results.tickets
      if (exportConfig.includeAll === true) {
        const collected: ApiSearchTicket[] = []
        const totalPages = Math.min(results.pages, 50)
        for (let index = 1; index <= totalPages; index += 1) {
          const result = await searchApiTickets(buildInput(index, { pageSize: 200 }))
          collected.push(...result.tickets)
        }
        rows = collected
      }
      const exportColumns = results.columns.length ? results.columns : columns
      const header = exportColumns.map((column) => escapeCsv(column.label)).join(',')
      const body = rows.map((ticket) => exportColumns.map((column) => escapeCsv(formatCellValue(ticket.values[column.path]))).join(',')).join('\r\n')
      const blob = new Blob([header + '\r\n' + body], { type: 'text/csv;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `ticket-search-${new Date().toISOString().slice(0, 10)}.csv`
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not export these results.')
    }
  }

  function renderCell(ticket: ApiSearchTicket, column: ApiSearchColumn) {
    const value = ticket.values[column.path]
    if (column.path === 'number') return <Link to={`/scp/tickets/${ticket.id}`} className="font-medium text-brand-600">{formatCellValue(value)}</Link>
    if (column.path === 'subject') return <div><Link to={`/scp/tickets/${ticket.id}`} className="hover:underline">{formatCellValue(value)}</Link>{ticket.snippet ? <p className="mt-1 max-w-xl text-xs text-ink-500">{ticket.snippet}</p> : null}</div>
    if (column.path === 'status') return <StatusBadge status={String(value || ticket.status) as TicketStatus} />
    if (column.path === 'priority') return <PriorityBadge priority={String(value || ticket.priority) as Priority} />
    if (column.type === 'date') return value ? timestamp(String(value)) : '—'
    if (column.type === 'boolean') return value === true ? 'Yes' : value === false ? 'No' : '—'
    return formatCellValue(value)
  }

  function renderCriterionValue(criterion: ApiSearchCriterion) {
    const field = fieldByPath.get(criterion.field)
    if (!field) return null
    const operator = criterion.operator || 'equals'
    if (!criterionNeedsValue(operator)) return null
    const renderSecond = operator === 'between'
    if (field.type === 'boolean') {
      return (
        <select className={inputClass} value={String(criterion.value ?? 'true')} onChange={(event) => updateCriterion(criteria.indexOf(criterion), { value: event.target.value })}>
          <option value="true">Yes</option>
          <option value="false">No</option>
        </select>
      )
    }
    if (field.type === 'select' && field.options?.length) {
      if (operator === 'in' || operator === 'not_in') {
        return (
          <select multiple className={inputClass + ' min-h-24'} value={splitValues(criterion.value)} onChange={(event) => updateCriterion(criteria.indexOf(criterion), { value: [...event.target.selectedOptions].map((option) => option.value).join(',') })}>
            {field.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        )
      }
      return (
        <select className={inputClass} value={String(criterion.value ?? '')} onChange={(event) => updateCriterion(criteria.indexOf(criterion), { value: event.target.value })}>
          <option value="">Any</option>
          {field.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      )
    }
    if (field.type === 'date') {
      return (
        <div className={renderSecond ? 'grid gap-2 sm:grid-cols-2' : ''}>
          <input type="date" className={inputClass} value={String(criterion.value ?? '')} onChange={(event) => updateCriterion(criteria.indexOf(criterion), { value: event.target.value })} />
          {renderSecond ? <input type="date" className={inputClass} value={String(criterion.value2 ?? '')} onChange={(event) => updateCriterion(criteria.indexOf(criterion), { value2: event.target.value })} /> : null}
        </div>
      )
    }
    if (field.type === 'number') {
      return (
        <div className={renderSecond ? 'grid gap-2 sm:grid-cols-2' : ''}>
          <input type="number" className={inputClass} value={String(criterion.value ?? '')} onChange={(event) => updateCriterion(criteria.indexOf(criterion), { value: event.target.value })} />
          {renderSecond ? <input type="number" className={inputClass} value={String(criterion.value2 ?? '')} onChange={(event) => updateCriterion(criteria.indexOf(criterion), { value2: event.target.value })} /> : null}
        </div>
      )
    }
    return <input className={inputClass} placeholder="Value" value={String(criterion.value ?? '')} onChange={(event) => updateCriterion(criteria.indexOf(criterion), { value: event.target.value })} />
  }

  return (
    <div>
      <PageHeader
        title="Advanced Ticket Search"
        subtitle="Combine ticket fields, custom form data, requester details, keywords, saved searches, and custom result columns."
        actions={<><button type="button" className={btnGhost} onClick={newSearch}>New search</button><button type="button" className={btnPrimary} disabled={loading} onClick={() => void runSearch(1)}>{loading ? 'Searching…' : 'Search tickets'}</button></>}
      />

      {optionsError ? <p className="mb-4 text-sm text-rose-600">{optionsError}</p> : null}
      {error ? <p className="mb-4 text-sm text-rose-600">{error}</p> : null}
      {notice ? <p className="mb-4 text-sm text-emerald-700">{notice}</p> : null}

      <div className="grid gap-5 lg:grid-cols-[16rem_minmax(0,1fr)]">
        <aside className="space-y-4">
          <Card>
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-semibold">My searches</h2>
              <button type="button" className="text-xs font-medium text-brand-600" onClick={newSearch}>Clear</button>
            </div>
            <div className="mt-3 space-y-1">
              {savedSearches.map((search) => (
                <div key={search.id} className={`flex items-start gap-1 rounded-xl px-2 py-1.5 ${activeSavedId === search.id ? 'bg-brand-50 text-brand-800' : 'hover:bg-paper'}`}>
                  <button type="button" className="min-w-0 flex-1 text-left text-sm" onClick={() => loadSaved(search)}>
                    <span className="block truncate font-medium">{search.title}</span>
                    <span className="block text-xs text-ink-500">{search.owner ? 'Private' : 'Shared'}{search.config.criteria.length ? ` · ${search.config.criteria.length} criteria` : ''}</span>
                  </button>
                  {search.editable ? <button type="button" className="px-1 text-xs text-rose-600" title="Delete saved search" onClick={() => void removeSaved(search)}>×</button> : null}
                </div>
              ))}
              {savedSearches.length === 0 ? <p className="text-sm text-ink-500">No saved searches yet.</p> : null}
            </div>
          </Card>

          <Card>
            <h2 className="font-semibold">Quick filters</h2>
            <p className="mt-1 text-xs text-ink-500">Choose a field to expose as a quick filter above the results.</p>
            <select className={inputClass + ' mt-3'} value={quickFilter} onChange={(event) => { setQuickFilter(event.target.value); setQuickFilterValue('') }}>
              <option value="">No quick filter</option>
              {(options?.quickFilters || []).map((filter) => <option key={filter.path} value={filter.path}>{filter.label}</option>)}
            </select>
          </Card>
        </aside>

        <div className="min-w-0 space-y-5">
          <Card>
            <div className="flex flex-wrap gap-2 border-b border-line pb-3">
              {([
                ['criteria', 'Criteria'],
                ['columns', 'Columns'],
                ['settings', 'Settings'],
              ] as const).map(([value, label]) => (
                <button key={value} type="button" onClick={() => setTab(value)} className={`rounded-full px-3 py-1.5 text-sm ${tab === value ? 'bg-brand-600 text-white' : 'bg-paper text-ink-700'}`}>{label}</button>
              ))}
            </div>

            {tab === 'criteria' ? (
              <form onSubmit={onSubmit} className="mt-4 space-y-4">
                <Field label="Keywords">
                  <input value={q} onChange={(event) => setQ(event.target.value)} className={inputClass} placeholder="Ticket number, subject, requester, organization, message body, or custom field value" />
                </Field>
                <p className="text-xs text-ink-500">All words must match somewhere in the ticket, requester, custom fields, thread, or search index.</p>

                <div className="space-y-3">
                  {criteria.map((criterion, index) => {
                    const field = fieldByPath.get(criterion.field)
                    const operators = field ? (options?.operators[field.type] || []) : []
                    return (
                      <div key={`${criterion.field}-${index}`} className="grid gap-2 rounded-xl border border-line bg-paper p-3 md:grid-cols-[minmax(10rem,1fr)_minmax(9rem,0.8fr)_minmax(10rem,1.2fr)_auto]">
                        <select className={inputClass} value={criterion.field} onChange={(event) => {
                          const nextField = fieldByPath.get(event.target.value)
                          updateCriterion(index, { field: event.target.value, operator: nextField ? (options?.operators[nextField.type]?.[0]?.value || 'contains') : 'contains', value: '', value2: '' })
                        }}>
                          {groupedFields.map(([group, groupFields]) => <optgroup key={group} label={group}>{groupFields.map((item) => <option key={item.path} value={item.path}>{item.label}</option>)}</optgroup>)}
                        </select>
                        <select className={inputClass} value={criterion.operator || operators[0]?.value || 'equals'} onChange={(event) => updateCriterion(index, { operator: event.target.value, value2: '' })}>
                          {operators.map((operator) => <option key={operator.value} value={operator.value}>{operator.label}</option>)}
                        </select>
                        <div className="min-w-0">{renderCriterionValue(criterion)}</div>
                        <button type="button" className={btnGhost} onClick={() => removeCriterion(index)} aria-label="Remove criterion">Remove</button>
                      </div>
                    )
                  })}
                  {criteria.length === 0 ? <p className="text-sm text-ink-500">No field criteria yet. Add criteria below or search by keyword alone.</p> : null}
                </div>

                <div className="flex flex-wrap gap-2">
                  <button type="button" className={btnGhost} onClick={addCriterion} disabled={!fields.length}>Add criterion</button>
                  <button type="button" className={btnGhost} onClick={() => { setCriteria([]); setQ(''); setQuickFilterValue('') }}>Reset criteria</button>
                  <button type="submit" className={btnPrimary} disabled={loading}>{loading ? 'Searching…' : 'Search'}</button>
                </div>
              </form>
            ) : null}

            {tab === 'columns' ? (
              <div className="mt-4 space-y-5">
                <div>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h2 className="font-semibold">Selected columns</h2>
                    <button type="button" className={btnGhost} onClick={() => setColumns((options?.defaults.columns.length ? options.defaults.columns : FALLBACK_COLUMNS).map((field) => 'path' in field ? field : columnFromField(field as ApiSearchField)) as ApiSearchColumn[])}>Use default columns</button>
                  </div>
                  <div className="mt-3 space-y-2">
                    {columns.map((column, index) => (
                      <div key={column.path} className="grid gap-2 rounded-xl border border-line bg-paper p-3 sm:grid-cols-[minmax(8rem,0.8fr)_minmax(10rem,1.2fr)_5rem_auto]">
                        <span className="self-center text-sm font-medium text-ink-700">{column.path}</span>
                        <input className={inputClass} value={column.label} onChange={(event) => updateColumn(column.path, { label: event.target.value })} aria-label="Column heading" />
                        <input type="number" min={40} className={inputClass} value={column.width ?? ''} onChange={(event) => updateColumn(column.path, { width: Number(event.target.value) || undefined })} placeholder="Width" aria-label="Column width" />
                        <div className="flex gap-1">
                          <button type="button" className={btnGhost} disabled={index === 0} onClick={() => moveColumn(index, -1)} aria-label="Move column up">↑</button>
                          <button type="button" className={btnGhost} disabled={index === columns.length - 1} onClick={() => moveColumn(index, 1)} aria-label="Move column down">↓</button>
                          <button type="button" className={btnGhost} onClick={() => removeColumn(column.path)} aria-label="Remove column">×</button>
                        </div>
                      </div>
                    ))}
                    {columns.length === 0 ? <p className="text-sm text-ink-500">Select at least one column to display results.</p> : null}
                  </div>
                </div>

                <div>
                  <h2 className="font-semibold">Available columns</h2>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                    {groupedFields.map(([group, groupFields]) => (
                      <div key={group} className="rounded-xl border border-line p-3">
                        <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">{group}</p>
                        <div className="mt-2 space-y-1">
                          {groupFields.map((field) => (
                            <label key={field.path} className="flex items-center gap-2 text-sm">
                              <input type="checkbox" checked={selectedColumnPaths.has(field.path)} onChange={(event) => event.target.checked ? addColumn(field) : removeColumn(field.path)} />
                              <span>{field.label}</span>
                            </label>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : null}

            {tab === 'settings' ? (
              <div className="mt-4 space-y-5">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Search title"><input className={inputClass} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="e.g. Overdue high priority tickets" /></Field>
                  <Field label="Quick filter field">
                    <select className={inputClass} value={quickFilter} onChange={(event) => { setQuickFilter(event.target.value); setQuickFilterValue('') }}>
                      <option value="">No quick filter</option>
                      {(options?.quickFilters || []).map((filter) => <option key={filter.path} value={filter.path}>{filter.label}</option>)}
                    </select>
                  </Field>
                  <Field label="Default sorting">
                    <select className={inputClass} value={sort.field} onChange={(event) => setSort({ ...sort, field: event.target.value })}>
                      {(options?.sorts || []).map((field) => <option key={field.path} value={field.path}>{field.label}</option>)}
                    </select>
                  </Field>
                  <Field label="Sort direction">
                    <select className={inputClass} value={sort.direction} onChange={(event) => setSort({ field: sort.field, direction: event.target.value === 'asc' ? 'asc' : 'desc' })}>
                      <option value="desc">Descending</option>
                      <option value="asc">Ascending</option>
                    </select>
                  </Field>
                  <Field label="Results per page">
                    <select className={inputClass} value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))}>
                      {PAGE_SIZES.map((size) => <option key={size} value={size}>{size}</option>)}
                    </select>
                  </Field>
                  <Field label="Export">
                    <label className="flex min-h-10 items-center gap-2 text-sm text-ink-700">
                      <input type="checkbox" checked={exportConfig.includeAll === true} onChange={(event) => setExportConfig({ ...exportConfig, includeAll: event.target.checked })} />
                      Include all matching tickets, not just this page
                    </label>
                  </Field>
                </div>

                <div className="flex flex-wrap gap-2">
                  <button type="button" className={btnPrimary} disabled={saving} onClick={() => void saveSearch()}>{saving ? 'Saving…' : activeSavedId ? 'Save changes' : 'Save search'}</button>
                  <button type="button" className={btnGhost} disabled={saving} onClick={() => void saveDefaults()}>Save as my defaults</button>
                  {activeSavedId ? <button type="button" className={btnGhost} onClick={() => { const current = savedSearches.find((item) => item.id === activeSavedId); if (current) void removeSaved(current) }}>Delete saved search</button> : null}
                </div>
                <p className="text-xs text-ink-500">Saving stores the keyword, criteria, columns, sorting, quick filter, page size, and export preference in the queue tables.</p>
              </div>
            ) : null}
          </Card>

          {results ? (
            <Card>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="font-semibold">Results ({results.total.toLocaleString()})</h2>
                  <p className="text-xs text-ink-500">Page {results.page} of {Math.max(1, results.pages)} · showing {results.tickets.length} ticket{results.tickets.length === 1 ? '' : 's'}{results.keyword ? ` · keyword “${results.keyword}”` : ''}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {quickFilterField ? (
                    <select className={inputClass + ' w-auto'} value={quickFilterValue} onChange={(event) => { const value = event.target.value; setQuickFilterValue(value); void runSearch(1, { quickFilter: quickFilter, quickFilterValue: value || undefined }) }}>
                      <option value="">All {quickFilterField.label.toLocaleLowerCase()}</option>
                      {quickFilterField.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                    </select>
                  ) : null}
                  <button type="button" className={btnGhost} onClick={() => void exportCsv()}>Export CSV</button>
                </div>
              </div>

              <div className="-mx-4 mt-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
                <table className="w-full min-w-[48rem] text-left text-sm">
                  <thead className="bg-paper text-ink-600">
                    <tr>
                      {results.columns.map((column) => {
                        const definition = fieldByPath.get(column.path)
                        const active = sort.field === column.path
                        return (
                          <th key={column.path} className="whitespace-nowrap px-4 py-3 font-medium">
                            <button type="button" className={active ? 'text-brand-700' : ''} onClick={() => definition ? changeSort(definition) : undefined}>
                              {column.label}{active ? (sort.direction === 'asc' ? ' ↑' : ' ↓') : ''}
                            </button>
                          </th>
                        )
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {results.tickets.map((ticket) => (
                      <tr key={ticket.id} className="border-t border-line align-top">
                        {results.columns.map((column) => <td key={column.path} className="max-w-[20rem] break-words px-4 py-3">{renderCell(ticket, column)}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {results.tickets.length === 0 ? <p className="mt-4 text-sm text-ink-600">No tickets matched these criteria.</p> : null}
              {results.pages > 1 ? (
                <div className="mt-4 flex items-center justify-between gap-3">
                  <button type="button" className={btnGhost} disabled={results.page <= 1 || loading} onClick={() => void runSearch(results.page - 1)}>Previous</button>
                  <span className="text-sm text-ink-600">Page {results.page} of {results.pages}</span>
                  <button type="button" className={btnGhost} disabled={results.page >= results.pages || loading} onClick={() => void runSearch(results.page + 1)}>Next</button>
                </div>
              ) : null}
            </Card>
          ) : (
            <Card>
              <h2 className="font-semibold">Start searching</h2>
              <p className="mt-1 text-sm text-ink-600">Add one or more criteria, enter keywords, or load a saved search. Results update with the columns and sorting you choose.</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" className={btnPrimary} onClick={() => void runSearch(1)}>Show recent tickets</button>
                <button type="button" className={btnGhost} onClick={addCriterion} disabled={!fields.length}>Add criterion</button>
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}
