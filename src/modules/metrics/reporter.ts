import { getLogger } from '../../services/logger.js';
import type { KeyValueStore } from '../../services/kvStore.js';
import {
  mergeInstances,
  parseInstance,
  toInstanceMetrics,
  type FleetMetrics,
  type InstanceMetrics,
} from './fleet.js';
import type { MetricsSnapshot } from './types.js';

/**
 * Publikasi metrik tiap proses ke store bersama, lalu penjumlahan seluruh
 * laporan menjadi satu angka (PRD §11 Observability, §13 KPI).
 *
 * **Kenapa satu key, bukan satu key per proses.** Bentuk yang paling menggoda
 * adalah menulis `harmony:metrics:instance:<id>` lalu memindai semua key
 * berawalan itu saat membaca. Itu tidak bisa dilakukan di sini: `KeyValueStore`
 * hanya punya `get`, `set`, `delete`, `take`, `increment`, dan `compareAndSet`.
 * Tidak ada `scan` dan tidak ada `keys`, jadi daftar proses yang melapor
 * mustahil diketahui tanpa menulis daftarnya sendiri, dan daftar itu butuh
 * penguncian yang sama saja dengan masalah yang sedang diselesaikan.
 *
 * Karena itu dokumennya satu: satu key berisi laporan semua proses, ditulis
 * dengan baca-ubah-tulis yang dijaga `compareAndSet`. Modul ini memakai
 * operasi yang memang ada, tidak mengarang kemampuan pemindaian.
 *
 * **Proses yang mati harus hilang, bukan membekas.** TTL dokumen disegarkan
 * setiap kali ada shard yang menulis, jadi dokumennya sendiri tidak pernah
 * kedaluwarsa selama fleet hidup. Karena itu entri per proses juga membawa
 * waktu laporannya sendiri dan yang basi dibuang saat menulis maupun saat
 * membaca — kalau tidak, `harmony_fleet_instances` akan menghitung proses
 * yang sudah mati selamanya, dan grafiknya tidak akan pernah memberi tahu.
 *
 * **Kenapa retry, bukan tulis-timpa.** Dua shard yang melapor pada detik yang
 * sama akan membaca dokumen yang sama lalu menulis dua versi berbeda, dan
 * tanpa penjaga satu shard bisa hilang dari agregat tanpa ada yang melihat.
 * `compareAndSet` membuat tulisan itu gagal kalau isinya sudah berubah, jadi
 * penulisan diulang dengan isi terbaru. Kalau retry-nya habis, laporan yang
 * gagal ditulis **tidak** ditimpa paksa: satu angka yang utuh lebih berguna
 * daripada satu angka yang diam-diam kehilangan shard.
 */

/** Key dokumen agregat di store bersama. */
export const FLEET_METRICS_KEY = 'harmony:metrics:fleet';

/** Versi dokumen; ditulis supaya format yang berubah masih bisa dibaca. */
export const FLEET_DOCUMENT_VERSION = 1;

/**
 * Jeda antar laporan.
 *
 * 15 detik cukup untuk melihat proses yang hilang dalam beberapa detik setelah
 * kejadiannya, dan cukup jarang untuk tidak jadi beban store.
 */
export const DEFAULT_FLEET_REPORT_INTERVAL_MS = 15_000;

/**
 * Umur dokumen agregat.
 *
 * Kalau seluruh fleet mati, dokumennya ikut hilang bersama TTL-nya — bukan
 * menggantung sebagai angka yang sudah tidak benar. Kalau hanya satu proses
 * mati, dokumennya masih hidup karena proses lain terus menulis.
 */
export const DEFAULT_FLEET_TTL_MS = 90_000;

/**
 * Batas percobaan penulisan satu laporan.
 *
 * Cukup untuk beberapa shard berebut pada saat yang sama tanpa membuat job
 * menggantung kalau store sedang lambat.
 */
export const MAX_FLEET_PUBLISH_ATTEMPTS = 5;

/** Satu laporan proses di dalam dokumen agregat. */
export interface FleetEntry {
  instance: InstanceMetrics;
  /** Kapan proses ini terakhir menulis (ms epoch). */
  reportedAt: number;
}

/** Dokumen yang disimpan di store bersama. */
export interface FleetDocument {
  version: number;
  /** Kapan dokumen ini ditulis terakhir (ms epoch). */
  updatedAt: number;
  entries: FleetEntry[];
}

export interface FleetReporterOptions {
  /**
   * Store yang dibaca saat dipakai, atau fungsi yang mengembalikannya.
   *
   * Bentuknya fungsi dengan alasan yang sama seperti `SweepLease`: store
   * kunci-nilai baru siap setelah modul metrik dibangun, dan menangkapnya di
   * konstruktor membuat laporan ditulis ke store memori bawaan — yang terlihat
   * bekerja padahal tidak pernah sampai ke shard lain.
   */
  store: KeyValueStore | (() => KeyValueStore);
  /** ID proses ini; dipakai untuk menggantikan laporan lamanya sendiri. */
  instanceId: string;
  /** Ambil snapshot metrik proses saat laporan disusun. */
  snapshot: () => MetricsSnapshot;
  /** Jumlah guild milik shard ini; dari client Discord, bukan dari registry. */
  guildCount: () => number;
  /** Jeda antar laporan; default 15 detik. */
  intervalMs?: number;
  /** Umur dokumen agregat; default 90 detik. */
  ttlMs?: number;
  /** Jalankan sekali saat start (default true). */
  runOnStart?: boolean;
}

export interface FleetReporter {
  /** Tulis satu laporan sekarang; tidak pernah melempar. */
  runOnce(): Promise<void>;
  /** Berhenti menjadwalkan (dipanggil saat shutdown). */
  stop(): void;
}

/** Hasil satu percobaan penulisan laporan. */
export type FleetPublishOutcome =
  /** Laporan proses ini tersimpan. */
  | 'published'
  /** Bisa menyimpan, tapi lewat baca-ubah-tulis tanpa penjaga (store tanpa CAS). */
  | 'published-unguarded'
  /** Store berubah terus sampai retry habis; laporan ini tidak ditulis. */
  | 'contended'
  /** Store tidak bisa dibaca atau ditulis. */
  | 'failed';

function resolveStore(source: KeyValueStore | (() => KeyValueStore)): KeyValueStore {
  return typeof source === 'function' ? source() : source;
}

/** Dokumen kosong; dasar semua jalur yang gagal. */
export function emptyFleetDocument(now: number): FleetDocument {
  return { version: FLEET_DOCUMENT_VERSION, updatedAt: now, entries: [] };
}

/**
 * Susun dokumen agregat berisi laporan ini.
 *
 * Laporan proses ini **menggantikan** miliknya yang lama, bukan ditumpuk:
 * tanpa itu, tiap laporan akan menambah satu entri lagi dan jumlah proses
 * akan naik terus walau hanya ada satu shard.
 */
export function buildFleetDocument(
  current: FleetDocument,
  instance: InstanceMetrics,
  now: number,
  ttlMs: number = DEFAULT_FLEET_TTL_MS,
): FleetDocument {
  const entries = current.entries.filter((entry) => entry.instance.instanceId !== instance.instanceId);
  entries.push({ instance, reportedAt: now });

  // Laporan yang basi dibuang di sini, bukan karena dokumennya kedaluwarsa.
  // TTL dokumen disegarkan setiap kali proses lain menulis, jadi dokumennya
  // tidak pernah hilang selama ada satu pun shard hidup — dan tanpa prune
  // di sini, shard yang sudah mati akan tetap ikut dihitung selamanya.
  // `instances` yang tidak pernah turun adalah justru kebohongan yang
  // paling sulit disadari: grafiknya terlihat normal.
  return {
    version: FLEET_DOCUMENT_VERSION,
    updatedAt: now,
    entries: pruneStaleEntries(entries, now, ttlMs),
  };
}

/**
 * Buang laporan yang sudah basi: proses yang berhenti melapor lebih dari
 * `ttlMs` lalu tidak ikut dihitung.
 *
 * Satu definisi untuk penyaringan ini, dipakai penulisan dan pembacaan.
 * Kalau hanya penulisan yang menyaring, pembacaan masih bisa menghitung
 * proses mati selama jendela antara dua laporan — dan dua angka untuk
 * keadaan yang sama.
 *
 * Jam yang lebih lambat ke depan tidak salah: selisihnya negatif, jadi
 * laporan itu dipertahankan. Jam yang lebih cepat bisa membuang laporan
 * shard lain sedikit lebih awal — itu konsekuensi jam antar proses, dan
 * lebih baik daripada membiarkan proses mati tidak pernah hilang.
 */
export function pruneStaleEntries(
  entries: readonly FleetEntry[],
  now: number,
  ttlMs: number,
): FleetEntry[] {
  return entries.filter((entry) => now - entry.reportedAt <= ttlMs);
}

/** Serialisasi dokumen agregat. */
export function encodeFleetDocument(document: FleetDocument): string {
  return JSON.stringify(document);
}

/**
 * Baca dokumen agregat. Toleran: bentuk yang salah dibaca sebagai dokumen
 * kosong, bukan sebagai kegagalan.
 *
 * Alasannya sama seperti codec satu proses: isinya ditulis proses lain dan
 * bisa ditulis versi kode lain. Menolaknya akan membuat satu shard dengan data
 * rusak mematikan angka KPI untuk seluruh fleet.
 */
export function decodeFleetDocument(raw: string | null): FleetDocument {
  if (raw === null) return emptyFleetDocument(0);

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return emptyFleetDocument(0);
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return emptyFleetDocument(0);
  }

  const source = parsed as Record<string, unknown>;
  const rawEntries = Array.isArray(source.entries) ? source.entries : [];
  const entries: FleetEntry[] = [];

  for (const rawEntry of rawEntries) {
    if (typeof rawEntry !== 'object' || rawEntry === null || Array.isArray(rawEntry)) continue;
    const holder = rawEntry as Record<string, unknown>;
    const instance = parseInstance(holder.instance);
    if (!instance) continue;

    const reportedAt = holder.reportedAt;
    entries.push({
      instance,
      reportedAt: typeof reportedAt === 'number' && Number.isFinite(reportedAt) ? reportedAt : 0,
    });
  }

  const updatedAt = source.updatedAt;
  return {
    version: FLEET_DOCUMENT_VERSION,
    updatedAt: typeof updatedAt === 'number' && Number.isFinite(updatedAt) ? updatedAt : 0,
    entries,
  };
}

/**
 * Baca agregat seluruh proses yang masih melapor.
 *
 * Tidak pernah melempar: pemanggilnya adalah endpoint `/metrics`, dan angka
 * proses harus tetap bisa dibaca walau store bersama sedang tidak bisa
 * dihubungi. Yang dikembalikan saat gagal adalah agregat nol yang jujur
 * (`instances: 0`), bukan angka yang menebak.
 */
export async function collectFleetMetrics(
  store: KeyValueStore,
  options: { now?: number; ttlMs?: number } = {},
): Promise<FleetMetrics> {
  const logger = getLogger();
  const now = options.now ?? Date.now();
  const ttlMs = options.ttlMs ?? DEFAULT_FLEET_TTL_MS;

  try {
    const document = decodeFleetDocument(await store.get(FLEET_METRICS_KEY));
    const fresh = pruneStaleEntries(document.entries, now, ttlMs);
    return mergeInstances(fresh.map((entry) => entry.instance));
  } catch (error) {
    logger.warn({ err: error }, 'Agregat metrik lintas shard gagal dibaca');
    return mergeInstances([]);
  }
}

/**
 * Tulis laporan proses ini ke dokumen agregat.
 *
 * Mengembalikan `contended` kalau store berubah terus sampai retry habis. Itu bukan
 * kondisi yang perlu dibunyikan sebagai error: laporan berikutnya dalam 15
 * detik akan menulis ulang angkanya, jadi yang hilang cuma satu titik waktu.
 */
export async function publishFleetReport(
  store: KeyValueStore,
  instance: InstanceMetrics,
  now: number,
  ttlMs: number = DEFAULT_FLEET_TTL_MS,
): Promise<FleetPublishOutcome> {
  const logger = getLogger();
  const compareAndSet = store.compareAndSet;

  if (!compareAndSet) {
    // Tanpa penjaga, dua proses yang melapor bersamaan menimpa satu sama lain
    // dan satu shard hilang dari agregat. Menulis tetap dilakukan — lebih baik
    // angka yang mungkin kurang satu shard daripada tidak ada angka sama
    // sekali — tapi diberi tahu supaya tidak dibaca sebagai angka yang dijamin.
    try {
      const current = decodeFleetDocument(await store.get(FLEET_METRICS_KEY));
      const next = buildFleetDocument(current, instance, now, ttlMs);
      await store.set(FLEET_METRICS_KEY, encodeFleetDocument(next), {
        ttlMs,
      });
      logger.debug('Laporan metrik ditulis tanpa compareAndSet — agregat bisa kehilangan satu proses');
      return 'published-unguarded';
    } catch (error) {
      logger.warn({ err: error }, 'Laporan metrik lintas shard gagal ditulis');
      return 'failed';
    }
  }

  for (let attempt = 1; attempt <= MAX_FLEET_PUBLISH_ATTEMPTS; attempt += 1) {
    try {
      const raw = await store.get(FLEET_METRICS_KEY);
      const next = encodeFleetDocument(buildFleetDocument(decodeFleetDocument(raw), instance, now, ttlMs));
      const written = await compareAndSet.call(store, FLEET_METRICS_KEY, next, {
        expectedValue: raw,
        ttlMs,
      });

      if (written) return 'published';
      logger.debug({ attempt }, 'Dokumen metrik berubah saat ditulis — mengulang');
    } catch (error) {
      logger.warn({ err: error }, 'Laporan metrik lintas shard gagal ditulis');
      return 'failed';
    }
  }

  logger.warn(
    { attempts: MAX_FLEET_PUBLISH_ATTEMPTS },
    'Dokumen metrik berubah terus — laporan proses ini belum masuk agregat',
  );
  return 'contended';
}

/**
 * Job yang menulis laporan metrik proses ini secara berkala.
 *
 * Keamanannya sama seperti probe latensi dan job retensi:
 * - timer di-`unref()` sehingga tidak pernah menahan proses keluar;
 * - laporan yang masih berjalan tidak diganggu laporan berikutnya;
 * - kegagalan hanya jadi peringatan, dan bot tidak pernah gagal karena metrik.
 */
export function startFleetReporter(options: FleetReporterOptions): FleetReporter {
  const logger = getLogger();
  const intervalMs = options.intervalMs ?? DEFAULT_FLEET_REPORT_INTERVAL_MS;
  const ttlMs = options.ttlMs ?? DEFAULT_FLEET_TTL_MS;
  let running = false;

  const runOnce = async (): Promise<void> => {
    if (running) {
      logger.debug('Laporan metrik dilewati — laporan sebelumnya masih jalan');
      return;
    }

    running = true;
    try {
      const store = resolveStore(options.store);
      const instance = toInstanceMetrics(options.snapshot(), {
        instanceId: options.instanceId,
        guildCount: options.guildCount(),
      });

      const outcome = await publishFleetReport(store, instance, Date.now(), ttlMs);
      if (outcome === 'published') {
        logger.debug({ instanceId: options.instanceId }, 'Laporan metrik lintas shard ditulis');
      }
    } catch (error) {
      // Metrik tidak boleh menjatuhkan bot: laporan yang gagal ditulis hanya
      // berarti angka agregat satu titik waktu lebih tua.
      logger.warn({ err: error }, 'Laporan metrik lintas shard gagal dijalankan');
    } finally {
      running = false;
    }
  };

  if (options.runOnStart !== false) {
    void runOnce();
  }

  let timer: NodeJS.Timeout | undefined;

  if (intervalMs > 0) {
    timer = setInterval(() => {
      void runOnce();
    }, intervalMs);
    timer.unref();
  }

  return {
    runOnce,
    stop(): void {
      if (timer) clearInterval(timer);
      logger.debug('Job laporan metrik lintas shard dihentikan');
    },
  };
}
