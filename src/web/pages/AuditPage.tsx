import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import type { AuditEntry } from '../../shared/admin';
import { api, errorMessage } from '../api';
import { Banner, Field, secondaryButton } from '../components/Field';
import { formatRome } from '../time';

export function AuditPage() {
  const [action, setAction] = useState('');
  const [applied, setApplied] = useState('');
  const logs = useQuery({
    queryKey: ['audit-logs', applied],
    queryFn: () =>
      api<{ items: AuditEntry[] }>(
        applied ? `/api/audit-logs?action=${encodeURIComponent(applied)}` : '/api/audit-logs',
      ),
  });

  return (
    <section className="mx-auto flex max-w-3xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Registro</h1>
        <p className="mt-1 text-sm text-muted">Ultime 200 voci. Non compaiono email né password.</p>
      </div>
      <form
        className="flex flex-col gap-3 sm:flex-row sm:items-end"
        onSubmit={(event) => {
          event.preventDefault();
          setApplied(action.trim());
        }}
      >
        <div className="flex-1">
          <Field
            id="audit-action"
            label="Azione"
            value={action}
            onChange={(event) => setAction(event.target.value)}
          />
        </div>
        <button type="submit" className={secondaryButton}>
          Filtra
        </button>
      </form>
      {logs.isPending ? <p className="text-muted">Caricamento del registro…</p> : null}
      {logs.isError ? <Banner message={errorMessage(logs.error)} /> : null}
      {logs.data && logs.data.items.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-line bg-surface p-4 text-muted">
          Nessuna voce nel registro.
        </p>
      ) : null}
      {logs.data && logs.data.items.length > 0 ? (
        <ul className="flex flex-col gap-3">
          {logs.data.items.map((entry) => (
            <li key={entry.id} className="rounded-2xl border border-line bg-surface p-4">
              <p className="font-medium">{entry.action}</p>
              <p className="mt-1 text-sm text-muted">
                {formatRome(entry.createdAt)} · {entry.actorName ?? 'Sistema'} · {entry.entityType}
                {entry.entityId ? ` · ${entry.entityId}` : ''}
              </p>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
