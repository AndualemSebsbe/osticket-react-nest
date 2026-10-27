import { NavLink } from "react-router-dom";
import { useState } from "react";
import { formatDate } from "../lib/format";
import { downloadApiTicketAttachment } from "../lib/api";
import type { Message, MessageKind } from "../types";

function bubble(kind: MessageKind, internal?: boolean) {
  if (internal) return "flex bg-amber-50 border-amber-200";
  if (kind === "agent") return "flex  bg-brand-50 border-brand-100";
  if (kind === "collaborator") return "bg-violet-50 border-violet-200";
  if (kind === "system") return "flex bg-slate-100 border-slate-200 text-ink-600";
  if (kind === "client") return "flex bg-ink-950 border-line";
  return " border-slate-200";
}

function bubbleOl(kind: MessageKind, internal?: boolean) {
  if (internal) return "flex items-end text-start";
  if (kind === "agent") return "flex items-end text-start";
  if (kind === "client") return "flex items-start";
  if (kind === "collaborator") return "flex items-start";
  if (kind === "system") return "flex ";
  return " border-slate-200";
}

export function TicketThread({
  messages,
  includeInternal,
  ticketNumber,
  attachmentEmail,
}: {
  messages: Message[];
  includeInternal?: boolean;
  ticketNumber: string;
  attachmentEmail?: string;
}) {
  const [recipientMessage, setRecipientMessage] = useState<string | null>(null)
  const [attachmentError, setAttachmentError] = useState('')
  const [downloading, setDownloading] = useState('')
  const visible = includeInternal
    ? messages
    : messages.filter((m) => !m.internal);

  return (
    <>
    {visible.map((m) => (
        <ol className={`space-y-4 flex flex-col ${bubbleOl(m.kind, m.internal)} `}>
        <li
          key={m.id}
          className={`flex flex-col rounded-2xl border border-slate-300 dark:border-slate-600 p-4 shadow-sm ${bubble(m.kind, m.internal)}`}
        >
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
            <p className="flex flex-col font-semibold">
              {m.authorName}
              {m.internal ? (
                <span className=" text-xs font-medium uppercase tracking-wide text-amber-700">
                  Internal note
                </span>
              ) : null}
              {m.kind === "agent" && !m.internal ? (
                <span className=" text-xs font-medium uppercase tracking-wide text-brand-700">
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
              {m.attachments.map((name, index) => {
                const file = m.attachmentFiles?.[index]
                return (
                <li
                  key={file?.id || `${name}-${index}`}
                  className="rounded-lg bg-black/5 px-2 py-1 text-xs dark:text-slate-400"
                >
                  <a href={`/api/v1/tickets/${encodeURIComponent(ticketNumber)}/attachments/${encodeURIComponent(file?.id || `name:${name}`)}`} download={name} aria-disabled={downloading === (file?.id || name)} className="text-brand-700 underline aria-disabled:opacity-50" onClick={(event) => { event.preventDefault(); const fileRef = file?.id || `name:${name}`; if (downloading === (file?.id || name)) return; setDownloading(file?.id || name); setAttachmentError(''); void downloadApiTicketAttachment(ticketNumber, fileRef, name, attachmentEmail).catch((error: unknown) => setAttachmentError(error instanceof Error ? error.message : 'Could not download attachment.')).finally(() => setDownloading('')) }}>{name}</a>
                </li>
              )})}
            </ul>
          ) : null}
          {attachmentError ? <p role="alert" className="mt-2 text-xs text-rose-700">{attachmentError}</p> : null}
        </li>
    </ol>
      ))}
      </>
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
