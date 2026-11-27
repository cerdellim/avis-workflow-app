import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate } from 'react-router';
import type { Profile, SessionProfile } from '../../shared/account';
import {
  changePasswordSchema,
  patchMeSchema,
  type ChangePasswordInput,
  type PatchMeInput,
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
import { GROUP_STATUS_LABEL, ROLE_LABEL } from '../labels';
import { useSession } from '../session';

export function ProfilePage() {
  const session = useSession();
  const profile = session.data;
  if (!profile) {
    return <p className="text-muted">Caricamento del profilo…</p>;
  }
  return <ProfileEditor profile={profile} />;
}

function ProfileEditor({ profile }: { profile: Profile }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [nameMessage, setNameMessage] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [passwordMessage, setPasswordMessage] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [logoutError, setLogoutError] = useState<string | null>(null);
  const nameForm = useForm<PatchMeInput>({
    resolver: zodResolver(patchMeSchema),
    defaultValues: { fullName: profile.fullName },
  });
  const passwordForm = useForm<ChangePasswordInput>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: { currentPassword: '', newPassword: '' },
  });

  return (
    <section className="mx-auto flex max-w-3xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Profilo</h1>
        <p className="mt-1 text-muted">{profile.email}</p>
        <p className="text-sm text-muted">{ROLE_LABEL[profile.role]}</p>
      </div>
      <article className="rounded-2xl border border-line bg-surface p-4">
        <h2 className="text-lg font-semibold">Gruppi</h2>
        {profile.groups.length === 0 ? <p className="mt-2 text-muted">Nessun gruppo.</p> : null}
        {profile.groups.length > 0 ? (
          <ul className="mt-2 flex flex-col gap-1">
            {profile.groups.map((group) => (
              <li key={group.id}>
                {group.name} · {GROUP_STATUS_LABEL[group.status]}
              </li>
            ))}
          </ul>
        ) : null}
      </article>
      {profile.role === 'admin' ? (
        <nav aria-label="Amministrazione" className="flex flex-col gap-2 md:hidden">
          <Link to="/amministrazione/utenti" className={primaryButton}>
            Utenti
          </Link>
          <Link to="/amministrazione/gruppi" className={primaryButton}>
            Gruppi
          </Link>
          <Link to="/amministrazione/registro" className={primaryButton}>
            Registro
          </Link>
          <Link to="/amministrazione/impostazioni" className={primaryButton}>
            Impostazioni
          </Link>
        </nav>
      ) : null}
      {profile.role === 'admin' || profile.role === 'coordinator' ? (
        <a className={secondaryButton} href="/api/exports/tasks.csv">
          Scarica le attività (CSV)
        </a>
      ) : null}
      <form
        className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-4"
        noValidate
        onSubmit={(event) => {
          void nameForm.handleSubmit(async (values) => {
            setNameError(null);
            setNameMessage(null);
            try {
              const updated = await api<Profile>('/api/me', { method: 'PATCH', body: values });
              queryClient.setQueryData(['session'], (current: SessionProfile | undefined) =>
                current ? { ...current, ...updated } : updated,
              );
              setNameMessage('Nome aggiornato.');
            } catch (error) {
              setNameError(errorMessage(error));
            }
          })(event);
        }}
      >
        <h2 className="text-lg font-semibold">Nome</h2>
        <Banner message={nameError} />
        <Note message={nameMessage} />
        <Field
          id="profile-name"
          label="Nome e cognome"
          autoComplete="name"
          error={nameForm.formState.errors.fullName?.message}
          {...nameForm.register('fullName')}
        />
        <button type="submit" className={primaryButton} disabled={nameForm.formState.isSubmitting}>
          Salva il nome
        </button>
      </form>
      <form
        className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-4"
        noValidate
        onSubmit={(event) => {
          void passwordForm.handleSubmit(async (values) => {
            setPasswordError(null);
            setPasswordMessage(null);
            try {
              await api('/api/me/password', { method: 'POST', body: values });
              passwordForm.reset();
              setPasswordMessage(
                'Password aggiornata. Gli altri dispositivi sono stati disconnessi.',
              );
            } catch (error) {
              setPasswordError(errorMessage(error));
            }
          })(event);
        }}
      >
        <h2 className="text-lg font-semibold">Password</h2>
        <Banner message={passwordError} />
        <Note message={passwordMessage} />
        <Field
          id="profile-current-password"
          label="Password attuale"
          type="password"
          autoComplete="current-password"
          error={passwordForm.formState.errors.currentPassword?.message}
          {...passwordForm.register('currentPassword')}
        />
        <Field
          id="profile-new-password"
          label="Nuova password"
          type="password"
          autoComplete="new-password"
          hint="Usa una frase di almeno 16 caratteri."
          error={passwordForm.formState.errors.newPassword?.message}
          {...passwordForm.register('newPassword')}
        />
        <button
          type="submit"
          className={primaryButton}
          disabled={passwordForm.formState.isSubmitting}
        >
          Cambia password
        </button>
      </form>
      <article className="rounded-2xl border border-line bg-surface p-4">
        <h2 className="text-lg font-semibold">Notifiche sul telefono</h2>
        <p className="mt-2 text-sm text-muted">
          Su iPhone le notifiche push arrivano solo se aggiungi Avis Berceto alla schermata Home e apri
          l'app dall'icona, con iOS 16.4 o successivo. Se neghi il permesso, l'app continua a
          funzionare e le notifiche restano nell'elenco.
        </p>
        <Link to="/notifiche" className={`${secondaryButton} mt-4`}>
          Apri le notifiche
        </Link>
      </article>
      <div className="flex flex-col items-start gap-3">
        <Banner message={logoutError} />
        <button
          type="button"
          className={dangerButton}
          onClick={() => {
            void (async () => {
              setLogoutError(null);
              try {
                await api('/api/auth/logout', { method: 'POST', body: {} });
                queryClient.removeQueries({ queryKey: ['session'] });
                await navigate('/accedi');
              } catch (error) {
                setLogoutError(errorMessage(error));
              }
            })();
          }}
        >
          Esci
        </button>
      </div>
    </section>
  );
}
