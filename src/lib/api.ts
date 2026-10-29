import type { Ticket, User, Database } from '../types'

export interface ApiHealth { ok: boolean; mailConfigured: boolean; storage: string }
export interface ApiPersistedTicket { id: string; number: string; subject: string; status: Ticket['status']; priority: Ticket['priority']; source: string; topic: string; department: string; requesterName: string; requesterEmail: string; employeeId?: string; branchId?: string; branchName?: string; assignee?: string; assigneeEmail?: string; collaborators?: Array<{ userId: string; name: string; email: string; active: boolean }>; fromEmail?: string; overdue: boolean; createdAt: string; updatedAt: string }
export interface ApiPersistedMessage { id: string; ticketNumber: string; author: string; authorEmail: string; kind: 'client' | 'agent' | 'collaborator' | 'system'; internal: boolean; body: string; attachments: string[]; attachmentFiles?: Array<{ id: string; name: string }>; recipients?: string[]; createdAt: string }

export class ApiRequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
    this.name = 'ApiRequestError'
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers)
  if (!(init?.body instanceof FormData)) headers.set('content-type', 'application/json')
  const response = await fetch('/api/v1' + path, { ...init, headers })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new ApiRequestError(data.error || 'API request failed (' + response.status + ').', response.status)
  return data as T
}
function background(promise: Promise<unknown>) {
  void promise.catch((error: unknown) => console.warn('[helpdesk API]', error instanceof Error ? error.message : error))
}
function currentSessionHeaders(): Record<string, string> {
  try {
    const token = (JSON.parse(localStorage.getItem('osticket-react-session') || '{}') as { accessToken?: string }).accessToken
    return token ? { 'x-user-session': token } : Object.create(null) as Record<string, string>
  } catch { return Object.create(null) as Record<string, string> }
}
export function apiHealth() { return request<ApiHealth>('/health') }
export function listApiTickets(token?: string) { return request<{ tickets: Array<Record<string, any>> }>('/tickets', { headers: token ? { 'x-user-session': token } : currentSessionHeaders() }) }
export function listApiAccountTickets(token: string) {
  return request<{ tickets: ApiPersistedTicket[]; messages: ApiPersistedMessage[] }>('/users/tickets', { headers: { 'x-user-session': token } })
}
export interface ApiAssignableStaff { id: string; name: string; email: string; phone?: string; role: 'agent' | 'admin'; active: boolean; title?: string; deptId?: string; roleId?: string }
export function listApiAssignableStaff(token: string) {
  return request<{ staff: ApiAssignableStaff[] }>('/staff/assignable', { headers: { 'x-user-session': token } })
}
export interface ApiDepartmentMember { id: string; name: string; departmentId?: string; primary: boolean; roleId: string; alerts: boolean }
export interface ApiDepartment { id: string; name: string; parentId?: string; parentName?: string; status: 'active' | 'disabled' | 'archived'; type: 'public' | 'private'; signature: string; emailId: string; emailName?: string; managerId: string; managerName?: string; slaId: string; slaName?: string; scheduleId: string; scheduleName?: string; templateId: string; templateName?: string; autoresponderEmailId: string; assignment: 'all' | 'members' | 'primary'; disableAutoClaim: boolean; disableReopenAutoAssign: boolean; alertRecipients: number; ticketAutoResponse: boolean; messageAutoResponse: boolean; primaryMembers: ApiDepartmentMember[]; extendedMembers: ApiDepartmentMember[]; active?: boolean }
export interface ApiDepartmentOptions { departments: ApiDepartment[]; staff: Array<{ id: string; name: string; departmentId: string }>; slas: Array<{ id: string; name: string }>; schedules: Array<{ id: string; name: string }>; emails: Array<{ id: string; name: string }>; templates: Array<{ id: string; name: string }>; roles: Array<{ id: string; name: string }> }
export interface ApiFaqCategory { id: string; name: string; description: string; published: boolean }
export interface ApiFaqArticle { id: string; categoryId: string; question: string; answer: string; published: boolean }
export function listApiFaqArticles() {
  return request<{ articles: ApiFaqArticle[] }>('/admin/faq-articles', { headers: currentSessionHeaders() }).then(result => result.articles)
}
export function createApiFaqArticle(input: Omit<ApiFaqArticle, 'id'>) {
  return request<{ article: ApiFaqArticle }>('/admin/faq-articles', { method: 'POST', headers: currentSessionHeaders(), body: JSON.stringify(input) }).then(result => result.article)
}
export function updateApiFaqArticle(id: string, input: Omit<ApiFaqArticle, 'id'>) {
  return request<{ article: ApiFaqArticle }>('/admin/faq-articles/' + encodeURIComponent(id), { method: 'PUT', headers: currentSessionHeaders(), body: JSON.stringify(input) }).then(result => result.article)
}
export function deleteApiFaqArticle(id: string) {
  return request<{ deleted: boolean }>('/admin/faq-articles/' + encodeURIComponent(id), { method: 'DELETE', headers: currentSessionHeaders() })
}
export function createApiFaqCategory(input: Omit<ApiFaqCategory, 'id'>) {
  return request<{ category: ApiFaqCategory }>('/admin/faq-categories', { method: 'POST', headers: currentSessionHeaders(), body: JSON.stringify(input) }).then(result => result.category)
}
export function updateApiFaqCategory(id: string, input: Omit<ApiFaqCategory, 'id'>) {
  return request<{ category: ApiFaqCategory }>('/admin/faq-categories/' + encodeURIComponent(id), { method: 'PUT', headers: currentSessionHeaders(), body: JSON.stringify(input) }).then(result => result.category)
}
export function deleteApiFaqCategory(id: string) {
  return request<{ deleted: boolean }>('/admin/faq-categories/' + encodeURIComponent(id), { method: 'DELETE', headers: currentSessionHeaders() })
}
export function listApiStaffDepartments(token: string) {
  return request<{ departments: ApiDepartment[] }>('/staff/departments', { headers: { 'x-user-session': token } })
}
export function listApiDepartments(token: string) {
  return request<ApiDepartmentOptions>('/admin/departments', { headers: { 'x-user-session': token } })
}
export function createApiDepartment(input: Partial<ApiDepartment> & Pick<ApiDepartment, 'name'>, token: string) {
  return request<{ department: ApiDepartment }>('/admin/departments', {
    method: 'POST',
    headers: { 'x-user-session': token },
    body: JSON.stringify(input),
  })
}
export function updateApiDepartment(input: ApiDepartment, token: string) {
  return request<{ department: ApiDepartment }>('/admin/departments', { method: 'PUT', headers: { 'x-user-session': token }, body: JSON.stringify(input) })
}
export function deleteApiDepartment(id: string, token: string) {
  return request<{ deleted: boolean }>('/admin/departments', { method: 'DELETE', headers: { 'x-user-session': token }, body: JSON.stringify({ id }) })
}
export interface ApiSlaPlan { id: string; name: string; graceHours: number; active: boolean; transient: boolean; disableAlerts: boolean; scheduleId: string; scheduleName?: string; notes: string }
export interface ApiSlaOptions { slas: ApiSlaPlan[]; schedules: Array<{ id: string; name: string; timezone: string; description: string }> }
export function listApiSlaPlans(token: string) { return request<ApiSlaOptions>('/admin/sla-plans', { headers: { 'x-user-session': token } }) }
export function createApiSlaPlan(input: Omit<ApiSlaPlan, 'id' | 'scheduleName'>, token: string) { return request<{ sla: ApiSlaPlan }>('/admin/sla-plans', { method: 'POST', headers: { 'x-user-session': token }, body: JSON.stringify(input) }).then(r => r.sla) }
export function updateApiSlaPlan(id: string, input: Omit<ApiSlaPlan, 'id' | 'scheduleName'>, token: string) { return request<{ sla: ApiSlaPlan }>('/admin/sla-plans/' + encodeURIComponent(id), { method: 'PUT', headers: { 'x-user-session': token }, body: JSON.stringify(input) }).then(r => r.sla) }
export function deleteApiSlaPlan(id: string, token: string) { return request<{ deleted: boolean }>('/admin/sla-plans/' + encodeURIComponent(id), { method: 'DELETE', headers: { 'x-user-session': token } }) }
export interface ApiHelpTopic { id: string; name: string; deptId: string; departmentName?: string; priority: string; slaId?: string; slaName?: string; hint?: string; active: boolean }
export interface ApiHelpTopicOptions {
  topics: ApiHelpTopic[]
  departments: Array<{ id: string; name: string }>
  slas: Array<{ id: string; name: string }>
  priorities: string[]
}
export function listApiPublicHelpTopics() {
  return request<{ topics: ApiHelpTopic[]; departments: Array<{ id: string; name: string }> }>('/help-topics')
}
export interface ApiBranch { id: string; name: string; active?: boolean }
export function listApiBranches() {
  return request<{ branches: ApiBranch[] }>('/branches')
}
export function listApiAdminBranches() {
  return request<{ branches: ApiBranch[] }>('/admin/branches', { headers: currentSessionHeaders() }).then(result => result.branches)
}
export function createApiBranch(input: Pick<ApiBranch, 'name'> & { active: boolean }) {
  return request<{ branch: ApiBranch }>('/admin/branches', { method: 'POST', headers: currentSessionHeaders(), body: JSON.stringify(input) }).then(result => result.branch)
}
export function updateApiBranch(id: string, input: Pick<ApiBranch, 'name'> & { active: boolean }) {
  return request<{ branch: ApiBranch }>('/admin/branches/' + encodeURIComponent(id), { method: 'PUT', headers: currentSessionHeaders(), body: JSON.stringify(input) }).then(result => result.branch)
}
export function deleteApiBranch(id: string) {
  return request<{ deleted: boolean }>('/admin/branches/' + encodeURIComponent(id), { method: 'DELETE', headers: currentSessionHeaders() })
}
export function getApiAppState(token: string) {
  return request<{ state: Partial<Database> | null }>('/app-state', { headers: { 'x-user-session': token } })
}
export function getApiPublicAppState() {
  return request<{ state: Partial<Database> | null }>('/public-state')
}
export function saveApiAppState(state: Partial<Database>, token: string) {
  return request<{ saved: boolean }>('/app-state', { method: 'PUT', headers: { 'x-user-session': token }, body: JSON.stringify({ state }) })
}
export function listApiHelpTopics(token: string) {
  return request<ApiHelpTopicOptions>('/admin/help-topics', { headers: { 'x-user-session': token } })
}
export function createApiHelpTopic(input: Partial<ApiHelpTopic> & Pick<ApiHelpTopic, 'name'>, token: string) {
  return request<{ topic: ApiHelpTopic }>('/admin/help-topics', { method: 'POST', headers: { 'x-user-session': token }, body: JSON.stringify(input) })
}
export function updateApiHelpTopic(input: ApiHelpTopic, token: string) {
  return request<{ topic: ApiHelpTopic }>('/admin/help-topics', { method: 'PUT', headers: { 'x-user-session': token }, body: JSON.stringify(input) })
}
export function deleteApiHelpTopic(id: string, token: string) {
  return request<{ deleted: boolean }>('/admin/help-topics', { method: 'DELETE', headers: { 'x-user-session': token }, body: JSON.stringify({ id }) })
}
export interface ApiStaffTicketOptions {
  statuses: Ticket['status'][]
  topics: Array<{ id: string; name: string }>
  priorities: Ticket['priority'][]
}
export function getApiStaffTicketOptions(token: string) {
  return request<ApiStaffTicketOptions>('/staff/ticket-options', { headers: { 'x-user-session': token } })
}
export function updateApiTicket(number: string, patch: { status?: Ticket['status']; priority?: Ticket['priority']; assignee?: string; assigneeEmail?: string; department?: string; topic?: string; overdue?: boolean; subject?: string }) { return request('/tickets/' + encodeURIComponent(number), { method: 'PATCH', headers: currentSessionHeaders(), body: JSON.stringify(patch) }) }
export function deleteApiTicket(number: string) { return request<{ deleted: boolean }>('/tickets/' + encodeURIComponent(number), { method: 'DELETE', headers: currentSessionHeaders() }) }
export function banApiTicketEmail(number: string) { return request<{ banned: boolean; email: string; reason: string }>('/tickets/' + encodeURIComponent(number) + '/ban-email', { method: 'POST', headers: currentSessionHeaders() }) }
export function updateApiTicketBranch(number: string, branchId: string) {
  return request<{ ticket: { branchId?: string; branchName?: string } }>('/tickets/' + encodeURIComponent(number) + '/branch', { method: 'PATCH', headers: currentSessionHeaders(), body: JSON.stringify({ branchId }) })
}
export function updateApiClientTicketBranch(number: string, branchId: string) {
  return request<{ ticket: { branchId?: string; branchName?: string } }>('/users/tickets/' + encodeURIComponent(number) + '/branch', { method: 'PATCH', headers: currentSessionHeaders(), body: JSON.stringify({ branchId }) })
}
export function mirrorTicketUpdate(number: string, patch: Parameters<typeof updateApiTicket>[1]) {
  background(updateApiTicket(number, patch))
}
export function saveApiTicketCollaborators(number: string, collaborators: NonNullable<Ticket['collaborators']>) {
  return request<{ collaborators: NonNullable<Ticket['collaborators']> }>('/tickets/' + encodeURIComponent(number) + '/collaborators', { method: 'PUT', headers: currentSessionHeaders(), body: JSON.stringify({ collaborators }) })
}
export function saveApiTicketVisibility(hideCollaboratorTickets: boolean) {
  return request<{ saved: boolean }>('/admin/ticket-settings', { method: 'PATCH', headers: currentSessionHeaders(), body: JSON.stringify({ hideCollaboratorTickets }) })
}
export function sendMailTest(to: string) { return request<{ sent: boolean; to: string }>('/admin/mail-test', { method: 'POST', headers: currentSessionHeaders(), body: JSON.stringify({ to }) }) }
export function getMailLog() { return request<{ messages: Array<Record<string, unknown>> }>('/admin/mail-log', { headers: currentSessionHeaders() }) }
export function registerApiUser(input: { name: string; email: string; password: string; phone?: string; employeeId?: string; branchId?: string }) {
  return request<{ submitted: boolean; verificationStatus: 'pending' }>('/users/register', { method: 'POST', body: JSON.stringify(input) })
}
export interface ApiClientUser { id: string; name: string; email: string; phone?: string; employeeId?: string; branchId?: string; branchName?: string; org?: string; title?: string; deptId?: string; roleId?: string }
export function apiClientLogin(email: string, password: string) {
  return request<{ found: boolean; status?: 'pending' | 'approved' | 'rejected' | 'disabled'; user?: ApiClientUser; sessionToken?: string }>('/users/login', { method: 'POST', body: JSON.stringify({ email, password }) })
}
export function apiStaffLogin(email: string, password: string) {
  return request<{ user: ApiClientUser & { role: 'agent' | 'admin' }; sessionToken: string }>('/staff/login', { method: 'POST', body: JSON.stringify({ email, password }) })
}
export function apiValidateClientSession(token: string) {
  return request<{ status: 'approved'; role: User['role']; user: ApiClientUser & { role: User['role'] } }>('/users/session', { headers: { 'x-user-session': token } })
}
export function apiValidateStaffSession(token: string) {
  return request<{ status: 'approved'; role: 'agent' | 'admin'; user: ApiClientUser & { role: 'agent' | 'admin' } }>('/staff/session', { headers: { 'x-user-session': token } })
}
export function requestPasswordReset(email: string) { return request<{ sent: boolean }>('/auth/password-reset/request', { method: 'POST', body: JSON.stringify({ email }) }) }
export function completePasswordReset(token: string, password: string) { return request<{ updated: boolean }>('/auth/password-reset/complete', { method: 'POST', body: JSON.stringify({ token, password }) }) }
export function updateApiAccountPassword(token: string, password: string) {
  return request<{ updated: boolean }>('/users/password', { method: 'PATCH', headers: { 'x-user-session': token }, body: JSON.stringify({ password }) })
}
export const updateApiClientPassword = updateApiAccountPassword
export function updateApiProfile(token: string, input: { name: string; phone: string; org: string; title?: string }) {
  return request<{ user: ApiClientUser & { role: User['role'] } }>('/users/profile', { method: 'PATCH', headers: { 'x-user-session': token }, body: JSON.stringify(input) })
}
export interface ApiStaffAccount extends ApiClientUser { role: 'agent' | 'admin'; active: boolean; deptName?: string; departmentAccess?: string[]; roleName?: string }
export function listApiStaff(token: string) {
  return request<{ staff: ApiStaffAccount[]; departments: Array<{ id: string; name: string }>; roles: Array<{ id: string; name: string }> }>('/admin/staff', { headers: { 'x-user-session': token } })
}
export interface ApiOrganization { id: string; name: string; manager?: string; status: number; domain?: string; address?: string; phone?: string; website?: string; notes?: string }
export interface ApiDirectoryUser extends ApiClientUser { role: 'client'; orgId: string }
export function listApiOrganizations(token: string) {
  return request<{ organizations: ApiOrganization[] }>('/admin/organizations', { headers: { 'x-user-session': token } })
}
export function saveApiOrganization(input: Partial<ApiOrganization> & Pick<ApiOrganization, 'name'>, token: string) {
  return request<{ organization: ApiOrganization }>('/admin/organizations', { method: input.id ? 'PUT' : 'POST', headers: { 'x-user-session': token }, body: JSON.stringify(input) })
}
export function deleteApiOrganization(id: string, token: string) {
  return request<{ deleted: boolean }>('/admin/organizations/' + encodeURIComponent(id), { method: 'DELETE', headers: { 'x-user-session': token } })
}
export function listApiDirectoryUsers(token: string) {
  return request<{ users: ApiDirectoryUser[] }>('/admin/directory-users', { headers: { 'x-user-session': token } })
}
export function saveApiDirectoryUser(input: { name: string; email: string; phone?: string; org?: string; orgId?: string }, token: string) {
  return request<{ user: ApiDirectoryUser }>('/admin/directory-users', { method: 'POST', headers: { 'x-user-session': token }, body: JSON.stringify(input) })
}
export function listApiUsers(token: string) {
  return request<{ users: Array<ApiClientUser & { verificationStatus: 'pending' | 'approved' | 'rejected'; registeredAt: string | null }> }>('/admin/users', { headers: { 'x-user-session': token } })
}
export function updateApiUserVerification(user: Pick<User, 'name' | 'email'>, status: 'approved' | 'rejected', actorName: string, token: string) {
  return request<{ updated: boolean; verificationStatus: 'approved' | 'rejected' }>('/admin/users/verification', { method: 'PATCH', headers: { 'x-user-session': token }, body: JSON.stringify({ ...user, status, actorName }) })
}
export function saveApiStaff(input: { staffId?: string; name: string; email: string; phone?: string; password?: string; role: 'agent' | 'admin'; active: boolean; title?: string; deptId?: string; roleId?: string; deptName?: string; roleName?: string; departmentAccess?: string[] }, token: string) {
  return request<{ saved: boolean; id: string }>('/admin/staff', { method: 'POST', headers: { 'x-user-session': token }, body: JSON.stringify(input) })
}
export async function mirrorTicket(ticket: Ticket, requester: User, firstMessage: string, db: Database, attachments: File[] = []) {
  const assignee = db.users.find(u => u.id === ticket.assigneeId)
  const payload = { id: ticket.id, number: ticket.number, subject: ticket.subject, priority: ticket.priority, source: ticket.source, employeeId: ticket.employeeId, branchId: ticket.branchId, assignee: assignee?.name || '', assigneeEmail: assignee?.email || '', department: db.departments.find(d => d.id === ticket.deptId)?.name, topic: db.topics.find(t => t.id === ticket.topicId)?.name, requesterName: requester.name, requesterEmail: requester.email, message: firstMessage, collaborators: ticket.collaborators || [], fromEmail: ticket.fromEmail, collaboratorNotice: ticket.collaboratorNotice }
  let body: BodyInit = JSON.stringify(payload)
  if (attachments.length) {
    const form = new FormData()
    form.set('ticket', JSON.stringify(payload))
    for (const file of attachments) form.append('files', file, file.name)
    body = form
  }
  const result = await request<{ accessToken?: string }>('/tickets', { method: 'POST', headers: currentSessionHeaders(), body })
  if (result.accessToken) localStorage.setItem('osticket-api-access-' + ticket.number, result.accessToken)
  return result
}
export function mirrorReply(input: { ticket: Ticket; owner: User; author: User; body: string; initialMessage: string; db: Database; internal?: boolean; status?: Ticket['status']; recipients?: string[]; fromEmail?: string; collaboratorResponse?: boolean }) {
  const { ticket, owner, author, body, initialMessage, db } = input
  const create = request<{ accessToken?: string }>('/tickets', { method: 'POST', body: JSON.stringify({ id: ticket.id, number: ticket.number, subject: ticket.subject, priority: ticket.priority, employeeId: ticket.employeeId, branchId: ticket.branchId, department: db.departments.find(d => d.id === ticket.deptId)?.name, topic: db.topics.find(t => t.id === ticket.topicId)?.name, requesterName: owner.name, requesterEmail: owner.email, message: initialMessage || '(Ticket imported from the existing help desk.)', collaborators: ticket.collaborators || [], fromEmail: ticket.fromEmail, suppressNotification: author.role !== 'client' }) })
  background(create.then((result: { accessToken?: string }) => {
    if (result.accessToken) localStorage.setItem('osticket-api-access-' + ticket.number, result.accessToken)
    const token = author.role === 'client' ? localStorage.getItem('osticket-api-access-' + ticket.number) : null
    let sessionToken: string | undefined
    try { sessionToken = (JSON.parse(localStorage.getItem('osticket-react-session') || '{}') as { accessToken?: string }).accessToken } catch { sessionToken = undefined }
    const headers = new Headers()
    if (token) headers.set('x-ticket-access', token)
    if (sessionToken && author.role !== 'client') headers.set('x-user-session', sessionToken)
    return request('/tickets/' + encodeURIComponent(ticket.number) + '/replies', { method: 'POST', headers, body: JSON.stringify({ authorName: author.name, authorEmail: author.email, requesterEmail: author.role === 'client' ? author.email : undefined, message: body, internal: input.internal, status: input.status, recipients: input.recipients, fromEmail: input.fromEmail, collaboratorResponse: input.collaboratorResponse }) })
  }))
}

export async function apiLookupTicket(number: string, accessToken: string) {
  return request<{ ticket: Record<string, unknown>; messages: Array<Record<string, unknown>> }>('/tickets/' + encodeURIComponent(number) + '?accessToken=' + encodeURIComponent(accessToken))
}
export async function apiLookupTicketByEmail(number: string, email: string) {
  return request<{ ticket: ApiPersistedTicket; messages: ApiPersistedMessage[] }>('/tickets/' + encodeURIComponent(number) + '?email=' + encodeURIComponent(email))
}

export async function downloadApiTicketAttachment(number: string, attachmentId: string, fileName: string, email?: string) {
  const headers = new Headers(currentSessionHeaders())
  const accessToken = localStorage.getItem('osticket-api-access-' + number)
  if (accessToken) headers.set('x-ticket-access', accessToken)
  if (email) headers.set('x-ticket-email', email)
  const response = await fetch('/api/v1/tickets/' + encodeURIComponent(number) + '/attachments/' + encodeURIComponent(attachmentId), { headers })
  if (!response.ok) {
    const data = await response.json().catch(() => ({}))
    throw new ApiRequestError(data.error || 'Could not download attachment.', response.status)
  }
  const url = URL.createObjectURL(await response.blob())
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export interface DashboardTimeframe {
  start: string
  stop: string
  period: string
  displayRange: string
  startDateInput: string
}

export interface DashboardWorkload {
  open: number
  pending: number
  overdue: number
  unassigned: number
}

export interface DashboardPlotData {
  times: string[]
  timestamps: number[]
  events: string[]
  plots: Record<string, number[]>
  totals: Record<string, number>
}

export interface DashboardTabularReport {
  columns: string[]
  data: Array<Array<string | number>>
}

export interface DashboardOverview {
  timeframe: DashboardTimeframe
  workload: DashboardWorkload
  plots: DashboardPlotData
  tables: {
    dept: DashboardTabularReport
    topic: DashboardTabularReport
    staff: DashboardTabularReport
  }
}

export function getDashboardOverview(start?: string, period?: string, token?: string) {
  const params = new URLSearchParams()
  if (start) params.set('start', start)
  if (period) params.set('period', period)
  const q = params.toString() ? '?' + params.toString() : ''
  return request<DashboardOverview>('/dashboard/overview' + q, {
    headers: token ? { 'x-user-session': token } : currentSessionHeaders(),
  })
}

export async function downloadDashboardExport(
  group: 'dept' | 'topic' | 'staff',
  start?: string,
  period?: string,
  token?: string,
) {
  const params = new URLSearchParams({ group })
  if (start) params.set('start', start)
  if (period) params.set('period', period)
  const headers = new Headers(token ? { 'x-user-session': token } : currentSessionHeaders())
  const response = await fetch('/api/v1/dashboard/export?' + params.toString(), { headers })
  if (!response.ok) {
    const data = await response.json().catch(() => ({}))
    throw new ApiRequestError(data.error || 'Export failed.', response.status)
  }
  const disposition = response.headers.get('content-disposition')
  let filename = `stats-${group}.csv`
  if (disposition) {
    const match = disposition.match(/filename="?([^"]+)"?/)
    if (match?.[1]) filename = match[1]
  }
  const blob = await response.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}


// --- Agent Management -------------------------------------------------------

export interface ApiDeptAccess {
  deptId: string
  deptName: string
  roleId: string
  roleName: string
  alerts: boolean
}

export interface ApiTeamMembership {
  teamId: string
  teamName: string
  alerts: boolean
}

export interface ApiAgent {
  id: string
  staffId: string
  username: string
  firstname: string
  lastname: string
  name: string
  email: string
  phone: string
  phoneExt: string
  mobile: string
  isadmin: boolean
  isactive: boolean
  isvisible: boolean
  onvacation: boolean
  assignedOnly: boolean
  changePasswd: boolean
  notes: string
  deptId: string
  deptName: string
  roleId: string
  roleName: string
  title: string
  usePrimaryRoleOnAssignment: boolean
  created: string
  lastlogin: string | null
  deptAccess: ApiDeptAccess[]
  teams: ApiTeamMembership[]
  // Compat
  role: 'agent' | 'admin'
  active: boolean
}

export interface ApiAgentOptions {
  departments: Array<{ id: string; name: string }>
  roles: Array<{ id: string; name: string }>
  teams: Array<{ id: string; name: string; active: boolean }>
}

export function listApiAgents(token: string) {
  return request<{ agents: ApiAgent[] }>('/admin/agents', { headers: { 'x-user-session': token } })
}

export function getApiAgentOptions(token: string) {
  return request<ApiAgentOptions>('/admin/agents/options', { headers: { 'x-user-session': token } })
}

export function getApiAgent(id: string, token: string) {
  return request<{ agent: ApiAgent }>('/admin/agents/' + id, { headers: { 'x-user-session': token } })
}

export function createApiAgent(
  data: Partial<ApiAgent> & { password?: string; deptAccess?: ApiDeptAccess[]; teams?: ApiTeamMembership[] },
  token: string,
) {
  return request<{ saved: boolean; id: string }>('/admin/agents', {
    method: 'POST',
    headers: { 'x-user-session': token },
    body: JSON.stringify(data),
  })
}

export function updateApiAgent(
  id: string,
  data: Partial<ApiAgent> & { password?: string; deptAccess?: ApiDeptAccess[]; teams?: ApiTeamMembership[] },
  token: string,
) {
  return request<{ saved: boolean; id: string }>('/admin/agents/' + id, {
    method: 'PUT',
    headers: { 'x-user-session': token },
    body: JSON.stringify(data),
  })
}

export function deleteApiAgent(id: string, token: string) {
  return request<{ deleted: boolean }>('/admin/agents/' + id, {
    method: 'DELETE',
    headers: { 'x-user-session': token },
  })
}

export function massAgentAction(
  action: string,
  ids: string[],
  options: { deptId?: string; roleId?: string } | undefined,
  token: string,
) {
  return request<{ updated?: number; deleted?: number }>('/admin/agents/mass-action', {
    method: 'POST',
    headers: { 'x-user-session': token },
    body: JSON.stringify({ action, ids, options }),
  })
}

export function setApiAgentPassword(id: string, password: string, forceChange: boolean, token: string) {
  return request<{ updated: boolean }>('/admin/agents/' + id + '/set-password', {
    method: 'POST',
    headers: { 'x-user-session': token },
    body: JSON.stringify({ password, forceChange }),
  })
}
