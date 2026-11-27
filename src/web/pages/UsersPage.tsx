import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import type { GroupRecord, Profile, Role } from '../../shared/account';
import {
  createUserSchema,
  patchUserSchema,
  type CreateUserInput,
  type PatchUserInput,
} from '../../shared/schemas';
import { api, errorMessage } from '../api';
import {
  Banner,
  Field,
  Note,
  dangerButton,
  primaryButton,
  secondaryButton,
  SelectField,
} from '../components/Field';
import { ROLE_LABEL, USER_STATUS_LABEL } from '../labels';

type IssuedLink = { label: string; url: string };

export function UsersPage() {
  const queryClient = useQueryClient();
  const users = useQuery({
    queryKey: ['users'],
    queryFn: () => api<{ items: Profile[] }>('/api/users'),
  });
  const groups = useQuery({
    queryKey: ['groups'],
    queryFn: () => api<{ items: GroupRecord[] }>('/api/groups'),
  });
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [issued, setIssued] = useState<IssuedLink | null>(null);
  const [copied, setCopied] = useState(false);
  const form = useForm<CreateUserInput>({
    resolver: zodResolver(createUserSchema),
    defaultValues: { fullName: '', email: '', role: 'volunteer', groupIds: [] },
  });
  const selectedGroups = form.watch('groupIds');

  return (
    <section className="mx-auto flex max-w-3xl flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Utenti</h1>
          <p className="mt-1 text-sm text-muted">
            Massimo 15 persone. Il link di invito si consegna di persona.
          </p>
        </div>
        <button
          type="button"
          className={`${creating ? secondaryButton : primaryButton} w-full sm:w-auto`}
          onClick={() => {
            if (creating) {
              setCreating(false);
              return;
            }
            form.reset();
            setFormError(null);
            setCreating(true);
          }}
        >
          {creating ? 'Annulla' : 'Nuova persona'}
        </button>
      </div>
      {issued ? (
        <div
          className="flex flex-col gap-2 rounded-2xl border border-line bg-surface p-4"
          role="status"
        >
          <p className="font-medium">{issued.label}</p>
          <input
            readOnly
            value={issued.url}
            className="min-h-11 rounded-lg border border-line px-3"
            aria-label="Link da consegnare"
          />
          <button
            type="button"
            className={secondaryButton}
            onClick={() => {
              void navigator.clipboard.writeText(issued.url).then(() => {
                setCopied(true);
              });
            }}
          >
            Copia il link
          </button>
          {copied ? <p>Link copiato.</p> : null}
        </div>
      ) : null}
      {creating ? (
        <form
          className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-4"
          noValidate
          onSubmit={(event) => {
            void form.handleSubmit(async (values) => {
              setFormError(null);
              setCopied(false);
              try {
                const created = await api<{ user: Profile; inviteUrl: string }>('/api/users', {
                  method: 'POST',
                  body: values,
                });
                setIssued({ label: `Invito per ${created.user.fullName}`, url: created.inviteUrl });
                form.reset();
                setCreating(false);
                await queryClient.invalidateQueries({ queryKey: ['users'] });
              } catch (error) {
                setFormError(errorMessage(error));
              }
            })(event);
          }}
        >
          <h2 className="text-lg font-semibold">Nuova persona</h2>
          <Banner message={formError} />
          <Field
            id="new-user-name"
            label="Nome e cognome"
            autoComplete="name"
            error={form.formState.errors.fullName?.message}
            {...form.register('fullName')}
          />
          <Field
            id="new-user-email"
            label="Email"
            type="email"
            autoComplete="off"
            inputMode="email"
            error={form.formState.errors.email?.message}
            {...form.register('email')}
          />
          <SelectField
            id="new-user-role"
            label="Ruolo"
            error={form.formState.errors.role?.message}
            {...form.register('role')}
          >
            <option value="volunteer">Volontario</option>
            <option value="coordinator">Coordinatore</option>
            <option value="admin">Amministratore</option>
          </SelectField>
          <fieldset className="flex flex-col gap-1">
            <legend className="text-sm font-medium">Gruppi</legend>
            {groups.data && groups.data.items.length === 0 ? (
              <p className="text-sm text-muted">Nessun gruppo disponibile.</p>
            ) : null}
            {groups.data?.items.map((group) => (
              <label key={group.id} className="flex min-h-11 items-center gap-3">
                <input
                  type="checkbox"
                  checked={selectedGroups.includes(group.id)}
                  onChange={(event) => {
                    const next = event.target.checked
                      ? [...selectedGroups, group.id]
                      : selectedGroups.filter((id) => id !== group.id);
                    form.setValue('groupIds', next, { shouldValidate: true });
                  }}
                />
                {group.name}
              </label>
            ))}
          </fieldset>
          <button type="submit" className={primaryButton} disabled={form.formState.isSubmitting}>
            Crea l'invito
          </button>
        </form>
      ) : (
        <>
          {users.isPending ? <p className="text-muted">Caricamento delle persone…</p> : null}
          {users.isError ? <Banner message={errorMessage(users.error)} /> : null}
          {users.data && users.data.items.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-line bg-surface p-4 text-muted">
              Non ci sono persone.
            </p>
          ) : null}
          <ul className="flex flex-col gap-3">
            {users.data?.items.map((user) => (
              <li key={user.id}>
                <UserCard
                  user={user}
                  onIssued={(link) => {
                    setCopied(false);
                    setIssued(link);
                  }}
                />
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function UserCard({ user, onIssued }: { user: Profile; onIssued: (link: IssuedLink) => void }) {
  const queryClient = useQueryClient();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const form = useForm<PatchUserInput>({
    resolver: zodResolver(patchUserSchema),
    defaultValues: { fullName: user.fullName, email: user.email, role: user.role },
  });

  async function run(work: () => Promise<void>): Promise<void> {
    setError(null);
    setMessage(null);
    try {
      await work();
      await queryClient.invalidateQueries({ queryKey: ['users'] });
      await queryClient.invalidateQueries({ queryKey: ['session'] });
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  return (
    <article className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-4">
      <div>
        <h2 className="text-lg font-semibold">{user.fullName}</h2>
        <p className="text-sm text-muted">
          {user.email} · {ROLE_LABEL[user.role]} · {USER_STATUS_LABEL[user.status]}
        </p>
        <p className="text-sm text-muted">
          {user.groups.length > 0
            ? user.groups.map((group) => group.name).join(', ')
            : 'Nessun gruppo'}
        </p>
      </div>
      <Banner message={error} />
      <Note message={message} />
      <div className="flex flex-wrap gap-2">
        {user.status === 'invited' ? (
          <button
            type="button"
            className={secondaryButton}
            onClick={() => {
              void run(async () => {
                const result = await api<{ inviteUrl: string }>(`/api/users/${user.id}/invite`, {
                  method: 'POST',
                  body: {},
                });
                onIssued({ label: `Nuovo invito per ${user.fullName}`, url: result.inviteUrl });
                setMessage('Nuovo invito creato. Il precedente non è più valido.');
              });
            }}
          >
            Nuovo invito
          </button>
        ) : null}
        {user.status === 'active' ? (
          <button
            type="button"
            className={secondaryButton}
            onClick={() => {
              if (
                !window.confirm(
                  'Creare un nuovo link per la password? Quando verrà usato, le sessioni aperte di questa persona si chiuderanno.',
                )
              ) {
                return;
              }
              void run(async () => {
                const result = await api<{ resetUrl: string }>(
                  `/api/users/${user.id}/password-reset`,
                  {
                    method: 'POST',
                    body: {},
                  },
                );
                onIssued({ label: `Reset password per ${user.fullName}`, url: result.resetUrl });
                setMessage('Link di reset creato.');
              });
            }}
          >
            Link password
          </button>
        ) : null}
        {user.status !== 'disabled' ? (
          <button
            type="button"
            className={dangerButton}
            onClick={() => {
              if (!window.confirm(`Disattivare ${user.fullName}? Non potrà più accedere.`)) {
                return;
              }
              void run(async () => {
                await api(`/api/users/${user.id}/disable`, { method: 'POST', body: {} });
                setMessage('Persona disattivata.');
              });
            }}
          >
            Disattiva
          </button>
        ) : (
          <button
            type="button"
            className={secondaryButton}
            onClick={() => {
              void run(async () => {
                await api(`/api/users/${user.id}/enable`, { method: 'POST', body: {} });
                setMessage('Persona riattivata.');
              });
            }}
          >
            Riattiva
          </button>
        )}
      </div>
      <button
        type="button"
        className={secondaryButton}
        onClick={() => setEditing((value) => !value)}
      >
        {editing ? 'Chiudi' : 'Modifica'}
      </button>
      {editing ? (
        <form
          className="flex flex-col gap-3"
          noValidate
          onSubmit={(event) => {
            void form.handleSubmit(async (values) => {
              await run(async () => {
                await api(`/api/users/${user.id}`, { method: 'PATCH', body: values });
                setMessage('Dati aggiornati.');
              });
            })(event);
          }}
        >
          <Field
            id={`${user.id}-name`}
            label="Nome"
            error={form.formState.errors.fullName?.message}
            {...form.register('fullName')}
          />
          <Field
            id={`${user.id}-email`}
            label="Email"
            type="email"
            error={form.formState.errors.email?.message}
            {...form.register('email')}
          />
          <SelectField
            id={`${user.id}-role`}
            label="Ruolo"
            error={form.formState.errors.role?.message}
            {...form.register('role')}
          >
            {(Object.keys(ROLE_LABEL) as Role[]).map((role) => (
              <option key={role} value={role}>
                {ROLE_LABEL[role]}
              </option>
            ))}
          </SelectField>
          <button type="submit" className={secondaryButton} disabled={form.formState.isSubmitting}>
            Salva le modifiche
          </button>
        </form>
      ) : null}
    </article>
  );
}
