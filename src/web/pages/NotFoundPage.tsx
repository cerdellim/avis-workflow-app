import { Link } from 'react-router';

export function NotFoundPage() {
  return (
    <section className="mx-auto flex max-w-3xl flex-col gap-3">
      <h1 className="text-2xl font-semibold tracking-tight">Pagina non trovata</h1>
      <p className="text-muted">
        Questo indirizzo non corrisponde a una sezione dell'applicazione.
      </p>
      <Link to="/" className="w-fit rounded-lg bg-brand px-4 py-2 font-medium text-white">
        Torna alla home
      </Link>
    </section>
  );
}
