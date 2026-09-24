// Server-only helpers for src/actions/backup.ts and src/app/api/cron/backup, which check access first.
// Deliberately not a 'use server' file: that would make every export a public endpoint.
import { prisma } from '@/lib/prisma';
import { deleteFromFTP, listFromFTP, uploadToFTP } from '@/lib/ftp';

/**
 * Database backups without pg_dump, which a Vercel function does not have:
 * the database writes its own rows out as SQL, and the file goes to the FTP
 * server set in Settings, next to (not inside) the receipts folder.
 */

export const BACKUP_FOLDER = '/backups';

const BACKUP_NAME = /^backup-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.sql$/;
export const isBackupName = (name: string) => BACKUP_NAME.test(name);

const ident = (name: string) => `"${name.replace(/"/g, '""')}"`;
const literal = (text: string) => `'${text.replace(/'/g, "''")}'`;

/**
 * Every row of every table, as SQL that replays them into an empty database
 * whose tables were made from the same code. Read in one REPEATABLE READ
 * transaction, so all tables are taken at the same moment and agree.
 */
export async function buildDatabaseDump(now = new Date()): Promise<string> {
  return prisma.$transaction(
    async (tx: any) => {
      const tables: Array<{ name: string }> = await tx.$queryRawUnsafe(
        `SELECT tablename AS name FROM pg_tables
         WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
         ORDER BY tablename`,
      );

      const lines = [
        '-- TheMoak ERP — full database backup (rows only)',
        `-- Taken: ${now.toISOString()}${process.env.VERCEL_GIT_COMMIT_SHA ? `   Code: ${process.env.VERCEL_GIT_COMMIT_SHA}` : ''}`,
        '--',
        '-- To restore: create an EMPTY database, make its tables from the same code',
        '-- (`npx prisma db push` at the commit above), then as a superuser run:',
        '--   psql "<database url>" -f <this file>',
        '-- Foreign-key checks are paused while the rows go in, as pg_dump --disable-triggers does.',
        '',
        "SET client_encoding = 'UTF8';",
        'SET session_replication_role = replica;',
        'BEGIN;',
        '',
      ];

      for (const { name } of tables) {
        // The database writes each table as one INSERT over its rows in JSON:
        // every column type (numbers, dates, arrays, JSON) comes back exactly.
        const [row]: Array<{ rows: number; sql: string }> = await tx.$queryRawUnsafe(
          `SELECT count(*)::int AS rows,
                  format('INSERT INTO %I SELECT * FROM json_populate_recordset(NULL::%I, %L);',
                         $1::text, $1::text, COALESCE(json_agg(t), '[]'::json)::text) AS sql
           FROM ${ident(name)} t`,
          name,
        );
        lines.push(`-- ${name}: ${row.rows} rows`);
        if (row.rows > 0) lines.push(row.sql);
      }

      // Counters (order numbers and the like) carry on after the restored rows.
      const serials: Array<{ table: string; column: string; seq: string | null }> = await tx.$queryRawUnsafe(
        `SELECT table_name AS "table", column_name AS "column",
                pg_get_serial_sequence(format('%I', table_name), column_name) AS seq
         FROM information_schema.columns
         WHERE table_schema = 'public' AND column_default LIKE 'nextval(%'`,
      );
      lines.push('');
      for (const { table, column, seq } of serials) {
        if (!seq) continue;
        lines.push(
          `SELECT setval(${literal(seq)}, COALESCE((SELECT max(${ident(column)}) FROM ${ident(table)}), 1), ` +
            `(SELECT count(*) > 0 FROM ${ident(table)}));`,
        );
      }

      lines.push('', 'COMMIT;', 'SET session_replication_role = DEFAULT;', '');
      return lines.join('\n');
    },
    { isolationLevel: 'RepeatableRead', timeout: 120_000, maxWait: 10_000 },
  );
}

export type BackupInfo = {
  filename: string;
  downloadUrl: string;
  size: number;
  sizeInMB: string;
  createdAt: string;
};

/** Take a backup, store it on the FTP server, keep only the newest `keep`. */
export async function runBackup(keep: number, now = new Date()): Promise<BackupInfo> {
  const bytes = Buffer.from(await buildDatabaseDump(now), 'utf8');
  const filename = `backup-${now.toISOString().replace(/[:.]/g, '-').slice(0, 19)}.sql`;
  await uploadToFTP(bytes, filename, BACKUP_FOLDER);

  const info: BackupInfo = {
    filename,
    downloadUrl: `/api/backups/${filename}`,
    size: bytes.length,
    sizeInMB: (bytes.length / (1024 * 1024)).toFixed(2),
    createdAt: now.toISOString(),
  };
  await prisma.systemSetting.upsert({
    where: { key: 'last_backup' },
    create: { key: 'last_backup', value: JSON.stringify(info) },
    update: { value: JSON.stringify(info) },
  });

  // Names carry the time, so the newest sort first.
  const stored = (await listFromFTP(BACKUP_FOLDER)).filter((file) => isBackupName(file.name));
  for (const old of stored.slice(Math.max(1, keep))) {
    await deleteFromFTP(`${BACKUP_FOLDER}/${old.name}`).catch((error) =>
      console.error('[Backup] could not delete an old backup:', old.name, error),
    );
  }
  return info;
}

export type BackupSchedule = {
  enabled?: boolean;
  frequency?: 'daily' | 'weekly' | 'monthly';
  dayOfWeek?: number; // 0 = Sunday … 6 = Saturday
  dayOfMonth?: number; // day of the Jalali month
  keepBackups?: number;
};

/**
 * Whether the daily check (a fixed time each day, see vercel.json) should take
 * a backup now: the schedule is on, today is its day in Tehran, and none was
 * taken yet today — a second deployment of the same code checking the same
 * database finds today's backup and skips.
 */
export function isBackupDue(schedule: BackupSchedule | undefined, last: { createdAt?: string } | undefined, now: Date): boolean {
  if (!schedule?.enabled) return false;
  const tehranDay = (date: Date) => date.toLocaleDateString('en-CA', { timeZone: 'Asia/Tehran' });
  if (last?.createdAt && tehranDay(new Date(last.createdAt)) === tehranDay(now)) return false;

  if (schedule.frequency === 'weekly') {
    const weekday = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Tehran' })).getDay();
    return weekday === (schedule.dayOfWeek ?? 0);
  }
  if (schedule.frequency === 'monthly') {
    const jalaliDay = Number(
      new Intl.DateTimeFormat('en-US-u-ca-persian-nu-latn', { timeZone: 'Asia/Tehran', day: 'numeric' }).format(now),
    );
    return jalaliDay === (schedule.dayOfMonth ?? 1);
  }
  return true; // daily
}
