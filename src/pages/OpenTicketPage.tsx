import { FormEvent, useEffect, useMemo, useState, DragEvent } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import {
  listApiPublicHelpTopics,
  type ApiPublicHelpTopic,
  type ApiHelpTopicFormLink,
  type ApiHelpTopicFormField,
} from "../lib/api";
import { createTicket, upsertRecord } from "../lib/store";
import type { Priority } from "../types";
import { inputClass, btnPrimary, btnGhost } from "../components/ui";
import { RichTextEditor } from "../components/RichTextEditor";
import {
  AlertCircle,
  CheckCircle2,
  FileText,
  HelpCircle,
  Paperclip,
  Upload,
  X,
  User,
  Mail,
  Phone,
  ArrowLeft,
  RotateCcw,
} from "lucide-react";

const ALLOWED_EXTENSIONS = new Set([
  "pdf", "png", "jpg", "jpeg", "gif", "webp", "txt", "csv", "doc", "docx", "xls", "xlsx", "zip"
]);
const MAX_FILES = 5;
const MAX_FILE_SIZE = 8 * 1024 * 1024; // 8 MB

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function OpenTicketPage() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [topics, setTopics] = useState<ApiPublicHelpTopic[]>([]);
  const [ticketDetailsForm, setTicketDetailsForm] = useState<ApiHelpTopicFormLink | null>(null);
  const [topicId, setTopicId] = useState("");
  const [priority, setPriority] = useState<Priority>("normal");
  const [phone, setPhone] = useState(user?.phone || "");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [customValues, setCustomValues] = useState<Record<string, Record<string, string>>>({});
  const [attachments, setAttachments] = useState<File[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState("");
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [loadingTopics, setLoadingTopics] = useState(true);

  // Sync user phone if updated
  useEffect(() => {
    if (user?.phone) {
      setPhone(user.phone);
    }
  }, [user?.phone]);

  // Load public help topics and ticket details form
  useEffect(() => {
    let active = true;
    setLoadingTopics(true);
    listApiPublicHelpTopics()
      .then(({ topics: loadedTopics, departments, ticketDetailsForm: loadedTicketDetailsForm }) => {
        if (!active) return;
        const validTopics = loadedTopics.filter((t) => t.active !== false);
        setTopics(validTopics);
        if (loadedTicketDetailsForm) {
          setTicketDetailsForm(loadedTicketDetailsForm);
        }
        for (const item of validTopics) {
          upsertRecord("topics", {
            id: item.id,
            name: item.name,
            deptId: item.deptId,
            hint: item.hint || "",
            priority: (item.priority as Priority) || "normal",
            active: true,
          });
        }
        for (const department of departments) {
          upsertRecord("departments", { ...department, active: true });
        }
      })
      .catch((err: unknown) => {
        if (active) setError(err instanceof Error ? err.message : "Could not load help topics.");
      })
      .finally(() => {
        if (active) setLoadingTopics(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const selectedTopic = useMemo(() => topics.find((t) => t.id === topicId), [topics, topicId]);

  // Helper to extract placeholder from ost_form_field configuration JSON
  const getFieldPlaceholder = (field: ApiHelpTopicFormField): string => {
    const cfg = field.configuration as Record<string, unknown> | undefined;
    if (typeof cfg?.placeholder === "string" && cfg.placeholder.trim()) {
      return cfg.placeholder.trim();
    }
    return field.hint || "";
  };

  // Helper to check if field allows HTML / rich text toolbar
  const isFieldHtml = (field: ApiHelpTopicFormField): boolean => {
    const cfg = field.configuration as Record<string, unknown> | undefined;
    return Boolean(cfg?.html === true || cfg?.html === "true" || cfg?.html === "1" || cfg?.html === 1);
  };

  // Look up subject and issue details fields from either topic forms or ticketDetailsForm
  const subjectField = useMemo(() => {
    for (const form of selectedTopic?.forms || []) {
      const found = form.fields?.find((f) => f.name === "subject");
      if (found) return found;
    }
    return ticketDetailsForm?.fields?.find((f) => f.name === "subject") || null;
  }, [selectedTopic, ticketDetailsForm]);

  const issueDetailsField = useMemo(() => {
    for (const form of selectedTopic?.forms || []) {
      const found = form.fields?.find((f) => f.name === "issue_details" || f.name === "message");
      if (found) return found;
    }
    return ticketDetailsForm?.fields?.find((f) => f.name === "issue_details" || f.name === "message") || null;
  }, [selectedTopic, ticketDetailsForm]);

  const hasTicketDetailsInForms = useMemo(() => {
    return Boolean(
      selectedTopic?.forms?.some((form) =>
        form.fields?.some((f) => f.name === "subject" || f.name === "issue_details" || f.name === "message")
      )
    );
  }, [selectedTopic]);

  // When help topic changes, update default priority if topic defines one, and reset custom values
  const handleTopicChange = (newTopicId: string) => {
    setTopicId(newTopicId);
    setFormErrors({});
    const found = topics.find((t) => t.id === newTopicId);
    if (found?.priority) {
      setPriority(found.priority.toLowerCase() as Priority);
    }
    // Initialize custom field values for the new topic's forms
    const initialValues: Record<string, Record<string, string>> = {};
    if (found?.forms) {
      for (const form of found.forms) {
        initialValues[form.formId] = {};
        for (const field of form.fields || []) {
          if (field.name === "subject" && subject) {
            initialValues[form.formId][field.id] = subject;
          } else if ((field.name === "issue_details" || field.name === "message") && body) {
            initialValues[form.formId][field.id] = body;
          } else {
            initialValues[form.formId][field.id] = "";
          }
        }
      }
    }
    setCustomValues(initialValues);
  };

  const handleCustomFieldChange = (formId: string, fieldId: string, value: string, fieldName?: string) => {
    setCustomValues((prev) => ({
      ...prev,
      [formId]: {
        ...(prev[formId] || {}),
        [fieldId]: value,
      },
    }));

    if (fieldName === "subject") {
      setSubject(value);
    } else if (fieldName === "issue_details" || fieldName === "message") {
      setBody(value);
    }

    // Clear error for this field if filled
    if (formErrors[`${formId}_${fieldId}`]) {
      setFormErrors((prev) => {
        const next = { ...prev };
        delete next[`${formId}_${fieldId}`];
        return next;
      });
    }
    if (fieldName === "subject" && formErrors.subject) {
      setFormErrors((prev) => {
        const next = { ...prev };
        delete next.subject;
        return next;
      });
    }
    if ((fieldName === "issue_details" || fieldName === "message") && formErrors.body) {
      setFormErrors((prev) => {
        const next = { ...prev };
        delete next.body;
        return next;
      });
    }
  };

  const handleFilesAdded = (files: FileList | File[]) => {
    setError("");
    const newFiles: File[] = [];
    const arrayFiles = Array.from(files);

    if (attachments.length + arrayFiles.length > MAX_FILES) {
      setError(`You can attach up to ${MAX_FILES} files in total.`);
      return;
    }

    for (const file of arrayFiles) {
      if (file.size > MAX_FILE_SIZE) {
        setError(`File "${file.name}" exceeds the maximum limit of 8 MB.`);
        return;
      }
      const ext = file.name.split(".").pop()?.toLowerCase() || "";
      if (!ALLOWED_EXTENSIONS.has(ext)) {
        setError(`File "${file.name}" has an unsupported extension.`);
        return;
      }
      newFiles.push(file);
    }

    setAttachments((prev) => [...prev, ...newFiles]);
  };

  const handleRemoveFile = (index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  };

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFilesAdded(e.dataTransfer.files);
    }
  };

  const handleReset = () => {
    setTopicId("");
    setPriority("normal");
    setSubject("");
    setBody("");
    setPhone(user?.phone || "");
    setCustomValues({});
    setAttachments([]);
    setError("");
    setFormErrors({});
  };

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError("");
    const errors: Record<string, string> = {};

    if (!user) {
      setError("You must be logged in to open a support ticket.");
      return;
    }

    if (!topicId) {
      errors.topicId = "Please select a help topic.";
    }

    let finalSubject = subject.trim();
    let finalBody = body.trim();

    // Check custom values if subject or body were entered in dynamic form fields
    if (!finalSubject && selectedTopic?.forms) {
      for (const form of selectedTopic.forms) {
        const sf = form.fields?.find((f) => f.name === "subject");
        if (sf && customValues[form.formId]?.[sf.id]) {
          finalSubject = customValues[form.formId][sf.id].trim();
          break;
        }
      }
    }

    if (!finalBody && selectedTopic?.forms) {
      for (const form of selectedTopic.forms) {
        const bf = form.fields?.find((f) => f.name === "issue_details" || f.name === "message");
        if (bf && customValues[form.formId]?.[bf.id]) {
          finalBody = customValues[form.formId][bf.id].trim();
          break;
        }
      }
    }

    if (!finalSubject) {
      errors.subject = "Please enter an issue summary.";
    }

    if (!finalBody) {
      errors.body = "Please provide details regarding your issue.";
    }

    // Validate custom forms and required fields
    if (selectedTopic?.forms) {
      for (const form of selectedTopic.forms) {
        for (const field of form.fields || []) {
          if (field.required && !field.disabled) {
            const val = customValues[form.formId]?.[field.id]?.trim() || "";
            // Special check: if field is subject or issue_details, check finalSubject/finalBody as fallback
            const isFilled =
              Boolean(val) ||
              (field.name === "subject" && Boolean(finalSubject)) ||
              ((field.name === "issue_details" || field.name === "message") && Boolean(finalBody));

            if (!isFilled) {
              errors[`${form.formId}_${field.id}`] = `${field.label || field.name || "This field"} is required.`;
            }
          }
        }
      }
    }

    if (Object.keys(errors).length > 0) {
      setFormErrors(errors);
      setError("Please fill in all required fields indicated below.");
      return;
    }

    setSaving(true);
    try {
      const { ticket, thankYouPage } = await createTicket({
        userId: user.id,
        name: user.name,
        email: user.email,
        phone: phone.trim() || undefined,
        employeeId: user.employeeId || "",
        branchId: user.branchId || "",
        topicId,
        subject: finalSubject,
        body: finalBody,
        priority,
        attachments,
        formValues: customValues,
      });

      if (thankYouPage) {
        navigate(
          `/thanks?email=${encodeURIComponent(user.email)}&number=${encodeURIComponent(ticket.number)}`,
          { state: { thankYouPage } }
        );
      } else if (user.role === "client") {
        navigate(`/tickets/${ticket.id}`);
      } else {
        navigate(
          `/thanks?email=${encodeURIComponent(user.email)}&number=${encodeURIComponent(ticket.number)}`
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create ticket. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  // If user is not authenticated, show sign-in prompt
  if (!user) {
    return (
      <div className="mx-auto max-w-lg text-slate-700 dark:text-slate-200 text-center rounded-3xl border border-line bg-surface p-8 shadow-sm space-y-6">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-amber-50 text-amber-600 dark:bg-amber-950/70 dark:text-amber-400">
          <AlertCircle className="h-9 w-9" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-ink-800 dark:text-white">Authentication Required</h1>
          <p className="mt-2 text-sm text-ink-600 dark:text-slate-400 leading-relaxed">
            In order to create support tickets and track ticket progress, you must sign in with a registered account.
          </p>
        </div>
        <div className="flex flex-col gap-3 pt-2">
          <button
            onClick={() => navigate("/login")}
            className="w-full rounded-xl bg-brand-600 py-3 px-4 font-semibold text-white shadow-sm hover:bg-brand-700 transition"
          >
            Sign In to Client Portal
          </button>
          <button
            onClick={() => navigate("/register")}
            className="w-full rounded-xl border border-line bg-paper py-3 px-4 font-semibold text-ink-800 dark:text-slate-200 hover:bg-surface transition"
          >
            Create an Account
          </button>
          <button
            onClick={() => navigate("/scp/login")}
            className="mt-2 text-xs font-medium text-ink-500 hover:text-brand-600 dark:text-slate-400 dark:hover:text-brand-400"
          >
            Agent & Staff Portal &rarr;
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl pb-16">
      {/* Top Header */}
      <div className="mb-6 flex flex-col gap-2">
        <div className="flex items-center gap-2 text-sm text-ink-500 dark:text-slate-400 mb-1">
          <Link to="/" className="hover:text-brand-600 flex items-center gap-1">
            <ArrowLeft className="h-4 w-4" /> Home
          </Link>
          <span>/</span>
          <span className="text-ink-800 dark:text-slate-200 font-medium">Open Ticket</span>
        </div>
        <h1 className="text-2xl sm:text-3xl font-bold text-ink-800 dark:text-white">Open a New Ticket</h1>
        <p className="text-sm text-ink-600 dark:text-slate-400">
          Please fill out the form below with as much detail as possible to help us address your issue promptly.
        </p>
      </div>

      {/* Error Alert */}
      {error && (
        <div className="mb-6 flex items-start gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800 dark:border-rose-900/40 dark:bg-rose-950/40 dark:text-rose-200">
          <AlertCircle className="h-5 w-5 shrink-0 text-rose-600 dark:text-rose-400 mt-0.5" />
          <div className="flex-1 font-medium">{error}</div>
          <button
            type="button"
            onClick={() => setError("")}
            className="text-rose-600 dark:text-rose-400 hover:text-rose-800"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      <form onSubmit={onSubmit} className="space-y-6">
        {/* User Information */}
        <div className="rounded-2xl border border-line bg-surface p-5 shadow-sm space-y-4">
          <div className="flex items-center gap-2 border-b border-line pb-3">
            <User className="h-5 w-5 text-brand-600 dark:text-brand-400" />
            <h2 className="text-base font-semibold text-ink-800 dark:text-slate-100">Requester Information</h2>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-ink-500 dark:text-slate-400 mb-1">
                Full Name
              </label>
              <div className="relative">
                <input
                  type="text"
                  readOnly
                  disabled
                  value={user.name}
                  className="w-full rounded-xl border border-line bg-slate-100/80 dark:bg-slate-800/60 px-3.5 py-2 text-sm text-ink-700 dark:text-slate-300 cursor-not-allowed"
                />
                <span className="absolute right-3 top-2.5 text-xs text-emerald-600 dark:text-emerald-400 flex items-center gap-1 font-medium">
                  <CheckCircle2 className="h-3.5 w-3.5" /> Verified
                </span>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-ink-500 dark:text-slate-400 mb-1">
                Email Address
              </label>
              <div className="relative">
                <input
                  type="email"
                  readOnly
                  disabled
                  value={user.email}
                  className="w-full rounded-xl border border-line bg-slate-100/80 dark:bg-slate-800/60 px-3.5 py-2 text-sm text-ink-700 dark:text-slate-300 cursor-not-allowed"
                />
                <span className="absolute right-3 top-2.5 text-xs text-ink-400 dark:text-slate-500">
                  <Mail className="h-3.5 w-3.5" />
                </span>
              </div>
            </div>

            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold uppercase tracking-wider text-ink-500 dark:text-slate-400 mb-1">
                Phone Number <span className="font-normal lowercase text-ink-400">(optional)</span>
              </label>
              <div className="relative">
                <input
                  type="tel"
                  name="phone"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="e.g. +1 555-0199"
                  className={inputClass}
                />
                <span className="absolute right-3 top-2.5 text-ink-400 dark:text-slate-500">
                  <Phone className="h-4 w-4" />
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Ticket Routing & Help Topic */}
        <div className="rounded-2xl border border-line bg-surface p-5 shadow-sm space-y-4">
          <div className="flex items-center gap-2 border-b border-line pb-3">
            <HelpCircle className="h-5 w-5 text-brand-600 dark:text-brand-400" />
            <h2 className="text-base font-semibold text-ink-800 dark:text-slate-100">Ticket Category</h2>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-sm font-medium text-ink-800 dark:text-slate-200 mb-1">
                Help Topic <span className="text-rose-500 font-bold">*</span>
              </label>
              <select
                required
                name="topicId"
                value={topicId}
                onChange={(e) => handleTopicChange(e.target.value)}
                disabled={loadingTopics}
                className={`${inputClass} ${formErrors.topicId ? "border-rose-500 ring-1 ring-rose-500" : ""}`}
              >
                <option value="">— Select a Help Topic —</option>
                {topics.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
              {formErrors.topicId && (
                <p className="mt-1 text-xs text-rose-600 dark:text-rose-400">{formErrors.topicId}</p>
              )}
              {selectedTopic?.hint && (
                <p className="mt-1.5 text-xs text-ink-600 dark:text-slate-400 bg-slate-50 dark:bg-slate-800/50 rounded-lg p-2 border border-line">
                  {selectedTopic.hint}
                </p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-ink-800 dark:text-slate-200 mb-1">
                Priority
              </label>
              <select
                name="priority"
                value={priority}
                onChange={(e) => setPriority(e.target.value as Priority)}
                className={inputClass}
              >
                <option value="low">Low</option>
                <option value="normal">Normal</option>
                <option value="high">High</option>
                <option value="emergency">Emergency</option>
              </select>
              <p className="mt-1 text-xs text-ink-500 dark:text-slate-400">
                Default urgency for this topic is {selectedTopic?.priority || "normal"}.
              </p>
            </div>
          </div>
        </div>

        {/* Dynamic Forms associated with Help Topic (includes Ticket Details and Custom Forms) */}
        {selectedTopic?.forms && selectedTopic.forms.length > 0 && (
          <div className="space-y-4">
            {selectedTopic.forms.map((form) => {
              const activeFields = (form.fields || []).filter((f) => !f.disabled);
              if (activeFields.length === 0) return null;

              return (
                <div key={form.formId} className="rounded-2xl border border-line bg-surface p-5 shadow-sm space-y-4">
                  <div className="border-b border-line pb-2.5">
                    <div className="flex items-center gap-2">
                      <FileText className="h-5 w-5 text-brand-600 dark:text-brand-400" />
                      <h3 className="text-base font-semibold text-ink-800 dark:text-slate-100">
                        {form.title || "Additional Information"}
                      </h3>
                    </div>
                    {form.instructions && (
                      <p className="mt-1 text-xs text-ink-600 dark:text-slate-400 leading-relaxed">
                        {form.instructions}
                      </p>
                    )}
                  </div>

                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    {activeFields.map((field) => {
                      const fieldKey = `${form.formId}_${field.id}`;
                      const fieldError = formErrors[fieldKey] || (field.name === "subject" ? formErrors.subject : field.name === "issue_details" || field.name === "message" ? formErrors.body : undefined);
                      const currentValue = customValues[form.formId]?.[field.id] || (field.name === "subject" ? subject : field.name === "issue_details" || field.name === "message" ? body : "");
                      const isFullWidth = field.type === "memo" || field.type === "textarea" || isFieldHtml(field);
                      const placeholderText = getFieldPlaceholder(field);

                      return (
                        <div key={field.id} className={isFullWidth ? "sm:col-span-2" : ""}>
                          <label className="block text-sm font-medium text-ink-800 dark:text-slate-200 mb-1">
                            {field.label || field.name}
                            {field.required && <span className="text-rose-500 font-bold ml-1">*</span>}
                          </label>

                          {/* Render based on field type and configuration */}
                          {field.type === "memo" || field.type === "textarea" ? (
                            isFieldHtml(field) ? (
                              <RichTextEditor
                                value={currentValue}
                                onChange={(val) => handleCustomFieldChange(form.formId, field.id, val, field.name)}
                                placeholder={placeholderText || "Please provide full details, error messages, and steps to reproduce ..."}
                                className={fieldError ? "border-rose-500 ring-1 ring-rose-500" : ""}
                              />
                            ) : (
                              <textarea
                                rows={4}
                                value={currentValue}
                                onChange={(e) => handleCustomFieldChange(form.formId, field.id, e.target.value, field.name)}
                                className={`${inputClass} ${fieldError ? "border-rose-500 ring-1 ring-rose-500" : ""}`}
                                placeholder={placeholderText}
                              />
                            )
                          ) : field.type === "bool" || field.type === "checkbox" ? (
                            <label className="flex items-center gap-2 cursor-pointer mt-2">
                              <input
                                type="checkbox"
                                checked={currentValue === "1" || currentValue === "true"}
                                onChange={(e) =>
                                  handleCustomFieldChange(form.formId, field.id, e.target.checked ? "1" : "0", field.name)
                                }
                                className="h-4 w-4 rounded border-line text-brand-600 focus:ring-brand-500"
                              />
                              <span className="text-sm text-ink-700 dark:text-slate-300">
                                {field.hint || field.label}
                              </span>
                            </label>
                          ) : field.type.startsWith("list-") ||
                            field.type === "choices" ||
                            field.type === "select" ||
                            Boolean(field.listOptions && field.listOptions.length > 0) ? (
                            <select
                              value={currentValue}
                              onChange={(e) => handleCustomFieldChange(form.formId, field.id, e.target.value, field.name)}
                              className={`${inputClass} ${fieldError ? "border-rose-500 ring-1 ring-rose-500" : ""}`}
                            >
                              <option value="">— Select an option —</option>
                              {field.listOptions && field.listOptions.length > 0
                                ? field.listOptions.map((opt) => (
                                    <option key={opt.id} value={opt.value}>
                                      {opt.value}
                                    </option>
                                  ))
                                : field.configuration &&
                                  typeof field.configuration.choices === "string"
                                ? field.configuration.choices
                                    .split("\n")
                                    .map((line: string) => line.trim())
                                    .filter(Boolean)
                                    .map((choice: string) => (
                                      <option key={choice} value={choice}>
                                        {choice}
                                      </option>
                                    ))
                                : null}
                            </select>
                          ) : field.type === "int" || field.type === "number" ? (
                            <input
                              type="number"
                              value={currentValue}
                              onChange={(e) => handleCustomFieldChange(form.formId, field.id, e.target.value, field.name)}
                              className={`${inputClass} ${fieldError ? "border-rose-500 ring-1 ring-rose-500" : ""}`}
                              placeholder={placeholderText}
                            />
                          ) : field.type === "date" || field.type === "datetime" ? (
                            <input
                              type="date"
                              value={currentValue}
                              onChange={(e) => handleCustomFieldChange(form.formId, field.id, e.target.value, field.name)}
                              className={`${inputClass} ${fieldError ? "border-rose-500 ring-1 ring-rose-500" : ""}`}
                            />
                          ) : (
                            <input
                              type="text"
                              value={currentValue}
                              onChange={(e) => handleCustomFieldChange(form.formId, field.id, e.target.value, field.name)}
                              className={`${inputClass} ${fieldError ? "border-rose-500 ring-1 ring-rose-500" : ""}`}
                              placeholder={placeholderText}
                            />
                          )}

                          {field.hint && field.type !== "bool" && field.type !== "checkbox" && (
                            <p className="mt-1 text-xs text-ink-500 dark:text-slate-400">{field.hint}</p>
                          )}
                          {fieldError && (
                            <p className="mt-1 text-xs text-rose-600 dark:text-rose-400">{fieldError}</p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Issue Details Card (rendered when not already included in custom forms) */}
        {!hasTicketDetailsInForms && (
          <div className="rounded-2xl border border-line bg-surface p-5 shadow-sm space-y-4">
            <div className="flex items-center gap-2 border-b border-line pb-3">
              <FileText className="h-5 w-5 text-brand-600 dark:text-brand-400" />
              <h2 className="text-base font-semibold text-ink-800 dark:text-slate-100">
                {ticketDetailsForm?.title || "Ticket Details"}
              </h2>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-ink-800 dark:text-slate-200 mb-1">
                  {subjectField?.label || "Issue Summary"} <span className="text-rose-500 font-bold">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder={subjectField ? getFieldPlaceholder(subjectField) : "e.g. Cannot access portal after password reset"}
                  className={`${inputClass} ${formErrors.subject ? "border-rose-500 ring-1 ring-rose-500" : ""}`}
                />
                {formErrors.subject && (
                  <p className="mt-1 text-xs text-rose-600 dark:text-rose-400">{formErrors.subject}</p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-ink-800 dark:text-slate-200 mb-1">
                  {issueDetailsField?.label || "Issue Details"} <span className="text-rose-500 font-bold">*</span>
                </label>
                {issueDetailsField && isFieldHtml(issueDetailsField) ? (
                  <RichTextEditor
                    value={body}
                    onChange={setBody}
                    placeholder={getFieldPlaceholder(issueDetailsField)}
                    className={formErrors.body ? "border-rose-500 ring-1 ring-rose-500" : ""}
                  />
                ) : (
                  <textarea
                    rows={5}
                    required
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    placeholder={issueDetailsField ? getFieldPlaceholder(issueDetailsField) : "Please provide full details, error messages, and steps to reproduce ..."}
                    className={`${inputClass} ${formErrors.body ? "border-rose-500 ring-1 ring-rose-500" : ""}`}
                  />
                )}
                {formErrors.body && (
                  <p className="mt-1 text-xs text-rose-600 dark:text-rose-400">{formErrors.body}</p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Attachments Card */}
        <div className="rounded-2xl border border-line bg-surface p-5 shadow-sm space-y-4">
          <div className="flex items-center justify-between border-b border-line pb-3">
            <div className="flex items-center gap-2">
              <Paperclip className="h-5 w-5 text-brand-600 dark:text-brand-400" />
              <h2 className="text-base font-semibold text-ink-800 dark:text-slate-100">Attachments</h2>
            </div>
            <span className="text-xs text-ink-500 dark:text-slate-400">
              {attachments.length} / {MAX_FILES} files
            </span>
          </div>

          {/* Drag and Drop Box */}
          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={`flex flex-col items-center justify-center rounded-2xl border-2 border-dashed p-6 text-center transition ${
              isDragging
                ? "border-brand-500 bg-brand-50/50 dark:bg-brand-950/20"
                : "border-line bg-paper/50 dark:bg-slate-900/40 hover:bg-paper"
            }`}
          >
            <Upload className="h-8 w-8 text-ink-400 dark:text-slate-500 mb-2" />
            <p className="text-sm font-medium text-ink-800 dark:text-slate-200">
              Drag & drop files here, or{" "}
              <label className="text-brand-600 dark:text-brand-400 hover:underline cursor-pointer">
                browse
                <input
                  type="file"
                  multiple
                  accept=".pdf,.png,.jpg,.jpeg,.gif,.webp,.txt,.csv,.doc,.docx,.xls,.xlsx,.zip"
                  onChange={(e) => {
                    if (e.target.files) handleFilesAdded(e.target.files);
                    e.target.value = "";
                  }}
                  className="hidden"
                />
              </label>
            </p>
            <p className="mt-1 text-xs text-ink-400 dark:text-slate-500">
              PDF, PNG, JPG, GIF, WebP, TXT, CSV, DOC, XLS, ZIP · Up to 5 files, 8 MB each
            </p>
          </div>

          {/* List of chosen files */}
          {attachments.length > 0 && (
            <ul className="space-y-2 pt-1">
              {attachments.map((file, idx) => (
                <li
                  key={`${file.name}-${idx}`}
                  className="flex items-center justify-between rounded-xl border border-line bg-paper px-3 py-2 text-sm"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <Paperclip className="h-4 w-4 shrink-0 text-brand-600 dark:text-brand-400" />
                    <span className="truncate font-medium text-ink-800 dark:text-slate-200">
                      {file.name}
                    </span>
                    <span className="shrink-0 text-xs text-ink-400 dark:text-slate-500">
                      ({formatFileSize(file.size)})
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRemoveFile(idx)}
                    className="p-1 rounded-lg text-ink-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition"
                    title="Remove file"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Submit Actions */}
        <div className="flex flex-col-reverse sm:flex-row items-center justify-between gap-3 pt-2">
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <button
              type="button"
              onClick={handleReset}
              className={`${btnGhost} w-full sm:w-auto flex items-center justify-center gap-1.5`}
            >
              <RotateCcw className="h-4 w-4" /> Reset
            </button>
            <button
              type="button"
              onClick={() => navigate("/tickets")}
              className={`${btnGhost} w-full sm:w-auto`}
            >
              Cancel
            </button>
          </div>

          <button
            type="submit"
            disabled={saving}
            className={`${btnPrimary} w-full sm:w-auto min-w-[140px] px-6 py-2.5 shadow-sm disabled:opacity-60`}
          >
            {saving ? "Creating Ticket…" : "Create Ticket"}
          </button>
        </div>
      </form>
    </div>
  );
}
