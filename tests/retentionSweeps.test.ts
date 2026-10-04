import { describe, expect, it, vi } from 'vitest';
import type { LogRetentionResult } from '../src/modules/logging/retention.js';
import type { RetentionResult } from '../src/modules/moderation/retention.js';
import type { StatRetentionResult } from '../src/modules/stats/retention.js';
import type { TicketRetentionResult } from '../src/modules/tickets/retention.js';
import {
  runRetentionSweeps,
  type LogSweepRunner,
  type ModerationSweepRunner,
  type StatsSweepRunner,
  type TicketSweepRunner,
} from '../src/services/retentionSweeps.js';

/**
 * Perilaku `runRetentionSweeps` — satu definisi keempat sapuan retensi.
 *
 * Berkas ini ada karena daftar sapuan pernah ditulis dua kali dan keduanya
 * berbeda: job dalam proses menyapu empat, skrip cron hanya dua. Tiket
 * (retensi 12 bulan, termasuk transkrip privat) dan statistik playback
 * (90 hari) tidak pernah disentuh jalur cron, dan laporan JSON-nya tidak
 * punya kunci untuk keduanya, jadi tidak ada yang gagal dan tidak ada yang
 * terlihat. Tes di sini mengunci keempatnya benar-benar dijalankan.
 */

const NOW = new Date(2026, 9, 2, 12, 0, 0);

class FakeModeration implements ModerationSweepRunner {
  public calls: string[] = [];
  public error: Error | null = null;
  public result: RetentionResult = { cutoff: new Date(2025, 9, 2), warnings: 0, cases: 0 };

  constructor(private readonly order: string[]) {}

  async purgeExpired(now: Date = new Date()): Promise<RetentionResult> {
    this.order.push('moderation');
    this.calls.push(now.toISOString());
    if (this.error) throw this.error;
    return this.result;
  }
}

class FakeTickets implements TicketSweepRunner {
  public calls: string[] = [];
  public error: Error | null = null;
  public result: TicketRetentionResult = { cutoff: new Date(2025, 9, 2), ticketsDeleted: 0 };

  constructor(private readonly order: string[]) {}

  async purgeExpired(now: Date = new Date()): Promise<TicketRetentionResult> {
    this.order.push('tickets');
    this.calls.push(now.toISOString());
    if (this.error) throw this.error;
    return this.result;
  }
}

class FakeStats implements StatsSweepRunner {
  public calls: string[] = [];
  public error: Error | null = null;
  public result: StatRetentionResult = { cutoff: new Date(2026, 8, 3), deleted: 0 };

  constructor(private readonly order: string[]) {}

  async purgeExpired(now: Date = new Date()): Promise<StatRetentionResult> {
    this.order.push('stats');
    this.calls.push(now.toISOString());
    if (this.error) throw this.error;
    return this.result;
  }
}

class FakeLogs implements LogSweepRunner {
  public calls: string[] = [];
  public error: Error | null = null;
  public result: LogRetentionResult = { cutoff: new Date(2026, 9, 2), logs: 0 };

  constructor(private readonly order: string[]) {}

  async purgeExpired(now: Date = new Date()): Promise<LogRetentionResult> {
    this.order.push('logs');
    this.calls.push(now.toISOString());
    if (this.error) throw this.error;
    return this.result;
  }
}

function harness() {
  const order: string[] = [];
  const deps = {
    moderation: new FakeModeration(order),
    tickets: new FakeTickets(order),
    stats: new FakeStats(order),
    logs: new FakeLogs(order),
  };
  return { order, deps };
}

describe('runRetentionSweeps', () => {
  it('menjalankan keempat sapuan tepat sekali, dengan urutan yang dijanjikan', async () => {
    const { order, deps } = harness();

    await runRetentionSweeps(deps, NOW);

    expect(order).toEqual(['moderation', 'tickets', 'stats', 'logs']);
  });

  it('meneruskan waktu yang sama ke keempat runner', async () => {
    const { deps } = harness();

    await runRetentionSweeps(deps, NOW);

    expect(deps.moderation.calls).toEqual([NOW.toISOString()]);
    expect(deps.tickets.calls).toEqual([NOW.toISOString()]);
    expect(deps.stats.calls).toEqual([NOW.toISOString()]);
    expect(deps.logs.calls).toEqual([NOW.toISOString()]);
  });

  it('mengembalikan hasil keempat sapuan apa adanya', async () => {
    const { deps } = harness();
    deps.moderation.result = { cutoff: new Date(2025, 9, 2), warnings: 4, cases: 7 };
    deps.tickets.result = { cutoff: new Date(2025, 9, 2), ticketsDeleted: 3 };
    deps.stats.result = { cutoff: new Date(2026, 8, 3), deleted: 12 };
    deps.logs.result = { cutoff: new Date(2026, 9, 2), logs: 5 };

    const summary = await runRetentionSweeps(deps, NOW);

    expect(summary).toEqual({
      moderation: { cutoff: new Date(2025, 9, 2), warnings: 4, cases: 7 },
      tickets: { cutoff: new Date(2025, 9, 2), ticketsDeleted: 3 },
      stats: { cutoff: new Date(2026, 8, 3), deleted: 12 },
      logs: { cutoff: new Date(2026, 9, 2), logs: 5 },
    });
  });

  it('kegagalan sapuan tiket tidak menghentikan statistik dan log', async () => {
    const { order, deps } = harness();
    deps.tickets.error = new Error('tabel ticket belum ada');

    const summary = await runRetentionSweeps(deps, NOW);

    expect(summary.tickets).toBeNull();
    expect(summary.stats).not.toBeNull();
    expect(summary.logs).not.toBeNull();
    expect(order).toEqual(['moderation', 'tickets', 'stats', 'logs']);
  });

  it('kegagalan sapuan statistik tidak menghentikan log', async () => {
    const { order, deps } = harness();
    deps.stats.error = new Error('tabel playback_stat belum ada');

    const summary = await runRetentionSweeps(deps, NOW);

    expect(summary.stats).toBeNull();
    expect(summary.logs).not.toBeNull();
    expect(order).toEqual(['moderation', 'tickets', 'stats', 'logs']);
  });

  it('kegagalan sapuan log tidak menghentikan yang lain', async () => {
    const { deps } = harness();
    deps.logs.error = new Error('tabel log belum ada');

    const summary = await runRetentionSweeps(deps, NOW);

    expect(summary.logs).toBeNull();
    expect(summary.moderation).not.toBeNull();
    expect(summary.tickets).not.toBeNull();
    expect(summary.stats).not.toBeNull();
  });

  it('kegagalan sapuan kasus melempar keluar, karena tidak ada yang bisa dilaporkan', async () => {
    const { order, deps } = harness();
    deps.moderation.error = new Error('database mati');

    await expect(runRetentionSweeps(deps, NOW)).rejects.toThrow('database mati');
    // Sapuan lain tidak jalan: siklus yang gagal tidak menghasilkan laporan.
    expect(order).toEqual(['moderation']);
  });

  it('tidak membedakan "nol baris" dari "gagal"', async () => {
    // Dua hasil berbeda yang sering tertukar: sapuan yang benar-benar berjalan
    // dan tidak menemukan apa pun, versus sapuan yang tidak bisa dijalankan.
    const { deps } = harness();
    deps.tickets.result = { cutoff: new Date(2025, 9, 2), ticketsDeleted: 0 };

    const summary = await runRetentionSweeps(deps, NOW);

    expect(summary.tickets).not.toBeNull();
    expect(summary.tickets?.ticketsDeleted).toBe(0);
  });

  it('mencatat kegagalan sapuan sampingan sebagai peringatan', async () => {
    const { deps } = harness();
    const warn = vi.fn();
    const debug = vi.fn();
    const info = vi.fn();
    deps.stats.error = new Error('tabel playback_stat belum ada');

    await runRetentionSweeps({ ...deps, logger: { debug, info, warn } }, NOW);

    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[1])).toContain('statistik');
  });
});