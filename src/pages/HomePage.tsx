import { NavLink } from "react-router-dom";
import { useDb } from "../hooks/useDb";

export function HomePage() {
  const { faqs, pages, settings } = useDb();
  const featured = faqs.filter((f) => f.published !== false).slice(0, 3);
  const landing = pages.find((p) => p.type === "landing" && p.active);
  const offline = pages.find((p) => p.type === "offline" && p.active);

  if (offline) {
    return (
      <div className="rounded-3xl border border-line bg-surface p-6 sm:p-10">
        <h1 className="text-2xl font-semibold">{settings.helpdeskName} is offline</h1>
        <p className="mt-3 text-ink-600">{offline.body}</p>
      </div>
    );
  }

  return (
    <div className="space-y-10 text-slate-700">
      <section className="overflow-hidden rounded-3xl bg-gradient-to-br from-brand-700 via-brand-600 to-sky-500 p-6 text-white shadow-lg sm:p-10">
        <p className="text-sm font-medium text-blue-100">
          Support ticket system
        </p>
        <h1 className="mt-2 max-w-xl text-3xl font-semibold tracking-tight sm:text-4xl">
          How can we help you today?
        </h1>
        <p className="mt-3 max-w-lg text-blue-50">
          {landing?.body ??
            "Open a ticket, look up an existing case, or browse the knowledge base — rebuilt as a responsive React app from osTicket."}
        </p>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <NavLink
            to="/open"
            className="rounded-xl bg-white px-5 py-3 text-center font-semibold text-brand-700"
          >
            Open a new ticket
          </NavLink>
          <NavLink
            to="/status"
            className="rounded-xl bg-white/15 px-5 py-3 text-center font-semibold text-white ring-1 ring-white/30"
          >
            Check ticket status
          </NavLink>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[
          {
            to: "/open",
            title: "Open a ticket",
            body: "Tell us the help topic, subject, and details. Guests welcome.",
          },
          {
            to: "/status",
            title: "Check status",
            body: "Use your email and ticket number — no account required.",
          },
          {
            to: "/kb",
            title: "Knowledge base",
            body: "Search FAQs before you write in. Faster answers, fewer tickets.",
          },
        ].map((card) => (
          <NavLink
            key={card.to}
            to={card.to}
            className="rounded-2xl border border-line bg-surface p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
          >
            <h2 className="font-semibold">{card.title}</h2>
            <p className="mt-2 text-sm text-ink-600">{card.body}</p>
          </NavLink>
        ))}
      </section>

      <section>
        <div className="mb-4 flex items-end justify-between gap-3">
          <h2 className="text-xl font-semibold">Popular articles</h2>
          <NavLink to="/kb" className="text-sm font-medium text-brand-600">
            View all
          </NavLink>
        </div>
        <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
          {featured.map((faq) => (
            <li key={faq.id}>
              <NavLink
                to={`/kb/${faq.id}`}
                className="block px-5 py-4 hover:bg-paper"
              >
                <p className="font-medium">{faq.question}</p>
                <p className="mt-1 line-clamp-2 text-sm text-ink-600">
                  {faq.answer}
                </p>
              </NavLink>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
