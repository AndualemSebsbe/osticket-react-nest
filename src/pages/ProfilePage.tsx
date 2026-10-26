import { FormEvent, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { updateApiAccountPassword, updateApiProfile } from '../lib/api'
import { clientSessionToken, updateProfile } from '../lib/store'
import { EmptyState } from '../components/TicketThread'

import { inputClass } from "../components/ui"
export function ProfilePage() {
  const { user } = useAuth()
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  if (!user || user.role !== 'client') {
    return <EmptyState title="Sign in first" body="Profiles are available for registered clients." to="/login" cta="Sign in" />
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    const password = String(form.get('password'))
    if (password && !clientSessionToken()) {
      setError('Your session expired. Sign in again before changing your password.')
      return
    }
    const apiSession = clientSessionToken()
    if (!apiSession) {
      setError('Your session expired. Sign in again before saving your profile.')
      return
    }
    try {
      await updateApiProfile(apiSession, { name: String(form.get('name')), phone: String(form.get('phone')), org: String(form.get('org')) })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save profile.')
      return
    }
    if (password) {
      try { await updateApiAccountPassword(apiSession, password) }
      catch (err) { setError(err instanceof Error ? err.message : 'Could not update password.'); return }
    }
    updateProfile(user!.id, {
      name: String(form.get('name')),
      phone: String(form.get('phone')),
      org: String(form.get('org')),
    })
    setError('')
    setSaved(true)
  }

  return (
    <div className="mx-auto max-w-lg">
      <h1 className="text-2xl font-semibold">Profile</h1>
      {error ? <p role="alert" className="mt-4 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</p> : null}
      <form onSubmit={onSubmit} className="mt-6 space-y-4 rounded-2xl border border-slate-200 bg-white p-5">
        <label className="block text-sm font-medium">
          Name
          <input name="name" defaultValue={user.name} className={inputClass + " mt-1"} />
        </label>
        <label className="block text-sm font-medium">
          Email
          <input disabled value={user.email} className={inputClass + " mt-1"} />
        </label>
        <label className="block text-sm font-medium">
          Phone
          <input name="phone" defaultValue={user.phone} className={inputClass + " mt-1"} />
        </label>
        <label className="block text-sm font-medium">
          Organization
          <input name="org" defaultValue={user.org} className={inputClass + " mt-1"} />
        </label>
        <label className="block text-sm font-medium">
          New password
          <input name="password" type="password" minLength={8} placeholder="Leave blank to keep current password" className={inputClass + " mt-1"} />
        </label>
        <button type="submit" className="rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white">
          Save
        </button>
        {saved ? <p className="text-sm text-emerald-700">Profile saved.</p> : null}
      </form>
    </div>
  )
}
