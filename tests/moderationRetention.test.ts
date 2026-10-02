import { describe, expect, it } from 'vitest';
import {
  RETENTION_MONTHS,
  purgeExpiredRecords,
  retentionCutoff,
} from '../src/modules/moderation/retention.js';

/** Repository minimal: cukup dua method yang dipakai job retensi. */
class FakeRetentionRepository {
  public cases: { id: number; createdAt: Date }[] = [];
  public warnings: { id: number; createdAt: Date }[] = [];
  public calls: string[] = [];
  public failOn: 'warnings' | 'cases' | null = null;

  async deleteExpiredWarnings(cutoff: Date): Promise<number> {
    this.calls.push(`warnings<${cutoff.toISOString()}`);
    if (this.failOn === 'warnings') throw new Error('koneksi terputus');

    const before = this.warnings.length;
    this.warnings = this.warnings.filter((row) => row.createdAt >= cutoff);
    return before - this.warnings.length;
  }

  async deleteExpiredCases(cutoff: Date): Promise<number> {
    this.calls.push(`cases<${cutoff.toISOString()}`);
    if (this.failOn === 'cases') throw new Error('koneksi terputus');

    const before = this.cases.length;
    this.cases = this.cases.filter((row) => row.createdAt >= cutoff);
    return before - this.cases.length;
  }
}

const NOW = new Date(2026, 9, 2, 12, 0, 0);

function rows(monthsAgo: number, count: number, startId = 1) {
  const date = new Date(NOW);
  date.setMonth(date.getMonth() - monthsAgo);

  return Array.from({ length: count }, (_, index) => ({ id: startId + index, createdAt: date }));
}

describe('retentionCutoff', () => {
  it('memotong tepat 12 bulan ke belakang', () => {
    expect(RETENTION_MONTHS).toBe(12);
    expect(retentionCutoff(NOW)).toEqual(new Date(2025, 9, 2, 12, 0, 0));
  });

  it('tidak mengubah objek waktu yang diberikan', () => {
    const now = new Date(NOW);
    retentionCutoff(now);
    expect(now).toEqual(NOW);
  });

  it('batas tepat dihitung per bulan, bukan 365 hari tetap', () => {
    // September 2026 ke September 2025 melewati Februari tahun kabisat, jadi
    // bedanya 366 hari — padanan "365 hari" akan salah memotong baris.
    const beforeLeapDay = new Date(2026, 8, 1, 8, 0, 0);
    expect(retentionCutoff(beforeLeapDay)).toEqual(new Date(2025, 8, 1, 8, 0, 0));
  });
});

describe('purgeExpiredRecords', () => {
  it('menghapus warning lebih dulu lalu kasusnya', async () => {
    const repository = new FakeRetentionRepository();
    repository.warnings = rows(13, 3, 1);
    repository.cases = rows(13, 5, 1);

    const result = await purgeExpiredRecords(repository, NOW);

    expect(result.warnings).toBe(3);
    expect(result.cases).toBe(5);
    expect(result.cutoff).toEqual(new Date(2025, 9, 2, 12, 0, 0));
    expect(repository.warnings).toHaveLength(0);
    expect(repository.cases).toHaveLength(0);
  });

  it('menyisakan data yang belum melewati retensi', async () => {
    const repository = new FakeRetentionRepository();
    repository.cases = [...rows(13, 2, 1), ...rows(6, 4, 10)];

    const result = await purgeExpiredRecords(repository, NOW);

    expect(result.cases).toBe(2);
    expect(repository.cases).toHaveLength(4);
  });

  it('baris tepat di batas retensi tetap disimpan', async () => {
    const repository = new FakeRetentionRepository();
    const cutoff = retentionCutoff(NOW);
    repository.cases = [{ id: 1, createdAt: cutoff }];

    const result = await purgeExpiredRecords(repository, NOW);

    expect(result.cases).toBe(0);
    expect(repository.cases).toHaveLength(1);
  });

  it('tidak salah menghapus baris yang belum ada sama sekali', async () => {
    const repository = new FakeRetentionRepository();

    await expect(purgeExpiredRecords(repository, NOW)).resolves.toEqual({
      cutoff: retentionCutoff(NOW),
      warnings: 0,
      cases: 0,
    });
    expect(repository.calls).toHaveLength(2);
  });

  it('menghentikan diri saat penghapusan warning gagal', async () => {
    const repository = new FakeRetentionRepository();
    repository.cases = rows(13, 2);
    repository.failOn = 'warnings';

    await expect(purgeExpiredRecords(repository, NOW)).rejects.toThrow(/terputus/);
    // Kasus tidak boleh ikut terhapus kalau langkah pertama belum sukses.
    expect(repository.calls).toEqual([`warnings<${retentionCutoff(NOW).toISOString()}`]);
    expect(repository.cases).toHaveLength(2);
  });

  it('meneruskan batas waktu yang sama ke kedua penghapusan', async () => {
    const repository = new FakeRetentionRepository();

    await purgeExpiredRecords(repository, NOW);

    const cutoffs = repository.calls.map((call) => call.slice(call.indexOf('<')));
    expect(cutoffs).toHaveLength(2);
    expect(new Set(cutoffs).size).toBe(1);
  });
});
