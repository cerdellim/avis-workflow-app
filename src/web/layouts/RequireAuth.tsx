import { Navigate, Outlet } from 'react-router';
import { ApiClientError } from '../api';
import { useSession } from '../session';

export function RequireAuth() {
  const session = useSession();
  if (session.isPending) {
    return (
      <p className="px-4 py-10 text-muted" role="status">
        Caricamento…
      </p>
    );
  }
  if (!session.data) {
    return <Navigate to="/accedi" replace />;
  }
  return <Outlet />;
}

export function RequireAdmin() {
  const session = useSession();
  if (session.data?.role !== 'admin') {
    return (
      <section className="mx-auto flex max-w-3xl flex-col gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Amministrazione</h1>
        <p role="alert">Non hai i permessi per questa operazione.</p>
      </section>
    );
  }
  if (session.error instanceof ApiClientError && session.error.status === 401) {
    return <Navigate to="/accedi" replace />;
  }
  return <Outlet />;
}
