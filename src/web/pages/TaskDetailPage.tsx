import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import type { MemberRecord, Profile } from '../../shared/account';
import type { ChecklistTemplateSummary } from '../../shared/checklists';
import type { TaskHistoryItem, TaskPriority, TaskRecord } from '../../shared/tasks';
import { api, errorMessage } from '../api';
import {
  Banner,
  Field,
  SelectField,
  dangerButton,
  primaryButton,
  secondaryButton,
} from '../components/Field';
import {
  CHECKLIST_OUTCOME_LABEL,
  CHECKLIST_RUN_LABEL,
  TASK_ACTION_LABEL,
  TASK_PRIORITY_LABEL,
  TASK_STATUS_LABEL,
} from '../labels';
import { useSession } from '../session';
import { formatLocalDate, formatRome, isoToRomeInput, romeInputToIso } from '../time';

const PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;

export function TaskDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const session = useSession();
  const queryClient = useQueryClient();
  const [actionError, setActionError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const task = useQuery({
    queryKey: ['task', id],
    queryFn: () => api<TaskRecord>(`/api/tasks/${id ?? ''}`),
    enabled: Boolean(id),
  });
  const history = useQuery({
    queryKey: ['task-history', id],
    queryFn: () => api<{ items: TaskHistoryItem[] }>(`/api/tasks/${id ?? ''}/history`),
    enabled: Boolean(id) && task.isSuccess,
  });

  async function run(path: string, confirmMessage?: string): Promise<void> {
    if (!id || pending) {
      return;
    }
    if (confirmMessage && !window.confirm(confirmMessage)) {
      return;
    }
    setPending(true);
    setActionError(null);
    try {
      await api(path, { method: 'POST', body: {} });
      await refresh(queryClient, id);
    } catch (error) {
      setActionError(errorMessage(error));
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="mx-auto flex max-w-3xl flex-col gap-6">
      <Link to="/attivita" className="min-h-11 text-sm font-medium text-brand-strong">
        Torna alle attività
      </Link>
      {task.isPending ? <p className="text-muted">Caricamento dell'attività…</p> : null}
      {task.isError ? <Banner message={errorMessage(task.error)} /> : null}
      {task.data && session.data ? (
        <article className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{task.data.title}</h1>
            <p className="mt-1 text-sm text-muted">
              {task.data.groupName} · {TASK_STATUS_LABEL[task.data.status]} ·{' '}
              {TASK_PRIORITY_LABEL[task.data.priority]}
            </p>
          </div>
          <p>{task.data.description ?? 'Nessuna descrizione.'}</p>
          <p className="text-sm text-muted">
            {task.data.dueAt ? `Scadenza ${formatRome(task.data.dueAt)}` : 'Nessuna scadenza'}
          </p>
          <p className="text-sm">
            {task.data.assignees.length > 0
              ? `Assegnata a ${task.data.assignees.map((person) => person.fullName).join(', ')}`
              : 'Nessun assegnatario: può prenderla chi è nel gruppo.'}
          </p>
          {task.data.recurrence ? (
            <p className="text-sm text-muted">
              {`Occorrenza del ${formatLocalDate(task.data.recurrence.occurrenceLocalDate)}.`}
              {task.data.recurrence.detached
                ? ' Questa data è stata modificata: le altre date e la regola restano invariate.'
                : ''}
            </p>
          ) : null}
          {task.data.checklists.length > 0 ? (
            <section className="flex flex-col gap-2">
              <h2 className="text-lg font-semibold">Checklist da eseguire</h2>
              {checklistsReady(task.data) ? null : (
                <p className="text-sm text-muted">
                  Prima di concludere l'attività completa le checklist collegate.
                </p>
              )}
              <ul className="flex flex-col gap-2">
                {task.data.checklists.map((checklist) => (
                  <li
                    key={checklist.templateId}
                    className="flex flex-col gap-2 rounded-xl border border-line p-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div>
                      <p className="font-medium">{checklist.title}</p>
                      <p className="text-sm text-muted">
                        {checklist.run
                          ? `${CHECKLIST_RUN_LABEL[checklist.run.status]}${checklist.run.outcome ? ` · ${CHECKLIST_OUTCOME_LABEL[checklist.run.outcome]}` : ''}`
                          : 'Non ancora avviata'}
                      </p>
                    </div>
                    {checklist.run ? (
                      <Link
                        to={`/checklist/esecuzioni/${checklist.run.id}`}
                        className={secondaryButton}
                      >
                        {checklist.run.status === 'completed'
                          ? 'Apri la checklist'
                          : 'Continua la checklist'}
                      </Link>
                    ) : (
                      <button
                        type="button"
                        className={primaryButton}
                        disabled={pending}
                        onClick={() => {
                          setPending(true);
                          setActionError(null);
                          void api<{ id: string }>(
                            `/api/checklist-templates/${checklist.templateId}/runs`,
                            { method: 'POST', body: { taskId: task.data.id } },
                          )
                            .then(async (created) => {
                              await refresh(queryClient, task.data.id);
                              navigate(`/checklist/esecuzioni/${created.id}`);
                            })
                            .catch((reason: unknown) => setActionError(errorMessage(reason)))
                            .finally(() => setPending(false));
                        }}
                      >
                        Esegui la checklist
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          <Banner message={actionError} />
          <div className="flex flex-wrap gap-3">
            {canClaim(task.data, session.data) ? (
              <button
                type="button"
                className={primaryButton}
                disabled={pending}
                onClick={() => void run(`/api/tasks/${task.data.id}/claim`)}
              >
                Prendi in carico
              </button>
            ) : null}
            {canRelease(task.data, session.data) ? (
              <button
                type="button"
                className={secondaryButton}
                disabled={pending}
                onClick={() => void run(`/api/tasks/${task.data.id}/release`)}
              >
                Rilascia
              </button>
            ) : null}
            {canComplete(task.data, session.data) ? (
              <button
                type="button"
                className={primaryButton}
                disabled={pending || !checklistsReady(task.data)}
                onClick={() => void run(`/api/tasks/${task.data.id}/complete`)}
              >
                Completa
              </button>
            ) : null}
            {canManage(session.data) && task.data.status === 'completed' ? (
              <button
                type="button"
                className={secondaryButton}
                disabled={pending}
                onClick={() => void run(`/api/tasks/${task.data.id}/reopen`)}
              >
                Riapri
              </button>
            ) : null}
            {canManage(session.data) &&
            (task.data.status === 'todo' || task.data.status === 'in_progress') ? (
              <button
                type="button"
                className={dangerButton}
                disabled={pending}
                onClick={() =>
                  void run(
                    `/api/tasks/${task.data.id}/cancel`,
                    'Annullare questa attività? Non si può riaprire.',
                  )
                }
              >
                Annulla
              </button>
            ) : null}
          </div>
        </article>
      ) : null}
      {task.data && session.data && canManage(session.data) ? (
        <EditTask
          key={task.data.updatedAt}
          task={task.data}
          onSaved={() => refresh(queryClient, task.data.id)}
        />
      ) : null}
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Cronologia</h2>
        {history.isLoading ? (
          <p className="text-sm text-muted">Caricamento della cronologia…</p>
        ) : null}
        {history.isError ? <Banner message={errorMessage(history.error)} /> : null}
        {history.data && history.data.items.length === 0 ? (
          <p className="text-sm text-muted">Nessun evento.</p>
        ) : null}
        <ol className="flex flex-col gap-2">
          {history.data?.items.map((item) => (
            <li key={item.id} className="rounded-2xl border border-line bg-surface p-3 text-sm">
              <p className="font-medium">{TASK_ACTION_LABEL[item.action] ?? item.action}</p>
              <p className="text-muted">
                {historyActor(item)} · {formatRome(item.createdAt)}
              </p>
            </li>
          ))}
        </ol>
      </section>
    </section>
  );
}

function EditTask({ task, onSaved }: { task: TaskRecord; onSaved: () => Promise<void> }) {
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? '');
  const [priority, setPriority] = useState<TaskPriority>(task.priority);
  const [dueLocal, setDueLocal] = useState(task.dueAt ? isoToRomeInput(task.dueAt) : '');
  const [assigneeIds, setAssigneeIds] = useState(task.assignees.map((person) => person.id));
  const [checklistTemplateIds, setChecklistTemplateIds] = useState(
    task.checklists.map((checklist) => checklist.templateId),
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const members = useQuery({
    queryKey: ['group-members', task.groupId],
    queryFn: () => api<{ members: MemberRecord[] }>(`/api/groups/${task.groupId}/members`),
  });
  const templates = useQuery({
    queryKey: ['checklist-templates', task.groupId],
    queryFn: () =>
      api<{ items: ChecklistTemplateSummary[] }>(
        `/api/checklist-templates?groupId=${task.groupId}&status=active`,
      ),
  });

  return (
    <form
      className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-4"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        const dueAt = dueLocal ? safeDue(dueLocal) : null;
        if (dueLocal && !dueAt) {
          setError('La scadenza non è valida.');
          return;
        }
        setPending(true);
        setError(null);
        void api(`/api/tasks/${task.id}`, {
          method: 'PATCH',
          body: { title, description, priority, dueAt, assigneeIds, checklistTemplateIds },
        })
          .then(() => onSaved())
          .catch((reason: unknown) => {
            setError(errorMessage(reason));
          })
          .finally(() => {
            setPending(false);
          });
      }}
    >
      <h2 className="text-lg font-semibold">Modifica</h2>
      <Banner message={error} />
      <Field
        id="edit-title"
        label="Titolo"
        value={title}
        onChange={(event) => setTitle(event.target.value)}
      />
      <Field
        id="edit-description"
        label="Descrizione"
        value={description}
        onChange={(event) => setDescription(event.target.value)}
      />
      <SelectField
        id="edit-priority"
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
        id="edit-due"
        label="Scadenza"
        type="datetime-local"
        value={dueLocal}
        hint="Orario di Roma."
        onChange={(event) => setDueLocal(event.target.value)}
      />
      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium">Checklist da eseguire</legend>
        {templates.data?.items.length === 0 && task.checklists.length === 0 ? (
          <p className="text-sm text-muted">Nessuna checklist attiva in questo gruppo.</p>
        ) : null}
        {task.checklists
          .filter(
            (checklist) =>
              !templates.data?.items.some((template) => template.id === checklist.templateId),
          )
          .map((checklist) => (
            <label key={checklist.templateId} className="flex min-h-11 items-center gap-3">
              <input
                type="checkbox"
                className="size-5"
                checked={checklistTemplateIds.includes(checklist.templateId)}
                onChange={(event) => {
                  setChecklistTemplateIds((current) =>
                    event.target.checked
                      ? [...current, checklist.templateId]
                      : current.filter((id) => id !== checklist.templateId),
                  );
                }}
              />
              <span>{checklist.title} · inattiva</span>
            </label>
          ))}
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
      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium">Assegnatari</legend>
        {members.isPending ? (
          <p className="text-sm text-muted">Caricamento delle persone…</p>
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
      <button type="submit" className={secondaryButton} disabled={pending}>
        Salva le modifiche
      </button>
    </form>
  );
}

function historyActor(item: TaskHistoryItem): string {
  if (item.actorName) {
    return item.actorName;
  }
  if (item.metadata?.source === 'recurrence') {
    return 'Generata automaticamente';
  }
  return 'Persona rimossa';
}

function checklistsReady(task: TaskRecord): boolean {
  return task.checklists.every((checklist) => checklist.run?.status === 'completed');
}

function canManage(user: Profile): boolean {
  return user.role === 'admin' || user.role === 'coordinator';
}

function canClaim(task: TaskRecord, user: Profile): boolean {
  if (task.status !== 'todo') {
    return false;
  }
  if (canManage(user)) {
    return true;
  }
  if (task.assignees.some((person) => person.id === user.id)) {
    return true;
  }
  return task.assignees.length === 0;
}

function canRelease(task: TaskRecord, user: Profile): boolean {
  return task.status === 'in_progress' && (canManage(user) || task.claimedBy === user.id);
}

function canComplete(task: TaskRecord, user: Profile): boolean {
  if (task.status !== 'todo' && task.status !== 'in_progress') {
    return false;
  }
  if (canManage(user)) {
    return true;
  }
  return task.assignees.some((person) => person.id === user.id) || task.claimedBy === user.id;
}

function safeDue(value: string): string | null {
  try {
    return romeInputToIso(value);
  } catch {
    return null;
  }
}

async function refresh(queryClient: ReturnType<typeof useQueryClient>, id: string): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ['task', id] }),
    queryClient.invalidateQueries({ queryKey: ['task-history', id] }),
    queryClient.invalidateQueries({ queryKey: ['tasks'] }),
    queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
  ]);
}
