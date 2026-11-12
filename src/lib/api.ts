import type { Ticket, TicketStatusOption, User, Database } from '../types'

export interface ApiHealth { ok: boolean; mailConfigured: boolean; storage: string }
export interface ApiPersistedTicket { id: string; number: string; subject: string; status: Ticket['status']; statusId?: string; statusName?: string; priority: Ticket['priority']; source: string; topic: string; department: string; requesterName: string; requesterEmail: string; employeeId?: string; branchId?: string; branchName?: string; assignee?: string; assigneeEmail?: string; assigneeStaffId?: string; collaborators?: Array<{ userId: string; name: string; email: string; active: boolean }>; fromEmail?: string; collaboratorNotice?: 'all' | 'user' | 'none'; overdue: boolean; createdAt: string; updatedAt: string; parentTicketId?: string; mergedTicketIds?: string[]; dueAt?: string; lockedBy?: string; lockedByName?: string; lockExpires?: string }
export interface ApiPersistedMessage { id: string; ticketNumber: string; author: string; authorEmail: string; kind: 'client' | 'agent' | 'collaborator' | 'system'; internal: boolean; body: string; attachments: string[]; attachmentFiles?: Array<{ id: string; name: string }>; recipients?: string[]; createdAt: string }

export class ApiRequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
    this.name = 'ApiRequestError'
  }
}

function withoutSessionPlaceholder(headers: Headers) {
  // Sessions live in an HTTP-only cookie now. Older call sites still pass the
  // token returned by accountSessionToken(); drop the placeholder so the
  // browser sends the real cookie instead.
  const value = headers.get('x-user-session')
  if (!value || value === 'cookie' || value === 'null' || value === 'undefined') headers.delete('x-user-session')
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers)
  if (!(init?.body instanceof FormData)) headers.set('content-type', 'application/json')
  withoutSessionPlaceholder(headers)
  const response = await fetch('/api/v1' + path, { ...init, headers, credentials: 'include' })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    const message = typeof data.message === 'string' ? data.message : data.error
    throw new ApiRequestError(message || 'API request failed (' + response.status + ').', response.status)
  }
  return data as T
}
function background(promise: Promise<unknown>) {
  void promise.catch((error: unknown) => console.warn('[helpdesk API]', error instanceof Error ? error.message : error))
}
function currentSessionHeaders(): Record<string, string> {
  // The session token is intentionally not readable from JavaScript; the
  // browser attaches the HTTP-only cookie to every same-origin request.
  return Object.create(null) as Record<string, string>
}
export function apiHealth() { return request<ApiHealth>('/health') }
export function listApiTickets(token?: string | null) { return request<{ tickets: Array<Record<string, any>> }>('/tickets', { headers: token ? { 'x-user-session': token } : currentSessionHeaders() }) }
export interface ApiQueueDefinition { id: string; title: string; parentId: string; filter: string; root: string; sort: number; flags?: number; staffId?: string; builtin?: boolean; columns: Array<{ id: string; heading: string; field: string; width: string; sort: number }>; sorting: Array<{ id: string; name: string; field: string; sort: number; direction?: 'asc' | 'desc' }> }
export function listApiQueues() { return request<{ queues: ApiQueueDefinition[]; customQueues: import('../types').TicketQueue[] }>('/tickets/queues', { headers: currentSessionHeaders() }) }

export type ApiSearchFieldType = 'text' | 'number' | 'date' | 'boolean' | 'select'
export interface ApiSearchFieldOption { value: string; label: string }
export interface ApiSearchField { path: string; label: string; type: ApiSearchFieldType; group: string; options?: ApiSearchFieldOption[] }
export interface ApiSearchColumn { path: string; label: string; width?: number; sortable?: boolean; type?: ApiSearchFieldType }
export interface ApiSearchOperator { value: string; label: string }
export interface ApiSearchCriterion { field: string; operator?: string; value?: string | number | boolean; value2?: string | number | boolean }
export interface ApiSearchSort { field: string; direction: 'asc' | 'desc' }
export interface ApiAdvancedSearchInput {
  q?: string
  keyword?: string
  criteria?: ApiSearchCriterion[]
  filters?: Record<string, string>
  quickFilters?: Record<string, string>
  quickFilter?: string
  quickFilterValue?: string
  columns?: Array<ApiSearchColumn | string>
  sort?: ApiSearchSort | string
  page?: number
  pageSize?: number
  savedSearchId?: string
}
export interface ApiSearchTicket {
  id: string
  number: string
  subject: string
  status: string
  statusName: string
  priority: string
  source: string
  department: string
  departmentId: string
  topic: string
  topicId: string
  requesterName: string
  requesterEmail: string
  requesterId: string
  assignee: string
  assigneeEmail: string
  assigneeStaffId: string
  team: string
  teamId: string
  sla: string
  slaId: string
  branchId: string
  branchName: string
  employeeId: string
  org: string
  orgId: string
  overdue: boolean
  answered: boolean
  assigned: boolean
  createdAt: string
  updatedAt: string
  dueAt: string | null
  estDueAt: string | null
  closedAt: string | null
  lastUpdate: string | null
  threadCount: number
  attachmentCount: number
  collaboratorCount: number
  snippet: string
  values: Record<string, unknown>
  custom: Record<string, Record<string, unknown>>
}
export interface ApiAdvancedSearchResult {
  tickets: ApiSearchTicket[]
  total: number
  page: number
  pageSize: number
  pages: number
  sort: ApiSearchSort
  columns: ApiSearchField[]
  criteria: ApiSearchCriterion[]
  keyword: string
  savedSearchId: string
  tookMs: number
}
export type ApiQueueTicketsInput = Omit<ApiAdvancedSearchInput, 'savedSearchId'>
export interface ApiQueueInfo {
  id: string
  title: string
  parentId: string
  filter: string
  root: string
  flags: number
  sort: number
  builtin: boolean
  columns: ApiSearchField[]
  sortBy: ApiSearchSort
}
export interface ApiQueueTicketsResult extends ApiAdvancedSearchResult {
  queue: ApiQueueInfo
}
export interface ApiSavedSearchConfig {
  q: string
  criteria: ApiSearchCriterion[]
  columns: ApiSearchColumn[]
  sort: ApiSearchSort | null
  pageSize: number
  quickFilter: string
  settings: Record<string, unknown>
  exportConfig: Record<string, unknown>
}
export interface ApiSavedSearch {
  id: string
  title: string
  name: string
  parentId: string
  root: string
  filter: string
  sort: number
  owner: boolean
  editable: boolean
  staffId: string
  createdAt: string
  updatedAt: string
  config: ApiSavedSearchConfig
  columns: ApiSearchColumn[]
  sorting: Array<{ id: string; name: string; field: string; sort: number }>
  exportConfig: Record<string, unknown>
}
export interface ApiAdvancedSearchOptions {
  fields: ApiSearchField[]
  operators: Record<ApiSearchFieldType, ApiSearchOperator[]>
  columns: ApiSearchField[]
  sorts: ApiSearchField[]
  quickFilters: Array<{ path: string; label: string; options: ApiSearchFieldOption[] }>
  statuses: Array<{ id: string; name: string; state: string }>
  departments: Array<{ id: string; name: string }>
  topics: Array<{ id: string; name: string; deptId: string }>
  priorities: string[]
  agents: Array<{ id: string; name: string; email: string }>
  teams: Array<{ id: string; name: string }>
  slas: Array<{ id: string; name: string }>
  branches: Array<{ id: string; name: string }>
  organizations: Array<{ id: string; name: string }>
  sources: Array<{ id: string; name: string }>
  defaults: { columns: ApiSearchField[]; sort: ApiSearchSort; pageSize: number; settings: Record<string, unknown> }
  settings: Record<string, unknown>
  savedSearches: ApiSavedSearch[]
}
export interface ApiSavedSearchInput {
  title: string
  parentId?: string
  q?: string
  criteria?: ApiSearchCriterion[]
  columns?: ApiSearchColumn[]
  sort?: ApiSearchSort | null
  pageSize?: number
  quickFilter?: string
  settings?: Record<string, unknown>
  exportConfig?: Record<string, unknown>
}

export function advancedSearchApiTickets(input: ApiAdvancedSearchInput) { return request<ApiAdvancedSearchResult>('/tickets/advanced-search', { method: 'POST', headers: currentSessionHeaders(), body: JSON.stringify(input) }) }
export function searchApiTickets(input: ApiAdvancedSearchInput) { return request<ApiAdvancedSearchResult>('/tickets/search', { method: 'POST', headers: currentSessionHeaders(), body: JSON.stringify(input) }) }
export function listApiQueueTickets(queueId: string, input: ApiQueueTicketsInput = {}) { return request<ApiQueueTicketsResult>('/tickets/queues/' + encodeURIComponent(queueId) + '/tickets', { method: 'POST', headers: currentSessionHeaders(), body: JSON.stringify(input) }) }
export function getApiAdvancedSearchOptions() { return request<ApiAdvancedSearchOptions>('/tickets/search/options', { headers: currentSessionHeaders() }) }
export function listApiSavedSearches() { return request<{ searches: ApiSavedSearch[] }>('/tickets/search/saved', { headers: currentSessionHeaders() }).then((result) => result.searches) }
export function createApiSavedSearch(input: ApiSavedSearchInput) { return request<{ search: ApiSavedSearch }>('/tickets/search/saved', { method: 'POST', headers: currentSessionHeaders(), body: JSON.stringify(input) }).then((result) => result.search) }
export function updateApiSavedSearch(id: string, input: ApiSavedSearchInput) { return request<{ search: ApiSavedSearch }>('/tickets/search/saved/' + encodeURIComponent(id), { method: 'PUT', headers: currentSessionHeaders(), body: JSON.stringify(input) }).then((result) => result.search) }
export function deleteApiSavedSearch(id: string) { return request<{ deleted: boolean }>('/tickets/search/saved/' + encodeURIComponent(id), { method: 'DELETE', headers: currentSessionHeaders() }) }
export function saveApiSearchSettings(settings: Record<string, unknown>, queueId = '0') { return request<{ saved: boolean; settings: Record<string, unknown> }>('/tickets/search/settings', { method: 'PUT', headers: currentSessionHeaders(), body: JSON.stringify({ queueId, settings }) }) }

export interface ApiPersonalQueue {
  id: string
  title: string
  parentId: string
  flags: number
  sort: number
  staffId: string
  criteria: ApiSearchCriterion[]
  columns: ApiSearchColumn[]
  sortBy: ApiSearchSort | null
  notes: string
  createdAt: string
  updatedAt: string
}

export interface ApiPersonalQueueInput {
  title: string
  parentId?: string
  criteria?: ApiSearchCriterion[]
  columns?: ApiSearchColumn[]
  sortBy?: ApiSearchSort | null
  pageSize?: number
  notes?: string
  sort?: number
}

export function listApiPersonalQueues() {
  return request<{ queues: ApiPersonalQueue[] }>('/tickets/queues/personal', { headers: currentSessionHeaders() }).then((result) => result.queues)
}
export function createApiPersonalQueue(input: ApiPersonalQueueInput) {
  return request<{ queue: ApiPersonalQueue }>('/tickets/queues/personal', { method: 'POST', headers: currentSessionHeaders(), body: JSON.stringify(input) }).then((result) => result.queue)
}
export function updateApiPersonalQueue(id: string, input: ApiPersonalQueueInput) {
  return request<{ queue: ApiPersonalQueue }>('/tickets/queues/personal/' + encodeURIComponent(id), { method: 'PUT', headers: currentSessionHeaders(), body: JSON.stringify(input) }).then((result) => result.queue)
}
export function deleteApiPersonalQueue(id: string) {
  return request<{ deleted: boolean; id: string }>('/tickets/queues/personal/' + encodeURIComponent(id), { method: 'DELETE', headers: currentSessionHeaders() })
}

export function listApiAccountTickets(token: string) {
  return request<{ tickets: ApiPersistedTicket[]; messages: ApiPersistedMessage[] }>('/users/tickets', { headers: { 'x-user-session': token } })
}
export interface ApiAssignableStaff { id: string; name: string; email: string; phone?: string; role: 'agent' | 'admin'; active: boolean; title?: string; deptId?: string; roleId?: string }
export function listApiAssignableStaff(token: string) {
  return request<{ staff: ApiAssignableStaff[] }>('/staff/assignable', { headers: { 'x-user-session': token } })
}
export interface ApiDepartmentMember { id: string; name: string; departmentId?: string; primary: boolean; roleId: string; alerts: boolean }
export interface ApiDepartment { id: string; name: string; parentId?: string; parentName?: string; status: 'active' | 'disabled' | 'archived'; type: 'public' | 'private'; signature: string; emailId: string; emailName?: string; managerId: string; managerName?: string; slaId: string; slaName?: string; scheduleId: string; scheduleName?: string; templateId: string; templateName?: string; autoresponderEmailId: string; autoresponderEmailName?: string; assignment: 'all' | 'members' | 'primary'; disableAutoClaim: boolean; disableReopenAutoAssign: boolean; alertRecipients: number; ticketAutoResponse: boolean; messageAutoResponse: boolean; primaryMembers: ApiDepartmentMember[]; extendedMembers: ApiDepartmentMember[]; isDefault?: boolean; path?: string; active?: boolean }
export interface ApiDepartmentOptions { departments: ApiDepartment[]; staff: Array<{ id: string; name: string; departmentId: string }>; slas: Array<{ id: string; name: string }>; schedules: Array<{ id: string; name: string }>; emails: Array<{ id: string; name: string }>; templates: Array<{ id: string; name: string }>; roles: Array<{ id: string; name: string }>; defaultDeptId?: string }
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
export interface ApiScheduleEntry { id?: string; name: string; repeats: string; startsOn: string; startsAt: string; endsOn: string; endsAt: string; stopsOn: string; day?: number | null; week?: number | null; month?: number | null }
export interface ApiSchedule { id: string; name: string; description: string; timezone: string; type: 'bizhrs' | 'hdays'; holidays: string[]; entries: ApiScheduleEntry[]; slaNames: string[]; departments: string[]; ticketCount: number; isDefault: boolean }
export interface ApiSchedulesResponse { schedules: ApiSchedule[]; defaultScheduleId: string; slas: Array<{ id: string; name: string; scheduleId: string }> }
export function listApiSchedules(token: string) { return request<ApiSchedulesResponse>('/admin/schedules', { headers: { 'x-user-session': token } }) }
export function createApiSchedule(input: Partial<ApiSchedule>, token: string) { return request<ApiSchedule>('/admin/schedules', { method: 'POST', headers: { 'x-user-session': token }, body: JSON.stringify(input) }) }
export function updateApiSchedule(id: string, input: Partial<ApiSchedule>, token: string) { return request<ApiSchedule>('/admin/schedules/' + encodeURIComponent(id), { method: 'PUT', headers: { 'x-user-session': token }, body: JSON.stringify(input) }) }
export function cloneApiSchedule(id: string, input: Pick<ApiSchedule, 'name'>, token: string) { return request<ApiSchedule>('/admin/schedules/' + encodeURIComponent(id) + '/clone', { method: 'POST', headers: { 'x-user-session': token }, body: JSON.stringify(input) }) }
export function deleteApiSchedule(id: string, token: string) { return request<{ deleted: boolean }>('/admin/schedules/' + encodeURIComponent(id), { method: 'DELETE', headers: { 'x-user-session': token } }) }
export function setApiDefaultSchedule(id: string, token: string) { return request<{ saved: boolean }>('/admin/schedules/default/' + encodeURIComponent(id), { method: 'PUT', headers: { 'x-user-session': token } }) }
export interface ApiHelpTopicOption { id: string; name: string }
export interface ApiHelpTopicDepartmentOption extends ApiHelpTopicOption { parentId?: string; public?: boolean; active?: boolean; archived?: boolean }
export interface ApiHelpTopicStatusOption extends ApiHelpTopicOption { state: string; enabled: boolean }
export interface ApiHelpTopicPriorityOption extends ApiHelpTopicOption { urgency?: number }
export interface ApiHelpTopicPageOption extends ApiHelpTopicOption { type?: string }
export interface ApiHelpTopicSequenceOption extends ApiHelpTopicOption { next: string; increment: number; padding: string }
export interface ApiHelpTopicStaffOption extends ApiHelpTopicOption { email: string; departmentId: string }
export interface ApiHelpTopicFormField {
  id: string
  label: string
  name: string
  type: string
  sort?: number
  flags?: string | number
  enabled?: boolean
  disabled?: boolean
  hint?: string
  required?: boolean
  configuration?: Record<string, unknown>
  listId?: string
  listOptions?: Array<{ id: string; value: string; sort: number }>
}
export interface ApiHelpTopicFormOption {
  id: string
  title: string
  instructions: string
  name: string
  type: string
  flags: string
  deleted: boolean
  fields: ApiHelpTopicFormField[]
}
export interface ApiHelpTopicFormLink {
  id?: string
  formId: string
  sort: number
  title: string
  instructions: string
  type: string
  disabledFieldIds: string[]
  fields: ApiHelpTopicFormField[]
}
export interface ApiPublicHelpTopic {
  id: string
  name: string
  topic?: string
  parentId?: string
  deptId: string
  departmentName?: string
  priorityId?: string
  priority: string
  slaId?: string
  slaName?: string
  hint: string
  active: boolean
  status?: string
  isPublic?: boolean
  public?: boolean
  forms?: ApiHelpTopicFormLink[]
}
export interface ApiHelpTopic {
  id: string
  topicId: string
  name: string
  topic: string
  status: 'active' | 'disabled' | 'archived'
  active: boolean
  isPublic: boolean
  public: boolean
  parentId: string
  departmentId: string
  deptId: string
  departmentName: string
  statusId: string
  statusName: string
  priorityId: string
  priority: string
  priorityName: string
  slaId: string
  slaName: string
  pageId: string
  pageName: string
  sequenceId: string
  sequenceName: string
  numberFormat: string
  customNumbers: boolean
  staffId: string
  teamId: string
  assign: string
  assignName: string
  noautoresp: boolean
  disableAutoResponse: boolean
  notes: string
  hint: string
  sort: number
  forms: ApiHelpTopicFormLink[]
  created?: string
  updated?: string
}
export interface ApiHelpTopicOptions {
  topics: ApiHelpTopic[]
  departments: ApiHelpTopicDepartmentOption[]
  statuses: ApiHelpTopicStatusOption[]
  priorities: ApiHelpTopicPriorityOption[]
  slas: ApiHelpTopicOption[]
  pages: ApiHelpTopicPageOption[]
  sequences: ApiHelpTopicSequenceOption[]
  staff: ApiHelpTopicStaffOption[]
  teams: ApiHelpTopicOption[]
  forms: ApiHelpTopicFormOption[]
}
export interface ApiHelpTopicInput {
  name: string
  parentId?: string
  departmentId?: string
  status?: 'active' | 'disabled' | 'archived'
  isPublic?: boolean
  statusId?: string
  priorityId?: string
  slaId?: string
  pageId?: string
  sequenceId?: string
  numberFormat?: string
  customNumbers?: boolean
  staffId?: string
  teamId?: string
  noautoresp?: boolean
  notes?: string
  forms?: Array<{ formId: string; disabledFieldIds: string[] }>
}
export function listApiPublicHelpTopics() {
  return request<{
    topics: ApiPublicHelpTopic[]
    departments: Array<{ id: string; name: string }>
    ticketDetailsForm?: ApiHelpTopicFormLink
  }>('/help-topics')
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
export function getApiHelpTopic(id: string, token: string) {
  return request<{ topic: ApiHelpTopic }>('/admin/help-topics/' + encodeURIComponent(id), { headers: { 'x-user-session': token } })
}
export function createApiHelpTopic(input: ApiHelpTopicInput, token: string) {
  return request<{ saved: boolean; id: string; topic: ApiHelpTopic }>('/admin/help-topics', { method: 'POST', headers: { 'x-user-session': token }, body: JSON.stringify(input) })
}
export function updateApiHelpTopic(id: string, input: ApiHelpTopicInput, token: string) {
  return request<{ saved: boolean; id: string; topic: ApiHelpTopic }>('/admin/help-topics/' + encodeURIComponent(id), { method: 'PUT', headers: { 'x-user-session': token }, body: JSON.stringify(input) })
}
export function deleteApiHelpTopic(id: string, token: string) {
  return request<{ deleted: boolean }>('/admin/help-topics/' + encodeURIComponent(id), { method: 'DELETE', headers: { 'x-user-session': token } })
}
export function massActionApiHelpTopics(action: 'enable' | 'disable' | 'archive' | 'delete', ids: string[], token: string) {
  return request<{ updated?: number; deleted?: number; skipped?: number }>('/admin/help-topics/mass-action', { method: 'POST', headers: { 'x-user-session': token }, body: JSON.stringify({ action, ids }) })
}
export interface ApiStaffTicketOptions {
  statuses: TicketStatusOption[]
  topics: Array<{ id: string; name: string }>
  priorities: Ticket['priority'][]
}
export function getApiStaffTicketOptions(token: string) {
  return request<ApiStaffTicketOptions>('/staff/ticket-options', { headers: { 'x-user-session': token } })
}
export function updateApiTicket(number: string, patch: { status?: Ticket['status'] | string; statusId?: string; priority?: Ticket['priority']; assignee?: string; assigneeEmail?: string; department?: string; topic?: string; overdue?: boolean; subject?: string }) { return request<{ ticket?: { status?: string; statusId?: string; statusName?: string } }>('/tickets/' + encodeURIComponent(number), { method: 'PATCH', headers: currentSessionHeaders(), body: JSON.stringify(patch) }) }
export function deleteApiTicket(number: string) { return request<{ deleted: boolean }>('/tickets/' + encodeURIComponent(number), { method: 'DELETE', headers: currentSessionHeaders() }) }
export function banApiTicketEmail(number: string) { return request<{ banned: boolean; email: string; reason: string }>('/tickets/' + encodeURIComponent(number) + '/ban-email', { method: 'POST', headers: currentSessionHeaders() }) }
export function updateApiTicketBranch(number: string, branchId: string) {
  return request<{ ticket: { branchId?: string; branchName?: string } }>('/tickets/' + encodeURIComponent(number) + '/branch', { method: 'PATCH', headers: currentSessionHeaders(), body: JSON.stringify({ branchId }) })
}
export interface ApiStaffTicketDetail { ticket: Record<string, any>; messages: ApiPersistedMessage[] }
export async function getApiStaffTicket(number: string) {
  return request<ApiStaffTicketDetail>('/tickets/' + encodeURIComponent(number) + '/staff', { headers: currentSessionHeaders() })
}
export async function mergeApiTicket(number: string, secondaryNumber: string) {
  return request<{ ticket: Record<string, any>; merged: Record<string, any> }>('/tickets/' + encodeURIComponent(number) + '/merge', { method: 'POST', headers: currentSessionHeaders(), body: JSON.stringify({ secondaryNumber }) })
}
export async function lockApiTicket(number: string) {
  return request<{ ticket: Record<string, any>; lock: { id: string; code: string; expiresAt: string } }>('/tickets/' + encodeURIComponent(number) + '/lock', { method: 'POST', headers: currentSessionHeaders() })
}
export async function unlockApiTicket(number: string) {
  return request<{ released: boolean; ticket: Record<string, any> }>('/tickets/' + encodeURIComponent(number) + '/lock', { method: 'DELETE', headers: currentSessionHeaders() })
}
export async function listApiTasks(query: Record<string, unknown> = {}) {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue
    params.set(key, String(value))
  }
  const suffix = params.toString() ? '?' + params.toString() : ''
  return request<ApiTaskListResult>('/tasks' + suffix, { headers: currentSessionHeaders() })
}
export interface ApiTaskAttachment { id: string; entryId: string; name: string; size: number; type: string }
export interface ApiTaskMessage {
  id: string
  kind: 'message' | 'reply' | 'note'
  type: string
  author: string
  body: string
  internal: boolean
  createdAt: string
  attachments: ApiTaskAttachment[]
}
export interface ApiTaskEvent { id: string; event: string; actor: string; at: string; data: string }
export interface ApiTaskCollaborator { userId: string; name: string; email: string; active: boolean }
export interface ApiTaskPermissions {
  canEdit: boolean
  canAssign: boolean
  canTransfer: boolean
  canReply: boolean
  canClose: boolean
  canDelete: boolean
  canCreate: boolean
}
export interface ApiTask {
  id: string
  number: string
  title: string
  deptId: string
  departmentName: string
  assigneeId: string
  assigneeName: string
  teamId: string
  teamName: string
  ticketId: string
  ticketNumber: string
  dueAt: string
  status: 'open' | 'closed'
  overdue: boolean
  createdAt: string
  updatedAt: string
  closedAt: string
  description: string
  permissions: ApiTaskPermissions
  messages: ApiTaskMessage[]
  collaborators: ApiTaskCollaborator[]
  events: ApiTaskEvent[]
}
export interface ApiTaskCounts { open: number; overdue: number; assigned: number; closed: number; all: number }
export interface ApiTaskListResult {
  tasks: ApiTask[]
  total: number
  page: number
  perPage: number
  pages: number
  counts: ApiTaskCounts
  permissions: string[]
}
export interface ApiTaskOptions {
  departments: Array<{ id: string; name: string }>
  staff: Array<{ id: string; name: string; email: string }>
  teams: Array<{ id: string; name: string }>
  tickets: Array<{ id: string; number: string; subject: string }>
  permissions: string[]
}
export interface ApiTaskQuery {
  queue?: 'open' | 'closed' | 'overdue' | 'assigned' | 'all'
  q?: string
  departmentId?: string
  assigneeId?: string
  ticketId?: string
  sort?: 'updated' | 'created' | 'due' | 'number' | 'title' | 'assignee' | 'department' | 'closed'
  dir?: 'asc' | 'desc'
  page?: number
  perPage?: number
}
export function getApiTaskOptions() {
  return request<ApiTaskOptions>('/tasks/options', { headers: currentSessionHeaders() })
}
export function getApiTask(id: string) {
  return request<{ task: ApiTask }>('/tasks/' + encodeURIComponent(id), { headers: currentSessionHeaders() })
}
function taskFormData(key: string, input: unknown, files: File[]) {
  const form = new FormData()
  form.set(key, JSON.stringify(input))
  files.forEach(file => form.append('files', file, file.name))
  return form
}
export async function createApiTask(input: any, files: File[] = []) {
  if (files.length) return request<{ task: ApiTask }>('/tasks', { method: 'POST', headers: currentSessionHeaders(), body: taskFormData('task', input, files) })
  return request<{ task: ApiTask }>('/tasks', { method: 'POST', headers: currentSessionHeaders(), body: JSON.stringify(input) })
}
export async function updateApiTask(id: string, input: any) {
  return request<{ task: ApiTask }>('/tasks/' + encodeURIComponent(id), { method: 'PATCH', headers: currentSessionHeaders(), body: JSON.stringify(input) })
}
export function closeApiTask(id: string) {
  return request<{ task: ApiTask }>('/tasks/' + encodeURIComponent(id) + '/close', { method: 'POST', headers: currentSessionHeaders() })
}
export function reopenApiTask(id: string) {
  return request<{ task: ApiTask }>('/tasks/' + encodeURIComponent(id) + '/reopen', { method: 'POST', headers: currentSessionHeaders() })
}
export function deleteApiTask(id: string) {
  return request<{ deleted: boolean; id: string }>('/tasks/' + encodeURIComponent(id), { method: 'DELETE', headers: currentSessionHeaders() })
}
export async function postApiTaskMessage(id: string, input: { message: string; internal?: boolean; status?: 'open' | 'closed' }, files: File[] = []) {
  if (files.length) return request<{ task: ApiTask; messageId: string }>('/tasks/' + encodeURIComponent(id) + '/messages', { method: 'POST', headers: currentSessionHeaders(), body: taskFormData('message', input, files) })
  return request<{ task: ApiTask; messageId: string }>('/tasks/' + encodeURIComponent(id) + '/messages', { method: 'POST', headers: currentSessionHeaders(), body: JSON.stringify(input) })
}
export function saveApiTaskCollaborators(id: string, collaborators: Array<{ userId?: string; name: string; email: string; active: boolean }>) {
  return request<{ task: ApiTask }>('/tasks/' + encodeURIComponent(id) + '/collaborators', { method: 'PUT', headers: currentSessionHeaders(), body: JSON.stringify({ collaborators }) })
}
export async function downloadApiTaskAttachment(taskId: string, attachmentId: string, fileName: string) {
  const response = await fetch('/api/v1/tasks/' + encodeURIComponent(taskId) + '/attachments/' + encodeURIComponent(attachmentId), { headers: currentSessionHeaders(), credentials: 'include' })
  if (!response.ok) {
    const data = await response.json().catch(() => ({}))
    throw new ApiRequestError(data.message || data.error || 'Could not download attachment.', response.status)
  }
  const url = URL.createObjectURL(await response.blob())
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
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
export type ApiSystemLogLevel = 'none' | 'debug' | 'warning' | 'error'
export interface ApiSystemSettingsValues {
  isOnline: boolean
  helpdeskUrl: string
  helpdeskTitle: string
  defaultDeptId: string
  forceHttps: boolean
  autolockMinutes: number
  maxPageSize: number
  logLevel: ApiSystemLogLevel
  logGracePeriod: number
  showAvatars: boolean
  enableRichText: boolean
  allowIframes: string
  embeddedDomainWhitelist: string
  acl: string
  aclBackend: string
  defaultLocale: string
  defaultTimezone: string
  dateFormats: '' | '24' | 'custom'
  timeFormat: string
  dateFormat: string
  datetimeFormat: string
  daydatetimeFormat: string
  scheduleId: string
  systemLanguage: string
  secondaryLanguages: string[]
  defaultStorageBk: string
  maxFileSize: number
  filesRequireAuth: boolean
}
export interface ApiSystemSettingsDepartment { id: string; name: string; isPublic: boolean; active: boolean }
export interface ApiSystemSettingsSchedule { id: string; name: string; timezone: string }
export interface ApiSystemSettingsResponse {
  values: ApiSystemSettingsValues
  departments: ApiSystemSettingsDepartment[]
  schedules: ApiSystemSettingsSchedule[]
  options: {
    pageSizes: number[]
    logLevels: Array<{ value: ApiSystemLogLevel; label: string }>
    logGracePeriods: Array<{ value: number; label: string }>
    aclBackends: Array<{ value: string; label: string }>
    storageBackends: Array<{ value: string; label: string }>
    maxFileSizes: Array<{ value: number; label: string }>
    languages: Array<{ value: string; label: string }>
    timezones: string[]
  }
  stats: {
    attachments: { files: number; links: number; chunks: number; bytes: number; storage: string }
    locks: { total: number; active: number; expired: number; table: string }
    logs: { total: number; debug: number; warning: number; error: number; newest: string | null; oldest: string | null; table: string }
  }
}
export function getApiSystemSettings() {
  return request<ApiSystemSettingsResponse>('/admin/system-settings', { headers: currentSessionHeaders() })
}
export function saveApiSystemSettings(values: ApiSystemSettingsValues) {
  return request<ApiSystemSettingsResponse>('/admin/system-settings', { method: 'PUT', headers: currentSessionHeaders(), body: JSON.stringify({ values }) })
}
export function purgeApiSystemLogs() {
  return request<{ deleted: number; cutoff: string; months: number }>('/admin/system-settings/purge-logs', { method: 'POST', headers: currentSessionHeaders() })
}
export function purgeApiExpiredLocks() {
  return request<{ deleted: number }>('/admin/system-settings/purge-expired-locks', { method: 'POST', headers: currentSessionHeaders() })
}
export function getMailLog() { return request<{ messages: Array<Record<string, unknown>> }>('/admin/mail-log', { headers: currentSessionHeaders() }) }
export function registerApiUser(input: { name: string; email: string; password: string; phone?: string; employeeId?: string; branchId?: string }) {
  return request<{ submitted: boolean; verificationStatus: 'pending' }>('/users/register', { method: 'POST', body: JSON.stringify(input) })
}
export interface ApiClientUser { id: string; name: string; email: string; phone?: string; employeeId?: string; branchId?: string; branchName?: string; org?: string; title?: string; deptId?: string; roleId?: string }
export function apiClientLogin(email: string, password: string) {
  return request<{ found: boolean; status?: 'pending' | 'approved' | 'rejected' | 'disabled'; user?: ApiClientUser }>('/users/login', { method: 'POST', body: JSON.stringify({ email, password }) })
}
export function apiStaffLogin(email: string, password: string) {
  return request<{ user: ApiClientUser & { role: 'agent' | 'admin' } }>('/staff/login', { method: 'POST', body: JSON.stringify({ email, password }) })
}
function sessionHeaders(token?: string | null): Record<string, string> {
  return token && token !== 'cookie' ? { 'x-user-session': token } : Object.create(null) as Record<string, string>
}
export function apiValidateClientSession(token?: string | null) {
  return request<{ status: 'approved'; role: User['role']; user: ApiClientUser & { role: User['role'] } }>('/users/session', { headers: sessionHeaders(token) })
}
export function apiValidateStaffSession(token?: string | null) {
  return request<{ status: 'approved'; role: 'agent' | 'admin'; user: ApiClientUser & { role: 'agent' | 'admin' } }>('/staff/session', { headers: sessionHeaders(token) })
}
export function apiCurrentSession() {
  return request<{ authenticated: true; status: 'approved'; role: User['role']; user: ApiClientUser & { role: User['role'] } }>('/auth/session')
}
export function apiLogout() {
  return request<{ loggedOut: boolean }>('/auth/logout', { method: 'POST' })
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
export function getApiDirectoryUser(id: string, token: string) {
  return request<any>('/admin/directory-users/' + encodeURIComponent(id), { headers: { 'x-user-session': token } })
}
export function saveApiDirectoryUser(input: { name: string; email: string; phone?: string; org?: string; orgId?: string } & Record<string, any>, token: string) {
  if (input.id) {
    return request<{ user: ApiDirectoryUser }>('/admin/directory-users/' + encodeURIComponent(input.id), { method: 'PUT', headers: { 'x-user-session': token }, body: JSON.stringify(input) })
  }
  return request<{ user: ApiDirectoryUser }>('/admin/directory-users', { method: 'POST', headers: { 'x-user-session': token }, body: JSON.stringify(input) })
}
export function updateApiDirectoryUser(id: string, input: any, token: string) {
  return request<{ user: ApiDirectoryUser }>('/admin/directory-users/' + encodeURIComponent(id), { method: 'PUT', headers: { 'x-user-session': token }, body: JSON.stringify(input) })
}
export function deleteApiDirectoryUser(id: string, token: string) {
  return request<{ deleted: boolean }>('/admin/directory-users/' + encodeURIComponent(id), { method: 'DELETE', headers: { 'x-user-session': token } })
}
export function massActionApiDirectoryUsers(action: string, ids: string[], token: string, options: any = {}) {
  return request<any>('/admin/directory-users/mass-action', { method: 'POST', headers: { 'x-user-session': token }, body: JSON.stringify({ action, ids, ...options }) })
}
export function listApiUsers(token: string) {
  return request<{ users: Array<ApiClientUser & { role: 'client' | 'admin'; verificationStatus: 'pending' | 'approved' | 'rejected'; registeredAt: string | null }> }>('/admin/users', { headers: { 'x-user-session': token } })
}
export function updateApiUserVerification(user: Pick<User, 'name' | 'email'>, status: 'approved' | 'rejected', actorName: string, token: string) {
  return request<{ updated: boolean; verificationStatus: 'approved' | 'rejected' }>('/admin/users/verification', { method: 'PATCH', headers: { 'x-user-session': token }, body: JSON.stringify({ ...user, status, actorName }) })
}
export function saveApiStaff(input: { staffId?: string; name: string; email: string; phone?: string; password?: string; role: 'agent' | 'admin'; active: boolean; title?: string; deptId?: string; roleId?: string; deptName?: string; roleName?: string; departmentAccess?: string[] }, token: string) {
  return request<{ saved: boolean; id: string }>('/admin/staff', { method: 'POST', headers: { 'x-user-session': token }, body: JSON.stringify(input) })
}
export type MirrorTicketResult = {
  accessToken?: string
  duplicate?: boolean
  ticket?: { number?: string }
  thankYouPage?: { id: string; name: string; body: string } | null
}

export async function mirrorTicket(ticket: Ticket, requester: User, firstMessage: string, db: Database, attachments: File[] = [], formValues?: Record<string, Record<string, string>>) {
  const assignee = db.users.find(u => u.id === ticket.assigneeId)
  // Let the API generate the number when the selected help topic has a custom
  // number format; the returned number replaces the local placeholder.
  const payload = { id: ticket.id, subject: ticket.subject, priority: ticket.priority, source: ticket.source, employeeId: ticket.employeeId, branchId: ticket.branchId, assignee: assignee?.name || '', assigneeEmail: assignee?.email || '', department: db.departments.find(d => d.id === ticket.deptId)?.name, topic: db.topics.find(t => t.id === ticket.topicId)?.name, topicId: ticket.topicId, requesterName: requester.name, requesterEmail: requester.email, message: firstMessage, collaborators: ticket.collaborators || [], fromEmail: ticket.fromEmail, collaboratorNotice: ticket.collaboratorNotice, formValues: formValues || {} }
  let body: BodyInit = JSON.stringify(payload)
  if (attachments.length) {
    const form = new FormData()
    form.set('ticket', JSON.stringify(payload))
    for (const file of attachments) form.append('files', file, file.name)
    body = form
  }
  const result = await request<MirrorTicketResult>('/tickets', { method: 'POST', headers: currentSessionHeaders(), body })
  const finalNumber = result.ticket?.number || ticket.number
  if (result.accessToken) localStorage.setItem('ctms-api-access-' + finalNumber, result.accessToken)
  return result
}
export function mirrorReply(input: { ticket: Ticket; owner: User; author: User; body: string; initialMessage: string; db: Database; internal?: boolean; status?: Ticket['status']; recipients?: string[]; fromEmail?: string; collaboratorResponse?: boolean; files?: File[] }) {
  const { ticket, owner, author, body, initialMessage, db } = input
  const sendReply = () => {
    const payload = { authorName: author.name, authorEmail: author.email, requesterEmail: author.role === 'client' ? author.email : undefined, message: body, internal: input.internal, status: input.status, recipients: input.recipients, fromEmail: input.fromEmail, collaboratorResponse: input.collaboratorResponse }
    let requestBody: BodyInit = JSON.stringify(payload)
    const headers = new Headers()
    const accessToken = author.role === 'client' ? localStorage.getItem('ctms-api-access-' + ticket.number) : null
    if (accessToken) headers.set('x-ticket-access', accessToken)
    // Staff/client sessions are carried by the HTTP-only cookie.
    if (input.files?.length) {
      const form = new FormData()
      form.set('reply', JSON.stringify(payload))
      for (const file of input.files) form.append('files', file, file.name)
      requestBody = form
    }
    return request<{ message?: ApiPersistedMessage; ticket?: Record<string, unknown> }>('/tickets/' + encodeURIComponent(ticket.number) + '/replies', { method: 'POST', headers, body: requestBody })
  }
  const run = async () => {
    try {
      return await sendReply()
    } catch (error) {
      // Only recreate the server-side ticket when it is genuinely missing. Auth
      // failures should surface to the caller instead of creating a second ticket.
      if (!(error instanceof ApiRequestError) || error.status !== 404) throw error
      const created = await request<{ accessToken?: string }>('/tickets', { method: 'POST', headers: currentSessionHeaders(), body: JSON.stringify({ id: ticket.id, number: ticket.number, subject: ticket.subject, priority: ticket.priority, employeeId: ticket.employeeId, branchId: ticket.branchId, department: db.departments.find(d => d.id === ticket.deptId)?.name, topic: db.topics.find(t => t.id === ticket.topicId)?.name, requesterName: owner.name, requesterEmail: owner.email, message: initialMessage || '(Ticket imported from the existing help desk.)', collaborators: ticket.collaborators || [], fromEmail: ticket.fromEmail }) })
      if (created.accessToken) localStorage.setItem('ctms-api-access-' + ticket.number, created.accessToken)
      return sendReply()
    }
  }
  return run()
}

export async function apiLookupTicket(number: string, accessToken: string) {
  return request<{ ticket: Record<string, unknown>; messages: Array<Record<string, unknown>> }>('/tickets/' + encodeURIComponent(number) + '?accessToken=' + encodeURIComponent(accessToken))
}
export async function apiLookupTicketByEmail(number: string, email: string) {
  return request<{ ticket: ApiPersistedTicket; messages: ApiPersistedMessage[] }>('/tickets/' + encodeURIComponent(number) + '?email=' + encodeURIComponent(email))
}

export async function apiCheckMyTicketStatus(ticketNumber: string) {
  return request<{ ticket: ApiPersistedTicket & { messages: ApiPersistedMessage[] }; messages: ApiPersistedMessage[] }>('/users/tickets/status?number=' + encodeURIComponent(ticketNumber))
}

export async function downloadApiTicketAttachment(number: string, attachmentId: string, fileName: string, email?: string) {
  const headers = new Headers(currentSessionHeaders())
  const accessToken = localStorage.getItem('ctms-api-access-' + number)
  if (accessToken) headers.set('x-ticket-access', accessToken)
  if (email) headers.set('x-ticket-email', email)
  const response = await fetch('/api/v1/tickets/' + encodeURIComponent(number) + '/attachments/' + encodeURIComponent(attachmentId), { headers, credentials: 'include' })
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

export function getDashboardOverview(start?: string, period?: string, token?: string | null) {
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
  const response = await fetch('/api/v1/dashboard/export?' + params.toString(), { headers, credentials: 'include' })
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

// --- Role Management -------------------------------------------------------

export interface ApiRolePermission {
  key: string
  title: string
  description: string
}

export interface ApiRolePermissionGroup {
  id: string
  label: string
  permissions: ApiRolePermission[]
}

export interface ApiRole {
  id: string
  name: string
  notes: string
  enabled: boolean
  flags: number
  permissions: string[]
  permissionCount: number
  primaryAgentCount: number
  deptAccessCount: number
  assignedAgents: string[]
  assignedDepartments: string[]
  canDelete: boolean
  created: string
  updated: string
}

export interface ApiRolesResponse {
  roles: ApiRole[]
  permissionGroups: ApiRolePermissionGroup[]
}

export interface ApiRoleInput {
  name: string
  notes?: string
  enabled?: boolean
  permissions: string[]
}

export function listApiRoles(token: string) {
  return request<ApiRolesResponse>('/admin/roles', { headers: { 'x-user-session': token } })
}

export function getApiRole(id: string, token: string) {
  return request<{ role: ApiRole; permissionGroups: ApiRolePermissionGroup[] }>('/admin/roles/' + id, {
    headers: { 'x-user-session': token },
  })
}

export function createApiRole(data: ApiRoleInput, token: string) {
  return request<{ saved: boolean; id: string; role: ApiRole }>('/admin/roles', {
    method: 'POST',
    headers: { 'x-user-session': token },
    body: JSON.stringify(data),
  })
}

export function updateApiRole(id: string, data: ApiRoleInput, token: string) {
  return request<{ saved: boolean; id: string; role: ApiRole }>('/admin/roles/' + id, {
    method: 'PUT',
    headers: { 'x-user-session': token },
    body: JSON.stringify(data),
  })
}

export function deleteApiRole(id: string, token: string) {
  return request<{ deleted: boolean }>('/admin/roles/' + id, {
    method: 'DELETE',
    headers: { 'x-user-session': token },
  })
}

export function massApiRoleAction(action: 'enable' | 'disable' | 'delete', ids: string[], token: string) {
  return request<{ updated?: number; deleted?: number; skipped?: number }>('/admin/roles/mass-action', {
    method: 'POST',
    headers: { 'x-user-session': token },
    body: JSON.stringify({ action, ids }),
  })
}

// --- Team Management -------------------------------------------------------

export interface ApiTeamMember {
  staffId: string
  name: string
  username: string
  email: string
  departmentId: string
  departmentName: string
  active: boolean
  onvacation: boolean
  alerts: boolean
}

export interface ApiTeam {
  id: string
  name: string
  notes: string
  enabled: boolean
  active: boolean
  disableAlerts: boolean
  alertsEnabled: boolean
  flags: number
  leadId: string
  leadName: string
  memberCount: number
  members: ApiTeamMember[]
  alertMemberCount: number
  ticketCount: number
  taskCount: number
  helpTopicCount: number
  helpTopicNames: string[]
  filterActionCount: number
  usageCount: number
  created: string
  updated: string
}

export interface ApiTeamStaffOption {
  id: string
  staffId: string
  name: string
  username: string
  email: string
  departmentId: string
  departmentName: string
  active: boolean
  onvacation: boolean
}

export interface ApiTeamsResponse {
  teams: ApiTeam[]
  staff: ApiTeamStaffOption[]
}

export interface ApiTeamMemberInput {
  staffId: string
  alerts: boolean
}

export interface ApiTeamInput {
  name: string
  notes?: string
  enabled?: boolean
  disableAlerts?: boolean
  leadId?: string
  members: ApiTeamMemberInput[]
}

export function listApiTeams(token: string) {
  return request<ApiTeamsResponse>('/admin/teams', { headers: { 'x-user-session': token } })
}

export function getApiTeam(id: string, token: string) {
  return request<{ team: ApiTeam; staff: ApiTeamStaffOption[] }>('/admin/teams/' + id, {
    headers: { 'x-user-session': token },
  })
}

export function createApiTeam(data: ApiTeamInput, token: string) {
  return request<{ saved: boolean; id: string; team: ApiTeam }>('/admin/teams', {
    method: 'POST',
    headers: { 'x-user-session': token },
    body: JSON.stringify(data),
  })
}

export function updateApiTeam(id: string, data: ApiTeamInput, token: string) {
  return request<{ saved: boolean; id: string; team: ApiTeam }>('/admin/teams/' + id, {
    method: 'PUT',
    headers: { 'x-user-session': token },
    body: JSON.stringify(data),
  })
}

export function deleteApiTeam(id: string, token: string) {
  return request<{ deleted: boolean }>('/admin/teams/' + id, {
    method: 'DELETE',
    headers: { 'x-user-session': token },
  })
}

export function massApiTeamAction(action: 'enable' | 'disable' | 'delete', ids: string[], token: string) {
  return request<{ updated?: number; deleted?: number; skipped?: number }>('/admin/teams/mass-action', {
    method: 'POST',
    headers: { 'x-user-session': token },
    body: JSON.stringify({ action, ids }),
  })
}

export interface ApiCompanyField {
  id: string
  name: string
  label: string
  type: string
  hint: string
  sort: number
  configuration: Record<string, unknown>
  value: string
}

export interface ApiCompanyPage {
  id: string
  name: string
  type: string
  active: boolean
  body: string
}

export interface ApiCompanyImage {
  id: string
  name: string
  type: string
  size: number
  created: string
  url: string
}

export interface ApiCompanySelection {
  landingPageId: string
  offlinePageId: string
  thankYouPageId: string
  clientLogoId: string
  staffLogoId: string
  staffBackdropId: string
}

export interface ApiCompanySettings {
  form: { id: string; title: string; instructions: string; notes: string }
  entryId: string
  fields: ApiCompanyField[]
  pages: ApiCompanyPage[]
  selected: ApiCompanySelection
  logos: ApiCompanyImage[]
  backdrops: ApiCompanyImage[]
}

export interface ApiCompanySaveInput extends ApiCompanySelection {
  values: Record<string, string>
  deleteLogoIds?: string[]
  deleteBackdropIds?: string[]
}

export function getApiCompanySettings() {
  return request<ApiCompanySettings>('/admin/company', { headers: currentSessionHeaders() })
}

export function saveApiCompanySettings(input: ApiCompanySaveInput) {
  return request<{ saved: boolean }>('/admin/company', {
    method: 'PUT',
    headers: currentSessionHeaders(),
    body: JSON.stringify(input),
  })
}

export function uploadApiCompanyImage(kind: 'logo' | 'backdrop', file: File) {
  const body = new FormData()
  body.append('kind', kind)
  body.append('file', file)
  return request<{ image: ApiCompanyImage }>('/admin/company/upload', {
    method: 'POST',
    headers: currentSessionHeaders(),
    body,
  }).then((result) => result.image)
}

export function companyAssetUrl(id: string) {
  return '/api/v1/company/files/' + encodeURIComponent(id)
}

export interface ApiPublicBranding {
  clientLogoId: string
  staffLogoId: string
  staffBackdropId: string
}

export function getApiPublicBranding() {
  return request<ApiPublicBranding>('/company/branding')
}
export interface ApiWizardTopic {
  id: string
  name: string
  deptId: string
  departmentName: string
  priority: string
  slaId: string
  hint: string
  active: boolean
}

export interface ApiWizardCategory {
  id: string
  name: string
  description: string
  articleCount: number
}

export interface ApiWizardFaq {
  id: string
  categoryId: string
  question: string
  answer: string
  keywords: string
  updatedAt?: string
}

export interface ApiWizardMeta {
  topics: ApiWizardTopic[]
  categories: ApiWizardCategory[]
  featuredFaqs: ApiWizardFaq[]
  branches: Array<{ id: string; name: string }>
  ticketDetailsForm?: {
    id: string
    title: string
    fields: Array<{
      id: string
      name: string
      label: string
      type: string
      hint?: string
      configuration?: Record<string, unknown>
    }>
  }
  settings: {
    helpdeskName: string
    companyName: string
    landingPageMessage: string
    allowGuestTickets: boolean
  }
}

export interface ApiWizardTicketStatusResult {
  found: boolean
  message?: string
  ticket?: {
    id: string
    number: string
    subject: string
    priority: string
    status: string
    statusState: string
    department: string
    requesterName: string
    requesterEmail: string
    createdAt: string
    updatedAt: string
    lastActivity: string
    messageCount: number
    lastMessageSnippet: string
    isClosed: boolean
  }
}

export function getApiWizardMeta() {
  return request<ApiWizardMeta>('/wizard/meta')
}

export function getApiWizardFaqs(params: { query?: string; categoryId?: string; topicId?: string }) {
  const query = new URLSearchParams()
  if (params.query) query.set('query', params.query)
  if (params.categoryId) query.set('categoryId', params.categoryId)
  if (params.topicId) query.set('topicId', params.topicId)
  return request<ApiWizardFaq[]>('/wizard/faqs?' + query.toString())
}

export function checkApiTicketStatus(number: string, email: string) {
  return request<ApiWizardTicketStatusResult>('/wizard/check-status', {
    method: 'POST',
    body: JSON.stringify({ number, email }),
  })
}



// ========== SYSTEM LOGS (Admin Panel > Dashboard > System Logs) ==========
export interface ApiSystemLog {
  id: string
  type: 'Error' | 'Warning' | 'Debug'
  title: string
  log: string
  logger: string
  ipAddress: string
  createdAt: string
  updatedAt: string
}

export interface ApiSystemLogsResponse {
  logs: ApiSystemLog[]
  total: number
  page: number
  limit: number
  totalPages: number
  counts: {
    total: number
    error: number
    warning: number
    debug: number
  }
  config: {
    logLevel: string
    logLevelRaw: string
    logGracePeriodMonths: number
  }
}

export interface ApiSystemLogsAuthResponse {
  authorized: boolean
  role: string
  isAdmin: boolean
  username: string
  email: string
  deptId: string
  canView: boolean
  canDelete: boolean
  canPurge: boolean
  canConfigure: boolean
  reason?: string
}

export function checkApiSystemLogsAuth() {
  return request<ApiSystemLogsAuthResponse>('/admin/logs/authorization', {
    headers: currentSessionHeaders(),
  })
}

export function getApiSystemLogs(params?: {
  type?: string
  startDate?: string
  endDate?: string
  search?: string
  sort?: string
  order?: 'asc' | 'desc'
  page?: number
  limit?: number
}) {
  const query = new URLSearchParams()
  if (params?.type && params.type !== 'all') query.set('type', params.type)
  if (params?.startDate) query.set('startDate', params.startDate)
  if (params?.endDate) query.set('endDate', params.endDate)
  if (params?.search) query.set('search', params.search)
  if (params?.sort) query.set('sort', params.sort)
  if (params?.order) query.set('order', params.order)
  if (params?.page) query.set('page', String(params.page))
  if (params?.limit) query.set('limit', String(params.limit))

  const qs = query.toString()
  return request<ApiSystemLogsResponse>('/admin/logs' + (qs ? '?' + qs : ''), {
    headers: currentSessionHeaders(),
  })
}

export function getApiSystemLog(id: string) {
  return request<ApiSystemLog>('/admin/logs/' + encodeURIComponent(id), {
    headers: currentSessionHeaders(),
  })
}

export function deleteApiSystemLog(id: string) {
  return request<{ success: boolean; id: string }>('/admin/logs/' + encodeURIComponent(id), {
    method: 'DELETE',
    headers: currentSessionHeaders(),
  })
}

export function massDeleteApiSystemLogs(ids: string[]) {
  return request<{ success: boolean; deleted: number; requested: number }>('/admin/logs/mass-delete', {
    method: 'POST',
    headers: currentSessionHeaders(),
    body: JSON.stringify({ ids }),
  })
}

export function purgeSystemLogs() {
  return request<{ deleted: number; cutoff: string; months: number }>('/admin/logs/purge', {
    method: 'POST',
    headers: currentSessionHeaders(),
  })
}

export function createApiSystemLog(input: {
  type: 'Error' | 'Warning' | 'Debug'
  title: string
  log: string
  logger?: string
  ipAddress?: string
}) {
  return request<{ id?: string; type?: string; title?: string; skipped?: boolean; reason?: string }>('/admin/logs', {
    method: 'POST',
    headers: currentSessionHeaders(),
    body: JSON.stringify(input),
  })
}

// ========== SYSTEM INFORMATION (Admin Panel > Dashboard > Information) ==========
export interface ApiSystemInfoCheck {
  key: string
  label: string
  status: 'ok' | 'warning'
  detail: string
}

export interface ApiSystemInfoTable {
  name: string
  totalBytes: number
  dataBytes: number
  indexBytes: number
  rowEstimate: number
}

export interface ApiSystemInformation {
  generatedAt: string
  application: {
    name: string
    packageName: string
    version: string
    environment: string
    runtime: string
    platform: string
    architecture: string
    hostname: string
    serverTime: string
    timezone: string
    uptimeSeconds: number
    memory: {
      rss: number
      heapUsed: number
      heapTotal: number
      hostTotal: number
      hostFree: number
    }
  }
  database: {
    engine: string
    version: string
    versionShort: string
    host: string
    port: string
    username: string
    database: string
    schema: string
    timezone: string
    storedTimezone: string | null
    timezoneSource: 'config' | 'server'
    schemaSignature: string | null
    schemaSignatureSource: 'config' | 'computed'
    totalBytes: number
    dataBytes: number
    indexBytes: number
    tableCount: number
    attachment: {
      table: string
      totalBytes: number
      dataBytes: number
      indexBytes: number
      chunks: number
      storageBackend: string
    }
  }
  tables: ApiSystemInfoTable[]
  checks: ApiSystemInfoCheck[]
  languages: {
    primary: string
    secondary: string[]
  }
}

export function getApiSystemInformation() {
  return request<ApiSystemInformation>('/admin/system-info', {
    headers: currentSessionHeaders(),
  })
}


// ==========================================
// ADMIN FORMS API (Manage Forms)
// ==========================================
export type ApiRequirementMode = 'a' | 'b' | 'c' | 'd' | 'e' | 'f' | 'g'

export interface ApiFormField {
  id?: string
  formId?: string
  label: string
  name: string
  type: string
  sort: number
  flags?: number
  enabled: boolean
  visibilityMode: ApiRequirementMode
  hint?: string
  configuration?: Record<string, any>
  deletable?: boolean
  nameEditable?: boolean
  typeEditable?: boolean
  delete?: boolean
}

export interface ApiFormListItem {
  id: string
  value: string
  sort: number
  status: number
}

export interface ApiFormList {
  id: string
  name: string
  namePlural?: string
  type?: string
  sortMode?: string
  items?: ApiFormListItem[]
}

export interface ApiFormHelpTopicLink {
  id?: string
  topicId: string
  topicName?: string
  sort?: number
}

export interface ApiFormSummary {
  id: string
  title: string
  instructions: string
  name: string
  type: string
  isBuiltIn: boolean
  builtInLabel: string
  icon: string
  flags: number
  enabled: boolean
  deletable: boolean
  notes: string
  fieldCount: number
  topicCount: number
  entryCount: number
  updated: string
  created: string
  fieldsSummary: string[]
}

export interface ApiFormDetail {
  id: string
  title: string
  instructions: string
  name: string
  type: string
  isBuiltIn: boolean
  builtInLabel: string
  icon: string
  flags: number
  enabled: boolean
  deletable: boolean
  notes: string
  entryCount: number
  created: string
  updated: string
}

export interface ApiFormEntryAttachment {
  id: string
  fileId: string
  name: string
  size: number
  type: string
}

export interface ApiFormEntry {
  id: string
  objectId: string
  objectType: string
  created: string
  updated?: string
  values: Record<string, any>
  attachments: ApiFormEntryAttachment[]
}

export interface ApiFormsResponse {
  forms: ApiFormSummary[]
  lists: ApiFormList[]
  helpTopics: Array<{ id: string; name: string }>
}

export interface ApiFormDetailResponse {
  form: ApiFormDetail
  fields: ApiFormField[]
  helpTopics: ApiFormHelpTopicLink[]
  allHelpTopics: Array<{ id: string; name: string }>
  recentEntries: ApiFormEntry[]
  lists: ApiFormList[]
}

export interface ApiFormInput {
  title: string
  instructions?: string
  notes?: string
  enabled?: boolean
  fields?: Partial<ApiFormField>[]
  helpTopicIds?: string[]
}

export function listApiForms(token?: string | null) {
  return request<ApiFormsResponse>('/admin/forms', {
    headers: token ? { 'x-user-session': token } : currentSessionHeaders(),
  })
}

export function getApiForm(id: string, token?: string | null) {
  return request<ApiFormDetailResponse>('/admin/forms/' + encodeURIComponent(id), {
    headers: token ? { 'x-user-session': token } : currentSessionHeaders(),
  })
}

export function createApiForm(input: ApiFormInput, token?: string | null) {
  return request<ApiFormDetailResponse>('/admin/forms', {
    method: 'POST',
    headers: token ? { 'x-user-session': token } : currentSessionHeaders(),
    body: JSON.stringify(input),
  })
}

export function updateApiForm(id: string, input: ApiFormInput, token?: string | null) {
  return request<ApiFormDetailResponse>('/admin/forms/' + encodeURIComponent(id), {
    method: 'PUT',
    headers: token ? { 'x-user-session': token } : currentSessionHeaders(),
    body: JSON.stringify(input),
  })
}

export function deleteApiForm(id: string, token?: string | null) {
  return request<{ deleted: boolean; id: string }>('/admin/forms/' + encodeURIComponent(id), {
    method: 'DELETE',
    headers: token ? { 'x-user-session': token } : currentSessionHeaders(),
  })
}

export function massApiFormAction(action: 'enable' | 'disable' | 'delete', ids: string[], token?: string | null) {
  return request<{ updated?: number; deleted?: number }>('/admin/forms/mass-action', {
    method: 'POST',
    headers: token ? { 'x-user-session': token } : currentSessionHeaders(),
    body: JSON.stringify({ action, ids }),
  })
}

export function listApiFormEntries(id: string, page = 1, limit = 50, token?: string | null) {
  return request<{
    entries: ApiFormEntry[]
    total: number
    page: number
    limit: number
    fields: Array<{ id: string; label: string; name: string; type: string }>
  }>(`/admin/forms/${encodeURIComponent(id)}/entries?page=${page}&limit=${limit}`, {
    headers: token ? { 'x-user-session': token } : currentSessionHeaders(),
  })
}


// ==========================================
// ADMIN LISTS & TICKET STATUSES API
// ==========================================

export type ApiListSortMode = 'Alpha' | '-Alpha' | 'SortCol'
export type ApiTicketState = 'open' | 'closed' | 'archived' | 'deleted'

export interface ApiListSummary {
  id: string
  name: string
  namePlural: string
  sortMode: ApiListSortMode
  masks: number
  type: string
  notes: string
  itemCount: number
  enabledItemCount: number
  formsCount: number
  formsUsing: Array<{
    formId: string
    formTitle: string
    fieldLabel: string
    fieldName: string
  }>
  created: string
  updated: string
}

export interface ApiListItem {
  id: string
  listId: string
  value: string
  extra: string
  status: number
  enabled: boolean
  sort: number
  properties: Record<string, any>
}

export interface ApiListPropertyField {
  id: string
  formId: string
  label: string
  name: string
  type: string
  sort: number
  flags: number
  hint: string
  configuration: Record<string, any>
}

export interface ApiListFormUsage {
  formId: string
  formTitle: string
  formType: string
  fieldLabel: string
  fieldName: string
}

export interface ApiListDetail {
  id: string
  name: string
  namePlural: string
  sortMode: ApiListSortMode
  masks: number
  type: string
  notes: string
  configuration: string
  created: string
  updated: string
  itemCount: number
  items: ApiListItem[]
  formsCount: number
  formsUsing: ApiListFormUsage[]
  properties: ApiListPropertyField[]
}

export interface ApiListInput {
  name: string
  name_plural?: string
  sort_mode?: ApiListSortMode
  notes?: string
  configuration?: string | Record<string, any>
  items?: Array<{
    value: string
    extra?: string
    status?: number
    sort?: number
    properties?: Record<string, any>
  }>
  properties?: ApiListPropertyFieldInput[]
}

export interface ApiListItemInput {
  value?: string
  extra?: string
  status?: number
  sort?: number
  properties?: Record<string, any>
}

export interface ApiListPropertyFieldInput {
  id?: string
  label: string
  name: string
  type: string
  sort?: number
  flags?: number
  hint?: string
  configuration?: Record<string, any>
  delete?: boolean
}

export function listApiLists(token?: string | null) {
  return request<{ lists: ApiListSummary[] }>('/admin/lists', {
    headers: token ? { 'x-user-session': token } : currentSessionHeaders(),
  })
}

export function getApiList(id: string, token?: string | null) {
  return request<{ list: ApiListDetail }>('/admin/lists/' + encodeURIComponent(id), {
    headers: token ? { 'x-user-session': token } : currentSessionHeaders(),
  })
}

export function createApiList(input: ApiListInput, token?: string | null) {
  return request<{ list: ApiListDetail }>('/admin/lists', {
    method: 'POST',
    headers: token ? { 'x-user-session': token } : currentSessionHeaders(),
    body: JSON.stringify(input),
  })
}

export function updateApiList(id: string, input: ApiListInput, token?: string | null) {
  return request<{ list: ApiListDetail }>('/admin/lists/' + encodeURIComponent(id), {
    method: 'PUT',
    headers: token ? { 'x-user-session': token } : currentSessionHeaders(),
    body: JSON.stringify(input),
  })
}

export function deleteApiList(id: string, token?: string | null) {
  return request<{ deleted: boolean; id: string }>('/admin/lists/' + encodeURIComponent(id), {
    method: 'DELETE',
    headers: token ? { 'x-user-session': token } : currentSessionHeaders(),
  })
}

export function massApiListAction(action: string, ids: string[], token?: string | null) {
  return request<{ affected: number }>('/admin/lists/mass-action', {
    method: 'POST',
    headers: token ? { 'x-user-session': token } : currentSessionHeaders(),
    body: JSON.stringify({ action, ids }),
  })
}

export function addApiListItem(listId: string, input: ApiListItemInput, token?: string | null) {
  return request<ApiListItem>(`/admin/lists/${encodeURIComponent(listId)}/items`, {
    method: 'POST',
    headers: token ? { 'x-user-session': token } : currentSessionHeaders(),
    body: JSON.stringify(input),
  })
}

export function updateApiListItem(listId: string, itemId: string, input: ApiListItemInput, token?: string | null) {
  return request<ApiListItem>(`/admin/lists/${encodeURIComponent(listId)}/items/${encodeURIComponent(itemId)}`, {
    method: 'PUT',
    headers: token ? { 'x-user-session': token } : currentSessionHeaders(),
    body: JSON.stringify(input),
  })
}

export function deleteApiListItem(listId: string, itemId: string, token?: string | null) {
  return request<{ deleted: boolean; id: string }>(`/admin/lists/${encodeURIComponent(listId)}/items/${encodeURIComponent(itemId)}`, {
    method: 'DELETE',
    headers: token ? { 'x-user-session': token } : currentSessionHeaders(),
  })
}

export function massApiListItemAction(listId: string, action: 'enable' | 'disable' | 'delete', ids: string[], token?: string | null) {
  return request<{ affected: number }>(`/admin/lists/${encodeURIComponent(listId)}/items/mass-action`, {
    method: 'POST',
    headers: token ? { 'x-user-session': token } : currentSessionHeaders(),
    body: JSON.stringify({ action, ids }),
  })
}

export function importApiListItems(listId: string, items: Array<{ value: string; extra?: string }>, token?: string | null) {
  return request<{ imported: number }>(`/admin/lists/${encodeURIComponent(listId)}/items/import`, {
    method: 'POST',
    headers: token ? { 'x-user-session': token } : currentSessionHeaders(),
    body: JSON.stringify({ items }),
  })
}

export function reorderApiListItems(listId: string, itemIds: string[], token?: string | null) {
  return request<{ reordered: boolean; count: number }>(`/admin/lists/${encodeURIComponent(listId)}/items/reorder`, {
    method: 'PUT',
    headers: token ? { 'x-user-session': token } : currentSessionHeaders(),
    body: JSON.stringify({ itemIds }),
  })
}

export function saveApiListProperties(listId: string, fields: ApiListPropertyFieldInput[], token?: string | null) {
  return request<{ saved: boolean }>(`/admin/lists/${encodeURIComponent(listId)}/properties`, {
    method: 'POST',
    headers: token ? { 'x-user-session': token } : currentSessionHeaders(),
    body: JSON.stringify({ fields }),
  })
}

// --- Ticket Statuses API ---

export interface ApiTicketStatus {
  id: string
  name: string
  state: ApiTicketState
  mode: number
  flags: number
  sort: number
  isSystem: boolean
  reopenable: boolean
  description: string
  properties: Record<string, any>
  ticketCount: number
  created: string
  updated: string
}

export interface ApiTicketStatusInput {
  name: string
  state?: ApiTicketState
  sort?: number
  properties?: {
    description?: string
    reopenable?: boolean
    notes?: string
    [key: string]: any
  }
  flags?: number
}

export function listApiTicketStatuses(token?: string | null) {
  return request<{ statuses: ApiTicketStatus[] }>('/admin/ticket-statuses', {
    headers: token ? { 'x-user-session': token } : currentSessionHeaders(),
  })
}

export function getApiTicketStatus(id: string, token?: string | null) {
  return request<{ status: ApiTicketStatus }>('/admin/ticket-statuses/' + encodeURIComponent(id), {
    headers: token ? { 'x-user-session': token } : currentSessionHeaders(),
  })
}

export function createApiTicketStatus(input: ApiTicketStatusInput, token?: string | null) {
  return request<{ status: ApiTicketStatus }>('/admin/ticket-statuses', {
    method: 'POST',
    headers: token ? { 'x-user-session': token } : currentSessionHeaders(),
    body: JSON.stringify(input),
  })
}

export function updateApiTicketStatus(id: string, input: ApiTicketStatusInput, token?: string | null) {
  return request<{ status: ApiTicketStatus }>('/admin/ticket-statuses/' + encodeURIComponent(id), {
    method: 'PUT',
    headers: token ? { 'x-user-session': token } : currentSessionHeaders(),
    body: JSON.stringify(input),
  })
}

export function deleteApiTicketStatus(id: string, token?: string | null) {
  return request<{ deleted: boolean; id: string }>('/admin/ticket-statuses/' + encodeURIComponent(id), {
    method: 'DELETE',
    headers: token ? { 'x-user-session': token } : currentSessionHeaders(),
  })
}

export function massApiTicketStatusAction(action: string, ids: string[], token?: string | null) {
  return request<{ affected: number }>('/admin/ticket-statuses/mass-action', {
    method: 'POST',
    headers: token ? { 'x-user-session': token } : currentSessionHeaders(),
    body: JSON.stringify({ action, ids }),
  })
}
