import { describe, expect, it } from 'vitest';
import {
  LOG_RETENTION_DAYS,
  purgeExpiredLogs,
} from '../src/modules/logging/retention.js';
import { DEFAULT_LOG_RETENTION_DAYS } from '../src/modules/logging/types.js';

interface Row {
  id: number;
  expiresAt: Date | null;
}

function fake(rows: Row[]) {
  return {
    async deleteExpiredLogs(cutoff: Date): Promise<number> {
      const due = rows.filter((row) => row.expiresAt !== null && row.expiresAt < cutoff);

      return due.length;
    },
  };
}

const NOW = new Date('2026-10-02T12:00:00.000Z');

describe('retensi riwayat log', () => {
  it('umur simpan log 30 hari sesuai janji di privacy policy', () => {
    // Umur simpan bisa diubah; yang tidak boleh berubah adalah bahwa angka yang
    // ditulis ke user sama dengan yang dijalankan job.
    expect(LOG_RETENTION_DAYS).toBe(30);
    expect(LOG_RETENTION_DAYS).toBe(DEFAULT_LOG_RETENTION_DAYS);
  });

  it('mengembalikan jumlah baris yang dihapus beserta batasnya', async () => {
    const result = await purgeExpiredLogs(
      fake([{ id: 1, expiresAt: new Date('2026-09-01T00:00:00.000Z') }]),
      NOW,
    );

    expect(result.logs).toBe(1);
    expect(result.cutoff).toEqual(NOW);
  });

  it('baris yang belum kedaluwarsa tidak ikut terhapus', async () => {
    const result = await purgeExpiredLogs(
      fake([{ id: 1, expiresAt: new Date('2026-10-20T00:00:00.000Z') }]),
      NOW,
    );

    expect(result.logs).toBe(0);
  });

  it('baris tepat di batas waktu menunggu sapuan berikutnya', async () => {
    // Perbandingannya `lt`, bukan `lte`: entri yang jatuh tempo persis di
    // detik penyapuan dihapus di sapuan berikutnya. Bedanya satu periode
    // penyapuan (jam), jadi membatasinya eksplisit lebih jujur daripada
    // diam-diam mengandalkan detail query.
    const repository = fake([{ id: 1, expiresAt: NOW }]);

    expect((await purgeExpiredLogs(repository, NOW)).logs).toBe(0);
    expect((await purgeExpiredLogs(repository, new Date(NOW.getTime() + 1))).logs).toBe(1);
  });

  it('baris tanpa tanggal kedaluwarsa dibiarkan', async () => {
    // `expiresAt: null` berarti retensinya belum pernah ditetapkan, bukan
    // berarti sudah kedaluwarsa. Menghapusnya adalah keputusan yang tidak bisa
    // dibatalkan, jadi harus selalu bisa dilakukan secara eksplisit terpisah.
    const result = await purgeExpiredLogs(fake([{ id: 1, expiresAt: null }]), NOW);

    expect(result.logs).toBe(0);
  });

  it('tidak ada data kedaluwarsa bukan error', async () => {
    await expect(purgeExpiredLogs(fake([]), NOW)).resolves.toMatchObject({ logs: 0 });
  });
});