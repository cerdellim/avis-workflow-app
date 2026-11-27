import { Route, Routes } from 'react-router';
import { ErrorBoundary } from './components/ErrorBoundary';
import { GuestLayout } from './layouts/GuestLayout';
import { AppShell } from './layouts/AppShell';
import { RequireAdmin, RequireAuth } from './layouts/RequireAuth';
import { AuditPage } from './pages/AuditPage';
import { ChecklistRunPage } from './pages/ChecklistRunPage';
import { ChecklistsPage } from './pages/ChecklistsPage';
import { ChecklistTemplatePage } from './pages/ChecklistTemplatePage';
import { GroupsPage } from './pages/GroupsPage';
import { HomePage } from './pages/HomePage';
import { LoginPage } from './pages/LoginPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { NotificationsPage } from './pages/NotificationsPage';
import { CalendarPage } from './pages/CalendarPage';
import { TaskDetailPage } from './pages/TaskDetailPage';
import { TasksPage } from './pages/TasksPage';
import { ProfilePage } from './pages/ProfilePage';
import { SettingsPage } from './pages/SettingsPage';
import { SetupPage } from './pages/SetupPage';
import { ActivatePage, ResetPasswordPage } from './pages/TokenPages';
import { UsersPage } from './pages/UsersPage';

export function App() {
  return (
    <ErrorBoundary>
      <Routes>
        <Route element={<GuestLayout />}>
          <Route path="accedi" element={<LoginPage />} />
          <Route path="avvio" element={<SetupPage />} />
          <Route path="attiva" element={<ActivatePage />} />
          <Route path="reimposta-password" element={<ResetPasswordPage />} />
        </Route>
        <Route element={<RequireAuth />}>
          <Route element={<AppShell />}>
            <Route index element={<HomePage />} />
            <Route path="attivita" element={<TasksPage />} />
            <Route path="attivita/:id" element={<TaskDetailPage />} />
            <Route path="calendario" element={<CalendarPage />} />
            <Route path="checklist" element={<ChecklistsPage />} />
            <Route path="checklist/modelli/:id" element={<ChecklistTemplatePage />} />
            <Route path="checklist/esecuzioni/:id" element={<ChecklistRunPage />} />
            <Route path="profilo" element={<ProfilePage />} />
            <Route path="notifiche" element={<NotificationsPage />} />
            <Route path="amministrazione" element={<RequireAdmin />}>
              <Route path="utenti" element={<UsersPage />} />
              <Route path="gruppi" element={<GroupsPage />} />
              <Route path="registro" element={<AuditPage />} />
              <Route path="impostazioni" element={<SettingsPage />} />
            </Route>
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Route>
      </Routes>
    </ErrorBoundary>
  );
}
