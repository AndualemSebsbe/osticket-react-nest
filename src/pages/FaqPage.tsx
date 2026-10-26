import { Link, useParams } from 'react-router-dom'
import { EmptyState } from '../components/TicketThread'
import { getDb } from '../lib/store'

export function FaqPage() {
  const { id } = useParams()
  const db = getDb()
  const faq = db.faqs.find((f) => f.id === id)
  if (!faq) return <EmptyState title="Article not found" body="It may have been unpublished." to="/kb" cta="Back to knowledge base" />
  const category = db.categories.find((c) => c.id === faq.categoryId)

  return (
    <article className="mx-auto max-w-2xl">
      <Link to="/kb" className="text-sm text-brand-600">
        ← Knowledge base
      </Link>
      <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-ink-400">{category?.name}</p>
      <h1 className="mt-1 text-2xl font-semibold">{faq.question}</h1>
      <p className="mt-4 text-base leading-7 text-ink-800">{faq.answer}</p>
      <Link to="/open" className="mt-8 inline-flex rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white">
        Still need help? Open a ticket
      </Link>
    </article>
  )
}
