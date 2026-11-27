import { Link, Outlet, useLocation } from 'react-router';

export function GuestLayout() {
  const location = useLocation();
  return (
    <div className="min-h-dvh bg-canvas text-ink">
      <a
        href="#contenuto"
        className="sr-only focus:not-sr-only focus:absolute focus:z-20 focus:m-3 focus:rounded-lg focus:bg-surface focus:px-3 focus:py-2"
      >
        Vai al contenuto
      </a>
      <main
        id="contenuto"
        className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-6 px-4 py-10"
      >
        <div>
          <p className="text-lg font-semibold">Avis Berceto</p>
          <p className="text-sm text-muted">Associazione</p>
        </div>
        <Outlet />
        {location.pathname === '/accedi' ? null : (
          <p className="text-sm text-muted">
            <Link to="/accedi" className="font-medium text-brand-strong">
              Accedi
            </Link>
          </p>
        )}
      </main>
    </div>
  );
}
