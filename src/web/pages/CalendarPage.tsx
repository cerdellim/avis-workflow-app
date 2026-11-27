import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import type { GroupRecord, MemberRecord } from '../../shared/account';
import type {
  CalendarItem,
  CalendarResponse,
  RecurrenceFrequency,
  RecurrenceRule,
} from '../../shared/recurrence';
import type { TaskPriority } from '../../shared/tasks';
import { api, errorMessage } from '../api';
import { Banner, Field, SelectField, primaryButton, secondaryButton } from '../components/Field';
import { TASK_PRIORITY_LABEL, TASK_STATUS_LABEL } from '../labels';
import { useSession } from '../session';
import { formatLocalDate } from '../time';

const WEEKDAYS = [
  { value: 1, label: 'Lunedì' },
  { value: 2, label: 'Martedì' },
  { value: 3, label: 'Mercoledì' },
  { value: 4, label: 'Giovedì' },
  { value: 5, label: 'Venerdì' },
  { value: 6, label: 'Sabato' },
  { value: 7, label: 'Domenica' },
];

const MONTHS = [
  'Gennaio',
  'Febbraio',
  'Marzo',
  'Aprile',
  'Maggio',
  'Giugno',
  'Luglio',
  'Agosto',
  'Settembre',
  'Ottobre',
  'Novembre',
  'Dicembre',
];

export function CalendarPage() {
  const session = useSession();
  const queryClient = useQueryClient();
  const [cursor, setCursor] = useState(() => romeMonth());
  const [notice, setNotice] = useState<string | null>(null);
  const [tickError, setTickError] = useState<string | null>(null);
  const [ticking, setTicking] = useState(false);
  const bounds = monthBounds(cursor.year, cursor.month);
  const calendar = useQuery({
    queryKey: ['calendar', bounds.from, bounds.to],
    queryFn: () => api<CalendarResponse>(`/api/calendar?from=${bounds.from}&to=${bounds.to}`),
  });
  const canManage = session.data?.role === 'admin' || session.data?.role === 'coordinator';
  const days = groupByDate(calendar.data?.items ?? []);

  return (
    <section className="mx-auto flex max-w-3xl flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Calendario</h1>
          <p className="mt-1 text-sm text-muted">
            Scadenze dei gruppi a cui hai accesso, in orario di Roma.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className={secondaryButton}
            onClick={() => setCursor((current) => shiftMonth(current, -1))}
          >
            Mese precedente
          </button>
          <button
            type="button"
            className={secondaryButton}
            onClick={() => setCursor((current) => shiftMonth(current, 1))}
          >
            Mese successivo
          </button>
        </div>
      </div>
      <h2 className="text-lg font-semibold capitalize">{monthLabel(cursor.year, cursor.month)}</h2>
      {session.data?.role === 'admin' ? (
        <div className="flex flex-col gap-2">
          <button
            type="button"
            className={secondaryButton}
            disabled={ticking}
            onClick={() => {
              setTicking(true);
              setTickError(null);
              setNotice(null);
              void api<{ inserted: number }>('/api/admin/jobs/tick', { method: 'POST', body: {} })
                .then(async (result) => {
                  setNotice(
                    result.inserted === 0
                      ? 'Nessuna attività nuova.'
                      : result.inserted === 1
                        ? 'Generata 1 attività.'
                        : `Generate ${result.inserted} attività.`,
                  );
                  await queryClient.invalidateQueries({ queryKey: ['calendar'] });
                  await queryClient.invalidateQueries({ queryKey: ['tasks'] });
                })
                .catch((reason: unknown) => setTickError(errorMessage(reason)))
                .finally(() => setTicking(false));
            }}
          >
            Genera le attività previste
          </button>
          <Banner message={tickError} />
          {notice ? <p className="text-sm text-muted">{notice}</p> : null}
        </div>
      ) : null}
      {calendar.isPending ? <p className="text-muted">Caricamento del calendario…</p> : null}
      {calendar.isError ? <Banner message={errorMessage(calendar.error)} /> : null}
      {calendar.data && days.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-line bg-surface p-4 text-muted">
          Nessuna scadenza in questo mese.
        </p>
      ) : null}
      <ul className="flex flex-col gap-4">
        {days.map((day) => (
          <li key={day.date} className="flex flex-col gap-2">
            <h3 className="text-sm font-medium text-muted">{formatLocalDate(day.date)}</h3>
            <ul className="flex flex-col gap-2">
              {day.items.map((item) => (
                <li key={item.id}>
                  <Link
                    to={`/attivita/${item.id}`}
                    className="flex min-h-11 flex-col gap-1 rounded-2xl border border-line bg-surface p-4"
                  >
                    <span className="font-medium">{item.title}</span>
                    <span className="text-sm text-muted">
                      {romeTime(item.dueAt)} · {item.groupName} · {TASK_STATUS_LABEL[item.status]} ·{' '}
                      {TASK_PRIORITY_LABEL[item.priority]}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
      {canManage ? <Rules /> : null}
    </section>
  );
}

function Rules() {
  const queryClient = useQueryClient();
  const rules = useQuery({
    queryKey: ['recurrences'],
    queryFn: () => api<{ items: RecurrenceRule[] }>('/api/recurrences'),
  });
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<RecurrenceRule | null>(null);
  const [draftKey, setDraftKey] = useState(0);
  const formOpen = creating || editing !== null;

  async function refresh(): Promise<void> {
    await queryClient.invalidateQueries({ queryKey: ['recurrences'] });
  }

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold">Ricorrenze</h2>
          <p className="mt-1 text-sm text-muted">
            Una regola genera le attività fino alla fine del mese successivo, e comunque non oltre
            62 giorni. Modificarla non riscrive le attività già create.
          </p>
        </div>
        <button
          type="button"
          className={`${formOpen ? secondaryButton : primaryButton} w-full sm:w-auto`}
          onClick={() => {
            if (formOpen) {
              setCreating(false);
              setEditing(null);
              return;
            }
            setCreating(true);
          }}
        >
          {formOpen ? 'Annulla' : 'Nuova regola'}
        </button>
      </div>
      {formOpen ? (
        <RuleForm
          key={editing?.id ?? `new-${draftKey}`}
          rule={editing}
          onSaved={async () => {
            setEditing(null);
            setCreating(false);
            setDraftKey((current) => current + 1);
            await refresh();
          }}
          onCancel={() => {
            setEditing(null);
            setCreating(false);
          }}
        />
      ) : (
        <>
          {rules.isPending ? <p className="text-muted">Caricamento delle regole…</p> : null}
          {rules.isError ? <Banner message={errorMessage(rules.error)} /> : null}
          {rules.data && rules.data.items.length === 0 ? (
            <p className="text-sm text-muted">Nessuna regola.</p>
          ) : null}
          <ul className="flex flex-col gap-3">
            {rules.data?.items.map((rule) => (
              <li key={rule.id} className="rounded-2xl border border-line bg-surface p-4">
                <div className="flex flex-col gap-1">
                  <span className="font-medium">{rule.title}</span>
                  <span className="text-sm text-muted">
                    {rule.groupName} · {frequencyLabel(rule)} · {rule.localTime}
                    {rule.suspendedAt ? ' · Sospesa' : ''}
                  </span>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    className={secondaryButton}
                    onClick={() => {
                      setCreating(false);
                      setEditing(rule);
                    }}
                  >
                    Modifica
                  </button>
                  <RuleState rule={rule} onChanged={refresh} />
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function RuleState({ rule, onChanged }: { rule: RecurrenceRule; onChanged: () => Promise<void> }) {
  const [cancelFuture, setCancelFuture] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (rule.suspendedAt) {
    return (
      <div className="flex flex-col gap-2">
        <button
          type="button"
          className={secondaryButton}
          disabled={pending}
          onClick={() => {
            setPending(true);
            setError(null);
            void api(`/api/recurrences/${rule.id}/resume`, { method: 'POST', body: {} })
              .then(onChanged)
              .catch((reason: unknown) => setError(errorMessage(reason)))
              .finally(() => setPending(false));
          }}
        >
          Riattiva
        </button>
        <Banner message={error} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <label className="flex min-h-11 items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={cancelFuture}
          onChange={(event) => setCancelFuture(event.target.checked)}
        />
        Annulla le attività future ancora aperte
      </label>
      <button
        type="button"
        className={secondaryButton}
        disabled={pending}
        onClick={() => {
          const message = cancelFuture
            ? 'Le attività future ancora aperte verranno annullate e non saranno ricreate.'
            : 'La regola non genererà nuove date. Le attività già create restano.';
          if (!window.confirm(message)) {
            return;
          }
          setPending(true);
          setError(null);
          void api(`/api/recurrences/${rule.id}/suspend`, {
            method: 'POST',
            body: { cancelFutureOpen: cancelFuture },
          })
            .then(onChanged)
            .catch((reason: unknown) => setError(errorMessage(reason)))
            .finally(() => setPending(false));
        }}
      >
        Sospendi
      </button>
      <Banner message={error} />
    </div>
  );
}

function RuleForm({
  rule,
  onSaved,
  onCancel,
}: {
  rule: RecurrenceRule | null;
  onSaved: () => Promise<void>;
  onCancel: () => void;
}) {
  const groups = useQuery({
    queryKey: ['groups'],
    queryFn: () => api<{ items: GroupRecord[] }>('/api/groups'),
  });
  const [title, setTitle] = useState(rule?.title ?? '');
  const [description, setDescription] = useState(rule?.description ?? '');
  const [groupId, setGroupId] = useState(rule?.groupId ?? '');
  const [priority, setPriority] = useState<TaskPriority>(rule?.priority ?? 'normal');
  const [frequency, setFrequency] = useState<RecurrenceFrequency>(rule?.frequency ?? 'weekly');
  const [intervalCount, setIntervalCount] = useState(String(rule?.intervalCount ?? 1));
  const [weekdays, setWeekdays] = useState<number[]>(rule?.weekdays ?? [1]);
  const [dayOfMonth, setDayOfMonth] = useState(String(rule?.dayOfMonth ?? 1));
  const [monthOfYear, setMonthOfYear] = useState(String(rule?.monthOfYear ?? 1));
  const [localTime, setLocalTime] = useState(rule?.localTime ?? '09:00');
  const [startsOn, setStartsOn] = useState(rule?.startsOn ?? romeDate());
  const [endsOn, setEndsOn] = useState(rule?.endsOn ?? '');
  const [assigneeIds, setAssigneeIds] = useState<string[]>(
    rule?.assignees.map((person) => person.id) ?? [],
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const members = useQuery({
    queryKey: ['group-members', groupId],
    queryFn: () => api<{ members: MemberRecord[] }>(`/api/groups/${groupId}/members`),
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
        const interval = Number(intervalCount);
        const body: Record<string, unknown> = {
          title,
          description,
          assigneeIds,
          priority,
          frequency,
          intervalCount: interval,
          localTime,
          startsOn,
        };
        if (endsOn) {
          body.endsOn = endsOn;
        }
        if (frequency === 'weekly') {
          body.weekdays = weekdays;
        }
        if (frequency === 'monthly' || frequency === 'yearly') {
          body.dayOfMonth = Number(dayOfMonth);
        }
        if (frequency === 'yearly') {
          body.monthOfYear = Number(monthOfYear);
        }
        if (!rule) {
          body.groupId = groupId;
        }
        const path = rule ? `/api/recurrences/${rule.id}` : '/api/recurrences';
        void api(path, { method: rule ? 'PATCH' : 'POST', body })
          .then(onSaved)
          .catch((reason: unknown) => setError(errorMessage(reason)))
          .finally(() => setPending(false));
      }}
    >
      <h3 className="text-lg font-semibold">{rule ? 'Modifica la regola' : 'Nuova regola'}</h3>
      <p className="text-sm text-muted">Le attività già create non cambiano.</p>
      <Banner message={error} />
      <Field
        id="rule-title"
        label="Titolo"
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        required
      />
      <Field
        id="rule-description"
        label="Descrizione"
        value={description}
        onChange={(event) => setDescription(event.target.value)}
      />
      {rule ? (
        <p className="text-sm text-muted">Gruppo: {rule.groupName}</p>
      ) : (
        <SelectField
          id="rule-group"
          label="Gruppo"
          value={groupId}
          required
          onChange={(event) => {
            setGroupId(event.target.value);
            setAssigneeIds([]);
          }}
        >
          <option value="">Scegli un gruppo</option>
          {activeGroups.map((group) => (
            <option key={group.id} value={group.id}>
              {group.name}
            </option>
          ))}
        </SelectField>
      )}
      <SelectField
        id="rule-priority"
        label="Priorità"
        value={priority}
        onChange={(event) => setPriority(event.target.value as TaskPriority)}
      >
        <option value="low">Bassa</option>
        <option value="normal">Normale</option>
        <option value="high">Alta</option>
        <option value="urgent">Urgente</option>
      </SelectField>
      <SelectField
        id="rule-frequency"
        label="Frequenza"
        value={frequency}
        onChange={(event) => setFrequency(event.target.value as RecurrenceFrequency)}
      >
        <option value="daily">Giornaliera</option>
        <option value="weekly">Settimanale</option>
        <option value="monthly">Mensile</option>
        <option value="yearly">Annuale</option>
      </SelectField>
      <Field
        id="rule-interval"
        label="Ogni"
        type="number"
        min={1}
        max={365}
        value={intervalCount}
        onChange={(event) => setIntervalCount(event.target.value)}
        required
      />
      {frequency === 'weekly' ? (
        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium">Giorni</legend>
          {WEEKDAYS.map((day) => (
            <label key={day.value} className="flex min-h-11 items-center gap-2">
              <input
                type="checkbox"
                checked={weekdays.includes(day.value)}
                onChange={(event) => {
                  setWeekdays((current) =>
                    event.target.checked
                      ? [...current, day.value]
                      : current.filter((value) => value !== day.value),
                  );
                }}
              />
              <span>{day.label}</span>
            </label>
          ))}
        </fieldset>
      ) : null}
      {frequency === 'monthly' || frequency === 'yearly' ? (
        <Field
          id="rule-day"
          label="Giorno del mese"
          type="number"
          min={1}
          max={31}
          value={dayOfMonth}
          hint="Il 31 diventa l’ultimo giorno nei mesi più corti. L’ancora non si sposta."
          onChange={(event) => setDayOfMonth(event.target.value)}
          required
        />
      ) : null}
      {frequency === 'yearly' ? (
        <SelectField
          id="rule-month"
          label="Mese"
          value={monthOfYear}
          onChange={(event) => setMonthOfYear(event.target.value)}
        >
          {MONTHS.map((label, index) => (
            <option key={label} value={index + 1}>
              {label}
            </option>
          ))}
        </SelectField>
      ) : null}
      <Field
        id="rule-time"
        label="Ora"
        type="time"
        value={localTime}
        hint="Orario di Roma."
        onChange={(event) => setLocalTime(event.target.value)}
        required
      />
      <Field
        id="rule-start"
        label="Inizio"
        type="date"
        value={startsOn}
        onChange={(event) => setStartsOn(event.target.value)}
        required
      />
      <Field
        id="rule-end"
        label="Fine"
        type="date"
        value={endsOn}
        hint="Lascia vuoto se la regola non ha una fine."
        onChange={(event) => setEndsOn(event.target.value)}
      />
      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium">Assegnatari</legend>
        {members.isPending && groupId ? (
          <p className="text-sm text-muted">Caricamento delle persone…</p>
        ) : null}
        {members.data?.members
          .filter((person) => person.status === 'active')
          .map((person) => (
            <label key={person.id} className="flex min-h-11 items-center gap-2">
              <input
                type="checkbox"
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
      <div className="flex flex-wrap gap-2">
        <button type="submit" className={primaryButton} disabled={pending}>
          {rule ? 'Salva la regola' : 'Crea la regola'}
        </button>
        <button type="button" className={secondaryButton} onClick={onCancel}>
          Annulla
        </button>
      </div>
    </form>
  );
}

function frequencyLabel(rule: RecurrenceRule): string {
  const every = rule.intervalCount === 1 ? '' : ` ogni ${rule.intervalCount}`;
  if (rule.frequency === 'daily') {
    return `Giornaliera${every}`;
  }
  if (rule.frequency === 'weekly') {
    const names = WEEKDAYS.filter((day) => rule.weekdays?.includes(day.value)).map(
      (day) => day.label,
    );
    return `Settimanale${every}${names.length > 0 ? ` · ${names.join(', ')}` : ''}`;
  }
  if (rule.frequency === 'monthly') {
    return `Mensile${every} · giorno ${rule.dayOfMonth ?? ''}`;
  }
  return `Annuale${every} · ${MONTHS[(rule.monthOfYear ?? 1) - 1] ?? ''} ${rule.dayOfMonth ?? ''}`;
}

function groupByDate(items: CalendarItem[]): { date: string; items: CalendarItem[] }[] {
  const grouped = new Map<string, CalendarItem[]>();
  for (const item of items) {
    const current = grouped.get(item.localDate) ?? [];
    current.push(item);
    grouped.set(item.localDate, current);
  }
  return [...grouped.entries()].map(([date, dayItems]) => ({ date, items: dayItems }));
}

function romeMonth(date = new Date()): { year: number; month: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Rome',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(date);
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '';
  return { year: Number(read('year')), month: Number(read('month')) };
}

function romeDate(date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Rome',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '';
  return `${read('year')}-${read('month')}-${read('day')}`;
}

function shiftMonth(
  current: { year: number; month: number },
  delta: number,
): { year: number; month: number } {
  const date = new Date(Date.UTC(current.year, current.month - 1 + delta, 1));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1 };
}

function monthBounds(year: number, month: number): { from: string; to: string } {
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const padded = String(month).padStart(2, '0');
  return { from: `${year}-${padded}-01`, to: `${year}-${padded}-${String(last).padStart(2, '0')}` };
}

function monthLabel(year: number, month: number): string {
  return new Intl.DateTimeFormat('it-IT', { month: 'long', year: 'numeric' }).format(
    new Date(year, month - 1, 1),
  );
}

function romeTime(iso: string): string {
  return new Intl.DateTimeFormat('it-IT', {
    timeZone: 'Europe/Rome',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}
