export type NavItem = { to: string; label: string; end?: boolean }

export const agentNav: NavItem[] = [
  { to: '/scp', label: 'Dashboard', end: true },
  { to: '/scp/tickets', label: 'Tickets' },
  { to: '/scp/tickets/new', label: 'Open ticket' },
  { to: '/scp/search', label: 'Search' },
  { to: '/scp/tasks', label: 'Tasks' },
  { to: '/scp/users', label: 'Users' },
  { to: '/scp/orgs', label: 'Organizations' },
  { to: '/scp/kb', label: 'Knowledgebase' },
  { to: '/scp/canned', label: 'Canned responses' },
  { to: '/scp/directory', label: 'Directory' },
  { to: '/scp/profile', label: 'My profile' },
]

export const agentTabs: { id: string; label: string; to: string }[] = [
  { id: 'dashboard', label: 'Dashboard', to: '/scp' },
  { id: 'users', label: 'Users', to: '/scp/users' },
  { id: 'tasks', label: 'Tasks', to: '/scp/tasks' },
  { id: 'tickets', label: 'Tickets', to: '/scp/tickets' },
  { id: 'kb', label: 'Knowledgebase', to: '/scp/kb' },
]

export const ticketQueues = [
  { id: 'open', label: 'Open' },
  { id: 'mine', label: 'My tickets' },
  { id: 'unassigned', label: 'Unassigned' },
  { id: 'pending', label: 'Pending' },
  { id: 'overdue', label: 'Overdue' },
  { id: 'closed', label: 'Closed' },
  { id: 'all', label: 'All' },
] as const

/** Mirrors osTicket AdminNav tabs + submenus from class.nav.php */
export const adminGroups: { id: string; label: string; items: NavItem[] }[] = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    items: [
      { to: '/scp/admin', label: 'Admin dashboard', end: true },
      { to: '/scp/admin/logs', label: 'System logs' },
      { to: '/scp/admin/audits', label: 'Audit logs' },
      { to: '/scp/admin/info', label: 'Information' },
    ],
  },
  {
    id: 'settings',
    label: 'Settings',
    items: [{ to: '/scp/admin/settings', label: 'Settings' }],
  },
  {
    id: 'manage',
    label: 'Manage',
    items: [
      { to: '/scp/admin/topics', label: 'Help topics' },
      { to: '/scp/admin/filters', label: 'Filters' },
      { to: '/scp/admin/queues', label: 'Ticket queues' },
      { to: '/scp/admin/slas', label: 'SLA plans' },
      { to: '/scp/admin/schedules', label: 'Schedules' },
      { to: '/scp/admin/apikeys', label: 'API keys' },
      { to: '/scp/admin/pages', label: 'Pages' },
      { to: '/scp/admin/forms', label: 'Forms' },
      { to: '/scp/admin/lists', label: 'Lists' },
      { to: '/scp/admin/categories', label: 'FAQ categories' },
      { to: '/scp/admin/plugins', label: 'Plugins' },
    ],
  },
  {
    id: 'emails',
    label: 'Emails',
    items: [
      { to: '/scp/admin/emails', label: 'Emails' },
      { to: '/scp/admin/email-settings', label: 'Settings' },
      { to: '/scp/admin/banlist', label: 'Banlist' },
      { to: '/scp/admin/templates', label: 'Templates' },
      { to: '/scp/admin/diagnostic', label: 'Diagnostic' },
    ],
  },
  {
    id: 'staff',
    label: 'Agents',
    items: [
      { to: '/scp/admin/staff', label: 'Agents' },
      { to: '/scp/admin/teams', label: 'Teams' },
      { to: '/scp/admin/roles', label: 'Roles' },
      { to: '/scp/admin/departments', label: 'Departments' },
    ],
  },
  {
    id: 'users',
    label: 'Users',
    items: [
      { to: '/scp/admin/users', label: 'User verification' },
      { to: '/scp/admin/branches', label: 'Branches' },
    ],
  },
]

export const adminNavItems = adminGroups.flatMap((g) => g.items)

export function adminGroupForPath(pathname: string) {
  return (
    adminGroups.find((g) =>
      g.items.some((item) =>
        item.end ? pathname === item.to : pathname === item.to || pathname.startsWith(`${item.to}/`),
      ),
    ) ?? adminGroups[0]
  )
}

export function adminItemForPath(pathname: string) {
  const group = adminGroupForPath(pathname)
  return (
    group.items.find((item) => (item.end ? pathname === item.to : pathname === item.to || pathname.startsWith(`${item.to}/`))) ??
    group.items[0]
  )
}
