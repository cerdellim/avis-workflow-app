import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router';
import type { Profile } from '../../shared/account';
import { passwordSchema } from '../../shared/schemas';
import { z } from 'zod';
import { api, errorMessage } from '../api';
import { Banner, Field, primaryButton } from '../components/Field';
import { clearFragmentToken, readFragmentToken } from '../fragment';

const phraseSchema = z.strictObject({ password: passwordSchema });
type PhraseInput = z.infer<typeof phraseSchema>;

export function ActivatePage() {
  return (
    <TokenPasswordPage
      purpose="invite"
      title="Attiva l'accesso"
      intro="Scegli una frase di almeno 16 caratteri. Il link funziona una sola volta."
      endpoint="/api/auth/invitations/accept"
      submitLabel="Attiva e entra"
    />
  );
}

export function ResetPasswordPage() {
  return (
    <TokenPasswordPage
      purpose="reset"
      title="Nuova password"
      intro="Scegli una nuova frase di almeno 16 caratteri. Dopo il cambio dovrai accedere di nuovo."
      endpoint="/api/auth/password-reset/confirm"
      submitLabel="Salva la password"
    />
  );
}

function TokenPasswordPage({
  purpose,
  title,
  intro,
  endpoint,
  submitLabel,
}: {
  purpose: 'invite' | 'reset';
  title: string;
  intro: string;
  endpoint: string;
  submitLabel: string;
}) {
  const [token] = useState(() => readFragmentToken(purpose));
  const [formError, setFormError] = useState<string | null>(null);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const form = useForm<PhraseInput>({
    resolver: zodResolver(phraseSchema),
    defaultValues: { password: '' },
  });

  return (
    <form
      className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-4"
      noValidate
      onSubmit={(event) => {
        void form.handleSubmit(async (values) => {
          setFormError(null);
          if (!token) {
            setFormError('Il link non contiene un codice valido.');
            return;
          }
          try {
            if (purpose === 'invite') {
              const profile = await api<Profile>(endpoint, {
                method: 'POST',
                body: { token, password: values.password },
              });
              clearFragmentToken(purpose);
              queryClient.setQueryData(['session'], profile);
              await navigate('/');
              return;
            }
            await api(endpoint, { method: 'POST', body: { token, password: values.password } });
            clearFragmentToken(purpose);
            queryClient.removeQueries({ queryKey: ['session'] });
            await navigate('/accedi', {
              state: { notice: 'Password aggiornata. Accedi con la nuova frase.' },
            });
          } catch (error) {
            setFormError(errorMessage(error));
          }
        })(event);
      }}
    >
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-1 text-sm text-muted">{intro}</p>
      </div>
      {!token ? (
        <Banner message="Il link non contiene un codice valido. Chiedine uno nuovo." />
      ) : null}
      <Banner message={formError} />
      <Field
        id={`${purpose}-password`}
        label="Nuova password"
        type="password"
        autoComplete="new-password"
        hint="Usa una frase di almeno 16 caratteri."
        error={form.formState.errors.password?.message}
        {...form.register('password')}
      />
      <button
        type="submit"
        className={primaryButton}
        disabled={form.formState.isSubmitting || !token}
      >
        {submitLabel}
      </button>
    </form>
  );
}
