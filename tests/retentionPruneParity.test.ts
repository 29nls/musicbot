import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { LogRetentionResult } from '../src/modules/logging/retention.js';
import type { RetentionResult } from '../src/modules/moderation/retention.js';
import type { StatRetentionResult } from '../src/modules/stats/retention.js';
import type { TicketRetentionResult } from '../src/modules/tickets/retention.js';
import { formatPruneReport, runPrune, toReport } from '../src/services/pruneRetention.js';

/**
 * Kunci keempat sapuan retensi di kedua jalur.
 *
 * Dua jalur retensi ada di produk ini dan keduanya bisa jadi satu-satunya
 * tergantung konfigurasi: job di dalam proses bot (`RETENTION_SWEEP_HOURS`)
 * dan skrip cron (`npm run db:prune`). PRD §12 menyebut yang kedua sebagai
 * cara resmi mematikan yang pertama.
 *
 * Versi lama skrip cron hanya menyapu kasus, peringatan, dan log. Tiket
 * beserta transkripnya (retensi 12 bulan) dan statistik playback (90 hari)
 * tidak pernah disentuh, dan laporan JSON-nya tidak punya kunci untuk
 * keduanya — jadi tidak ada yang gagal, tidak ada error, tidak ada angka
 * yang terlihat hilang. Persis kelas kegagalan yang paling mahal: yang
 * tidak terlihat.
 *
 * Tes di sini menutup dua sisi:
 * - perilaku: `runPrune` benar-benar menjalankan keempat sapuan dan
 *   laporannya memuat keempat angka;
 * - struktur: skrip cron dan job dalam proses sama-sama mendelegasikan ke
 *   satu fungsi, jadi tidak ada lagi tempat kedua yang bisa menyusun
 *   daftarnya sendiri.
 */

const NOW = new Date(2026, 9, 2, 12, 0, 0);

/** Baca berkas sumber repo untuk penjaga struktural. */
function source(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');
}

function harness() {
  const calls: string[] = [];
  const moderation = {
    purgeExpired: async () => {
      calls.push('moderation');
      return { cutoff: new Date(2025, 9, 2), warnings: 4, cases: 7 } satisfies RetentionResult;
    },
  };
  const tickets = {
    purgeExpired: async () => {
      calls.push('tickets');
      return { cutoff: new Date(2025, 9, 2), ticketsDeleted: 3 } satisfies TicketRetentionResult;
    },
  };
  const stats = {
    purgeExpired: async () => {
      calls.push('stats');
      return { cutoff: new Date(2026, 8, 3), deleted: 12 } satisfies StatRetentionResult;
    },
  };
  const logs = {
    purgeExpired: async () => {
      calls.push('logs');
      return { cutoff: new Date(2026, 9, 2), logs: 5 } satisfies LogRetentionResult;
    },
  };
  return { calls, deps: { moderation, tickets, stats, logs } };
}

describe('runPrune — jalur cron', () => {
  it('menjalankan keempat sapuan', async () => {
    const { calls, deps } = harness();

    await runPrune(deps, NOW);

    expect(calls).toEqual(['moderation', 'tickets', 'stats', 'logs']);
  });

  it('melaporkan keempat angka, termasuk tiket dan statistik', async () => {
    const { deps } = harness();

    const report = await runPrune(deps, NOW);

    expect(report).toEqual({
      cutoff: new Date(2025, 9, 2).toISOString(),
      casesDeleted: 7,
      warningsDeleted: 4,
      ticketsDeleted: 3,
      statsDeleted: 12,
      logsDeleted: 5,
    });
  });

  it('menulis null untuk sapuan yang gagal, bukan nol', async () => {
    // `0` berarti tidak ada yang kedaluwarsa. `null` berarti tidak pernah bisa
    // dicek. Melaporkan nol untuk yang gagal membuatnya terlihat seperti
    // retensi yang berhasil.
    const { deps } = harness();
    deps.tickets.purgeExpired = async () => {
      throw new Error('tabel ticket belum ada');
    };
    deps.stats.purgeExpired = async () => {
      throw new Error('tabel playback_stat belum ada');
    };

    const report = await runPrune(deps, NOW);

    expect(report.ticketsDeleted).toBeNull();
    expect(report.statsDeleted).toBeNull();
    expect(report.casesDeleted).toBe(7);
  });

  it('format laporan memuat keempat kunci', () => {
    const line = formatPruneReport({
      cutoff: NOW.toISOString(),
      casesDeleted: 1,
      warningsDeleted: 2,
      ticketsDeleted: 3,
      statsDeleted: 4,
      logsDeleted: 5,
    });

    const parsed = JSON.parse(line) as Record<string, unknown>;
    expect(Object.keys(parsed).sort()).toEqual([
      'casesDeleted',
      'cutoff',
      'logsDeleted',
      'statsDeleted',
      'ticketsDeleted',
      'warningsDeleted',
    ]);
    expect(line.endsWith('\n')).toBe(true);
  });

  it('toReport tidak mengubah angka nol menjadi null', () => {
    const report = toReport({
      moderation: { cutoff: NOW, cases: 0, warnings: 0 },
      tickets: { cutoff: NOW, ticketsDeleted: 0 },
      stats: { cutoff: NOW, deleted: 0 },
      logs: { cutoff: NOW, logs: 0 },
    });

    expect(report.ticketsDeleted).toBe(0);
    expect(report.statsDeleted).toBe(0);
    expect(report.logsDeleted).toBe(0);
  });
});

describe('kedua jalur retensi memakai satu definisi', () => {
  it('job dalam proses mendelegasikan ke runRetentionSweeps', () => {
    const job = source('../src/services/retentionJob.ts');

    expect(job).toContain('runRetentionSweeps');
    // Gigi penjaga ini: kalau job punya daftar purgeExpired sendiri,
    // keempat sapuan bisa keluar dari satu jalur tanpa ketahuan.
    expect(job).not.toMatch(/await\s+\w+\.purgeExpired\(/);
  });

  it('skrip cron mendelegasikan ke runPrune dan tidak menyapu sendiri', () => {
    const script = source('../src/prune-retention.ts');

    expect(script).toContain('runPrune');
    expect(script).toContain('getTicketService');
    expect(script).toContain('getStatsService');
    expect(script).toContain('getModerationService');
    expect(script).toContain('getLoggingService');
    // Gigi penjaga ini: begitu ada sapuan yang ditulis langsung di skrip,
    // kedua jalur bisa berbeda lagi — persis kesalahan yang lama.
    expect(script).not.toMatch(/\.purgeExpired\(/);
  });

  it('keempat sapuan wajib ada, tidak ada yang boleh dilewati diam-diam', () => {
    // Pencarian sengaja dibatasi ke dalam blok `RetentionSweepDeps`. Kalau
    // tidak, baris `stats: StatRetentionResult | null;` di interface ringkasan
    // ikut cocok dan penjaganya Examining nama yang salah, jadi penjaga ini
    // terlihat hijau padahal `stats` sudah jadi opsional lagi.
    const sweeps = source('../src/services/retentionSweeps.ts');
    const depsBlock = sweeps.slice(
      sweeps.indexOf('export interface RetentionSweepDeps {'),
      sweeps.indexOf('export interface RetentionSweepSummary {'),
    );
    expect(depsBlock.length).toBeGreaterThan(0);

    const required = ['moderation', 'tickets', 'stats', 'logs'];
    for (const field of required) {
      const line = depsBlock
        .split('\n')
        .find((l) => l.trim().startsWith(`${field}:`));
      expect(line, `bidang ${field} tidak ada di RetentionSweepDeps`).toBeDefined();
      expect(line, `bidang ${field} boleh dilewati diam-diam`).not.toContain('?');
    }
  });

  it('kedua jalur menyebut keempat sapuan', () => {
    const sweeps = source('../src/services/retentionSweeps.ts');
    const script = source('../src/prune-retention.ts');

    // Yang diperiksa adalah isi objek yang diteruskan ke `runPrune`, bukan
    // seluruh berkas. Kalau yang diperiksa seluruh isi berkas, menghapus
    // satu baris `tickets:` dari objek itu tetap lolos karena nama
    // `getTicketService` masih ada di baris impor — persis sabotase S6.
    const start = script.indexOf('await runPrune({');
    const end = script.indexOf('});', start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const passed = script.slice(start, end);

    for (const service of [
      'getModerationService',
      'getTicketService',
      'getStatsService',
      'getLoggingService',
    ]) {
      expect(passed, `skrip cron tidak meneruskan ${service} ke runPrune`).toContain(service);
    }

    // Dan fungsi bersama harus memanggil keempat runner.
    for (const call of [
      'deps.moderation.purgeExpired(now)',
      'deps.tickets.purgeExpired(now)',
      'deps.stats.purgeExpired(now)',
      'deps.logs.purgeExpired(now)',
    ]) {
      expect(sweeps, `fungsi bersama tidak memanggil ${call}`).toContain(call);
    }
  });
});