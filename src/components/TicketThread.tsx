import { NavLink } from "react-router-dom";
import { useState } from "react";
import { formatDate } from "../lib/format";
import type { Message, MessageKind } from "../types";

function bubble(kind: MessageKind, internal?: boolean) {
  if (internal) return "bg-amber-50 border-amber-200";
  if (kind === "agent") return "bg-brand-50 border-brand-100";
  if (kind === "collaborator") return "bg-violet-50 border-violet-200";
  if (kind === "system") return "bg-slate-100 border-slate-200 text-ink-600";
  return "bg-white border-slate-200";
}

export function TicketThread({
  messages,
  includeInternal,
}: {
  messages: Message[];
  includeInternal?: boolean;
}) {
  const [recipientMessage, setRecipientMessage] = useState<string | null>(null)
  const visible = includeInternal
    ? messages
    : messages.filter((m) => !m.internal);

  return (
    <ol className="space-y-4">
      {visible.map((m) => (
        <li
          key={m.id}
          className={`rounded-2xl border p-4 shadow-sm ${bubble(m.kind, m.internal)}`}
        >
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
            <p className="font-semibold">
              {m.authorName}
              {m.internal ? (
                <span className="ml-2 text-xs font-medium uppercase tracking-wide text-amber-700">
                  Internal note
                </span>
              ) : null}
              {m.kind === "agent" && !m.internal ? (
                <span className="ml-2 text-xs font-medium uppercase tracking-wide text-brand-700">
                  Staff
                </span>
              ) : null}
              {m.kind === "collaborator" ? <span className="ml-2 text-xs font-medium uppercase tracking-wide text-violet-700">Collaborator</span> : null}
            </p>
            <time className="text-xs text-ink-400" dateTime={m.createdAt}>
              {formatDate(m.createdAt)}
            </time>
          </div>
          {m.recipients?.length ? <div className="mb-2"><button type="button" className="text-xs text-brand-700 underline" onClick={() => setRecipientMessage(recipientMessage === m.id ? null : m.id)}>View email recipients</button>{recipientMessage === m.id ? <p className="mt-1 break-all text-xs text-ink-500">To: {m.recipients.join(', ')}</p> : null}</div> : null}
          <p className="whitespace-pre-wrap text-sm leading-6">{m.body}</p>
          {m.attachments?.length ? (
            <ul className="mt-3 flex flex-wrap gap-2">
              {m.attachments.map((name) => (
                <li
                  key={name}
                  className="rounded-lg bg-black/5 px-2 py-1 text-xs"
                >
                  {name}
                </li>
              ))}
            </ul>
          ) : null}
        </li>
      ))}
    </ol>
  );
}

export function EmptyState({
  title,
  body,
  to,
  cta,
}: {
  title: string;
  body: string;
  to?: string;
  cta?: string;
}) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 p-8 text-center">
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="mt-2 text-sm text-ink-600">{body}</p>
      {to && cta ? (
        <NavLink
          to={to}
          className="mt-4 inline-flex rounded-xl bg-brand-600 px-4 py-2 text-sm font-medium text-white"
        >
          {cta}
        </NavLink>
      ) : null}
    </div>
  );
}
