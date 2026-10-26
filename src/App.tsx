import { useEffect, type ReactNode } from 'react'
import { Navigate, Outlet, Route, Routes } from 'react-router-dom'
import { CommandPalette } from './components/CommandPalette'
import { AuthProvider, useAuth } from './context/AuthContext'
import { ThemeProvider } from './context/ThemeContext'
import { hydratePublicAppStateFromApi } from './lib/store'
import { ClientLayout } from './layouts/ClientLayout'
import { StaffLayout } from './layouts/StaffLayout'
import { CheckStatusPage } from './pages/CheckStatusPage'
import { FaqPage } from './pages/FaqPage'
import { ForgotPasswordPage } from './pages/ForgotPasswordPage'
import { HomePage } from './pages/HomePage'
import { KnowledgeBasePage } from './pages/KnowledgeBasePage'
import { LoginPage } from './pages/LoginPage'
import { OpenTicketPage } from './pages/OpenTicketPage'
import { ProfilePage } from './pages/ProfilePage'
import { RegisterPage } from './pages/RegisterPage'
import { ThanksPage } from './pages/ThanksPage'
import {
  AdminApiKeysPage,
  AdminAuditsPage,
  AdminBanlistPage,
  AdminBranchesPage,
  AdminCategoriesPage,
  AdminDashboardPage,
  AdminDepartmentsPage,
  AdminDiagnosticPage,
  AdminEmailSettingsPage,
  AdminEmailsPage,
  AdminFiltersPage,
  AdminFormsPage,
  AdminInfoPage,
  AdminListsPage,
  AdminLogsPage,
  AdminPagesPage,
  AdminPluginsPage,
  AdminRolesPage,
  AdminSchedulesPage,
  AdminSettingsPage,
  AdminSlasPage,
  AdminStaffPage,
  AdminTeamsPage,
  AdminTemplatesPage,
  AdminTopicsPage,
  AdminUserVerificationPage,
  RequireAdmin,
} from './pages/admin/AdminPages'
import { StaffDashboardPage } from './pages/staff/StaffDashboardPage'
import { AdminQueuesPage } from './pages/admin/AdminQueuesPage'
import { StaffDirectoryPage } from './pages/staff/StaffDirectoryPage'
import {
  StaffCannedPage,
  StaffKbManagePage,
  StaffOrgPage,
  StaffOrgsPage,
  StaffProfilePage,
  StaffTaskPage,
  StaffTasksPage,
  StaffUserPage,
  StaffUsersPage,
} from './pages/staff/StaffExtraPages'
import { StaffLoginPage } from './pages/staff/StaffLoginPage'
import { StaffOpenTicketPage } from './pages/staff/StaffOpenTicketPage'
import { StaffQueuePage } from './pages/staff/StaffQueuePage'
import { StaffSearchPage } from './pages/staff/StaffSearchPage'
import { StaffTicketPage } from './pages/staff/StaffTicketPage'
import { EditTicketPage } from './pages/EditTicketPage'
import { TicketsPage } from './pages/TicketsPage'
import { TicketViewPage } from './pages/TicketViewPage'

function ClientShell() {
  return (
    <ClientLayout>
      <Outlet />
    </ClientLayout>
  )
}

function StaffShell() {
  const { user, ready } = useAuth()
  if (!ready) return <div className="grid min-h-dvh place-items-center text-sm text-ink-500">Checking your session…</div>
  if (!user || (user.role !== 'agent' && user.role !== 'admin')) {
    return <Navigate to="/scp/login" replace />
  }
  return <StaffLayout />
}

function RequireClient({ children }: { children: ReactNode }) {
  const { user, ready } = useAuth()
  if (!ready) return <div className="grid min-h-dvh place-items-center text-sm text-ink-500">Checking your session…</div>
  if (!user || user.role !== 'client') return <Navigate to="/login" replace />
  return children
}

function AdminShell() {
  return (
    <RequireAdmin>
      <Outlet />
    </RequireAdmin>
  )
}

export default function App() {
  useEffect(() => {
    void hydratePublicAppStateFromApi().catch((error) => console.warn('[public postgres data]', error instanceof Error ? error.message : error))
  }, [])
  return (
    <ThemeProvider>
      <AuthProvider>
        <CommandPalette />
        <Routes>
          <Route element={<ClientShell />}>
            <Route path="/" element={<HomePage />} />
            <Route path="/open" element={<RequireClient><OpenTicketPage /></RequireClient>} />
            <Route path="/status" element={<RequireClient><CheckStatusPage /></RequireClient>} />
            <Route path="/kb" element={<KnowledgeBasePage />} />
            <Route path="/kb/:id" element={<FaqPage />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
            <Route path="/forgot" element={<ForgotPasswordPage />} />
            <Route path="/thanks" element={<ThanksPage />} />
            <Route path="/tickets" element={<TicketsPage />} />
            <Route path="/tickets/:id/edit" element={<EditTicketPage />} />
            <Route path="/tickets/:id" element={<TicketViewPage />} />
            <Route path="/profile" element={<ProfilePage />} />
          </Route>
          <Route path="/scp/login" element={<StaffLoginPage />} />
          <Route path="/scp/login/pwreset" element={<ForgotPasswordPage staff />} />
          <Route path="/scp" element={<StaffShell />}>
            <Route index element={<StaffDashboardPage />} />
            <Route path="tickets" element={<StaffQueuePage />} />
            <Route path="tickets/new" element={<StaffOpenTicketPage />} />
            <Route path="tickets/:id" element={<StaffTicketPage />} />
            <Route path="search" element={<StaffSearchPage />} />
            <Route path="tasks" element={<StaffTasksPage />} />
            <Route path="tasks/:id" element={<StaffTaskPage />} />
            <Route path="users" element={<StaffUsersPage />} />
            <Route path="users/:id" element={<StaffUserPage />} />
            <Route path="orgs" element={<StaffOrgsPage />} />
            <Route path="orgs/:id" element={<StaffOrgPage />} />
            <Route path="kb" element={<StaffKbManagePage />} />
            <Route path="canned" element={<StaffCannedPage />} />
            <Route path="directory" element={<StaffDirectoryPage />} />
            <Route path="profile" element={<StaffProfilePage />} />
            <Route path="admin" element={<AdminShell />}>
              <Route index element={<AdminDashboardPage />} />
              <Route path="logs" element={<AdminLogsPage />} />
              <Route path="audits" element={<AdminAuditsPage />} />
              <Route path="info" element={<AdminInfoPage />} />
              <Route path="settings" element={<AdminSettingsPage />} />
              <Route path="topics" element={<AdminTopicsPage />} />
              <Route path="filters" element={<AdminFiltersPage />} />
              <Route path="queues" element={<AdminQueuesPage />} />
              <Route path="slas" element={<AdminSlasPage />} />
              <Route path="schedules" element={<AdminSchedulesPage />} />
              <Route path="apikeys" element={<AdminApiKeysPage />} />
              <Route path="pages" element={<AdminPagesPage />} />
              <Route path="forms" element={<AdminFormsPage />} />
              <Route path="lists" element={<AdminListsPage />} />
              <Route path="categories" element={<AdminCategoriesPage />} />
              <Route path="plugins" element={<AdminPluginsPage />} />
              <Route path="emails" element={<AdminEmailsPage />} />
              <Route path="email-settings" element={<AdminEmailSettingsPage />} />
              <Route path="banlist" element={<AdminBanlistPage />} />
              <Route path="templates" element={<AdminTemplatesPage />} />
              <Route path="diagnostic" element={<AdminDiagnosticPage />} />
              <Route path="staff" element={<AdminStaffPage />} />
              <Route path="users" element={<AdminUserVerificationPage />} />
              <Route path="branches" element={<AdminBranchesPage />} />
              <Route path="teams" element={<AdminTeamsPage />} />
              <Route path="roles" element={<AdminRolesPage />} />
              <Route path="departments" element={<AdminDepartmentsPage />} />
            </Route>
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </ThemeProvider>
  )
}
