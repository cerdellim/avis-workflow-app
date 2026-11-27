import { BACKUP_TABLES, type BackupCell, type BackupDocument } from '../shared/backup-format';

export async function buildBackup(db: D1Database, exportedAt: string): Promise<BackupDocument> {
  const tables: BackupDocument['tables'] = {};
  for (const table of BACKUP_TABLES) {
    const result = await db
      .prepare(`SELECT ${table.columns.join(', ')} FROM ${table.name}`)
      .all<Record<string, BackupCell>>();
    tables[table.name] = result.results.map((row) => {
      const record: Record<string, BackupCell> = {};
      for (const column of table.columns) {
        record[column] = cell(row[column]);
      }
      return record;
    });
  }
  return { version: 1, exportedAt, tables };
}

function cell(value: BackupCell | undefined): BackupCell {
  if (typeof value === 'string' || typeof value === 'number' || value === null) {
    return value;
  }
  throw new Error('Copia non valida.');
}
