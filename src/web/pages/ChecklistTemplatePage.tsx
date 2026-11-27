import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import type { ChecklistTemplate, ChecklistTemplateStatus } from '../../shared/checklists';
import { api, errorMessage } from '../api';
import { Banner, Field, SelectField, secondaryButton } from '../components/Field';
import { CHECKLIST_STATUS_LABEL } from '../labels';
import { useSession } from '../session';
import { ItemEditor, blankItem } from './ChecklistsPage';

export function ChecklistTemplatePage() {
  const { id } = useParams();
  const session = useSession();
  const template = useQuery({
    queryKey: ['checklist-template', id],
    queryFn: () => api<ChecklistTemplate>(`/api/checklist-templates/${id ?? ''}`),
    enabled: Boolean(id),
  });
  const canEdit = session.data?.role === 'admin' || session.data?.role === 'coordinator';

  return (
    <section className="mx-auto flex max-w-3xl flex-col gap-6">
      <Link to="/checklist" className="min-h-11 text-sm font-medium text-brand-strong">
        Torna alle checklist
      </Link>
      {template.isPending ? <p className="text-muted">Caricamento della checklist…</p> : null}
      {template.isError ? <Banner message={errorMessage(template.error)} /> : null}
      {template.data && !canEdit ? <TemplateView template={template.data} /> : null}
      {template.data && canEdit ? <TemplateEditor template={template.data} /> : null}
    </section>
  );
}

function TemplateView({ template }: { template: ChecklistTemplate }) {
  return (
    <article className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-4">
      <h1 className="text-2xl font-semibold tracking-tight">{template.title}</h1>
      <p className="text-sm text-muted">
        {template.groupName} · {CHECKLIST_STATUS_LABEL[template.status]}
      </p>
      <p>{template.description ?? 'Nessuna descrizione.'}</p>
      <ol className="flex flex-col gap-2">
        {template.items.map((item) => (
          <li key={item.id}>
            <p className="font-medium">{item.label}</p>
            <p className="text-sm text-muted">{item.required ? 'Obbligatoria' : 'Facoltativa'}</p>
            {item.helpText ? <p className="text-sm">{item.helpText}</p> : null}
          </li>
        ))}
      </ol>
    </article>
  );
}

function TemplateEditor({ template }: { template: ChecklistTemplate }) {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState(template.title);
  const [description, setDescription] = useState(template.description ?? '');
  const [status, setStatus] = useState<ChecklistTemplateStatus>(template.status);
  const [items, setItems] = useState(
    template.items.map((item) => ({
      key: item.id,
      label: item.label,
      helpText: item.helpText ?? '',
      required: item.required,
    })),
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  return (
    <form
      className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-4"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        setPending(true);
        setError(null);
        void api(`/api/checklist-templates/${template.id}`, {
          method: 'PATCH',
          body: {
            title,
            description,
            status,
            items: items.map((item) => ({
              label: item.label,
              helpText: item.helpText,
              required: item.required,
            })),
          },
        })
          .then(async () => {
            await queryClient.invalidateQueries({ queryKey: ['checklist-template', template.id] });
            await queryClient.invalidateQueries({ queryKey: ['checklist-templates'] });
          })
          .catch((reason: unknown) => setError(errorMessage(reason)))
          .finally(() => setPending(false));
      }}
    >
      <h1 className="text-2xl font-semibold tracking-tight">Modifica checklist</h1>
      <Banner message={error} />
      <Field
        id="edit-checklist-title"
        label="Titolo"
        value={title}
        onChange={(event) => setTitle(event.target.value)}
      />
      <Field
        id="edit-checklist-description"
        label="Descrizione"
        value={description}
        onChange={(event) => setDescription(event.target.value)}
      />
      <SelectField
        id="edit-checklist-status"
        label="Stato"
        value={status}
        onChange={(event) => setStatus(event.target.value as ChecklistTemplateStatus)}
      >
        <option value="active">Attiva</option>
        <option value="inactive">Inattiva</option>
      </SelectField>
      <ItemEditor items={items.length > 0 ? items : [blankItem()]} onChange={setItems} />
      <button type="submit" className={secondaryButton} disabled={pending}>
        Salva la checklist
      </button>
    </form>
  );
}
