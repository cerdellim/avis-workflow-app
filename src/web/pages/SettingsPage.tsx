import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import type { SettingsRecord } from '../../shared/admin';
import { patchSettingsSchema, type PatchSettingsInput } from '../../shared/schemas';
import { api, errorMessage } from '../api';
import { Banner, Field, Note, primaryButton, secondaryButton } from '../components/Field';

export function SettingsPage() {
  const queryClient = useQueryClient();
  const settings = useQuery({
    queryKey: ['settings'],
    queryFn: () => api<SettingsRecord>('/api/settings'),
  });
  const [message, setMessage] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<PatchSettingsInput>({
    resolver: zodResolver(patchSettingsSchema),
    defaultValues: { associationName: '', dueSoonHours: 24 },
  });

  useEffect(() => {
    if (!settings.data) {
      return;
    }
    form.reset({
      associationName: settings.data.associationName,
      dueSoonHours: settings.data.dueSoonHours,
    });
  }, [form, settings.data]);

  return (
    <section className="mx-auto flex max-w-3xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Impostazioni</h1>
        <p className="mt-1 text-sm text-muted">
          Il nome compare in testata. Le ore anticipano l'avviso di scadenza.
        </p>
      </div>
      {settings.isPending ? <p className="text-muted">Caricamento delle impostazioni…</p> : null}
      {settings.isError ? <Banner message={errorMessage(settings.error)} /> : null}
      {settings.data ? (
        <form
          className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-4"
          noValidate
          onSubmit={(event) => {
            void form.handleSubmit(async (values) => {
              setFormError(null);
              setMessage(null);
              try {
                const updated = await api<SettingsRecord>('/api/settings', {
                  method: 'PATCH',
                  body: values,
                });
                queryClient.setQueryData(['settings'], updated);
                await queryClient.invalidateQueries({ queryKey: ['session'] });
                setMessage('Impostazioni aggiornate.');
              } catch (error) {
                setFormError(errorMessage(error));
              }
            })(event);
          }}
        >
          <Banner message={formError} />
          <Note message={message} />
          <Field
            id="settings-name"
            label="Nome dell'associazione"
            autoComplete="organization"
            error={form.formState.errors.associationName?.message}
            {...form.register('associationName')}
          />
          <Field
            id="settings-hours"
            label="Ore di preavviso"
            type="number"
            min={1}
            max={168}
            error={form.formState.errors.dueSoonHours?.message}
            {...form.register('dueSoonHours', { valueAsNumber: true })}
          />
          <button type="submit" className={primaryButton} disabled={form.formState.isSubmitting}>
            Salva le impostazioni
          </button>
        </form>
      ) : null}
      <section className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-4">
        <h2 className="text-lg font-semibold">Copie</h2>
        <p className="text-sm text-muted">
          Il CSV delle attività è disponibile anche ai coordinatori, limitato ai propri gruppi. La
          copia JSON contiene gli hash delle password e gli endpoint push: va tenuta fuori dal
          repository. Il ripristino non è un pulsante: si esegue in locale con la procedura del
          README.
        </p>
        <div className="flex flex-col items-start gap-3">
          <a className={secondaryButton} href="/api/exports/tasks.csv">
            Scarica le attività (CSV)
          </a>
          <a className={secondaryButton} href="/api/exports/backup">
            Scarica la copia JSON
          </a>
        </div>
      </section>
    </section>
  );
}
