import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { EmptyState } from "../components/TicketThread";
import { PriorityBadge, StatusBadge } from "../components/Badges";
import { useAuth } from "../context/AuthContext";
import { relativeTime } from "../lib/format";
import { getDb, subscribe, ticketsForUser } from "../lib/store";
import type { TicketStatus } from "../types";

import { inputClass } from "../components/ui"
export function TicketsPage() {
  const { user } = useAuth();
  const [, setTick] = useState(0);
  const [status, setStatus] = useState<TicketStatus | "all">("open");
  const [q, setQ] = useState("");

  useEffect(() => subscribe(() => setTick((n) => n + 1)), []);

  const tickets = useMemo(() => {
    if (!user) return [];
    return ticketsForUser(user.id).filter((t) => {
      if (status !== "all" && t.status !== status) return false;
      if (
        q &&
        !`${t.number} ${t.subject}`.toLowerCase().includes(q.toLowerCase())
      )
        return false;
      return true;
    });
  }, [user, status, q]);

  if (!user) {
    return (
      <EmptyState
        title="Sign in to see your tickets"
        body="Create an account or sign in to track open cases."
        to="/login"
        cta="Sign in"
      />
    );
  }

  const db = getDb();
  const counts = {
    open: ticketsForUser(user.id).filter((t) => t.status === "open").length,
    pending: ticketsForUser(user.id).filter((t) => t.status === "pending")
      .length,
    closed: ticketsForUser(user.id).filter((t) => t.status === "closed").length,
  };

  return (
    <div className="mx-auto max-w-4xl text-slate-700">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">My tickets</h1>
          <p className="text-sm">
            Search, filter, and follow up without leaving the portal.
          </p>
        </div>
        <Link
          to="/open"
          className="rounded-xl bg-brand-600 px-4 py-2 text-center text-sm font-semibold text-white"
        >
          Open a ticket
        </Link>
      </div>
      <div className="mt-6 flex flex-col gap-3 sm:flex-row">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search number or subject"
          className={inputClass + " flex-1"}
        />
        <div className="flex gap-2 overflow-x-auto">
          {(["open", "pending", "closed", "all"] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStatus(s)}
              className={`rounded-full px-3 py-1.5 text-sm capitalize ${status === s ? "bg-brand-600 text-white" : "bg-white ring-1 ring-slate-200"}`}
            >
              {s}
              {s !== "all" ? ` (${counts[s]})` : ""}
            </button>
          ))}
        </div>
      </div>
      {tickets.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            title="No tickets in this view"
            body="Try another filter or open a new request."
            to="/open"
            cta="New ticket"
          />
        </div>
      ) : (
        <ul className="mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-white">
          {tickets.map((t) => (
            <li key={t.id} className="border-b border-slate-100 last:border-0">
              <Link
                to={`/tickets/${t.id}`}
                className="flex flex-col gap-2 px-4 py-4 hover:bg-slate-50 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <p className="font-medium">
                    <span className="text-ink-400">#{t.number}</span>{" "}
                    {t.subject}
                    {t.collaboratorIds?.includes(user.id) ? <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-violet-50 px-2 py-0.5 text-xs text-violet-700" title="You are a collaborator" aria-label="You are a collaborator">♧ Collaborator</span> : null}
                  </p>
                  <p className="text-sm text-slate-700">
                    {db.topics.find((x) => x.id === t.topicId)?.name} ·{" "}
                    {t.branchName ? `${t.branchName} · ` : ''}
                    {relativeTime(t.updatedAt)}
                  </p>
                </div>
                <div className="flex gap-2">
                  <StatusBadge status={t.status} />
                  <PriorityBadge priority={t.priority} />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
