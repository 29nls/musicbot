// Bagian murni dari `tools/db-backup.ts`: nama berkas, retensi, dan nama
// database sementara. Dipisah supaya bisa diuji tanpa Docker atau database.
//
// Nama berkas memakai waktu UTC, bukan waktu lokal: retensi mengelompokkan
// berkas per hari/minggu/bulan, dan mesin yang zona waktunya berubah (atau
// dijalankan di dua zona waktu berbeda) tidak boleh membuat satu dump jatuh ke
// dua kelompok. Semua perbandingan di bawah memakai UTC.

const NAME_PATTERN = /^harmony-(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})Z\.sql\.gz$/;

export interface RetentionLimits {
  daily: number;
  weekly: number;
  monthly: number;
}

export interface RetentionPlan {
  /** Berkas yang dipertahankan. */
  keep: string[];
  /** Berkas yang boleh dihapus. */
  remove: string[];
  /** Berkas yang namanya tidak dikenali. Tidak pernah dihapus. */
  unknown: string[];
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

export function backupFileName(date: Date): string {
  const year = date.getUTCFullYear();
  const month = pad(date.getUTCMonth() + 1);
  const day = pad(date.getUTCDate());
  const hour = pad(date.getUTCHours());
  const minute = pad(date.getUTCMinutes());
  const second = pad(date.getUTCSeconds());
  return `harmony-${year}-${month}-${day}T${hour}-${minute}-${second}Z.sql.gz`;
}

/** `null` untuk nama yang bukan dump Harmony, termasuk tanggal yang tidak ada. */
export function parseBackupDate(name: string): Date | null {
  const match = NAME_PATTERN.exec(name);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);

  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  // Date.UTC menormalkan tanggal yang tidak ada (31 Feb jadi 3 Mar), jadi
  // komponen hasilnya harus dibandingkan balik.
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day ||
    date.getUTCHours() !== hour ||
    date.getUTCMinutes() !== minute ||
    date.getUTCSeconds() !== second
  ) {
    return null;
  }
  return date;
}

export function dayKey(date: Date): string {
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

export function monthKey(date: Date): string {
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}`;
}

/** Kunci ISO-8601, mis. `2026-W47`. */
export function isoWeekKey(date: Date): string {
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const weekday = target.getUTCDay() || 7;
  target.setUTCDate(target.getUTCDate() + 4 - weekday);

  const yearStart = Date.UTC(target.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((target.getTime() - yearStart) / 86_400_000 + 1) / 7);
  return `${target.getUTCFullYear()}-W${pad(week)}`;
}

/**
 * Rencana retensi: simpan dump terbaru dari 7 hari terakhir, 4 minggu
 * terakhir, dan 12 bulan terakhir. Berkas yang lebih tua dari ketiganya
 * dihapus. Berkas dengan nama tak dikenal dibiarkan, karena menghapus berkas
 * yang tidak dipahami lebih berbahaya daripada menyisakan satu berkas.
 */
export function planRetention(
  files: string[],
  limits: Partial<RetentionLimits> = {},
): RetentionPlan {
  const daily = limits.daily ?? 7;
  const weekly = limits.weekly ?? 4;
  const monthly = limits.monthly ?? 12;

  const entries: Array<{ name: string; date: Date }> = [];
  const unknown: string[] = [];

  for (const file of files) {
    const date = parseBackupDate(file);
    if (date === null) unknown.push(file);
    else entries.push({ name: file, date });
  }

  const newestPer = (bucketOf: (date: Date) => string, count: number): string[] => {
    const buckets = new Map<string, { name: string; date: Date }>();
    for (const entry of entries) {
      const key = bucketOf(entry.date);
      const current = buckets.get(key);
      if (current === undefined || entry.date.getTime() > current.date.getTime()) {
        buckets.set(key, entry);
      }
    }
    return [...buckets.values()]
      .sort((a, b) => b.date.getTime() - a.date.getTime())
      .slice(0, count)
      .map((entry) => entry.name);
  };

  const keep = new Set([
    ...newestPer(dayKey, daily),
    ...newestPer(isoWeekKey, weekly),
    ...newestPer(monthKey, monthly),
  ]);

  return {
    keep: [...keep].sort(),
    remove: entries
      .filter((entry) => !keep.has(entry.name))
      .map((entry) => entry.name)
      .sort(),
    unknown: unknown.sort(),
  };
}

/**
 * Nama database untuk uji restore. PostgreSQL membatasi identifier 63 byte,
 * jadi nama database yang panjang dipotong dulu sebelum ditambah akhiran.
 */
export function scratchDatabaseName(database: string): string {
  const suffix = '_restore_check';
  return database.slice(0, 63 - suffix.length) + suffix;
}
