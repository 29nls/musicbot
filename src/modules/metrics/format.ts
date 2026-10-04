import type { FleetMetrics } from './fleet.js';
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
/**
 * Render agregat lintas shard sebagai seri Prometheus (PRD §13 KPI).
 *
 * **Prefix `harmony_fleet_`, dan seri proses tetap ada.** Seri lama
 * (`harmony_guilds`, `harmony_command_error_rate`) menjawab per shard dan itu
 * tidak boleh hilang: kalau scraper hanya mengambil satu endpoint, seri proses
 * itu memang angka shard itu. Menimpanya dengan agregat membuat orang berhenti
 * mengira satu shard sebagai satu bot. Dua seri dengan dua nama membuat
 * keduanya bisa dipakai berdampingan.
 *
 * **Satu angka yang dicari §13 ada di sini:** `harmony_fleet_command_error_rate`
 * adalah `errors / total` dari seluruh shard, bukan rata-rata dari rate tiap
 * shard. Rata-rata rate menyalahkar shard yang sepi — 1% dari 1 interaksi akan
 * dihargai sama dengan 1% dari 10.000 — jadi penjumlahannya dari penghitung
 * mentah, bukan dari rate yang sudah jadi.
 *
 * `harmony_fleet_instances` selalu ditulis, termasuk saat nol. Pembaca butuh
 * tahu kalau agregat ini sedang tidak mencakup shard yang seharusnya ada; angka
 * nol tanpa penjelasan dibaca sebagai "bot tidak mengerjakan apa pun", padahal
 * bisa berarti tidak ada proses yang melapor sama sekali.
 */
export function renderFleetMetrics(fleet: FleetMetrics): string {
  const lines: string[] = [];

  gauge(
    lines,
    'harmony_fleet_instances',
    'Berapa proses yang melapor ke agregat ini',
    fleet.instances,
  );

  gauge(
    lines,
    'harmony_fleet_uptime_seconds',
    'Uptime proses tertua dalam detik (bukan jumlah uptime)',
    fleet.uptimeSeconds,
  );

  gauge(lines, 'harmony_fleet_guilds', 'Guild yang dilayani seluruh shard', fleet.guildCount);

  counter(
    lines,
    'harmony_fleet_tracks_played_total',
    'Lagu yang selesai diputar di seluruh shard',
    fleet.tracksPlayed,
  );

  for (const kind of KINDS) {
    const counters = fleet.interactions[kind];

    lines.push(
      `# HELP harmony_fleet_interactions_total Interaksi ${kind} di seluruh shard`,
      '# TYPE harmony_fleet_interactions_total counter',
      `harmony_fleet_interactions_total{kind="${kind}"} ${counters.total}`,
      `# HELP harmony_fleet_interaction_errors_total Interaksi ${kind} yang berakhir dengan error di seluruh shard`,
      '# TYPE harmony_fleet_interaction_errors_total counter',
      `harmony_fleet_interaction_errors_total{kind="${kind}"} ${counters.errors}`,
      `# HELP harmony_fleet_interaction_error_rate Error rate ${kind} di seluruh shard`,
      '# TYPE harmony_fleet_interaction_error_rate gauge',
      `harmony_fleet_interaction_error_rate{kind="${kind}"} ${counters.errorRate}`,
    );
  }

  gauge(
    lines,
    'harmony_fleet_command_error_rate',
    'Error rate perintah seluruh shard (KPI §13, target < 0.01)',
    fleet.commandErrorRate,
  );

  gauge(
    lines,
    'harmony_fleet_lavalink_reachable',
    'Berapa proses yang node Lavalink-nya menjawab pada sample terakhir',
    fleet.lavalink.reachable,
  );

  gauge(
    lines,
    'harmony_fleet_lavalink_unreachable',
    'Berapa proses yang tidak menjawab pada sample terakhir',
    fleet.lavalink.unreachable,
  );

  // Sama seperti seri proses: latensi yang belum pernah terukur tidak ditulis,
  // supaya "tidak pernah terukur" tidak dibaca sebagai "nol milidetik".
  if (fleet.lavalink.worstLatencyMs !== null) {
    gauge(
      lines,
      'harmony_fleet_lavalink_worst_latency_ms',
      'Latensi Lavalink terburuk antar proses (milidetik)',
      fleet.lavalink.worstLatencyMs,
    );
  }

  return `${lines.join('\n')}\n`;
}
