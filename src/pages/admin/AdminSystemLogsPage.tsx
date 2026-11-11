import { FormEvent, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Card } from '../../components/ui'
import { useAuth } from '../../context/AuthContext'
import {
  checkApiSystemLogsAuth,
  createApiSystemLog,
  deleteApiSystemLog,
  getApiSystemLogs,
  massDeleteApiSystemLogs,
  purgeSystemLogs,
  type ApiSystemLog,
  type ApiSystemLogsAuthResponse,
  type ApiSystemLogsResponse,
} from '../../lib/api'
import { formatDate } from '../../lib/format'

type SortColumn = 'id' | 'title' | 'type' | 'date' | 'ip' | 'logger'
type SortOrder = 'asc' | 'desc'

export function AdminSystemLogsPage() {
  const { user } = useAuth()
  const navigate = useNavigate()

  // Authorization state
  const [authChecking, setAuthChecking] = useState(true)
  const [authData, setAuthData] = useState<ApiSystemLogsAuthResponse | null>(null)

  // System Logs data state
  const [data, setData] = useState<ApiSystemLogsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [successNotice, setSuccessNotice] = useState('')

  // Filters
  const [typeFilter, setTypeFilter] = useState<'all' | 'Error' | 'Warning' | 'Debug'>('all')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [appliedSearch, setAppliedSearch] = useState('')

  // Sorting & Pagination
  const [sortColumn, setSortColumn] = useState<SortColumn>('date')
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)

  // Selection
  const [selectedIds, setSelectedIds] = useState<string[]>([])

  // Modals
  const [activeLog, setActiveLog] = useState<ApiSystemLog | null>(null)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [logToDelete, setLogToDelete] = useState<string | null>(null)
  const [showPurgeModal, setShowPurgeModal] = useState(false)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [creating, setCreating] = useState(false)
  const [newLogType, setNewLogType] = useState<'Error' | 'Warning' | 'Debug'>('Debug')
  const [newLogTitle, setNewLogTitle] = useState('')
  const [newLogBody, setNewLogBody] = useState('')
  const [newLogLogger, setNewLogLogger] = useState('system.manual')

  // Copy indicator
  const [copiedId, setCopiedId] = useState<string | null>(null)

  // 1. Initial Authorization Check
  useEffect(() => {
    let cancelled = false
    async function verifyAuth() {
      try {
        setAuthChecking(true)
        const res = await checkApiSystemLogsAuth()
        if (!cancelled) {
          setAuthData(res)
        }
      } catch (err) {
        if (!cancelled) {
          setAuthData({
            authorized: false,
            role: user?.role || 'agent',
            isAdmin: false,
            username: user?.name || '',
            email: user?.email || '',
            deptId: '',
            canView: false,
            canDelete: false,
            canPurge: false,
            canConfigure: false,
            reason: err instanceof Error ? err.message : 'Administrator authorization required.',
          })
        }
      } finally {
        if (!cancelled) setAuthChecking(false)
      }
    }

    void verifyAuth()
    return () => {
      cancelled = true
    }
  }, [user])

  // 2. Fetch logs from backend
  async function fetchLogs() {
    try {
      setLoading(true)
      setError('')
      const res = await getApiSystemLogs({
        type: typeFilter !== 'all' ? typeFilter : undefined,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
        search: appliedSearch || undefined,
        sort: sortColumn,
        order: sortOrder,
        page,
        limit: pageSize,
      })
      setData(res)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load system logs.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (authData?.authorized || user?.role === 'admin') {
      void fetchLogs()
    }
  }, [authData?.authorized, user?.role, typeFilter, startDate, endDate, appliedSearch, sortColumn, sortOrder, page, pageSize])

  // Clear notice after 4 seconds
  useEffect(() => {
    if (successNotice) {
      const timer = setTimeout(() => setSuccessNotice(''), 4000)
      return () => clearTimeout(timer)
    }
  }, [successNotice])

  // Handle Search submit
  function handleSearchSubmit(e: FormEvent) {
    e.preventDefault()
    setPage(1)
    setAppliedSearch(searchQuery.trim())
  }

  function handleResetFilters() {
    setTypeFilter('all')
    setStartDate('')
    setEndDate('')
    setSearchQuery('')
    setAppliedSearch('')
    setPage(1)
  }

  // Sorting
  function handleSort(col: SortColumn) {
    if (sortColumn === col) {
      setSortOrder(prev => (prev === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortColumn(col)
      setSortOrder('desc')
    }
    setPage(1)
  }

  // Selection helpers
  const allCurrentIds = useMemo(() => (data?.logs || []).map(l => l.id), [data?.logs])
  const isAllSelected = allCurrentIds.length > 0 && allCurrentIds.every(id => selectedIds.includes(id))

  function toggleSelectAll() {
    if (isAllSelected) {
      setSelectedIds(prev => prev.filter(id => !allCurrentIds.includes(id)))
    } else {
      setSelectedIds(prev => Array.from(new Set([...prev, ...allCurrentIds])))
    }
  }

  function selectNone() {
    setSelectedIds([])
  }

  function toggleSelection(id: string) {
    setSelectedIds(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]))
  }

  function toggleInvert() {
    setSelectedIds(prev => {
      const set = new Set(prev)
      for (const id of allCurrentIds) {
        if (set.has(id)) set.delete(id)
        else set.add(id)
      }
      return Array.from(set)
    })
  }

  // Deletions
  async function confirmDelete() {
    try {
      if (logToDelete) {
        await deleteApiSystemLog(logToDelete)
        setSuccessNotice('System log entry deleted successfully.')
        setSelectedIds(prev => prev.filter(id => id !== logToDelete))
        if (activeLog?.id === logToDelete) setActiveLog(null)
      } else if (selectedIds.length > 0) {
        const res = await massDeleteApiSystemLogs(selectedIds)
        setSuccessNotice(`Successfully deleted ${res.deleted} selected log ${res.deleted === 1 ? 'entry' : 'entries'}.`)
        setSelectedIds([])
      }
      setShowDeleteConfirm(false)
      setLogToDelete(null)
      void fetchLogs()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete log entries.')
      setShowDeleteConfirm(false)
      setLogToDelete(null)
    }
  }

  // Purge
  async function handlePurge() {
    try {
      const res = await purgeSystemLogs()
      setSuccessNotice(`Purge complete: ${res.deleted} log entries older than ${res.months} months were removed.`)
      setShowPurgeModal(false)
      void fetchLogs()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to purge logs.')
      setShowPurgeModal(false)
    }
  }

  // Create Test Log
  async function handleCreateLog(e: FormEvent) {
    e.preventDefault()
    if (!newLogTitle.trim() || !newLogBody.trim()) return
    try {
      setCreating(true)
      const res = await createApiSystemLog({
        type: newLogType,
        title: newLogTitle.trim(),
        log: newLogBody.trim(),
        logger: newLogLogger.trim() || 'system.manual',
      })
      if (res.skipped) {
        setError(`Log was created but filtered by current threshold setting (${res.reason}).`)
      } else {
        setSuccessNotice(`System log "${newLogTitle}" recorded successfully.`)
      }
      setShowCreateModal(false)
      setNewLogTitle('')
      setNewLogBody('')
      void fetchLogs()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create system log.')
    } finally {
      setCreating(false)
    }
  }

  function copyLogToClipboard(log: ApiSystemLog) {
    const text = `[${log.type}] ${log.title}\nDate: ${formatDate(log.createdAt)}\nIP: ${log.ipAddress}\nLogger: ${log.logger}\n\nDetails:\n${log.log}`
    void navigator.clipboard.writeText(text)
    setCopiedId(log.id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  // --- ACCESS CONTROL CHECK ---
  if (authChecking) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center p-8 text-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand-500 border-t-transparent" />
        <p className="mt-3 text-sm font-medium text-ink-600">Verifying administrative authorization…</p>
      </div>
    )
  }

  const isAuthorized = (authData?.authorized ?? false) || user?.role === 'admin'

  if (!isAuthorized) {
    return (
      <div className="mx-auto max-w-2xl py-12">
        <Card className="border-rose-300 bg-rose-50/50 p-6 text-center shadow-md dark:border-rose-900/60 dark:bg-rose-950/20">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-rose-100 text-rose-600 dark:bg-rose-900/40 dark:text-rose-400">
            <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-rose-900 dark:text-rose-200">Access Denied: Administrator Session Required</h2>
          <p className="mt-2 text-sm text-rose-800 dark:text-rose-300">
            According to osTicket documentation (<strong>Admin Panel &gt; Dashboard &gt; System Logs</strong>), system logs contain sensitive server backtraces, cron error dumps, mail connectivity tests, and security records. Access is strictly restricted to staff members with the <strong>Administrator</strong> role.
          </p>
          <div className="mt-4 inline-flex items-center rounded-lg border border-rose-200 bg-white px-3 py-1.5 text-xs text-rose-800 dark:border-rose-900 dark:bg-zinc-900 dark:text-rose-300">
            Your active role: <span className="ml-1 font-semibold uppercase">{user?.role || 'Agent'}</span>
            {authData?.reason ? ` (${authData.reason})` : ''}
          </div>
          <div className="mt-6 flex justify-center gap-3">
            <button
              type="button"
              onClick={() => navigate('/scp')}
              className="inline-flex items-center rounded-xl bg-ink-800 px-4 py-2 text-sm font-semibold text-white hover:bg-ink-900"
            >
              Return to Staff Dashboard
            </button>
            <button
              type="button"
              onClick={() => navigate('/scp/tickets')}
              className="inline-flex items-center rounded-xl border border-line bg-surface px-4 py-2 text-sm font-semibold text-ink-800 hover:bg-paper"
            >
              View Tickets
            </button>
          </div>
        </Card>
      </div>
    )
  }

  // --- AUTHORIZED ADMIN VIEW ---
  return (
    <div className="space-y-6">
      {/* 1. Header & Breadcrumbs */}
      <div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-ink-400">
              <span>Admin Panel</span>
              <span>&gt;</span>
              <span>Dashboard</span>
              <span>&gt;</span>
              <span className="text-brand-600">System Logs</span>
            </div>
            <div className="mt-1 flex items-center gap-3">
              <h1 className="text-2xl font-bold text-ink-900 sm:text-3xl">System Logs</h1>
              <a
                href="https://docs.osticket.com/en/latest/Admin/Dashboard/System%20Logs.html"
                target="_blank"
                rel="noreferrer"
                title="View osTicket System Logs official documentation"
                className="inline-flex items-center gap-1 rounded-full border border-line bg-surface px-2.5 py-1 text-xs font-medium text-ink-600 hover:border-brand-500 hover:text-brand-600"
              >
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span>Docs</span>
              </a>
            </div>
            <p className="mt-1 text-sm text-ink-500">
              Tracks troubleshooting-related logging activity within your help desk, such as Errors, Warnings, and Debug bugs.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void fetchLogs()}
              disabled={loading}
              className="inline-flex items-center gap-1.5 rounded-xl border border-line bg-surface px-3 py-2 text-xs font-semibold text-ink-800 hover:bg-paper"
              title="Reload logs"
            >
              <svg className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              <span>Refresh</span>
            </button>

            <button
              type="button"
              onClick={() => setShowPurgeModal(true)}
              className="inline-flex items-center gap-1.5 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900 hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
              title="Purge logs according to grace period"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
              <span>Purge Logs</span>
            </button>

            <button
              type="button"
              onClick={() => setShowCreateModal(true)}
              className="inline-flex items-center gap-1.5 rounded-xl bg-brand-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-brand-700"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              <span>Log Event</span>
            </button>
          </div>
        </div>
      </div>

      {/* 2. Notifications & Error Alerts */}
      {successNotice ? (
        <div className="flex items-center justify-between rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 shadow-sm dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200">
          <div className="flex items-center gap-2">
            <svg className="h-5 w-5 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            <span>{successNotice}</span>
          </div>
          <button type="button" onClick={() => setSuccessNotice('')} className="text-emerald-700 hover:text-emerald-900">
            &times;
          </button>
        </div>
      ) : null}

      {error ? (
        <div className="flex items-center justify-between rounded-xl border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-900 shadow-sm dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-200">
          <div className="flex items-center gap-2">
            <svg className="h-5 w-5 text-rose-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span>{error}</span>
          </div>
          <button type="button" onClick={() => setError('')} className="text-rose-700 hover:text-rose-900">
            &times;
          </button>
        </div>
      ) : null}

      {/* 3. System Configuration Overview Banner (ost_config connection) */}
      <div className="rounded-2xl border border-line bg-gradient-to-r from-paper to-surface p-4 shadow-sm">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 rounded-lg bg-brand-50 p-2 text-brand-600 dark:bg-brand-950/40 dark:text-brand-400">
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </div>
            <div>
              <h2 className="text-sm font-semibold text-ink-900">System Logging Settings (ost_config)</h2>
              <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-600">
                <span>
                  Default Log Level:{' '}
                  <span className="font-semibold capitalize text-brand-600">
                    {data?.config.logLevel || 'warning'}
                  </span>{' '}
                  <span className="text-ink-400">
                    ({data?.config.logLevel === 'debug' ? 'All events recorded' : data?.config.logLevel === 'error' ? 'Critical issues only' : 'Warnings & errors'})
                  </span>
                </span>
                <span>•</span>
                <span>
                  Purge Logs Retention:{' '}
                  <span className="font-semibold text-ink-800">
                    {data?.config.logGracePeriodMonths
                      ? `After ${data.config.logGracePeriodMonths} months`
                      : 'Never purge logs'}
                  </span>
                </span>
                <span>•</span>
                <span>
                  Role Authorization:{' '}
                  <span className="rounded bg-emerald-100 px-1.5 py-0.5 font-semibold text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300">
                    Administrator (Verified)
                  </span>
                </span>
              </div>
            </div>
          </div>

          <Link
            to="/scp/admin/settings"
            className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-xl border border-line bg-surface px-3 py-1.5 text-xs font-medium text-ink-700 shadow-sm hover:border-brand-500 hover:text-brand-600"
          >
            <span>Change in Settings &gt; System</span>
            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </Link>
        </div>
      </div>

      {/* 4. Metric Cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
        <Card className="p-4">
          <p className="text-xs font-medium uppercase tracking-wider text-ink-400">Total Logs</p>
          <p className="mt-1 text-2xl font-bold text-ink-900 sm:text-3xl">{data?.counts.total ?? 0}</p>
          <p className="mt-0.5 text-xs text-ink-500">Stored in ost_syslog</p>
        </Card>

        <Card className="border-rose-200 bg-rose-50/40 p-4 dark:border-rose-900/40 dark:bg-rose-950/10">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium uppercase tracking-wider text-rose-700 dark:text-rose-400">Errors</p>
            <span className="inline-block h-2 w-2 rounded-full bg-rose-500" />
          </div>
          <p className="mt-1 text-2xl font-bold text-rose-800 dark:text-rose-200 sm:text-3xl">
            {data?.counts.error ?? 0}
          </p>
          <button
            type="button"
            onClick={() => {
              setTypeFilter('Error')
              setPage(1)
            }}
            className="mt-0.5 text-xs font-medium text-rose-700 hover:underline dark:text-rose-400"
          >
            Filter by errors &rarr;
          </button>
        </Card>

        <Card className="border-amber-200 bg-amber-50/40 p-4 dark:border-amber-900/40 dark:bg-amber-950/10">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium uppercase tracking-wider text-amber-700 dark:text-amber-400">Warnings</p>
            <span className="inline-block h-2 w-2 rounded-full bg-amber-500" />
          </div>
          <p className="mt-1 text-2xl font-bold text-amber-800 dark:text-amber-200 sm:text-3xl">
            {data?.counts.warning ?? 0}
          </p>
          <button
            type="button"
            onClick={() => {
              setTypeFilter('Warning')
              setPage(1)
            }}
            className="mt-0.5 text-xs font-medium text-amber-700 hover:underline dark:text-amber-400"
          >
            Filter by warnings &rarr;
          </button>
        </Card>

        <Card className="border-blue-200 bg-blue-50/40 p-4 dark:border-blue-900/40 dark:bg-blue-950/10">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium uppercase tracking-wider text-blue-700 dark:text-blue-400">Debug</p>
            <span className="inline-block h-2 w-2 rounded-full bg-blue-500" />
          </div>
          <p className="mt-1 text-2xl font-bold text-blue-800 dark:text-blue-200 sm:text-3xl">
            {data?.counts.debug ?? 0}
          </p>
          <button
            type="button"
            onClick={() => {
              setTypeFilter('Debug')
              setPage(1)
            }}
            className="mt-0.5 text-xs font-medium text-blue-700 hover:underline dark:text-blue-400"
          >
            Filter by debug &rarr;
          </button>
        </Card>
      </div>

      {/* 5. Filter & Search Controls (mirrors osTicket syslogs.inc.php filter bar) */}
      <Card className="p-4 sm:p-5">
        <form onSubmit={handleSearchSubmit} className="flex flex-col gap-4">
          <div className="flex flex-wrap items-end gap-3 sm:gap-4">
            {/* Date Span: Between Start and End */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium text-ink-600">Between:</span>
              <input
                type="date"
                value={startDate}
                onChange={e => {
                  setStartDate(e.target.value)
                  setPage(1)
                }}
                className="rounded-xl border border-line bg-paper px-2.5 py-1.5 text-xs text-ink-800 outline-none focus:ring-2 focus:ring-brand-500"
                title="Start date"
              />
              <span className="text-xs text-ink-400">to</span>
              <input
                type="date"
                value={endDate}
                onChange={e => {
                  setEndDate(e.target.value)
                  setPage(1)
                }}
                className="rounded-xl border border-line bg-paper px-2.5 py-1.5 text-xs text-ink-800 outline-none focus:ring-2 focus:ring-brand-500"
                title="End date"
              />
            </div>

            {/* Log Level select */}
            <div className="flex items-center gap-2">
              <label htmlFor="log-level-select" className="text-xs font-medium text-ink-600">Log Level:</label>
              <select
                id="log-level-select"
                value={typeFilter}
                onChange={e => {
                  setTypeFilter(e.target.value as any)
                  setPage(1)
                }}
                className="rounded-xl border border-line bg-paper px-3 py-1.5 text-xs text-ink-800 outline-none focus:ring-2 focus:ring-brand-500"
              >
                <option value="all">All</option>
                <option value="Error">ERROR</option>
                <option value="Warning">WARN</option>
                <option value="Debug">DEBUG</option>
              </select>
            </div>

            {/* Keyword Search */}
            <div className="relative min-w-[14rem] flex-1">
              <input
                type="text"
                placeholder="Search title, log text, IP, logger…"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-full rounded-xl border border-line bg-paper py-1.5 pl-8 pr-3 text-xs text-ink-800 outline-none focus:ring-2 focus:ring-brand-500"
              />
              <svg className="absolute left-2.5 top-2 h-3.5 w-3.5 text-ink-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>

            <button
              type="submit"
              className="inline-flex items-center justify-center rounded-xl bg-ink-800 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-ink-900"
            >
              Go!
            </button>

            {(typeFilter !== 'all' || startDate || endDate || appliedSearch) && (
              <button
                type="button"
                onClick={handleResetFilters}
                className="inline-flex items-center justify-center rounded-xl border border-line bg-paper px-3 py-1.5 text-xs font-medium text-ink-600 hover:text-ink-900"
              >
                Clear Filters
              </button>
            )}
          </div>
        </form>
      </Card>

      {/* 6. Action Bar (Sticky / Header above Table) */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-surface p-3 sm:px-4">
        <div className="flex items-center gap-3 text-xs text-ink-600">
          <span className="font-semibold text-ink-800">
            {selectedIds.length > 0 ? `${selectedIds.length} entry/entries selected` : `Showing ${data?.logs.length ?? 0} of ${data?.total ?? 0} logs`}
          </span>
          <span className="text-line">•</span>
          <div className="flex items-center gap-1.5">
            <span className="text-ink-400">Select:</span>
            <button type="button" onClick={toggleSelectAll} className="font-medium text-brand-600 hover:underline">
              {isAllSelected ? 'None' : 'All'}
            </button>
            <span className="text-ink-300">|</span>
            <button type="button" onClick={selectNone} className="font-medium text-ink-600 hover:underline">
              Clear
            </button>
            <span className="text-ink-300">|</span>
            <button type="button" onClick={toggleInvert} className="font-medium text-ink-600 hover:underline">
              Toggle
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {selectedIds.length > 0 && (
            <button
              type="button"
              onClick={() => {
                setLogToDelete(null)
                setShowDeleteConfirm(true)
              }}
              className="inline-flex items-center gap-1.5 rounded-xl bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-rose-700"
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
              <span>Delete Selected Entries ({selectedIds.length})</span>
            </button>
          )}

          <div className="flex items-center gap-1.5 text-xs text-ink-500">
            <label htmlFor="page-size-select">Per page:</label>
            <select
              id="page-size-select"
              value={pageSize}
              onChange={e => {
                setPageSize(Number(e.target.value))
                setPage(1)
              }}
              className="rounded-lg border border-line bg-paper px-2 py-1 text-xs text-ink-800"
            >
              <option value="10">10</option>
              <option value="25">25</option>
              <option value="50">50</option>
              <option value="100">100</option>
            </select>
          </div>
        </div>
      </div>

      {/* 7. Logs Table */}
      <div className="overflow-hidden rounded-2xl border border-line bg-surface shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[45rem] text-left text-xs">
            <thead className="border-b border-line bg-paper text-ink-600">
              <tr>
                <th className="w-10 px-4 py-3 text-center">
                  <input
                    type="checkbox"
                    checked={isAllSelected}
                    onChange={toggleSelectAll}
                    className="h-4 w-4 rounded border-line text-brand-600 focus:ring-brand-500"
                    title="Select all on current page"
                  />
                </th>
                <th
                  onClick={() => handleSort('title')}
                  className="cursor-pointer select-none px-4 py-3 font-semibold hover:text-ink-900"
                >
                  <div className="flex items-center gap-1">
                    <span>Log Title</span>
                    {sortColumn === 'title' && (
                      <span className="text-brand-600">{sortOrder === 'asc' ? '▲' : '▼'}</span>
                    )}
                  </div>
                </th>
                <th
                  onClick={() => handleSort('type')}
                  className="w-28 cursor-pointer select-none px-4 py-3 font-semibold hover:text-ink-900"
                >
                  <div className="flex items-center gap-1">
                    <span>Log Type</span>
                    {sortColumn === 'type' && (
                      <span className="text-brand-600">{sortOrder === 'asc' ? '▲' : '▼'}</span>
                    )}
                  </div>
                </th>
                <th
                  onClick={() => handleSort('date')}
                  className="w-44 cursor-pointer select-none px-4 py-3 font-semibold hover:text-ink-900"
                >
                  <div className="flex items-center gap-1">
                    <span>Log Date</span>
                    {sortColumn === 'date' && (
                      <span className="text-brand-600">{sortOrder === 'asc' ? '▲' : '▼'}</span>
                    )}
                  </div>
                </th>
                <th
                  onClick={() => handleSort('ip')}
                  className="w-36 cursor-pointer select-none px-4 py-3 font-semibold hover:text-ink-900"
                >
                  <div className="flex items-center gap-1">
                    <span>IP Address</span>
                    {sortColumn === 'ip' && (
                      <span className="text-brand-600">{sortOrder === 'asc' ? '▲' : '▼'}</span>
                    )}
                  </div>
                </th>
                <th className="w-24 px-4 py-3 text-right font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {loading ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-ink-500">
                    <div className="inline-flex items-center gap-2">
                      <div className="h-4 w-4 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
                      <span>Loading logs…</span>
                    </div>
                  </td>
                </tr>
              ) : (data?.logs.length ?? 0) === 0 ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-ink-500">
                    <p className="font-medium">No logs found</p>
                    <p className="mt-1 text-xs text-ink-400">
                      Try adjusting the date span or log level filter above.
                    </p>
                  </td>
                </tr>
              ) : (
                data?.logs.map(log => {
                  const isChecked = selectedIds.includes(log.id)
                  return (
                    <tr
                      key={log.id}
                      className={`transition-colors hover:bg-paper/60 ${isChecked ? 'bg-brand-50/30 dark:bg-brand-950/20' : ''}`}
                    >
                      {/* Checkbox */}
                      <td className="px-4 py-3 text-center">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => toggleSelection(log.id)}
                          className="h-4 w-4 rounded border-line text-brand-600 focus:ring-brand-500"
                        />
                      </td>

                      {/* Title + logger */}
                      <td className="px-4 py-3">
                        <div className="min-w-0">
                          <button
                            type="button"
                            onClick={() => setActiveLog(log)}
                            className="font-medium text-brand-600 hover:text-brand-700 hover:underline text-left line-clamp-1"
                            title="Click to view details and backtrace"
                          >
                            {log.title}
                          </button>
                          {log.logger ? (
                            <span className="mt-0.5 inline-block text-[11px] text-ink-400">
                              logger: {log.logger}
                            </span>
                          ) : null}
                        </div>
                      </td>

                      {/* Log Type */}
                      <td className="px-4 py-3">
                        {log.type === 'Error' ? (
                          <span className="inline-flex items-center gap-1 rounded-md bg-rose-100 px-2 py-0.5 text-[11px] font-semibold text-rose-800 dark:bg-rose-950/60 dark:text-rose-300">
                            <span className="h-1.5 w-1.5 rounded-full bg-rose-500" />
                            ERROR
                          </span>
                        ) : log.type === 'Warning' ? (
                          <span className="inline-flex items-center gap-1 rounded-md bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800 dark:bg-amber-950/60 dark:text-amber-300">
                            <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                            WARN
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-md bg-blue-100 px-2 py-0.5 text-[11px] font-semibold text-blue-800 dark:bg-blue-950/60 dark:text-blue-300">
                            <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />
                            DEBUG
                          </span>
                        )}
                      </td>

                      {/* Log Date */}
                      <td className="px-4 py-3 whitespace-nowrap text-ink-600">
                        <div>{formatDate(log.createdAt)}</div>
                      </td>

                      {/* IP Address */}
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className="font-mono text-xs text-ink-700">{log.ipAddress || '—'}</span>
                      </td>

                      {/* Actions */}
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => setActiveLog(log)}
                            className="rounded-lg p-1 text-ink-500 hover:bg-paper hover:text-ink-900"
                            title="View log details"
                          >
                            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                            </svg>
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setLogToDelete(log.id)
                              setShowDeleteConfirm(true)
                            }}
                            className="rounded-lg p-1 text-rose-500 hover:bg-rose-50 hover:text-rose-700 dark:hover:bg-rose-950/30"
                            title="Delete this log"
                          >
                            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
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

        {/* 8. Pagination Footer */}
        <div className="flex flex-col items-center justify-between gap-3 border-t border-line bg-paper/50 px-4 py-3 sm:flex-row">
          <p className="text-xs text-ink-500">
            {data && data.total > 0 ? (
              <>
                Showing{' '}
                <span className="font-semibold text-ink-800">
                  {Math.min((page - 1) * pageSize + 1, data.total)}
                </span>{' '}
                to{' '}
                <span className="font-semibold text-ink-800">
                  {Math.min(page * pageSize, data.total)}
                </span>{' '}
                of <span className="font-semibold text-ink-800">{data.total}</span> entries
              </>
            ) : (
              '0 entries'
            )}
          </p>

          <div className="flex items-center gap-1">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage(1)}
              className="rounded-lg border border-line bg-surface px-2.5 py-1 text-xs text-ink-700 disabled:opacity-40"
              title="First page"
            >
              &laquo;
            </button>
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage(p => Math.max(1, p - 1))}
              className="rounded-lg border border-line bg-surface px-2.5 py-1 text-xs text-ink-700 disabled:opacity-40"
              title="Previous page"
            >
              Prev
            </button>
            <span className="px-2 text-xs font-semibold text-ink-800">
              Page {page} of {data?.totalPages || 1}
            </span>
            <button
              type="button"
              disabled={!data || page >= data.totalPages}
              onClick={() => setPage(p => p + 1)}
              className="rounded-lg border border-line bg-surface px-2.5 py-1 text-xs text-ink-700 disabled:opacity-40"
              title="Next page"
            >
              Next
            </button>
            <button
              type="button"
              disabled={!data || page >= data.totalPages}
              onClick={() => setPage(data?.totalPages || 1)}
              className="rounded-lg border border-line bg-surface px-2.5 py-1 text-xs text-ink-700 disabled:opacity-40"
              title="Last page"
            >
              &raquo;
            </button>
          </div>
        </div>
      </div>

      {/* 9. Log Detail Modal (Details and backtrace) */}
      {activeLog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
          <div className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-2xl border border-line bg-surface shadow-2xl">
            {/* Modal Header */}
            <div className="flex items-start justify-between border-b border-line p-4 sm:p-5">
              <div className="min-w-0 pr-4">
                <div className="flex items-center gap-2">
                  {activeLog.type === 'Error' ? (
                    <span className="rounded bg-rose-100 px-2 py-0.5 text-xs font-bold text-rose-800 dark:bg-rose-950/60 dark:text-rose-300">
                      ERROR
                    </span>
                  ) : activeLog.type === 'Warning' ? (
                    <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-800 dark:bg-amber-950/60 dark:text-amber-300">
                      WARN
                    </span>
                  ) : (
                    <span className="rounded bg-blue-100 px-2 py-0.5 text-xs font-bold text-blue-800 dark:bg-blue-950/60 dark:text-blue-300">
                      DEBUG
                    </span>
                  )}
                  <span className="text-xs text-ink-400">Entry #{activeLog.id}</span>
                </div>
                <h3 className="mt-1.5 text-lg font-bold text-ink-900 break-words">{activeLog.title}</h3>
              </div>
              <button
                type="button"
                onClick={() => setActiveLog(null)}
                className="rounded-lg p-1.5 text-ink-400 hover:bg-paper hover:text-ink-800"
              >
                &times;
              </button>
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
              {/* Meta details */}
              <div className="grid grid-cols-2 gap-3 rounded-xl border border-line bg-paper/60 p-3 text-xs sm:grid-cols-3">
                <div>
                  <span className="text-ink-400">Log Date:</span>
                  <p className="mt-0.5 font-semibold text-ink-800">{formatDate(activeLog.createdAt)}</p>
                </div>
                <div>
                  <span className="text-ink-400">IP Address:</span>
                  <p className="mt-0.5 font-mono font-semibold text-ink-800">{activeLog.ipAddress || '127.0.0.1'}</p>
                </div>
                <div>
                  <span className="text-ink-400">Logger Component:</span>
                  <p className="mt-0.5 font-semibold text-ink-800">{activeLog.logger || 'system'}</p>
                </div>
              </div>

              {/* Backtrace / Log content */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs font-semibold uppercase tracking-wider text-ink-500">
                    Log Message &amp; Backtrace
                  </span>
                  <button
                    type="button"
                    onClick={() => copyLogToClipboard(activeLog)}
                    className="inline-flex items-center gap-1 text-xs text-brand-600 hover:underline"
                  >
                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                    <span>{copiedId === activeLog.id ? 'Copied!' : 'Copy trace'}</span>
                  </button>
                </div>
                <div className="max-h-72 overflow-y-auto rounded-xl border border-line bg-ink-900 p-4 text-xs font-mono text-emerald-400 select-text">
                  <pre className="whitespace-pre-wrap break-all">{activeLog.log || 'No details recorded.'}</pre>
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="flex items-center justify-between border-t border-line bg-paper/40 p-4 sm:p-5">
              <button
                type="button"
                onClick={() => {
                  setLogToDelete(activeLog.id)
                  setShowDeleteConfirm(true)
                }}
                className="inline-flex items-center gap-1.5 rounded-xl border border-rose-300 bg-rose-50 px-3.5 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-100 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
                <span>Delete Entry</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveLog(null)}
                className="rounded-xl bg-ink-800 px-4 py-2 text-xs font-semibold text-white hover:bg-ink-900"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 10. Delete Confirmation Dialog (osTicket prompt: Are you sure you want to DELETE...?) */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-2xl border border-line bg-surface p-6 shadow-2xl">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-rose-100 text-rose-600 dark:bg-rose-950/60 dark:text-rose-400">
                <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <h3 className="text-lg font-bold text-ink-900">Please Confirm</h3>
            </div>
            <hr className="my-4 border-line" />
            <p className="text-sm font-semibold text-rose-600">
              Are you sure you want to DELETE{' '}
              {logToDelete ? 'this log entry' : `${selectedIds.length} selected log entries`}?
            </p>
            <p className="mt-2 text-xs text-ink-500">
              Deleted log entries CANNOT be recovered.
            </p>
            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => {
                  setShowDeleteConfirm(false)
                  setLogToDelete(null)
                }}
                className="rounded-xl border border-line bg-surface px-4 py-2 text-xs font-semibold text-ink-800 hover:bg-paper"
              >
                No, Cancel
              </button>
              <button
                type="button"
                onClick={() => void confirmDelete()}
                className="rounded-xl bg-rose-600 px-4 py-2 text-xs font-semibold text-white hover:bg-rose-700"
              >
                Yes, Do it!
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 11. Purge Logs Modal */}
      {showPurgeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-2xl border border-line bg-surface p-6 shadow-2xl">
            <h3 className="text-lg font-bold text-ink-900">Purge System Logs</h3>
            <p className="mt-2 text-xs text-ink-600">
              According to your current System Settings (<strong>ost_config: log_graceperiod</strong>), logs older than{' '}
              <strong className="text-ink-900">
                {data?.config.logGracePeriodMonths ? `${data.config.logGracePeriodMonths} months` : 'N/A'}
              </strong>{' '}
              will be permanently removed.
            </p>
            {(!data?.config.logGracePeriodMonths || data.config.logGracePeriodMonths <= 0) && (
              <p className="mt-2 rounded-lg bg-amber-50 p-2 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                Notice: Log purging is currently disabled in System Settings (&quot;Never purge&quot;). Please update the Log Grace Period under Settings &gt; System before purging.
              </p>
            )}
            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setShowPurgeModal(false)}
                className="rounded-xl border border-line bg-surface px-4 py-2 text-xs font-semibold text-ink-800 hover:bg-paper"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!data?.config.logGracePeriodMonths || data.config.logGracePeriodMonths <= 0}
                onClick={() => void handlePurge()}
                className="rounded-xl bg-amber-600 px-4 py-2 text-xs font-semibold text-white hover:bg-amber-700 disabled:opacity-40"
              >
                Purge Now
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 12. Create Test Event Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
          <div className="w-full max-w-lg rounded-2xl border border-line bg-surface p-6 shadow-2xl">
            <h3 className="text-lg font-bold text-ink-900">Record System Log Event</h3>
            <p className="mt-1 text-xs text-ink-500">
              Manually record an event into <code>ost_syslog</code>. Event will be evaluated against the configured Log Level threshold.
            </p>
            <form onSubmit={handleCreateLog} className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-ink-700">Log Type (Severity)</label>
                <div className="mt-1 flex gap-2">
                  {(['Debug', 'Warning', 'Error'] as const).map(t => (
                    <button
                      type="button"
                      key={t}
                      onClick={() => setNewLogType(t)}
                      className={`flex-1 rounded-xl py-1.5 text-xs font-semibold border ${
                        newLogType === t
                          ? t === 'Error'
                            ? 'bg-rose-600 text-white border-rose-600'
                            : t === 'Warning'
                            ? 'bg-amber-500 text-white border-amber-500'
                            : 'bg-blue-600 text-white border-blue-600'
                          : 'border-line bg-paper text-ink-700 hover:bg-surface'
                      }`}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-ink-700">Log Title</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Cron execution timeout or API token error"
                  value={newLogTitle}
                  onChange={e => setNewLogTitle(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-line bg-paper px-3 py-2 text-xs text-ink-800 outline-none focus:ring-2 focus:ring-brand-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-ink-700">Logger Component</label>
                <input
                  type="text"
                  placeholder="e.g. cron.fetch, auth.ldap, api.v1"
                  value={newLogLogger}
                  onChange={e => setNewLogLogger(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-line bg-paper px-3 py-2 text-xs text-ink-800 outline-none focus:ring-2 focus:ring-brand-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-ink-700">Log Details / Backtrace</label>
                <textarea
                  required
                  rows={4}
                  placeholder="Detailed traceback, error description, or diagnostics…"
                  value={newLogBody}
                  onChange={e => setNewLogBody(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-line bg-paper px-3 py-2 text-xs font-mono text-ink-800 outline-none focus:ring-2 focus:ring-brand-500"
                />
              </div>

              <div className="mt-6 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="rounded-xl border border-line bg-surface px-4 py-2 text-xs font-semibold text-ink-800 hover:bg-paper"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creating}
                  className="rounded-xl bg-brand-600 px-4 py-2 text-xs font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
                >
                  {creating ? 'Saving…' : 'Record Log'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
