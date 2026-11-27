import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import type { GroupRecord, MemberRecord, Profile } from '../../shared/account';
import {
  groupSchema,
  patchGroupSchema,
  type GroupInput,
  type PatchGroupInput,
} from '../../shared/schemas';
import { api, errorMessage } from '../api';
import {
  Banner,
  Field,
  Note,
  dangerButton,
  primaryButton,
  secondaryButton,
} from '../components/Field';
import { GROUP_STATUS_LABEL } from '../labels';

export function GroupsPage() {
  const queryClient = useQueryClient();
  const groups = useQuery({
    queryKey: ['groups'],
    queryFn: () => api<{ items: GroupRecord[] }>('/api/groups'),
  });
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<GroupInput>({
    resolver: zodResolver(groupSchema),
    defaultValues: { name: '', description: '' },
  });

  return (
    <section className="mx-auto flex max-w-3xl flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Gruppi</h1>
          <p className="mt-1 text-sm text-muted">
            Un gruppo archiviato resta nello storico e non si cancella.
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
          {creating ? 'Annulla' : 'Nuovo gruppo'}
        </button>
      </div>
      {creating ? (
        <form
          className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-4"
          noValidate
          onSubmit={(event) => {
            void form.handleSubmit(async (values) => {
              setFormError(null);
              try {
                await api('/api/groups', { method: 'POST', body: values });
                form.reset();
                setCreating(false);
                await queryClient.invalidateQueries({ queryKey: ['groups'] });
              } catch (error) {
                setFormError(errorMessage(error));
              }
            })(event);
          }}
        >
          <h2 className="text-lg font-semibold">Nuovo gruppo</h2>
          <Banner message={formError} />
          <Field
            id="group-name"
            label="Nome"
            error={form.formState.errors.name?.message}
            {...form.register('name')}
          />
          <Field
            id="group-description"
            label="Descrizione"
            error={form.formState.errors.description?.message}
            {...form.register('description')}
          />
          <button type="submit" className={primaryButton} disabled={form.formState.isSubmitting}>
            Crea il gruppo
          </button>
        </form>
      ) : (
        <>
          {groups.isPending ? <p className="text-muted">Caricamento dei gruppi…</p> : null}
          {groups.isError ? <Banner message={errorMessage(groups.error)} /> : null}
          {groups.data && groups.data.items.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-line bg-surface p-4 text-muted">
              Non ci sono gruppi. Creane uno per organizzare le persone.
            </p>
          ) : null}
          <ul className="flex flex-col gap-3">
            {groups.data?.items.map((group) => (
              <li key={group.id}>
                <GroupCard group={group} />
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function GroupCard({ group }: { group: GroupRecord }) {
  const queryClient = useQueryClient();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const form = useForm<PatchGroupInput>({
    resolver: zodResolver(patchGroupSchema),
    defaultValues: { name: group.name, description: group.description ?? '', status: group.status },
  });

  async function refresh(): Promise<void> {
    await queryClient.invalidateQueries({ queryKey: ['groups'] });
    await queryClient.invalidateQueries({ queryKey: ['group-members', group.id] });
    await queryClient.invalidateQueries({ queryKey: ['session'] });
  }

  return (
    <article className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-4">
      <div>
        <h2 className="text-lg font-semibold">{group.name}</h2>
        <p className="text-sm text-muted">{GROUP_STATUS_LABEL[group.status]}</p>
        {group.description ? <p className="mt-1">{group.description}</p> : null}
      </div>
      <Banner message={error} />
      <Note message={message} />
      {editing ? (
        <form
          className="flex flex-col gap-3"
          noValidate
          onSubmit={(event) => {
            void form.handleSubmit(async (values) => {
              setError(null);
              setMessage(null);
              try {
                await api(`/api/groups/${group.id}`, { method: 'PATCH', body: values });
                setMessage('Gruppo aggiornato.');
                await refresh();
              } catch (caught) {
                setError(errorMessage(caught));
              }
            })(event);
          }}
        >
          <Field
            id={`${group.id}-name`}
            label="Nome"
            error={form.formState.errors.name?.message}
            {...form.register('name')}
          />
          <Field
            id={`${group.id}-description`}
            label="Descrizione"
            error={form.formState.errors.description?.message}
            {...form.register('description')}
          />
          <button type="submit" className={secondaryButton} disabled={form.formState.isSubmitting}>
            Salva
          </button>
        </form>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={secondaryButton}
          onClick={() => setEditing((value) => !value)}
        >
          {editing ? 'Chiudi' : 'Modifica'}
        </button>
        <button
          type="button"
          className={secondaryButton}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? 'Chiudi i membri' : 'Membri'}
        </button>
        {group.status === 'active' ? (
          <button
            type="button"
            className={dangerButton}
            onClick={() => {
              if (!window.confirm(`Archiviare il gruppo ${group.name}?`)) {
                return;
              }
              void (async () => {
                setError(null);
                try {
                  await api(`/api/groups/${group.id}`, {
                    method: 'PATCH',
                    body: {
                      name: group.name,
                      description: group.description ?? '',
                      status: 'archived',
                    },
                  });
                  setMessage('Gruppo archiviato.');
                  await refresh();
                } catch (caught) {
                  setError(errorMessage(caught));
                }
              })();
            }}
          >
            Archivia
          </button>
        ) : (
          <button
            type="button"
            className={secondaryButton}
            onClick={() => {
              void (async () => {
                setError(null);
                try {
                  await api(`/api/groups/${group.id}`, {
                    method: 'PATCH',
                    body: {
                      name: group.name,
                      description: group.description ?? '',
                      status: 'active',
                    },
                  });
                  setMessage('Gruppo riattivato.');
                  await refresh();
                } catch (caught) {
                  setError(errorMessage(caught));
                }
              })();
            }}
          >
            Ripristina
          </button>
        )}
      </div>
      {open ? <MembersEditor groupId={group.id} /> : null}
    </article>
  );
}

function MembersEditor({ groupId }: { groupId: string }) {
  const queryClient = useQueryClient();
  const users = useQuery({
    queryKey: ['users'],
    queryFn: () => api<{ items: Profile[] }>('/api/users'),
  });
  const members = useQuery({
    queryKey: ['group-members', groupId],
    queryFn: () => api<{ members: MemberRecord[] }>(`/api/groups/${groupId}/members`),
  });
  const [selected, setSelected] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const current = selected ?? members.data?.members.map((member) => member.id) ?? [];

  return (
    <div className="flex flex-col gap-3">
      <h3 className="font-medium">Persone del gruppo</h3>
      {members.isPending || users.isPending ? (
        <p className="text-sm text-muted">Caricamento…</p>
      ) : null}
      {members.isError || users.isError ? (
        <Banner message="Non riesco a caricare i membri." />
      ) : null}
      <Banner message={error} />
      <ul className="flex flex-col">
        {users.data?.items.map((user) => (
          <li key={user.id}>
            <label className="flex min-h-11 items-center gap-3">
              <input
                type="checkbox"
                checked={current.includes(user.id)}
                onChange={(event) => {
                  const base = selected ?? members.data?.members.map((member) => member.id) ?? [];
                  setSelected(
                    event.target.checked ? [...base, user.id] : base.filter((id) => id !== user.id),
                  );
                }}
              />
              {user.fullName}
            </label>
          </li>
        ))}
      </ul>
      <button
        type="button"
        className={primaryButton}
        disabled={pending}
        onClick={() => {
          void (async () => {
            setPending(true);
            setError(null);
            try {
              await api(`/api/groups/${groupId}/members`, {
                method: 'PUT',
                body: { userIds: current },
              });
              setSelected(null);
              await queryClient.invalidateQueries({ queryKey: ['group-members', groupId] });
              await queryClient.invalidateQueries({ queryKey: ['users'] });
              await queryClient.invalidateQueries({ queryKey: ['session'] });
            } catch (caught) {
              setError(errorMessage(caught));
            } finally {
              setPending(false);
            }
          })();
        }}
      >
        Salva i membri
      </button>
    </div>
  );
}
