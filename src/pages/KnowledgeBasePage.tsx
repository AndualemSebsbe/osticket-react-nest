import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useDb } from '../hooks/useDb'
import { searchFaqs } from '../lib/store'

import { inputClass } from "../components/ui"
export function KnowledgeBasePage() {
  const db = useDb()
  const [q, setQ] = useState('')
  const results = useMemo(() => searchFaqs(q), [q, db.faqs])
  const categories = db.categories.filter((c) => c.published !== false)
  const faqs = db.faqs.filter((f) => (db.settings.kbPublishedOnly ? f.published !== false : true))

  if (!db.settings.kbEnabled) {
    return (
      <div>
        <h1 className="text-2xl font-semibold dark:text-slate-500">Knowledge base</h1>
        <p className="mt-2 text-sm text-ink-600">The knowledge base is disabled in admin settings.</p>
      </div>
    )
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold dark:text-slate-500">Knowledge base</h1>
      <p className="mt-1 text-sm text-ink-600">Click a category or search questions and answers.</p>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search FAQs"
        className={inputClass + " mt-4 max-w-lg"}
      />
      {q ? (
        <ul className="mt-6 space-y-3">
          {results.length === 0 ? <li className="text-sm text-ink-600">No articles matched.</li> : null}
          {results.map((faq) => (
            <li key={faq.id} className="rounded-2xl dark:text-slate-500 border dark:border-slate-600 border-slate-200 p-4">
              <Link to={`/kb/${faq.id}`} className="font-medium text-brand-700">
                {faq.question}
              </Link>
              <p className="mt-1 line-clamp-2 text-sm text-ink-600">{faq.answer}</p>
            </li>
          ))}
        </ul>
      ) : (
        <ul className="mt-6 grid gap-4 sm:grid-cols-2">
          {categories.map((c) => {
            const items = faqs.filter((f) => f.categoryId === c.id)
            const count = items.length
            return (
              <li key={c.id} className="rounded-2xl dark:text-slate-500 border dark:border-slate-600 border-slate-200 p-5">
                <h2 className="font-semibold">
                  {c.name} <span className="text-ink-400">({count})</span>
                </h2>
                <p className="mt-1 text-sm text-ink-600">{c.description}</p>
                <ul className="mt-3 space-y-1 text-sm">
                  {items.map((f) => (
                      <li key={f.id}>
                        <Link to={`/kb/${f.id}`} className="text-brand-600 hover:underline">
                          {f.question}
                        </Link>
                      </li>
                    ))}
                </ul>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
