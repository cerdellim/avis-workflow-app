import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import type { NotificationList } from '../../shared/notifications';
import { api, errorMessage } from '../api';
import { Banner, primaryButton, secondaryButton } from '../components/Field';
import { devicePushEnabled, disableDevicePush, enableDevicePush } from '../push';
import { formatRome } from '../time';

export function NotificationsPage() {
  const queryClient = useQueryClient();
  const list = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api<NotificationList>('/api/notifications'),
  });
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [markingAll, setMarkingAll] = useState(false);

  async function refresh(): Promise<void> {
    await queryClient.invalidateQueries({ queryKey: ['notifications'] });
    await queryClient.invalidateQueries({ queryKey: ['dashboard'] });
  }

  return (
    <section className="mx-auto flex max-w-3xl flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Notifiche</h1>
          <p className="mt-1 text-muted">Solo le tue. Le non lette stanno in alto.</p>
        </div>
        {list.data && list.data.unread > 0 ? (
          <button
            type="button"
            className={secondaryButton}
            disabled={markingAll}
            onClick={() => {
              void (async () => {
                setActionError(null);
                setMarkingAll(true);
                try {
                  await api('/api/notifications/read-all', { method: 'POST', body: {} });
                  await refresh();
                } catch (error) {
                  setActionError(errorMessage(error));
                } finally {
                  setMarkingAll(false);
                }
              })();
            }}
          >
            Segna tutte come lette
          </button>
        ) : null}
      </div>
      <DevicePush />
      <Banner message={actionError} />
      {list.isPending ? <p className="text-muted">Caricamento delle notifiche…</p> : null}
      {list.isError ? <Banner message={errorMessage(list.error)} /> : null}
      {list.data && list.data.items.length === 0 ? (
        <p className="text-muted">Nessuna notifica.</p>
      ) : null}
      {list.data && list.data.items.length > 0 ? (
        <ul className="flex flex-col gap-3">
          {list.data.items.map((item) => (
            <li key={item.id} className="rounded-2xl border border-line bg-surface p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-medium">{item.title}</p>
                  <p className="text-sm text-muted">{item.body}</p>
                  <p className="mt-1 text-sm text-muted">{formatRome(item.createdAt)}</p>
                </div>
                {item.readAt === null ? (
                  <button
                    type="button"
                    className={secondaryButton}
                    disabled={pendingId === item.id}
                    onClick={() => {
                      void (async () => {
                        setActionError(null);
                        setPendingId(item.id);
                        try {
                          await api(`/api/notifications/${item.id}/read`, {
                            method: 'POST',
                            body: {},
                          });
                          await refresh();
                        } catch (error) {
                          setActionError(errorMessage(error));
                        } finally {
                          setPendingId(null);
                        }
                      })();
                    }}
                  >
                    Segna come letta
                  </button>
                ) : (
                  <p className="text-sm text-muted">Letta</p>
                )}
              </div>
              <Link
                to={item.path}
                className="mt-3 inline-flex min-h-11 items-center font-medium underline"
              >
                Apri
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function DevicePush() {
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [enabled, setEnabled] = useState(devicePushEnabled);

  return (
    <article className="rounded-2xl border border-line bg-surface p-4">
      <h2 className="text-lg font-semibold">Su questo dispositivo</h2>
      <p className="mt-2 text-sm text-muted">
        Il permesso viene chiesto solo da questo pulsante, mai all'apertura della pagina. Su iPhone
        le notifiche arrivano solo se apri Avis Berceto dall'icona sulla schermata Home. Se neghi il
        permesso, l'elenco qui sopra continua a funzionare.
      </p>
      <div className="mt-4 flex flex-wrap gap-3">
        <button
          type="button"
          className={primaryButton}
          disabled={pending}
          onClick={() => {
            void (async () => {
              setError(null);
              setMessage(null);
              setPending(true);
              try {
                setMessage(await enableDevicePush());
                setEnabled(devicePushEnabled());
              } catch (caught) {
                setError(errorMessage(caught));
              } finally {
                setPending(false);
              }
            })();
          }}
        >
          Attiva le notifiche
        </button>
        {enabled ? (
          <button
            type="button"
            className={secondaryButton}
            disabled={pending}
            onClick={() => {
              void (async () => {
                setError(null);
                setMessage(null);
                setPending(true);
                try {
                  await disableDevicePush();
                  setEnabled(false);
                  setMessage('Notifiche disattivate su questo dispositivo.');
                } catch (caught) {
                  setError(errorMessage(caught));
                } finally {
                  setPending(false);
                }
              })();
            }}
          >
            Disattiva
          </button>
        ) : null}
      </div>
      {message ? <p className="mt-3 text-sm">{message}</p> : null}
      <Banner message={error} />
    </article>
  );
}
