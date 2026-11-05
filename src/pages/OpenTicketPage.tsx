import { FormEvent, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { listApiPublicHelpTopics } from "../lib/api";
import { createTicket, upsertRecord } from "../lib/store";
import type { HelpTopic, Priority } from "../types";

import { inputClass } from "../components/ui"
export function OpenTicketPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [topics, setTopics] = useState<HelpTopic[]>([]);
  const [topicId, setTopicId] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const topic = useMemo(() => topics.find((t) => t.id === topicId), [topics, topicId]);

  useEffect(() => {
    let active = true;
    void listApiPublicHelpTopics()
      .then(({ topics: persisted, departments }) => {
        if (!active) return;
        const loaded = persisted.map((item) => ({ ...item, hint: item.hint || '', priority: item.priority as Priority }));
        setTopics(loaded);
        for (const item of loaded) upsertRecord('topics', item);
        for (const department of departments) upsertRecord('departments', { ...department, active: true });
      })
      .catch((err: unknown) => { if (active) setError(err instanceof Error ? err.message : "Could not load help topics."); });
    return () => { active = false; };
  }, []);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setSaving(true);
    try {
      const { ticket, thankYouPage } = await createTicket({
        userId: user?.id ?? "",
        name: String(form.get("name") || user?.name || ""),
        email: String(form.get("email") || user?.email || ""),
        phone: String(form.get("phone") || user?.phone || ""),
        employeeId: user?.employeeId || "",
        branchId: user?.branchId || "",
        topicId: String(form.get("topicId")),
        subject: String(form.get("subject")),
        body: String(form.get("body")),
        priority: String(form.get("priority")) as Priority,
        attachments: form.getAll("attachments").filter((item): item is File => item instanceof File && item.size > 0),
      });
      if (user?.role === "client") navigate(`/tickets/${ticket.id}`);
      else
        navigate(
          `/thanks?email=${encodeURIComponent(String(form.get("email") || user?.email || ""))}&number=${encodeURIComponent(ticket.number)}`,
          { state: { thankYouPage } },
        );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create ticket.");
    } finally {
      setSaving(false);
    }
  }

  if (!user) {
    return (
      <div className="mx-auto max-w-lg text-slate-700 text-center rounded-3xl border-2 border-line bg-surface p-8 shadow-sm space-y-5">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-50 text-amber-600 dark:bg-amber-950/70 dark:text-amber-400">
          <svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>
        </div>
        <div>
          <h1 className="text-xl font-bold dark:text-slate-200">Sign In Required</h1>
          <p className="mt-2 text-sm text-ink-600 leading-relaxed">
            Only registered clients or staff members can open support tickets. Please sign in or register an account to continue.
          </p>
        </div>
        <div className="flex flex-col gap-2 pt-2">
          <button
            onClick={() => navigate("/login")}
            className="rounded-xl bg-brand-600 py-2.5 px-4 font-semibold text-white shadow hover:bg-brand-700 transition"
          >
            Sign In as Client
          </button>
          <button
            onClick={() => navigate("/register")}
            className="rounded-xl border border-line bg-paper py-2.5 px-4 font-semibold text-ink-800 hover:bg-surface transition"
          >
            Register Client Account
          </button>
          <button
            onClick={() => navigate("/scp/login")}
            className="mt-2 text-xs font-semibold text-ink-500 hover:text-brand-600"
          >
            Staff & Agent Sign In &rarr;
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl text-slate-700">
      <h1 className="text-2xl font-semibold dark:text-slate-500">Open a new ticket</h1>
      <p className="mt-1 text-sm text-ink-600">
        Please fill in the form below. Required fields are marked.
      </p>
      {error ? (
        <p className="mt-4 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-800">
          {error}
        </p>
      ) : null}
      <form
        onSubmit={onSubmit}
        className="mt-6 space-y-4 rounded-2xl border-4 dark:border-slate-600 border-slate-200  p-5 shadow-sm sm:p-6"
      >
        <div className="rounded-xl bg-brand-50 dark:bg-brand-950/40 border border-brand-200 dark:border-blue-900 px-4 py-3 text-sm text-ink-800">
          Opening as verified account: <strong>{user.name}</strong> ({user.email}) &bull; <span className="capitalize font-semibold text-brand-600">{user.role}</span>
        </div>
        <input type="hidden" name="name" value={user.name} />
        <input type="hidden" name="email" value={user.email} />
        <label className="block dark:text-slate-400 text-sm font-medium">
          Phone
          <input
            name="phone"
            defaultValue={user.phone || ""}
            className={inputClass + " mt-1"}
          />
        </label>
        <label className="block dark:text-slate-400 text-sm font-medium">
          Help topic *
          <select
            required
            name="topicId"
            value={topicId}
            onChange={(e) => setTopicId(e.target.value)}
            className={inputClass + " mt-1"}
          >
            <option className="dark:text-slate-400 text-slate-700" value="">
              — Select a help topic —
            </option>
            {topics.filter((t) => t.active !== false).map((t) => (
              <option className="dark:text-slate-400 text-slate-700" key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        {topic ? <p className="text-sm text-ink-600">{topic.hint}</p> : null}
        <label className="block text-sm dark:text-slate-400 font-medium">
          Priority
          <select
            name="priority"
            defaultValue="normal"
            className={inputClass + " mt-1"}
          >
            <option className="text-slate-700" value="low">
              Low
            </option>
            <option className="text-slate-700" value="normal">
              Normal
            </option>
            <option className="text-slate-700" value="high">
              High
            </option>
            <option className="text-slate-700" value="emergency">
              Emergency
            </option>
          </select>
        </label>
        <label className="block text-sm font-medium dark:text-slate-400">
          Subject *
          <input
            required
            name="subject"
            className={inputClass + " mt-1"}
          />
        </label>
        <label className="block text-sm font-medium dark:text-slate-400">
          Issue details *
          <textarea
            required
            name="body"
            rows={6}
            className={inputClass + " mt-1"}
          />
        </label>
        <label className="block text-sm font-medium text-white">
          Attach files
          <input
            type="file"
            name="attachments"
            multiple
            accept=".pdf,.png,.jpg,.jpeg,.gif,.webp,.txt,.csv,.doc,.docx,.xls,.xlsx,.zip"
            className="mt-1 block w-full rounded-xl border dark:border-slate-600 border-slate-300 px-3 py-2 text-sm text-white file:mr-3 file:rounded-lg file:border-0 file:bg-brand-600 file:px-3 file:py-1.5"
          />
          <span className="mt-1 block text-xs font-normal text-slate-500">PDF, images, documents, CSV, or ZIP; up to 5 files, 8 MB each.</span>
        </label>
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button
            type="reset"
            className="rounded-xl border dark:border-slate-600 dark:text-slate-400 border-slate-300 px-4 py-2 text-sm"
          >
            Reset
          </button>
          <button
            type="submit"
            className="rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white"
          >
            {saving ? "Saving…" : "Create ticket"}
          </button>
        </div>
      </form> 
    </div>
  );
}
