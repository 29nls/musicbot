import type { InteractionKind, MetricsSnapshot } from './types.js';

/**
 * Render metrik ke format teks Prometheus.
 *
 * Dipakai untuk `GET /metrics`, jadi bentuknya harus persis yang dipahami
 * scraper: nama seri, `# HELP`, `# TYPE`, lalu baris `nama{nilai}`. Fungsi ini
 * murni dan tidak tahu apa pun soal HTTP — endpointnya yang menerjemahkan
 * string ini menjadi balasan.
 *
 * **Angka tidak pernah dibulatkan di sini.** Pembulatan membuat alarm terlihat
 * rapi tapi tidak jujur (error rate 0,4% yang ditulis 0% menghapus tepat
 * kejadian yang dicari); scraper yang butuh tampilan rapi yang bisa membulatkan.
 */
const KINDS: readonly InteractionKind[] = ['command', 'component', 'message'];

export interface MetricsContext {
  /** Jumlah guild yang dilayani; dari client Discord, bukan dari registry. */
  guildCount: number;
}

export function renderMetrics(snapshot: MetricsSnapshot, context: MetricsContext): string {
  const lines: string[] = [];

  gauge(
    lines,
    'harmony_uptime_seconds',
    'Berapa lama proses bot hidup (detik)',
    snapshot.uptimeSeconds,
  );

  gauge(lines, 'harmony_guilds', 'Jumlah guild yang dilayani', context.guildCount);

  counter(
    lines,
    'harmony_tracks_played_total',
    'Lagu yang selesai diputar sejak proses start',
    snapshot.tracksPlayed,
  );

  for (const kind of KINDS) {
    const counters = snapshot.interactions[kind];

    lines.push(
      `# HELP harmony_interactions_total Jumlah interaksi ${kind} yang dijalankan sejak proses start`,
      '# TYPE harmony_interactions_total counter',
      `harmony_interactions_total{kind="${kind}"} ${counters.total}`,
      `# HELP harmony_interaction_errors_total Interaksi ${kind} yang berakhir dengan error`,
      '# TYPE harmony_interaction_errors_total counter',
      `harmony_interaction_errors_total{kind="${kind}"} ${counters.errors}`,
    );
  }

  gauge(
    lines,
    'harmony_command_error_rate',
    'Error rate perintah kumulatif sejak proses start (KPI §13, target < 0.01)',
    snapshot.commandErrorRate,
  );

  gauge(
    lines,
    'harmony_lavalink_connected',
    '1 kalau node Lavalink menjawab pada sample terakhir, selain itu 0',
    snapshot.lavalink.connected ? 1 : 0,
  );

  // Hanya ditulis kalau pernah ada sample: metrik yang belum pernah terisi
  // lebih baik tidak ada daripada ada dengan angka 0 yang disalahartikan
  // sebagai "latensi 0 milidetik".
  if (snapshot.lavalink.latencyMs !== null) {
    gauge(
      lines,
      'harmony_lavalink_latency_ms',
      'Latensi terakhir ke Lavalink (milidetik)',
      snapshot.lavalink.latencyMs,
    );
  }

  return `${lines.join('\n')}\n`;
}

function gauge(lines: string[], name: string, help: string, value: number): void {
  lines.push(`# HELP ${name} ${help}`, `# TYPE ${name} gauge`, `${name} ${value}`);
}

function counter(lines: string[], name: string, help: string, value: number): void {
  lines.push(`# HELP ${name} ${help}`, `# TYPE ${name} counter`, `${name} ${value}`);
}