import type {
  InteractionCounters,
  InteractionKind,
  LavalinkMetrics,
  MetricsSnapshot,
} from './types.js';

/**
 * Agregasi metrik lintas shard (PRD §11 Observability, §13 KPI).
 *
 * **Masalahnya.** Angka metrik sengaja kumulatif sejak proses start, supaya
 * restart tidak bisa menghapus kegagalannya. Tapi begitu bot berjalan di
 * beberapa proses (§5.3 sharding), tiap proses punya registry sendiri, jadi
 * `harmony_command_error_rate` yang jadi KPI §13 cuma milik satu shard.
 * Bot dengan empat shard bisa melaporkan 0,1% di satu endpoint dan 3% di
 * tiga lainnya, dan tidak ada yang bisa melihat bahwa itu satu angka yang
 * salah.
 *
 * **Yang dijumlahkan, dan yang tidak.** Guild, lagu, dan interaksi dijumlahkan
 * — itu penghitung yang menambah. Uptime **tidak** dijumlahkan: dijumlahkan
 * jadi angka yang tidak berarti. Yang dipakai untuk fleet adalah uptime
 * proses tertua, karena itulah berapa lama bot benar-benar hidup tanpa
 * restart total. Latensi Lavalink juga tidak dijumlahkan: yang ditulis
 * adalah terburuk antar proses, karena itulah yang dirasakan user.
 *
 * **Batas yang harus diketahui pembaca:** sebuah proses yang mati mendadak
 * berhenti menulis, lalu namanya hilang dari agregat setelah dokumennya
 * kedaluwarsa. Itu bukan bug yang bisa hilang — data yang tidak pernah
 * terkirim memang tidak bisa dijumlahkan. Yang bisa dilakukan adalah
 * menyatakannya: `harmony_fleet_instances` selalu ditulis, jadi pembaca bisa
 * tahu agregat ini mencakup berapa proses. Kalau angkanya turun, itu karena
 * ada proses yang hilang, dan itu justru informasi yang dicari.
 *
 * **Batas kedua, yang lebih halus:** penghitung bersifat kumulatif sejak
 * proses start, jadi proses yang restart membawa angka dari nol sementara
 * laporan lamanya masih belum kedaluwarsa. Selama keduanya masih melapor,
 * agregat menghitung dua masa hidup sebagai satu. Ini konsekuensi dari
 * penghitung kumulatif yang memang dipakai untuk KPI §13, dan menyebutnya di
 * sini jauh lebih jujur daripada membiarkan angka diam-diam dobel sebentar.
 */

const KINDS: readonly InteractionKind[] = ['command', 'component', 'message'];

/** Yang ditulis satu proses ke store bersama. */
export interface InstanceMetrics {
  instanceId: string;
  uptimeSeconds: number;
  guildCount: number;
  tracksPlayed: number;
  interactions: Record<InteractionKind, { total: number; errors: number }>;
  lavalink: LavalinkMetrics;
}

export interface FleetCounters {
  total: number;
  errors: number;
  errorRate: number;
}

/** Hasil penjumlahan seluruh proses yang masih melapor. */
export interface FleetMetrics {
  /** Berapa proses yang ikut dijumlahkan. */
  instances: number;
  /** Uptime proses tertua: berapa lama bot hidup tanpa restart total. */
  uptimeSeconds: number;
  guildCount: number;
  tracksPlayed: number;
  interactions: Record<InteractionKind, FleetCounters>;
  commandErrorRate: number;
  lavalink: {
    /** Berapa proses yang node Lavalink-nya menjawab sample terakhir. */
    reachable: number;
    /** Berapa proses yang tidak menjawab. */
    unreachable: number;
    /** Latensi terburuk antar proses; null kalau tak satu pun punya sample. */
    worstLatencyMs: number | null;
    /** Sample terakhir dari proses mana pun, untuk tahu seberapa baru angka ini. */
    sampledAt: number | null;
  };
}

/**
 * Jumlahkan seluruh laporan proses.
 *
 * Murni: tidak menyentuh jam, jaringan, maupun store. Daftar kosong memberi
 * hasil yang jelas (nol, nol proses) supaya pemanggil bisa membedakannya dari
 * "agregat gagal dibaca" tanpa harus gagal membacanya juga.
 */
export function mergeInstances(instances: readonly InstanceMetrics[]): FleetMetrics {
  const interactions = {
    command: emptyCounters(),
    component: emptyCounters(),
    message: emptyCounters(),
  };
  let guildCount = 0;
  let tracksPlayed = 0;
  let uptimeSeconds = 0;
  let reachable = 0;
  let unreachable = 0;
  let worstLatencyMs: number | null = null;
  let sampledAt: number | null = null;

  for (const instance of instances) {
    guildCount += instance.guildCount;
    tracksPlayed += instance.tracksPlayed;
    // Uptime maksimum, bukan jumlah: proses tertua yang menentukan berapa
    // lama bot hidup tanpa satu pun restart.
    uptimeSeconds = Math.max(uptimeSeconds, instance.uptimeSeconds);

    for (const kind of KINDS) {
      const counters = instance.interactions[kind];
      if (!counters) continue;
      interactions[kind].total += counters.total;
      interactions[kind].errors += counters.errors;
    }

    if (instance.lavalink.connected) reachable += 1;
    else unreachable += 1;

    const latency = instance.lavalink.latencyMs;
    if (latency !== null && Number.isFinite(latency)) {
      worstLatencyMs = worstLatencyMs === null ? latency : Math.max(worstLatencyMs, latency);
    }
    const seen = instance.lavalink.sampledAt;
    if (seen !== null && Number.isFinite(seen)) {
      sampledAt = sampledAt === null ? seen : Math.max(sampledAt, seen);
    }
  }

  for (const kind of KINDS) {
    const counters = interactions[kind];
    counters.errorRate = counters.total === 0 ? 0 : counters.errors / counters.total;
  }

  return {
    instances: instances.length,
    uptimeSeconds,
    guildCount,
    tracksPlayed,
    interactions,
    commandErrorRate: interactions.command.errorRate,
    lavalink: { reachable, unreachable, worstLatencyMs, sampledAt },
  };
}

function emptyCounters(): FleetCounters {
  return { total: 0, errors: 0, errorRate: 0 };
}

/**
 * Baca satu instance dari nilai yang sudah di-parse. Toleran: bentuk yang
 * salah dibaca sebagai "proses ini tidak melapor", bukan sebagai kegagalan.
 *
 * Nilainya datang dari store bersama, jadi bisa ditulis proses lain atau
 * versi kode lain. Menolaknya akan mematikan seluruh agregat hanya karena
 * satu proses punya data yang tidak berbentuk.
 *
 * Toleransi ini tidak opsional: angka yang hilang karena satu baris rusak
 * lebih buruk daripada angka yang tidak ada, karena yang hilang diam-diam.
 */
export function parseInstance(value: unknown): InstanceMetrics | null {
  if (!isRecord(value)) return null;
  const id = readString(value.instanceId);
  if (id === null) return null;

  return {
    instanceId: id,
    uptimeSeconds: readNumber(value.uptimeSeconds) ?? 0,
    guildCount: readNumber(value.guildCount) ?? 0,
    tracksPlayed: readNumber(value.tracksPlayed) ?? 0,
    interactions: readInteractions(value.interactions),
    lavalink: readLavalink(value.lavalink),
  };
}

function readInteractions(value: unknown): Record<InteractionKind, { total: number; errors: number }> {
  const source = isRecord(value) ? value : {};
  const out = {} as Record<InteractionKind, { total: number; errors: number }>;

  for (const kind of KINDS) {
    const entry = isRecord(source[kind]) ? (source[kind] as Record<string, unknown>) : {};
    const total = Math.max(0, readNumber(entry.total) ?? 0);
    const errors = Math.max(0, readNumber(entry.errors) ?? 0);
    // Kesalahan lebih besar dari total tidak mungkin terjadi; kalau terjadi,
    // artifaknya lebih baik dibatasi daripada ditulis apa adanya karena
    // membuat error rate di atas 1 yang tidak pernah dibaca orang.
    out[kind] = { total, errors: Math.min(errors, total) };
  }

  return out;
}

function readLavalink(value: unknown): LavalinkMetrics {
  const source = isRecord(value) ? value : {};
  const latencyMs = readNumber(source.latencyMs);
  const sampledAt = readNumber(source.sampledAt);

  return {
    connected: source.connected === true,
    latencyMs: latencyMs === null ? null : Math.max(0, latencyMs),
    sampledAt: sampledAt === null ? null : sampledAt,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
/**
 * Ubah snapshot metrik proses menjadi laporan yang bisa dikirim ke store.
 *
 * Satu definisi tunggal untuk pemetaan ini, dipakai oleh job pelapor dan tes.
 * Kalau pemetaan ini ditulis ulang di tempat lain, cepat atau lambat satu sisi
 * akan menghitung ulang `errorRate` dengan cara sendiri — dan dua sisi agregat
 * yang terlihat benar bisa menyimpan angka yang berbeda.
 *
 * `commandErrorRate` sengaja **tidak** ikut disalin: laporan per proses hanya
 * membawa penghitung mentah, dan tingkat error dihitung ulang saat penjumlahan.
 * Kalau tidak begitu, satu sisi bisa melaporkan tingkat error yang tidak sama
 * dengan penjumlahan penghitungnya, dan KPI §13 jadi dua angka dalam satu metrik.
 */
export function toInstanceMetrics(
  snapshot: MetricsSnapshot,
  context: { instanceId: string; guildCount: number },
): InstanceMetrics {
  return {
    instanceId: context.instanceId,
    uptimeSeconds: snapshot.uptimeSeconds,
    guildCount: context.guildCount,
    tracksPlayed: snapshot.tracksPlayed,
    interactions: {
      command: rawCounters(snapshot.interactions.command),
      component: rawCounters(snapshot.interactions.component),
      message: rawCounters(snapshot.interactions.message),
    },
    lavalink: {
      connected: snapshot.lavalink.connected,
      latencyMs: snapshot.lavalink.latencyMs,
      sampledAt: snapshot.lavalink.sampledAt,
    },
  };
}

/** Ambil penghitung mentah; `errorRate` dihitung ulang saat agregat. */
function rawCounters(counters: InteractionCounters): { total: number; errors: number } {
  return { total: counters.total, errors: counters.errors };
}
