import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import type { ChecklistItemResult, ChecklistRun } from '../../shared/checklists';
import { api, errorMessage } from '../api';
import { Banner, Field, dangerButton, primaryButton, secondaryButton } from '../components/Field';
import { CHECKLIST_OUTCOME_LABEL, CHECKLIST_RESULT_LABEL, CHECKLIST_RUN_LABEL } from '../labels';

const RESULTS: ChecklistItemResult[] = ['pending', 'compliant', 'non_compliant', 'not_applicable'];

export function ChecklistRunPage() {
  const { id } = useParams();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const run = useQuery({
    queryKey: ['checklist-run', id],
    queryFn: () => api<ChecklistRun>(`/api/checklist-runs/${id ?? ''}`),
    enabled: Boolean(id),
  });

  async function finish(path: string, confirmMessage?: string): Promise<void> {
    if (!id || pending) {
      return;
    }
    if (confirmMessage && !window.confirm(confirmMessage)) {
      return;
    }
    setPending(true);
    setError(null);
    try {
      await api(path, { method: 'POST', body: {} });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['checklist-run', id] }),
        queryClient.invalidateQueries({ queryKey: ['checklist-runs'] }),
        queryClient.invalidateQueries({ queryKey: ['tasks'] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
      ]);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="mx-auto flex max-w-3xl flex-col gap-6">
      <Link to="/checklist" className="min-h-11 text-sm font-medium text-brand-strong">
        Torna alle checklist
      </Link>
      {run.isPending ? <p className="text-muted">Caricamento dell'esecuzione…</p> : null}
      {run.isError ? <Banner message={errorMessage(run.error)} /> : null}
      {run.data ? (
        <article className="flex flex-col gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{run.data.title}</h1>
            <p className="mt-1 text-sm text-muted">
              {CHECKLIST_RUN_LABEL[run.data.status]}
              {run.data.outcome ? ` · ${CHECKLIST_OUTCOME_LABEL[run.data.outcome]}` : ''}
              {run.data.taskTitle ? ` · ${run.data.taskTitle}` : ''}
            </p>
            {run.data.description ? <p className="mt-2">{run.data.description}</p> : null}
          </div>
          <Banner message={error} />
          <ol className="flex flex-col gap-3">
            {run.data.items.map((item) => (
              <li key={item.id}>
                <RunItem
                  runId={run.data.id}
                  item={item}
                  locked={run.data.status !== 'in_progress'}
                  onSaved={async () => {
                    await queryClient.invalidateQueries({
                      queryKey: ['checklist-run', run.data.id],
                    });
                  }}
                />
              </li>
            ))}
          </ol>
          {run.data.status === 'in_progress' ? (
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                className={primaryButton}
                disabled={pending}
                onClick={() => void finish(`/api/checklist-runs/${run.data.id}/complete`)}
              >
                Concludi la checklist
              </button>
              <button
                type="button"
                className={dangerButton}
                disabled={pending}
                onClick={() =>
                  void finish(
                    `/api/checklist-runs/${run.data.id}/cancel`,
                    'Annullare questa esecuzione?',
                  )
                }
              >
                Annulla l'esecuzione
              </button>
            </div>
          ) : null}
          {run.data.taskId ? (
            <Link
              to={`/attivita/${run.data.taskId}`}
              className="min-h-11 font-medium text-brand-strong"
            >
              Torna all'attività
            </Link>
          ) : null}
        </article>
      ) : null}
    </section>
  );
}

function RunItem({
  runId,
  item,
  locked,
  onSaved,
}: {
  runId: string;
  item: ChecklistRun['items'][number];
  locked: boolean;
  onSaved: () => Promise<void>;
}) {
  const [result, setResult] = useState<ChecklistItemResult>(item.result);
  const [note, setNote] = useState(item.note ?? '');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const choices = item.required ? RESULTS.filter((value) => value !== 'not_applicable') : RESULTS;

  return (
    <form
      className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-4"
      onSubmit={(event) => {
        event.preventDefault();
        setPending(true);
        setError(null);
        void api(`/api/checklist-runs/${runId}/items/${item.id}`, {
          method: 'PATCH',
          body: { result, note },
        })
          .then(() => onSaved())
          .catch((reason: unknown) => setError(errorMessage(reason)))
          .finally(() => setPending(false));
      }}
    >
      <div>
        <p className="font-medium">{item.label}</p>
        <p className="text-sm text-muted">{item.required ? 'Obbligatoria' : 'Facoltativa'}</p>
        {item.helpText ? <p className="mt-1 text-sm">{item.helpText}</p> : null}
      </div>
      <fieldset className="flex flex-col gap-1" disabled={locked}>
        <legend className="text-sm font-medium">Esito</legend>
        {choices.map((value) => (
          <label key={value} className="flex min-h-11 items-center gap-3">
            <input
              type="radio"
              className="size-5"
              name={`result-${item.id}`}
              checked={result === value}
              onChange={() => setResult(value)}
            />
            {CHECKLIST_RESULT_LABEL[value]}
          </label>
        ))}
      </fieldset>
      <Field
        id={`note-${item.id}`}
        label="Nota"
        value={note}
        disabled={locked}
        onChange={(event) => setNote(event.target.value)}
      />
      <Banner message={error} />
      {locked ? null : (
        <button type="submit" className={secondaryButton} disabled={pending}>
          Salva la voce
        </button>
      )}
    </form>
  );
}
