import { z } from 'zod';
import { passwordProblem } from './password-policy';

const requiredText = (label: string, max: number) =>
  z
    .string({ error: `${label} è obbligatorio.` })
    .trim()
    .min(1, { error: `${label} è obbligatorio.` })
    .max(max, { error: `${label} può avere al massimo ${max} caratteri.` });

export const emailSchema = z
  .string({ error: 'Indirizzo email non valido.' })
  .trim()
  .toLowerCase()
  .pipe(z.email({ error: 'Indirizzo email non valido.' }));

export const passwordSchema = z
  .string({ error: 'Usa una frase di almeno 16 caratteri.' })
  .superRefine((value, ctx) => {
    const problem = passwordProblem(value);
    if (problem) {
      ctx.addIssue({ code: 'custom', message: problem });
    }
  });

const loginPasswordSchema = z
  .string({ error: 'Inserisci la password.' })
  .min(1, { error: 'Inserisci la password.' })
  .max(128, { error: 'La password può avere al massimo 128 caratteri.' });

const roleSchema = z.enum(['admin', 'coordinator', 'volunteer'], { error: 'Ruolo non valido.' });
const groupStatusSchema = z.enum(['active', 'archived'], { error: 'Stato non valido.' });
const uuidSchema = z.uuid({ error: 'Identificativo non valido.' });

const idListSchema = z
  .array(uuidSchema)
  .max(50, { error: 'Troppi elementi.' })
  .superRefine((ids, ctx) => {
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({ code: 'custom', message: 'Elenco con duplicati.' });
    }
  });

const tokenSchema = z
  .string({ error: 'Il link non è valido oppure è scaduto.' })
  .min(20, { error: 'Il link non è valido oppure è scaduto.' })
  .max(200, { error: 'Il link non è valido oppure è scaduto.' });

export const setupSchema = z.strictObject({
  bootstrapToken: z
    .string({ error: 'Inserisci il codice di avvio.' })
    .min(1, { error: 'Inserisci il codice di avvio.' })
    .max(200, { error: 'Codice di avvio non valido.' }),
  fullName: requiredText('Il nome', 120),
  email: emailSchema,
  password: passwordSchema,
});

export const loginSchema = z.strictObject({
  email: emailSchema,
  password: loginPasswordSchema,
});

export const acceptSchema = z.strictObject({
  token: tokenSchema,
  password: passwordSchema,
});

export const patchMeSchema = z.strictObject({
  fullName: requiredText('Il nome', 120),
});

export const changePasswordSchema = z.strictObject({
  currentPassword: loginPasswordSchema,
  newPassword: passwordSchema,
});

export const createUserSchema = z.strictObject({
  fullName: requiredText('Il nome', 120),
  email: emailSchema,
  role: roleSchema,
  groupIds: idListSchema,
});

export const patchUserSchema = z.strictObject({
  fullName: requiredText('Il nome', 120),
  email: emailSchema,
  role: roleSchema,
});

export const groupSchema = z.strictObject({
  name: requiredText('Il nome', 80),
  description: z
    .string({ error: 'Descrizione non valida.' })
    .trim()
    .max(2000, { error: 'La descrizione può avere al massimo 2000 caratteri.' }),
});

export const patchGroupSchema = groupSchema
  .extend({
    status: groupStatusSchema,
  })
  .strict();

export const membersSchema = z.strictObject({
  userIds: idListSchema,
});

const taskPrioritySchema = z.enum(['low', 'normal', 'high', 'urgent'], {
  error: 'Priorità non valida.',
});
const taskStatusSchema = z.enum(['todo', 'in_progress', 'completed', 'cancelled'], {
  error: 'Stato non valido.',
});
const assigneeIdsSchema = z
  .array(uuidSchema)
  .max(15, { error: 'Troppi assegnatari.' })
  .superRefine((ids, ctx) => {
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({ code: 'custom', message: 'Elenco con duplicati.' });
    }
  });
const isoDateTimeSchema = z.string({ error: 'Data non valida.' }).refine(isRealDateTime, {
  error: 'Data non valida.',
});
const dueAtSchema = z.union([isoDateTimeSchema, z.null()]);
const pageSchema = z
  .string()
  .regex(/^[1-9]\d{0,4}$/, { error: 'Pagina non valida.' })
  .transform((value) => Number(value))
  .optional();
const pageSizeSchema = z
  .string()
  .regex(/^\d{1,2}$/, { error: 'Dimensione di pagina non valida.' })
  .transform((value) => Number(value))
  .refine((value) => value >= 1 && value <= 50, { error: 'Dimensione di pagina non valida.' })
  .optional();

const checklistTemplateIdsSchema = z
  .array(uuidSchema)
  .max(5, { error: 'Troppe checklist.' })
  .superRefine((ids, ctx) => {
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({ code: 'custom', message: 'Elenco con duplicati.' });
    }
  });
const checklistItemSchema = z.strictObject({
  label: requiredText('La voce', 200),
  helpText: z
    .string({ error: 'Testo di aiuto non valido.' })
    .trim()
    .max(500, { error: 'Il testo di aiuto può avere al massimo 500 caratteri.' }),
  required: z.boolean({ error: 'Indica se la voce è obbligatoria.' }),
});
const checklistItemsSchema = z
  .array(checklistItemSchema)
  .min(1, { error: 'Aggiungi almeno una voce.' })
  .max(40, { error: 'Troppe voci.' });
const descriptionSchema = z
  .string({ error: 'Descrizione non valida.' })
  .trim()
  .max(2000, { error: 'La descrizione può avere al massimo 2000 caratteri.' });

const taskFields = {
  title: requiredText('Il titolo', 160),
  description: descriptionSchema,
  assigneeIds: assigneeIdsSchema,
  checklistTemplateIds: checklistTemplateIdsSchema.optional(),
  priority: taskPrioritySchema,
  dueAt: dueAtSchema,
};

export const createTaskSchema = z.strictObject({
  ...taskFields,
  groupId: uuidSchema,
});

export const patchTaskSchema = z.strictObject(taskFields);

export const taskListQuerySchema = z.strictObject({
  status: taskStatusSchema.optional(),
  groupId: uuidSchema.optional(),
  assigneeId: uuidSchema.optional(),
  priority: taskPrioritySchema.optional(),
  dueFrom: isoDateTimeSchema.optional(),
  dueTo: isoDateTimeSchema.optional(),
  q: z.string().trim().max(160, { error: 'Ricerca troppo lunga.' }).optional(),
  sort: z
    .enum(['dueAt', 'priority', 'createdAt', 'title', 'status'], {
      error: 'Ordinamento non valido.',
    })
    .optional(),
  direction: z.enum(['asc', 'desc'], { error: 'Direzione non valida.' }).optional(),
  page: pageSchema,
  pageSize: pageSizeSchema,
});

export type SetupInput = z.infer<typeof setupSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type AcceptInput = z.infer<typeof acceptSchema>;
export type PatchMeInput = z.infer<typeof patchMeSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type CreateUserInput = z.infer<typeof createUserSchema>;
export type PatchUserInput = z.infer<typeof patchUserSchema>;
export type GroupInput = z.infer<typeof groupSchema>;
export type PatchGroupInput = z.infer<typeof patchGroupSchema>;
export type MembersInput = z.infer<typeof membersSchema>;
export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type PatchTaskInput = z.infer<typeof patchTaskSchema>;
export type TaskListQuery = z.infer<typeof taskListQuerySchema>;

const checklistStatusSchema = z.enum(['active', 'inactive'], { error: 'Stato non valido.' });

export const createChecklistSchema = z.strictObject({
  title: requiredText('Il titolo', 160),
  description: descriptionSchema,
  groupId: uuidSchema,
  items: checklistItemsSchema,
});

export const patchChecklistSchema = z.strictObject({
  title: requiredText('Il titolo', 160),
  description: descriptionSchema,
  status: checklistStatusSchema,
  items: checklistItemsSchema,
});

export const checklistListQuerySchema = z.strictObject({
  groupId: uuidSchema.optional(),
  status: checklistStatusSchema.optional(),
});

export const startChecklistRunSchema = z.strictObject({
  taskId: uuidSchema.nullable().optional(),
});

export const patchChecklistItemSchema = z.strictObject({
  result: z.enum(['pending', 'compliant', 'non_compliant', 'not_applicable'], {
    error: 'Risultato non valido.',
  }),
  note: z
    .string({ error: 'Nota non valida.' })
    .trim()
    .max(500, { error: 'La nota può avere al massimo 500 caratteri.' }),
});

export type CreateChecklistInput = z.infer<typeof createChecklistSchema>;
export type PatchChecklistInput = z.infer<typeof patchChecklistSchema>;
export type ChecklistListQuery = z.infer<typeof checklistListQuerySchema>;
export type StartChecklistRunInput = z.infer<typeof startChecklistRunSchema>;
export type PatchChecklistItemInput = z.infer<typeof patchChecklistItemSchema>;

const frequencySchema = z.enum(['daily', 'weekly', 'monthly', 'yearly'], {
  error: 'Frequenza non valida.',
});
const localDateSchema = z
  .string({ error: 'Data non valida.' })
  .regex(/^\d{4}-\d{2}-\d{2}$/, { error: 'Data non valida.' })
  .refine((value) => realCalendarDate(value), { error: 'Data non valida.' });
const localTimeSchema = z
  .string({ error: 'Ora non valida.' })
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, { error: 'Ora non valida.' });
const weekdaysSchema = z
  .array(
    z
      .number({ error: 'Giorno della settimana non valido.' })
      .int({ error: 'Giorno della settimana non valido.' })
      .min(1, { error: 'Giorno della settimana non valido.' })
      .max(7, { error: 'Giorno della settimana non valido.' }),
  )
  .max(7, { error: 'Troppi giorni.' })
  .superRefine((days, ctx) => {
    if (new Set(days).size !== days.length) {
      ctx.addIssue({ code: 'custom', message: 'Elenco con duplicati.' });
    }
  });

const recurrenceFields = {
  title: requiredText('Il titolo', 160),
  description: descriptionSchema,
  assigneeIds: assigneeIdsSchema,
  priority: taskPrioritySchema,
  frequency: frequencySchema,
  intervalCount: z
    .number({ error: "L'intervallo non è valido." })
    .int({ error: "L'intervallo non è valido." })
    .min(1, { error: "L'intervallo minimo è 1." })
    .max(365, { error: "L'intervallo massimo è 365." }),
  weekdays: weekdaysSchema.optional(),
  dayOfMonth: z
    .number({ error: 'Giorno del mese non valido.' })
    .int({ error: 'Giorno del mese non valido.' })
    .min(1, { error: 'Giorno del mese non valido.' })
    .max(31, { error: 'Giorno del mese non valido.' })
    .optional(),
  monthOfYear: z
    .number({ error: 'Mese non valido.' })
    .int({ error: 'Mese non valido.' })
    .min(1, { error: 'Mese non valido.' })
    .max(12, { error: 'Mese non valido.' })
    .optional(),
  localTime: localTimeSchema,
  startsOn: localDateSchema,
  endsOn: localDateSchema.optional(),
};

function recurrenceShape(
  value: {
    frequency: string;
    weekdays?: number[] | undefined;
    dayOfMonth?: number | undefined;
    monthOfYear?: number | undefined;
    startsOn: string;
    endsOn?: string | undefined;
  },
  ctx: z.RefinementCtx,
): void {
  if (value.endsOn && value.endsOn < value.startsOn) {
    ctx.addIssue({
      code: 'custom',
      path: ['endsOn'],
      message: 'La data di fine precede l’inizio.',
    });
  }
  if (value.frequency === 'weekly') {
    if (!value.weekdays || value.weekdays.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['weekdays'],
        message: 'Scegli almeno un giorno della settimana.',
      });
    }
  } else if (value.weekdays) {
    ctx.addIssue({ code: 'custom', path: ['weekdays'], message: 'Campo non previsto.' });
  }
  if (value.frequency === 'monthly' || value.frequency === 'yearly') {
    if (!value.dayOfMonth) {
      ctx.addIssue({
        code: 'custom',
        path: ['dayOfMonth'],
        message: 'Indica il giorno del mese.',
      });
    }
  } else if (value.dayOfMonth) {
    ctx.addIssue({ code: 'custom', path: ['dayOfMonth'], message: 'Campo non previsto.' });
  }
  if (value.frequency === 'yearly') {
    if (!value.monthOfYear) {
      ctx.addIssue({ code: 'custom', path: ['monthOfYear'], message: 'Indica il mese.' });
    }
  } else if (value.monthOfYear) {
    ctx.addIssue({ code: 'custom', path: ['monthOfYear'], message: 'Campo non previsto.' });
  }
}

export const createRecurrenceSchema = z
  .strictObject({ ...recurrenceFields, groupId: uuidSchema })
  .superRefine(recurrenceShape);

export const patchRecurrenceSchema = z.strictObject(recurrenceFields).superRefine(recurrenceShape);

export const suspendRecurrenceSchema = z.strictObject({
  cancelFutureOpen: z.boolean({ error: 'Valore non valido.' }).optional(),
});

export const calendarQuerySchema = z
  .strictObject({
    from: localDateSchema,
    to: localDateSchema,
    groupId: uuidSchema.optional(),
  })
  .superRefine((value, ctx) => {
    const span = calendarSpan(value.from, value.to);
    if (span < 0) {
      ctx.addIssue({ code: 'custom', path: ['to'], message: 'L’intervallo non è valido.' });
    } else if (span > 62) {
      ctx.addIssue({
        code: 'custom',
        path: ['to'],
        message: 'L’intervallo massimo è 62 giorni.',
      });
    }
  });

const pushKeySchema = z
  .string({ error: 'Chiave non valida.' })
  .trim()
  .min(1, { error: 'Chiave non valida.' })
  .max(200, { error: 'Chiave non valida.' });

export const pushSubscriptionSchema = z
  .strictObject({
    endpoint: z
      .string({ error: 'Endpoint non valido.' })
      .trim()
      .min(1, { error: 'Endpoint non valido.' })
      .max(2000, { error: 'Endpoint non valido.' }),
    keys: z.strictObject({
      p256dh: pushKeySchema,
      auth: pushKeySchema,
    }),
  })
  .superRefine((value, ctx) => {
    let protocol: string;
    try {
      protocol = new URL(value.endpoint).protocol;
    } catch {
      protocol = '';
    }
    if (protocol !== 'https:') {
      ctx.addIssue({ code: 'custom', path: ['endpoint'], message: 'Endpoint non valido.' });
    }
  });

export type PushSubscriptionInput = z.infer<typeof pushSubscriptionSchema>;

export const patchSettingsSchema = z
  .strictObject({
    associationName: requiredText("Il nome dell'associazione", 80).optional(),
    dueSoonHours: z
      .number({ error: 'Le ore devono essere un numero intero.' })
      .int({ error: 'Le ore devono essere un numero intero.' })
      .min(1, { error: "Indica almeno un'ora." })
      .max(168, { error: 'Puoi indicare al massimo 168 ore.' })
      .optional(),
  })
  .superRefine((value, ctx) => {
    if (value.associationName === undefined && value.dueSoonHours === undefined) {
      ctx.addIssue({ code: 'custom', message: 'Nessuna modifica.' });
    }
  });

export const auditQuerySchema = z.strictObject({
  action: z
    .string()
    .trim()
    .min(1, { error: 'Filtro non valido.' })
    .max(80, { error: 'Filtro troppo lungo.' })
    .optional(),
  entityType: z
    .string()
    .trim()
    .min(1, { error: 'Filtro non valido.' })
    .max(40, { error: 'Filtro troppo lungo.' })
    .optional(),
  entityId: uuidSchema.optional(),
  from: isoDateTimeSchema.optional(),
  to: isoDateTimeSchema.optional(),
});

export type PatchSettingsInput = z.infer<typeof patchSettingsSchema>;
export type AuditQuery = z.infer<typeof auditQuerySchema>;
export type CreateRecurrenceInput = z.infer<typeof createRecurrenceSchema>;
export type PatchRecurrenceInput = z.infer<typeof patchRecurrenceSchema>;
export type SuspendRecurrenceInput = z.infer<typeof suspendRecurrenceSchema>;
export type CalendarQuery = z.infer<typeof calendarQuerySchema>;

function isRealDateTime(value: string): boolean {
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.exec(
      value,
    );
  if (!match) {
    return false;
  }
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6] ?? '0');
  if (hour > 23 || minute > 59 || second > 59) {
    return false;
  }
  return realCalendarDate(`${match[1]}-${match[2]}-${match[3]}`);
}

function realCalendarDate(value: string): boolean {
  const [year, month, day] = value.split('-').map((part) => Number(part));
  if (!year || !month || !day) {
    return false;
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

function calendarSpan(from: string, to: string): number {
  const [fromYear, fromMonth, fromDay] = from.split('-').map((part) => Number(part));
  const [toYear, toMonth, toDay] = to.split('-').map((part) => Number(part));
  const start = Date.UTC(fromYear ?? 0, (fromMonth ?? 1) - 1, fromDay ?? 1);
  const end = Date.UTC(toYear ?? 0, (toMonth ?? 1) - 1, toDay ?? 1);
  return Math.round((end - start) / 86_400_000);
}
