/**
 * Health check bot (PRD §5.1 "Health check endpoint untuk monitoring").
 *
 * Modul ini murni: bentuk laporan dan keputusan status dihitung di sini
 * supaya bisa diuji tanpa menjalankan server HTTP atau	client Discord.
 */

/** Status akhir yang dilaporkan ke monitoring. */
export type HealthStatus = 'ok' | 'degraded' | 'down';

export type DependencyState = 'ok' | 'down' | 'unchecked';

export interface HealthInput {
  /** Waktu sekarang (ms) — di-inject supaya uptime bisa diuji. */
  now: number;
  /** Kapan proses ini start (ms). */
  startedAt: number;
  /** Gateway Discord sudah siap menerima perintah. */
  gatewayReady: boolean;
  /** Ada node Lavalink yang terhubung. */
  lavalinkConnected: boolean;
  database: DependencyState;
  /** Jumlah guild yang dilayani. */
  guildCount: number;
}

export interface HealthReport {
  status: HealthStatus;
  /** Kode HTTP untuk endpoint readiness: 200 saat siap, 503 saat tidak. */
  httpStatus: number;
  /** Otak bot (proses) hidup? Endpoint liveness memakai ini. */
  alive: true;
  uptimeSeconds: number;
  guildCount: number;
  checks: {
    gateway: boolean;
    lavalink: boolean;
    database: DependencyState;
  };
}

/**
 * Susun laporan kesehatan.
 *
 * **Database turun = `down`, bukan `degraded`:** hampir semua perintah butuh
 * konfigurasi dari database, jadi bot yang hidup tapi tidak bisa membaca
 * konfigurasi tidak berguna bagi siapa pun — dan monitoring harus bisa
 * membedakan "restart saja" dari "tunggu database".
 * Lavalink yang putus hanya `degraded`: moderasi, tiket, dan logging tetap jalan.
 * `unchecked` (database belum sempat dijangkau) sengaja **tidak** dianggap
 * `ok`: melaporkan sehat sebelum tahu apa pun sama dengan melapor yang salah.
 */
export function buildHealthReport(input: HealthInput): HealthReport {
  const uptimeSeconds = Math.max(
    0,
    Math.floor((input.now - input.startedAt) / 1_000),
  );

  const databaseDown = input.database === 'down';
  const musicDown = !input.lavalinkConnected;
  const gatewayDown = !input.gatewayReady;

  const status: HealthStatus = databaseDown
    ? 'down'
    : gatewayDown || musicDown || input.database === 'unchecked'
      ? 'degraded'
      : 'ok';

  return {
    status,
    httpStatus: status === 'ok' ? 200 : 503,
    alive: true,
    uptimeSeconds,
    guildCount: input.guildCount,
    checks: {
      gateway: input.gatewayReady,
      lavalink: input.lavalinkConnected,
      database: input.database,
    },
  };
}

/**
 * Bentuk JSON laporan (stabil supaya bisa dipakai parser monitoring).
 *
 * `metrics` ikut disertakan kalau tersedia: satu endpoint yang bisa dipakai
 * untuk diagnosis (liveness + metrik) lebih berguna daripada dua permintaan
 * yang harus dihubungkan manual saat bot sedang bermasalah. Field ini opsional
 * supaya modul health tetap bisa dipakai tanpa modul metrik.
 */
export function healthPayload(report: HealthReport, metrics?: unknown): Record<string, unknown> {
  return {
    status: report.status,
    uptimeSeconds: report.uptimeSeconds,
    guildCount: report.guildCount,
    checks: report.checks,
    ...(metrics === undefined ? {} : { metrics }),
  };
}

/** Balasan endpoint liveness: proses hidup, tanpa memeriksa dependency apa pun. */
export function livenessPayload(report: HealthReport): Record<string, unknown> {
  return { status: report.alive ? 'ok' : 'down', uptimeSeconds: report.uptimeSeconds };
}