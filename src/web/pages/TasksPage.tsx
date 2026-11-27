import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import type { GroupRecord, MemberRecord } from '../../shared/account';
import type { ChecklistTemplateSummary } from '../../shared/checklists';
import type { TaskList, TaskPriority } from '../../shared/tasks';
import { api, errorMessage } from '../api';
import { Banner, Field, SelectField, primaryButton, secondaryButton } from '../components/Field';
import { TASK_PRIORITY_LABEL, TASK_STATUS_LABEL } from '../labels';
import { useSession } from '../session';
import { formatRome, romeInputToIso } from '../time';

const PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;

export function TasksPage() {
  const session = useSession();
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const tasks = useQuery({
    queryKey: ['tasks', params.toString()],
    queryFn: () =>
      api<TaskList>(params.size > 0 ? `/api/tasks?${params.toString()}` : '/api/tasks'),
  });
  const [creating, setCreating] = useState(false);
  const canCreate = session.data?.role === 'admin' || session.data?.role === 'coordinator';
  const filtersActive = [
    'status',
    'priority',
    'q',
    'groupId',
    'assigneeId',
    'dueFrom',
    'dueTo',
  ].some((key) => params.has(key));

  return (
    <section className="mx-auto flex max-w-3xl flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Attività</h1>
          <p className="mt-1 text-sm text-muted">Le attività dei gruppi a cui hai accesso.</p>
        </div>
        {canCreate ? (
          <button
            type="button"
            className={`${creating ? secondaryButton : primaryButton} w-full sm:w-auto`}
            onClick={() => setCreating((open) => !open)}
          >
            {creating ? 'Annulla' : 'Nuova attività'}
          </button>
        ) : null}
      </div>
      {creating ? (
        <CreateTask
          onCreated={async () => {
            await queryClient.invalidateQueries({ queryKey: ['tasks'] });
            setCreating(false);
          }}
        />
      ) : (
        <>
          <FilterBar
            params={params}
            onApply={(next) => {
              setParams(next);
            }}
          />
          {tasks.isPending ? <p className="text-muted">Caricamento delle attività…</p> : null}
          {tasks.isError ? <Banner message={errorMessage(tasks.error)} /> : null}
          {tasks.data && tasks.data.items.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-line bg-surface p-4 text-muted">
              {filtersActive
                ? 'Nessuna attività corrisponde alla ricerca.'
                : 'Non ci sono attività.'}
            </p>
          ) : null}
          <ul className="flex flex-col gap-3">
            {tasks.data?.items.map((task) => (
              <li key={task.id}>
                <Link
                  to={`/attivita/${task.id}`}
                  className="flex min-h-11 flex-col gap-1 rounded-2xl border border-line bg-surface p-4"
                >
                  <span className="font-medium">{task.title}</span>
                  <span className="text-sm text-muted">
                    {task.groupName} · {TASK_STATUS_LABEL[task.status]} ·{' '}
                    {TASK_PRIORITY_LABEL[task.priority]}
                  </span>
                  <span className="text-sm text-muted">
                    {task.dueAt ? `Scadenza ${formatRome(task.dueAt)}` : 'Nessuna scadenza'}
                    {task.assignees.length > 0
                      ? ` · ${task.assignees.map((person) => person.fullName).join(', ')}`
                      : ''}
                  </span>
                  {task.checklists.length > 0 ? (
                    <span className="text-sm text-muted">
                      Checklist: {task.checklists.map((checklist) => checklist.title).join(', ')}
                    </span>
                  ) : null}
                </Link>
              </li>
            ))}
          </ul>
          {tasks.data && tasks.data.total > tasks.data.pageSize ? (
            <Pager
              page={tasks.data.page}
              pageSize={tasks.data.pageSize}
              total={tasks.data.total}
              onPage={(page) => {
                const next = new URLSearchParams(params);
                next.set('page', String(page));
                setParams(next);
              }}
            />
          ) : null}
        </>
      )}
    </section>
  );
}

function CreateTask({ onCreated }: { onCreated: () => Promise<void> }) {
  const groups = useQuery({
    queryKey: ['groups'],
    queryFn: () => api<{ items: GroupRecord[] }>('/api/groups'),
  });
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [groupId, setGroupId] = useState('');
  const [priority, setPriority] = useState<TaskPriority>('normal');
  const [dueLocal, setDueLocal] = useState('');
  const [assigneeIds, setAssigneeIds] = useState<string[]>([]);
  const [checklistTemplateIds, setChecklistTemplateIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const members = useQuery({
    queryKey: ['group-members', groupId],
    queryFn: () => api<{ members: MemberRecord[] }>(`/api/groups/${groupId}/members`),
    enabled: groupId.length > 0,
  });
  const templates = useQuery({
    queryKey: ['checklist-templates', groupId],
    queryFn: () =>
      api<{ items: ChecklistTemplateSummary[] }>(
        `/api/checklist-templates?groupId=${groupId}&status=active`,
      ),
    enabled: groupId.length > 0,
  });
  const activeGroups = groups.data?.items.filter((group) => group.status === 'active') ?? [];

  return (
    <form
      className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-4"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        setPending(true);
        setError(null);
        const dueAt = readDue(dueLocal, setError);
        if (dueLocal && !dueAt) {
          setPending(false);
          return;
        }
        void api('/api/tasks', {
          method: 'POST',
          body: { title, description, groupId, assigneeIds, checklistTemplateIds, priority, dueAt },
        })
          .then(async () => {
            setTitle('');
            setDescription('');
            setDueLocal('');
            setAssigneeIds([]);
            setChecklistTemplateIds([]);
            setPriority('normal');
            await onCreated();
          })
          .catch((reason: unknown) => {
            setError(errorMessage(reason));
          })
          .finally(() => {
            setPending(false);
          });
      }}
    >
      <h2 className="text-lg font-semibold">Nuova attività</h2>
      <Banner message={error} />
      {groups.isError ? <Banner message={errorMessage(groups.error)} /> : null}
      <Field
        id="task-title"
        label="Titolo"
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        required
      />
      <Field
        id="task-description"
        label="Descrizione"
        value={description}
        onChange={(event) => setDescription(event.target.value)}
      />
      <SelectField
        id="task-group"
        label="Gruppo"
        value={groupId}
        onChange={(event) => {
          setGroupId(event.target.value);
          setAssigneeIds([]);
          setChecklistTemplateIds([]);
        }}
        required
      >
        <option value="">Scegli un gruppo</option>
        {activeGroups.map((group) => (
          <option key={group.id} value={group.id}>
            {group.name}
          </option>
        ))}
      </SelectField>
      <SelectField
        id="task-priority"
        label="Priorità"
        value={priority}
        onChange={(event) => setPriority(event.target.value as TaskPriority)}
      >
        {PRIORITIES.map((item) => (
          <option key={item} value={item}>
            {TASK_PRIORITY_LABEL[item]}
          </option>
        ))}
      </SelectField>
      <Field
        id="task-due"
        label="Scadenza"
        type="datetime-local"
        value={dueLocal}
        hint="Orario di Roma. Lascia vuoto se non c'è una scadenza."
        onChange={(event) => setDueLocal(event.target.value)}
      />
      {groupId ? (
        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium">Checklist da eseguire</legend>
          {templates.data?.items.length === 0 ? (
            <p className="text-sm text-muted">Nessuna checklist attiva in questo gruppo.</p>
          ) : null}
          {templates.data?.items.map((template) => (
            <label key={template.id} className="flex min-h-11 items-center gap-3">
              <input
                type="checkbox"
                className="size-5"
                checked={checklistTemplateIds.includes(template.id)}
                onChange={(event) => {
                  setChecklistTemplateIds((current) =>
                    event.target.checked
                      ? [...current, template.id]
                      : current.filter((id) => id !== template.id),
                  );
                }}
              />
              <span>{template.title}</span>
            </label>
          ))}
        </fieldset>
      ) : null}
      {groupId ? (
        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium">Assegnatari</legend>
          {members.isPending ? (
            <p className="text-sm text-muted">Caricamento delle persone…</p>
          ) : null}
          {members.data?.members.filter((person) => person.status === 'active').length === 0 ? (
            <p className="text-sm text-muted">Nessuna persona attiva in questo gruppo.</p>
          ) : null}
          {members.data?.members
            .filter((person) => person.status === 'active')
            .map((person) => (
              <label key={person.id} className="flex min-h-11 items-center gap-3">
                <input
                  type="checkbox"
                  className="size-5"
                  checked={assigneeIds.includes(person.id)}
                  onChange={(event) => {
                    setAssigneeIds((current) =>
                      event.target.checked
                        ? [...current, person.id]
                        : current.filter((id) => id !== person.id),
                    );
                  }}
                />
                <span>{person.fullName}</span>
              </label>
            ))}
        </fieldset>
      ) : null}
      <button type="submit" className={primaryButton} disabled={pending}>
        Crea l'attività
      </button>
    </form>
  );
}

function FilterBar({
  params,
  onApply,
}: {
  params: URLSearchParams;
  onApply: (params: URLSearchParams) => void;
}) {
  return (
    <form
      className="grid gap-3 sm:grid-cols-2"
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        const next = new URLSearchParams();
        for (const key of ['status', 'priority', 'q']) {
          const value = String(form.get(key) ?? '').trim();
          if (value) {
            next.set(key, value);
          }
        }
        onApply(next);
      }}
    >
      <SelectField
        id="filter-status"
        label="Stato"
        name="status"
        defaultValue={params.get('status') ?? ''}
      >
        <option value="">Tutti gli stati</option>
        {Object.entries(TASK_STATUS_LABEL).map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </SelectField>
      <SelectField
        id="filter-priority"
        label="Priorità"
        name="priority"
        defaultValue={params.get('priority') ?? ''}
      >
        <option value="">Tutte le priorità</option>
        {PRIORITIES.map((item) => (
          <option key={item} value={item}>
            {TASK_PRIORITY_LABEL[item]}
          </option>
        ))}
      </SelectField>
      <Field id="filter-q" label="Cerca" name="q" defaultValue={params.get('q') ?? ''} />
      <div className="flex items-end">
        <button type="submit" className={secondaryButton}>
          Applica i filtri
        </button>
      </div>
    </form>
  );
}

function Pager({
  page,
  pageSize,
  total,
  onPage,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (page: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="flex items-center justify-between gap-3">
      <button
        type="button"
        className={secondaryButton}
        disabled={page <= 1}
        onClick={() => onPage(page - 1)}
      >
        Pagina precedente
      </button>
      <p className="text-sm text-muted">
        Pagina {page} di {pages}
      </p>
      <button
        type="button"
        className={secondaryButton}
        disabled={page >= pages}
        onClick={() => onPage(page + 1)}
      >
        Pagina successiva
      </button>
    </div>
  );
}

function readDue(value: string, setError: (message: string) => void): string | null {
  if (!value) {
    return null;
  }
  try {
    return romeInputToIso(value);
  } catch {
    setError('La scadenza non è valida.');
    return null;
  }
}
