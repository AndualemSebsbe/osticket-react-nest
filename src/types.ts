export type TicketStatus = 'open' | 'pending' | 'closed'
export type Priority = 'low' | 'normal' | 'high' | 'emergency'
export type Source = 'web' | 'email' | 'phone'
export type UserRole = 'client' | 'agent' | 'admin'
export type MessageKind = 'client' | 'agent' | 'collaborator' | 'system'
export type TaskStatus = 'open' | 'closed'
export type LogLevel = 'debug' | 'info' | 'warning' | 'error'

export interface User {
  id: string
  name: string
  email: string
  password: string
  phone?: string
  employeeId?: string
  branchId?: string
  branchName?: string
  org?: string
  orgId?: string
  role: UserRole
  title?: string
  deptId?: string
  roleId?: string
  teamIds?: string[]
  active?: boolean
  verificationStatus?: 'pending' | 'approved' | 'rejected'
}

export interface Department {
  id: string
  name: string
  email?: string
  managerId?: string
  slaId?: string
  active: boolean
}

export interface HelpTopic {
  id: string
  name: string
  deptId: string
  hint: string
  slaId?: string
  priority?: Priority
  active: boolean
}

export interface Ticket {
  id: string
  number: string
  subject: string
  status: TicketStatus
  priority: Priority
  source: Source
  topicId: string
  deptId: string
  employeeId?: string
  branchId?: string
  branchName?: string
  userId: string
  assigneeId?: string
  slaId?: string
  collaboratorIds?: string[]
  collaborators?: Array<{ userId?: string; name: string; email: string; active: boolean }>
  fromEmail?: string
  collaboratorNotice?: 'all' | 'user' | 'none'
  parentTicketId?: string
  mergedTicketIds?: string[]
  dueAt?: string
  lockedBy?: string
  createdAt: string
  updatedAt: string
  overdue?: boolean
}

export interface Audit {
  id: string
  createdAt: string
  actorId: string
  actorName: string
  objectType: 'ticket' | 'user' | 'settings' | 'staff' | 'system'
  objectId: string
  action: string
  details: string
}

export interface Message {
  id: string
  ticketId: string
  authorId: string
  authorName: string
  kind: MessageKind
  body: string
  internal?: boolean
  attachments?: string[]
  recipients?: string[]
  recipients?: string[]
  createdAt: string
}

export interface FaqCategory {
  id: string
  name: string
  description: string
  published: boolean
}

export interface Faq {
  id: string
  categoryId: string
  question: string
  answer: string
  published: boolean
}

export interface Organization {
  id: string
  name: string
  address?: string
  domain?: string
  phone?: string
  website?: string
  notes?: string
}

export interface Team {
  id: string
  name: string
  leadId?: string
  memberIds: string[]
  notes?: string
  enabled: boolean
}

export interface Role {
  id: string
  name: string
  permissions: string[]
}

export interface Sla {
  id: string
  name: string
  graceHours: number
  transient: boolean
  notes?: string
}

export interface TicketFilter {
  id: string
  name: string
  match: string
  action: string
  targetDeptId?: string
  stopOnMatch: boolean
  active: boolean
}

export interface EmailAccount {
  id: string
  email: string
  name: string
  deptId?: string
  protocol: 'SMTP' | 'IMAP' | 'POP'
  host: string
  active: boolean
}

export interface EmailTemplate {
  id: string
  name: string
  language: string
  notes?: string
}

export interface CannedResponse {
  id: string
  title: string
  deptId?: string
  body: string
}

export interface Task {
  id: string
  number: string
  title: string
  deptId: string
  assigneeId?: string
  ticketId?: string
  dueAt?: string
  status: TaskStatus
  createdAt: string
}

export interface SystemLog {
  id: string
  createdAt: string
  type: LogLevel
  title: string
  body: string
  ip?: string
}

export interface ApiKey {
  id: string
  key: string
  ip: string
  notes?: string
  active: boolean
}

export interface CmsPage {
  id: string
  name: string
  type: 'landing' | 'thank-you' | 'offline' | 'registration'
  body: string
  active: boolean
}

export interface CustomForm {
  id: string
  name: string
  type: 'ticket' | 'user' | 'org' | 'task'
  fields: string
}

export interface CustomList {
  id: string
  name: string
  items: string
}

export interface Plugin {
  id: string
  name: string
  version: string
  installed: boolean
  enabled: boolean
}

export interface Schedule {
  id: string
  name: string
  timezone: string
  hours: string
}

/** Criteria field for custom ticket queues (simplified from osTicket CustomQueue). */
export type QueueCriterionField =
  | 'status'
  | 'assignee'
  | 'overdue'
  | 'priority'
  | 'deptId'
  | 'topicId'
  | 'source'

export type QueueCriterionOp = 'eq' | 'neq' | 'in' | 'empty' | 'notempty'

export interface QueueCriterion {
  field: QueueCriterionField
  op: QueueCriterionOp
  /** For assignee: "mine" | "unassigned" | agent id. For multi: comma-separated. */
  value?: string
}

export type QueueSort = 'updatedDesc' | 'updatedAsc' | 'createdDesc' | 'priorityDesc' | 'numberAsc'

export interface TicketQueue {
  id: string
  title: string
  parentId?: string
  sort: number
  enabled: boolean
  /** Built-in queues cannot be deleted. */
  builtin?: boolean
  criteria: QueueCriterion[]
  sortBy: QueueSort
  notes?: string
}

export interface SystemSettings {
  companyName: string
  website: string
  phone: string
  address: string
  helpdeskName: string
  defaultDeptId: string
  timezone: string
  language: string
  logLevel: LogLevel
  defaultPriority: Priority
  maxOpenTickets: number
  autolock: boolean
  tasksEnabled: boolean
  agentPwReset: boolean
  twoFactor: boolean
  registrationMode: 'public' | 'disabled' | 'closed'
  verifyEmail: boolean
  kbEnabled: boolean
  kbPublishedOnly: boolean
  defaultFromEmail: string
  stripQuotedReply: boolean
  acceptAllEmails: boolean
  allowClientReopen: boolean
  hideCollaboratorTickets: boolean
  alertNewTicket: boolean
  alertMessageActivity: boolean
  alertAssignment: boolean
  autorespNewTicket: boolean
  autorespMessageActivity: boolean
}

export interface Session {
  userId: string
}

export interface Database {
  users: User[]
  departments: Department[]
  topics: HelpTopic[]
  tickets: Ticket[]
  messages: Message[]
  faqs: Faq[]
  categories: FaqCategory[]
  organizations: Organization[]
  teams: Team[]
  roles: Role[]
  slas: Sla[]
  filters: TicketFilter[]
  emails: EmailAccount[]
  banlist: { id: string; email: string; reason: string }[]
  templates: EmailTemplate[]
  canned: CannedResponse[]
  tasks: Task[]
  logs: SystemLog[]
  apiKeys: ApiKey[]
  pages: CmsPage[]
  forms: CustomForm[]
  lists: CustomList[]
  plugins: Plugin[]
  schedules: Schedule[]
  queues: TicketQueue[]
  audits: Audit[]
  settings: SystemSettings
}
