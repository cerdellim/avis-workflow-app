const FORMULA = /^[=+\-@\t\r]/;

const TASK_STATUS: Record<string, string> = {
  todo: 'Da fare',
  in_progress: 'In corso',
  completed: 'Completata',
  cancelled: 'Annullata',
};

const TASK_PRIORITY: Record<string, string> = {
  low: 'Bassa',
  normal: 'Normale',
  high: 'Alta',
  urgent: 'Urgente',
};

export function csvCell(value: string): string {
  const safe = FORMULA.test(value) ? `'${value}` : value;
  if (/[",\n\r]/.test(safe)) {
    return `"${safe.replaceAll('"', '""')}"`;
  }
  return safe;
}

export function toCsv(rows: string[][]): string {
  const lines = rows.map((row) => row.map((value) => csvCell(value)).join(','));
  return `\uFEFF${lines.join('\n')}\n`;
}

export function taskStatusLabel(status: string): string {
  return TASK_STATUS[status] ?? status;
}

export function taskPriorityLabel(priority: string): string {
  return TASK_PRIORITY[priority] ?? priority;
}
