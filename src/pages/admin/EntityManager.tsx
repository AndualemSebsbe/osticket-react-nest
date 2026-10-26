import { FormEvent, useMemo, useState } from 'react'
import { btnGhost, btnPrimary, Card, DataTable, Field, inputClass, PageHeader } from '../../components/ui'
import { newId, removeRecord, upsertRecord } from '../../lib/store'
import type { Database } from '../../types'

type FieldType = 'text' | 'textarea' | 'select' | 'number' | 'checkbox' | 'email'

export interface ManagerField {
  name: string
  label: string
  type: FieldType
  options?: { value: string; label: string }[]
  required?: boolean
  span2?: boolean
}

export function EntityManager<K extends keyof Database>({
  title,
  subtitle,
  collection,
  rows,
  columns,
  fields,
  defaults,
  onCreate,
  onUpdate,
  onDelete,
}: {
  title: string
  subtitle: string
  collection: K
  rows: { id: string }[]
  columns: { key: string; label: string; render?: (row: Record<string, unknown>) => string }[]
  fields: ManagerField[]
  defaults: Record<string, unknown>
  onCreate?: (record: Record<string, unknown>) => Promise<Record<string, unknown>>
  onUpdate?: (record: Record<string, unknown>) => Promise<Record<string, unknown>>
  onDelete?: (id: string) => Promise<void>
}) {
  const [editing, setEditing] = useState<string | 'new' | null>(null)
  const [q, setQ] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase()
    if (!query) return rows
    return rows.filter((row) => JSON.stringify(row).toLowerCase().includes(query))
  }, [rows, q])

  const current = (editing === 'new' ? defaults : rows.find((r) => r.id === editing)) as Record<string, unknown> | undefined

  async function onSave(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    let next: Record<string, unknown> = { ...current, id: (current?.id as string) || newId() }
    for (const field of fields) {
      const existing = current?.[field.name]
      if (field.type === 'checkbox') next[field.name] = form.get(field.name) === 'on'
      else if (field.type === 'number') next[field.name] = Number(form.get(field.name) || 0)
      else if (Array.isArray(existing) || field.name === 'permissions' || field.name === 'memberIds') {
        next[field.name] = String(form.get(field.name) ?? '')
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      } else next[field.name] = String(form.get(field.name) ?? '')
    }
    setSaving(true)
    setSaveError('')
    try {
      if (editing === 'new' && onCreate) next = { ...next, ...await onCreate(next) }
      else if (editing !== 'new' && onUpdate) next = { ...next, ...await onUpdate(next) }
      upsertRecord(collection, next as never)
      setEditing(null)
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Could not save this record.')
    } finally {
      setSaving(false)
    }
  }

  async function deleteRow(id: string) {
    if (!window.confirm('Delete this record? This action cannot be undone.')) return
    setSaving(true)
    setSaveError('')
    try {
      if (onDelete) await onDelete(id)
      removeRecord(collection, id)
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Could not delete this record.')
    } finally {
      setSaving(false)
    }
  }

  function cell(row: Record<string, unknown>, col: (typeof columns)[number]) {
    return col.render ? col.render(row) : String(row[col.key] ?? '—')
  }

  return (
    <div className="min-w-0">
      <PageHeader
        title={title}
        subtitle={subtitle}
        actions={
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" className={`${inputClass} sm:max-w-xs`} />
            <button type="button" className={btnPrimary} onClick={() => setEditing('new')}>
              Add new
            </button>
          </div>
        }
      />

      {editing && current ? (
        <Card className="mb-6">
          <h2 className="mb-4 font-semibold">{editing === 'new' ? 'Add' : 'Edit'}</h2>
          {saveError ? <p role="alert" className="mb-4 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-800">{saveError}</p> : null}
          <form onSubmit={onSave} className="grid gap-4 sm:grid-cols-2">
            {fields.map((field) => (
              <Field key={field.name} label={field.label} className={field.span2 ? 'sm:col-span-2' : ''}>
                {field.type === 'textarea' ? (
                  <textarea
                    name={field.name}
                    required={field.required}
                    rows={4}
                    defaultValue={Array.isArray(current[field.name]) ? (current[field.name] as string[]).join(', ') : String(current[field.name] ?? '')}
                    className={inputClass}
                  />
                ) : field.type === 'select' ? (
                  <select name={field.name} defaultValue={String(current[field.name] ?? '')} className={inputClass}>
                    {(field.options ?? []).map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                ) : field.type === 'checkbox' ? (
                  <input name={field.name} type="checkbox" defaultChecked={Boolean(current[field.name])} className="h-4 w-4" />
                ) : (
                  <input
                    name={field.name}
                    type={field.type}
                    required={field.required}
                    defaultValue={Array.isArray(current[field.name]) ? (current[field.name] as string[]).join(', ') : String(current[field.name] ?? '')}
                    className={inputClass}
                  />
                )}
              </Field>
            ))}
            <div className="flex flex-wrap gap-2 sm:col-span-2">
              <button type="submit" className={btnPrimary} disabled={saving}>
                {saving ? 'Saving…' : 'Save'}
              </button>
              <button type="button" className={btnGhost} disabled={saving} onClick={() => setEditing(null)}>
                Cancel
              </button>
            </div>
          </form>
        </Card>
      ) : null}

      {!editing && saveError ? <p role="alert" className="mb-4 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-800">{saveError}</p> : null}

      <DataTable
        rows={filtered as Record<string, unknown>[]}
        rowKey={(row) => String(row.id)}
        empty="No records."
        columns={[
          ...columns.map((col) => ({
            key: col.key,
            label: col.label,
            render: (row: Record<string, unknown>) => cell(row, col),
          })),
          {
            key: 'actions',
            label: 'Actions',
            render: (row: Record<string, unknown>) => (
              <div className="flex flex-wrap gap-3">
                <button type="button" className="text-brand-600" onClick={() => setEditing(String(row.id))}>
                  Edit
                </button>
                <button type="button" className="text-rose-600" onClick={() => void deleteRow(String(row.id))}>
                  Delete
                </button>
              </div>
            ),
          },
        ]}
        renderCard={(row) => (
          <Card>
            {columns.map((col, i) => (
              <p key={col.key} className={`break-words text-sm ${i === 0 ? 'font-medium' : ''}`}>
                {i === 0 ? cell(row, col) : (
                  <>
                    <span className="text-ink-400">{col.label}: </span>
                    {cell(row, col)}
                  </>
                )}
              </p>
            ))}
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" className={btnGhost} onClick={() => setEditing(String(row.id))}>
                Edit
              </button>
              <button type="button" className={`${btnGhost} text-rose-600`} onClick={() => void deleteRow(String(row.id))}>
                Delete
              </button>
            </div>
          </Card>
        )}
      />
    </div>
  )
}
