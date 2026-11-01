import { FormEvent, useEffect, useMemo, useState } from 'react'
import { btnGhost, btnPrimary, Card, Field, inputClass } from '../../components/ui'
import {
  getApiSystemSettings,
  purgeApiExpiredLocks,
  purgeApiSystemLogs,
  saveApiSystemSettings,
  type ApiSystemSettingsResponse,
  type ApiSystemSettingsValues,
} from '../../lib/api'
import { formatDate } from '../../lib/format'
import { saveSettings } from '../../lib/store'

type SystemSection = 'general' | 'datetime' | 'languages' | 'attachments' | 'maintenance'

const sections: Array<{ id: SystemSection; label: string }> = [
  { id: 'general', label: 'General' },
  { id: 'datetime', label: 'Date & Time' },
  { id: 'languages', label: 'Languages' },
  { id: 'attachments', label: 'Attachments' },
  { id: 'maintenance', label: 'Maintenance' },
]

function fileSize(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB'
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}

function when(value: string | null) {
  return value ? formatDate(value) : '—'
}

function messageOf(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback
}

export function AdminSystemSettings() {
  const [data, setData] = useState<ApiSystemSettingsResponse | null>(null)
  const [values, setValues] = useState<ApiSystemSettingsValues | null>(null)
  const [section, setSection] = useState<SystemSection>('general')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  async function load(showSpinner = true) {
    if (showSpinner) setLoading(true)
    try {
      const result = await getApiSystemSettings()
      setData(result)
      setValues(result.values)
      setError('')
    } catch (err) {
      setError(messageOf(err, 'Could not load system settings.'))
    } finally {
      if (showSpinner) setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const languages = useMemo(
    () => (data?.options.languages || []).filter((language) => language.value !== values?.systemLanguage),
    [data, values?.systemLanguage],
  )

  function setValue<K extends keyof ApiSystemSettingsValues>(key: K, value: ApiSystemSettingsValues[K]) {
    setValues((current) => (current ? { ...current, [key]: value } : current))
    setNotice('')
  }

  function toggleLanguage(code: string) {
    if (!values) return
    const selected = values.secondaryLanguages.includes(code)
    setValue(
      'secondaryLanguages',
      selected ? values.secondaryLanguages.filter((item) => item !== code) : [...values.secondaryLanguages, code],
    )
  }

  async function onSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!values) return
    setSaving(true)
    setError('')
    setNotice('')
    try {
      const result = await saveApiSystemSettings(values)
      setData(result)
      setValues(result.values)
      saveSettings({
        helpdeskName: result.values.helpdeskTitle,
        defaultDeptId: result.values.defaultDeptId,
        timezone: result.values.defaultTimezone,
        language: result.values.systemLanguage,
        autolock: result.values.autolockMinutes > 0,
      })
      setNotice('System settings saved.')
    } catch (err) {
      setError(messageOf(err, 'Could not save system settings.'))
    } finally {
      setSaving(false)
    }
  }

  async function runPurge(kind: 'logs' | 'locks') {
    if (kind === 'logs') {
      if (!window.confirm('Delete system log entries older than the configured purge period? This cannot be undone.')) return
    } else if (!window.confirm('Delete all expired ticket and task locks? This cannot be undone.')) {
      return
    }
    setBusy(kind)
    setError('')
    setNotice('')
    try {
      const result = kind === 'logs' ? await purgeApiSystemLogs() : await purgeApiExpiredLocks()
      setNotice(kind === 'logs' ? `${result.deleted} log entr${result.deleted === 1 ? 'y' : 'ies'} purged.` : `${result.deleted} expired lock${result.deleted === 1 ? '' : 's'} removed.`)
      await load(false)
    } catch (err) {
      setError(messageOf(err, kind === 'logs' ? 'Could not purge system logs.' : 'Could not purge expired locks.'))
    } finally {
      setBusy('')
    }
  }

  if (loading) {
    return (
      <Card>
        <p className="py-10 text-center text-sm text-ink-600">Loading system settings...</p>
      </Card>
    )
  }

  if (!data || !values) {
    return (
      <Card>
        <div className="space-y-3 py-6 text-center">
          <p className="text-sm text-rose-600">{error || 'System settings could not be loaded.'}</p>
          <button type="button" className={btnGhost} onClick={() => void load()}>Try again</button>
        </div>
      </Card>
    )
  }

  const publicDepartments = data.departments.filter((department) => department.isPublic)
  const departmentOptions = publicDepartments.length ? publicDepartments : data.departments

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

        {error ? <p role="alert" className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</p> : null}
        {notice ? <p className="rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{notice}</p> : null}

        {section === 'general' ? (
          <div className="space-y-6">
            <div>
              <h2 className="text-base font-semibold text-ink-800">General Settings</h2>
              <p className="mt-1 text-sm text-ink-600">Helpdesk identity, access, logging, and embed security.</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Helpdesk Status" className="sm:col-span-2">
                <div className="flex flex-wrap gap-5 rounded-xl border border-line bg-paper px-3 py-2.5">
                  <label className="flex items-center gap-2 text-sm font-normal">
                    <input type="radio" name="helpdesk-status" checked={values.isOnline} onChange={() => setValue('isOnline', true)} />
                    Online
                  </label>
                  <label className="flex items-center gap-2 text-sm font-normal">
                    <input type="radio" name="helpdesk-status" checked={!values.isOnline} onChange={() => setValue('isOnline', false)} />
                    Offline
                  </label>
                </div>
                <span className="mt-1 block text-xs font-normal text-ink-500">
                  Offline disables the client portal. Agents can still use the staff panel.
                </span>
              </Field>
              <Field label="Helpdesk URL">
                <input
                  type="url"
                  required
                  value={values.helpdeskUrl}
                  onChange={(event) => setValue('helpdeskUrl', event.target.value)}
                  className={inputClass}
                />
                <span className="mt-1 block text-xs font-normal text-ink-500">Base URL used in email links.</span>
              </Field>
              <Field label="Helpdesk Name/Title">
                <input
                  required
                  maxLength={255}
                  value={values.helpdeskTitle}
                  onChange={(event) => setValue('helpdeskTitle', event.target.value)}
                  className={inputClass}
                />
              </Field>
              <Field label="Default Department">
                <select
                  required
                  value={values.defaultDeptId}
                  onChange={(event) => setValue('defaultDeptId', event.target.value)}
                  className={inputClass}
                >
                  <option value="">— Select Default Department —</option>
                  {departmentOptions.map((department) => (
                    <option key={department.id} value={department.id}>
                      {department.name}
                      {department.isPublic ? '' : ' (private)'}
                    </option>
                  ))}
                </select>
                <span className="mt-1 block text-xs font-normal text-ink-500">
                  Used when a ticket is not routed by a help topic, mailbox, or filter.
                </span>
              </Field>
              <Field label="Force HTTPS">
                <label className="flex items-center gap-2 rounded-xl border border-line bg-paper px-3 py-2.5 text-sm font-normal">
                  <input type="checkbox" checked={values.forceHttps} onChange={(event) => setValue('forceHttps', event.target.checked)} />
                  Redirect all requests through HTTPS.
                </label>
              </Field>
              <Field label="Collision Avoidance Duration">
                <input
                  type="number"
                  min="0"
                  max="1440"
                  step="1"
                  value={values.autolockMinutes}
                  onChange={(event) => setValue('autolockMinutes', Number(event.target.value))}
                  className={inputClass}
                />
                <span className="mt-1 block text-xs font-normal text-ink-500">
                  Minutes an agent may hold a ticket or task lock without activity. Enter 0 to disable.
                </span>
              </Field>
              <Field label="Default Page Size">
                <select
                  value={values.maxPageSize}
                  onChange={(event) => setValue('maxPageSize', Number(event.target.value))}
                  className={inputClass}
                >
                  {data.options.pageSizes.map((size) => <option key={size} value={size}>{size}</option>)}
                </select>
              </Field>
              <Field label="Default Log Level">
                <select
                  value={values.logLevel}
                  onChange={(event) => setValue('logLevel', event.target.value as ApiSystemSettingsValues['logLevel'])}
                  className={inputClass}
                >
                  {data.options.logLevels.map((level) => <option key={level.value} value={level.value}>{level.label}</option>)}
                </select>
              </Field>
              <Field label="Purge Logs">
                <select
                  value={values.logGracePeriod}
                  onChange={(event) => setValue('logGracePeriod', Number(event.target.value))}
                  className={inputClass}
                >
                  {data.options.logGracePeriods.map((period) => (
                    <option key={period.value} value={period.value}>{period.label}</option>
                  ))}
                </select>
              </Field>
              <Field label="Show Avatars">
                <label className="flex items-center gap-2 rounded-xl border border-line bg-paper px-3 py-2.5 text-sm font-normal">
                  <input type="checkbox" checked={values.showAvatars} onChange={(event) => setValue('showAvatars', event.target.checked)} />
                  Show avatars on thread correspondence.
                </label>
              </Field>
              <Field label="Enable HTML/Rich Text">
                <label className="flex items-center gap-2 rounded-xl border border-line bg-paper px-3 py-2.5 text-sm font-normal">
                  <input type="checkbox" checked={values.enableRichText} onChange={(event) => setValue('enableRichText', event.target.checked)} />
                  Allow rich text in thread entries and email correspondence.
                </label>
              </Field>
              <Field label="Allow System iFrame" className="sm:col-span-2">
                <input
                  value={values.allowIframes}
                  onChange={(event) => setValue('allowIframes', event.target.value)}
                  placeholder="https://domain.tld, *.domain.tld"
                  className={inputClass}
                />
                <span className="mt-1 block text-xs font-normal text-ink-500">
                  Comma separated host sources allowed to embed the helpdesk. Leave blank to block framing.
                </span>
              </Field>
              <Field label="Embedded Domain Whitelist" className="sm:col-span-2">
                <input
                  value={values.embeddedDomainWhitelist}
                  onChange={(event) => setValue('embeddedDomainWhitelist', event.target.value)}
                  placeholder="domain.tld, sub.domain.tld"
                  className={inputClass}
                />
                <span className="mt-1 block text-xs font-normal text-ink-500">
                  Domains allowed in iFrames inside content. Do not include http(s) or www.
                </span>
              </Field>
              <Field label="ACL" className="sm:col-span-2">
                <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_12rem]">
                  <input
                    value={values.acl}
                    onChange={(event) => setValue('acl', event.target.value)}
                    placeholder="192.168.1.1, 192.168.2.0/24"
                    className={inputClass}
                  />
                  <select
                    aria-label="ACL scope"
                    value={values.aclBackend}
                    onChange={(event) => setValue('aclBackend', event.target.value)}
                    className={inputClass}
                  >
                    {data.options.aclBackends.map((backend) => (
                      <option key={backend.value} value={backend.value}>{backend.label}</option>
                    ))}
                  </select>
                </div>
                <span className="mt-1 block text-xs font-normal text-ink-500">
                  Comma separated IP addresses or CIDR ranges. Choose where the allow-list is enforced.
                </span>
              </Field>
            </div>
          </div>
        ) : null}

        {section === 'datetime' ? (
          <div className="space-y-6">
            <div>
              <h2 className="text-base font-semibold text-ink-800">Date &amp; Time Settings</h2>
              <p className="mt-1 text-sm text-ink-600">Locale, timezone, and display formats used across the helpdesk.</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Default Locale">
                <select value={values.defaultLocale} onChange={(event) => setValue('defaultLocale', event.target.value)} className={inputClass}>
                  <option value="">Use Language Preference</option>
                  {data.options.languages.map((language) => (
                    <option key={language.value} value={language.value}>{language.label}</option>
                  ))}
                </select>
              </Field>
              <Field label="Default Time Zone">
                <select value={values.defaultTimezone} onChange={(event) => setValue('defaultTimezone', event.target.value)} className={inputClass}>
                  {data.options.timezones.map((timezone) => <option key={timezone} value={timezone}>{timezone}</option>)}
                </select>
              </Field>
              <Field label="Date and Time Format">
                <select
                  value={values.dateFormats}
                  onChange={(event) => setValue('dateFormats', event.target.value as ApiSystemSettingsValues['dateFormats'])}
                  className={inputClass}
                >
                  <option value="">Locale Defaults</option>
                  <option value="24">Locale Defaults, 24-hour Time</option>
                  <option value="custom">— Advanced —</option>
                </select>
              </Field>
              <Field label="Default Schedule">
                <select value={values.scheduleId} onChange={(event) => setValue('scheduleId', event.target.value)} className={inputClass}>
                  <option value="0">— None —</option>
                  {data.schedules.map((schedule) => (
                    <option key={schedule.id} value={schedule.id}>
                      {schedule.name}{schedule.timezone ? ` (${schedule.timezone})` : ''}
                    </option>
                  ))}
                </select>
                <span className="mt-1 block text-xs font-normal text-ink-500">
                  Business hours schedule used when an SLA does not specify one.
                </span>
              </Field>
              {values.dateFormats === 'custom' ? (
                <>
                  <Field label="Time Format">
                    <input
                      required
                      value={values.timeFormat}
                      onChange={(event) => setValue('timeFormat', event.target.value)}
                      placeholder="hh:mm a"
                      className={inputClass}
                    />
                    <span className="mt-1 block text-xs font-normal text-ink-500">ICU pattern example: hh:mm a</span>
                  </Field>
                  <Field label="Date Format">
                    <input
                      required
                      value={values.dateFormat}
                      onChange={(event) => setValue('dateFormat', event.target.value)}
                      placeholder="MM/dd/y"
                      className={inputClass}
                    />
                  </Field>
                  <Field label="Date and Time Format">
                    <input
                      required
                      value={values.datetimeFormat}
                      onChange={(event) => setValue('datetimeFormat', event.target.value)}
                      placeholder="MM/dd/y h:mm a"
                      className={inputClass}
                    />
                  </Field>
                  <Field label="Day, Date and Time Format">
                    <input
                      required
                      value={values.daydatetimeFormat}
                      onChange={(event) => setValue('daydatetimeFormat', event.target.value)}
                      placeholder="EEE, MMM d y h:mm a"
                      className={inputClass}
                    />
                  </Field>
                </>
              ) : (
                <p className="rounded-xl bg-paper px-3 py-2.5 text-sm text-ink-600 sm:col-span-2">
                  Formats follow the selected locale. Choose Advanced to enter custom ICU patterns.
                </p>
              )}
            </div>
          </div>
        ) : null}

        {section === 'languages' ? (
          <div className="space-y-6">
            <div>
              <h2 className="text-base font-semibold text-ink-800">System Languages</h2>
              <p className="mt-1 text-sm text-ink-600">Choose the primary language and optional secondary languages.</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Primary Language">
                <select
                  value={values.systemLanguage}
                  onChange={(event) => setValue('systemLanguage', event.target.value)}
                  className={inputClass}
                >
                  {data.options.languages.map((language) => (
                    <option key={language.value} value={language.value}>{language.label}</option>
                  ))}
                </select>
                <span className="mt-1 block text-xs font-normal text-ink-500">
                  Used when an agent or user language preference is unavailable.
                </span>
              </Field>
              <Field label="Secondary Languages">
                <p className="rounded-xl border border-line bg-paper px-3 py-2.5 text-sm font-normal text-ink-600">
                  {values.secondaryLanguages.length
                    ? values.secondaryLanguages.map((code) => data.options.languages.find((item) => item.value === code)?.label || code).join(', ')
                    : 'No secondary languages selected.'}
                </p>
              </Field>
              <div className="sm:col-span-2">
                <p className="mb-2 text-sm font-medium text-ink-800">Available languages</p>
                <div className="grid max-h-72 gap-1 overflow-y-auto rounded-xl border border-line bg-paper p-3 sm:grid-cols-2 lg:grid-cols-3">
                  {languages.map((language) => (
                    <label key={language.value} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm font-normal hover:bg-surface">
                      <input
                        type="checkbox"
                        checked={values.secondaryLanguages.includes(language.value)}
                        onChange={() => toggleLanguage(language.value)}
                      />
                      <span className="min-w-0 truncate">{language.label}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {section === 'attachments' ? (
          <div className="space-y-6">
            <div>
              <h2 className="text-base font-semibold text-ink-800">Attachments Storage and Settings</h2>
              <p className="mt-1 text-sm text-ink-600">Control where files are stored, their maximum size, and who may download them.</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Store Attachments">
                <select
                  value={values.defaultStorageBk}
                  onChange={(event) => setValue('defaultStorageBk', event.target.value)}
                  className={inputClass}
                >
                  {data.options.storageBackends.map((backend) => (
                    <option key={backend.value} value={backend.value}>{backend.label}</option>
                  ))}
                </select>
              </Field>
              <Field label="Agent Maximum File Size">
                <select
                  value={values.maxFileSize}
                  onChange={(event) => setValue('maxFileSize', Number(event.target.value))}
                  className={inputClass}
                >
                  {data.options.maxFileSizes.map((size) => (
                    <option key={size.value} value={size.value}>{size.label}</option>
                  ))}
                </select>
                <span className="mt-1 block text-xs font-normal text-ink-500">
                  Applies to canned responses, knowledgebase articles, and ticket or task attachments.
                </span>
              </Field>
              <Field label="Login Required" className="sm:col-span-2">
                <label className="flex items-center gap-2 rounded-xl border border-line bg-paper px-3 py-2.5 text-sm font-normal">
                  <input
                    type="checkbox"
                    checked={values.filesRequireAuth}
                    onChange={(event) => setValue('filesRequireAuth', event.target.checked)}
                  />
                  Require users and agents to sign in before viewing attachments.
                </label>
              </Field>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {[
                { label: 'Files', value: String(data.stats.attachments.files) },
                { label: 'Attachment links', value: String(data.stats.attachments.links) },
                { label: 'Stored chunks', value: String(data.stats.attachments.chunks) },
                { label: 'Total size', value: fileSize(data.stats.attachments.bytes) },
              ].map((stat) => (
                <div key={stat.label} className="rounded-xl border border-line bg-paper p-3">
                  <p className="text-xs uppercase tracking-wide text-ink-400">{stat.label}</p>
                  <p className="mt-1 text-lg font-semibold text-ink-800">{stat.value}</p>
                </div>
              ))}
            </div>
            <p className="text-xs text-ink-500">
              Attachment metadata is stored.
            </p>
          </div>
        ) : null}

        {section === 'maintenance' ? (
          <div className="space-y-6">
            <div>
              <h2 className="text-base font-semibold text-ink-800">Runtime &amp; Maintenance</h2>
              <p className="mt-1 text-sm text-ink-600">Inspect and clean operational records used by the helpdesk.</p>
            </div>
            <div className="grid gap-4 lg:grid-cols-3">
              <div className="rounded-2xl border border-line bg-paper p-4">
                <h3 className="font-semibold text-ink-800">System logs</h3>
                <dl className="mt-3 space-y-1 text-sm text-ink-600">
                  <div className="flex justify-between gap-3"><dt>Total</dt><dd className="font-medium text-ink-800">{data.stats.logs.total}</dd></div>
                  <div className="flex justify-between gap-3"><dt>Debug</dt><dd>{data.stats.logs.debug}</dd></div>
                  <div className="flex justify-between gap-3"><dt>Warnings</dt><dd>{data.stats.logs.warning}</dd></div>
                  <div className="flex justify-between gap-3"><dt>Errors</dt><dd>{data.stats.logs.error}</dd></div>
                  <div className="flex justify-between gap-3"><dt>Newest</dt><dd className="text-right">{when(data.stats.logs.newest)}</dd></div>
                  <div className="flex justify-between gap-3"><dt>Oldest</dt><dd className="text-right">{when(data.stats.logs.oldest)}</dd></div>
                </dl>
                <button
                  type="button"
                  className={`${btnGhost} mt-4 w-full`}
                  disabled={Boolean(busy) || values.logGracePeriod === 0 || data.stats.logs.total === 0}
                  onClick={() => void runPurge('logs')}
                >
                  {busy === 'logs' ? 'Purging…' : values.logGracePeriod === 0 ? 'Purge disabled' : 'Purge old logs'}
                </button>
                <p className="mt-2 text-xs text-ink-500">
                  {values.logGracePeriod === 0 ? 'Set a purge period in General to enable this action.' : `Removes entries older than ${values.logGracePeriod} month${values.logGracePeriod === 1 ? '' : 's'}.`}
                </p>
              </div>
              <div className="rounded-2xl border border-line bg-paper p-4">
                <h3 className="font-semibold text-ink-800">Collision locks</h3>
                <dl className="mt-3 space-y-1 text-sm text-ink-600">
                  <div className="flex justify-between gap-3"><dt>Total locks</dt><dd className="font-medium text-ink-800">{data.stats.locks.total}</dd></div>
                  <div className="flex justify-between gap-3"><dt>Active</dt><dd>{data.stats.locks.active}</dd></div>
                  <div className="flex justify-between gap-3"><dt>Expired</dt><dd>{data.stats.locks.expired}</dd></div>
                  <div className="flex justify-between gap-3"><dt>Lock duration</dt><dd>{values.autolockMinutes ? `${values.autolockMinutes} min` : 'Disabled'}</dd></div>
                </dl>
                <button
                  type="button"
                  className={`${btnGhost} mt-4 w-full`}
                  disabled={Boolean(busy) || data.stats.locks.expired === 0}
                  onClick={() => void runPurge('locks')}
                >
                  {busy === 'locks' ? 'Removing…' : 'Remove expired locks'}
                </button>
                <p className="mt-2 text-xs text-ink-500">Locks expire after the collision avoidance duration without activity.</p>
              </div>
              <div className="rounded-2xl border border-line bg-paper p-4">
                <h3 className="font-semibold text-ink-800">Attachment storage</h3>
                <dl className="mt-3 space-y-1 text-sm text-ink-600">
                  <div className="flex justify-between gap-3"><dt>Files</dt><dd className="font-medium text-ink-800">{data.stats.attachments.files}</dd></div>
                  <div className="flex justify-between gap-3"><dt>Links</dt><dd>{data.stats.attachments.links}</dd></div>
                  <div className="flex justify-between gap-3"><dt>Chunks</dt><dd>{data.stats.attachments.chunks}</dd></div>
                  <div className="flex justify-between gap-3"><dt>Total size</dt><dd>{fileSize(data.stats.attachments.bytes)}</dd></div>
                </dl>
                <p className="mt-4 text-xs text-ink-500">
                  Files are kept while attachments reference them. Delete attachments from their tickets, tasks, or articles instead of directly from storage.
                </p>
              </div>
            </div>
          </div>
        ) : null}

        <div className="flex flex-col gap-2 border-t border-line pt-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-ink-500">Values are stored in the core namespace.</p>
          <button className={btnPrimary} disabled={saving || Boolean(busy)}>
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </form>
    </Card>
  )
}
