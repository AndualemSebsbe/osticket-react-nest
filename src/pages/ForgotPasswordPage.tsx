import { FormEvent, useState } from 'react'
import { Link } from 'react-router-dom'
import { btnPrimary, Card, Field, inputClass, PageHeader } from '../components/ui'
import { completePasswordReset, requestPasswordReset } from '../lib/api'

export function ForgotPasswordPage({ staff = false }: { staff?: boolean }) {
  const [error, setError] = useState('')
  const [done, setDone] = useState('')
  const [requested, setRequested] = useState(false)

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    setError('')
    setDone('')
    try {
      if (!requested) {
        await requestPasswordReset(String(form.get('email')))
        setRequested(true)
        setDone('If an account exists for that email, a reset code has been sent.')
      } else {
        await completePasswordReset(String(form.get('token')), String(form.get('password')))
        setDone('Password updated. You can sign in with the new password.')
      }
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not reset password.') }
  }

  return (
    <div className={staff ? 'grid min-h-dvh place-items-center bg-ink-950 px-4' : 'mx-auto max-w-md'}>
      <div className={staff ? 'w-full max-w-md rounded-3xl bg-surface p-6 shadow-xl sm:p-8' : ''}>
        <PageHeader
          title={staff ? 'Reset agent password' : 'Forgot password'}
          subtitle="We will email a one-time reset code to your account address."
        />
        <Card className={staff ? 'border-0 p-0 shadow-none' : ''}>
          {error ? <p className="mb-3 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</p> : null}
          {done ? <p className="mb-3 rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{done}</p> : null}
          <form onSubmit={onSubmit} className="grid gap-4">
            {!requested ? <Field label="Email"><input name="email" type="email" required className={inputClass} /></Field> : <>
              <Field label="Email reset code"><input name="token" required autoComplete="one-time-code" className={inputClass} /></Field>
              <Field label="New password"><input name="password" type="password" required minLength={8} autoComplete="new-password" className={inputClass} /></Field>
            </>}
            <button className={btnPrimary}>{requested ? 'Set new password' : 'Send reset code'}</button>
          </form>
          <p className="mt-4 text-sm text-ink-600">
            <Link to={staff ? '/scp/login' : '/login'} className="text-brand-600">
              Back to sign in
            </Link>
          </p>
        </Card>
      </div>
    </div>
  )
}
