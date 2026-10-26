import { FormEvent, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'

import { inputClass } from '../../components/ui'

function maskIdentifier(value: string) {
  const at = value.indexOf('@')
  if (at > 0) return value[0] + '***' + value.slice(at)
  return value.length > 2 ? value[0] + '***' + value.slice(-1) : '***'
}

export function StaffLoginPage() {
  const { login, user, ready } = useAuth()
  const navigate = useNavigate()
  const [error, setError] = useState('')

  useEffect(() => {
    if (!ready || !user || (user.role !== 'agent' && user.role !== 'admin')) return
    navigate(user.role === 'admin' ? '/scp/admin' : '/scp', { replace: true })
  }, [navigate, ready, user])

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    const identifier = String(form.get('email') || '').trim()
    const password = String(form.get('password') || '')
    console.info('[staff-login/ui] submit', { identifier: maskIdentifier(identifier), passwordProvided: Boolean(password) })
    try {
      const result = await login(identifier, password)
      if (!result.user) {
        const message = result.error || 'Staff sign-in failed.'
        console.error('[staff-login/ui] sign-in returned an error', message)
        setError(message)
        return
      }
      console.info('[staff-login/ui] sign-in complete', { userId: result.user.id, role: result.user.role })
      setError('')
      navigate(result.user.role === 'admin' ? '/scp/admin' : '/scp', { replace: true })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Staff sign-in failed.'
      console.error('[staff-login/ui] submit handler threw', error)
      setError(message)
    }
  }

  return (
    <div className="grid min-h-dvh place-items-center  px-4">
      <div className="w-full max-w-md rounded-3xl p-6 shadow-xl sm:p-8 border-4 dark:border-slate-600 border-slate-300">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brand-600">Staff control panel</p>
        <h1 className="mt-2 text-2xl font-semibold dark:text-slate-500">Agent sign in</h1>
        <form onSubmit={onSubmit} className="mt-6 space-y-4">
          {error ? <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</p> : null}
          <label className="block text-sm font-medium ">
            Email or username
            <input required name="email" type="text" autoComplete="username" className={inputClass} />
          </label>
          <label className="block text-sm font-medium">
            Password
            <input required name="password" type="password" autoComplete="current-password" className={inputClass + " mt-1"} />
          </label>
          <button type="submit" className="w-full rounded-xl bg-brand-600 py-2.5 font-semibold text-white">
            Sign in
          </button>
        </form>
        <p className="mt-4 text-center text-sm text-ink-600">
          Staff access is managed by your help desk administrator.
        </p>
        <p className="mt-2 text-center text-sm text-ink-600">
          <Link to="/scp/login/pwreset" className="text-brand-600">
            Forgot password?
          </Link>
          {' · '}
          <Link to="/" className="text-brand-600">
            Client portal
          </Link>
        </p>
      </div>
    </div>
  )
}
