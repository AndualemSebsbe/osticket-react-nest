import { useEffect, useMemo, useState, type FormEvent } from 'react'
import {
  AlertCircle,
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Ban,
  CheckCircle2,
  Edit3,
  ExternalLink,
  FileSpreadsheet,
  FileText,
  Layers,
  ListFilter,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Tag,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import { btnGhost, btnPrimary, Card, Field, inputClass, PageHeader } from '../../components/ui'
import { useDialogs } from '../../context/DialogContext'
import { formatDate } from '../../lib/format'
import { accountSessionToken } from '../../lib/store'
import {
  addApiListItem,
  createApiList,
  createApiTicketStatus,
  deleteApiList,
  deleteApiListItem,
  deleteApiTicketStatus,
  getApiList,
  importApiListItems,
  listApiLists,
  listApiTicketStatuses,
  massApiListAction,
  massApiListItemAction,
  massApiTicketStatusAction,
  reorderApiListItems,
  saveApiListProperties,
  updateApiList,
  updateApiListItem,
  updateApiTicketStatus,
  type ApiListDetail,
  type ApiListItem,
  type ApiListPropertyFieldInput,
  type ApiListSortMode,
  type ApiListSummary,
  type ApiTicketState,
  type ApiTicketStatus,
  type ApiTicketStatusInput,
} from '../../lib/api'

type MainTab = 'lists' | 'statuses'
type EditorTab = 'definition' | 'items' | 'properties' | 'forms'
type StatusFilter = 'all' | 'open' | 'closed' | 'archived' | 'deleted'

const SORT_MODES: Array<{ value: ApiListSortMode; label: string; desc: string }> = [
  { value: 'Alpha', label: 'Alphabetical', desc: 'Sort items by value in ascending alphabetical order' },
  { value: '-Alpha', label: 'Alphabetical (Reversed)', desc: 'Sort items by value in descending alphabetical order' },
  { value: 'SortCol', label: 'Manually Sorted', desc: 'Sort items in custom drag-and-drop or manual order' },
]

const PROPERTY_TYPES = [
  { value: 'text', label: 'Short Answer (text)' },
  { value: 'memo', label: 'Long Answer (textarea)' },
  { value: 'datetime', label: 'Date and Time' },
  { value: 'phone', label: 'Phone Number' },
  { value: 'bool', label: 'Checkbox' },
  { value: 'int', label: 'Number' },
  { value: 'choices', label: 'Choices / Dropdown' },
]

export function AdminListsPage() {
  const { confirm } = useDialogs()
  const token = accountSessionToken()

  // Navigation State
  const [mainTab, setMainTab] = useState<MainTab>('lists')
  const [editingListId, setEditingListId] = useState<string | null>(null)
  const [isNewList, setIsNewList] = useState(false)
  const [editorTab, setEditorTab] = useState<EditorTab>('definition')

  // Data State
  const [lists, setLists] = useState<ApiListSummary[]>([])
  const [statuses, setStatuses] = useState<ApiTicketStatus[]>([])
  const [currentList, setCurrentList] = useState<ApiListDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  // Lists View Filters & Selection
  const [listSearch, setListSearch] = useState('')
  const [sortModeFilter, setSortModeFilter] = useState<'all' | ApiListSortMode>('all')
  const [selectedListIds, setSelectedListIds] = useState<string[]>([])

  // Ticket Statuses Filters & Selection
  const [statusSearch, setStatusSearch] = useState('')
  const [statusStateFilter, setStatusStateFilter] = useState<StatusFilter>('all')
  const [selectedStatusIds, setSelectedStatusIds] = useState<string[]>([])

  // List Editor Form State
  const [listName, setListName] = useState('')
  const [listNamePlural, setListNamePlural] = useState('')
  const [listSortMode, setListSortMode] = useState<ApiListSortMode>('Alpha')
  const [listNotes, setListNotes] = useState('')
  const [itemSearch, setItemSearch] = useState('')
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([])

  // Properties Editor State
  const [propFields, setPropFields] = useState<ApiListPropertyFieldInput[]>([])

  // Modals State
  const [itemModalOpen, setItemModalOpen] = useState(false)
  const [editingItem, setEditingItem] = useState<ApiListItem | null>(null)
  const [itemValue, setItemValue] = useState('')
  const [itemExtra, setItemExtra] = useState('')
  const [itemStatus, setItemStatus] = useState<number>(1)
  const [itemProperties, setItemProperties] = useState<Record<string, any>>({})

  // Import Modal State
  const [importModalOpen, setImportModalOpen] = useState(false)
  const [importText, setImportText] = useState('')

  // Status Modal State
  const [statusModalOpen, setStatusModalOpen] = useState(false)
  const [editingStatus, setEditingStatus] = useState<ApiTicketStatus | null>(null)
  const [statusForm, setStatusForm] = useState<ApiTicketStatusInput>({
    name: '',
    state: 'open',
    sort: 1,
    properties: { reopenable: true, description: '' },
  })

  // Load Initial Data
  const loadData = async () => {
    try {
      setLoading(true)
      const [listsRes, statusesRes] = await Promise.all([
        listApiLists(token),
        listApiTicketStatuses(token),
      ])
      setLists(listsRes.lists)
      setStatuses(statusesRes.statuses)
      setError('')
    } catch (err: any) {
      setError(err?.message || 'Failed to load custom lists and statuses.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [])

  // Auto-clear messages
  useEffect(() => {
    if (!success && !error) return
    const timer = setTimeout(() => {
      setSuccess('')
      setError('')
    }, 6000)
    return () => clearTimeout(timer)
  }, [success, error])

  // Open List in Editor
  const openList = async (id: string) => {
    try {
      setLoading(true)
      const res = await getApiList(id, token)
      setCurrentList(res.list)
      setEditingListId(id)
      setIsNewList(false)
      setEditorTab('definition')

      // Populate form
      setListName(res.list.name)
      setListNamePlural(res.list.namePlural || '')
      setListSortMode(res.list.sortMode)
      setListNotes(res.list.notes || '')
      setPropFields(
        res.list.properties.map(p => ({
          id: p.id,
          label: p.label,
          name: p.name,
          type: p.type,
          sort: p.sort,
          flags: p.flags,
          hint: p.hint,
          configuration: p.configuration,
        }))
      )
      setSelectedItemIds([])
      setItemSearch('')
    } catch (err: any) {
      setError(err?.message || 'Could not load list details.')
    } finally {
      setLoading(false)
    }
  }

  // Open New List Form
  const openNewList = () => {
    setCurrentList(null)
    setEditingListId(null)
    setIsNewList(true)
    setEditorTab('definition')
    setListName('')
    setListNamePlural('')
    setListSortMode('Alpha')
    setListNotes('')
    setPropFields([])
    setSelectedItemIds([])
  }

  // Close Editor and return to list view
  const closeEditor = () => {
    setEditingListId(null)
    setIsNewList(false)
    setCurrentList(null)
    loadData()
  }

  // ==========================================
  // CUSTOM LIST SAVE / DELETE
  // ==========================================

  const handleSaveList = async (e: FormEvent) => {
    e.preventDefault()
    if (!listName.trim()) {
      setError('List Name is required.')
      return
    }

    try {
      setSaving(true)
      if (isNewList) {
        const res = await createApiList(
          {
            name: listName.trim(),
            name_plural: listNamePlural.trim() || undefined,
            sort_mode: listSortMode,
            notes: listNotes,
          },
          token
        )
        setSuccess(`Custom list "${res.list.name}" created successfully.`)
        await openList(res.list.id)
      } else if (editingListId) {
        const res = await updateApiList(
          editingListId,
          {
            name: listName.trim(),
            name_plural: listNamePlural.trim() || undefined,
            sort_mode: listSortMode,
            notes: listNotes,
          },
          token
        )
        setCurrentList(res.list)
        setSuccess('List settings saved.')
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to save list.')
    } finally {
      setSaving(false)
    }
  }

  const handleDeleteList = async (id: string, name: string) => {
    const ok = await confirm({
      title: 'Delete Custom List',
      description: `Are you sure you want to delete "${name}"? All items and custom property settings for this list will be removed permanently.`,
      confirmLabel: 'Delete List',
      destructive: true,
    })
    if (!ok) return

    try {
      setSaving(true)
      await deleteApiList(id, token)
      setSuccess(`List "${name}" deleted.`)
      if (editingListId === id) closeEditor()
      else loadData()
    } catch (err: any) {
      setError(err?.message || 'Failed to delete list.')
    } finally {
      setSaving(false)
    }
  }

  const handleMassListDelete = async () => {
    if (selectedListIds.length === 0) return
    const ok = await confirm({
      title: 'Delete Selected Lists',
      description: `Are you sure you want to delete ${selectedListIds.length} custom list(s)? Lists in use by forms may not be deleted until unlinked.`,
      confirmLabel: 'Delete Selected',
      destructive: true,
    })
    if (!ok) return

    try {
      setSaving(true)
      const res = await massApiListAction('delete', selectedListIds, token)
      setSuccess(`Deleted ${res.affected} list(s).`)
      setSelectedListIds([])
      loadData()
    } catch (err: any) {
      setError(err?.message || 'Failed to execute mass delete.')
    } finally {
      setSaving(false)
    }
  }

  // ==========================================
  // LIST ITEMS ACTIONS
  // ==========================================

  const openAddItemModal = () => {
    setEditingItem(null)
    setItemValue('')
    setItemExtra('')
    setItemStatus(1)
    setItemProperties({})
    setItemModalOpen(true)
  }

  const openEditItemModal = (item: ApiListItem) => {
    setEditingItem(item)
    setItemValue(item.value)
    setItemExtra(item.extra || '')
    setItemStatus(item.status)
    setItemProperties(item.properties || {})
    setItemModalOpen(true)
  }

  const handleSaveItem = async (e: FormEvent) => {
    e.preventDefault()
    if (!currentList || !itemValue.trim()) {
      setError('Item value is required.')
      return
    }

    try {
      setSaving(true)
      if (editingItem) {
        await updateApiListItem(
          currentList.id,
          editingItem.id,
          {
            value: itemValue.trim(),
            extra: itemExtra.trim() || undefined,
            status: itemStatus,
            properties: itemProperties,
          },
          token
        )
        setSuccess(`Item "${itemValue}" updated.`)
      } else {
        await addApiListItem(
          currentList.id,
          {
            value: itemValue.trim(),
            extra: itemExtra.trim() || undefined,
            status: itemStatus,
            properties: itemProperties,
          },
          token
        )
        setSuccess(`Item "${itemValue}" added.`)
      }
      setItemModalOpen(false)
      const res = await getApiList(currentList.id, token)
      setCurrentList(res.list)
    } catch (err: any) {
      setError(err?.message || 'Failed to save list item.')
    } finally {
      setSaving(false)
    }
  }

  const handleDeleteItem = async (itemId: string, value: string) => {
    if (!currentList) return
    const ok = await confirm({
      title: 'Delete List Item',
      description: `Delete item "${value}" from list?`,
      confirmLabel: 'Delete Item',
      destructive: true,
    })
    if (!ok) return

    try {
      setSaving(true)
      await deleteApiListItem(currentList.id, itemId, token)
      setSuccess(`Item "${value}" deleted.`)
      const res = await getApiList(currentList.id, token)
      setCurrentList(res.list)
    } catch (err: any) {
      setError(err?.message || 'Failed to delete list item.')
    } finally {
      setSaving(false)
    }
  }

  const handleToggleItemStatus = async (item: ApiListItem) => {
    if (!currentList) return
    const newStatus = item.status === 1 ? 0 : 1
    try {
      await updateApiListItem(currentList.id, item.id, { value: item.value, status: newStatus }, token)
      const res = await getApiList(currentList.id, token)
      setCurrentList(res.list)
    } catch (err: any) {
      setError(err?.message || 'Failed to update item status.')
    }
  }

  const handleMassItemAction = async (action: 'enable' | 'disable' | 'delete') => {
    if (!currentList || selectedItemIds.length === 0) return
    if (action === 'delete') {
      const ok = await confirm({
        title: 'Delete Selected Items',
        description: `Delete ${selectedItemIds.length} selected item(s)?`,
        confirmLabel: 'Delete Items',
        destructive: true,
      })
      if (!ok) return
    }

    try {
      setSaving(true)
      const res = await massApiListItemAction(currentList.id, action, selectedItemIds, token)
      setSuccess(`Successfully processed ${res.affected} item(s).`)
      setSelectedItemIds([])
      const updated = await getApiList(currentList.id, token)
      setCurrentList(updated.list)
    } catch (err: any) {
      setError(err?.message || 'Failed to perform mass item action.')
    } finally {
      setSaving(false)
    }
  }

  const handleMoveItem = async (index: number, direction: 'up' | 'down') => {
    if (!currentList) return
    const items = [...currentList.items]
    const targetIndex = direction === 'up' ? index - 1 : index + 1
    if (targetIndex < 0 || targetIndex >= items.length) return

    const [moved] = items.splice(index, 1)
    items.splice(targetIndex, 0, moved)

    const ids = items.map(i => i.id)
    try {
      setSaving(true)
      await reorderApiListItems(currentList.id, ids, token)
      setListSortMode('SortCol')
      const res = await getApiList(currentList.id, token)
      setCurrentList(res.list)
    } catch (err: any) {
      setError(err?.message || 'Failed to reorder items.')
    } finally {
      setSaving(false)
    }
  }

  // Import Items handler
  const handleImportSubmit = async () => {
    if (!currentList || !importText.trim()) return
    const lines = importText.split('\n')
    const parsed: Array<{ value: string; extra?: string }> = []

    for (const rawLine of lines) {
      const line = rawLine.trim()
      if (!line) continue
      if (line.includes(',')) {
        const parts = line.split(',')
        const val = parts[0].trim()
        const ext = parts.slice(1).join(',').trim()
        if (val) parsed.push({ value: val, extra: ext || undefined })
      } else if (line.includes('\t')) {
        const parts = line.split('\t')
        const val = parts[0].trim()
        const ext = parts.slice(1).join(' ').trim()
        if (val) parsed.push({ value: val, extra: ext || undefined })
      } else {
        parsed.push({ value: line })
      }
    }

    if (parsed.length === 0) {
      setError('No valid items found to import.')
      return
    }

    try {
      setSaving(true)
      const res = await importApiListItems(currentList.id, parsed, token)
      setSuccess(`Successfully imported ${res.imported} item(s).`)
      setImportModalOpen(false)
      setImportText('')
      const updated = await getApiList(currentList.id, token)
      setCurrentList(updated.list)
    } catch (err: any) {
      setError(err?.message || 'Failed to import items.')
    } finally {
      setSaving(false)
    }
  }

  // ==========================================
  // PROPERTIES MANAGEMENT
  // ==========================================

  const handleAddPropertyRow = () => {
    setPropFields(prev => [
      ...prev,
      {
        label: '',
        name: '',
        type: 'text',
        sort: prev.length + 1,
        flags: 1,
        hint: '',
        configuration: {},
      },
    ])
  }

  const handleUpdatePropertyField = (index: number, patch: Partial<ApiListPropertyFieldInput>) => {
    setPropFields(prev => {
      const next = [...prev]
      next[index] = { ...next[index], ...patch }
      if (patch.label && !next[index].name) {
        next[index].name = patch.label.toLowerCase().replace(/[^a-z0-9_]/g, '_')
      }
      return next
    })
  }

  const handleDeletePropertyField = (index: number) => {
    setPropFields(prev => {
      const field = prev[index]
      if (field.id) {
        // Mark for deletion on backend
        const next = [...prev]
        next[index] = { ...field, delete: true }
        return next
      }
      return prev.filter((_, i) => i !== index)
    })
  }

  const handleSaveProperties = async () => {
    if (!currentList) return
    try {
      setSaving(true)
      await saveApiListProperties(currentList.id, propFields, token)
      setSuccess('Item properties saved successfully.')
      const res = await getApiList(currentList.id, token)
      setCurrentList(res.list)
      setPropFields(
        res.list.properties.map(p => ({
          id: p.id,
          label: p.label,
          name: p.name,
          type: p.type,
          sort: p.sort,
          flags: p.flags,
          hint: p.hint,
          configuration: p.configuration,
        }))
      )
    } catch (err: any) {
      setError(err?.message || 'Failed to save properties.')
    } finally {
      setSaving(false)
    }
  }

  // ==========================================
  // TICKET STATUSES ACTIONS
  // ==========================================

  const openAddStatusModal = () => {
    setEditingStatus(null)
    setStatusForm({
      name: '',
      state: 'open',
      sort: (statuses.length ? Math.max(...statuses.map(s => s.sort)) : 0) + 1,
      properties: { reopenable: true, description: '' },
    })
    setStatusModalOpen(true)
  }

  const openEditStatusModal = (status: ApiTicketStatus) => {
    setEditingStatus(status)
    setStatusForm({
      name: status.name,
      state: status.state,
      sort: status.sort,
      properties: {
        reopenable: status.reopenable,
        description: status.description,
      },
    })
    setStatusModalOpen(true)
  }

  const handleSaveStatus = async (e: FormEvent) => {
    e.preventDefault()
    if (!statusForm.name.trim()) {
      setError('Status name is required.')
      return
    }

    try {
      setSaving(true)
      if (editingStatus) {
        await updateApiTicketStatus(editingStatus.id, statusForm, token)
        setSuccess(`Status "${statusForm.name}" updated.`)
      } else {
        await createApiTicketStatus(statusForm, token)
        setSuccess(`Status "${statusForm.name}" created.`)
      }
      setStatusModalOpen(false)
      loadData()
    } catch (err: any) {
      setError(err?.message || 'Failed to save ticket status.')
    } finally {
      setSaving(false)
    }
  }

  const handleDeleteStatus = async (status: ApiTicketStatus) => {
    if (status.isSystem) {
      setError(`Cannot delete system status "${status.name}".`)
      return
    }
    if (status.ticketCount > 0) {
      setError(
        `Cannot delete status "${status.name}": ${status.ticketCount} ticket(s) are currently in this status.`
      )
      return
    }

    const ok = await confirm({
      title: 'Delete Ticket Status',
      description: `Are you sure you want to delete status "${status.name}"?`,
      confirmLabel: 'Delete Status',
      destructive: true,
    })
    if (!ok) return

    try {
      setSaving(true)
      await deleteApiTicketStatus(status.id, token)
      setSuccess(`Status "${status.name}" deleted.`)
      loadData()
    } catch (err: any) {
      setError(err?.message || 'Failed to delete status.')
    } finally {
      setSaving(false)
    }
  }

  const handleMassStatusDelete = async () => {
    if (selectedStatusIds.length === 0) return
    const ok = await confirm({
      title: 'Delete Selected Statuses',
      description: `Delete ${selectedStatusIds.length} selected status(es)? Protected or in-use statuses will be skipped.`,
      confirmLabel: 'Delete Selected',
      destructive: true,
    })
    if (!ok) return

    try {
      setSaving(true)
      const res = await massApiTicketStatusAction('delete', selectedStatusIds, token)
      setSuccess(`Deleted ${res.affected} status(es).`)
      setSelectedStatusIds([])
      loadData()
    } catch (err: any) {
      setError(err?.message || 'Failed to execute mass status delete.')
    } finally {
      setSaving(false)
    }
  }

  // ==========================================
  // FILTERED LISTS & ITEMS
  // ==========================================

  const filteredLists = useMemo(() => {
    return lists.filter(l => {
      const matchSearch =
        !listSearch ||
        l.name.toLowerCase().includes(listSearch.toLowerCase()) ||
        l.namePlural.toLowerCase().includes(listSearch.toLowerCase()) ||
        l.notes.toLowerCase().includes(listSearch.toLowerCase())
      const matchSort = sortModeFilter === 'all' || l.sortMode === sortModeFilter
      return matchSearch && matchSort
    })
  }, [lists, listSearch, sortModeFilter])

  const filteredItems = useMemo(() => {
    if (!currentList) return []
    return currentList.items.filter(item => {
      if (!itemSearch) return true
      const q = itemSearch.toLowerCase()
      return (
        item.value.toLowerCase().includes(q) ||
        item.extra.toLowerCase().includes(q) ||
        JSON.stringify(item.properties).toLowerCase().includes(q)
      )
    })
  }, [currentList, itemSearch])

  const filteredStatuses = useMemo(() => {
    return statuses.filter(s => {
      const matchSearch =
        !statusSearch ||
        s.name.toLowerCase().includes(statusSearch.toLowerCase()) ||
        s.description.toLowerCase().includes(statusSearch.toLowerCase())
      const matchState = statusStateFilter === 'all' || s.state === statusStateFilter
      return matchSearch && matchState
    })
  }, [statuses, statusSearch, statusStateFilter])

  // Helper for status badge
  const renderStateBadge = (state: ApiTicketState) => {
    switch (state) {
      case 'open':
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700 border border-emerald-200">
            <span className="size-1.5 rounded-full bg-emerald-500" />
            Open
          </span>
        )
      case 'closed':
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-700 border border-slate-200">
            <span className="size-1.5 rounded-full bg-slate-500" />
            Closed
          </span>
        )
      case 'archived':
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-purple-50 px-2.5 py-0.5 text-xs font-medium text-purple-700 border border-purple-200">
            <span className="size-1.5 rounded-full bg-purple-500" />
            Archived
          </span>
        )
      case 'deleted':
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2.5 py-0.5 text-xs font-medium text-rose-700 border border-rose-200">
            <span className="size-1.5 rounded-full bg-rose-500" />
            Deleted
          </span>
        )
    }
  }

  // ==========================================
  // RENDER: LIST EDITOR VIEW
  // ==========================================

  if (editingListId || isNewList) {
    return (
      <div className="space-y-6">
        {/* Editor Top Bar */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={closeEditor}
              className="inline-flex size-9 items-center justify-center rounded-lg border border-line bg-surface text-ink-600 hover:bg-paper hover:text-ink-900 transition-colors"
              title="Back to Custom Lists"
            >
              <ArrowLeft className="size-4" />
            </button>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold text-ink-900">
                  {isNewList ? 'Add New Custom List' : `Update Custom List — ${currentList?.name}`}
                </h1>
                {!isNewList && (
                  <span className="rounded-full bg-brand-50 px-2.5 py-0.5 text-xs font-semibold text-brand-700 border border-brand-200">
                    ID #{editingListId}
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-xs text-ink-600">
                Configure dropdown values, ordering, properties, and forms binding for this list.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={closeEditor}
              className={btnGhost}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSaveList}
              disabled={saving}
              className={btnPrimary}
            >
              {saving ? 'Saving...' : isNewList ? 'Add List' : 'Save Changes'}
            </button>
          </div>
        </div>

        {/* Notifications */}
        {error && (
          <div className="flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3.5 text-sm text-rose-700">
            <AlertCircle className="size-4 shrink-0 text-rose-600" />
            <span>{error}</span>
          </div>
        )}
        {success && (
          <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3.5 text-sm text-emerald-700">
            <CheckCircle2 className="size-4 shrink-0 text-emerald-600" />
            <span>{success}</span>
          </div>
        )}

        {/* Tab Navigation */}
        <div className="border-b border-line">
          <nav className="-mb-px flex space-x-6">
            <button
              type="button"
              onClick={() => setEditorTab('definition')}
              className={`flex items-center gap-2 border-b-2 py-3 text-sm font-medium transition-colors ${
                editorTab === 'definition'
                  ? 'border-brand-600 text-brand-600'
                  : 'border-transparent text-ink-600 hover:border-line hover:text-ink-900'
              }`}
            >
              <Settings className="size-4" />
              <span>Definition</span>
            </button>

            {!isNewList && (
              <>
                <button
                  type="button"
                  onClick={() => setEditorTab('items')}
                  className={`flex items-center gap-2 border-b-2 py-3 text-sm font-medium transition-colors ${
                    editorTab === 'items'
                      ? 'border-brand-600 text-brand-600'
                      : 'border-transparent text-ink-600 hover:border-line hover:text-ink-900'
                  }`}
                >
                  <Tag className="size-4" />
                  <span>Items</span>
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700">
                    {currentList?.itemCount ?? 0}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setEditorTab('properties')}
                  className={`flex items-center gap-2 border-b-2 py-3 text-sm font-medium transition-colors ${
                    editorTab === 'properties'
                      ? 'border-brand-600 text-brand-600'
                      : 'border-transparent text-ink-600 hover:border-line hover:text-ink-900'
                  }`}
                >
                  <Layers className="size-4" />
                  <span>Item Properties</span>
                  {currentList?.properties?.length ? (
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700">
                      {currentList.properties.length}
                    </span>
                  ) : null}
                </button>

                <button
                  type="button"
                  onClick={() => setEditorTab('forms')}
                  className={`flex items-center gap-2 border-b-2 py-3 text-sm font-medium transition-colors ${
                    editorTab === 'forms'
                      ? 'border-brand-600 text-brand-600'
                      : 'border-transparent text-ink-600 hover:border-line hover:text-ink-900'
                  }`}
                >
                  <FileText className="size-4" />
                  <span>Forms Using This List</span>
                  {currentList?.formsCount ? (
                    <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-800 font-semibold">
                      {currentList.formsCount}
                    </span>
                  ) : null}
                </button>
              </>
            )}
          </nav>
        </div>

        {/* Tab 1: Definition */}
        {editorTab === 'definition' && (
          <Card>
            <form onSubmit={handleSaveList} className="space-y-6">
              <div className="rounded-xl border border-sky-100 bg-sky-50/60 p-4 text-xs text-sky-800">
                <strong>About Custom Lists:</strong> Custom lists allow defining reusable sets of choices that end-users
                and agents select on ticket and user forms. Once created, add items under the <em>Items</em> tab and
                attach the list to forms in <strong>Admin Panel &gt; Manage &gt; Forms</strong>.
              </div>

              <div className="grid gap-5 sm:grid-cols-2">
                <Field label="List Name *">
                  <input
                    type="text"
                    required
                    value={listName}
                    onChange={e => setListName(e.target.value)}
                    placeholder="e.g. Asset Category, Priority Branches"
                    className={inputClass}
                  />
                  <p className="mt-1 text-xs text-ink-500">
                    The singular name for this option list (e.g., &quot;Department&quot; or &quot;Branch&quot;).
                  </p>
                </Field>

                <Field label="Plural Name">
                  <input
                    type="text"
                    value={listNamePlural}
                    onChange={e => setListNamePlural(e.target.value)}
                    placeholder={listName ? `${listName}s` : 'e.g. Asset Categories'}
                    className={inputClass}
                  />
                  <p className="mt-1 text-xs text-ink-500">
                    How this list appears in the &quot;Field Type&quot; dropdown in form designer.
                  </p>
                </Field>

                <div className="sm:col-span-2">
                  <Field label="Sort Order">
                    <select
                      value={listSortMode}
                      onChange={e => setListSortMode(e.target.value as ApiListSortMode)}
                      className={inputClass}
                    >
                      {SORT_MODES.map(sm => (
                        <option key={sm.value} value={sm.value}>
                          {sm.label} — {sm.desc}
                        </option>
                      ))}
                    </select>
                    <p className="mt-1 text-xs text-ink-500">
                      Choose alphabetical or manual drag-and-drop sort order for options in drop-down menus.
                    </p>
                  </Field>
                </div>

                <div className="sm:col-span-2">
                  <Field label="Internal Notes">
                    <textarea
                      rows={4}
                      value={listNotes}
                      onChange={e => setListNotes(e.target.value)}
                      placeholder="Administrative notes, source data info, or instructions..."
                      className={inputClass}
                    />
                  </Field>
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-line">
                <button type="button" onClick={closeEditor} className={btnGhost}>
                  Cancel
                </button>
                <button type="submit" disabled={saving} className={btnPrimary}>
                  {saving ? 'Saving...' : isNewList ? 'Add List' : 'Save Changes'}
                </button>
              </div>
            </form>
          </Card>
        )}

        {/* Tab 2: Items */}
        {editorTab === 'items' && currentList && (
          <div className="space-y-4">
            {/* Top Toolbar */}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="relative flex-1 sm:max-w-xs">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-400" />
                <input
                  type="text"
                  placeholder="Search list items..."
                  value={itemSearch}
                  onChange={e => setItemSearch(e.target.value)}
                  className={`${inputClass} pl-9`}
                />
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {selectedItemIds.length > 0 && (
                  <div className="flex items-center gap-1.5 mr-2">
                    <span className="text-xs font-semibold text-ink-700">
                      {selectedItemIds.length} selected:
                    </span>
                    <button
                      type="button"
                      onClick={() => handleMassItemAction('enable')}
                      className="rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-100"
                    >
                      Enable
                    </button>
                    <button
                      type="button"
                      onClick={() => handleMassItemAction('disable')}
                      className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
                    >
                      Disable
                    </button>
                    <button
                      type="button"
                      onClick={() => handleMassItemAction('delete')}
                      className="rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1 text-xs font-medium text-rose-700 hover:bg-rose-100"
                    >
                      Delete
                    </button>
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => setImportModalOpen(true)}
                  className={btnGhost}
                >
                  <Upload className="mr-1.5 size-4" />
                  Import Items
                </button>

                <button
                  type="button"
                  onClick={openAddItemModal}
                  className={btnPrimary}
                >
                  <Plus className="mr-1.5 size-4" />
                  Add New Item
                </button>
              </div>
            </div>

            {/* Items Table */}
            <div className="overflow-hidden rounded-2xl border border-line bg-surface shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-line bg-paper/60 text-xs font-medium uppercase tracking-wider text-ink-500">
                    <tr>
                      <th className="w-10 px-4 py-3 text-center">
                        <input
                          type="checkbox"
                          checked={
                            filteredItems.length > 0 &&
                            selectedItemIds.length === filteredItems.length
                          }
                          onChange={e => {
                            if (e.target.checked) {
                              setSelectedItemIds(filteredItems.map(i => i.id))
                            } else {
                              setSelectedItemIds([])
                            }
                          }}
                          className="size-4 rounded border-line text-brand-600 focus:ring-brand-500"
                        />
                      </th>
                      {currentList.sortMode === 'SortCol' && (
                        <th className="w-20 px-3 py-3 text-center">Sort</th>
                      )}
                      <th className="px-4 py-3">Value</th>
                      <th className="px-4 py-3">Abbreviation</th>
                      <th className="px-4 py-3">Status</th>
                      {currentList.properties.map(p => (
                        <th key={p.id} className="px-4 py-3">
                          {p.label}
                        </th>
                      ))}
                      <th className="px-4 py-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {filteredItems.length === 0 ? (
                      <tr>
                        <td
                          colSpan={5 + (currentList.properties.length || 0)}
                          className="px-6 py-12 text-center text-ink-500"
                        >
                          <Tag className="mx-auto size-8 text-ink-400 mb-2 opacity-50" />
                          <p className="font-medium text-ink-700">No items in this list yet</p>
                          <p className="text-xs text-ink-500 mt-1">
                            Click &quot;Add New Item&quot; or &quot;Import Items&quot; to populate choices.
                          </p>
                        </td>
                      </tr>
                    ) : (
                      filteredItems.map((item, idx) => {
                        const isSelected = selectedItemIds.includes(item.id)
                        return (
                          <tr
                            key={item.id}
                            className={`transition-colors hover:bg-paper/40 ${
                              !item.enabled ? 'opacity-60 bg-paper/20' : ''
                            } ${isSelected ? 'bg-brand-50/40' : ''}`}
                          >
                            <td className="px-4 py-3 text-center">
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={e => {
                                  if (e.target.checked) {
                                    setSelectedItemIds(prev => [...prev, item.id])
                                  } else {
                                    setSelectedItemIds(prev => prev.filter(id => id !== item.id))
                                  }
                                }}
                                className="size-4 rounded border-line text-brand-600 focus:ring-brand-500"
                              />
                            </td>

                            {currentList.sortMode === 'SortCol' && (
                              <td className="px-3 py-3 text-center">
                                <div className="flex items-center justify-center gap-1">
                                  <button
                                    type="button"
                                    disabled={idx === 0}
                                    onClick={() => handleMoveItem(idx, 'up')}
                                    className="p-1 rounded text-ink-400 hover:text-ink-800 disabled:opacity-20"
                                    title="Move item up"
                                  >
                                    <ArrowUp className="size-3.5" />
                                  </button>
                                  <button
                                    type="button"
                                    disabled={idx === filteredItems.length - 1}
                                    onClick={() => handleMoveItem(idx, 'down')}
                                    className="p-1 rounded text-ink-400 hover:text-ink-800 disabled:opacity-20"
                                    title="Move item down"
                                  >
                                    <ArrowDown className="size-3.5" />
                                  </button>
                                </div>
                              </td>
                            )}

                            <td className="px-4 py-3 font-medium text-ink-900">
                              <button
                                type="button"
                                onClick={() => openEditItemModal(item)}
                                className="hover:text-brand-600 hover:underline text-left"
                              >
                                {item.value}
                              </button>
                            </td>

                            <td className="px-4 py-3 text-ink-600 text-xs">
                              {item.extra ? (
                                <span className="rounded bg-slate-100 px-2 py-0.5 font-mono text-slate-700">
                                  {item.extra}
                                </span>
                              ) : (
                                <span className="text-ink-400 italic">—</span>
                              )}
                            </td>

                            <td className="px-4 py-3">
                              <button
                                type="button"
                                onClick={() => handleToggleItemStatus(item)}
                                className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium border transition-colors ${
                                  item.enabled
                                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'
                                    : 'bg-slate-100 text-slate-600 border-slate-200 hover:bg-slate-200'
                                }`}
                              >
                                {item.enabled ? (
                                  <>
                                    <CheckCircle2 className="size-3 text-emerald-600" />
                                    Enabled
                                  </>
                                ) : (
                                  <>
                                    <Ban className="size-3 text-slate-500" />
                                    Disabled
                                  </>
                                )}
                              </button>
                            </td>

                            {currentList.properties.map(p => (
                              <td key={p.id} className="px-4 py-3 text-xs text-ink-700">
                                {item.properties[p.name] !== undefined
                                  ? String(item.properties[p.name])
                                  : '—'}
                              </td>
                            ))}

                            <td className="px-4 py-3 text-right">
                              <div className="flex items-center justify-end gap-1">
                                <button
                                  type="button"
                                  onClick={() => openEditItemModal(item)}
                                  className="p-1.5 text-ink-500 hover:text-brand-600 hover:bg-paper rounded-lg transition-colors"
                                  title="Edit item"
                                >
                                  <Edit3 className="size-4" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteItem(item.id, item.value)}
                                  className="p-1.5 text-ink-500 hover:text-rose-600 hover:bg-paper rounded-lg transition-colors"
                                  title="Delete item"
                                >
                                  <Trash2 className="size-4" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        )
                      })
                    )}
                  </tbody>
                </table>
              </div>

              {filteredItems.length > 0 && (
                <div className="border-t border-line px-4 py-3 text-xs text-ink-500 flex items-center justify-between">
                  <span>
                    Showing {filteredItems.length} of {currentList.itemCount} items
                  </span>
                  <span>Sort mode: {currentList.sortMode}</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Tab 3: Item Properties */}
        {editorTab === 'properties' && currentList && (
          <div className="space-y-4">
            <Card>
              <div className="mb-4">
                <h3 className="text-base font-semibold text-ink-900">Item Properties</h3>
                <p className="mt-1 text-xs text-ink-600">
                  Item properties define additional attributes captured for each option in this list (for instance,
                  assignee, asset tag, phone number, location, etc.).
                </p>
              </div>

              {propFields.filter(f => !f.delete).length === 0 ? (
                <div className="rounded-xl border border-dashed border-line p-8 text-center">
                  <Layers className="mx-auto size-8 text-ink-400 opacity-60 mb-2" />
                  <p className="text-sm font-medium text-ink-700">No item properties defined</p>
                  <p className="text-xs text-ink-500 mt-1 mb-4">
                    Items will only consist of a Value and Abbreviation unless custom properties are added.
                  </p>
                  <button type="button" onClick={handleAddPropertyRow} className={btnGhost}>
                    <Plus className="mr-1.5 size-4" />
                    Add First Property
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead className="border-b border-line bg-paper/60 text-xs font-medium uppercase text-ink-500">
                        <tr>
                          <th className="px-3 py-2.5">Label *</th>
                          <th className="px-3 py-2.5">Variable Name *</th>
                          <th className="px-3 py-2.5">Type</th>
                          <th className="px-3 py-2.5">Hint / Help</th>
                          <th className="w-12 px-3 py-2.5 text-center">Delete</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-line">
                        {propFields.map((field, idx) => {
                          if (field.delete) return null
                          return (
                            <tr key={idx} className="hover:bg-paper/30">
                              <td className="px-3 py-2.5">
                                <input
                                  type="text"
                                  required
                                  value={field.label}
                                  onChange={e =>
                                    handleUpdatePropertyField(idx, { label: e.target.value })
                                  }
                                  placeholder="e.g. Asset Tag"
                                  className={inputClass}
                                />
                              </td>
                              <td className="px-3 py-2.5">
                                <input
                                  type="text"
                                  required
                                  value={field.name}
                                  onChange={e =>
                                    handleUpdatePropertyField(idx, { name: e.target.value })
                                  }
                                  placeholder="e.g. asset_tag"
                                  className={`${inputClass} font-mono text-xs`}
                                />
                              </td>
                              <td className="px-3 py-2.5">
                                <select
                                  value={field.type}
                                  onChange={e =>
                                    handleUpdatePropertyField(idx, { type: e.target.value })
                                  }
                                  className={inputClass}
                                >
                                  {PROPERTY_TYPES.map(pt => (
                                    <option key={pt.value} value={pt.value}>
                                      {pt.label}
                                    </option>
                                  ))}
                                </select>
                              </td>
                              <td className="px-3 py-2.5">
                                <input
                                  type="text"
                                  value={field.hint || ''}
                                  onChange={e =>
                                    handleUpdatePropertyField(idx, { hint: e.target.value })
                                  }
                                  placeholder="Optional hint"
                                  className={inputClass}
                                />
                              </td>
                              <td className="px-3 py-2.5 text-center">
                                <button
                                  type="button"
                                  onClick={() => handleDeletePropertyField(idx)}
                                  className="p-1 text-ink-400 hover:text-rose-600 rounded"
                                  title="Delete property"
                                >
                                  <Trash2 className="size-4" />
                                </button>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>

                  <div className="flex items-center justify-between pt-3">
                    <button
                      type="button"
                      onClick={handleAddPropertyRow}
                      className={btnGhost}
                    >
                      <Plus className="mr-1.5 size-4" />
                      Add Another Property
                    </button>

                    <button
                      type="button"
                      onClick={handleSaveProperties}
                      disabled={saving}
                      className={btnPrimary}
                    >
                      {saving ? 'Saving...' : 'Save Properties'}
                    </button>
                  </div>
                </div>
              )}
            </Card>
          </div>
        )}

        {/* Tab 4: Forms Using This List */}
        {editorTab === 'forms' && currentList && (
          <div className="space-y-4">
            <Card>
              <div className="mb-4">
                <h3 className="text-base font-semibold text-ink-900">
                  Forms Configured with &quot;{currentList.name}&quot;
                </h3>
                <p className="mt-1 text-xs text-ink-600">
                  Whenever a form field selects this custom list as its Field Type, it binds options to ticket or
                  user submissions.
                </p>
              </div>

              {currentList.formsUsing.length === 0 ? (
                <div className="rounded-xl border border-dashed border-line p-8 text-center">
                  <FileText className="mx-auto size-8 text-ink-400 opacity-60 mb-2" />
                  <p className="text-sm font-medium text-ink-700">Not currently used in any forms</p>
                  <p className="text-xs text-ink-500 mt-1 mb-4">
                    To use this list in tickets or custom forms, edit a form in Admin Panel &gt; Manage &gt; Forms and
                    select &quot;List: {currentList.name}&quot; as the field type.
                  </p>
                  <Link to="/scp/admin/forms" className={btnGhost}>
                    Go to Manage Forms
                  </Link>
                </div>
              ) : (
                <div className="overflow-x-auto rounded-xl border border-line">
                  <table className="w-full text-left text-sm">
                    <thead className="border-b border-line bg-paper/60 text-xs font-medium uppercase text-ink-500">
                      <tr>
                        <th className="px-4 py-3">Form Name</th>
                        <th className="px-4 py-3">Field Label</th>
                        <th className="px-4 py-3">Field Variable</th>
                        <th className="px-4 py-3">Form Type</th>
                        <th className="px-4 py-3 text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {currentList.formsUsing.map((fu, idx) => (
                        <tr key={idx} className="hover:bg-paper/30">
                          <td className="px-4 py-3 font-semibold text-ink-900">
                            {fu.formTitle}
                          </td>
                          <td className="px-4 py-3 text-ink-700">{fu.fieldLabel}</td>
                          <td className="px-4 py-3 font-mono text-xs text-ink-500">
                            {fu.fieldName}
                          </td>
                          <td className="px-4 py-3">
                            <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs text-slate-700 font-medium">
                              {fu.formType === 'G' ? 'Custom Form' : `Built-in (${fu.formType})`}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right">
                            <Link
                              to="/scp/admin/forms"
                              className="inline-flex items-center gap-1 text-xs font-semibold text-brand-600 hover:text-brand-700 hover:underline"
                            >
                              <span>Edit in Forms</span>
                              <ExternalLink className="size-3" />
                            </Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </div>
        )}

        {/* Modal: Add / Edit Item */}
        {itemModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-xs">
            <div className="w-full max-w-md rounded-2xl border border-line bg-surface p-6 shadow-xl">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-base font-bold text-ink-900">
                  {editingItem ? 'Edit List Item' : 'Add New List Item'}
                </h3>
                <button
                  type="button"
                  onClick={() => setItemModalOpen(false)}
                  className="rounded-lg p-1 text-ink-400 hover:bg-paper hover:text-ink-700"
                >
                  <X className="size-4" />
                </button>
              </div>

              <form onSubmit={handleSaveItem} className="space-y-4">
                <Field label="Item Value *">
                  <input
                    type="text"
                    required
                    autoFocus
                    value={itemValue}
                    onChange={e => setItemValue(e.target.value)}
                    placeholder="e.g. Sales Department, Building 4"
                    className={inputClass}
                  />
                </Field>

                <Field label="Abbreviation">
                  <input
                    type="text"
                    value={itemExtra}
                    onChange={e => setItemExtra(e.target.value)}
                    placeholder="e.g. SD, B4"
                    className={inputClass}
                  />
                  <p className="mt-1 text-xs text-ink-500">
                    Recommended for type-ahead filtering in search fields.
                  </p>
                </Field>

                <label className="flex items-center gap-2.5 text-sm text-ink-800 cursor-pointer pt-1">
                  <input
                    type="checkbox"
                    checked={itemStatus === 1}
                    onChange={e => setItemStatus(e.target.checked ? 1 : 0)}
                    className="size-4 rounded border-line text-brand-600 focus:ring-brand-500"
                  />
                  <span className="font-medium">Active (selectable by users and agents)</span>
                </label>

                {/* Dynamic Properties */}
                {currentList && currentList.properties.length > 0 && (
                  <div className="border-t border-line pt-3 space-y-3">
                    <p className="text-xs font-semibold uppercase text-ink-500">Item Properties</p>
                    {currentList.properties.map(p => (
                      <Field key={p.id} label={p.label}>
                        <input
                          type={p.type === 'int' ? 'number' : 'text'}
                          value={itemProperties[p.name] ?? ''}
                          onChange={e =>
                            setItemProperties(prev => ({
                              ...prev,
                              [p.name]: e.target.value,
                            }))
                          }
                          placeholder={p.hint || ''}
                          className={inputClass}
                        />
                      </Field>
                    ))}
                  </div>
                )}

                <div className="flex items-center justify-end gap-2 pt-4 border-t border-line">
                  <button
                    type="button"
                    onClick={() => setItemModalOpen(false)}
                    className={btnGhost}
                  >
                    Cancel
                  </button>
                  <button type="submit" disabled={saving} className={btnPrimary}>
                    {saving ? 'Saving...' : editingItem ? 'Save Item' : 'Add Item'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Modal: Bulk Import Items */}
        {importModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-xs">
            <div className="w-full max-w-lg rounded-2xl border border-line bg-surface p-6 shadow-xl">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <FileSpreadsheet className="size-5 text-brand-600" />
                  <h3 className="text-base font-bold text-ink-900">Import List Items</h3>
                </div>
                <button
                  type="button"
                  onClick={() => setImportModalOpen(false)}
                  className="rounded-lg p-1 text-ink-400 hover:bg-paper hover:text-ink-700"
                >
                  <X className="size-4" />
                </button>
              </div>

              <p className="text-xs text-ink-600 mb-3">
                Paste list items below. Format each line as:
                <br />
                <code className="rounded bg-paper px-1.5 py-0.5 font-mono text-ink-800">
                  Value, Abbreviation
                </code>{' '}
                or simply one item value per line.
              </p>

              <textarea
                rows={8}
                value={importText}
                onChange={e => setImportText(e.target.value)}
                placeholder={'First Choice, FC\nSecond Choice, SC\nThird Choice, TC'}
                className={`${inputClass} font-mono text-xs`}
              />

              <div className="flex items-center justify-between pt-4 border-t border-line mt-4">
                <span className="text-xs text-ink-500">
                  {importText.trim()
                    ? `${importText.split('\n').filter(l => l.trim()).length} line(s) detected`
                    : 'Paste data above'}
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setImportModalOpen(false)}
                    className={btnGhost}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleImportSubmit}
                    disabled={saving || !importText.trim()}
                    className={btnPrimary}
                  >
                    {saving ? 'Importing...' : 'Import Items'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    )
  }

  // ==========================================
  // RENDER: MAIN LISTS & STATUSES PAGE
  // ==========================================

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <PageHeader
        title="Custom Lists"
        subtitle="Reusable drop-down and type-ahead option lists for custom forms and ticket statuses."
        actions={
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={loadData}
              disabled={loading}
              className={btnGhost}
              title="Refresh list"
            >
              <RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
            {mainTab === 'lists' ? (
              <button
                type="button"
                onClick={openNewList}
                className={btnPrimary}
              >
                <Plus className="mr-1.5 size-4" />
                Add New Custom List
              </button>
            ) : (
              <button
                type="button"
                onClick={openAddStatusModal}
                className={btnPrimary}
              >
                <Plus className="mr-1.5 size-4" />
                Add New Status
              </button>
            )}
          </div>
        }
      />

      {/* Notifications */}
      {error && (
        <div className="flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3.5 text-sm text-rose-700">
          <AlertCircle className="size-4 shrink-0 text-rose-600" />
          <span>{error}</span>
        </div>
      )}
      {success && (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3.5 text-sm text-emerald-700">
          <CheckCircle2 className="size-4 shrink-0 text-emerald-600" />
          <span>{success}</span>
        </div>
      )}

      {/* Top Tab Bar: Custom Lists vs Ticket Statuses */}
      <div className="border-b border-line">
        <nav className="-mb-px flex space-x-6">
          <button
            type="button"
            onClick={() => setMainTab('lists')}
            className={`flex items-center gap-2 border-b-2 py-3 text-sm font-semibold transition-colors ${
              mainTab === 'lists'
                ? 'border-brand-600 text-brand-600'
                : 'border-transparent text-ink-600 hover:border-line hover:text-ink-900'
            }`}
          >
            <Layers className="size-4" />
            <span>Custom Lists</span>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700">
              {lists.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setMainTab('statuses')}
            className={`flex items-center gap-2 border-b-2 py-3 text-sm font-semibold transition-colors ${
              mainTab === 'statuses'
                ? 'border-brand-600 text-brand-600'
                : 'border-transparent text-ink-600 hover:border-line hover:text-ink-900'
            }`}
          >
            <ListFilter className="size-4" />
            <span>Ticket Statuses</span>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700">
              {statuses.length}
            </span>
          </button>
        </nav>
      </div>

      {/* ==========================================
          TAB 1: CUSTOM LISTS
          ========================================== */}
      {mainTab === 'lists' && (
        <div className="space-y-4">
          {/* Filter Bar */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-1 flex-wrap items-center gap-2">
              <div className="relative min-w-48 sm:w-64">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-400" />
                <input
                  type="text"
                  placeholder="Search custom lists..."
                  value={listSearch}
                  onChange={e => setListSearch(e.target.value)}
                  className={`${inputClass} pl-9`}
                />
              </div>

              <select
                value={sortModeFilter}
                onChange={e => setSortModeFilter(e.target.value as any)}
                className={`${inputClass} w-auto`}
              >
                <option value="all">All Sort Orders</option>
                <option value="Alpha">Alphabetical</option>
                <option value="-Alpha">Alphabetical (Reversed)</option>
                <option value="SortCol">Manually Sorted</option>
              </select>
            </div>

            {selectedListIds.length > 0 && (
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-ink-700">
                  {selectedListIds.length} selected
                </span>
                <button
                  type="button"
                  onClick={handleMassListDelete}
                  className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-100"
                >
                  Delete Selected
                </button>
              </div>
            )}
          </div>

          {/* Custom Lists Table */}
          <div className="overflow-hidden rounded-2xl border border-line bg-surface shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-line bg-paper/60 text-xs font-medium uppercase tracking-wider text-ink-500">
                  <tr>
                    <th className="w-10 px-4 py-3 text-center">
                      <input
                        type="checkbox"
                        checked={
                          filteredLists.length > 0 &&
                          selectedListIds.length === filteredLists.length
                        }
                        onChange={e => {
                          if (e.target.checked) {
                            setSelectedListIds(filteredLists.map(l => l.id))
                          } else {
                            setSelectedListIds([])
                          }
                        }}
                        className="size-4 rounded border-line text-brand-600 focus:ring-brand-500"
                      />
                    </th>
                    <th className="px-4 py-3">List Name</th>
                    <th className="px-4 py-3">Items</th>
                    <th className="px-4 py-3">Used in Forms</th>
                    <th className="px-4 py-3">Sort Order</th>
                    <th className="px-4 py-3">Created</th>
                    <th className="px-4 py-3">Last Updated</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {filteredLists.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-6 py-12 text-center text-ink-500">
                        <Layers className="mx-auto size-8 text-ink-400 mb-2 opacity-50" />
                        <p className="font-medium text-ink-700">No custom lists found</p>
                        <p className="text-xs text-ink-500 mt-1 mb-4">
                          Custom lists provide selectable options in custom forms and tickets.
                        </p>
                        <button type="button" onClick={openNewList} className={btnPrimary}>
                          <Plus className="mr-1.5 size-4" />
                          Add First Custom List
                        </button>
                      </td>
                    </tr>
                  ) : (
                    filteredLists.map(list => {
                      const isSelected = selectedListIds.includes(list.id)
                      return (
                        <tr
                          key={list.id}
                          className={`transition-colors hover:bg-paper/40 ${
                            isSelected ? 'bg-brand-50/40' : ''
                          }`}
                        >
                          <td className="px-4 py-3 text-center">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={e => {
                                if (e.target.checked) {
                                  setSelectedListIds(prev => [...prev, list.id])
                                } else {
                                  setSelectedListIds(prev => prev.filter(id => id !== list.id))
                                }
                              }}
                              className="size-4 rounded border-line text-brand-600 focus:ring-brand-500"
                            />
                          </td>

                          <td className="px-4 py-3">
                            <div>
                              <button
                                type="button"
                                onClick={() => openList(list.id)}
                                className="font-semibold text-ink-900 hover:text-brand-600 hover:underline text-left"
                              >
                                {list.namePlural || list.name}
                              </button>
                              {list.namePlural && list.namePlural !== list.name && (
                                <p className="text-xs text-ink-500">Singular: {list.name}</p>
                              )}
                              {list.notes && (
                                <p className="mt-0.5 line-clamp-1 text-xs text-ink-500">
                                  {list.notes}
                                </p>
                              )}
                            </div>
                          </td>

                          <td className="px-4 py-3">
                            <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-800">
                              {list.itemCount} items
                            </span>
                            {list.enabledItemCount !== list.itemCount && (
                              <span className="block text-[11px] text-ink-500 mt-0.5">
                                {list.enabledItemCount} enabled
                              </span>
                            )}
                          </td>

                          <td className="px-4 py-3">
                            {list.formsCount > 0 ? (
                              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-800 border border-emerald-200">
                                {list.formsCount} form{list.formsCount > 1 ? 's' : ''}
                              </span>
                            ) : (
                              <span className="text-xs text-ink-400 italic">Not in use</span>
                            )}
                          </td>

                          <td className="px-4 py-3 text-xs text-ink-700">
                            <span className="rounded bg-paper px-2 py-1 font-medium border border-line">
                              {list.sortMode === 'Alpha'
                                ? 'Alphabetical'
                                : list.sortMode === '-Alpha'
                                ? 'Alphabetical (Rev)'
                                : 'Manually Sorted'}
                            </span>
                          </td>

                          <td className="px-4 py-3 text-xs text-ink-500">
                            {formatDate(list.created)}
                          </td>

                          <td className="px-4 py-3 text-xs text-ink-500">
                            {formatDate(list.updated)}
                          </td>

                          <td className="px-4 py-3 text-right">
                            <div className="flex items-center justify-end gap-1">
                              <button
                                type="button"
                                onClick={() => openList(list.id)}
                                className="p-1.5 text-ink-500 hover:text-brand-600 hover:bg-paper rounded-lg transition-colors"
                                title="Edit list"
                              >
                                <Edit3 className="size-4" />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeleteList(list.id, list.name)}
                                className="p-1.5 text-ink-500 hover:text-rose-600 hover:bg-paper rounded-lg transition-colors"
                                title="Delete list"
                              >
                                <Trash2 className="size-4" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>

            {filteredLists.length > 0 && (
              <div className="border-t border-line px-4 py-3 text-xs text-ink-500">
                Showing {filteredLists.length} of {lists.length} custom list(s)
              </div>
            )}
          </div>
        </div>
      )}

      {/* ==========================================
          TAB 2: TICKET STATUSES
          ========================================== */}
      {mainTab === 'statuses' && (
        <div className="space-y-4">
          {/* Status Filter Bar */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-1 flex-wrap items-center gap-2">
              <div className="relative min-w-48 sm:w-64">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-400" />
                <input
                  type="text"
                  placeholder="Search ticket statuses..."
                  value={statusSearch}
                  onChange={e => setStatusSearch(e.target.value)}
                  className={`${inputClass} pl-9`}
                />
              </div>

              <select
                value={statusStateFilter}
                onChange={e => setStatusStateFilter(e.target.value as StatusFilter)}
                className={`${inputClass} w-auto`}
              >
                <option value="all">All States</option>
                <option value="open">Open</option>
                <option value="closed">Closed</option>
                <option value="archived">Archived</option>
                <option value="deleted">Deleted</option>
              </select>
            </div>

            {selectedStatusIds.length > 0 && (
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-ink-700">
                  {selectedStatusIds.length} selected
                </span>
                <button
                  type="button"
                  onClick={handleMassStatusDelete}
                  className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-100"
                >
                  Delete Selected
                </button>
              </div>
            )}
          </div>

          {/* Ticket Statuses Table */}
          <div className="overflow-hidden rounded-2xl border border-line bg-surface shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-line bg-paper/60 text-xs font-medium uppercase tracking-wider text-ink-500">
                  <tr>
                    <th className="w-10 px-4 py-3 text-center">
                      <input
                        type="checkbox"
                        checked={
                          filteredStatuses.length > 0 &&
                          selectedStatusIds.length === filteredStatuses.length
                        }
                        onChange={e => {
                          if (e.target.checked) {
                            setSelectedStatusIds(filteredStatuses.map(s => s.id))
                          } else {
                            setSelectedStatusIds([])
                          }
                        }}
                        className="size-4 rounded border-line text-brand-600 focus:ring-brand-500"
                      />
                    </th>
                    <th className="px-4 py-3">Status Name</th>
                    <th className="px-4 py-3">State</th>
                    <th className="px-4 py-3">Reopening Policy</th>
                    <th className="px-4 py-3">Active Tickets</th>
                    <th className="px-4 py-3">Sort Order</th>
                    <th className="px-4 py-3">Last Updated</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {filteredStatuses.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-6 py-12 text-center text-ink-500">
                        <ListFilter className="mx-auto size-8 text-ink-400 mb-2 opacity-50" />
                        <p className="font-medium text-ink-700">No ticket statuses found</p>
                        <p className="text-xs text-ink-500 mt-1 mb-4">
                          Ticket statuses control workflow states (Open, Closed, Archived, Deleted).
                        </p>
                        <button type="button" onClick={openAddStatusModal} className={btnPrimary}>
                          <Plus className="mr-1.5 size-4" />
                          Add Ticket Status
                        </button>
                      </td>
                    </tr>
                  ) : (
                    filteredStatuses.map(status => {
                      const isSelected = selectedStatusIds.includes(status.id)
                      return (
                        <tr
                          key={status.id}
                          className={`transition-colors hover:bg-paper/40 ${
                            isSelected ? 'bg-brand-50/40' : ''
                          }`}
                        >
                          <td className="px-4 py-3 text-center">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={e => {
                                if (e.target.checked) {
                                  setSelectedStatusIds(prev => [...prev, status.id])
                                } else {
                                  setSelectedStatusIds(prev =>
                                    prev.filter(id => id !== status.id)
                                  )
                                }
                              }}
                              className="size-4 rounded border-line text-brand-600 focus:ring-brand-500"
                            />
                          </td>

                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => openEditStatusModal(status)}
                                className="font-semibold text-ink-900 hover:text-brand-600 hover:underline text-left"
                              >
                                {status.name}
                              </button>
                              {status.isSystem && (
                                <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-slate-600 border border-slate-200">
                                  System
                                </span>
                              )}
                            </div>
                            {status.description && (
                              <p className="mt-0.5 text-xs text-ink-500 line-clamp-1">
                                {status.description}
                              </p>
                            )}
                          </td>

                          <td className="px-4 py-3">{renderStateBadge(status.state)}</td>

                          <td className="px-4 py-3 text-xs text-ink-700">
                            {status.reopenable ? (
                              <span className="text-emerald-700">Client reply reopens ticket</span>
                            ) : (
                              <span className="text-ink-500 italic">
                                Client reply opens new ticket
                              </span>
                            )}
                          </td>

                          <td className="px-4 py-3">
                            <span
                              className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                                status.ticketCount > 0
                                  ? 'bg-brand-50 text-brand-800 border border-brand-200'
                                  : 'bg-slate-100 text-slate-600'
                              }`}
                            >
                              {status.ticketCount} ticket{status.ticketCount === 1 ? '' : 's'}
                            </span>
                          </td>

                          <td className="px-4 py-3 text-xs text-ink-700 font-mono">
                            {status.sort}
                          </td>

                          <td className="px-4 py-3 text-xs text-ink-500">
                            {formatDate(status.updated)}
                          </td>

                          <td className="px-4 py-3 text-right">
                            <div className="flex items-center justify-end gap-1">
                              <button
                                type="button"
                                onClick={() => openEditStatusModal(status)}
                                className="p-1.5 text-ink-500 hover:text-brand-600 hover:bg-paper rounded-lg transition-colors"
                                title="Edit status"
                              >
                                <Edit3 className="size-4" />
                              </button>
                              <button
                                type="button"
                                disabled={status.isSystem || status.ticketCount > 0}
                                onClick={() => handleDeleteStatus(status)}
                                className="p-1.5 text-ink-500 hover:text-rose-600 hover:bg-paper rounded-lg transition-colors disabled:opacity-20"
                                title={
                                  status.isSystem
                                    ? 'System status cannot be deleted'
                                    : status.ticketCount > 0
                                    ? `Cannot delete: ${status.ticketCount} ticket(s) in this status`
                                    : 'Delete status'
                                }
                              >
                                <Trash2 className="size-4" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>

            {filteredStatuses.length > 0 && (
              <div className="border-t border-line px-4 py-3 text-xs text-ink-500">
                Showing {filteredStatuses.length} of {statuses.length} ticket status(es)
              </div>
            )}
          </div>
        </div>
      )}

      {/* Modal: Add / Edit Ticket Status */}
      {statusModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-2xl border border-line bg-surface p-6 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-bold text-ink-900">
                {editingStatus ? 'Edit Ticket Status' : 'Add New Ticket Status'}
              </h3>
              <button
                type="button"
                onClick={() => setStatusModalOpen(false)}
                className="rounded-lg p-1 text-ink-400 hover:bg-paper hover:text-ink-700"
              >
                <X className="size-4" />
              </button>
            </div>

            <form onSubmit={handleSaveStatus} className="space-y-4">
              <Field label="Status Name *">
                <input
                  type="text"
                  required
                  autoFocus
                  value={statusForm.name}
                  onChange={e => setStatusForm(prev => ({ ...prev, name: e.target.value }))}
                  placeholder="e.g. Waiting on Customer, In Progress"
                  className={inputClass}
                />
              </Field>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Target State *">
                  <select
                    value={statusForm.state || 'open'}
                    onChange={e =>
                      setStatusForm(prev => ({
                        ...prev,
                        state: e.target.value as ApiTicketState,
                      }))
                    }
                    className={inputClass}
                  >
                    <option value="open">Open</option>
                    <option value="closed">Closed</option>
                    <option value="archived">Archived</option>
                    <option value="deleted">Deleted</option>
                  </select>
                </Field>

                <Field label="Sort Order">
                  <input
                    type="number"
                    value={statusForm.sort ?? 1}
                    onChange={e =>
                      setStatusForm(prev => ({
                        ...prev,
                        sort: parseInt(e.target.value, 10) || 1,
                      }))
                    }
                    className={inputClass}
                  />
                </Field>
              </div>

              <label className="flex items-start gap-2.5 text-sm text-ink-800 cursor-pointer pt-1">
                <input
                  type="checkbox"
                  checked={statusForm.properties?.reopenable !== false}
                  onChange={e =>
                    setStatusForm(prev => ({
                      ...prev,
                      properties: {
                        ...prev.properties,
                        reopenable: e.target.checked,
                      },
                    }))
                  }
                  className="mt-0.5 size-4 rounded border-line text-brand-600 focus:ring-brand-500"
                />
                <div>
                  <span className="font-medium block">Allow Client Reopen</span>
                  <span className="text-xs text-ink-500 block">
                    If unchecked, an end-user reply to a ticket with this status will spawn a new
                    ticket referencing the old one rather than reopening it.
                  </span>
                </div>
              </label>

              <Field label="Description / Internal Notes">
                <textarea
                  rows={3}
                  value={statusForm.properties?.description || ''}
                  onChange={e =>
                    setStatusForm(prev => ({
                      ...prev,
                      properties: {
                        ...prev.properties,
                        description: e.target.value,
                      },
                    }))
                  }
                  placeholder="Optional status notes or workflow instructions..."
                  className={inputClass}
                />
              </Field>

              <div className="flex items-center justify-end gap-2 pt-4 border-t border-line">
                <button
                  type="button"
                  onClick={() => setStatusModalOpen(false)}
                  className={btnGhost}
                >
                  Cancel
                </button>
                <button type="submit" disabled={saving} className={btnPrimary}>
                  {saving ? 'Saving...' : editingStatus ? 'Save Status' : 'Add Status'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
