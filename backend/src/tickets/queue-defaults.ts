export type BuiltinQueueCriterion = {
  field: string;
  operator: string;
  value?: string | boolean;
  value2?: string | boolean;
};

export type BuiltinQueueColumn = {
  path: string;
  label: string;
  width?: number;
};

export type BuiltinQueue = {
  id: string;
  title: string;
  parentId: string;
  flags: number;
  sort: number;
  root: 'T';
  filter: string;
  criteria: BuiltinQueueCriterion[];
  columns: BuiltinQueueColumn[];
  sortBy: { field: string; direction: 'asc' | 'desc' };
};

export const QUEUE_FLAG_PUBLIC = 0x0001;
export const QUEUE_FLAG_QUEUE = 0x0002;
export const QUEUE_FLAG_DISABLED = 0x0004;
export const QUEUE_FLAG_INHERIT_CRITERIA = 0x0008;
export const QUEUE_FLAG_INHERIT_COLUMNS = 0x0010;
export const QUEUE_FLAG_INHERIT_SORTING = 0x0020;

const OPEN_COLUMNS: BuiltinQueueColumn[] = [
  { path: 'number', label: 'Ticket', width: 100 },
  { path: 'subject', label: 'Subject', width: 300 },
  { path: 'priority', label: 'Priority', width: 85 },
  { path: 'status', label: 'Status', width: 100 },
  { path: 'department', label: 'Department', width: 160 },
  { path: 'assignee', label: 'Assigned To', width: 160 },
  { path: 'updated', label: 'Last Updated', width: 150 },
];

const OVERDUE_COLUMNS: BuiltinQueueColumn[] = [
  { path: 'number', label: 'Ticket', width: 100 },
  { path: 'duedate', label: 'Due Date', width: 150 },
  { path: 'subject', label: 'Subject', width: 300 },
  { path: 'priority', label: 'Priority', width: 85 },
  { path: 'status', label: 'Status', width: 100 },
  { path: 'assignee', label: 'Assigned To', width: 160 },
  { path: 'updated', label: 'Last Updated', width: 150 },
];

const CLOSED_COLUMNS: BuiltinQueueColumn[] = [
  { path: 'number', label: 'Ticket', width: 100 },
  { path: 'closed', label: 'Date Closed', width: 150 },
  { path: 'subject', label: 'Subject', width: 300 },
  { path: 'priority', label: 'Priority', width: 85 },
  { path: 'department', label: 'Department', width: 160 },
  { path: 'assignee', label: 'Closed By', width: 160 },
  { path: 'updated', label: 'Last Updated', width: 150 },
];

/**
 * Mirrors the default ticket queues installed by osTicket (include/i18n/queue.yaml).
 * These are returned even when ost_queue has not been seeded yet so the agent
 * panel always has the standard queues available.
 */
export const BUILTIN_TICKET_QUEUES: BuiltinQueue[] = [
  {
    id: 'open',
    title: 'Open',
    parentId: '',
    flags: QUEUE_FLAG_PUBLIC | QUEUE_FLAG_QUEUE,
    sort: 1,
    root: 'T',
    filter: '',
    criteria: [{ field: 'status', operator: 'equals', value: 'open' }],
    columns: OPEN_COLUMNS,
    sortBy: { field: 'updated', direction: 'desc' },
  },
  {
    id: 'answered',
    title: 'Answered',
    parentId: 'open',
    flags: QUEUE_FLAG_PUBLIC | QUEUE_FLAG_QUEUE | QUEUE_FLAG_INHERIT_COLUMNS | QUEUE_FLAG_INHERIT_SORTING,
    sort: 2,
    root: 'T',
    filter: '',
    criteria: [
      { field: 'status', operator: 'equals', value: 'open' },
      { field: 'isanswered', operator: 'equals', value: true },
    ],
    columns: OPEN_COLUMNS,
    sortBy: { field: 'updated', direction: 'desc' },
  },
  {
    id: 'mine',
    title: 'My Tickets',
    parentId: '',
    flags: QUEUE_FLAG_PUBLIC | QUEUE_FLAG_QUEUE,
    sort: 3,
    root: 'T',
    filter: '',
    criteria: [
      { field: 'status', operator: 'equals', value: 'open' },
      { field: 'queue_assignee', operator: 'in', value: 'me,team' },
    ],
    columns: OPEN_COLUMNS,
    sortBy: { field: 'updated', direction: 'desc' },
  },
  {
    id: 'overdue',
    title: 'Overdue',
    parentId: 'open',
    flags: QUEUE_FLAG_PUBLIC | QUEUE_FLAG_QUEUE | QUEUE_FLAG_INHERIT_COLUMNS,
    sort: 4,
    root: 'T',
    filter: '',
    criteria: [
      { field: 'status', operator: 'equals', value: 'open' },
      { field: 'isoverdue', operator: 'equals', value: true },
    ],
    columns: OVERDUE_COLUMNS,
    sortBy: { field: 'duedate', direction: 'asc' },
  },
  {
    id: 'closed',
    title: 'Closed',
    parentId: '',
    flags: QUEUE_FLAG_PUBLIC | QUEUE_FLAG_QUEUE,
    sort: 5,
    root: 'T',
    filter: '',
    criteria: [{ field: 'status', operator: 'equals', value: 'closed' }],
    columns: CLOSED_COLUMNS,
    sortBy: { field: 'closed', direction: 'desc' },
  },
  {
    id: 'unassigned',
    title: 'Unassigned',
    parentId: 'open',
    flags: QUEUE_FLAG_PUBLIC | QUEUE_FLAG_QUEUE | QUEUE_FLAG_INHERIT_COLUMNS,
    sort: 6,
    root: 'T',
    filter: '',
    criteria: [
      { field: 'status', operator: 'equals', value: 'open' },
      { field: 'assignee', operator: 'equals', value: '0' },
    ],
    columns: OPEN_COLUMNS,
    sortBy: { field: 'updated', direction: 'desc' },
  },
  {
    id: 'pending',
    title: 'Pending',
    parentId: 'open',
    flags: QUEUE_FLAG_PUBLIC | QUEUE_FLAG_QUEUE | QUEUE_FLAG_INHERIT_COLUMNS,
    sort: 7,
    root: 'T',
    filter: '',
    criteria: [{ field: 'status', operator: 'equals', value: 'pending' }],
    columns: OPEN_COLUMNS,
    sortBy: { field: 'updated', direction: 'desc' },
  },
  {
    id: 'all',
    title: 'All Tickets',
    parentId: '',
    flags: QUEUE_FLAG_PUBLIC | QUEUE_FLAG_QUEUE,
    sort: 8,
    root: 'T',
    filter: '',
    criteria: [],
    columns: OPEN_COLUMNS,
    sortBy: { field: 'updated', direction: 'desc' },
  },
];

export function builtinTicketQueue(id: string) {
  return BUILTIN_TICKET_QUEUES.find((queue) => queue.id === id);
}
