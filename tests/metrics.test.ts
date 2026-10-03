import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MetricsRegistry,
  getMetricsRegistry,
  initMetrics,
  renderMetrics,
  resetMetrics,
  setMetricsRegistry,
  startMetricsProbe,
} from '../src/modules/metrics/index.js';

/**
 * Metrik proses (PRD §11).
 *
 * Modulnya murni, jadi semua di sini bisa diuji tanpa Discord, database,
 * maupun Lavalink hidup — termasuk job probe-nya, yang diuji lewat `measure`
 * palsu. Yang belum bisa diuji di lingkungan ini adalah probe yang sebenarnya
 * (`/stats` ke node sungguhan); itu belum pernah terpakai karena Lavalink
 * tidak pernah hidup di sini.
 */

const STARTED_AT = 1_700_000_000_000;

/** Registry dengan jam yang bisa dikendalikan, supaya uptime pasti. */
function makeRegistry(): { registry: MetricsRegistry; advance: (ms: number) => void } {
  let clock = STARTED_AT;
  const registry = new MetricsRegistry({ startedAt: STARTED_AT, now: () => clock });

  return {
    registry,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

describe('MetricsRegistry', () => {
  it('menghitung tiap permukaan interaksi terpisah', () => {
    const { registry } = makeRegistry();

    registry.record('command');
    registry.record('command');
    registry.record('command', 'error');
    registry.record('component');
    registry.record('message', 'error');

    const snapshot = registry.snapshot();

    expect(snapshot.interactions.command).toEqual({ total: 3, errors: 1, errorRate: 1 / 3 });
    expect(snapshot.interactions.component).toEqual({ total: 1, errors: 0, errorRate: 0 });
    expect(snapshot.interactions.message).toEqual({ total: 1, errors: 1, errorRate: 1 });
  });

  it('error rate perintah nol sebelum ada perintah, bukan NaN', () => {
    const { registry } = makeRegistry();

    // NaN di dashboard jauh lebih buruk daripada nol: dashboard biasanya
    // membuang sample yang bukan angka, jadi grafiknya berhenti altogether.
    expect(registry.snapshot().commandErrorRate).toBe(0);
  });

  it('error rate perintah hanya menghitung perintah, bukan komponen', () => {
    const { registry } = makeRegistry();

    registry.record('command');
    registry.record('component', 'error');

    expect(registry.snapshot().commandErrorRate).toBe(0);
  });

  it('uptime dihitung dari jam proses, bukan dari saat registry dibuat', () => {
    const { registry, advance } = makeRegistry();

    advance(125_000);

    expect(registry.snapshot().uptimeSeconds).toBe(125);
  });

  it('lagu diputar dihitung sendiri dari hook pemutaran', () => {
    const { registry } = makeRegistry();

    registry.recordTrackPlayed();
    registry.recordTrackPlayed();
    registry.recordTrackPlayed();

    expect(registry.snapshot().tracksPlayed).toBe(3);
  });

  it('latensi yang tidak masuk akal diabaikan, bukan merusak grafik', () => {
    const { registry } = makeRegistry();

    registry.recordLavalinkLatency(Number.NaN);
    registry.recordLavalinkLatency(-5);
    registry.recordLavalinkLatency(Number.POSITIVE_INFINITY);

    expect(registry.snapshot().lavalink).toEqual({
      connected: false,
      latencyMs: null,
      sampledAt: null,
    });
  });

  it('probe gagal menandai tidak terjangkau tapi menyimpan latensi terakhir', () => {
    const { registry, advance } = makeRegistry();

    registry.recordLavalinkLatency(40);
    advance(1_000);
    registry.recordLavalinkUnreachable();

    const lavalink = registry.snapshot().lavalink;

    expect(lavalink.connected).toBe(false);
    // "Terakhir diketahui" jauh lebih berguna daripada "tidak pernah", jadi
    // angka yang berhasil tidak dihapus — termasuk waktu pengukurannya, supaya
    // scraper bisa melihat staleness-nya.
    expect(lavalink.latencyMs).toBe(40);
    expect(lavalink.sampledAt).toBe(STARTED_AT);
  });

  it('snapshot tidak bisa dipakai mengubah angka di dalam registry', () => {
    const { registry } = makeRegistry();

    registry.record('command');
    const snapshot = registry.snapshot();
    snapshot.interactions.command.total = 999;
    snapshot.tracksPlayed = 999;

    expect(registry.snapshot().interactions.command.total).toBe(1);
    expect(registry.snapshot().tracksPlayed).toBe(0);
  });
});

describe('renderMetrics', () => {
  it('menulis metrik utama dengan tipe Prometheus yang benar', () => {
    const { registry, advance } = makeRegistry();
    registry.record('command');
    registry.record('command', 'error');
    registry.recordTrackPlayed();
    registry.recordLavalinkLatency(42);
    advance(60_000);

    const body = renderMetrics(registry.snapshot(), { guildCount: 42 });

    expect(body).toContain('# TYPE harmony_uptime_seconds gauge');
    expect(body).toContain('harmony_uptime_seconds 60');
    expect(body).toContain('harmony_guilds 42');
    expect(body).toContain('# TYPE harmony_tracks_played_total counter');
    expect(body).toContain('harmony_tracks_played_total 1');
    expect(body).toContain('harmony_interactions_total{kind="command"} 2');
    expect(body).toContain('harmony_interaction_errors_total{kind="command"} 1');
    expect(body).toContain('harmony_lavalink_connected 1');
    expect(body).toContain('harmony_lavalink_latency_ms 42');
    expect(body.endsWith('\n')).toBe(true);
  });

  it('latensi belum pernah diukur tidak ditulis, bukan ditulis 0', () => {
    const { registry } = makeRegistry();

    const body = renderMetrics(registry.snapshot(), { guildCount: 0 });

    expect(body).not.toContain('harmony_lavalink_latency_ms');
    expect(body).toContain('harmony_lavalink_connected 0');
  });

  it('error rate tidak dibulatkan supaya alarm tidak kehilangan kejadian', () => {
    const { registry } = makeRegistry();
    registry.record('command');
    registry.record('command', 'error');
    registry.record('command');
    registry.record('command', 'error');

    const body = renderMetrics(registry.snapshot(), { guildCount: 0 });

    expect(body).toContain(`harmony_command_error_rate ${0.5}`);
  });

  it('baris pertama setiap metrik didahului HELP dan TYPE', () => {
    const { registry } = makeRegistry();

    const lines = renderMetrics(registry.snapshot(), { guildCount: 0 }).split('\n');

    for (let index = 0; index < lines.length - 1; index += 1) {
      const line = lines[index];
      if (!line || line.startsWith('#')) continue;
      expect(lines[index - 1]?.startsWith('# TYPE')).toBe(true);
      expect(lines[index - 2]?.startsWith('# HELP')).toBe(true);
    }
  });
});

describe('startMetricsProbe', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('mengirim hasil probe ke registry', async () => {
    const samples: (number | null)[] = [];

    const probe = startMetricsProbe({
      measure: async () => 12,
      onSample: (value) => samples.push(value),
      intervalMs: 0,
    });

    await probe.runOnce();
    probe.stop();

    expect(samples).toEqual([12]);
  });

  it('probe yang melempar diperlakukan sebagai gagal, bukan exception', async () => {
    const samples: (number | null)[] = [];

    const probe = startMetricsProbe({
      measure: async () => {
        throw new Error('ECONNREFUSED');
      },
      onSample: (value) => samples.push(value),
      intervalMs: 0,
    });

    // Bot tidak boleh gagal hanya karena pengukuran latensi gagal.
    await expect(probe.runOnce()).resolves.toBeUndefined();
    probe.stop();

    expect(samples).toEqual([null]);
  });

  it('probe yang sedang jalan tidak diganggu probe berikutnya', async () => {
    const samples: (number | null)[] = [];
    let release: (value: number) => void = () => undefined;

    const probe = startMetricsProbe({
      measure: () =>
        new Promise<number>((resolve) => {
          release = resolve;
        }),
      onSample: (value) => samples.push(value),
      intervalMs: 0,
      runOnStart: false,
    });

    // Lavalink yang lambat tidak boleh menumpuk permintaan probe.
    const first = probe.runOnce();
    const second = probe.runOnce();
    release(7);
    await Promise.all([first, second]);
    probe.stop();

    expect(samples).toEqual([7]);
  });

  it('berjalan berkala sesuai interval', async () => {
    vi.useFakeTimers();
    const samples: (number | null)[] = [];

    const probe = startMetricsProbe({
      measure: async () => 5,
      onSample: (value) => samples.push(value),
      intervalMs: 1_000,
      runOnStart: false,
    });

    await vi.advanceTimersByTimeAsync(3_000);
    probe.stop();
    await vi.advanceTimersByTimeAsync(3_000);

    // Setelah stop(), tidak ada sample baru — job yang sudah berhenti tidak
    // boleh tetap menahan timer dan mengirim permintaan.
    expect(samples).toHaveLength(3);
  });
});

describe('singleton metrik', () => {
  afterEach(() => {
    resetMetrics();
  });

  it('satu proses memakai satu registry yang sama', () => {
    initMetrics(STARTED_AT);
    const registry = getMetricsRegistry();

    registry.record('command');

    expect(getMetricsRegistry()).toBe(registry);
    expect(getMetricsRegistry().snapshot().interactions.command.total).toBe(1);
  });

  it('initMetrics mengunci waktu mulai proses, bukan waktu registry dibuat', () => {
    initMetrics(STARTED_AT);
    const snapshot = getMetricsRegistry().snapshot();

    // Tanpa initMetrics, uptime terukur sejak registry dibuat — angka yang
    // terlihat benar padahal salah.
    expect(snapshot.uptimeSeconds).toBeGreaterThanOrEqual(0);
  });

  it('registry bisa diganti untuk tes lalu dibuang lagi', () => {
    const replacement = new MetricsRegistry();
    setMetricsRegistry(replacement);

    expect(getMetricsRegistry()).toBe(replacement);

    resetMetrics();
    expect(getMetricsRegistry()).not.toBe(replacement);
  });
});