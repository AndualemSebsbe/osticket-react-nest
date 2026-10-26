import type { FormEvent, ReactNode } from 'react'

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string
  subtitle?: string
  actions?: ReactNode
}) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold text-ink-800 sm:text-2xl">{title}</h1>
        {subtitle ? <p className="mt-1 text-sm text-ink-600">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex w-full min-w-0 flex-wrap gap-2 sm:w-auto sm:justify-end">{actions}</div> : null}
    </div>
  )
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-2xl border border-line bg-surface p-4 shadow-sm sm:p-5 ${className}`}>{children}</div>
}

export function Field({
  label,
  children,
  className = '',
}: {
  label: string
  children: ReactNode
  className?: string
}) {
  return (
    <label className={`block min-w-0 text-sm font-medium text-ink-800 ${className}`}>
      {label}
      <div className="mt-1">{children}</div>
    </label>
  )
}

export const inputClass =
  'w-full min-w-0 rounded-xl border border-line bg-paper px-3 py-2.5 text-sm text-ink-800 outline-none focus:ring-2 focus:ring-brand-500 sm:py-2'

export const btnPrimary =
  'inline-flex min-h-11 items-center justify-center rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 sm:min-h-0'

export const btnGhost =
  'inline-flex min-h-11 items-center justify-center rounded-xl border border-line bg-surface px-4 py-2 text-sm text-ink-800 hover:bg-paper sm:min-h-0'

export function FormGrid({ children, onSubmit }: { children: ReactNode; onSubmit: (e: FormEvent<HTMLFormElement>) => void }) {
  return (
    <form onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-2">
      {children}
    </form>
  )
}

export function DataTable({
  columns,
  rows,
  rowKey,
  renderCard,
  empty = 'No records.',
}: {
  columns: { key: string; label: string; render: (row: Record<string, unknown>) => ReactNode }[]
  rows: Record<string, unknown>[]
  rowKey: (row: Record<string, unknown>) => string
  renderCard?: (row: Record<string, unknown>) => ReactNode
  empty?: string
}) {
  return (
    <>
      <ul className="grid gap-3 lg:hidden">
        {rows.map((row) => (
          <li key={rowKey(row)}>
            {renderCard ? (
              renderCard(row)
            ) : (
              <Card>
                {columns.map((col) => (
                  <p key={col.key} className="break-words text-sm">
                    <span className="text-ink-400">{col.label}: </span>
                    {col.render(row)}
                  </p>
                ))}
              </Card>
            )}
          </li>
        ))}
      </ul>
      <div className="-mx-4 hidden overflow-x-auto px-4 lg:mx-0 lg:block lg:px-0">
        <div className="min-w-full overflow-hidden rounded-2xl border border-line bg-surface">
          <table className="w-full min-w-[40rem] text-left text-sm">
            <thead className="sticky top-0 bg-paper text-ink-600">
              <tr>
                {columns.map((col) => (
                  <th key={col.key} className="whitespace-nowrap px-4 py-3 font-medium">
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={rowKey(row)} className="border-t border-line">
                  {columns.map((col) => (
                    <td key={col.key} className="max-w-[16rem] break-words px-4 py-3 align-top">
                      {col.render(row)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {rows.length === 0 ? <p className="mt-4 text-sm text-ink-600">{empty}</p> : null}
    </>
  )
}
