import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LogRetentionResult } from '../src/modules/logging/retention.js';
import type { RetentionResult } from '../src/modules/moderation/retention.js';
import type { StatRetentionResult } from '../src/modules/stats/retention.js';
import type { TicketRetentionResult } from '../src/modules/tickets/retention.js';
import {
  startRetentionJob,
  type LogRetentionRunner,
  type RetentionJob,
  type RetentionRunner,
  type StatsRetentionRunner,
  type TicketRetentionRunner,
} from '../src/services/retentionJob.js';

const NOW = new Date(2026, 9, 2, 12, 0, 0);

class FakeRunner implements RetentionRunner {
  public calls = 0;
  public result: RetentionResult = {
    cutoff: new Date(2025, 9, 2, 12, 0, 0),
    warnings: 0,
    cases: 0,
  };
  public error: Error | null = null;
  /** Tahan proses saat purgeExpired dipanggil (untuk menguji tumpang tindih). */
  public release: (() => void) | null = null;

  async purgeExpired(now: Date = new Date()): Promise<RetentionResult> {
    this.calls += 1;

    if (this.release) {
      await new Promise<void>((resolve) => {
        this.release = resolve;
      });
    }

    if (this.error) throw this.error;
    void now;
    return this.result;
  }
}

/**
 * Ticket runner yang dipakai semua tes di bawah.
 *
 * Tanpa ini `startRetentionJob` memakai service tiket sungguhan yang mencoba
 * koneksi database, jadi durasi tiap sapuan tergantung koneksi — membuat
 * assertion "berapa kali terpanggil" jadi soal timing, bukan soal logika job.
 */
class FakeTicketRunner implements TicketRetentionRunner {
  public calls = 0;
  public result: TicketRetentionResult = {
    cutoff: new Date(2025, 9, 2, 12, 0, 0),
    ticketsDeleted: 0,
  };
  public error: Error | null = null;

  async purgeExpired(now: Date = new Date()): Promise<TicketRetentionResult> {
    this.calls += 1;
    if (this.error) throw this.error;
    void now;
    return this.result;
  }
}

/**
 * Runner statistik playback.
 *
 * Diperlukan karena keempat sapuan sekarang wajib ada. Sebelumnya statistik
 * boleh dilewati, dan justru situlah celahnya: satu jalur retensi bisa
 * kehilangan sapuan tanpa ada yang menyadarinya. Semua tes di sini menyuntik
 * runner palsu untuk keempatnya supaya tidak ada yang bicara ke database.
 */
class FakeStatsRunner implements StatsRetentionRunner {
  public calls = 0;
  public result: StatRetentionResult = {
    cutoff: new Date(2026, 8, 3, 0, 0, 0),
    deleted: 0,
  };
  public error: Error | null = null;

  async purgeExpired(now: Date = new Date()): Promise<StatRetentionResult> {
    this.calls += 1;
    if (this.error) throw this.error;
    void now;
    return this.result;
  }
}

/**
 * Log runner. Diberi keterangan yang sama dengan runner tiket: tanpa ini job
 * memakai service sungguhan yang mencoba koneksi database, jadi assertion
 * "berapa kali terpanggil" jadi soal timing, bukan soal logika job.
 */
class FakeLogRunner implements LogRetentionRunner {
  public calls = 0;
  public result: LogRetentionResult = {
    cutoff: new Date(2026, 9, 2, 12, 0, 0),
    logs: 0,
  };
  public error: Error | null = null;

  async purgeExpired(now: Date = new Date()): Promise<LogRetentionResult> {
    this.calls += 1;
    if (this.error) throw this.error;
    void now;
    return this.result;
  }
}

const tickets = new FakeTicketRunner();
const stats = new FakeStatsRunner();
const logs = new FakeLogRunner();

let job: RetentionJob | undefined;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  tickets.calls = 0;
  logs.calls = 0;
  logs.error = null;
  logs.result = { cutoff: new Date(2026, 9, 2, 12, 0, 0), logs: 0 };
  stats.calls = 0;
  stats.error = null;
  stats.result = { cutoff: new Date(2026, 8, 3, 0, 0, 0), deleted: 0 };
});

afterEach(() => {
  job?.stop();
  job = undefined;
  vi.useRealTimers();
});

describe('startRetentionJob', () => {
  it('menjalankan satu sapuan saat start', async () => {
    const runner = new FakeRunner();
    job = startRetentionJob(runner, {
      ticketRunner: tickets,
      statsRunner: stats,
      logRunner: logs,
      intervalMs: 60_000,
    });

    await vi.advanceTimersByTimeAsync(0);

    expect(runner.calls).toBe(1);
  });

  it('melewati sapuan awal ketika runOnStart dimatikan', async () => {
    const runner = new FakeRunner();
    job = startRetentionJob(runner, {
      ticketRunner: tickets,
      statsRunner: stats,
      logRunner: logs,
      intervalMs: 60_000,
      runOnStart: false,
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(runner.calls).toBe(0);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(runner.calls).toBe(1);
  });

  it('menjalankan ulang sesuai interval', async () => {
    const runner = new FakeRunner();
    job = startRetentionJob(runner, {
      ticketRunner: tickets,
      statsRunner: stats,
      logRunner: logs,
      intervalMs: 60_000,
      runOnStart: false,
    });

    await vi.advanceTimersByTimeAsync(180_000);

    expect(runner.calls).toBe(3);
  });

  it('tidak menjalankan dua sapuan bersamaan', async () => {
    const runner = new FakeRunner();
    runner.release = () => undefined; // tahan sapuan pertama
    job = startRetentionJob(runner, {
      ticketRunner: tickets,
      statsRunner: stats,
      logRunner: logs,
      intervalMs: 60_000,
    });

    // Dua tick interval lewat selagi sapuan pertama masih jalan.
    await vi.advanceTimersByTimeAsync(120_000);
    expect(runner.calls).toBe(1);

    // Lepaskan sapuan yang tertahan.
    runner.release?.();
    await vi.advanceTimersByTimeAsync(0);
    expect(runner.calls).toBe(1);

    // Sapuan berikutnya baru jalan setelah yang pertama selesai.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(runner.calls).toBe(2);
  });

  it('kegagalan tidak melempar keluar dan dicatat sebagai peringatan', async () => {
    const runner = new FakeRunner();
    runner.error = new Error('database mati');
    job = startRetentionJob(runner, {
      ticketRunner: tickets,
      statsRunner: stats,
      logRunner: logs,
      intervalMs: 60_000,
      runOnStart: false,
    });

    await expect(job.runOnce()).resolves.toBeNull();
  });

  it('mengembalikan hasil sapuan yang berhasil', async () => {
    const runner = new FakeRunner();
    runner.result = { cutoff: new Date(2025, 9, 2), warnings: 4, cases: 7 };
    job = startRetentionJob(runner, {
      ticketRunner: tickets,
      statsRunner: stats,
      logRunner: logs,
      intervalMs: 60_000,
      runOnStart: false,
    });

    await expect(job.runOnce()).resolves.toEqual(runner.result);
  });

  it('intervalMs 0 mematikan penjadwalan tanpa mematikan sapuan manual', async () => {
    const runner = new FakeRunner();
    job = startRetentionJob(runner, {
      ticketRunner: tickets,
      statsRunner: stats,
      logRunner: logs,
      intervalMs: 0,
      runOnStart: false,
    });

    await vi.advanceTimersByTimeAsync(600_000);
    expect(runner.calls).toBe(0);

    await job.runOnce();
    expect(runner.calls).toBe(1);
  });

  it('stop() membatalkan jadwal berikutnya', async () => {
    const runner = new FakeRunner();
    const stopped = startRetentionJob(runner, {
      ticketRunner: tickets,
      statsRunner: stats,
      logRunner: logs,
      intervalMs: 60_000,
      runOnStart: false,
    });

    stopped.stop();
    await vi.advanceTimersByTimeAsync(300_000);

    expect(runner.calls).toBe(0);
  });

  it('timer tidak menahan proses tetap hidup', () => {
    const runner = new FakeRunner();
    job = startRetentionJob(runner, {
      ticketRunner: tickets,
      statsRunner: stats,
      logRunner: logs,
      intervalMs: 60_000,
      runOnStart: false,
    });

    // Vitest tidak mencapai event loop; yang dicek adalah jumlah handle aktif.
    expect(vi.getTimerCount()).toBe(1);
  });

  it('menyapu tiket retensi di jadwal yang sama', async () => {
    const runner = new FakeRunner();
    const ticketRunner = new FakeTicketRunner();
    ticketRunner.result = { cutoff: new Date(2025, 9, 2), ticketsDeleted: 4 };
    job = startRetentionJob(runner, {
      intervalMs: 60_000,
      ticketRunner,
      statsRunner: stats,
      logRunner: logs,
    });

    await vi.advanceTimersByTimeAsync(0);

    expect(ticketRunner.calls).toBe(1);
  });

  it('menyapu statistik playback di jadwal yang sama', async () => {
    const runner = new FakeRunner();
    const ticketRunner = new FakeTicketRunner();
    const statsRunner = new FakeStatsRunner();
    statsRunner.result = { cutoff: new Date(2026, 8, 3), deleted: 9 };
    job = startRetentionJob(runner, { intervalMs: 60_000, ticketRunner, statsRunner, logRunner: logs });

    await vi.advanceTimersByTimeAsync(0);

    expect(statsRunner.calls).toBe(1);
  });

  it('menyapu riwayat log di jadwal yang sama, setelah kasus & tiket', async () => {
    const runner = new FakeRunner();
    const ticketRunner = new FakeTicketRunner();
    job = startRetentionJob(runner, {
      intervalMs: 60_000,
      ticketRunner,
      statsRunner: stats,
      logRunner: logs,
    });

    await vi.advanceTimersByTimeAsync(0);

    expect(logs.calls).toBe(1);
  });

  it('kegagalan retensi tiket tidak menggagalkan sapuan kasus', async () => {
    const runner = new FakeRunner();
    const ticketRunner = new FakeTicketRunner();
    ticketRunner.error = new Error('tabel ticket belum ada');
    job = startRetentionJob(runner, { intervalMs: 60_000, ticketRunner, statsRunner: stats, logRunner: logs });

    await vi.advanceTimersByTimeAsync(0);

    expect(runner.calls).toBe(1);
    expect(ticketRunner.calls).toBe(1);
  });

  it('kegagalan retensi log tidak menggagalkan sapuan kasus', async () => {
    // Janji "log dihapus setelah 30 hari" tidak boleh diam-diam gagal: yang
    // penting kegagalan itu terlihat di log, bukan ikut menutupi laporan kasus.
    const runner = new FakeRunner();
    const ticketRunner = new FakeTicketRunner();
    logs.error = new Error('tabel log belum ada');
    job = startRetentionJob(runner, { intervalMs: 60_000, ticketRunner, statsRunner: stats, logRunner: logs });

    await vi.advanceTimersByTimeAsync(0);

    expect(runner.calls).toBe(1);
    expect(logs.calls).toBe(1);
  });

  it('kegagalan retensi statistik tidak menggagalkan sapuan yang lain', async () => {
    const runner = new FakeRunner();
    const ticketRunner = new FakeTicketRunner();
    const statsRunner = new FakeStatsRunner();
    statsRunner.error = new Error('tabel playback_stat belum ada');
    job = startRetentionJob(runner, { intervalMs: 60_000, ticketRunner, statsRunner, logRunner: logs });

    await vi.advanceTimersByTimeAsync(0);

    expect(runner.calls).toBe(1);
    expect(ticketRunner.calls).toBe(1);
    expect(statsRunner.calls).toBe(1);
    expect(logs.calls).toBe(1);
  });

  it('menjalankan keempat sapuan tepat sekali per siklus', async () => {
    const runner = new FakeRunner();
    const ticketRunner = new FakeTicketRunner();
    const statsRunner = new FakeStatsRunner();
    job = startRetentionJob(runner, {
      intervalMs: 60_000,
      runOnStart: false,
      ticketRunner,
      statsRunner,
      logRunner: logs,
    });

    await job.runOnce();

    expect({
      moderation: runner.calls,
      tickets: ticketRunner.calls,
      stats: statsRunner.calls,
      logs: logs.calls,
    }).toEqual({ moderation: 1, tickets: 1, stats: 1, logs: 1 });
  });
});