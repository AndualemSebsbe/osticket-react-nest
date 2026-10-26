import type { Priority, TicketStatus } from "../types";

const statusClass: Record<TicketStatus, string> = {
  open: "bg-emerald-100 text-emerald-800",
  pending: "bg-amber-100 text-amber-800",
  closed: "bg-slate-200 text-slate-700",
};

const priorityClass: Record<Priority, string> = {
  low: "bg-slate-100 text-slate-600",
  normal: "bg-sky-100 text-sky-800",
  high: "bg-orange-100 text-orange-800",
  emergency: "bg-rose-100 text-rose-800",
};

export function StatusBadge({ status }: { status: TicketStatus }) {
  return (
    <span
      className={`text-slate-700 inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ${statusClass[status]}`}
    >
      {status}
    </span>
  );
}

export function PriorityBadge({ priority }: { priority: Priority }) {
  return (
    <span
      className={`inline-flex text-slate-700 rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ${priorityClass[priority]}`}
    >
      {priority}
    </span>
  );
}
