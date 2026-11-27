import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import type { GroupRecord } from '../../shared/account';
import type { ChecklistRunSummary, ChecklistTemplateSummary } from '../../shared/checklists';
import { api, errorMessage } from '../api';
import { Banner, Field, SelectField, primaryButton, secondaryButton } from '../components/Field';
import { CHECKLIST_OUTCOME_LABEL, CHECKLIST_RUN_LABEL, CHECKLIST_STATUS_LABEL } from '../labels';
import { useSession } from '../session';

type DraftItem = { key: string; label: string; helpText: string; required: boolean };

export function ChecklistsPage() {
  const session = useSession();
  const templates = useQuery({
    queryKey: ['checklist-templates'],
    queryFn: () => api<{ items: ChecklistTemplateSummary[] }>('/api/checklist-templates'),
  });
  const runs = useQuery({
    queryKey: ['checklist-runs'],
    queryFn: () => api<{ items: ChecklistRunSummary[] }>('/api/checklist-runs'),
  });
  const [creating, setCreating] = useState(false);
  const canCreate = session.data?.role === 'admin' || session.data?.role === 'coordinator';

  return (
    <section className="mx-auto flex max-w-3xl flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Checklist</h1>
          <p className="mt-1 text-sm text-muted">
            I modelli si collegano alle attività. Chi prende in carico un'attività vede i controlli
            da completare.
          </p>
        </div>
        {canCreate ? (
          <button
            type="button"
            className={`${creating ? secondaryButton : primaryButton} w-full sm:w-auto`}
            onClick={() => setCreating((open) => !open)}
          >
            {creating ? 'Annulla' : 'Nuova checklist'}
          </button>
        ) : null}
      </div>
      {creating ? (
        <CreateTemplate
          onCreated={() => {
            setCreating(false);
          }}
        />
      ) : (
        <>
          {templates.isPending ? <p className="text-muted">Caricamento dei modelli…</p> : null}
          {templates.isError ? <Banner message={errorMessage(templates.error)} /> : null}
          {templates.data && templates.data.items.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-line bg-surface p-4 text-muted">
              Non ci sono checklist.
            </p>
          ) : null}
          <ul className="flex flex-col gap-3">
            {templates.data?.items.map((template) => (
              <li key={template.id}>
                <Link
                  to={`/checklist/modelli/${template.id}`}
                  className="flex min-h-11 flex-col gap-1 rounded-2xl border border-line bg-surface p-4"
                >
                  <span className="font-medium">{template.title}</span>
                  <span className="text-sm text-muted">
                    {template.groupName} · {CHECKLIST_STATUS_LABEL[template.status]} ·{' '}
                    {template.itemCount} {template.itemCount === 1 ? 'voce' : 'voci'}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <section className="flex flex-col gap-3">
            <h2 className="text-lg font-semibold">Esecuzioni</h2>
            {runs.isPending ? (
              <p className="text-sm text-muted">Caricamento delle esecuzioni…</p>
            ) : null}
            {runs.isError ? <Banner message={errorMessage(runs.error)} /> : null}
            {runs.data && runs.data.items.length === 0 ? (
              <p className="text-sm text-muted">Nessuna esecuzione.</p>
            ) : null}
            <ul className="flex flex-col gap-3">
              {runs.data?.items.map((run) => (
                <li key={run.id}>
                  <Link
                    to={`/checklist/esecuzioni/${run.id}`}
                    className="flex min-h-11 flex-col gap-1 rounded-2xl border border-line bg-surface p-4"
                  >
                    <span className="font-medium">{run.title}</span>
                    <span className="text-sm text-muted">
                      {CHECKLIST_RUN_LABEL[run.status]}
                      {run.outcome ? ` · ${CHECKLIST_OUTCOME_LABEL[run.outcome]}` : ''}
                      {run.taskTitle ? ` · ${run.taskTitle}` : ''}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </section>
  );
}

function CreateTemplate({ onCreated }: { onCreated: () => void }) {
  const queryClient = useQueryClient();
  const groups = useQuery({
    queryKey: ['groups'],
    queryFn: () => api<{ items: GroupRecord[] }>('/api/groups'),
  });
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [groupId, setGroupId] = useState('');
  const [items, setItems] = useState<DraftItem[]>([blankItem()]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const activeGroups = groups.data?.items.filter((group) => group.status === 'active') ?? [];

  return (
    <form
      className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-4"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        setPending(true);
        setError(null);
        void api('/api/checklist-templates', {
          method: 'POST',
          body: {
            title,
            description,
            groupId,
            items: items.map((item) => ({
              label: item.label,
              helpText: item.helpText,
              required: item.required,
            })),
          },
        })
          .then(async () => {
            setTitle('');
            setDescription('');
            setItems([blankItem()]);
            await queryClient.invalidateQueries({ queryKey: ['checklist-templates'] });
            onCreated();
          })
          .catch((reason: unknown) => setError(errorMessage(reason)))
          .finally(() => setPending(false));
      }}
    >
      <h2 className="text-lg font-semibold">Nuova checklist</h2>
      <Banner message={error} />
      <Field
        id="checklist-title"
        label="Titolo"
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        required
      />
      <Field
        id="checklist-description"
        label="Descrizione"
        value={description}
        onChange={(event) => setDescription(event.target.value)}
      />
      <SelectField
        id="checklist-group"
        label="Gruppo"
        value={groupId}
        required
        onChange={(event) => setGroupId(event.target.value)}
      >
        <option value="">Scegli un gruppo</option>
        {activeGroups.map((group) => (
          <option key={group.id} value={group.id}>
            {group.name}
          </option>
        ))}
      </SelectField>
      <ItemEditor items={items} onChange={setItems} />
      <button type="submit" className={primaryButton} disabled={pending}>
        Crea la checklist
      </button>
    </form>
  );
}

export function ItemEditor({
  items,
  onChange,
}: {
  items: DraftItem[];
  onChange: (items: DraftItem[]) => void;
}) {
  function update(key: string, patch: Partial<DraftItem>): void {
    onChange(items.map((item) => (item.key === key ? { ...item, ...patch } : item)));
  }
  function move(index: number, direction: -1 | 1): void {
    const next = index + direction;
    if (next < 0 || next >= items.length) {
      return;
    }
    const copy = [...items];
    const current = copy[index];
    const target = copy[next];
    if (!current || !target) {
      return;
    }
    copy[index] = target;
    copy[next] = current;
    onChange(copy);
  }
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="text-sm font-medium">Voci</legend>
      {items.map((item, index) => (
        <div key={item.key} className="flex flex-col gap-2 rounded-xl border border-line p-3">
          <Field
            id={`item-label-${item.key}`}
            label={`Voce ${index + 1}`}
            value={item.label}
            onChange={(event) => update(item.key, { label: event.target.value })}
          />
          <Field
            id={`item-help-${item.key}`}
            label="Aiuto"
            value={item.helpText}
            onChange={(event) => update(item.key, { helpText: event.target.value })}
          />
          <label className="flex min-h-11 items-center gap-3 text-sm">
            <input
              type="checkbox"
              className="size-5"
              checked={item.required}
              onChange={(event) => update(item.key, { required: event.target.checked })}
            />
            Obbligatoria
          </label>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="min-h-11 px-2 text-sm font-medium"
              onClick={() => move(index, -1)}
            >
              Sposta su
            </button>
            <button
              type="button"
              className="min-h-11 px-2 text-sm font-medium"
              onClick={() => move(index, 1)}
            >
              Sposta giù
            </button>
            {items.length > 1 ? (
              <button
                type="button"
                className="min-h-11 px-2 text-sm font-medium text-red-900"
                onClick={() => onChange(items.filter((entry) => entry.key !== item.key))}
              >
                Rimuovi
              </button>
            ) : null}
          </div>
        </div>
      ))}
      <button
        type="button"
        className="min-h-11 self-start text-sm font-medium"
        onClick={() => onChange([...items, blankItem()])}
      >
        Aggiungi una voce
      </button>
    </fieldset>
  );
}

export function blankItem(): DraftItem {
  return { key: crypto.randomUUID(), label: '', helpText: '', required: true };
}
