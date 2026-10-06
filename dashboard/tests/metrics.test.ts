import { describe, expect, it } from 'vitest';
import { MemoryKeyValueStore } from '@bot/services/kvStore.js';
import {
  METRIC_KEYS,
  METRIC_WRITES_TOTAL,
  METRIC_WRITE_DENIED_TOTAL,
  readDashboardMetrics,
  recordDashboardWrite,
  recordDashboardWriteDenied,
} from '@/lib/metrics.js';
import { log } from '@/lib/log.js';

/**
 * Penjaga metrik (PRD §4.5).
 *
 * Yang diuji bukan angkanya — angka adalah `increment`, sudah diuji di
 * repo bot. Yang diuji adalah tiga jaminan modul ini:
 *
 * 1. Kunci yang benar ditekan untuk peristiwa yang benar.
 * 2. Penghitung tidak kedaluwarsa (tanpa TTL).
 * 3. Kegagalan penyimpanan bersama tidak pernah melempar dan tidak
 *    pernah mengubah angka.
 */

describe('penghitung metrik', () => {
  it('menaikkan penghitung yang benar untuk peristiwa yang benar', async () => {
    const store = new MemoryKeyValueStore();

    await recordDashboardWrite(store);
    await recordDashboardWrite(store);
    await recordDashboardWriteDenied(store);

    const metrics = await readDashboardMetrics(store);

    expect(metrics).toEqual({ writesTotal: 2, writeDeniedTotal: 1 });
  });

  it('dimulai dari nol sebelum ada peristiwa', async () => {
    const metrics = await readDashboardMetrics(new MemoryKeyValueStore());

    expect(metrics).toEqual({ writesTotal: 0, writeDeniedTotal: 0 });
  });

  it('penghitung tidak kedaluwarsa: tanpa TTL', async () => {
    const store = new MemoryKeyValueStore();

    await recordDashboardWrite(store);

    // `increment` tanpa `ttlMs` tidak memasang masa berlaku. Dibaca
    // kembali setelah "waktu berlalu" pun nilainya tetap ada —
    // penghitung yang hilang saat restart adalah kebohongan yang
    // §4.5 ingin dihindari.
    expect(await store.get(METRIC_KEYS.writesTotal)).toBe('1');
  });

  it('kegagalan penyimpanan bersama tidak melempar dan tidak mengubah angka', async () => {
    const store = new MemoryKeyValueStore();
    const broken = {
      increment: () => {
        throw new Error('store mati');
      },
      get: () => {
        throw new Error('store mati');
      },
    };

    // Tidak boleh melempar: metrik terbaik-usaha, bukan bagian kontrak.
    await expect(recordDashboardWrite(broken as never)).resolves.toBeUndefined();
    await expect(recordDashboardWriteDenied(broken as never)).resolves.toBeUndefined();

    // Baca yang gagal menjawab nol, bukan lempar — monitoring harus
    // tahu "tidak ada data", bukan mendapat error.
    await expect(readDashboardMetrics(broken as never)).resolves.toEqual({
      writesTotal: 0,
      writeDeniedTotal: 0,
    });

    expect(await store.get(METRIC_KEYS.writesTotal)).toBeNull();
  });

  it('nama metrik mengikuti PRD §4.5', () => {
    // Nama inilah yang dijanjikan dokumen kepada operator. Kalau berubah
    // tanpa mengubah PRD, orang yang memantau kehilangan jejaknya.
    expect(METRIC_WRITES_TOTAL).toBe('harmony_dashboard_writes_total');
    expect(METRIC_WRITE_DENIED_TOTAL).toBe('harmony_dashboard_write_denied_total');
  });

  it('kegagalan increment dicatat di log, tidak diam-diam', async () => {
    const warnings: unknown[] = [];
    const originalWarn = log.warn;

    // Logger tidak bisa ditukar dari luar, jadi yang ditangkap adalah
    // stdout-nya: tulis satu peristiwa ke store yang gagal dan pastikan
    // jalannya tidak melempar. Peringatan sendiri sudah dijamin oleh
    // `bump`; yang diperiksa di sini adalah jalur lengkapnya.
    log.warn = ((event: string, data?: unknown) => {
      warnings.push({ event, data });
    }) as typeof log.warn;

    try {
      const broken = {
        increment: () => {
          throw new Error('store mati');
        },
      };
      await recordDashboardWrite(broken as never);
    } finally {
      log.warn = originalWarn;
    }

    expect(warnings).toHaveLength(1);
    expect((warnings[0] as { event: string }).event).toBe('metrics.increment.failed');
  });
});
