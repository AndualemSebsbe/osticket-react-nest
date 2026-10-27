import { FormEvent, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { listApiBranches } from '../lib/api'

import { inputClass } from "../components/ui"
export function RegisterPage() {
  const { register } = useAuth()
  const [error, setError] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [branches, setBranches] = useState<Array<{ id: string; name: string }>>([])

  useEffect(() => {
    let active = true
    void listApiBranches().then(({ branches: items }) => {
      if (active) setBranches(items)
    }).catch((err: unknown) => {
      if (active) setError(err instanceof Error ? err.message : 'Could not load branches.')
    })
    return () => { active = false }
  }, [])

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    const password = String(form.get('password'))
    if (password !== String(form.get('confirm'))) {
      setError('Passwords do not match.')
      return
    }
    try {
      await register({
        name: String(form.get('name')),
        email: String(form.get('email')),
        password,
        phone: String(form.get('phone') || ''),
        employeeId: String(form.get('employeeId') || ''),
        branchId: String(form.get('branchId') || ''),
      })
      setSubmitted(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not register.')
    }
  }

  return (
    <div className="mx-auto max-w-md">
      <h1 className="text-2xl font-semibold">Create an account</h1>
      {submitted ? (
        <div className="mt-6 space-y-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-sm text-emerald-900">
          <h2 className="font-semibold">Account submitted for review</h2>
          <p>An administrator must verify your account before you can sign in. You can return to sign in after approval.</p>
          <Link to="/login" className="inline-flex font-semibold text-brand-700">Go to sign in</Link>
        </div>
      ) : (
      <form onSubmit={onSubmit} className="mt-6 space-y-4 rounded-2xl border-4 border-slate-300 dark:border-slate-600 p-5 shadow-sm">
        {error ? <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</p> : null}
        <label className="block text-sm font-medium">
          Full name
          <input required name="name" className={inputClass + " mt-1"} />
        </label>
        <label className="block text-sm font-medium">
          Email
          <input required type="email" name="email" className={inputClass + " mt-1"} />
        </label>
        <label className="block text-sm font-medium">
          Phone
          <input name="phone" className={inputClass + " mt-1"} />
        </label>
        <label className="block text-sm font-medium">
          Employee ID
          <input name="employeeId" maxLength={64} className={inputClass + " mt-1"} />
        </label>
        <label className="block text-sm font-medium">
          Branch
          <select name="branchId" defaultValue="" className={inputClass + " mt-1"}>
            <option value="">— Select a branch —</option>
            {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
          </select>
        </label>
        <label className="block text-sm font-medium">
          Password
          <input required minLength={6} name="password" type="password" className={inputClass + " mt-1"} />
        </label>
        <label className="block text-sm font-medium">
          Confirm password
          <input required name="confirm" type="password" className={inputClass + " mt-1"} />
        </label>
        <button type="submit" className="w-full rounded-xl bg-brand-600 py-2.5 font-semibold text-white">
          Register
        </button>
        <p className="text-center text-sm">
          Already have an account? <Link to="/login" className="font-medium text-brand-600">Sign in</Link>
        </p>
      </form>
      )}
    </div>
  )
}
