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
      const ticket = await createTicket({
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
          `/thanks?email=${encodeURIComponent(String(form.get("email") || user?.email || ""))}&number=${ticket.number}`,
        );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create ticket.");
    } finally {
      setSaving(false);
    }
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
        {!user || user.role !== "client" ? (
          <div className="grid gap-4  sm:grid-cols-2">
            <label className="block text-sm font-medium dark:text-slate-400">
              Full name *
              <input
                required
                name="name"
                className={inputClass + " mt-1"}
              />
            </label>
            <label className="block text-sm font-medium dark:text-slate-400">
              Email *
              <input
                required
                type="email"
                name="email"
                className={inputClass + " mt-1"}
              />
            </label>
            <label className="block dark:text-slate-400 text-sm font-medium sm:col-span-2">
              Phone
              <input
                name="phone"
                className={inputClass + " mt-1"}
              />
            </label>
          </div>
        ) : (
          <p className="rounded-xl bg-slate-50 px-3 py-2 text-sm">
            Opening as <strong>{user.name}</strong> ({user.email})
          </p>
        )}
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
