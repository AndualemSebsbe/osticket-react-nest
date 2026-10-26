import { FormEvent, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

import { inputClass } from "../components/ui"
export function LoginPage() {
  const { loginClient } = useAuth()
  const navigate = useNavigate()
  const [error, setError] = useState('')


  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    const email = String(form.get('email'))
    const password = String(form.get('password'))
    setError('')
    const result = await loginClient(email, password)
    if (!result.user) { setError(result.error || 'Sign-in failed. Check your email and password.'); return }
    navigate('/tickets')
  }

  return (
    <div className="mx-auto grid max-w-3xl gap-8 lg:grid-cols-2">
      <div>
        <h1 className="text-2xl font-semibold dark:text-500">Sign in</h1>
        <p className="mt-2 text-sm text-ink-600">
          Register for an account to track every ticket in one place. Guests can still open a ticket or check status.
        </p>
        <p className="mt-4 text-sm dark:text-500">
          I am an agent — <Link to="/scp/login" className="font-medium text-brand-600">sign in here</Link>
        </p>
      </div>
      <form onSubmit={onSubmit} className="space-y-4 rounded-2xl border-4 p-5 shadow-sm">
        {error ? <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</p> : null}
        <label className="block text-sm font-medium dark:text-slate-400">
          Email or username
          <input required name="email" type="email" defaultValue="" className={inputClass + " mt-1"} />
        </label>
        <label className="block text-sm font-medium dark:text-slate-400">
          Password
          <input required name="password" type="password" defaultValue="" className={inputClass + " mt-1"} />
        </label>
        <button type="submit" className="w-full rounded-xl bg-brand-600 py-2.5 font-semibold text-white">
          Sign in
        </button>
        <p className="mt-4 text-center text-sm text-ink-600">
          Not yet registered? <Link to="/register" className="font-medium text-brand-600">Create an account</Link>
        </p>
        <p className="text-center text-sm text-ink-600">
          <Link to="/forgot" className="text-brand-600">Forgot password?</Link>
        </p>
      </form>
    </div>
  )
}
