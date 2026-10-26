import { Link, useSearchParams } from 'react-router-dom'
import { useDb } from '../hooks/useDb'

export function ThanksPage() {
  const db = useDb()
  const [params] = useSearchParams()
  const number = params.get('number')
  const email = params.get('email')
  const page = db.pages.find((p) => p.type === 'thank-you' && p.active)

  return (
    <div className="mx-auto max-w-xl rounded-2xl border border-line bg-surface p-6 text-center sm:p-10">
      <h1 className="text-2xl font-semibold">Ticket created</h1>
      <p className="mt-3 text-ink-600">{page?.body ?? 'Your ticket has been created. We will reply by email.'}</p>
      {number ? (
        <p className="mt-4 rounded-xl bg-paper px-3 py-2 text-sm">
          Ticket <strong>#{number}</strong>
          {email ? (
            <>
              {' '}
              · look it up with <strong className="break-all">{email}</strong>
            </>
          ) : null}
        </p>
      ) : null}
      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
        <Link to={number && email ? `/status?email=${encodeURIComponent(email)}&number=${number}` : '/status'} className="rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white">
          Check status
        </Link>
        <Link to="/" className="rounded-xl border border-line px-4 py-2.5 text-sm">
          Home
        </Link>
      </div>
    </div>
  )
}
