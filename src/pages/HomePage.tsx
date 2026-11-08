import { useState, useEffect, useMemo, useRef, type FormEvent, type ChangeEvent } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useDb } from "../hooks/useDb";
import {
  getApiWizardMeta,
  getApiWizardFaqs,
  checkApiTicketStatus,
  apiLookupTicketByEmail,
  type ApiWizardTopic,
  type ApiWizardCategory,
  type ApiWizardFaq,
  type ApiWizardTicketStatusResult,
} from "../lib/api";
import { createTicket, hydrateSingleApiTicket, upsertRecord } from "../lib/store";
import { relativeTime } from "../lib/format";
import { inputClass } from "../components/ui";
import type { Priority } from "../types";

type WizardPath = "none" | "solve" | "ticket" | "status" | "contact";

export function HomePage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { faqs: storeFaqs, pages, settings: storeSettings } = useDb();

  // Wizard view mode: "wizard" (interactive assistant) or "classic" (standard portal)
  const [viewMode, setViewMode] = useState<"wizard" | "classic">("wizard");

  // Wizard Navigation State
  const [currentPath, setCurrentPath] = useState<WizardPath>("none");
  const [wizardStep, setWizardStep] = useState<number>(1);

  // Database metadata loaded via Prisma
  const [loadingMeta, setLoadingMeta] = useState<boolean>(true);
  const [dbTopics, setDbTopics] = useState<ApiWizardTopic[]>([]);
  const [dbCategories, setDbCategories] = useState<ApiWizardCategory[]>([]);
  const [dbFeaturedFaqs, setDbFeaturedFaqs] = useState<ApiWizardFaq[]>([]);
  const [dbBranches, setDbBranches] = useState<Array<{ id: string; name: string }>>([]);
  const [dbSettings, setDbSettings] = useState<{
    helpdeskName: string;
    companyName: string;
    landingPageMessage: string;
    allowGuestTickets: boolean;
  }>({
    helpdeskName: storeSettings.helpdeskName || "Support Center",
    companyName: storeSettings.helpdeskName || "Support Desk",
    landingPageMessage: "",
    allowGuestTickets: true,
  });

  // Self-Service / Knowledge Wizard State
  const [faqSearchQuery, setFaqSearchQuery] = useState<string>("");
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>("");
  const [filteredFaqs, setFilteredFaqs] = useState<ApiWizardFaq[]>([]);
  const [searchingFaqs, setSearchingFaqs] = useState<boolean>(false);
  const [activeFaqAccordion, setActiveFaqAccordion] = useState<string | null>(null);
  const [problemSolvedMessage, setProblemSolvedMessage] = useState<boolean>(false);

  // Open Ticket Wizard State
  const [ticketTopicId, setTicketTopicId] = useState<string>("");
  const [ticketTopicFaqs, setTicketTopicFaqs] = useState<ApiWizardFaq[]>([]);
  const [ticketRequesterName, setTicketRequesterName] = useState<string>(user?.name || "");
  const [ticketRequesterEmail, setTicketRequesterEmail] = useState<string>(user?.email || "");
  const [ticketRequesterPhone, setTicketRequesterPhone] = useState<string>(user?.phone || "");
  const [ticketBranchId, setTicketBranchId] = useState<string>(user?.branchId || "");
  const [ticketSubject, setTicketSubject] = useState<string>("");
  const [ticketPriority, setTicketPriority] = useState<Priority>("normal");
  const [ticketBody, setTicketBody] = useState<string>("");
  const [ticketFiles, setTicketFiles] = useState<File[]>([]);
  const [submittingTicket, setSubmittingTicket] = useState<boolean>(false);
  const [ticketSubmitError, setTicketSubmitError] = useState<string>("");
  const [createdTicketResult, setCreatedTicketResult] = useState<{ number: string; id: string } | null>(null);

  // Status Lookup Wizard State
  const [statusNumber, setStatusNumber] = useState<string>("");
  const [statusEmail, setStatusEmail] = useState<string>(user?.email || "");
  const [statusSearching, setStatusSearching] = useState<boolean>(false);
  const [statusError, setStatusError] = useState<string>("");
  const [statusResult, setStatusResult] = useState<ApiWizardTicketStatusResult["ticket"] | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Sync user profile when logged in
  useEffect(() => {
    if (user) {
      if (!ticketRequesterName) setTicketRequesterName(user.name);
      if (!ticketRequesterEmail) setTicketRequesterEmail(user.email);
      if (!ticketRequesterPhone && user.phone) setTicketRequesterPhone(user.phone);
      if (!ticketBranchId && user.branchId) setTicketBranchId(user.branchId);
      if (!statusEmail) setStatusEmail(user.email);
    }
  }, [user]);

  // Load wizard metadata from backend (queries Prisma)
  useEffect(() => {
    let active = true;
    setLoadingMeta(true);
    getApiWizardMeta()
      .then((meta) => {
        if (!active) return;
        setDbTopics(meta.topics);
        setDbCategories(meta.categories);
        setDbFeaturedFaqs(meta.featuredFaqs);
        setDbBranches(meta.branches);
        if (meta.settings) {
          setDbSettings(meta.settings);
        }
        setFilteredFaqs(meta.featuredFaqs);
        // Also keep store in sync for seamless routing
        for (const t of meta.topics) {
          upsertRecord("topics", { ...t, active: t.active, priority: t.priority as Priority });
        }
      })
      .catch((err) => {
        console.warn("[Wizard] Backend meta fetch fallback:", err);
      })
      .finally(() => {
        if (active) setLoadingMeta(false);
      });

    return () => {
      active = false;
    };
  }, []);

  // Filter FAQs via Prisma whenever search query or category changes
  useEffect(() => {
    if (currentPath !== "solve") return;
    const timeout = setTimeout(() => {
      setSearchingFaqs(true);
      getApiWizardFaqs({
        query: faqSearchQuery.trim() || undefined,
        categoryId: selectedCategoryId || undefined,
      })
        .then((faqs) => {
          setFilteredFaqs(faqs);
        })
        .catch(() => {
          // Fallback to local filtering
          const query = faqSearchQuery.toLowerCase();
          const local = storeFaqs.filter((f) => {
            const matchesQuery = !query || f.question.toLowerCase().includes(query) || f.answer.toLowerCase().includes(query);
            const matchesCategory = !selectedCategoryId || f.categoryId === selectedCategoryId;
            return matchesQuery && matchesCategory;
          });
          setFilteredFaqs(
            local.map((f) => ({
              id: f.id,
              categoryId: f.categoryId,
              question: f.question,
              answer: f.answer,
              keywords: "",
            }))
          );
        })
        .finally(() => {
          setSearchingFaqs(false);
        });
    }, 200);

    return () => clearTimeout(timeout);
  }, [faqSearchQuery, selectedCategoryId, currentPath, storeFaqs]);

  // When a topic is selected in Ticket Wizard, query Prisma for relevant deflection FAQs
  useEffect(() => {
    if (!ticketTopicId || currentPath !== "ticket") return;
    getApiWizardFaqs({ topicId: ticketTopicId })
      .then((faqs) => {
        setTicketTopicFaqs(faqs);
      })
      .catch(() => {
        setTicketTopicFaqs([]);
      });
  }, [ticketTopicId, currentPath]);

  // Selected topic object
  const selectedTopic = useMemo(() => {
    return dbTopics.find((t) => t.id === ticketTopicId);
  }, [dbTopics, ticketTopicId]);

  // Handler: Select Wizard Pathway
  function choosePath(path: WizardPath) {
    setCurrentPath(path);
    setWizardStep(2);
    setProblemSolvedMessage(false);
    setTicketSubmitError("");
    setStatusError("");
  }

  // Handler: Reset Wizard
  function resetWizard() {
    setCurrentPath("none");
    setWizardStep(1);
    setFaqSearchQuery("");
    setSelectedCategoryId("");
    setActiveFaqAccordion(null);
    setProblemSolvedMessage(false);
    setTicketTopicId("");
    setTicketTopicFaqs([]);
    setTicketSubject("");
    setTicketBody("");
    setTicketFiles([]);
    setCreatedTicketResult(null);
    setStatusNumber("");
    setStatusResult(null);
    setStatusError("");
  }

  // Handler: Step Back
  function goBack() {
    if (wizardStep <= 2) {
      resetWizard();
    } else {
      setWizardStep((s) => s - 1);
    }
  }

  // Handler: Status Check Submit (queries Prisma via backend)
  async function handleCheckStatus(e: FormEvent) {
    e.preventDefault();
    if (!statusNumber.trim() || !statusEmail.trim()) {
      setStatusError("Please provide both ticket number and email.");
      return;
    }
    setStatusSearching(true);
    setStatusError("");
    setStatusResult(null);

    try {
      const response = await checkApiTicketStatus(statusNumber.trim(), statusEmail.trim());
      if (response.found && response.ticket) {
        setStatusResult(response.ticket);
      } else {
        setStatusError(response.message || "No ticket matched this number and email.");
      }
    } catch (err: unknown) {
      // Fallback to legacy status lookup if needed
      try {
        const legacy = await apiLookupTicketByEmail(statusNumber.trim(), statusEmail.trim());
        const hydrated = hydrateSingleApiTicket(legacy.ticket, legacy.messages);
        if (hydrated) {
          setStatusResult({
            id: hydrated.id,
            number: hydrated.number,
            subject: hydrated.subject,
            priority: hydrated.priority,
            status: hydrated.status,
            statusState: hydrated.status === "closed" ? "closed" : "open",
            department: legacy.ticket.department || "Support",
            requesterName: legacy.ticket.requesterName || "Requester",
            requesterEmail: legacy.ticket.requesterEmail || statusEmail,
            createdAt: hydrated.createdAt,
            updatedAt: hydrated.updatedAt,
            lastActivity: hydrated.updatedAt,
            messageCount: legacy.messages?.length || 1,
            lastMessageSnippet: legacy.messages?.[legacy.messages.length - 1]?.body?.slice(0, 100) || "",
            isClosed: hydrated.status === "closed",
          });
        } else {
          setStatusError("Could not retrieve ticket details.");
        }
      } catch {
        setStatusError(err instanceof Error ? err.message : "No ticket found for that number and email.");
      }
    } finally {
      setStatusSearching(false);
    }
  }

  // Handler: Navigate from Status Result directly into Ticket Thread
  async function openFullTicketView() {
    if (!statusResult) return;
    try {
      const legacy = await apiLookupTicketByEmail(statusResult.number, statusResult.requesterEmail);
      const hydrated = hydrateSingleApiTicket(legacy.ticket, legacy.messages);
      if (hydrated) {
        navigate(`/tickets/${hydrated.id}?guest=1&email=${encodeURIComponent(statusResult.requesterEmail)}`);
      } else {
        navigate(`/tickets/${statusResult.id}`);
      }
    } catch {
      navigate(`/status?number=${encodeURIComponent(statusResult.number)}&email=${encodeURIComponent(statusResult.requesterEmail)}`);
    }
  }

  // Handler: Submit Ticket from Wizard (uses Prisma through backend/store)
  async function handleSubmitTicket() {
    if (!user) {
      setTicketSubmitError("Sign in required. Only registered clients or staff members can open tickets.");
      return;
    }
    if (!ticketRequesterName.trim() || !user.email.trim()) {
      setTicketSubmitError("Please provide your name and email address.");
      setWizardStep(4);
      return;
    }
    if (!ticketSubject.trim() || !ticketBody.trim()) {
      setTicketSubmitError("Please fill out the ticket subject and description.");
      setWizardStep(5);
      return;
    }

    setSubmittingTicket(true);
    setTicketSubmitError("");

    try {
      const result = await createTicket({
        userId: user?.id ?? "",
        name: (ticketRequesterName || user.name).trim(),
        email: user.email.trim(),
        phone: ticketRequesterPhone.trim(),
        employeeId: user?.employeeId || "",
        branchId: ticketBranchId || user?.branchId || "",
        topicId: ticketTopicId,
        subject: ticketSubject.trim(),
        body: ticketBody.trim(),
        priority: ticketPriority,
        attachments: ticketFiles,
      });

      setCreatedTicketResult({
        number: result.ticket.number,
        id: result.ticket.id,
      });
      setWizardStep(7);
    } catch (err: unknown) {
      setTicketSubmitError(err instanceof Error ? err.message : "Could not create ticket. Please check the fields.");
    } finally {
      setSubmittingTicket(false);
    }
  }

  // Handle file uploads in wizard
  function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    if (e.target.files) {
      const selected = Array.from(e.target.files);
      setTicketFiles((prev) => [...prev, ...selected].slice(0, 5));
    }
  }

  function removeFile(index: number) {
    setTicketFiles((prev) => prev.filter((_, i) => i !== index));
  }

  // Check offline page setting
  const offlinePage = pages.find((p) => p.type === "offline" && p.active);
  if (offlinePage) {
    return (
      <div className="rounded-3xl border border-line bg-surface p-6 sm:p-10 shadow-sm">
        <div className="flex items-center gap-3 text-amber-600 dark:text-amber-400">
          <svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <h1 className="text-2xl font-bold">{dbSettings.helpdeskName} is currently offline</h1>
        </div>
        <p className="mt-4 text-ink-600 leading-relaxed">{offlinePage.body}</p>
      </div>
    );
  }

  return (
    <div className="space-y-8 text-ink-800">
      {/* Top Banner & Mode Toggle */}
      <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-brand-700 via-brand-600 to-sky-600 p-6 text-white shadow-xl sm:p-10">
        <div className="relative z-10 flex flex-col md:flex-row md:items-center md:justify-between gap-6">
          <div className="max-w-2xl">
            <div className="inline-flex items-center gap-2 rounded-full bg-white/20 px-3 py-1 text-xs font-semibold tracking-wide text-blue-100 backdrop-blur-sm">
              <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
              Interactive Support Assistant
            </div>
            <h1 className="mt-3 text-3xl font-extrabold tracking-tight sm:text-4xl text-white">
              How can we assist you today?
            </h1>
            <p className="mt-2 text-sm sm:text-base text-blue-100/90 leading-relaxed">
              {dbSettings.landingPageMessage ||
                "Follow our interactive step-by-step wizard to resolve questions instantly, open a new ticket, or track existing cases in real-time."}
            </p>
          </div>

          {/* Mode Switcher Pill */}
          <div className="self-start md:self-auto flex items-center gap-2 rounded-2xl bg-white/10 p-1.5 backdrop-blur-md border border-white/20">
            <button
              onClick={() => {
                setViewMode("wizard");
                resetWizard();
              }}
              className={`flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-medium transition ${
                viewMode === "wizard"
                  ? "bg-white text-brand-700 shadow-md font-semibold"
                  : "text-white hover:bg-white/10"
              }`}
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              Guided Wizard
            </button>
            <button
              onClick={() => setViewMode("classic")}
              className={`flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-medium transition ${
                viewMode === "classic"
                  ? "bg-white text-brand-700 shadow-md font-semibold"
                  : "text-white hover:bg-white/10"
              }`}
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
              Quick Overview
            </button>
          </div>
        </div>

        {/* Decorative background glow */}
        <div className="absolute -right-10 -bottom-10 h-64 w-64 rounded-full bg-sky-400/20 blur-3xl pointer-events-none" />
      </section>

      {/* ===================== VIEW MODE: CLASSIC OVERVIEW ===================== */}
      {viewMode === "classic" && (
        <div className="space-y-8 animate-fadeIn">
          {/* Quick Action Tiles */}
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            <NavLink
              to={user ? "/open" : "/login"}
              className="group relative rounded-2xl border border-line bg-surface p-6 shadow-sm transition-all duration-200 hover:-translate-y-1 hover:shadow-md hover:border-brand-500/50"
            >
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-50 text-brand-600 dark:bg-blue-950/60 dark:text-blue-400 group-hover:bg-brand-600 group-hover:text-white transition">
                <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
              </div>
              <h2 className="mt-4 font-semibold text-lg text-ink-800">Open a New Ticket</h2>
              <p className="mt-1 text-sm text-ink-600">
                Submit an inquiry or issue to our technical support staff. Registered clients and staff only.
              </p>
              <span className="mt-4 inline-flex items-center text-xs font-semibold text-brand-600 group-hover:translate-x-1 transition-transform">
                {user ? "Proceed to form &rarr;" : "Sign in to submit &rarr;"}
              </span>
            </NavLink>

            <NavLink
              to="/status"
              className="group relative rounded-2xl border border-line bg-surface p-6 shadow-sm transition-all duration-200 hover:-translate-y-1 hover:shadow-md hover:border-brand-500/50"
            >
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-amber-50 text-amber-600 dark:bg-amber-950/60 dark:text-amber-400 group-hover:bg-amber-600 group-hover:text-white transition">
                <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <h2 className="mt-4 font-semibold text-lg text-ink-800">Check Ticket Status</h2>
              <p className="mt-1 text-sm text-ink-600">
                Look up an existing ticket and check updates using your email and ticket ID number.
              </p>
              <span className="mt-4 inline-flex items-center text-xs font-semibold text-amber-600 group-hover:translate-x-1 transition-transform">
                Look up case &rarr;
              </span>
            </NavLink>

            <NavLink
              to="/kb"
              className="group relative rounded-2xl border border-line bg-surface p-6 shadow-sm transition-all duration-200 hover:-translate-y-1 hover:shadow-md hover:border-brand-500/50 sm:col-span-2 lg:col-span-1"
            >
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-purple-50 text-purple-600 dark:bg-purple-950/60 dark:text-purple-400 group-hover:bg-purple-600 group-hover:text-white transition">
                <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                </svg>
              </div>
              <h2 className="mt-4 font-semibold text-lg text-ink-800">Knowledge Base</h2>
              <p className="mt-1 text-sm text-ink-600">
                Explore popular solutions and step-by-step guides before writing to our staff.
              </p>
              <span className="mt-4 inline-flex items-center text-xs font-semibold text-purple-600 group-hover:translate-x-1 transition-transform">
                Browse articles &rarr;
              </span>
            </NavLink>
          </div>

          {/* Popular FAQs Section */}
          <section className="rounded-3xl border border-line bg-surface p-6 shadow-sm">
            <div className="mb-5 flex items-center justify-between">
              <div>
                <h2 className="text-xl font-bold text-ink-800">Frequently Asked Questions</h2>
                <p className="text-xs text-ink-600 mt-0.5">Top solutions curated directly from our knowledge database</p>
              </div>
              <NavLink to="/kb" className="text-sm font-semibold text-brand-600 hover:text-brand-700">
                View all articles &rarr;
              </NavLink>
            </div>
            <div className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-paper/50">
              {dbFeaturedFaqs.slice(0, 5).map((faq) => (
                <NavLink
                  key={faq.id}
                  to={`/kb/${faq.id}`}
                  className="block p-4 sm:p-5 transition hover:bg-surface"
                >
                  <p className="font-semibold text-ink-800 flex items-center gap-2">
                    <span className="text-brand-500 font-bold">Q:</span> {faq.question}
                  </p>
                  <p className="mt-1 line-clamp-2 text-sm text-ink-600">{faq.answer}</p>
                </NavLink>
              ))}
            </div>
          </section>
        </div>
      )}

      {/* ===================== VIEW MODE: GUIDED INTERACTIVE WIZARD ===================== */}
      {viewMode === "wizard" && (
        <div className="space-y-6">
          {/* Wizard Navigation Progress Card */}
          <div className="rounded-3xl border border-line bg-surface p-5 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                {currentPath !== "none" && (
                  <button
                    onClick={goBack}
                    className="flex h-9 w-9 items-center justify-center rounded-xl border border-line bg-paper text-ink-800 hover:bg-surface transition shadow-sm"
                    title="Go to previous step"
                  >
                    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                    </svg>
                  </button>
                )}
                <div>
                  <div className="flex items-center gap-2">
                    <span className="rounded-md bg-brand-50 text-brand-700 dark:bg-brand-900/50 dark:text-blue-300 px-2 py-0.5 text-xs font-bold uppercase">
                      Step {wizardStep}
                    </span>
                    <h2 className="text-lg font-bold text-ink-800">
                      {currentPath === "none" && "Choose an Assistance Pathway"}
                      {currentPath === "solve" && wizardStep === 2 && "Select a Problem Domain or Search Articles"}
                      {currentPath === "solve" && wizardStep === 3 && "Review Recommended Solution"}
                      {currentPath === "ticket" && wizardStep === 2 && "Choose Help Topic"}
                      {currentPath === "ticket" && wizardStep === 3 && "Instant Solution Check"}
                      {currentPath === "ticket" && wizardStep === 4 && "Your Contact Information"}
                      {currentPath === "ticket" && wizardStep === 5 && "Describe the Issue"}
                      {currentPath === "ticket" && wizardStep === 6 && "Review & Confirm Submission"}
                      {currentPath === "ticket" && wizardStep === 7 && "Ticket Created Successfully"}
                      {currentPath === "status" && wizardStep === 2 && "Ticket Status Lookup"}
                      {currentPath === "status" && wizardStep === 3 && "Live Case Tracker"}
                      {currentPath === "contact" && "Support Contact & Service Hours"}
                    </h2>
                  </div>
                  <p className="text-xs text-ink-600 mt-0.5">
                    {currentPath === "none" && "Select what you would like to do and the wizard will guide you through."}
                    {currentPath === "solve" && "Directly queried from the knowledge base using live database indices."}
                    {currentPath === "ticket" && "Step-by-step guided ticket creation with smart solution suggestions."}
                    {currentPath === "status" && "Verify ticket state, assignees, and latest updates in real-time."}
                    {currentPath === "contact" && "Access official support channels and operating schedules."}
                  </p>
                </div>
              </div>

              {currentPath !== "none" && (
                <button
                  onClick={resetWizard}
                  className="rounded-xl border border-line bg-paper px-3 py-1.5 text-xs font-medium text-ink-600 hover:text-ink-800 hover:bg-surface transition"
                >
                  Restart Wizard
                </button>
              )}
            </div>

            {/* Stepper Progress Bar */}
            {currentPath !== "none" && (
              <div className="mt-4 pt-4 border-t border-line">
                <div className="flex items-center gap-2">
                  <div className={`h-2 rounded-full transition-all duration-300 ${wizardStep >= 1 ? "bg-brand-600 flex-1" : "bg-line w-8"}`} />
                  <div className={`h-2 rounded-full transition-all duration-300 ${wizardStep >= 2 ? "bg-brand-600 flex-1" : "bg-line w-8"}`} />
                  <div className={`h-2 rounded-full transition-all duration-300 ${wizardStep >= 3 ? "bg-brand-600 flex-1" : "bg-line w-8"}`} />
                  {currentPath === "ticket" && (
                    <>
                      <div className={`h-2 rounded-full transition-all duration-300 ${wizardStep >= 4 ? "bg-brand-600 flex-1" : "bg-line w-8"}`} />
                      <div className={`h-2 rounded-full transition-all duration-300 ${wizardStep >= 5 ? "bg-brand-600 flex-1" : "bg-line w-8"}`} />
                      <div className={`h-2 rounded-full transition-all duration-300 ${wizardStep >= 6 ? "bg-brand-600 flex-1" : "bg-line w-8"}`} />
                      <div className={`h-2 rounded-full transition-all duration-300 ${wizardStep >= 7 ? "bg-emerald-500 flex-1" : "bg-line w-8"}`} />
                    </>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* ===================== STEP 1: PATH SELECTION ===================== */}
          {currentPath === "none" && (
            <div className="grid gap-5 md:grid-cols-2">
              {/* Option 1: Knowledge Self-Service */}
              <button
                onClick={() => choosePath("solve")}
                className="group relative flex flex-col items-start rounded-3xl border-2 border-line bg-surface p-6 sm:p-8 text-left shadow-sm transition-all duration-200 hover:-translate-y-1 hover:border-brand-500 hover:shadow-lg"
              >
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-sky-50 text-brand-600 dark:bg-sky-950/70 dark:text-sky-400 group-hover:scale-110 group-hover:bg-brand-600 group-hover:text-white transition">
                  <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                  </svg>
                </div>
                <div className="mt-5">
                  <span className="rounded-full bg-sky-100 text-sky-800 dark:bg-sky-900/60 dark:text-sky-300 px-2.5 py-1 text-xs font-semibold">
                    Instant Self-Service
                  </span>
                  <h3 className="mt-2 text-xl font-bold text-ink-800">Solve an Issue Myself</h3>
                  <p className="mt-1.5 text-sm text-ink-600 leading-relaxed">
                    Search interactive articles, tutorials, and verified answers from our PostgreSQL knowledge base.
                  </p>
                </div>
                <div className="mt-6 flex items-center text-sm font-semibold text-brand-600 group-hover:translate-x-1 transition-transform">
                  Launch knowledge finder &rarr;
                </div>
              </button>

              {/* Option 2: Open Ticket */}
              <button
                onClick={() => choosePath("ticket")}
                className="group relative flex flex-col items-start rounded-3xl border-2 border-line bg-surface p-6 sm:p-8 text-left shadow-sm transition-all duration-200 hover:-translate-y-1 hover:border-brand-500 hover:shadow-lg"
              >
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-50 text-blue-600 dark:bg-blue-950/70 dark:text-blue-400 group-hover:scale-110 group-hover:bg-blue-600 group-hover:text-white transition">
                  <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 5v2m0 4v2m0 4v2M5 5a2 2 0 00-2 2v3a2 2 0 110 4v3a2 2 0 002 2h14a2 2 0 002-2v-3a2 2 0 110-4V7a2 2 0 00-2-2H5z" />
                  </svg>
                </div>
                <div className="mt-5">
                  <span className="rounded-full bg-blue-100 text-blue-800 dark:bg-blue-900/60 dark:text-blue-300 px-2.5 py-1 text-xs font-semibold">
                    Step-by-Step Ticket Form
                  </span>
                  <h3 className="mt-2 text-xl font-bold text-ink-800">Open a Support Ticket</h3>
                  <p className="mt-1.5 text-sm text-ink-600 leading-relaxed">
                    Our wizard guides you through selecting topics, pre-checking answers, and submitting your details.
                  </p>
                </div>
                <div className="mt-6 flex items-center text-sm font-semibold text-brand-600 group-hover:translate-x-1 transition-transform">
                  Start ticket wizard &rarr;
                </div>
              </button>

              {/* Option 3: Check Status */}
              <button
                onClick={() => choosePath("status")}
                className="group relative flex flex-col items-start rounded-3xl border-2 border-line bg-surface p-6 sm:p-8 text-left shadow-sm transition-all duration-200 hover:-translate-y-1 hover:border-brand-500 hover:shadow-lg"
              >
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-50 text-amber-600 dark:bg-amber-950/70 dark:text-amber-400 group-hover:scale-110 group-hover:bg-amber-600 group-hover:text-white transition">
                  <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                  </svg>
                </div>
                <div className="mt-5">
                  <span className="rounded-full bg-amber-100 text-amber-800 dark:bg-amber-900/60 dark:text-amber-300 px-2.5 py-1 text-xs font-semibold">
                    Live Case Tracking
                  </span>
                  <h3 className="mt-2 text-xl font-bold text-ink-800">Check Existing Ticket Status</h3>
                  <p className="mt-1.5 text-sm text-ink-600 leading-relaxed">
                    Enter your ticket number and email to immediately inspect status, assigned department, and progress.
                  </p>
                </div>
                <div className="mt-6 flex items-center text-sm font-semibold text-amber-600 group-hover:translate-x-1 transition-transform">
                  Check ticket now &rarr;
                </div>
              </button>

              {/* Option 4: Helpdesk Information & Hours */}
              <button
                onClick={() => choosePath("contact")}
                className="group relative flex flex-col items-start rounded-3xl border-2 border-line bg-surface p-6 sm:p-8 text-left shadow-sm transition-all duration-200 hover:-translate-y-1 hover:border-brand-500 hover:shadow-lg"
              >
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600 dark:bg-emerald-950/70 dark:text-emerald-400 group-hover:scale-110 group-hover:bg-emerald-600 group-hover:text-white transition">
                  <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                  </svg>
                </div>
                <div className="mt-5">
                  <span className="rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-300 px-2.5 py-1 text-xs font-semibold">
                    Direct Assistance
                  </span>
                  <h3 className="mt-2 text-xl font-bold text-ink-800">Contact Channels & Hours</h3>
                  <p className="mt-1.5 text-sm text-ink-600 leading-relaxed">
                    View official support branches, department directories, and operating hours.
                  </p>
                </div>
                <div className="mt-6 flex items-center text-sm font-semibold text-emerald-600 group-hover:translate-x-1 transition-transform">
                  View support directory &rarr;
                </div>
              </button>
            </div>
          )}

          {/* ===================== PATH: SELF-SERVICE / KNOWLEDGE BASE ===================== */}
          {currentPath === "solve" && (
            <div className="space-y-6 animate-fadeIn">
              {/* Search Bar & Category Filter */}
              <div className="rounded-3xl border border-line bg-surface p-6 shadow-sm">
                <label className="block text-sm font-bold text-ink-800 mb-2">
                  Search the Knowledge Base directly:
                </label>
                <div className="relative">
                  <span className="absolute inset-y-0 left-0 flex items-center pl-3.5 pointer-events-none text-ink-400">
                    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                  </span>
                  <input
                    type="text"
                    value={faqSearchQuery}
                    onChange={(e) => setFaqSearchQuery(e.target.value)}
                    placeholder="Type keywords, e.g. 'password', 'billing', 'email', 'refund'..."
                    className={inputClass + " pl-11 py-3 text-base"}
                  />
                  {faqSearchQuery && (
                    <button
                      onClick={() => setFaqSearchQuery("")}
                      className="absolute inset-y-0 right-0 flex items-center pr-3.5 text-ink-400 hover:text-ink-600"
                    >
                      Clear
                    </button>
                  )}
                </div>

                {/* Category Pills */}
                {dbCategories.length > 0 && (
                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    <span className="text-xs font-semibold text-ink-600">Categories:</span>
                    <button
                      onClick={() => setSelectedCategoryId("")}
                      className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
                        !selectedCategoryId
                          ? "bg-brand-600 text-white shadow-sm"
                          : "bg-paper text-ink-600 hover:bg-line"
                      }`}
                    >
                      All Articles ({dbCategories.reduce((acc, c) => acc + c.articleCount, 0)})
                    </button>
                    {dbCategories.map((c) => (
                      <button
                        key={c.id}
                        onClick={() => setSelectedCategoryId(c.id === selectedCategoryId ? "" : c.id)}
                        className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
                          selectedCategoryId === c.id
                            ? "bg-brand-600 text-white shadow-sm"
                            : "bg-paper text-ink-600 hover:bg-line"
                        }`}
                      >
                        {c.name} ({c.articleCount})
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Resolved Celebration Banner */}
              {problemSolvedMessage && (
                <div className="rounded-3xl border-2 border-emerald-500 bg-emerald-50 dark:bg-emerald-950/40 p-6 sm:p-8 text-center animate-scaleUp">
                  <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500 text-white shadow-lg">
                    <svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                  <h3 className="mt-4 text-2xl font-bold text-emerald-900 dark:text-emerald-200">
                    Awesome! We are glad that resolved your issue!
                  </h3>
                  <p className="mt-1 text-sm text-emerald-700 dark:text-emerald-300 max-w-md mx-auto">
                    You saved time by solving it without waiting for an agent. Thank you for using our self-service portal!
                  </p>
                  <div className="mt-6 flex flex-wrap justify-center gap-3">
                    <button
                      onClick={resetWizard}
                      className="rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-bold text-white shadow hover:bg-emerald-700 transition"
                    >
                      Done / Back to Home
                    </button>
                    <button
                      onClick={() => setProblemSolvedMessage(false)}
                      className="rounded-xl border border-emerald-300 dark:border-emerald-700 bg-white dark:bg-surface px-5 py-2.5 text-sm font-semibold text-emerald-800 dark:text-emerald-200"
                    >
                      Browse more answers
                    </button>
                  </div>
                </div>
              )}

              {/* FAQ Results Accordion */}
              {!problemSolvedMessage && (
                <div className="rounded-3xl border border-line bg-surface p-6 shadow-sm space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-base font-bold text-ink-800">
                      {searchingFaqs
                        ? "Searching database..."
                        : `Found ${filteredFaqs.length} solution${filteredFaqs.length === 1 ? "" : "s"}:`}
                    </h3>
                    <NavLink to="/kb" className="text-xs font-semibold text-brand-600 hover:text-brand-700">
                      Open in Full Knowledge Base &rarr;
                    </NavLink>
                  </div>

                  {filteredFaqs.length === 0 && !searchingFaqs && (
                    <div className="py-8 text-center">
                      <p className="text-sm text-ink-600">No knowledge base articles matched your query.</p>
                      <button
                        onClick={() => choosePath("ticket")}
                        className="mt-4 inline-flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-brand-700"
                      >
                        Submit this as a Ticket instead &rarr;
                      </button>
                    </div>
                  )}

                  <div className="space-y-3">
                    {filteredFaqs.map((faq) => {
                      const isOpen = activeFaqAccordion === faq.id;
                      return (
                        <div
                          key={faq.id}
                          className={`rounded-2xl border transition-all ${
                            isOpen ? "border-brand-500 bg-paper/60 shadow-sm" : "border-line bg-paper/30 hover:border-brand-300"
                          }`}
                        >
                          <button
                            onClick={() => setActiveFaqAccordion(isOpen ? null : faq.id)}
                            className="flex w-full items-center justify-between p-4 text-left font-semibold text-ink-800"
                          >
                            <span className="flex items-center gap-3">
                              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-brand-100 text-brand-700 dark:bg-brand-900/60 dark:text-blue-300 text-xs font-bold">
                                FAQ
                              </span>
                              <span>{faq.question}</span>
                            </span>
                            <svg
                              className={`h-5 w-5 text-ink-400 transition-transform ${isOpen ? "rotate-180 text-brand-600" : ""}`}
                              fill="none"
                              viewBox="0 0 24 24"
                              stroke="currentColor"
                            >
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                            </svg>
                          </button>

                          {isOpen && (
                            <div className="border-t border-line px-5 py-4 animate-fadeIn">
                              <div className="prose prose-sm max-w-none text-ink-800 leading-relaxed whitespace-pre-line">
                                {faq.answer}
                              </div>

                              {/* Interactive Resolution Question */}
                              <div className="mt-5 pt-4 border-t border-line flex flex-wrap items-center justify-between gap-3 bg-surface/70 -mx-5 -mb-4 p-4 rounded-b-2xl">
                                <span className="text-xs font-semibold text-ink-600">
                                  Did this solution resolve your issue?
                                </span>
                                <div className="flex items-center gap-2">
                                  <button
                                    onClick={() => setProblemSolvedMessage(true)}
                                    className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-700 transition"
                                  >
                                    👍 Yes, solved!
                                  </button>
                                  <button
                                    onClick={() => {
                                      setTicketSubject(`Inquiry: ${faq.question}`);
                                      choosePath("ticket");
                                    }}
                                    className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-medium text-ink-800 hover:bg-paper transition"
                                  >
                                    👎 Still need help (Open ticket)
                                  </button>
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ===================== PATH: OPEN TICKET WIZARD ===================== */}
          {currentPath === "ticket" && !user && (
            <div className="rounded-3xl border border-line bg-surface p-6 sm:p-10 shadow-sm space-y-6 text-center animate-fadeIn">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-amber-50 text-amber-600 dark:bg-amber-950/70 dark:text-amber-400">
                <svg className="h-9 w-9" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
              </div>

              <div className="max-w-md mx-auto">
                <span className="rounded-full bg-amber-100 text-amber-800 dark:bg-amber-900/60 dark:text-amber-300 px-3 py-1 text-xs font-bold uppercase tracking-wider">
                  Sign In Required
                </span>
                <h3 className="mt-3 text-2xl font-extrabold text-ink-800">Authentication Needed to Open a Ticket</h3>
                <p className="mt-2 text-sm text-ink-600 leading-relaxed">
                  Only registered clients or active staff members can open support tickets. Please sign in to submit your case.
                </p>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 max-w-lg mx-auto pt-2">
                <NavLink
                  to="/login"
                  className="flex items-center justify-center gap-2 rounded-xl bg-brand-600 px-5 py-3 text-sm font-bold text-white shadow hover:bg-brand-700 transition"
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1" />
                  </svg>
                  Sign In as Client
                </NavLink>

                <NavLink
                  to="/register"
                  className="flex items-center justify-center gap-2 rounded-xl border border-line bg-paper px-5 py-3 text-sm font-semibold text-ink-800 hover:bg-surface transition"
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
                  </svg>
                  Register New Account
                </NavLink>

                <NavLink
                  to="/scp/login"
                  className="sm:col-span-2 flex items-center justify-center gap-2 rounded-xl border border-dashed border-line py-2.5 text-xs font-semibold text-ink-600 hover:text-brand-600 hover:border-brand-400 transition"
                >
                  Staff & Agent Portal Login &rarr;
                </NavLink>
              </div>

              <div className="border-t border-line pt-4 text-xs text-ink-500 max-w-md mx-auto">
                Need immediate help without an account? You can{" "}
                <button
                  onClick={() => choosePath("solve")}
                  className="text-brand-600 font-semibold underline hover:text-brand-700"
                >
                  search the knowledge base
                </button>{" "}
                or{" "}
                <button
                  onClick={() => choosePath("status")}
                  className="text-brand-600 font-semibold underline hover:text-brand-700"
                >
                  check existing ticket status
                </button>
                .
              </div>
            </div>
          )}

          {/* ===================== PATH: OPEN TICKET WIZARD (SIGNED IN) ===================== */}
          {currentPath === "ticket" && user && (
            <div className="space-y-6 animate-fadeIn">
              {/* STEP 2: Choose Topic */}
              {wizardStep === 2 && (
                <div className="rounded-3xl border border-line bg-surface p-6 shadow-sm space-y-4">
                  <div>
                    <h3 className="text-lg font-bold text-ink-800">Choose a Help Topic</h3>
                    <p className="text-xs text-ink-600 mt-0.5">
                      Select the category that best matches your request. This routes your ticket to the right department.
                    </p>
                  </div>

                  {loadingMeta && (
                    <div className="py-8 text-center text-sm text-ink-600">Loading topics from database...</div>
                  )}

                  <div className="grid gap-3 sm:grid-cols-2">
                    {dbTopics.map((topic) => {
                      const isSelected = ticketTopicId === topic.id;
                      return (
                        <button
                          key={topic.id}
                          onClick={() => {
                            setTicketTopicId(topic.id);
                            setTicketPriority(topic.priority as Priority);
                          }}
                          className={`flex flex-col items-start rounded-2xl border-2 p-4 text-left transition-all ${
                            isSelected
                              ? "border-brand-600 bg-brand-50/50 dark:bg-brand-950/40 shadow-sm"
                              : "border-line bg-paper/40 hover:border-brand-300 hover:bg-surface"
                          }`}
                        >
                          <div className="flex w-full items-center justify-between">
                            <span className="font-semibold text-ink-800">{topic.name}</span>
                            <span className="rounded-md bg-blue-100 text-blue-800 dark:bg-blue-900/60 dark:text-blue-300 px-2 py-0.5 text-[11px] font-semibold">
                              {topic.departmentName}
                            </span>
                          </div>
                          {topic.hint && (
                            <p className="mt-1 text-xs text-ink-600 line-clamp-2">{topic.hint}</p>
                          )}
                          <div className="mt-3 flex items-center gap-2 text-[11px] text-ink-400">
                            <span>Priority: <strong className="text-ink-600 capitalize">{topic.priority}</strong></span>
                          </div>
                        </button>
                      );
                    })}
                  </div>

                  <div className="pt-4 border-t border-line flex justify-end">
                    <button
                      disabled={!ticketTopicId}
                      onClick={() => setWizardStep(3)}
                      className="rounded-xl bg-brand-600 px-6 py-2.5 font-bold text-white shadow disabled:opacity-50 hover:bg-brand-700 transition"
                    >
                      Continue &rarr;
                    </button>
                  </div>
                </div>
              )}

              {/* STEP 3: Smart Deflection / Instant FAQ Check */}
              {wizardStep === 3 && (
                <div className="rounded-3xl border border-line bg-surface p-6 shadow-sm space-y-6">
                  <div>
                    <div className="inline-flex items-center gap-2 rounded-full bg-amber-50 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300 px-3 py-1 text-xs font-bold">
                      💡 Wait! Does this answer your question?
                    </div>
                    <h3 className="mt-2 text-xl font-bold text-ink-800">
                      Recommended Solutions for &ldquo;{selectedTopic?.name}&rdquo;
                    </h3>
                    <p className="text-xs text-ink-600 mt-1">
                      Our knowledge base found relevant articles for this topic. You might get your answer immediately without waiting for an agent!
                    </p>
                  </div>

                  {ticketTopicFaqs.length > 0 ? (
                    <div className="space-y-3">
                      {ticketTopicFaqs.map((faq) => (
                        <div key={faq.id} className="rounded-2xl border border-line bg-paper/40 p-4">
                          <h4 className="font-semibold text-ink-800">{faq.question}</h4>
                          <p className="mt-1 text-xs text-ink-600 line-clamp-3 leading-relaxed">{faq.answer}</p>
                          <div className="mt-3 flex items-center justify-between">
                            <NavLink
                              to={`/kb/${faq.id}`}
                              target="_blank"
                              className="text-xs font-semibold text-brand-600 hover:underline"
                            >
                              Read full article &rarr;
                            </NavLink>
                            <button
                              onClick={() => {
                                setProblemSolvedMessage(true);
                                setCurrentPath("solve");
                              }}
                              className="rounded-lg bg-emerald-600 px-3 py-1 text-xs font-bold text-white hover:bg-emerald-700"
                            >
                              This solved it!
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-2xl border border-dashed border-line bg-paper/30 p-6 text-center">
                      <p className="text-sm text-ink-600">
                        No instant deflection articles required for this topic. Proceed directly to fill in your case details.
                      </p>
                    </div>
                  )}

                  <div className="pt-4 border-t border-line flex items-center justify-between">
                    <button
                      onClick={() => setWizardStep(2)}
                      className="rounded-xl border border-line px-4 py-2 text-sm font-semibold text-ink-600 hover:bg-paper"
                    >
                      &larr; Change Topic
                    </button>
                    <button
                      onClick={() => setWizardStep(4)}
                      className="rounded-xl bg-brand-600 px-6 py-2.5 font-bold text-white shadow hover:bg-brand-700 transition"
                    >
                      {ticketTopicFaqs.length > 0 ? "I still need to submit a ticket &rarr;" : "Proceed to details &rarr;"}
                    </button>
                  </div>
                </div>
              )}

              {/* STEP 4: Requester Contact Information */}
              {wizardStep === 4 && (
                <div className="rounded-3xl border border-line bg-surface p-6 shadow-sm space-y-6">
                  <div>
                    <h3 className="text-lg font-bold text-ink-800">Your Contact Information</h3>
                    <p className="text-xs text-ink-600 mt-0.5">
                      Where should our team send updates and resolution notices?
                    </p>
                  </div>

                  {user && (
                    <div className="flex items-center gap-3 rounded-2xl bg-blue-50 dark:bg-blue-950/40 p-4 border border-blue-200 dark:border-blue-900">
                      <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-600 text-white font-bold">
                        {user.name.slice(0, 1).toUpperCase()}
                      </span>
                      <div>
                        <p className="text-xs font-bold uppercase text-brand-700 dark:text-blue-300">Signed In Account</p>
                        <p className="font-semibold text-sm text-ink-800">{user.name} ({user.email})</p>
                      </div>
                    </div>
                  )}

                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <label className="block text-xs font-bold uppercase tracking-wider text-ink-600 mb-1">
                        Full Name *
                      </label>
                      <input
                        required
                        type="text"
                        value={ticketRequesterName}
                        onChange={(e) => setTicketRequesterName(e.target.value)}
                        placeholder="John Doe"
                        className={inputClass}
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-bold uppercase tracking-wider text-ink-600 mb-1">
                        Email Address (Verified Account) *
                      </label>
                      <input
                        readOnly
                        disabled
                        type="email"
                        value={ticketRequesterEmail || user?.email || ""}
                        className={inputClass + " opacity-75 cursor-not-allowed bg-slate-100 dark:bg-slate-800"}
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-bold uppercase tracking-wider text-ink-600 mb-1">
                        Phone Number (Optional)
                      </label>
                      <input
                        type="tel"
                        value={ticketRequesterPhone}
                        onChange={(e) => setTicketRequesterPhone(e.target.value)}
                        placeholder="+1 555-0199"
                        className={inputClass}
                      />
                    </div>

                    {dbBranches.length > 0 && (
                      <div>
                        <label className="block text-xs font-bold uppercase tracking-wider text-ink-600 mb-1">
                          Branch / Location
                        </label>
                        <select
                          value={ticketBranchId}
                          onChange={(e) => setTicketBranchId(e.target.value)}
                          className={inputClass}
                        >
                          <option value="">Select branch...</option>
                          {dbBranches.map((b) => (
                            <option key={b.id} value={b.id}>
                              {b.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>

                  <div className="pt-4 border-t border-line flex items-center justify-between">
                    <button
                      onClick={() => setWizardStep(3)}
                      className="rounded-xl border border-line px-4 py-2 text-sm font-semibold text-ink-600 hover:bg-paper"
                    >
                      &larr; Back
                    </button>
                    <button
                      disabled={!ticketRequesterName.trim() || !ticketRequesterEmail.trim()}
                      onClick={() => setWizardStep(5)}
                      className="rounded-xl bg-brand-600 px-6 py-2.5 font-bold text-white shadow disabled:opacity-50 hover:bg-brand-700 transition"
                    >
                      Next: Issue Details &rarr;
                    </button>
                  </div>
                </div>
              )}

              {/* STEP 5: Issue Details */}
              {wizardStep === 5 && (
                <div className="rounded-3xl border border-line bg-surface p-6 shadow-sm space-y-6">
                  <div>
                    <h3 className="text-lg font-bold text-ink-800">Describe Your Issue</h3>
                    <p className="text-xs text-ink-600 mt-0.5">
                      Provide as much detail as possible to help us diagnose and resolve your case quickly.
                    </p>
                  </div>

                  <div className="space-y-4">
                    <div>
                      <label className="block text-xs font-bold uppercase tracking-wider text-ink-600 mb-1">
                        Subject / Brief Summary *
                      </label>
                      <input
                        required
                        type="text"
                        value={ticketSubject}
                        onChange={(e) => setTicketSubject(e.target.value)}
                        placeholder="e.g. Cannot access portal after password reset"
                        className={inputClass}
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-bold uppercase tracking-wider text-ink-600 mb-1">
                        Urgency / Priority
                      </label>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        {(["low", "normal", "high", "emergency"] as Priority[]).map((pri) => (
                          <button
                            type="button"
                            key={pri}
                            onClick={() => setTicketPriority(pri)}
                            className={`rounded-xl border py-2 px-3 text-xs font-bold capitalize transition ${
                              ticketPriority === pri
                                ? pri === "emergency"
                                  ? "border-rose-600 bg-rose-50 text-rose-800 dark:bg-rose-950/60 dark:text-rose-200"
                                  : pri === "high"
                                  ? "border-amber-600 bg-amber-50 text-amber-800 dark:bg-amber-950/60 dark:text-amber-200"
                                  : "border-brand-600 bg-brand-50 text-brand-700 dark:bg-brand-950/60 dark:text-blue-300"
                                : "border-line bg-paper/40 text-ink-600 hover:bg-surface"
                            }`}
                          >
                            {pri}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-bold uppercase tracking-wider text-ink-600 mb-1">
                        Detailed Description *
                      </label>
                      <textarea
                        required
                        rows={5}
                        value={ticketBody}
                        onChange={(e) => setTicketBody(e.target.value)}
                        placeholder="Explain the problem, steps to reproduce, or any error messages received..."
                        className={inputClass + " leading-relaxed"}
                      />
                    </div>

                    {/* File Attachment Dropzone */}
                    <div>
                      <label className="block text-xs font-bold uppercase tracking-wider text-ink-600 mb-1">
                        Attachments (Screenshots, Logs, Documents)
                      </label>
                      <div className="rounded-2xl border-2 border-dashed border-line p-4 text-center hover:border-brand-400 transition bg-paper/20">
                        <input
                          ref={fileInputRef}
                          type="file"
                          multiple
                          onChange={handleFileChange}
                          className="hidden"
                        />
                        <button
                          type="button"
                          onClick={() => fileInputRef.current?.click()}
                          className="inline-flex items-center gap-2 text-xs font-bold text-brand-600 hover:text-brand-700"
                        >
                          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                          </svg>
                          Select files to upload (max 5)
                        </button>
                        <p className="mt-1 text-[11px] text-ink-400">PDF, PNG, JPG, DOCX, TXT up to 8MB each</p>

                        {ticketFiles.length > 0 && (
                          <div className="mt-3 flex flex-wrap gap-2 justify-center">
                            {ticketFiles.map((file, i) => (
                              <span
                                key={i}
                                className="inline-flex items-center gap-1.5 rounded-lg bg-surface border border-line px-2.5 py-1 text-xs text-ink-800"
                              >
                                📄 {file.name} ({(file.size / 1024).toFixed(0)} KB)
                                <button
                                  type="button"
                                  onClick={() => removeFile(i)}
                                  className="text-rose-500 hover:text-rose-700 font-bold ml-1"
                                >
                                  &times;
                                </button>
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="pt-4 border-t border-line flex items-center justify-between">
                    <button
                      onClick={() => setWizardStep(4)}
                      className="rounded-xl border border-line px-4 py-2 text-sm font-semibold text-ink-600 hover:bg-paper"
                    >
                      &larr; Back
                    </button>
                    <button
                      disabled={!ticketSubject.trim() || !ticketBody.trim()}
                      onClick={() => setWizardStep(6)}
                      className="rounded-xl bg-brand-600 px-6 py-2.5 font-bold text-white shadow disabled:opacity-50 hover:bg-brand-700 transition"
                    >
                      Review Summary &rarr;
                    </button>
                  </div>
                </div>
              )}

              {/* STEP 6: Review & Confirm */}
              {wizardStep === 6 && (
                <div className="rounded-3xl border border-line bg-surface p-6 shadow-sm space-y-6">
                  <div>
                    <h3 className="text-xl font-bold text-ink-800">Review & Confirm Submission</h3>
                    <p className="text-xs text-ink-600 mt-0.5">
                      Please double-check your information before submitting to our support queue.
                    </p>
                  </div>

                  {ticketSubmitError && (
                    <div className="rounded-xl bg-rose-50 dark:bg-rose-950/50 p-4 border border-rose-200 dark:border-rose-900 text-sm text-rose-800 dark:text-rose-200">
                      {ticketSubmitError}
                    </div>
                  )}

                  <div className="rounded-2xl border border-line bg-paper/40 divide-y divide-line overflow-hidden">
                    <div className="p-4 grid grid-cols-3 gap-2">
                      <span className="text-xs font-semibold text-ink-600 uppercase">Topic & Dept</span>
                      <span className="col-span-2 text-sm font-bold text-ink-800">
                        {selectedTopic?.name} &bull; <span className="text-brand-600 font-semibold">{selectedTopic?.departmentName}</span>
                      </span>
                    </div>

                    <div className="p-4 grid grid-cols-3 gap-2">
                      <span className="text-xs font-semibold text-ink-600 uppercase">Requester</span>
                      <span className="col-span-2 text-sm text-ink-800">
                        <strong>{ticketRequesterName}</strong> &lt;{ticketRequesterEmail}&gt; {ticketRequesterPhone && `(${ticketRequesterPhone})`}
                      </span>
                    </div>

                    <div className="p-4 grid grid-cols-3 gap-2">
                      <span className="text-xs font-semibold text-ink-600 uppercase">Priority</span>
                      <span className="col-span-2 text-sm capitalize font-bold text-ink-800">
                        {ticketPriority}
                      </span>
                    </div>

                    <div className="p-4 grid grid-cols-3 gap-2">
                      <span className="text-xs font-semibold text-ink-600 uppercase">Subject</span>
                      <span className="col-span-2 text-sm font-semibold text-ink-800">
                        {ticketSubject}
                      </span>
                    </div>

                    <div className="p-4 grid grid-cols-3 gap-2">
                      <span className="text-xs font-semibold text-ink-600 uppercase">Description</span>
                      <div className="col-span-2 text-xs text-ink-800 whitespace-pre-line leading-relaxed max-h-40 overflow-y-auto">
                        {ticketBody}
                      </div>
                    </div>

                    {ticketFiles.length > 0 && (
                      <div className="p-4 grid grid-cols-3 gap-2">
                        <span className="text-xs font-semibold text-ink-600 uppercase">Attachments</span>
                        <span className="col-span-2 text-xs text-ink-800">
                          {ticketFiles.map((f) => f.name).join(", ")}
                        </span>
                      </div>
                    )}
                  </div>

                  <div className="pt-4 border-t border-line flex items-center justify-between">
                    <button
                      disabled={submittingTicket}
                      onClick={() => setWizardStep(5)}
                      className="rounded-xl border border-line px-4 py-2 text-sm font-semibold text-ink-600 hover:bg-paper"
                    >
                      &larr; Edit Details
                    </button>
                    <button
                      disabled={submittingTicket}
                      onClick={handleSubmitTicket}
                      className="rounded-xl bg-brand-600 px-8 py-3 font-bold text-white shadow-lg hover:bg-brand-700 disabled:opacity-50 transition flex items-center gap-2"
                    >
                      {submittingTicket ? (
                        <>
                          <svg className="animate-spin h-4 w-4 text-white" viewBox="0 0 24 24" fill="none">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                          </svg>
                          Submitting Ticket to Database...
                        </>
                      ) : (
                        "Submit Ticket Now 🚀"
                      )}
                    </button>
                  </div>
                </div>
              )}

              {/* STEP 7: Created Ticket Result */}
              {wizardStep === 7 && createdTicketResult && (
                <div className="rounded-3xl border-2 border-emerald-500 bg-surface p-8 text-center animate-scaleUp shadow-xl space-y-6">
                  <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500 text-white shadow-lg">
                    <svg className="h-10 w-10" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                    </svg>
                  </div>

                  <div>
                    <h3 className="text-2xl font-extrabold text-ink-800">
                      Ticket Successfully Created!
                    </h3>
                    <p className="mt-1 text-sm text-ink-600">
                      Your ticket request has been logged and assigned to the support team.
                    </p>
                  </div>

                  <div className="inline-block rounded-2xl bg-paper px-6 py-4 border border-line">
                    <span className="text-xs uppercase font-bold text-ink-400">Reference Number</span>
                    <p className="text-3xl font-mono font-extrabold text-brand-600 mt-1">
                      #{createdTicketResult.number}
                    </p>
                    <p className="text-xs text-ink-600 mt-1">
                      A confirmation email was dispatched to <strong>{ticketRequesterEmail}</strong>
                    </p>
                  </div>

                  <div className="flex flex-wrap justify-center gap-3 pt-4">
                    <button
                      onClick={() => navigate(`/tickets/${createdTicketResult.id}?guest=1&email=${encodeURIComponent(ticketRequesterEmail)}`)}
                      className="rounded-xl bg-brand-600 px-6 py-3 text-sm font-bold text-white shadow hover:bg-brand-700 transition"
                    >
                      View Ticket Thread Now &rarr;
                    </button>
                    <button
                      onClick={resetWizard}
                      className="rounded-xl border border-line bg-paper px-6 py-3 text-sm font-semibold text-ink-800 hover:bg-surface transition"
                    >
                      Return to Assistant
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ===================== PATH: CHECK STATUS WIZARD ===================== */}
          {currentPath === "status" && (
            <div className="space-y-6 animate-fadeIn">
              {/* Lookup Form */}
              <div className="rounded-3xl border border-line bg-surface p-6 shadow-sm">
                <h3 className="text-lg font-bold text-ink-800 mb-1">Verify Ticket Status</h3>
                <p className="text-xs text-ink-600 mb-5">
                  Enter your assigned ticket number and the email address used during submission.
                </p>

                {statusError && (
                  <div className="mb-4 rounded-xl bg-rose-50 dark:bg-rose-950/50 p-4 border border-rose-200 dark:border-rose-900 text-sm text-rose-800 dark:text-rose-200">
                    {statusError}
                  </div>
                )}

                <form onSubmit={handleCheckStatus} className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider text-ink-600 mb-1">
                      Ticket Number *
                    </label>
                    <input
                      required
                      type="text"
                      value={statusNumber}
                      onChange={(e) => setStatusNumber(e.target.value)}
                      placeholder="e.g. 482910"
                      className={inputClass}
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider text-ink-600 mb-1">
                      Requester Email *
                    </label>
                    <input
                      required
                      type="email"
                      value={statusEmail}
                      onChange={(e) => setStatusEmail(e.target.value)}
                      placeholder="your.email@example.com"
                      className={inputClass}
                    />
                  </div>

                  <div className="sm:col-span-2 flex justify-end">
                    <button
                      type="submit"
                      disabled={statusSearching}
                      className="rounded-xl bg-brand-600 px-6 py-2.5 font-bold text-white shadow hover:bg-brand-700 disabled:opacity-50 transition flex items-center gap-2"
                    >
                      {statusSearching ? "Searching Database..." : "Look Up Ticket Status 🔍"}
                    </button>
                  </div>
                </form>
              </div>

              {/* Status Result Card */}
              {statusResult && (
                <div className="rounded-3xl border border-line bg-surface p-6 sm:p-8 shadow-md animate-scaleUp space-y-6">
                  <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line pb-4">
                    <div>
                      <span className="text-xs font-bold text-ink-400 uppercase tracking-wider">Verified Ticket</span>
                      <h3 className="text-2xl font-bold text-ink-800">#{statusResult.number} &mdash; {statusResult.subject}</h3>
                    </div>
                    <span
                      className={`rounded-full px-3 py-1 text-xs font-bold uppercase ${
                        statusResult.isClosed
                          ? "bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-200"
                          : statusResult.statusState === "open"
                          ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300"
                          : "bg-blue-100 text-blue-800 dark:bg-blue-950/70 dark:text-blue-300"
                      }`}
                    >
                      Status: {statusResult.status}
                    </span>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-3">
                    <div className="rounded-2xl bg-paper p-4 border border-line">
                      <span className="text-xs text-ink-600 font-semibold uppercase">Department</span>
                      <p className="mt-1 font-bold text-ink-800 text-sm">{statusResult.department}</p>
                    </div>

                    <div className="rounded-2xl bg-paper p-4 border border-line">
                      <span className="text-xs text-ink-600 font-semibold uppercase">Priority</span>
                      <p className="mt-1 font-bold capitalize text-ink-800 text-sm">{statusResult.priority}</p>
                    </div>

                    <div className="rounded-2xl bg-paper p-4 border border-line">
                      <span className="text-xs text-ink-600 font-semibold uppercase">Activity</span>
                      <p className="mt-1 font-bold text-ink-800 text-sm">
                        {statusResult.lastActivity ? relativeTime(statusResult.lastActivity) : "Recent"} ({statusResult.messageCount} msg)
                      </p>
                    </div>
                  </div>

                  {statusResult.lastMessageSnippet && (
                    <div className="rounded-2xl bg-paper/60 p-4 border border-line">
                      <span className="text-xs font-bold text-ink-400 uppercase">Latest Thread Message Preview:</span>
                      <p className="mt-1 text-sm text-ink-700 italic">
                        &ldquo;{statusResult.lastMessageSnippet}...&rdquo;
                      </p>
                    </div>
                  )}

                  <div className="flex flex-wrap items-center justify-between gap-4 pt-4 border-t border-line">
                    <button
                      onClick={() => {
                        setStatusResult(null);
                        setStatusNumber("");
                      }}
                      className="text-xs font-semibold text-ink-600 hover:text-ink-800"
                    >
                      Check a different ticket
                    </button>
                    <button
                      onClick={openFullTicketView}
                      className="rounded-xl bg-brand-600 px-6 py-2.5 font-bold text-white shadow hover:bg-brand-700 transition"
                    >
                      Open Full Ticket & Conversation &rarr;
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ===================== PATH: CONTACT & HOURS ===================== */}
          {currentPath === "contact" && (
            <div className="space-y-6 animate-fadeIn">
              <div className="rounded-3xl border border-line bg-surface p-6 sm:p-8 shadow-sm space-y-6">
                <div>
                  <h3 className="text-xl font-bold text-ink-800">Support Desk Operating Hours & Directory</h3>
                  <p className="text-xs text-ink-600 mt-1">
                    Direct access information and contact points for {dbSettings.companyName}.
                  </p>
                </div>

                <div className="grid gap-5 md:grid-cols-2">
                  <div className="rounded-2xl border border-line bg-paper/50 p-5 space-y-3">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300">
                        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                      </div>
                      <div>
                        <h4 className="font-bold text-ink-800">Helpdesk Support Hours</h4>
                        <p className="text-xs text-ink-600">Standard business days</p>
                      </div>
                    </div>
                    <ul className="text-xs space-y-1.5 text-ink-700 pt-2 border-t border-line">
                      <li className="flex justify-between"><span>Monday &ndash; Friday:</span> <strong>8:00 AM &ndash; 6:00 PM EST</strong></li>
                      <li className="flex justify-between"><span>Saturday:</span> <strong>9:00 AM &ndash; 1:00 PM EST</strong></li>
                      <li className="flex justify-between"><span>Sunday & Holidays:</span> <span className="text-amber-600">Emergency escalations only</span></li>
                    </ul>
                  </div>

                  <div className="rounded-2xl border border-line bg-paper/50 p-5 space-y-3">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                        </svg>
                      </div>
                      <div>
                        <h4 className="font-bold text-ink-800">Official Channels</h4>
                        <p className="text-xs text-ink-600">Email & web ticket gateway</p>
                      </div>
                    </div>
                    <ul className="text-xs space-y-1.5 text-ink-700 pt-2 border-t border-line">
                      <li className="flex justify-between"><span>Email Support:</span> <strong>support@helpdesk.local</strong></li>
                      <li className="flex justify-between"><span>Emergency Hotline:</span> <strong>1-800-555-HELP</strong></li>
                      <li className="flex justify-between"><span>Branches registered:</span> <strong>{dbBranches.length} locations</strong></li>
                    </ul>
                  </div>
                </div>

                {dbBranches.length > 0 && (
                  <div>
                    <h4 className="text-sm font-bold text-ink-800 mb-2">Available Branches</h4>
                    <div className="flex flex-wrap gap-2">
                      {dbBranches.map((b) => (
                        <span key={b.id} className="rounded-xl border border-line bg-paper px-3 py-1.5 text-xs font-semibold text-ink-800">
                          📍 {b.name}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                <div className="pt-4 border-t border-line flex justify-end">
                  <button
                    onClick={() => choosePath("ticket")}
                    className="rounded-xl bg-brand-600 px-6 py-2.5 font-bold text-white shadow hover:bg-brand-700 transition"
                  >
                    Open a Ticket with our Team &rarr;
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
