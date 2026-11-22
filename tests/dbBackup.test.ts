import { describe, expect, it } from 'vitest';

import {
  backupFileName,
  isoWeekKey,
  parseBackupDate,
  planRetention,
  scratchDatabaseName,
} from '../tools/db-backup-lib.js';

function fileAt(date: string, time = '00:00:00'): string {
  return backupFileName(new Date(`${date}T${time}Z`));
}

describe('nama berkas backup', () => {
  it('memakai waktu UTC dengan format yang bisa diurutkan', () => {
    expect(backupFileName(new Date(Date.UTC(2026, 10, 22, 3, 4, 5)))).toBe(
      'harmony-2026-11-22T03-04-05Z.sql.gz',
    );
  });

  it('menolak nama yang bukan dump Harmony', () => {
    expect(parseBackupDate('catatan.txt')).toBeNull();
    expect(parseBackupDate('harmony-2026-11-22.sql.gz')).toBeNull();
  });

  it('menolak tanggal yang tidak ada, bukan menormalkannya', () => {
    expect(parseBackupDate('harmony-2026-02-31T00-00-00Z.sql.gz')).toBeNull();
    expect(parseBackupDate('harmony-2026-13-01T00-00-00Z.sql.gz')).toBeNull();
  });
});

describe('kunci pengelompokan retensi', () => {
  it('memakai minggu ISO, termasuk pergantian tahun', () => {
    expect(isoWeekKey(new Date('2026-11-16T00:00:00Z'))).toBe('2026-W47');
    expect(isoWeekKey(new Date('2026-01-01T00:00:00Z'))).toBe('2026-W01');
  });
});

describe('retensi 7 harian, 4 mingguan, 12 bulanan', () => {
  it('memilih yang terbaru per hari, per minggu ISO, dan per bulan', () => {
    const files = [
      '2026-11-16',
      '2026-11-09',
      '2026-11-04',
      '2026-11-03',
      '2026-11-02',
      '2026-10-05',
      '2026-09-01',
    ].map((date) => fileAt(date));

    // Batas kecil supaya hasilnya bisa dihitung dengan tangan: dua hari,
    // dua minggu, dua bulan terakhir.
    const plan = planRetention(files, { daily: 2, weekly: 2, monthly: 2 });

    expect(plan.keep).toEqual([fileAt('2026-10-05'), fileAt('2026-11-09'), fileAt('2026-11-16')].sort());
    expect(plan.remove).toEqual(
      [
        fileAt('2026-09-01'),
        fileAt('2026-11-02'),
        fileAt('2026-11-03'),
        fileAt('2026-11-04'),
      ].sort(),
    );
    expect(plan.unknown).toEqual([]);
  });

  it('menyimpan dump terbaru saja kalau satu hari punya beberapa dump', () => {
    const files = [fileAt('2026-11-22', '01:00:00'), fileAt('2026-11-22', '02:00:00')];
    const plan = planRetention(files, { daily: 1, weekly: 1, monthly: 1 });

    expect(plan.keep).toEqual([fileAt('2026-11-22', '02:00:00')]);
    expect(plan.remove).toEqual([fileAt('2026-11-22', '01:00:00')]);
  });

  it('tidak pernah menghapus berkas yang namanya tidak dikenali', () => {
    const plan = planRetention(['catatan.txt', fileAt('2026-11-22')], { daily: 1, weekly: 1, monthly: 1 });

    expect(plan.unknown).toEqual(['catatan.txt']);
    expect(plan.remove).toEqual([]);
  });
});

describe('nama database uji restore', () => {
  it('menjaga panjang identifier PostgreSQL di bawah 63 byte', () => {
    const name = scratchDatabaseName('a'.repeat(80));

    expect(name.length).toBeLessThanOrEqual(63);
    expect(name.endsWith('_restore_check')).toBe(true);
  });

  it('memakai nama database asli untuk nama yang pendek', () => {
    expect(scratchDatabaseName('harmony')).toBe('harmony_restore_check');
  });
});
