import { useQuery } from '@tanstack/react-query';
import {
  Bell,
  CalendarDays,
  ClipboardList,
  Group,
  Home,
  ListChecks,
  ScrollText,
  Settings,
  UserRound,
  Users,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Link, NavLink, Navigate, Outlet } from 'react-router';
import type { NotificationList } from '../../shared/notifications';
import { ApiClientError, api } from '../api';
import { useSession } from '../session';

type NavItem = {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
};

const NAV_ITEMS: readonly NavItem[] = [
  { to: '/', label: 'Home', icon: Home, end: true },
  { to: '/attivita', label: 'Attività', icon: ClipboardList },
  { to: '/calendario', label: 'Calendario', icon: CalendarDays },
  { to: '/checklist', label: 'Checklist', icon: ListChecks },
  { to: '/profilo', label: 'Profilo', icon: UserRound },
];

function itemClass(isActive: boolean): string {
  return [
    'flex min-h-11 items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium',
    isActive ? 'bg-brand text-white' : 'text-ink hover:bg-canvas',
  ].join(' ');
}

const ADMIN_ITEMS: readonly NavItem[] = [
  { to: '/amministrazione/utenti', label: 'Utenti', icon: Users },
  { to: '/amministrazione/gruppi', label: 'Gruppi', icon: Group },
  { to: '/amministrazione/registro', label: 'Registro', icon: ScrollText },
  { to: '/amministrazione/impostazioni', label: 'Impostazioni', icon: Settings },
];

export function AppShell() {
  const session = useSession();
  if (session.isError && session.error instanceof ApiClientError && session.error.status === 401) {
    return <Navigate to="/accedi" replace />;
  }
  const admin = session.data?.role === 'admin';
  return (
    <div className="min-h-dvh bg-canvas text-ink md:grid md:grid-cols-[16rem_1fr]">
      <a
        href="#contenuto"
        className="sr-only focus:not-sr-only focus:absolute focus:z-20 focus:m-3 focus:rounded-lg focus:bg-surface focus:px-3 focus:py-2"
      >
        Vai al contenuto
      </a>
      <aside className="hidden border-r border-line bg-surface md:flex md:flex-col md:gap-6 md:px-4 md:py-6">
        <div>
          <p className="text-lg font-semibold">{session.data?.associationName || 'Avis Berceto'}</p>
          <p className="text-sm text-muted">Associazione</p>
        </div>
        <nav aria-label="Sezioni" className="flex flex-col gap-1">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end ?? false}
              className={({ isActive }) => itemClass(isActive)}
            >
              <item.icon aria-hidden="true" size={20} />
              {item.label}
            </NavLink>
          ))}
        </nav>
        {admin ? (
          <nav aria-label="Amministrazione" className="flex flex-col gap-1">
            <p className="px-3 text-xs font-semibold tracking-wide text-muted uppercase">
              Amministrazione
            </p>
            {ADMIN_ITEMS.map((item) => (
              <NavLink key={item.to} to={item.to} className={({ isActive }) => itemClass(isActive)}>
                <item.icon aria-hidden="true" size={20} />
                {item.label}
              </NavLink>
            ))}
          </nav>
        ) : null}
      </aside>
      <div className="flex min-h-dvh flex-col pb-20 md:pb-0">
        <header className="flex items-center justify-between border-b border-line bg-surface px-4 py-3">
          <p className="text-base font-semibold md:hidden">
            {session.data?.associationName || 'Avis Berceto'}
          </p>
          <NotificationBell enabled={Boolean(session.data)} />
        </header>
        <main id="contenuto" className="flex-1 px-4 py-6">
          <Outlet />
        </main>
      </div>
      <nav
        aria-label="Sezioni"
        className="fixed inset-x-0 bottom-0 z-10 flex border-t border-line bg-surface px-1 pb-[env(safe-area-inset-bottom)] md:hidden"
      >
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end ?? false}
            className={({ isActive }) =>
              [
                'flex min-h-14 flex-1 flex-col items-center justify-center gap-1 px-1 text-[0.7rem] font-medium',
                isActive ? 'text-brand-strong' : 'text-muted',
              ].join(' ')
            }
          >
            <item.icon aria-hidden="true" size={20} />
            {item.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}

function NotificationBell({ enabled }: { enabled: boolean }) {
  const list = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api<NotificationList>('/api/notifications'),
    enabled,
  });
  const unread = list.data?.unread ?? 0;
  const label =
    unread === 1
      ? 'Notifiche, 1 non letta'
      : unread > 1
        ? `Notifiche, ${unread} non lette`
        : 'Notifiche';
  return (
    <Link
      to="/notifiche"
      aria-label={label}
      className="relative ml-auto inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg"
    >
      <Bell aria-hidden="true" size={20} />
      {unread > 0 ? (
        <span className="absolute top-1 right-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-brand px-1 text-xs font-semibold text-white tabular-nums">
          {unread > 9 ? '9+' : unread}
        </span>
      ) : null}
    </Link>
  );
}
