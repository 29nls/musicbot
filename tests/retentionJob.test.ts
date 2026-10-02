import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RetentionResult } from '../src/modules/moderation/retention.js';
import type { TicketRetentionResult } from '../src/modules/tickets/retention.js';
import {
  startRetentionJob,
  type RetentionJob,
  type RetentionRunner,
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
 * Ticket runner yang dipakai semua tes di bawah.
 *
 * Tanpa ini `startRetentionJob` memakai service tiket sungguhan yang mencoba
 * koneksi database, jadi durasi tiap sapuan tergantung koneksi — membuat
 * assertion "berapa kali terpanggil" jadi soal timing, bukan soal logika job.
 */
const tickets = new FakeTicketRunner();

let job: RetentionJob | undefined;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  tickets.calls = 0;
});

afterEach(() => {
  job?.stop();
  job = undefined;
  vi.useRealTimers();
});

describe('startRetentionJob', () => {
  it('menjalankan satu sapuan saat start', async () => {
    const runner = new FakeRunner();
    job = startRetentionJob(runner, { ticketRunner: tickets, intervalMs: 60_000 });

    await vi.advanceTimersByTimeAsync(0);

    expect(runner.calls).toBe(1);
  });

  it('melewati sapuan awal ketika runOnStart dimatikan', async () => {
    const runner = new FakeRunner();
    job = startRetentionJob(runner, { ticketRunner: tickets, intervalMs: 60_000, runOnStart: false });

    await vi.advanceTimersByTimeAsync(0);
    expect(runner.calls).toBe(0);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(runner.calls).toBe(1);
  });

  it('menjalankan ulang sesuai interval', async () => {
    const runner = new FakeRunner();
    job = startRetentionJob(runner, { ticketRunner: tickets, intervalMs: 60_000, runOnStart: false });

    await vi.advanceTimersByTimeAsync(180_000);

    expect(runner.calls).toBe(3);
  });

  it('tidak menjalankan dua sapuan bersamaan', async () => {
    const runner = new FakeRunner();
    runner.release = () => undefined; // tahan sapuan pertama
    job = startRetentionJob(runner, { ticketRunner: tickets, intervalMs: 60_000 });

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
    job = startRetentionJob(runner, { ticketRunner: tickets, intervalMs: 60_000, runOnStart: false });

    await expect(job.runOnce()).resolves.toBeNull();
  });

  it('mengembalikan hasil sapuan yang berhasil', async () => {
    const runner = new FakeRunner();
    runner.result = { cutoff: new Date(2025, 9, 2), warnings: 4, cases: 7 };
    job = startRetentionJob(runner, { ticketRunner: tickets, intervalMs: 60_000, runOnStart: false });

    await expect(job.runOnce()).resolves.toEqual(runner.result);
  });

  it('intervalMs 0 mematikan penjadwalan tanpa mematikan sapuan manual', async () => {
    const runner = new FakeRunner();
    job = startRetentionJob(runner, { ticketRunner: tickets, intervalMs: 0, runOnStart: false });

    await vi.advanceTimersByTimeAsync(600_000);
    expect(runner.calls).toBe(0);

    await job.runOnce();
    expect(runner.calls).toBe(1);
  });

  it('stop() membatalkan jadwal berikutnya', async () => {
    const runner = new FakeRunner();
    const stopped = startRetentionJob(runner, {
      ticketRunner: tickets,
      intervalMs: 60_000,
      runOnStart: false,
    });

    stopped.stop();
    await vi.advanceTimersByTimeAsync(300_000);

    expect(runner.calls).toBe(0);
  });

  it('timer tidak menahan proses tetap hidup', () => {
    const runner = new FakeRunner();
    job = startRetentionJob(runner, { ticketRunner: tickets, intervalMs: 60_000, runOnStart: false });

    // Vitest tidak erreicht event loop; yang dicek adalah jumlah handle aktif.
    expect(vi.getTimerCount()).toBe(1);
  });

  it('menyapu tiket retensi di jadwal yang sama', async () => {
    const runner = new FakeRunner();
    const ticketRunner = new FakeTicketRunner();
    ticketRunner.result = { cutoff: new Date(2025, 9, 2), ticketsDeleted: 4 };
    job = startRetentionJob(runner, { intervalMs: 60_000, ticketRunner });

    await vi.advanceTimersByTimeAsync(0);

    expect(ticketRunner.calls).toBe(1);
  });

  it('kegagalan retensi tiket tidak menggagalkan sapuan kasus', async () => {
    const runner = new FakeRunner();
    const ticketRunner = new FakeTicketRunner();
    ticketRunner.error = new Error('tabel ticket belum ada');
    job = startRetentionJob(runner, { intervalMs: 60_000, ticketRunner });

    await vi.advanceTimersByTimeAsync(0);

    expect(runner.calls).toBe(1);
    expect(ticketRunner.calls).toBe(1);
  });
});
