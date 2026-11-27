import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, Navigate, useLocation, useNavigate } from 'react-router';
import type { Profile } from '../../shared/account';
import { loginSchema, type LoginInput } from '../../shared/schemas';
import { api, errorMessage } from '../api';
import { Banner, Field, primaryButton } from '../components/Field';
import { useSession } from '../session';

export function LoginPage() {
  const session = useSession();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });
  const notice = readNotice(location.state);

  if (session.data) {
    return <Navigate to="/" replace />;
  }

  return (
    <form
      className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-4"
      noValidate
      onSubmit={(event) => {
        void form.handleSubmit(async (values) => {
          setFormError(null);
          try {
            const profile = await api<Profile>('/api/auth/login', { method: 'POST', body: values });
            queryClient.setQueryData(['session'], profile);
            await navigate('/');
          } catch (error) {
            setFormError(errorMessage(error));
          }
        })(event);
      }}
    >
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Accedi</h1>
        <p className="mt-1 text-sm text-muted">
          Usa l'email e la frase scelta in fase di attivazione.
        </p>
      </div>
      <NoteText message={notice} />
      <Banner message={formError} />
      <Field
        id="login-email"
        label="Email"
        type="email"
        autoComplete="username"
        inputMode="email"
        error={form.formState.errors.email?.message}
        {...form.register('email')}
      />
      <Field
        id="login-password"
        label="Password"
        type="password"
        autoComplete="current-password"
        error={form.formState.errors.password?.message}
        {...form.register('password')}
      />
      <button type="submit" className={primaryButton} disabled={form.formState.isSubmitting}>
        Entra
      </button>
      <p className="text-sm text-muted">
        <Link to="/avvio" className="font-medium text-brand-strong">
          Primo avvio dell'associazione
        </Link>
      </p>
    </form>
  );
}

function NoteText({ message }: { message: string | null }) {
  if (!message) {
    return null;
  }
  return (
    <p role="status" className="rounded-lg border border-line bg-canvas px-3 py-2 text-sm">
      {message}
    </p>
  );
}

function readNotice(state: unknown): string | null {
  if (typeof state !== 'object' || state === null || !('notice' in state)) {
    return null;
  }
  const notice = (state as { notice?: unknown }).notice;
  return typeof notice === 'string' ? notice : null;
}
