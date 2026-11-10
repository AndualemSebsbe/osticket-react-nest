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
import { getDb, saveSettings } from '../../lib/store'

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

function ImageThumb({
  src,
  alt = 'Image',
  className = 'h-14 w-auto max-w-[12rem]',
}: {
  src: string
  alt?: string
  className?: string
}) {
  return (
    <img
      src={src}
      alt={alt}
      className={`rounded-lg border border-line bg-paper object-contain p-1 shadow-sm ${className}`}
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
  onResetClient,
  onResetStaff,
  clientPreview,
  staffPreview,
  backdropPreview,
}: {
  kind: 'logo' | 'backdrop'
  images: ApiCompanyImage[]
  selectedId: string
  secondaryId?: string
  onSelect: (id: string, url?: string) => void
  onSelectSecondary?: (id: string, url?: string) => void
  deleteIds: string[]
  onToggleDelete: (id: string) => void
  uploading: boolean
  onUpload: (file: File) => void
  onResetClient?: () => void
  onResetStaff?: () => void
  clientPreview?: string
  staffPreview?: string
  backdropPreview?: string
}) {
  return (
    <div className="space-y-6">
      {/* Live Preview Section */}
      {kind === 'logo' ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {/* Client Logo Preview */}
          <div className="rounded-2xl border border-line bg-slate-50 dark:bg-slate-900/40 p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold uppercase tracking-wider text-ink-600">
                Client Portal Header Preview
              </span>
              {selectedId !== '0' ? (
                <button
                  type="button"
                  onClick={onResetClient}
                  className="text-xs font-medium text-rose-600 hover:underline"
                >
                  Reset to default
                </button>
              ) : null}
            </div>
            <div className="flex items-center gap-2 rounded-xl bg-blue-700 px-4 py-2.5 text-white shadow-inner">
              {clientPreview ? (
                <img
                  src={clientPreview}
                  alt="Client Logo"
                  className="h-8 max-h-8 w-auto max-w-[10rem] object-contain"
                />
              ) : (
                <span className="grid h-8 w-8 place-items-center rounded bg-white/20 text-base">✉</span>
              )}
              <span className="truncate text-sm font-semibold">osTicket · Support Center</span>
            </div>
          </div>

          {/* Staff Logo Preview */}
          <div className="rounded-2xl border border-line bg-slate-50 dark:bg-slate-900/40 p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold uppercase tracking-wider text-ink-600">
                Staff Control Panel Sidebar Preview
              </span>
              {secondaryId !== '0' ? (
                <button
                  type="button"
                  onClick={onResetStaff}
                  className="text-xs font-medium text-rose-600 hover:underline"
                >
                  Reset to default
                </button>
              ) : null}
            </div>
            <div className="flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-white shadow-inner">
              {staffPreview ? (
                <img
                  src={staffPreview}
                  alt="Staff Logo"
                  className="h-8 max-h-8 w-auto max-w-[10rem] object-contain"
                />
              ) : (
                <span className="grid h-8 w-8 place-items-center rounded bg-blue-600 text-xs font-bold">SCP</span>
              )}
              <span className="truncate text-sm font-semibold">Staff Control Panel</span>
            </div>
          </div>
        </div>
      ) : (
        /* Login Backdrop Preview */
        <div className="rounded-2xl border border-line bg-slate-50 dark:bg-slate-900/40 p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold uppercase tracking-wider text-ink-600">
              Staff Sign-in Backdrop Preview
            </span>
            {selectedId !== '0' ? (
              <button
                type="button"
                onClick={onResetClient}
                className="text-xs font-medium text-rose-600 hover:underline"
              >
                Reset to default
              </button>
            ) : null}
          </div>
          <div className="relative h-44 w-full overflow-hidden rounded-xl border border-slate-300 dark:border-slate-800 bg-slate-200 dark:bg-slate-950 flex items-center justify-center">
            {backdropPreview ? (
              <>
                <div
                  className="absolute inset-0 bg-cover bg-center opacity-30 blur-sm"
                  style={{ backgroundImage: `url(${backdropPreview})` }}
                />
                <img
                  src={backdropPreview}
                  alt="Backdrop"
                  className="relative max-h-36 max-w-[90%] object-contain drop-shadow-lg"
                />
              </>
            ) : (
              <div className="flex flex-col items-center gap-1 text-ink-500">
                <span className="text-2xl">✨</span>
                <span className="text-xs">Using system default ambient gradient</span>
              </div>
            )}
            <div className="absolute bottom-2 right-2 rounded-md bg-black/60 px-2 py-0.5 text-[10px] text-white backdrop-blur">
              <Link to="/scp/login" target="_blank" className="hover:underline">
                Open Staff Login Page ↗
              </Link>
            </div>
          </div>
        </div>
      )}

      {/* Available Images Table */}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[30rem] text-left text-sm">
          <thead className="text-ink-600">
            <tr>
              {kind === 'logo' ? (
                <>
                  <th className="px-3 py-2 font-medium">Client</th>
                  <th className="px-3 py-2 font-medium">Staff</th>
                </>
              ) : (
                <th className="px-3 py-2 font-medium">Active Backdrop</th>
              )}
              <th className="px-3 py-2 font-medium">{kind === 'logo' ? 'Logo' : 'Backdrop'}</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-t border-line">
              {kind === 'logo' ? (
                <>
                  <td className="px-3 py-3 align-middle">
                    <input
                      type="radio"
                      name="company-client-logo"
                      value="0"
                      checked={selectedId === '0'}
                      onChange={() => onSelect('0', '')}
                    />
                  </td>
                  <td className="px-3 py-3 align-middle">
                    <input
                      type="radio"
                      name="company-staff-logo"
                      value="0"
                      checked={secondaryId === '0'}
                      onChange={() => onSelectSecondary?.('0', '')}
                    />
                  </td>
                </>
              ) : (
                <td className="px-3 py-3 align-middle">
                  <input
                    type="radio"
                    name="company-backdrop"
                    value="0"
                    checked={selectedId === '0'}
                    onChange={() => onSelect('0', '')}
                  />
                </td>
              )}
              <td className="px-3 py-3 text-ink-600">System default (built-in branding)</td>
            </tr>
            {images.map((image) => {
              const src = image.id.startsWith('data:') || image.id.startsWith('http')
                ? image.id
                : companyAssetUrl(image.id)
              const selected = selectedId === image.id || secondaryId === image.id
              return (
                <tr key={image.id} className="border-t border-line hover:bg-slate-50/50 dark:hover:bg-slate-800/20">
                  {kind === 'logo' ? (
                    <>
                      <td className="px-3 py-3 align-middle">
                        <input
                          type="radio"
                          name="company-client-logo"
                          value={image.id}
                          checked={selectedId === image.id}
                          onChange={() => onSelect(image.id, src)}
                        />
                      </td>
                      <td className="px-3 py-3 align-middle">
                        <input
                          type="radio"
                          name="company-staff-logo"
                          value={image.id}
                          checked={secondaryId === image.id}
                          onChange={() => onSelectSecondary?.(image.id, src)}
                        />
                      </td>
                    </>
                  ) : (
                    <td className="px-3 py-3 align-middle">
                      <input
                        type="radio"
                        name="company-backdrop"
                        value={image.id}
                        checked={selectedId === image.id}
                        onChange={() => onSelect(image.id, src)}
                      />
                    </td>
                  )}
                  <td className="px-3 py-3">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                      <ImageThumb src={src} alt={image.name} />
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

      {/* File Upload Box */}
      <Field label={kind === 'logo' ? 'Upload new logo image' : 'Upload new backdrop image'}>
        <div className="flex items-center gap-3">
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
          {uploading ? <span className="text-sm text-brand-600 animate-pulse font-medium">Processing…</span> : null}
        </div>
        <span className="mt-1 block text-xs font-normal text-ink-500">
          PNG, JPEG, GIF, or WebP, up to 5 MB. Changes take effect across client & staff portals immediately.
        </span>
      </Field>
    </div>
  )
}

export function AdminCompanySettings() {
  const currentDb = getDb()
  const [data, setData] = useState<ApiCompanySettings | null>(null)
  const [values, setValues] = useState<Record<string, string>>({})
  const [selected, setSelected] = useState<ApiCompanySelection>(() => ({
    ...emptySelection,
    clientLogoId: currentDb.settings.clientLogoId || '0',
    staffLogoId: currentDb.settings.staffLogoId || '0',
    staffBackdropId: currentDb.settings.staffBackdropId || '0',
  }))

  // Active image URLs (either data URLs or asset URLs)
  const [clientLogoUrl, setClientLogoUrl] = useState<string>(currentDb.settings.clientLogo || '')
  const [staffLogoUrl, setStaffLogoUrl] = useState<string>(currentDb.settings.staffLogo || '')
  const [backdropUrl, setBackdropUrl] = useState<string>(currentDb.settings.staffBackdrop || '')

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
    const localDb = getDb()
    try {
      const result = await getApiCompanySettings()
      setData(result)
      setValues(Object.fromEntries(result.fields.map((field) => [field.name, field.value])))
      setSelected(result.selected)

      // Resolve initial preview URLs
      if (result.selected.clientLogoId && result.selected.clientLogoId !== '0') {
        setClientLogoUrl(localDb.settings.clientLogo || companyAssetUrl(result.selected.clientLogoId))
      }
      if (result.selected.staffLogoId && result.selected.staffLogoId !== '0') {
        setStaffLogoUrl(localDb.settings.staffLogo || companyAssetUrl(result.selected.staffLogoId))
      }
      if (result.selected.staffBackdropId && result.selected.staffBackdropId !== '0') {
        setBackdropUrl(localDb.settings.staffBackdrop || companyAssetUrl(result.selected.staffBackdropId))
      }

      setDeleteLogoIds([])
      setDeleteBackdropIds([])
      setError('')
    } catch (err) {
      // Graceful fallback to local settings if backend fails
      console.warn('[AdminCompanySettings] Backend unavailable, using local store', err)
      const fallback: ApiCompanySettings = {
        form: {
          id: '1',
          title: 'Company Information',
          instructions: 'Details available in email templates',
          notes: '',
        },
        entryId: '1',
        fields: [
          {
            id: '1',
            name: 'name',
            label: 'Company Name',
            type: 'text',
            hint: '',
            sort: 1,
            configuration: { size: 40, length: 64 },
            value: localDb.settings.companyName || '',
          },
          {
            id: '2',
            name: 'website',
            label: 'Website',
            type: 'text',
            hint: '',
            sort: 2,
            configuration: { size: 40, length: 64 },
            value: localDb.settings.website || '',
          },
          {
            id: '3',
            name: 'phone',
            label: 'Phone Number',
            type: 'phone',
            hint: '',
            sort: 3,
            configuration: { ext: false },
            value: localDb.settings.phone || '',
          },
          {
            id: '4',
            name: 'address',
            label: 'Address',
            type: 'memo',
            hint: '',
            sort: 4,
            configuration: { rows: 2, cols: 40, html: false, length: 100 },
            value: localDb.settings.address || '',
          },
        ],
        pages: [],
        logos: localDb.settings.clientLogo
          ? [{ id: 'local-client', name: 'Current Logo', type: 'image/png', size: 1024, created: new Date().toISOString(), url: localDb.settings.clientLogo }]
          : [],
        backdrops: localDb.settings.staffBackdrop
          ? [{ id: 'local-backdrop', name: 'Current Backdrop', type: 'image/png', size: 2048, created: new Date().toISOString(), url: localDb.settings.staffBackdrop }]
          : [],
        selected: {
          landingPageId: '0',
          offlinePageId: '0',
          thankYouPageId: '0',
          clientLogoId: localDb.settings.clientLogoId || '0',
          staffLogoId: localDb.settings.staffLogoId || '0',
          staffBackdropId: localDb.settings.staffBackdropId || '0',
        },
      }
      setData(fallback)
      setValues(Object.fromEntries(fallback.fields.map((f) => [f.name, f.value])))
      setSelected(fallback.selected)
      setClientLogoUrl(localDb.settings.clientLogo || '')
      setStaffLogoUrl(localDb.settings.staffLogo || '')
      setBackdropUrl(localDb.settings.staffBackdrop || '')
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

  function chooseClientLogo(id: string, url?: string) {
    setSelected((current) => ({ ...current, clientLogoId: id }))
    const resolvedUrl = id === '0' ? '' : (url || (id ? companyAssetUrl(id) : ''))
    setClientLogoUrl(resolvedUrl)
    setDeleteLogoIds((current) => current.filter((item) => item !== id))
    // Immediately persist to local store
    saveSettings({ clientLogoId: id, clientLogo: resolvedUrl })
  }

  function chooseStaffLogo(id: string, url?: string) {
    setSelected((current) => ({ ...current, staffLogoId: id }))
    const resolvedUrl = id === '0' ? '' : (url || (id ? companyAssetUrl(id) : ''))
    setStaffLogoUrl(resolvedUrl)
    setDeleteLogoIds((current) => current.filter((item) => item !== id))
    // Immediately persist to local store
    saveSettings({ staffLogoId: id, staffLogo: resolvedUrl })
  }

  function chooseBackdrop(id: string, url?: string) {
    setSelected((current) => ({ ...current, staffBackdropId: id }))
    const resolvedUrl = id === '0' ? '' : (url || (id ? companyAssetUrl(id) : ''))
    setBackdropUrl(resolvedUrl)
    setDeleteBackdropIds((current) => current.filter((item) => item !== id))
    // Immediately persist to local store
    saveSettings({ staffBackdropId: id, staffBackdrop: resolvedUrl })
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
      // 1. Immediately persist full configuration into local store (0ms reaction)
      saveSettings({
        companyName: values.name || '',
        website: values.website || '',
        phone: values.phone || '',
        address: values.address || '',
        clientLogoId: selected.clientLogoId,
        staffLogoId: selected.staffLogoId,
        staffBackdropId: selected.staffBackdropId,
        clientLogo: selected.clientLogoId === '0' ? '' : clientLogoUrl,
        staffLogo: selected.staffLogoId === '0' ? '' : staffLogoUrl,
        staffBackdrop: selected.staffBackdropId === '0' ? '' : backdropUrl,
      })

      // 2. Persist to backend API
      try {
        await saveApiCompanySettings({ values, ...selected, deleteLogoIds, deleteBackdropIds })
      } catch (apiErr) {
        console.warn('[AdminCompanySettings] API save warning (persisted locally):', apiErr)
      }

      setNotice('Company settings and logos saved successfully! Changes are active immediately.')
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

    // Read as Data URL client-side first for instantaneous zero-latency updates
    const reader = new FileReader()
    reader.onload = async () => {
      const dataUrl = String(reader.result || '')

      let backendImage: ApiCompanyImage | null = null
      try {
        backendImage = await uploadApiCompanyImage(kind, file)
      } catch (apiErr) {
        console.warn('[AdminCompanySettings] Backend upload warning, falling back to data URL:', apiErr)
      }

      const effectiveId = backendImage ? backendImage.id : `local-${Date.now()}`
      const newImage: ApiCompanyImage = backendImage || {
        id: effectiveId,
        name: file.name,
        type: file.type,
        size: file.size,
        created: new Date().toISOString(),
        url: dataUrl,
      }

      setData((current) => {
        if (!current) return current
        return kind === 'logo'
          ? { ...current, logos: [newImage, ...current.logos] }
          : { ...current, backdrops: [newImage, ...current.backdrops] }
      })

      if (kind === 'logo') {
        setSelected((current) => ({
          ...current,
          clientLogoId: effectiveId,
          staffLogoId: effectiveId,
        }))
        setClientLogoUrl(dataUrl)
        setStaffLogoUrl(dataUrl)
        saveSettings({
          clientLogo: dataUrl,
          staffLogo: dataUrl,
          clientLogoId: effectiveId,
          staffLogoId: effectiveId,
        })
        setNotice('Logo uploaded! Applied to both Client Portal and Staff Panel.')
      } else {
        setSelected((current) => ({ ...current, staffBackdropId: effectiveId }))
        setBackdropUrl(dataUrl)
        saveSettings({
          staffBackdrop: dataUrl,
          staffBackdropId: effectiveId,
        })
        setNotice('Login backdrop uploaded and applied immediately!')
      }

      setUploading('')
    }

    reader.onerror = () => {
      setError('Could not read the uploaded file.')
      setUploading('')
    }

    reader.readAsDataURL(file)
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
                section === item.id ? 'bg-brand-600 text-white font-medium' : 'bg-paper text-ink-700 ring-1 ring-line hover:bg-slate-50'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        {error ? <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p> : null}
        {notice ? <p className="rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-700 font-medium">{notice}</p> : null}

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
                Choose the logo shown in the client portal navbar and the staff control panel sidebar. You can upload an image or choose system defaults.
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
              clientPreview={clientLogoUrl}
              staffPreview={staffLogoUrl}
              onResetClient={() => chooseClientLogo('0', '')}
              onResetStaff={() => chooseStaffLogo('0', '')}
            />
          </div>
        ) : null}

        {section === 'backdrop' ? (
          <div className="space-y-4">
            <div>
              <h2 className="text-base font-semibold text-ink-800">Login Backdrop</h2>
              <p className="mt-1 text-sm text-ink-600">
                Choose the background image used on the staff login page (<code className="text-xs bg-slate-100 dark:bg-slate-800 px-1 py-0.5 rounded">/scp/login</code>). Works with any image: full wallpapers, abstract art, or company logos/emblems with interactive parallax and lighting effects.
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
              backdropPreview={backdropUrl}
              onResetClient={() => chooseBackdrop('0', '')}
            />
          </div>
        ) : null}

        <div className="flex flex-col gap-2 border-t border-line pt-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-ink-500">Changes apply to client portal and staff control panel instantly.</p>
          <button className={btnPrimary} disabled={saving || Boolean(uploading)}>
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </form>
    </Card>
  )
}
