import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import type { HealthResponse } from '../../shared/health';
import type { Dashboard } from '../../shared/tasks';
import { api, errorMessage } from '../api';
import { Banner, secondaryButton } from '../components/Field';
import { useSession } from '../session';

async function loadHealth(): Promise<HealthResponse> {
  const response = await fetch('/api/health');
  const payload: unknown = await response.json();
  if (!isHealthResponse(payload) || !response.ok) {
    throw new Error('health_unavailable');
  }
  return payload;
}

function isHealthResponse(value: unknown): value is HealthResponse {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    (record.status === 'ok' || record.status === 'degraded') &&
    record.service === 'volontari' &&
    (record.database === 'ok' || record.database === 'error') &&
    typeof record.time === 'string'
  );
}

export function HomePage() {
  const session = useSession();
  const health = useQuery({
    queryKey: ['health'],
    queryFn: loadHealth,
  });
  const dashboard = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api<Dashboard>('/api/dashboard'),
    enabled: Boolean(session.data),
  });

  return (
    <section className="mx-auto flex max-w-3xl flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">
          {session.data ? `Ciao, ${session.data.fullName}` : 'Avis Berceto'}
        </h1>
        <p className="text-muted">Attività aperte, scadenze e assegnazioni del tuo perimetro.</p>
      </div>
      {dashboard.isPending ? <p className="text-muted">Caricamento della dashboard…</p> : null}
      {dashboard.isError ? (
        <div className="flex flex-col items-start gap-3">
          <Banner message={errorMessage(dashboard.error)} />
          <button
            type="button"
            className={secondaryButton}
            onClick={() => void dashboard.refetch()}
          >
            Riprova
          </button>
        </div>
      ) : null}
      {dashboard.data ? (
        <DashboardView
          data={dashboard.data}
          groupTitle={session.data?.role === 'admin' ? 'Tutti i gruppi' : 'I tuoi gruppi'}
        />
      ) : null}
      <p>
        <Link to="/attivita" className="font-medium text-brand-strong">
          Vai alle attività
        </Link>
      </p>
      <article className="rounded-2xl border border-line bg-surface p-4">
        <h2 className="text-lg font-semibold">Stato del servizio</h2>
        {health.isPending ? <p className="mt-2 text-muted">Caricamento dello stato…</p> : null}
        {health.isError ? (
          <div className="mt-2 flex flex-col items-start gap-3" role="alert">
            <p>Il servizio non risponde. Controlla la connessione e riprova.</p>
            <button
              type="button"
              className="rounded-lg bg-brand px-4 py-2 font-medium text-white"
              onClick={() => {
                void health.refetch();
              }}
            >
              Riprova
            </button>
          </div>
        ) : null}
        {health.data ? <p className="mt-2">Servizio attivo. Database collegato.</p> : null}
      </article>
    </section>
  );
}

function DashboardView({ data, groupTitle }: { data: Dashboard; groupTitle: string }) {
  const personal = [
    ['Assegnate a te', data.personal.assignedOpen],
    ['Da prendere in carico', data.personal.claimable],
    ['Urgenti aperte', data.personal.urgentOpen],
    ['Scadute', data.personal.overdue],
    ['In scadenza', data.personal.dueSoon],
    ['Checklist aperte', data.personal.openChecklists],
  ] as const;
  return (
    <>
      <dl className="grid grid-cols-2 gap-3">
        {personal.map(([label, value]) => (
          <div key={label} className="rounded-2xl border border-line bg-surface p-4">
            <dt className="text-sm text-muted">{label}</dt>
            <dd className="mt-1 text-3xl font-semibold tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
      <section className="rounded-2xl border border-line bg-surface p-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">Ultime notifiche</h2>
          <Link to="/notifiche" className="text-sm font-medium text-brand-strong underline">
            Vedi tutte
          </Link>
        </div>
        {data.notifications.length === 0 ? (
          <p className="mt-2 text-sm text-muted">Nessuna notifica.</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-3">
            {data.notifications.map((item) => (
              <li key={item.id}>
                <Link to={item.path} className="font-medium underline">
                  {item.title}
                </Link>
                <p className="text-sm text-muted">{item.body}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
      {data.group ? (
        <section className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-4">
          <h2 className="text-lg font-semibold">{groupTitle}</h2>
          <dl className="grid grid-cols-2 gap-3">
            <GroupStat label="Aperte" value={data.group.open} />
            <GroupStat label="Scadute" value={data.group.overdue} />
            <GroupStat label="Completate in 30 giorni" value={data.group.completedLast30Days} />
            <GroupStat label="Checklist in corso" value={data.group.checklistsInProgress} />
          </dl>
          <div>
            <h3 className="text-sm font-medium">Assegnazioni aperte</h3>
            {data.group.assignments.length === 0 ? (
              <p className="mt-2 text-sm text-muted">Nessuna persona nei gruppi.</p>
            ) : (
              <ul className="mt-2 flex flex-col gap-2">
                {data.group.assignments.map((person) => (
                  <li
                    key={person.userId}
                    className="flex min-h-11 items-center justify-between gap-3"
                  >
                    <span>{person.fullName}</span>
                    <span className="font-semibold tabular-nums">{person.openTasks}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      ) : null}
    </>
  );
}

function GroupStat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="text-2xl font-semibold tabular-nums">{value}</dd>
    </div>
  );
}
