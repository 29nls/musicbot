// Bagian murni dari `tools/watchdog.ts`. Dipisah supaya aturan "kapan
// me-restart" bisa diuji tanpa Docker, container, atau webhook.
//
// Aturan yang menentukan dan alasannya:
// - Lavalink boleh direstart saat healthcheck Docker-nya `unhealthy`, karena
//   healthcheck itu memanggil HTTP Lavalink sendiri. Saat `starting`, jangan
//   direstart: prosesnya memang belum siap.
// - Bot tidak boleh direstart hanya karena database mati. Restart tidak
//   menyambungkan kembali database, dan justru menambah beban saat outage.
// - Bot perlu direstart saat prosesnya menggantung (healthcheck gagal), saat
//   gateway putus, atau saat Lavalink sehat tetapi node bot tidak tersambung.
//   Kasus terakhir adalah yang terjadi di mesin ini: Lavalink macet, bot
//   melepas node, lalu Shoukaku menyerah dan tidak mencoba lagi.

export type TargetName = 'bot' | 'lavalink';

export interface Observation {
  ok: boolean;
  reason?: string;
}

export interface TargetState {
  failures: number;
}

export interface WatchdogState {
  bot: TargetState;
  lavalink: TargetState;
}

export interface RestartAction {
  target: TargetName;
  reason: string;
  failures: number;
}

export interface Transition {
  state: WatchdogState;
  restarts: RestartAction[];
}

export interface ReadyChecks {
  gateway?: boolean;
  lavalink?: boolean;
  database?: string;
}

export const THRESHOLD = 2;

export function emptyState(): WatchdogState {
  return { bot: { failures: 0 }, lavalink: { failures: 0 } };
}

/** Baca state dari JSON yang mungkin rusak atau ditulis versi lama. */
export function normalizeState(raw: unknown): WatchdogState {
  const failuresOf = (value: unknown): number => {
    if (typeof value !== 'object' || value === null) return 0;
    const failures = (value as { failures?: unknown }).failures;
    return typeof failures === 'number' && Number.isInteger(failures) && failures > 0
      ? failures
      : 0;
  };

  const root = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  return {
    bot: { failures: failuresOf(root.bot) },
    lavalink: { failures: failuresOf(root.lavalink) },
  };
}

export function evaluateLavalink(input: { running: boolean; health: string }): Observation {
  if (!input.running) return { ok: false, reason: 'container tidak berjalan' };
  if (input.health === 'unhealthy') return { ok: false, reason: 'healthcheck Lavalink gagal' };
  return { ok: true };
}

export function evaluateBot(input: {
  running: boolean;
  health: string;
  ready: { checks?: ReadyChecks } | null;
  lavalinkHealthy: boolean;
}): Observation {
  if (!input.running) return { ok: false, reason: 'container tidak berjalan' };

  // Selama start, healthcheck dan /ready memang belum siap. Merestart di sini
  // berarti membunuh bot yang sedang menyala normal.
  if (input.health === 'starting') return { ok: true };
  if (input.health === 'unhealthy') {
    return { ok: false, reason: 'healthcheck bot gagal (proses menggantung)' };
  }

  if (input.ready === null) return { ok: false, reason: 'GET /ready tidak menjawab' };

  const checks = input.ready.checks ?? {};
  if (checks.gateway === false) return { ok: false, reason: 'gateway Discord terputus' };

  if (checks.lavalink === false && input.lavalinkHealthy) {
    return {
      ok: false,
      reason: 'node Lavalink tidak tersambung padahal Lavalink sehat',
    };
  }

  // Database mati bukan alasan restart: hasilnya sama saja setelah restart.
  return { ok: true };
}

/**
 * Tambah hitungan kegagalan dan hasilkan aksi restart saat ambang tercapai.
 * Hitungan di-reset setelah restart supaya satu masalah tidak memicu restart
 * pada setiap pemeriksaan berikutnya tanpa henti.
 */
export function planActions(
  previous: WatchdogState,
  observations: Record<TargetName, Observation>,
  threshold = THRESHOLD,
): Transition {
  const state = emptyState();
  const restarts: RestartAction[] = [];

  for (const target of ['bot', 'lavalink'] as const) {
    const observation = observations[target];
    if (observation.ok) continue;

    const failures = previous[target].failures + 1;
    if (failures >= threshold) {
      restarts.push({
        target,
        reason: observation.reason ?? 'pemeriksaan gagal',
        failures,
      });
    } else {
      state[target].failures = failures;
    }
  }

  return { state, restarts };
}
