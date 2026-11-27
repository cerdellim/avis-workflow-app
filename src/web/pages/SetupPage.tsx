import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Navigate } from 'react-router';
import type { Profile } from '../../shared/account';
import { setupSchema, type SetupInput } from '../../shared/schemas';
import { api, errorMessage } from '../api';
import { Banner, Field, primaryButton } from '../components/Field';
import { useSession } from '../session';

type SetupStatus = { initialized: boolean };

export function SetupPage() {
  const session = useSession();
  const queryClient = useQueryClient();
  const status = useQuery({
    queryKey: ['setup'],
    queryFn: () => api<SetupStatus>('/api/setup'),
    retry: false,
  });
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<SetupInput>({
    resolver: zodResolver(setupSchema),
    defaultValues: { bootstrapToken: '', fullName: '', email: '', password: '' },
  });

  if (session.data) {
    return <Navigate to="/" replace />;
  }

  return (
    <section className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Primo avvio</h1>
        <p className="mt-1 text-sm text-muted">
          Crea l'amministratore dell'associazione. Il codice di avvio è quello configurato sul
          server.
        </p>
      </div>
      {status.isPending ? <p className="text-muted">Caricamento…</p> : null}
      {status.isError ? <Banner message={errorMessage(status.error)} /> : null}
      {status.data?.initialized ? (
        <p>L'associazione è già stata avviata. Entra con le tue credenziali.</p>
      ) : null}
      {status.data && !status.data.initialized ? (
        <form
          className="flex flex-col gap-4"
          noValidate
          onSubmit={(event) => {
            void form.handleSubmit(async (values) => {
              setFormError(null);
              try {
                const profile = await api<Profile>('/api/setup', { method: 'POST', body: values });
                queryClient.setQueryData(['session'], profile);
              } catch (error) {
                setFormError(errorMessage(error));
              }
            })(event);
          }}
        >
          <Banner message={formError} />
          <Field
            id="setup-token"
            label="Codice di avvio"
            autoComplete="off"
            error={form.formState.errors.bootstrapToken?.message}
            {...form.register('bootstrapToken')}
          />
          <Field
            id="setup-name"
            label="Nome e cognome"
            autoComplete="name"
            error={form.formState.errors.fullName?.message}
            {...form.register('fullName')}
          />
          <Field
            id="setup-email"
            label="Email"
            type="email"
            autoComplete="username"
            inputMode="email"
            error={form.formState.errors.email?.message}
            {...form.register('email')}
          />
          <Field
            id="setup-password"
            label="Password"
            type="password"
            autoComplete="new-password"
            hint="Usa una frase di almeno 16 caratteri."
            error={form.formState.errors.password?.message}
            {...form.register('password')}
          />
          <button type="submit" className={primaryButton} disabled={form.formState.isSubmitting}>
            Crea l'amministratore
          </button>
        </form>
      ) : null}
    </section>
  );
}
