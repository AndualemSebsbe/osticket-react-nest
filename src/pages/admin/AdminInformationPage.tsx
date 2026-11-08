import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Card } from '../../components/ui'
import { getApiSystemInformation, type ApiSystemInformation } from '../../lib/api'
import { formatDate } from '../../lib/format'

const DOCS_URL = 'https://docs.osticket.com/en/latest/Admin/Dashboard/Information.html'

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB']
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / 1024 ** exponent
  return `${value.toFixed(exponent === 0 ? 0 : 2)} ${units[exponent]}`
}

function formatNumber(value: number) {
  return new Intl.NumberFormat().format(value)
}

function formatUptime(totalSeconds: number) {
  const seconds = Math.max(0, Math.floor(totalSeconds))
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  if (days > 0) return `${days}d ${hours}h ${minutes}m`
  if (hours > 0) return `${hours}h ${minutes}m`
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`
  return `${seconds}s`
}

function InfoRow({
  label,
  value,
  hint,
  mono = false,
}: {
  label: string
  value: ReactNode
  hint?: ReactNode
  mono?: boolean
}) {
  return (
    <div className="flex flex-col gap-0.5 border-b border-line/70 py-2 last:border-0 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
      <dt className="text-xs font-medium uppercase tracking-wide text-ink-400">{label}</dt>
      <dd className={`min-w-0 text-sm text-ink-800 sm:text-right ${mono ? 'break-all font-mono text-xs' : ''}`}>
        {value}
        {hint ? <span className="mt-0.5 block text-[11px] text-ink-400">{hint}</span> : null}
      </dd>
    </div>
  )
}

function StatCard({
  label,
  value,
  hint,
  tone = 'default',
}: {
  label: string
  value: string
  hint: string
  tone?: 'default' | 'brand'
}) {
  return (
    <Card className={tone === 'brand' ? 'border-brand-200 bg-brand-50/40 dark:border-brand-900/40 dark:bg-brand-950/10' : ''}>
      <p className="text-xs font-medium uppercase tracking-wider text-ink-400">{label}</p>
      <p className="mt-1 text-2xl font-bold text-ink-900">{value}</p>
      <p className="mt-0.5 text-xs text-ink-500">{hint}</p>
    </Card>
  )
}

function StatusBadge({ status }: { status: 'ok' | 'warning' }) {
  return status === 'ok' ? (
    <span className="inline-flex items-center gap-1 rounded-md bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300">
      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
      OK
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-md bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800 dark:bg-amber-950/60 dark:text-amber-300">
      <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
      Attention
    </span>
  )
}

export function AdminInformationPage() {
  const [data, setData] = useState<ApiSystemInformation | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        setLoading(true)
        setError('')
        const result = await getApiSystemInformation()
        if (!cancelled) setData(result)
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Could not load system information.')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [refreshKey])

  const tables = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!data) return []
    if (!query) return data.tables
    return data.tables.filter((table) => table.name.toLowerCase().includes(query))
  }, [data, search])

  const filteredTotals = useMemo(
    () =>
      tables.reduce(
        (totals, table) => ({
          totalBytes: totals.totalBytes + table.totalBytes,
          dataBytes: totals.dataBytes + table.dataBytes,
          indexBytes: totals.indexBytes + table.indexBytes,
        }),
        { totalBytes: 0, dataBytes: 0, indexBytes: 0 },
      ),
    [tables],
  )

  return (
    <div className="space-y-6">
      <div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2 text-xs font-medium uppercase tracking-wider text-ink-400">
              <span>Admin Panel</span>
              <span>&gt;</span>
              <span>Dashboard</span>
              <span>&gt;</span>
              <span className="text-brand-600">Information</span>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-3">
              <h1 className="text-2xl font-bold text-ink-900 sm:text-3xl">System Information</h1>
              <span className="rounded-full border border-line bg-paper px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-ink-500">
                Read only
              </span>
              <a
                href={DOCS_URL}
                target="_blank"
                rel="noreferrer"
                title="View osTicket Information documentation"
                className="inline-flex items-center gap-1 rounded-full border border-line bg-surface px-2.5 py-1 text-xs font-medium text-ink-600 hover:border-brand-500 hover:text-brand-600"
              >
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span>Docs</span>
              </a>
            </div>
            <p className="mt-1 max-w-3xl text-sm text-ink-500">
              About this installation — server runtime, database usage, schema signature, and configuration health,
              collected live from the application process, <code className="font-mono text-xs">information_schema.TABLES</code>, and{' '}
              <code className="font-mono text-xs">ost_config</code>. Nothing on this page is editable.
            </p>
          </div>

          <button
            type="button"
            onClick={() => setRefreshKey((key) => key + 1)}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-xl border border-line bg-surface px-3 py-2 text-xs font-semibold text-ink-800 hover:bg-paper disabled:opacity-50"
            title="Reload system information"
          >
            <svg className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {error ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-900 shadow-sm dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-200">
          <div className="flex items-center gap-2">
            <svg className="h-5 w-5 text-rose-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span>{error}</span>
          </div>
          <button
            type="button"
            onClick={() => setRefreshKey((key) => key + 1)}
            className="rounded-lg border border-rose-300 bg-white px-3 py-1 text-xs font-semibold text-rose-800 hover:bg-rose-100 dark:border-rose-800 dark:bg-zinc-900 dark:text-rose-200"
          >
            Try again
          </button>
        </div>
      ) : null}

      {loading && !data ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((item) => (
            <Card key={item}>
              <div className="h-3 w-24 animate-pulse rounded bg-paper" />
              <div className="mt-3 h-7 w-20 animate-pulse rounded bg-paper" />
              <div className="mt-2 h-3 w-32 animate-pulse rounded bg-paper" />
            </Card>
          ))}
        </div>
      ) : null}

      {data ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label="Database tables"
              value={formatNumber(data.database.tableCount)}
              hint={`Schema ${data.database.schema}`}
            />
            <StatCard
              label="Space used"
              value={formatBytes(data.database.totalBytes)}
              hint={`${formatBytes(data.database.dataBytes)} data · ${formatBytes(data.database.indexBytes)} index`}
              tone="brand"
            />
            <StatCard
              label="Attachment space"
              value={formatBytes(data.database.attachment.totalBytes)}
              hint={`${formatNumber(data.database.attachment.chunks)} chunks in ${data.database.attachment.table}`}
            />
            <StatCard
              label="PostgreSQL"
              value={data.database.versionShort}
              hint={data.database.host ? `${data.database.host}:${data.database.port}` : 'Database server'}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-sm font-semibold text-ink-900">Server Information</h2>
                <span className="rounded-full bg-paper px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-ink-500">
                  Runtime
                </span>
              </div>
              <dl className="mt-3">
                <InfoRow label="Product" value={data.application.name} hint={data.application.packageName} />
                <InfoRow label="Version" value={data.application.version} />
                <InfoRow label="Environment" value={<span className="capitalize">{data.application.environment}</span>} />
                <InfoRow label="Runtime" value={data.application.runtime} />
                <InfoRow label="Platform" value={data.application.platform} />
                <InfoRow label="Architecture" value={data.application.architecture} mono />
                <InfoRow label="Hostname" value={data.application.hostname} mono />
                <InfoRow label="Server time" value={formatDate(data.application.serverTime)} hint={data.application.timezone} />
                <InfoRow label="Process uptime" value={formatUptime(data.application.uptimeSeconds)} />
                <InfoRow
                  label="Memory"
                  value={`${formatBytes(data.application.memory.rss)} RSS`}
                  hint={`${formatBytes(data.application.memory.heapUsed)} heap used of ${formatBytes(data.application.memory.heapTotal)} · host ${formatBytes(data.application.memory.hostFree)} free of ${formatBytes(data.application.memory.hostTotal)}`}
                />
              </dl>
            </Card>

            <Card>
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-sm font-semibold text-ink-900">Database Information and Usage</h2>
                <span className="rounded-full bg-paper px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-ink-500">
                  PostgreSQL
                </span>
              </div>
              <dl className="mt-3">
                <InfoRow label="Engine" value={`${data.database.engine} ${data.database.versionShort}`} hint={data.database.version} />
                <InfoRow label="Schema" value={data.database.database} hint={`${data.database.host ? data.database.host + ':' + data.database.port : 'local'} · schema ${data.database.schema}`} />
                <InfoRow label="Database user" value={data.database.username} mono />
                <InfoRow
                  label="Schema signature"
                  value={data.database.schemaSignature || 'Not available'}
                  hint={data.database.schemaSignatureSource === 'config' ? 'From ost_config (core.schema_signature)' : 'Computed from information_schema (not recorded in ost_config)'}
                  mono
                />
                <InfoRow
                  label="Timezone"
                  value={data.database.timezone}
                  hint={
                    data.database.storedTimezone && data.database.storedTimezone !== data.database.timezone
                      ? `Stored as ${data.database.storedTimezone} in ost_config`
                      : data.database.storedTimezone
                        ? 'Matches the timezone stored in ost_config'
                        : 'No stored timezone in ost_config'
                  }
                />
                <InfoRow label="Space used" value={formatBytes(data.database.totalBytes)} hint={`${formatBytes(data.database.dataBytes)} data · ${formatBytes(data.database.indexBytes)} index`} />
                <InfoRow label="Tables" value={formatNumber(data.database.tableCount)} />
                <InfoRow
                  label="Attachment space"
                  value={formatBytes(data.database.attachment.totalBytes)}
                  hint={`${formatNumber(data.database.attachment.chunks)} chunks · ${formatBytes(data.database.attachment.dataBytes)} data · ${formatBytes(data.database.attachment.indexBytes)} index`}
                />
                <InfoRow label="Attachment storage" value={data.database.attachment.storageBackend === 'D' ? 'Database' : data.database.attachment.storageBackend} hint={`Table ${data.database.attachment.table}`} />
              </dl>
            </Card>
          </div>

          <Card>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-semibold text-ink-900">Configuration Health</h2>
                <p className="mt-0.5 text-xs text-ink-500">
                  Read-only checks derived from the live server and <code className="font-mono">ost_config</code>.
                </p>
              </div>
              <span className="text-xs text-ink-400">Generated {formatDate(data.generatedAt)}</span>
            </div>
            <div className="mt-3 grid gap-2 md:grid-cols-2">
              {data.checks.map((check) => (
                <div key={check.key} className="flex items-start justify-between gap-3 rounded-xl border border-line bg-paper/50 p-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-ink-800">{check.label}</p>
                    <p className="mt-0.5 text-xs text-ink-500">{check.detail}</p>
                  </div>
                  <StatusBadge status={check.status} />
                </div>
              ))}
            </div>
            <div className="mt-3 rounded-xl border border-line bg-paper/50 p-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-ink-400">Language packs</p>
              <p className="mt-1 text-sm text-ink-800">
                Primary: <span className="font-medium">{data.languages.primary}</span>
                {data.languages.secondary.length > 0 ? (
                  <span className="text-ink-500"> · Secondary: {data.languages.secondary.join(', ')}</span>
                ) : (
                  <span className="text-ink-500"> · No secondary languages configured</span>
                )}
              </p>
            </div>
          </Card>

          <Card>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-ink-900">Database Tables</h2>
                <p className="mt-0.5 text-xs text-ink-500">
                  Storage and index sizes reported by PostgreSQL for the <code className="font-mono">{data.database.schema}</code> schema.
                  Row counts are planner estimates.
                </p>
              </div>
              <div className="relative w-full sm:w-64">
                <input
                  type="search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Filter tables…"
                  className="w-full rounded-xl border border-line bg-paper py-1.5 pl-8 pr-3 text-xs text-ink-800 outline-none focus:ring-2 focus:ring-brand-500"
                />
                <svg className="absolute left-2.5 top-2 h-3.5 w-3.5 text-ink-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </div>
            </div>

            <div className="mt-3 overflow-x-auto rounded-xl border border-line">
              <table className="w-full min-w-[36rem] text-left text-xs">
                <thead className="border-b border-line bg-paper text-ink-600">
                  <tr>
                    <th className="px-3 py-2 font-semibold">Table</th>
                    <th className="px-3 py-2 text-right font-semibold">Rows (est.)</th>
                    <th className="px-3 py-2 text-right font-semibold">Data</th>
                    <th className="px-3 py-2 text-right font-semibold">Index</th>
                    <th className="px-3 py-2 text-right font-semibold">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {tables.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-3 py-8 text-center text-ink-500">
                        No tables match “{search}”.
                      </td>
                    </tr>
                  ) : (
                    tables.map((table) => (
                      <tr key={table.name} className="hover:bg-paper/60">
                        <td className="px-3 py-2 font-mono text-ink-800">{table.name}</td>
                        <td className="px-3 py-2 text-right text-ink-600">{formatNumber(table.rowEstimate)}</td>
                        <td className="px-3 py-2 text-right text-ink-600">{formatBytes(table.dataBytes)}</td>
                        <td className="px-3 py-2 text-right text-ink-600">{formatBytes(table.indexBytes)}</td>
                        <td className="px-3 py-2 text-right font-medium text-ink-800">{formatBytes(table.totalBytes)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
                <tfoot className="border-t border-line bg-paper/70 text-ink-700">
                  <tr>
                    <td className="px-3 py-2 font-semibold">
                      {search ? `${tables.length} of ${data.tables.length} tables` : `${data.tables.length} tables`}
                    </td>
                    <td className="px-3 py-2" />
                    <td className="px-3 py-2 text-right font-semibold">{formatBytes(filteredTotals.dataBytes)}</td>
                    <td className="px-3 py-2 text-right font-semibold">{formatBytes(filteredTotals.indexBytes)}</td>
                    <td className="px-3 py-2 text-right font-semibold">{formatBytes(filteredTotals.totalBytes)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </Card>
        </>
      ) : null}
    </div>
  )
}
