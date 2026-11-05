import { FormEvent, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { btnGhost, btnPrimary, Card, Field, inputClass } from '../../components/ui'
import {
  ApiCompanyField,
  ApiCompanyImage,
  ApiCompanySelection,
  ApiCompanySettings,
  companyAssetUrl,
  getApiCompanySettings,
  saveApiCompanySettings,
  uploadApiCompanyImage,
} from '../../lib/api'
import { saveSettings } from '../../lib/store'

type CompanySection = 'basic' | 'pages' | 'logos' | 'backdrop'

const emptySelection: ApiCompanySelection = {
  landingPageId: '0',
  offlinePageId: '0',
  thankYouPageId: '0',
  clientLogoId: '0',
  staffLogoId: '0',
  staffBackdropId: '0',
}

const sections: Array<{ id: CompanySection; label: string }> = [
  { id: 'basic', label: 'Basic Information' },
  { id: 'pages', label: 'Site Pages' },
  { id: 'logos', label: 'Logos' },
  { id: 'backdrop', label: 'Login Backdrop' },
]

function configNumber(configuration: Record<string, unknown>, key: string) {
  const value = Number(configuration[key])
  return Number.isFinite(value) && value > 0 ? value : undefined
}

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : 'Something went wrong while saving company settings.'
}

function choiceOptions(field: ApiCompanyField) {
  const raw = field.configuration.choices
  if (typeof raw !== 'string' || !raw.trim()) return []
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [key, ...rest] = line.split(':')
      return { value: key.trim(), label: (rest.join(':') || key).trim() }
    })
}

function ImageThumb({ image, className = 'h-14 w-auto max-w-[12rem]' }: { image: ApiCompanyImage; className?: string }) {
  return (
    <img
      src={companyAssetUrl(image.id)}
      alt={image.name}
      className={`rounded-lg border border-line bg-paper object-contain p-1 ${className}`}
    />
  )
}

function ImageManager({
  kind,
  images,
  selectedId,
  secondaryId,
  onSelect,
  onSelectSecondary,
  deleteIds,
  onToggleDelete,
  uploading,
  onUpload,
}: {
  kind: 'logo' | 'backdrop'
  images: ApiCompanyImage[]
  selectedId: string
  secondaryId?: string
  onSelect: (id: string) => void
  onSelectSecondary?: (id: string) => void
  deleteIds: string[]
  onToggleDelete: (id: string) => void
  uploading: boolean
  onUpload: (file: File) => void
}) {
  return (
    <div className="space-y-4">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[30rem] text-left text-sm">
          <thead className="text-ink-600">
            <tr>
              {kind === 'logo' ? (
                <>
                  <th className="px-2 py-2 font-medium">Client</th>
                  <th className="px-2 py-2 font-medium">Staff</th>
                </>
              ) : (
                <th className="px-2 py-2 font-medium">Staff</th>
              )}
              <th className="px-2 py-2 font-medium">{kind === 'logo' ? 'Logo' : 'Backdrop'}</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-t border-line">
              {kind === 'logo' ? (
                <>
                  <td className="px-2 py-3 align-middle">
                    <input
                      type="radio"
                      name="company-client-logo"
                      value="0"
                      checked={selectedId === '0'}
                      onChange={() => onSelect('0')}
                    />
                  </td>
                  <td className="px-2 py-3 align-middle">
                    <input
                      type="radio"
                      name="company-staff-logo"
                      value="0"
                      checked={secondaryId === '0'}
                      onChange={() => onSelectSecondary?.('0')}
                    />
                  </td>
                </>
              ) : (
                <td className="px-2 py-3 align-middle">
                  <input
                    type="radio"
                    name="company-backdrop"
                    value="0"
                    checked={selectedId === '0'}
                    onChange={() => onSelect('0')}
                  />
                </td>
              )}
              <td className="px-2 py-3 text-ink-600">System default</td>
            </tr>
            {images.map((image) => {
              const selected = selectedId === image.id || secondaryId === image.id
              return (
                <tr key={image.id} className="border-t border-line">
                  {kind === 'logo' ? (
                    <>
                      <td className="px-2 py-3 align-middle">
                        <input
                          type="radio"
                          name="company-client-logo"
                          value={image.id}
                          checked={selectedId === image.id}
                          onChange={() => onSelect(image.id)}
                        />
                      </td>
                      <td className="px-2 py-3 align-middle">
                        <input
                          type="radio"
                          name="company-staff-logo"
                          value={image.id}
                          checked={secondaryId === image.id}
                          onChange={() => onSelectSecondary?.(image.id)}
                        />
                      </td>
                    </>
                  ) : (
                    <td className="px-2 py-3 align-middle">
                      <input
                        type="radio"
                        name="company-backdrop"
                        value={image.id}
                        checked={selected}
                        onChange={() => onSelect(image.id)}
                      />
                    </td>
                  )}
                  <td className="px-2 py-3">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                      <ImageThumb image={image} />
                      <div className="min-w-0">
                        <p className="break-words font-medium text-ink-800">{image.name}</p>
                        <p className="text-xs text-ink-500">{Math.max(1, Math.round(image.size / 1024))} KB</p>
                        {!selected ? (
                          <label className="mt-1 flex items-center gap-2 text-xs text-ink-600">
                            <input
                              type="checkbox"
                              checked={deleteIds.includes(image.id)}
                              onChange={() => onToggleDelete(image.id)}
                            />
                            Delete on save
                          </label>
                        ) : null}
                      </div>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {!images.length ? (
        <p className="text-sm text-ink-600">No custom {kind === 'logo' ? 'logos' : 'backdrops'} uploaded yet.</p>
      ) : null}
      <Field label={kind === 'logo' ? 'Upload a new logo' : 'Upload a new backdrop'}>
        <input
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp"
          disabled={uploading}
          className={inputClass}
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file) onUpload(file)
            event.target.value = ''
          }}
        />
        <span className="mt-1 block text-xs font-normal text-ink-500">
          PNG, JPEG, GIF, or WebP, up to 5 MB. Logos look best with a wide aspect ratio.
        </span>
      </Field>
    </div>
  )
}

export function AdminCompanySettings() {
  const [data, setData] = useState<ApiCompanySettings | null>(null)
  const [values, setValues] = useState<Record<string, string>>({})
  const [selected, setSelected] = useState<ApiCompanySelection>(emptySelection)
  const [deleteLogoIds, setDeleteLogoIds] = useState<string[]>([])
  const [deleteBackdropIds, setDeleteBackdropIds] = useState<string[]>([])
  const [section, setSection] = useState<CompanySection>('basic')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState<'logo' | 'backdrop' | ''>('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  async function load(showSpinner = true) {
    if (showSpinner) setLoading(true)
    try {
      const result = await getApiCompanySettings()
      setData(result)
      setValues(Object.fromEntries(result.fields.map((field) => [field.name, field.value])))
      setSelected(result.selected)
      saveSettings({
        clientLogoId: result.selected.clientLogoId,
        staffLogoId: result.selected.staffLogoId,
        staffBackdropId: result.selected.staffBackdropId,
      })
      setDeleteLogoIds([])
      setDeleteBackdropIds([])
      setError('')
    } catch (err) {
      setError(messageOf(err))
    } finally {
      if (showSpinner) setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const pagesByType = useMemo(() => {
    const pages = data?.pages || []
    return {
      landing: pages.filter((page) => page.type === 'landing'),
      offline: pages.filter((page) => page.type === 'offline'),
      thankYou: pages.filter((page) => page.type === 'thank-you'),
    }
  }, [data])

  function setValue(name: string, value: string) {
    setValues((current) => ({ ...current, [name]: value }))
  }

  function chooseClientLogo(id: string) {
    setSelected((current) => ({ ...current, clientLogoId: id }))
    setDeleteLogoIds((current) => current.filter((item) => item !== id))
  }

  function chooseStaffLogo(id: string) {
    setSelected((current) => ({ ...current, staffLogoId: id }))
    setDeleteLogoIds((current) => current.filter((item) => item !== id))
  }

  function chooseBackdrop(id: string) {
    setSelected((current) => ({ ...current, staffBackdropId: id }))
    setDeleteBackdropIds((current) => current.filter((item) => item !== id))
  }

  function toggleDelete(kind: 'logo' | 'backdrop', id: string) {
    const update = (current: string[]) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id]
    if (kind === 'logo') setDeleteLogoIds(update)
    else setDeleteBackdropIds(update)
  }

  async function onSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setError('')
    setNotice('')
    try {
      await saveApiCompanySettings({ values, ...selected, deleteLogoIds, deleteBackdropIds })
      saveSettings({
        companyName: values.name || '',
        website: values.website || '',
        phone: values.phone || '',
        address: values.address || '',
        clientLogoId: selected.clientLogoId,
        staffLogoId: selected.staffLogoId,
        staffBackdropId: selected.staffBackdropId,
      })
      await load(false)
      setNotice('Company settings saved.')
    } catch (err) {
      setError(messageOf(err))
    } finally {
      setSaving(false)
    }
  }

  async function onUpload(kind: 'logo' | 'backdrop', file: File) {
    setUploading(kind)
    setError('')
    setNotice('')
    try {
      const image = await uploadApiCompanyImage(kind, file)
      setData((current) => {
        if (!current) return current
        return kind === 'logo'
          ? { ...current, logos: [...current.logos, image] }
          : { ...current, backdrops: [...current.backdrops, image] }
      })
      if (kind === 'logo') {
        setSelected((current) => ({ ...current, clientLogoId: image.id }))
      } else {
        setSelected((current) => ({ ...current, staffBackdropId: image.id }))
      }
      setNotice('Image uploaded. Save changes to apply it.')
    } catch (err) {
      setError(messageOf(err))
    } finally {
      setUploading('')
    }
  }

  function renderField(field: ApiCompanyField) {
    const value = values[field.name] ?? ''
    const maximum = configNumber(field.configuration, 'length')
    const hint = field.hint ? <span className="mt-1 block text-xs font-normal text-ink-500">{field.hint}</span> : null
    const label = (
      <Field key={field.id} label={field.label} className={field.type === 'memo' ? 'sm:col-span-2' : ''}>
        {field.type === 'memo' ? (
          <textarea
            className={inputClass}
            rows={configNumber(field.configuration, 'rows') || 4}
            maxLength={maximum}
            value={value}
            onChange={(event) => setValue(field.name, event.target.value)}
          />
        ) : field.type === 'bool' ? (
          <input
            type="checkbox"
            checked={value === '1' || value.toLowerCase() === 'true'}
            onChange={(event) => setValue(field.name, event.target.checked ? '1' : '0')}
          />
        ) : field.type === 'choices' ? (
          <select className={inputClass} value={value} onChange={(event) => setValue(field.name, event.target.value)}>
            <option value="">— Select —</option>
            {choiceOptions(field).map((choice) => (
              <option key={choice.value} value={choice.value}>
                {choice.label}
              </option>
            ))}
          </select>
        ) : field.type === 'info' ? (
          <p className="whitespace-pre-wrap text-sm font-normal text-ink-600">{value || field.label}</p>
        ) : (
          <input
            className={inputClass}
            type={field.configuration.validator === 'email' ? 'email' : field.type === 'phone' ? 'tel' : 'text'}
            maxLength={maximum}
            value={value}
            onChange={(event) => setValue(field.name, event.target.value)}
          />
        )}
        {hint}
      </Field>
    )
    return label
  }

  if (loading) {
    return (
      <Card>
        <p className="py-10 text-center text-sm text-ink-600">Loading company settings…</p>
      </Card>
    )
  }

  if (!data) {
    return (
      <Card>
        <div className="space-y-3 py-6 text-center">
          <p className="text-sm text-rose-600">{error || 'Company settings could not be loaded.'}</p>
          <button type="button" className={btnGhost} onClick={() => void load()}>
            Try again
          </button>
        </div>
      </Card>
    )
  }

  return (
    <Card>
      <form onSubmit={onSave} className="space-y-5">
        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
          {sections.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setSection(item.id)}
              className={`shrink-0 rounded-full px-3 py-1.5 text-sm ${
                section === item.id ? 'bg-brand-600 text-white' : 'bg-paper text-ink-700 ring-1 ring-line'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        {error ? <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p> : null}
        {notice ? <p className="rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{notice}</p> : null}

        {section === 'basic' ? (
          <div className="space-y-4">
            <div>
              <h2 className="text-base font-semibold text-ink-800">{data.form.title}</h2>
              {data.form.instructions ? <p className="mt-1 text-sm text-ink-600">{data.form.instructions}</p> : null}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {data.fields.length ? (
                data.fields.map(renderField)
              ) : (
                <p className="text-sm text-ink-600">The company information form has no fields.</p>
              )}
            </div>
          </div>
        ) : null}

        {section === 'pages' ? (
          <div className="space-y-4">
            <div>
              <h2 className="text-base font-semibold text-ink-800">Site Pages</h2>
              <p className="mt-1 text-sm text-ink-600">
                Choose the pages used by the client portal. You can edit page content in{' '}
                <Link className="font-medium text-brand-700 underline" to="/scp/admin/pages">
                  Manage &gt; Site Pages
                </Link>
                .
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Landing Page">
                <select
                  className={inputClass}
                  value={selected.landingPageId}
                  onChange={(event) => setSelected((current) => ({ ...current, landingPageId: event.target.value }))}
                >
                  <option value="0">— Select Landing Page —</option>
                  {pagesByType.landing.map((page) => (
                    <option key={page.id} value={page.id}>
                      {page.name}
                      {page.active ? '' : ' (inactive)'}
                    </option>
                  ))}
                </select>
                {!pagesByType.landing.length ? (
                  <span className="mt-1 block text-xs font-normal text-amber-700">No landing pages have been created yet.</span>
                ) : null}
              </Field>
              <Field label="Offline Page">
                <select
                  className={inputClass}
                  value={selected.offlinePageId}
                  onChange={(event) => setSelected((current) => ({ ...current, offlinePageId: event.target.value }))}
                >
                  <option value="0">— Select Offline Page —</option>
                  {pagesByType.offline.map((page) => (
                    <option key={page.id} value={page.id}>
                      {page.name}
                      {page.active ? '' : ' (inactive)'}
                    </option>
                  ))}
                </select>
                {!pagesByType.offline.length ? (
                  <span className="mt-1 block text-xs font-normal text-amber-700">No offline pages have been created yet.</span>
                ) : null}
              </Field>
              <Field label="Default Thank-You Page" className="sm:col-span-2">
                <select
                  className={inputClass}
                  value={selected.thankYouPageId}
                  onChange={(event) => setSelected((current) => ({ ...current, thankYouPageId: event.target.value }))}
                >
                  <option value="0">— Select Thank-You Page —</option>
                  {pagesByType.thankYou.map((page) => (
                    <option key={page.id} value={page.id}>
                      {page.name}
                      {page.active ? '' : ' (inactive)'}
                    </option>
                  ))}
                </select>
                {!pagesByType.thankYou.length ? (
                  <span className="mt-1 block text-xs font-normal text-amber-700">No thank-you pages have been created yet.</span>
                ) : null}
              </Field>
            </div>
          </div>
        ) : null}

        {section === 'logos' ? (
          <div className="space-y-4">
            <div>
              <h2 className="text-base font-semibold text-ink-800">Logos</h2>
              <p className="mt-1 text-sm text-ink-600">
                Pick the logo shown to clients and the logo shown in the staff control panel. The same image can be used
                for both.
              </p>
            </div>
            <ImageManager
              kind="logo"
              images={data.logos}
              selectedId={selected.clientLogoId}
              secondaryId={selected.staffLogoId}
              onSelect={chooseClientLogo}
              onSelectSecondary={chooseStaffLogo}
              deleteIds={deleteLogoIds}
              onToggleDelete={(id) => toggleDelete('logo', id)}
              uploading={uploading === 'logo'}
              onUpload={(file) => void onUpload('logo', file)}
            />
          </div>
        ) : null}

        {section === 'backdrop' ? (
          <div className="space-y-4">
            <div>
              <h2 className="text-base font-semibold text-ink-800">Login Backdrop</h2>
              <p className="mt-1 text-sm text-ink-600">
                Choose the background image used on the staff login page. Leave the system default selected to use the
                built-in backdrop.
              </p>
            </div>
            <ImageManager
              kind="backdrop"
              images={data.backdrops}
              selectedId={selected.staffBackdropId}
              onSelect={chooseBackdrop}
              deleteIds={deleteBackdropIds}
              onToggleDelete={(id) => toggleDelete('backdrop', id)}
              uploading={uploading === 'backdrop'}
              onUpload={(file) => void onUpload('backdrop', file)}
            />
          </div>
        ) : null}

        <div className="flex flex-col gap-2 border-t border-line pt-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-ink-500">Changes apply to the client portal and staff panel after saving.</p>
          <button className={btnPrimary} disabled={saving || Boolean(uploading)}>
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </form>
    </Card>
  )
}
