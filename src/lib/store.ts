import type {
  CannedResponse,
  Database,
  Faq,
  HelpTopic,
  Message,
  SystemSettings,
  Task,
  Ticket,
  TicketQueue,
  TicketStatus,
  TicketStatusOption,
  User,
} from '../types'
import { seed } from './seed'
import { ApiRequestError, banApiTicketEmail, createApiTask, deleteApiTicket, getApiAppState, getApiPublicAppState, getApiPublicBranding, getApiStaffTicket, listApiAccountTickets, listApiTasks, listApiTickets, listApiAssignableStaff, lockApiTicket, mergeApiTicket, mirrorReply, mirrorTicket, registerApiUser, saveApiAppState, saveApiTicketCollaborators, unlockApiTicket, updateApiTask, updateApiTicket, updateApiUserVerification, type ApiClientUser, type ApiPersistedMessage, type ApiPersistedTicket } from './api'

const KEY = 'osticket-react-db-v4'
const SESSION = 'osticket-react-session'

const now = () => new Date().toISOString()
const id = () => crypto.randomUUID()
const ticketNumber = () => String(Math.floor(100000 + Math.random() * 900000))
const taskNumber = () => String(1000 + Math.floor(Math.random() * 8000))
const ticketAttachmentExtensions = new Set(['pdf', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'txt', 'csv', 'doc', 'docx', 'xls', 'xlsx', 'zip'])
const postgresStateKeys: Array<keyof Database> = ['faqs','categories','teams','roles','slas','filters','emails','banlist','templates','canned','logs','apiKeys','pages','forms','lists','plugins','schedules','queues','audits','settings']

function migrate(raw: Partial<Database>): Database {
  const base = seed()
  return {
    ...base,
    ...raw,
    users: raw.users?.length ? raw.users : base.users,
    departments: raw.departments?.length ? raw.departments : base.departments,
    topics: (raw.topics ?? base.topics).map((t) => ({ ...t, active: t.active ?? true })),
    tickets: raw.tickets ?? base.tickets,
    messages: raw.messages ?? base.messages,
    faqs: (raw.faqs ?? base.faqs).map((f) => ({ ...f, published: f.published ?? true })),
    categories: (raw.categories ?? base.categories).map((c) => ({ ...c, published: c.published ?? true })),
    organizations: raw.organizations ?? base.organizations,
    teams: raw.teams ?? base.teams,
    roles: raw.roles ?? base.roles,
    slas: raw.slas ?? base.slas,
    filters: raw.filters ?? base.filters,
    emails: raw.emails ?? base.emails,
    banlist: raw.banlist ?? base.banlist,
    templates: raw.templates ?? base.templates,
    canned: raw.canned ?? base.canned,
    tasks: raw.tasks ?? base.tasks,
    logs: raw.logs ?? base.logs,
    apiKeys: raw.apiKeys ?? base.apiKeys,
    pages: raw.pages ?? base.pages,
    forms: raw.forms ?? base.forms,
    lists: raw.lists ?? base.lists,
    plugins: raw.plugins ?? base.plugins,
    schedules: raw.schedules ?? base.schedules,
    queues: raw.queues?.length ? raw.queues : base.queues,
    audits: raw.audits ?? base.audits,
    settings: { ...base.settings, ...raw.settings },
  }
}

let cache: Database | null = null
let appStateHydrated = false
let hydratingAppState = false
let appStateSaveTimer: number | undefined
let appStateSaveQueue = Promise.resolve()
let lastPostgresStateSnapshot: Partial<Database> | null = null

function postgresStateSnapshot(data: Database): Partial<Database> {
  return Object.fromEntries(postgresStateKeys.map((key) => [key,data[key]])) as Partial<Database>
}

function queuePostgresStateSave(data: Database) {
  const token = clientSessionToken()
  const user = currentUser()
  if (!token || !user || !['agent','admin'].includes(user.role) || !appStateHydrated || hydratingAppState) return
  if (appStateSaveTimer) window.clearTimeout(appStateSaveTimer)
  const fullSnapshot = postgresStateSnapshot(data)
  const snapshot = lastPostgresStateSnapshot
    ? Object.fromEntries(postgresStateKeys.filter((key) => JSON.stringify(fullSnapshot[key]) !== JSON.stringify(lastPostgresStateSnapshot?.[key])).map((key) => [key,fullSnapshot[key]])) as Partial<Database>
    : fullSnapshot
  if (!Object.keys(snapshot).length) return
  appStateSaveTimer = window.setTimeout(() => {
    appStateSaveQueue = appStateSaveQueue
      .then(() => saveApiAppState(snapshot, token))
      .then(() => { lastPostgresStateSnapshot = { ...(lastPostgresStateSnapshot || {}), ...snapshot } })
      .catch((error) => console.error('[postgres app state save]', error))
  }, 250)
}

function load(): Database {
  if (cache) return cache
  try {
    const raw =
      localStorage.getItem(KEY) ??
      localStorage.getItem('osticket-react-db-v3') ??
      localStorage.getItem('osticket-react-db-v2') ??
      localStorage.getItem('osticket-react-db-v1')
    if (raw) {
      cache = migrate(JSON.parse(raw) as Partial<Database>)
      persist(cache)
      return cache
    }
  } catch {
    /* ignore */
  }
  cache = seed()
  persist(cache)
  return cache
}

function persist(data: Database) {
  cache = data
  localStorage.setItem(KEY, JSON.stringify(data))
  queuePostgresStateSave(data)
}

function save(data: Database) {
  persist(data)
}

const listeners = new Set<() => void>()

function emit() {
  listeners.forEach((fn) => fn())
}

export function subscribe(fn: () => void) {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

export function getDb(): Database {
  return load()
}

export function resetDemo() {
  cache = seed()
  persist(cache)
  emit()
}

export async function hydrateAppStateFromApi(token: string, _role: User['role']) {
  if (appStateHydrated) return
  const { state: savedState } = await getApiAppState(token)
  const state = savedState
  if (state) {
    const db = load()
    for (const key of postgresStateKeys) {
      if (!Object.hasOwn(state,key)) continue
      if (key === 'settings') {
        const prev = db.settings
        db.settings = {
          ...seed().settings,
          ...prev,
          ...(state.settings || {}),
          clientLogoId: state.settings?.clientLogoId || prev.clientLogoId || '0',
          staffLogoId: state.settings?.staffLogoId || prev.staffLogoId || '0',
          staffBackdropId: state.settings?.staffBackdropId || prev.staffBackdropId || '0',
        }
      }
      else Object.assign(db, { [key]: state[key] })
    }
    lastPostgresStateSnapshot = postgresStateSnapshot(db)
    hydratingAppState = true
    persist(db)
    hydratingAppState = false
    emit()
  } else {
    lastPostgresStateSnapshot = postgresStateSnapshot(load())
  }
  appStateHydrated = true
  void hydratePublicBrandingFromApi()
}

export async function hydratePublicAppStateFromApi() {
  if (clientSessionToken()) return
  const { state } = await getApiPublicAppState()
  if (!state) return
  const db = load()
  for (const key of ['faqs','categories','pages'] as const) {
    if (state[key]) Object.assign(db, { [key]: state[key] })
  }
  if (state.settings) {
    const prev = db.settings
    db.settings = {
      ...seed().settings,
      ...prev,
      ...state.settings,
      clientLogoId: state.settings.clientLogoId || prev.clientLogoId || '0',
      staffLogoId: state.settings.staffLogoId || prev.staffLogoId || '0',
      staffBackdropId: state.settings.staffBackdropId || prev.staffBackdropId || '0',
    }
  }
  hydratingAppState = true
  persist(db)
  hydratingAppState = false
  emit()
}

/** Fetch logo/backdrop IDs from the backend and store them in settings so all portals can display them. */
export async function hydratePublicBrandingFromApi() {
  try {
    const branding = await getApiPublicBranding()
    const db = load()
    db.settings = {
      ...db.settings,
      clientLogoId: branding.clientLogoId || '0',
      staffLogoId: branding.staffLogoId || '0',
      staffBackdropId: branding.staffBackdropId || '0',
    }
    hydratingAppState = true
    persist(db)
    hydratingAppState = false
    emit()
  } catch {
    // non-critical – logos simply fall back to the default icon
  }
}

export function findUserByEmail(email: string) {
  return load().users.find((u) => u.email.toLowerCase() === email.toLowerCase())
}

export function getUser(idValue: string) {
  return load().users.find((u) => u.id === idValue)
}

export function login(email: string, password: string) {
  const user = findUserByEmail(email)
  if (!user || user.password !== password) return null
  if (user.active === false) return null
  if (user.role === 'client' && user.verificationStatus && user.verificationStatus !== 'approved') return null
  localStorage.setItem(SESSION, JSON.stringify({ userId: user.id }))
  const db = load()
  db.logs.unshift({
    id: id(),
    createdAt: now(),
    type: 'info',
    title: 'Login',
    body: `${user.name} signed in.`,
    ip: '127.0.0.1',
  })
  save(db)
  emit()
  return user
}

export function logout() {
  if (appStateSaveTimer) window.clearTimeout(appStateSaveTimer)
  appStateSaveTimer = undefined
  appStateHydrated = false
  lastPostgresStateSnapshot = null
  localStorage.removeItem(SESSION)
}

export function currentUser(): User | null {
  try {
    const raw = localStorage.getItem(SESSION)
    if (!raw) return null
    const { userId } = JSON.parse(raw) as { userId: string }
    const user = getUser(userId) ?? null
    if (user?.role === 'client' && user.verificationStatus && user.verificationStatus !== 'approved') {
      localStorage.removeItem(SESSION)
      return null
    }
    return user
  } catch {
    return null
  }
}

export async function register(input: { name: string; email: string; password: string; phone?: string; employeeId?: string; branchId?: string }) {
  const db = load()
  if (db.settings.registrationMode === 'disabled') {
    throw new Error('New registrations are disabled.')
  }
  if (db.settings.registrationMode === 'closed') {
    throw new Error('Registration is closed. Ask an agent to create your account.')
  }
  const user: User = {
    id: id(),
    name: input.name,
    email: input.email,
    password: '',
    phone: input.phone,
    employeeId: input.employeeId?.trim() || undefined,
    branchId: input.branchId || undefined,
    role: 'client',
    active: true,
    verificationStatus: 'pending',
  }
  await registerApiUser(input)
  db.users.push(user)
  db.audits.unshift({ id: id(), createdAt: now(), actorId: 'system', actorName: 'System', objectType: 'user', objectId: user.id, action: 'registration_pending', details: 'New client account submitted for administrator verification.' })
  save(db)
  emit()
  return user
}

export function accountVerificationStatus(email: string, password: string) {
  const user = findUserByEmail(email)
  return user?.active !== false && user?.password === password && user?.role === 'client'
    ? user.verificationStatus
    : undefined
}

export async function setUserVerificationStatus(userId: string, status: 'approved' | 'rejected', actor: User) {
  if (actor.role !== 'admin') throw new Error('Only an administrator can verify client accounts.')
  const db = load()
  const user = db.users.find((item) => item.id === userId && item.role === 'client')
  if (!user) throw new Error('Client account not found.')
  const token = accountSessionToken()
  if (!token) throw new Error('Administrator session has expired. Sign in again.')
  await updateApiUserVerification(user, status, actor.name, token)
  user.verificationStatus = status
  db.audits.unshift({ id: id(), createdAt: now(), actorId: actor.id, actorName: actor.name, objectType: 'user', objectId: user.id, action: `verification_${status}`, details: `${user.email} was ${status} by an administrator.` })
  save(db)
  emit()
  return user
}

export function syncUserVerification(email: string, status: 'approved' | 'rejected', actor: User) {
  const db = load()
  const user = db.users.find((item) => item.email.toLowerCase() === email.toLowerCase() && item.role === 'client')
  if (!user) return
  user.verificationStatus = status
  db.audits.unshift({ id: id(), createdAt: now(), actorId: actor.id, actorName: actor.name, objectType: 'user', objectId: user.id, action: `verification_${status}`, details: `${user.email} was ${status} by an administrator.` })
  save(db)
  emit()
}

export function establishApiClientSession(account: ApiClientUser, accessToken: string) {
  if (appStateSaveTimer) window.clearTimeout(appStateSaveTimer)
  lastPostgresStateSnapshot = null
  appStateHydrated = false
  const db = load()
  let user = db.users.find((item) => item.email.toLowerCase() === account.email.toLowerCase())
  if (user) {
    Object.assign(user, { name: account.name, email: account.email, phone: account.phone || user.phone, employeeId: account.employeeId || '', branchId: account.branchId || '', branchName: account.branchName || '', org: account.org || '', role: 'client' as const, active: true, verificationStatus: 'approved' as const, password: '' })
  } else {
    user = { id: `react-${account.id}`, name: account.name, email: account.email, phone: account.phone, employeeId: account.employeeId, branchId: account.branchId, branchName: account.branchName, org: account.org, password: '', role: 'client', active: true, verificationStatus: 'approved' }
    db.users.push(user)
  }
  save(db)
  localStorage.setItem(SESSION, JSON.stringify({ userId: user.id, accessToken }))
  emit()
  return user
}

export function establishApiStaffSession(account: ApiClientUser & { role: 'agent' | 'admin' }, accessToken: string) {
  if (appStateSaveTimer) window.clearTimeout(appStateSaveTimer)
  lastPostgresStateSnapshot = null
  appStateHydrated = false
  const db = load()
  let user = db.users.find((item) => item.email.toLowerCase() === account.email.toLowerCase())
  const value: User = { id: String(account.id), name: account.name, email: account.email, phone: account.phone, title: account.title, deptId: account.deptId, roleId: account.roleId, password: '', role: account.role, active: true }
  if (user) Object.assign(user, value)
  else { user = value; db.users.push(user) }
  save(db)
  localStorage.setItem(SESSION, JSON.stringify({ userId: user.id, accessToken }))
  emit()
  return user
}

export function establishApiSession(account: ApiClientUser & { role: User['role'] }, accessToken: string) {
  if (account.role === 'agent' || account.role === 'admin') return establishApiStaffSession(account as ApiClientUser & { role: 'agent' | 'admin' }, accessToken)
  return establishApiClientSession(account, accessToken)
}

export function clientSessionToken() {
  try {
    const raw = localStorage.getItem(SESSION)
    return raw ? (JSON.parse(raw) as { accessToken?: string }).accessToken ?? null : null
  } catch { return null }
}
export const accountSessionToken = clientSessionToken

export function updateProfile(userId: string, patch: Partial<Pick<User, 'name' | 'phone' | 'org' | 'title' | 'password'>>) {
  const db = load()
  const user = db.users.find((u) => u.id === userId)
  if (!user) return
  Object.assign(user, patch)
  save(db)
  emit()
}

export function upsertUser(input: Partial<User> & { name: string; email: string; role: User['role'] }) {
  const db = load()
  if (input.id) {
    const existing = db.users.find((u) => u.id === input.id)
    if (existing) {
      Object.assign(existing, input)
      save(db)
      emit()
      return existing
    }
  }
  const user: User = {
    id: id(),
    password: input.password || 'demo123',
    active: true,
    ...input,
  }
  db.users.push(user)
  save(db)
  emit()
  return user
}

export function removeUser(userId: string) {
  const db = load()
  db.users = db.users.filter((u) => u.id !== userId)
  save(db)
  emit()
}

export async function createTicket(input: {
  userId: string
  name?: string
  email?: string
  phone?: string
  employeeId?: string
  branchId?: string
  branchName?: string
  topicId: string
  subject: string
  body: string
  priority: Ticket['priority']
  source?: Ticket['source']
  assigneeId?: string
  collaborators?: Array<{ name: string; email: string; active: boolean }>
  fromEmail?: string
  collaboratorNotice?: 'all' | 'user' | 'none'
  attachments?: File[]
}) {
  const attachments = input.attachments ?? []
  if (attachments.length > 5) throw new Error('You can attach up to 5 files.')
  for (const file of attachments) {
    if (file.size > 8 * 1024 * 1024) throw new Error('Each attachment must be 8 MB or smaller.')
    const extension = file.name.split('.').pop()?.toLowerCase() ?? ''
    if (!ticketAttachmentExtensions.has(extension)) throw new Error('Choose PDF, image, text, CSV, Office document, or ZIP files only.')
  }
  const db = load()
  let user = db.users.find((u) => u.id === input.userId)
  if (!user && input.email) {
    user = db.users.find((u) => u.email.toLowerCase() === input.email!.toLowerCase())
    if (!user) {
      user = {
        id: id(),
        name: input.name || 'Guest',
        email: input.email,
        password: 'guest',
        phone: input.phone,
        role: 'client',
        active: true,
      }
      db.users.push(user)
    }
  }
  if (!user) throw new Error('A name and email are required.')
  if (db.banlist.some((b) => b.email.toLowerCase() === user.email.toLowerCase())) {
    throw new Error('This email is on the ban list. The ticket was not created.')
  }
  const openCount = db.tickets.filter((t) => t.userId === user.id && t.status !== 'closed').length
  if (openCount >= db.settings.maxOpenTickets) {
    throw new Error(`You already have ${db.settings.maxOpenTickets} open tickets. Close one before opening another.`)
  }
  const topic = db.topics.find((t) => t.id === input.topicId)
  if (!topic || topic.active === false) throw new Error('Select a help topic.')
  let priority = input.priority || topic.priority || db.settings.defaultPriority
  let deptId = topic.deptId
  const hay = `${user.email} ${input.subject} ${input.body}`.toLowerCase()
  for (const filter of db.filters.filter((f) => f.active)) {
    if (filter.match.toLowerCase().includes('out of office') && hay.includes('out of office')) {
      throw new Error('This message was rejected by a ticket filter.')
    }
    if (filter.match.toLowerCase().includes('acme.com') && user.email.toLowerCase().endsWith('@acme.com')) {
      priority = 'high'
      if (filter.targetDeptId) deptId = filter.targetDeptId
    }
  }
  const ticket: Ticket = {
    id: id(),
    number: ticketNumber(),
    subject: input.subject,
    status: 'open',
    priority,
    source: input.source ?? 'web',
    topicId: topic.id,
    deptId,
    employeeId: input.employeeId?.trim() || undefined,
    branchId: input.branchId || undefined,
    branchName: input.branchName || undefined,
    slaId: topic.slaId,
    userId: user.id,
    assigneeId: input.assigneeId,
    collaborators: input.collaborators || [],
    collaboratorIds: (input.collaborators || []).filter((c) => c.active).map((c) => db.users.find((u) => u.email.toLowerCase() === c.email.toLowerCase())?.id).filter((id): id is string => Boolean(id)),
    fromEmail: input.fromEmail,
    collaboratorNotice: input.collaboratorNotice,
    createdAt: now(),
    updatedAt: now(),
  }
  db.tickets.unshift(ticket)
  const initialMessage: Message = {
    id: id(),
    ticketId: ticket.id,
    authorId: user.id,
    authorName: user.name,
    kind: 'client',
    body: input.body,
    attachments: input.attachments?.map((file) => file.name),
    createdAt: now(),
  }
  db.messages.push(initialMessage)
  save(db)
  emit()
  let thankYouPage: { id: string; name: string; body: string } | null = null
  try {
    const mirrored = await mirrorTicket(ticket, user, input.body, db, input.attachments)
    thankYouPage = mirrored.thankYouPage ?? null
    const serverNumber = mirrored.ticket?.number
    if (serverNumber && serverNumber !== ticket.number) {
      ticket.number = serverNumber
      save(db)
      emit()
    }
  } catch (error) {
    db.tickets = db.tickets.filter((item) => item.id !== ticket.id)
    db.messages = db.messages.filter((item) => item.id !== initialMessage.id)
    save(db)
    emit()
    throw error
  }
  return { ticket, thankYouPage }
}

export async function hydrateTicketsFromApi(token: string) {
  const role = currentUser()?.role
  if (role === 'agent' || role === 'admin') {
    const result = await listApiTickets(token)
    const messages = result.tickets.flatMap((ticket) => (ticket.messages || []).map((message: Record<string, any>) => ({
      ...message,
      ticketNumber: String(ticket.number),
      kind: message.kind === 'note' ? 'system' : message.kind,
    })))
    replaceTicketSnapshot(result.tickets as unknown as ApiPersistedTicket[], messages as ApiPersistedMessage[])
    return
  }
  const result = await listApiAccountTickets(token)
  replaceTicketSnapshot(result.tickets, result.messages)
}

export async function hydrateTicketDetailFromApi(ticketId: string) {
  const detail = await getApiStaffTicket(ticketId)
  const ticket = detail.ticket as unknown as ApiPersistedTicket
  const messages = (detail.messages || []).map((message) => ({ ...message, ticketNumber: ticket.number, kind: (message.kind as string) === 'note' ? 'system' : message.kind }))
  return hydrateSingleApiTicket(ticket, messages as ApiPersistedMessage[])
}

export async function hydrateTasksFromApi(_token: string) {
  const result = await listApiTasks({ queue: 'all', perPage: 100, page: 1 })
  const db = load()
  const localOnly = db.tasks.filter((task) => !/^\d+$/.test(task.id))
  db.tasks = [...(result.tasks || []).map((row) => mapApiTaskForDb(row, db)), ...localOnly]
  save(db)
  emit()
}

function mapApiTask(row: Record<string, any>): Task {
  return {
    id: String(row.id),
    number: String(row.number || ''),
    title: String(row.title || '(untitled task)'),
    description: row.description ? String(row.description) : undefined,
    deptId: String(row.deptId || ''),
    departmentName: row.departmentName ? String(row.departmentName) : undefined,
    assigneeId: row.assigneeId ? String(row.assigneeId) : undefined,
    assigneeName: row.assigneeName ? String(row.assigneeName) : undefined,
    teamId: row.teamId ? String(row.teamId) : undefined,
    teamName: row.teamName ? String(row.teamName) : undefined,
    ticketId: row.ticketId ? String(row.ticketId) : undefined,
    ticketNumber: row.ticketNumber ? String(row.ticketNumber) : undefined,
    dueAt: row.dueAt ? String(row.dueAt) : undefined,
    status: row.status === 'closed' ? 'closed' : 'open',
    overdue: Boolean(row.overdue),
    createdAt: String(row.createdAt || now()),
    updatedAt: row.updatedAt ? String(row.updatedAt) : undefined,
    closedAt: row.closedAt ? String(row.closedAt) : undefined,
  }
}

function mapApiTaskForDb(row: Record<string, any>, db: Database): Task {
  const task = mapApiTask(row)
  const departmentName = String(row.departmentName || '').trim()
  if (departmentName) {
    let department = db.departments.find((item) => item.name.toLowerCase() === departmentName.toLowerCase() || (row.deptId && item.id === String(row.deptId)))
    if (!department) {
      department = { id: row.deptId ? String(row.deptId) : `api-dept-${departmentName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`, name: departmentName, active: true }
      db.departments.push(department)
    }
    task.deptId = department.id
  }
  return task
}

function staffTaskSession() {
  const role = currentUser()?.role
  return Boolean(accountSessionToken()) && (role === 'agent' || role === 'admin')
}

export async function hydrateAssignableStaffFromApi(token: string) {
  const result = await listApiAssignableStaff(token)
  const db = load()
  let session: { userId?: string; accessToken?: string } | null = null
  try { session = JSON.parse(localStorage.getItem(SESSION) || 'null') } catch {}
  let sessionUserIdChanged = false
  const normalizedEmail = (email: string | null | undefined) => String(email || '').trim().toLowerCase()
  const assignableEmails = new Set(result.staff.map((person) => normalizedEmail(person.email)).filter(Boolean))
  db.users = db.users.filter((person) => person.role === 'client' || !person.email || assignableEmails.has(person.email.toLowerCase()))
  for (const person of result.staff) {
    const email = normalizedEmail(person.email)
    const account = db.users.find((user) => user.id === person.id || (email && normalizedEmail(user.email) === email))
    const value: User = { id: person.id, name: person.name, email: person.email, phone: person.phone, title: person.title, deptId: person.deptId, roleId: person.roleId, password: '', role: person.role, active: person.active }
    if (account) {
      const previousId = account.id
      Object.assign(account, value)
      if (session?.userId === previousId && previousId !== value.id) {
        session.userId = value.id
        sessionUserIdChanged = true
      }
    }
    else db.users.push(value)
  }
  save(db)
  if (sessionUserIdChanged && session) localStorage.setItem(SESSION, JSON.stringify(session))
  emit()
}

export function hydrateSingleApiTicket(ticket: ApiPersistedTicket, messages: ApiPersistedMessage[]) {
  load()
  replaceTicketSnapshot([ticket], messages, false)
  const refreshed = load().tickets.find((item) => item.number === ticket.number)
  return refreshed
}

function replaceTicketSnapshot(tickets: ApiPersistedTicket[], messages: ApiPersistedMessage[], replaceAll = true) {
  const db = load()
  const existingByNumber = new Map(db.tickets.map((ticket) => [ticket.number, ticket]))
  const idByNumber = new Map<string, string>()
  const mappedTickets: Ticket[] = tickets.map((row) => {
    let owner = db.users.find((person) => person.email.toLowerCase() === row.requesterEmail.toLowerCase())
    if (!owner) {
      owner = { id: `api-user-${row.requesterEmail.toLowerCase()}`, name: row.requesterName, email: row.requesterEmail, password: '', role: 'client', active: true }
      db.users.push(owner)
    } else {
      owner.name = row.requesterName
    }
    let department = db.departments.find((item) => item.name.toLowerCase() === row.department.toLowerCase())
    if (!department) {
      department = { id: `api-dept-${row.department.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`, name: row.department, active: true }
      db.departments.push(department)
    }
    let topic = db.topics.find((item) => item.name.toLowerCase() === row.topic.toLowerCase() && item.deptId === department!.id)
    if (!topic) {
      topic = { id: `api-topic-${row.topic.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`, name: row.topic, deptId: department.id, hint: '', active: true }
      db.topics.push(topic)
    }
    const old = existingByNumber.get(row.number)
    const assignee = row.assigneeEmail
      ? db.users.find((person) => person.role !== 'client' && person.email.toLowerCase() === row.assigneeEmail!.toLowerCase())
      : row.assignee ? db.users.find((person) => person.role !== 'client' && person.name.toLowerCase() === row.assignee!.toLowerCase()) : undefined
    const collaboratorIds = (row.collaborators || []).filter((person) => person.active).map((person) => {
      let collaborator = db.users.find((item) => item.email.toLowerCase() === person.email.toLowerCase())
      if (!collaborator) {
        collaborator = { id: person.userId || `api-user-${person.email.toLowerCase()}`, name: person.name, email: person.email, password: '', role: 'client', active: true }
        db.users.push(collaborator)
      }
      return person.userId || collaborator.id
    })
    const mapped: Ticket = {
      id: row.id,
      number: row.number,
      subject: row.subject,
      status: row.status,
      statusId: row.statusId ? String(row.statusId) : old?.statusId,
      statusName: row.statusName || old?.statusName,
      priority: row.priority,
      source: (['web', 'email', 'phone'].includes(String(row.source || 'web').toLowerCase()) ? String(row.source || 'web').toLowerCase() : 'web') as Ticket['source'],
      topicId: topic.id,
      deptId: department.id,
      userId: owner.id,
      employeeId: row.employeeId,
      branchId: row.branchId,
      branchName: row.branchName,
      assigneeId: assignee?.id,
      collaboratorIds,
      collaborators: row.collaborators || old?.collaborators || [],
      fromEmail: row.fromEmail,
      collaboratorNotice: row.collaboratorNotice,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      overdue: row.overdue,
      parentTicketId: row.parentTicketId,
      mergedTicketIds: row.mergedTicketIds,
      dueAt: row.dueAt,
      lockedBy: row.lockedBy,
    }
    idByNumber.set(row.number, mapped.id)
    return mapped
  })
  const ticketByNumber = new Map(tickets.map((ticket) => [ticket.number, ticket]))
  const mappedMessages: Message[] = messages.flatMap((row) => {
    const ticketId = idByNumber.get(row.ticketNumber)
    const ticket = ticketByNumber.get(row.ticketNumber)
    if (!ticketId || !ticket) return []
    let author = row.authorEmail ? db.users.find((person) => person.email.toLowerCase() === row.authorEmail.toLowerCase()) : undefined
    if (!author && row.kind === 'agent') author = db.users.find((person) => person.role !== 'client' && person.name.toLowerCase() === row.author.toLowerCase())
    if (!author && row.kind !== 'system') {
      author = { id: row.authorEmail ? `api-user-${row.authorEmail.toLowerCase()}` : `api-staff-${row.author.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`, name: row.author, email: row.authorEmail || '', password: '', role: row.kind === 'agent' ? 'agent' : 'client', active: true }
      if (!db.users.some((person) => person.id === author!.id)) db.users.push(author)
    }
    return [{ id: row.id, ticketId, authorId: author?.id || 'system', authorName: row.author, kind: row.kind, internal: row.internal, body: row.body, attachments: row.attachments, attachmentFiles: row.attachmentFiles, recipients: row.recipients || [], createdAt: row.createdAt }]
  })
  if (replaceAll) {
    db.tickets = mappedTickets
    db.messages = mappedMessages
  } else {
    const numbers = new Set(tickets.map((ticket) => ticket.number))
    db.tickets = [...mappedTickets, ...db.tickets.filter((ticket) => !numbers.has(ticket.number))]
    const ticketIds = new Set(mappedTickets.map((ticket) => ticket.id))
    db.messages = [...db.messages.filter((message) => !ticketIds.has(message.ticketId)), ...mappedMessages]
  }
  save(db)
  emit()
}

export function ticketsForUser(userId: string) {
  const db = load()
  const user = db.users.find((u) => u.id === userId)
  const orgPeerIds = user?.orgId ? db.users.filter((u) => u.orgId === user.orgId).map((u) => u.id) : []
  return db.tickets
    .filter(
      (t) =>
        t.userId === userId ||
        (!db.settings.hideCollaboratorTickets && t.collaboratorIds?.includes(userId)) ||
        (user?.orgId && orgPeerIds.includes(t.userId)),
    )
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

export function canAccessTicket(ticketId: string, user: User | null | undefined, guestEmail?: string) {
  const db = load()
  const ticket = db.tickets.find((t) => t.id === ticketId)
  if (!ticket) return false
  if (guestEmail) {
    const owner = db.users.find((u) => u.id === ticket.userId)
    return owner?.email.toLowerCase() === guestEmail.toLowerCase()
  }
  if (!user) return false
  if (user.role === 'agent' || user.role === 'admin') return true
  if (ticket.userId === user.id || ticket.collaboratorIds?.includes(user.id)) return true
  if (user.orgId) {
    const owner = db.users.find((u) => u.id === ticket.userId)
    if (owner?.orgId === user.orgId) return true
  }
  return false
}

export function lookupTicket(email: string, number: string) {
  const db = load()
  const user = db.users.find((u) => u.email.toLowerCase() === email.toLowerCase())
  if (!user) return null
  return db.tickets.find((t) => t.number === number && t.userId === user.id) ?? null
}

export function getTicket(ticketId: string) {
  return load().tickets.find((t) => t.id === ticketId)
}

export function messagesFor(ticketId: string, includeInternal: boolean) {
  return load()
    .messages.filter((m) => m.ticketId === ticketId && (includeInternal || !m.internal))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

export async function addReply(input: {
  ticketId: string
  author: User
  body: string
  internal?: boolean
  close?: boolean
  pending?: boolean
  attachments?: string[]
  files?: File[]
  recipients?: string[]
  fromEmail?: string
  collaboratorResponse?: boolean
}) {
  const db = load()
  const ticket = db.tickets.find((t) => t.id === input.ticketId)
  if (!ticket) throw new Error('Ticket not found.')
  const kind: Message['kind'] = input.author.role === 'client' ? (ticket.userId === input.author.id ? 'client' : 'collaborator') : 'agent'
  db.messages.push({
    id: id(),
    ticketId: ticket.id,
    authorId: input.author.id,
    authorName: input.author.name,
    kind,
    body: input.body,
    internal: input.internal,
    attachments: input.attachments,
    recipients: input.recipients,
    createdAt: now(),
  })
  ticket.updatedAt = now()
  if (ticket.status === 'closed' && kind === 'client' && db.settings.allowClientReopen) {
    ticket.status = 'open'
    ticket.statusId = undefined
    ticket.statusName = undefined
    db.messages.push({
      id: id(),
      ticketId: ticket.id,
      authorId: 'system',
      authorName: 'System',
      kind: 'system',
      body: 'Ticket reopened by client reply.',
      createdAt: now(),
    })
  }
  if (input.close) {
    ticket.status = 'closed'
    ticket.statusId = undefined
    ticket.statusName = undefined
    db.messages.push({
      id: id(),
      ticketId: ticket.id,
      authorId: 'system',
      authorName: 'System',
      kind: 'system',
      body: `Ticket closed by ${input.author.name}.`,
      createdAt: now(),
    })
  } else if (input.pending) {
    ticket.status = 'pending'
    ticket.statusId = undefined
    ticket.statusName = undefined
  }
  save(db)
  emit()
  const owner = db.users.find((u) => u.id === ticket.userId)
  if (owner) {
    const pending = mirrorReply({ ticket, owner, author: input.author, body: input.body, initialMessage: db.messages.find((m) => m.ticketId === ticket.id && !m.internal)?.body ?? '', db, internal: input.internal, status: input.close ? 'closed' : input.pending ? 'pending' : undefined, recipients: input.recipients, fromEmail: input.fromEmail, collaboratorResponse: input.collaboratorResponse, files: input.files })
    if (/^\d+$/.test(ticket.id)) {
      await pending
      await hydrateTicketDetailFromApi(ticket.id).catch((error: unknown) => console.warn('[helpdesk reply]', error instanceof Error ? error.message : error))
    } else {
      void pending.catch((error: unknown) => console.warn('[helpdesk reply]', error instanceof Error ? error.message : error))
    }
  }
}

export function setTicketAssignee(ticketId: string, assigneeId: string | undefined, assigneeName: string | undefined, actor: User) {
  const db = load()
  const current = db.tickets.find((item) => item.id === ticketId)
  if (!current) return
  const name = assigneeId ? assigneeName || db.users.find((u) => u.id === assigneeId)?.name || assigneeId : undefined
  const previous = current.assigneeId ? db.users.find((u) => u.id === current.assigneeId)?.name ?? current.assigneeId : 'Unassigned'
  current.assigneeId = assigneeId || undefined
  current.updatedAt = now()
  db.messages.push({
    id: id(),
    ticketId,
    authorId: 'system',
    authorName: 'System',
    kind: 'system',
    body: name ? `Assigned to ${name} by ${actor.name}.` : `Released by ${actor.name}.`,
    createdAt: now(),
  })
  db.audits.unshift({ id: id(), createdAt: now(), actorId: actor.id, actorName: actor.name, objectType: 'ticket', objectId: ticketId, action: 'assign', details: `${previous} â†’ ${name ?? 'Unassigned'}` })
  save(db)
  emit()
}

export async function assignTicket(ticketId: string, assigneeId: string | undefined, actor: User) {
  const db = load()
  const ticket = db.tickets.find((t) => t.id === ticketId)
  if (!ticket) return
  const assignee = assigneeId ? db.users.find((u) => u.id === assigneeId) : undefined
  if (/^\d+$/.test(ticket.id)) await updateApiTicket(ticket.number, { assigneeEmail: assignee?.email ?? '' })
  setTicketAssignee(ticketId, assigneeId, assignee?.name, actor)
}

export function setTicketStatus(ticketId: string, status: TicketStatusOption, actor: User) {
  const db = load()
  const ticket = db.tickets.find((item) => item.id === ticketId)
  if (!ticket) return
  const state = String(status.state || status.name || '').toLowerCase()
  const nextStatus: Ticket['status'] = state === 'closed' ? 'closed' : state === 'pending' ? 'pending' : 'open'
  const previousName = ticket.statusName || ticket.status
  ticket.status = nextStatus
  ticket.statusId = status.id || undefined
  ticket.statusName = status.name
  ticket.updatedAt = now()
  db.messages.push({
    id: id(),
    ticketId,
    authorId: 'system',
    authorName: 'System',
    kind: 'system',
    body: `Status set to ${status.name} by ${actor.name}.`,
    createdAt: now(),
  })
  db.audits.unshift({ id: id(), createdAt: now(), actorId: actor.id, actorName: actor.name, objectType: 'ticket', objectId: ticketId, action: 'status', details: `${previousName} â†’ ${status.name}` })
  save(db)
  emit()
}

export async function setStatus(ticketId: string, status: Ticket['status'] | TicketStatusOption, actor: User) {
  const db = load()
  const ticket = db.tickets.find((t) => t.id === ticketId)
  if (!ticket) return
  const change: TicketStatusOption = typeof status === 'string' ? { id: '', name: status, state: status } : status
  if (/^\d+$/.test(ticket.id)) {
    await updateApiTicket(ticket.number, change.id && /^\d+$/.test(change.id) ? { statusId: change.id } : { status: change.name })
  }
  setTicketStatus(ticketId, change, actor)
}

export function searchFaqs(q: string) {
  const db = load()
  const query = q.trim().toLowerCase()
  const published = db.faqs.filter((f) => f.published !== false)
  if (!query) return published
  return published.filter(
    (f) => f.question.toLowerCase().includes(query) || f.answer.toLowerCase().includes(query),
  )
}

export function saveSettings(patch: Partial<SystemSettings>) {
  const db = load()
  db.settings = { ...db.settings, ...patch }
  save(db)
  emit()
}

export function addLog(entry: { type: Database['logs'][number]['type']; title: string; body: string }) {
  const db = load()
  db.logs.unshift({ id: id(), createdAt: now(), ip: '127.0.0.1', ...entry })
  save(db)
  emit()
}

export async function createTask(input: Omit<Task, 'id' | 'number' | 'createdAt' | 'status'> & { status?: Task['status']; description?: string }) {
  const db = load()
  const localEntity = [input.ticketId, input.assigneeId].some((value) => Boolean(value) && !/^\d+$/.test(String(value)))
  if (!localEntity && staffTaskSession()) {
    const result = await createApiTask({
      title: input.title,
      description: input.description || input.title,
      deptId: input.deptId && /^\d+$/.test(input.deptId) ? input.deptId : undefined,
      assigneeId: input.assigneeId && /^\d+$/.test(input.assigneeId) ? input.assigneeId : undefined,
      teamId: input.teamId && /^\d+$/.test(input.teamId) ? input.teamId : undefined,
      ticketId: input.ticketId && /^\d+$/.test(input.ticketId) ? input.ticketId : undefined,
      dueAt: input.dueAt,
    })
    const currentDb = load()
    const task = mapApiTaskForDb(result.task, currentDb)
    currentDb.tasks.unshift(task)
    save(currentDb)
    emit()
    return task
  }
  const task: Task = {
    id: id(),
    number: taskNumber(),
    createdAt: now(),
    status: input.status ?? 'open',
    ...input,
  }
  db.tasks.unshift(task)
  save(db)
  emit()
  return task
}

export async function updateTask(taskId: string, patch: Partial<Task>) {
  const db = load()
  const task = db.tasks.find((t) => t.id === taskId)
  if (!task) return
  if (/^\d+$/.test(taskId) && staffTaskSession()) {
    const payload: Record<string, unknown> = {}
    if ('title' in patch) payload.title = patch.title
    if ('description' in patch) payload.description = patch.description
    if ('status' in patch) payload.status = patch.status
    if ('dueAt' in patch) payload.dueAt = patch.dueAt ?? null
    if ('deptId' in patch) {
      if (patch.deptId) {
        if (/^\d+$/.test(patch.deptId)) payload.deptId = patch.deptId
        else payload.deptId = undefined
      } else payload.deptId = ''
    }
    if ('assigneeId' in patch) payload.assigneeId = patch.assigneeId && /^\d+$/.test(patch.assigneeId) ? patch.assigneeId : ''
    if ('teamId' in patch) payload.teamId = patch.teamId && /^\d+$/.test(patch.teamId) ? patch.teamId : ''
    if ('ticketId' in patch) payload.ticketId = patch.ticketId && /^\d+$/.test(patch.ticketId) ? patch.ticketId : ''
    const result = await updateApiTask(taskId, payload)
    const currentDb = load()
    const updated = mapApiTaskForDb(result.task, currentDb)
    const current = currentDb.tasks.find((item) => item.id === taskId)
    if (current) Object.assign(current, updated)
    save(currentDb)
    emit()
    return current
  }
  Object.assign(task, patch)
  save(db)
  emit()
  return task
}

export function upsertFaq(input: Partial<Faq> & { question: string; answer: string; categoryId: string }) {
  const db = load()
  if (input.id) {
    const existing = db.faqs.find((f) => f.id === input.id)
    if (existing) {
      Object.assign(existing, input)
      save(db)
      emit()
      return existing
    }
  }
  const faq: Faq = { id: id(), published: true, ...input }
  db.faqs.push(faq)
  save(db)
  emit()
  return faq
}

export function removeFaq(faqId: string) {
  const db = load()
  db.faqs = db.faqs.filter((f) => f.id !== faqId)
  save(db)
  emit()
}

export function replaceFaqs(faqs: Faq[]) {
  const db = load()
  db.faqs = faqs.map((faq) => ({ ...faq, published: faq.published !== false }))
  save(db)
  emit()
}

export function upsertTopic(input: Partial<HelpTopic> & { name: string; deptId: string; hint: string }) {
  const db = load()
  if (input.id) {
    const existing = db.topics.find((t) => t.id === input.id)
    if (existing) {
      Object.assign(existing, input)
      save(db)
      emit()
      return existing
    }
  }
  const topic: HelpTopic = { id: id(), active: true, ...input }
  db.topics.push(topic)
  save(db)
  emit()
  return topic
}

export function removeTopic(topicId: string) {
  const db = load()
  db.topics = db.topics.filter((t) => t.id !== topicId)
  save(db)
  emit()
}

export function upsertCanned(input: Partial<CannedResponse> & { title: string; body: string }) {
  const db = load()
  if (input.id) {
    const existing = db.canned.find((c) => c.id === input.id)
    if (existing) {
      Object.assign(existing, input)
      save(db)
      emit()
      return existing
    }
  }
  const item: CannedResponse = { id: id(), ...input }
  db.canned.push(item)
  save(db)
  emit()
  return item
}

export function removeCanned(cannedId: string) {
  const db = load()
  db.canned = db.canned.filter((c) => c.id !== cannedId)
  save(db)
  emit()
}

type Identified = { id: string }

export function upsertRecord<K extends keyof Database>(collection: K, item: Database[K] extends (infer T)[] ? T : never) {
  const db = load()
  const list = db[collection]
  if (!Array.isArray(list)) return item
  const row = item as Identified
  const idx = (list as Identified[]).findIndex((x) => x.id === row.id)
  if (idx >= 0) (list as Identified[])[idx] = { ...(list as Identified[])[idx], ...row }
  else (list as Identified[]).push(row.id ? row : { ...row, id: id() })
  save(db)
  emit()
  return item
}

export function addRecord<K extends keyof Database>(collection: K, item: Database[K] extends (infer T)[] ? Omit<T, 'id'> & { id?: string } : never) {
  const db = load()
  const list = db[collection]
  if (!Array.isArray(list)) return
  const row = { ...(item as object), id: (item as Identified).id || id() }
  ;(list as object[]).push(row)
  save(db)
  emit()
  return row
}

export function removeRecord<K extends keyof Database>(collection: K, recordId: string) {
  const db = load()
  const list = db[collection]
  if (!Array.isArray(list)) return
  ;(db as unknown as Record<string, Identified[]>)[collection as string] = (list as Identified[]).filter((x) => x.id !== recordId)
  save(db)
  emit()
}

export function newId() {
  return id()
}

export function setTicketPriority(ticketId: string, priority: Ticket['priority'], actor: User) {
  const db = load()
  const current = db.tickets.find((item) => item.id === ticketId)
  if (!current) return
  const previous = current.priority
  current.priority = priority
  current.updatedAt = now()
  db.messages.push({
    id: id(),
    ticketId,
    authorId: 'system',
    authorName: 'System',
    kind: 'system',
    body: `${actor.name} changed the ticket priority: ${previous} â†’ ${priority}.`,
    createdAt: now(),
  })
  db.audits.unshift({ id: id(), createdAt: now(), actorId: actor.id, actorName: actor.name, objectType: 'ticket', objectId: ticketId, action: 'priority', details: `${previous} â†’ ${priority}` })
  save(db)
  emit()
}

export async function updateTicket(
  ticketId: string,
  patch: Partial<Pick<Ticket, 'priority' | 'deptId' | 'topicId' | 'source' | 'dueAt' | 'slaId' | 'subject'>> & { topicName?: string },
  actor: User,
) {
  const db = load()
  const ticket = db.tickets.find((t) => t.id === ticketId)
  if (!ticket) return
  const { topicName, ...ticketPatch } = patch
  const department = ticketPatch.deptId ? db.departments.find((d) => d.id === ticketPatch.deptId)?.name : undefined
  const topic = topicName || (ticketPatch.topicId ? db.topics.find((t) => t.id === ticketPatch.topicId)?.name : undefined)
  if (/^\d+$/.test(ticket.id)) {
    const mirror: Parameters<typeof updateApiTicket>[1] = {}
    if (ticketPatch.priority) mirror.priority = ticketPatch.priority
    if (ticketPatch.subject) mirror.subject = ticketPatch.subject
    if (department) mirror.department = department
    if (topic) mirror.topic = topic
    if (Object.keys(mirror).length) await updateApiTicket(ticket.number, mirror)
  }
  const currentDb = load()
  const current = currentDb.tickets.find((item) => item.id === ticketId)
  if (!current) return
  const before = { ...current }
  Object.assign(current, ticketPatch)
  current.updatedAt = now()
  const changes = Object.keys(ticketPatch)
    .map((key) => `${key}: ${(before as unknown as Record<string, unknown>)[key] ?? 'â€”'} â†’ ${(current as unknown as Record<string, unknown>)[key] ?? 'â€”'}`)
    .join('; ')
  currentDb.messages.push({
    id: id(),
    ticketId,
    authorId: 'system',
    authorName: 'System',
    kind: 'system',
    body: `${actor.name} updated ticket (${changes}).`,
    createdAt: now(),
  })
  currentDb.audits.unshift({
    id: id(),
    createdAt: now(),
    actorId: actor.id,
    actorName: actor.name,
    objectType: 'ticket',
    objectId: ticketId,
    action: 'update',
    details: changes,
  })
  save(currentDb)
  emit()
}

export function setTicketBranch(ticketId: string, branchId: string, branchName: string, actor: User) {
  const db = load()
  const ticket = db.tickets.find((item) => item.id === ticketId)
  if (!ticket) return
  const previousName = ticket.branchName || 'â€”'
  ticket.branchId = branchId || undefined
  ticket.branchName = branchName || undefined
  ticket.updatedAt = now()
  const nextName = branchName || 'â€”'
  db.messages.push({
    id: id(), ticketId, authorId: 'system', authorName: 'System', kind: 'system',
    body: `${actor.name} changed the ticket branch: ${previousName} â†’ ${nextName}.`, createdAt: now(),
  })
  db.audits.unshift({ id: id(), createdAt: now(), actorId: actor.id, actorName: actor.name, objectType: 'ticket', objectId: ticketId, action: 'branch', details: `${previousName} â†’ ${nextName}` })
  save(db)
  emit()
}

export function addCollaborator(ticketId: string, userId: string, actor: User) {
  const db = load()
  const ticket = db.tickets.find((t) => t.id === ticketId)
  const person = db.users.find((u) => u.id === userId)
  if (!ticket || !person) return
  ticket.collaboratorIds = [...new Set([...(ticket.collaboratorIds ?? []), userId])]
  ticket.collaborators = [...(ticket.collaborators || []), { name: person.name, email: person.email, active: true }]
  ticket.updatedAt = now()
  db.messages.push({
    id: id(),
    ticketId,
    authorId: 'system',
    authorName: 'System',
    kind: 'system',
    body: `${actor.name} added collaborator ${person.name}.`,
    createdAt: now(),
  })
  save(db)
  emit()
  void saveApiTicketCollaborators(ticket.number, ticket.collaborators)
}

export function removeCollaborator(ticketId: string, userId: string, actor: User) {
  const db = load()
  const ticket = db.tickets.find((t) => t.id === ticketId)
  if (!ticket) return
  ticket.collaboratorIds = (ticket.collaboratorIds ?? []).filter((idValue) => idValue !== userId)
  ticket.collaborators = (ticket.collaborators || []).filter((person) => person.email.toLowerCase() !== db.users.find((u) => u.id === userId)?.email.toLowerCase())
  ticket.updatedAt = now()
  db.messages.push({
    id: id(),
    ticketId,
    authorId: 'system',
    authorName: 'System',
    kind: 'system',
    body: `${actor.name} removed a collaborator.`,
    createdAt: now(),
  })
  save(db)
  emit()
  void saveApiTicketCollaborators(ticket.number, ticket.collaborators)
}

export async function setTicketCollaborators(ticketId: string, collaborators: Array<{ name: string; email: string; active: boolean }>, actor: User) {
  const db = load()
  const ticket = db.tickets.find((item) => item.id === ticketId)
  if (!ticket) throw new Error('Ticket could not be found.')
  ticket.collaborators = collaborators.map((item) => ({ ...item, email: item.email.trim().toLowerCase() }))
  ticket.collaboratorIds = ticket.collaborators.filter((item) => item.active).map((item) => db.users.find((person) => person.email.toLowerCase() === item.email)?.id).filter((value): value is string => Boolean(value))
  ticket.updatedAt = now()
  db.messages.push({ id: id(), ticketId, authorId: 'system', authorName: 'System', kind: 'system', body: `Collaborators updated by ${actor.name}.`, createdAt: now() })
  save(db)
  emit()
  await saveApiTicketCollaborators(ticket.number, ticket.collaborators)
}

export async function bulkTickets(ids: string[], patch: { status?: TicketStatus; assigneeId?: string | null }, actor: User) {
  const db = load()
  const updated: Ticket[] = []
  for (const ticketId of ids) {
    const ticket = db.tickets.find((t) => t.id === ticketId)
    if (!ticket) continue
    if (patch.status) {
      ticket.status = patch.status
      ticket.statusId = undefined
      ticket.statusName = undefined
    }
    if (patch.assigneeId !== undefined) ticket.assigneeId = patch.assigneeId || undefined
    ticket.updatedAt = now()
    updated.push(ticket)
  }
  db.audits.unshift({
    id: id(),
    createdAt: now(),
    actorId: actor.id,
    actorName: actor.name,
    objectType: 'ticket',
    objectId: ids.join(','),
    action: 'bulk',
    details: `Updated ${ids.length} ticket(s): ${JSON.stringify(patch)}`,
  })
  save(db)
  emit()
  await Promise.allSettled(updated.map((ticket) => {
    const assignee = ticket.assigneeId ? db.users.find((person) => person.id === ticket.assigneeId) : undefined
    return updateApiTicket(ticket.number, {
      ...(patch.status ? { status: patch.status } : {}),
      ...(patch.assigneeId !== undefined ? { assignee: assignee?.name ?? '', assigneeEmail: assignee?.email ?? '' } : {}),
    })
  }))
}

export function searchHelpdesk(query: string) {
  const db = load()
  const q = query.trim().toLowerCase()
  if (!q) return { tickets: [] as Ticket[], users: [] as User[], faqs: [] as Faq[] }
  return {
    tickets: db.tickets.filter((t) => `${t.number} ${t.subject}`.toLowerCase().includes(q)).slice(0, 25),
    users: db.users.filter((u) => `${u.name} ${u.email}`.toLowerCase().includes(q)).slice(0, 15),
    faqs: db.faqs.filter((f) => f.question.toLowerCase().includes(q) || f.answer.toLowerCase().includes(q)).slice(0, 15),
  }
}

export function resetPassword(email: string, nextPassword: string, staff?: boolean) {
  const db = load()
  const user = db.users.find((u) => u.email.toLowerCase() === email.toLowerCase())
  if (!user) throw new Error('No account uses that email.')
  if (staff && user.role === 'client') throw new Error('Use the client portal to reset an end-user password.')
  if (!staff && user.role !== 'client') throw new Error('Use the staff sign-in page to reset an agent password.')
  if (staff && !db.settings.agentPwReset) throw new Error('Agent password reset is disabled.')
  user.password = nextPassword
  db.logs.unshift({
    id: id(),
    createdAt: now(),
    type: 'info',
    title: 'Password reset',
    body: `Password reset for ${user.email}.`,
    ip: '127.0.0.1',
  })
  save(db)
  emit()
  return user
}

export function ticketsToCsv(tickets: Ticket[]) {
  const db = load()
  const header = ['Number', 'Subject', 'Status', 'Priority', 'Department', 'User', 'Updated']
  const rows = tickets.map((t) => [
    t.number,
    `"${t.subject.replaceAll('"', '""')}"`,
    t.status,
    t.priority,
    db.departments.find((d) => d.id === t.deptId)?.name ?? '',
    db.users.find((u) => u.id === t.userId)?.email ?? '',
    t.updatedAt,
  ])
  return [header.join(','), ...rows.map((r) => r.join(','))].join('\n')
}

export function matchQueue(tickets: Ticket[], queue: string, agentId?: string, definitions: TicketQueue[] = []) {
  const custom = definitions.find((q) => q.id === queue && q.enabled)
  if (custom) {
    const filtered = tickets.filter((ticket) => custom.criteria.every((criterion) => {
      const expected = criterion.value ?? ''
      let value: unknown
      if (criterion.field === 'assignee') {
        if (expected === 'mine') return ticket.assigneeId === agentId
        if (expected === 'unassigned') return !ticket.assigneeId
        return criterion.op === 'eq' ? ticket.assigneeId === expected : ticket.assigneeId !== expected
      }
      if (criterion.field === 'overdue') value = Boolean(ticket.overdue)
      else value = (ticket as unknown as Record<string, unknown>)[criterion.field]
      if (criterion.op === 'empty') return value === undefined || value === '' || value === false
      if (criterion.op === 'notempty') return value !== undefined && value !== '' && value !== false
      if (criterion.op === 'in') return expected.split(',').map((v) => v.trim()).includes(String(value ?? ''))
      if (criterion.field === 'overdue') return criterion.op === 'eq' ? Boolean(ticket.overdue) === (expected === 'true') : Boolean(ticket.overdue) !== (expected === 'true')
      return criterion.op === 'eq' ? String(value ?? '') === expected : String(value ?? '') !== expected
    }))
    return filtered.sort((a,b) => {
      switch (custom.sortBy) {
        case 'updatedAsc': return a.updatedAt.localeCompare(b.updatedAt)
        case 'createdDesc': return b.createdAt.localeCompare(a.createdAt)
        case 'priorityDesc': return ['low','normal','high','emergency'].indexOf(b.priority)-['low','normal','high','emergency'].indexOf(a.priority)
        case 'numberAsc': return a.number.localeCompare(b.number)
        default: return b.updatedAt.localeCompare(a.updatedAt)
      }
    })
  }
  const list = [...tickets].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  switch (queue) {
    case 'mine': return list.filter((t) => t.assigneeId === agentId && t.status !== 'closed')
    case 'unassigned': return list.filter((t) => !t.assigneeId && t.status !== 'closed')
    case 'overdue': return list.filter((t) => t.overdue && t.status !== 'closed')
    case 'closed': return list.filter((t) => t.status === 'closed')
    case 'pending': return list.filter((t) => t.status === 'pending')
    case 'all': return list
    default: return list.filter((t) => t.status === 'open')
  }
}

function ticketEvent(ticketId: string, body: string) {
  return {
    id: id(),
    ticketId,
    authorId: 'system',
    authorName: 'System',
    kind: 'system' as const,
    body,
    createdAt: now(),
  }
}

export async function acquireTicketLock(ticketId: string, actor: User) {
  const db = load()
  if (!db.settings.autolock) return
  const ticket = db.tickets.find((t) => t.id === ticketId)
  if (!ticket || ticket.lockedBy) return
  if (/^\d+$/.test(ticketId)) {
    try {
      await lockApiTicket(ticket.number)
    } catch (error) {
      if (error instanceof ApiRequestError) {
        await hydrateTicketDetailFromApi(ticketId).catch(() => undefined)
        throw error
      }
    }
  }
  const currentDb = load()
  const current = currentDb.tickets.find((t) => t.id === ticketId)
  if (!current || current.lockedBy) return
  current.lockedBy = actor.id
  currentDb.messages.push(ticketEvent(ticketId, `Ticket locked by ${actor.name}.`))
  save(currentDb)
  emit()
}

export async function releaseTicketLock(ticketId: string, actor: User) {
  const db = load()
  const ticket = db.tickets.find((t) => t.id === ticketId)
  if (!ticket?.lockedBy || ticket.lockedBy !== actor.id) return
  if (/^\d+$/.test(ticketId)) {
    try {
      await unlockApiTicket(ticket.number)
    } catch {
      // The local snapshot lock is still cleared below so leaving the page is never blocked.
    }
  }
  const currentDb = load()
  const current = currentDb.tickets.find((t) => t.id === ticketId)
  if (!current || current.lockedBy !== actor.id) return
  current.lockedBy = undefined
  currentDb.messages.push(ticketEvent(ticketId, `Lock released by ${actor.name}.`))
  save(currentDb)
  emit()
}

export async function releaseTicket(ticketId: string, actor: User) {
  await assignTicket(ticketId, undefined, actor)
}

export async function markOverdue(ticketId: string, actor: User, overdue = true) {
  const db = load()
  const ticket = db.tickets.find((t) => t.id === ticketId)
  if (!ticket) return
  await updateApiTicket(ticket.number, { overdue })
  ticket.overdue = overdue
  ticket.updatedAt = now()
  db.messages.push(ticketEvent(ticketId, `${actor.name} marked ticket ${overdue ? 'overdue' : 'not overdue'}.`))
  save(db)
  emit()
}

export function setTicketDepartment(ticketId: string, deptId: string, deptName: string, actor: User) {
  const db = load()
  const ticket = db.tickets.find((item) => item.id === ticketId)
  const name = deptName || db.departments.find((d) => d.id === deptId)?.name || deptId
  if (!ticket) return
  const previous = db.departments.find((d) => d.id === ticket.deptId)?.name ?? ticket.deptId
  ticket.deptId = deptId
  ticket.assigneeId = undefined
  ticket.updatedAt = now()
  db.messages.push(ticketEvent(ticketId, `${actor.name} transferred ticket from ${previous} to ${name}.`))
  db.audits.unshift({ id: id(), createdAt: now(), actorId: actor.id, actorName: actor.name, objectType: 'ticket', objectId: ticketId, action: 'transfer', details: `${previous} â†’ ${name}` })
  save(db)
  emit()
}

export async function transferTicket(ticketId: string, deptId: string, actor: User) {
  const db = load()
  const ticket = db.tickets.find((t) => t.id === ticketId)
  const dept = db.departments.find((d) => d.id === deptId)
  if (!ticket || !dept) return
  if (/^\d+$/.test(ticket.id)) await updateApiTicket(ticket.number, { department: dept.name, assigneeEmail: '' })
  setTicketDepartment(ticketId, deptId, dept.name, actor)
}

export async function deleteTicket(ticketId: string, actor: User) {
  const db = load()
  const ticket = db.tickets.find((t) => t.id === ticketId)
  if (!ticket) return
  await deleteApiTicket(ticket.number)
  db.tickets = db.tickets.filter((t) => t.id !== ticketId)
  db.messages = db.messages.filter((m) => m.ticketId !== ticketId)
  db.tasks = db.tasks.map((t) => (t.ticketId === ticketId ? { ...t, ticketId: undefined } : t))
  db.audits.unshift({
    id: id(),
    createdAt: now(),
    actorId: actor.id,
    actorName: actor.name,
    objectType: 'ticket',
    objectId: ticketId,
    action: 'delete',
    details: `Deleted ticket #${ticket.number}`,
  })
  save(db)
  emit()
}

export async function banEmailFromTicket(ticketId: string, actor: User) {
  const db = load()
  const ticket = db.tickets.find((t) => t.id === ticketId)
  const owner = ticket ? db.users.find((u) => u.id === ticket.userId) : undefined
  if (!owner) return
  const result = await banApiTicketEmail(ticket!.number)
  if (!db.banlist.some((b) => b.email.toLowerCase() === owner.email.toLowerCase())) {
    db.banlist.push({ id: id(), email: result.email, reason: result.reason })
  }
  db.messages.push(ticketEvent(ticketId, `${actor.name} banned ${owner.email}.`))
  save(db)
  emit()
}

export async function mergeTickets(primaryId: string, secondaryNumber: string, actor: User) {
  const db = load()
  const primary = db.tickets.find((t) => t.id === primaryId)
  const secondary = db.tickets.find((t) => t.number === secondaryNumber.trim())
  if (!primary || !secondary || primary.id === secondary.id) throw new Error('Select a different ticket number to merge.')
  if (/^\d+$/.test(primary.id) && /^\d+$/.test(secondary.id)) {
    await mergeApiTicket(primary.number, secondary.number)
    await hydrateTicketDetailFromApi(primary.id)
    await hydrateTicketDetailFromApi(secondary.id)
    return
  }
  const moved = db.messages.filter((m) => m.ticketId === secondary.id)
  for (const msg of moved) msg.ticketId = primary.id
  primary.mergedTicketIds = [...(primary.mergedTicketIds ?? []), secondary.id]
  secondary.parentTicketId = primary.id
  secondary.status = 'closed'
  secondary.updatedAt = now()
  primary.updatedAt = now()
  db.messages.push(
    ticketEvent(primary.id, `${actor.name} merged ticket #${secondary.number} into this ticket.`),
    ticketEvent(secondary.id, `Merged into ticket #${primary.number} by ${actor.name}.`),
  )
  save(db)
  emit()
}

export async function reopenTicket(ticketId: string, actor: User) {
  await setStatus(ticketId, 'open', actor)
}

export function editClientTicket(ticketId: string, userId: string, patch: { subject?: string; topicId?: string; branchId?: string; branchName?: string }) {
  const db = load()
  const ticket = db.tickets.find((t) => t.id === ticketId)
  const user = db.users.find((u) => u.id === userId)
  if (!ticket || !user || ticket.userId !== userId) throw new Error('You can only edit your own tickets.')
  if (ticket.status === 'closed') throw new Error('Closed tickets cannot be edited.')
  if (patch.subject) ticket.subject = patch.subject.trim()
  if (patch.topicId) {
    const topic = db.topics.find((t) => t.id === patch.topicId)
    if (!topic?.active) throw new Error('Invalid help topic.')
    ticket.topicId = patch.topicId
    ticket.deptId = topic.deptId
  }
  if (patch.branchId !== undefined) {
    ticket.branchId = patch.branchId || undefined
    ticket.branchName = patch.branchName || undefined
  }
  ticket.updatedAt = now()
  db.messages.push(ticketEvent(ticketId, `${user.name} updated ticket details.`))
  save(db)
  emit()
}

export function tasksForTicket(ticketId: string) {
  return load().tasks.filter((t) => t.ticketId === ticketId)
}
