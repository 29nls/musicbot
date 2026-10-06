// Kanal invalidasi konfigurasi lintas proses.
//
// Kenapa ada: cache konfigurasi hidup per proses dengan TTL 60 detik, jadi
// perubahan yang ditulis proses lain (dashboard web) baru terlihat setelah
// cache-nya kedaluwarsa. Untuk dashboard itu tidak cukup — perubahannya harus
// berlaku tanpa restart bot, dan itu hanya bisa kalau proses bot diberi tahu.
//
// Yang sengaja TIDAK ada di berkas ini: impor service apa pun. Modul ini murni
// (encode, decode, publish, langganan), supaya bisa diuji tanpa Redis dan tanpa
// memuat seluruh bot. Penyambungannya ke lima cache ada di
// `invalidasiWiring.ts`, dan wiring ke proses ada di `src/index.ts`.
//
// Batas yang harus jujur diketahui: kanal ini satu arah dan best-effort. Kalau
// pesannya hilang (Redis sempat mati setelah publish berhasil), cache lama
// tetap dipakai sampai TTL 60 detik habis. Itu sebabnya dashboard menolak
// menulis saat Redis mati (D3), bukan sekadar mencatat peringatan.

import type { KeyValueStore } from '../../services/kvStore.js';

/** Satu kanal untuk semua guild; guildId ada di dalam pesannya. */
export const CONFIG_CHANGED_CHANNEL = 'harmony:config:changed';

/** Batas jumlah nama field yang boleh ikut dalam satu pesan. */
export const MAX_CHANGED_FIELDS = 50;

/** Batas panjang nama field; field `modules.*` tetap di bawah ini. */
const MAX_FIELD_LENGTH = 60;

export interface ConfigChangedPayload {
  /** Guild yang konfigurasinya berubah. */
  guildId: string;
  /**
   * Nama field yang berubah, untuk catatan diagnostik.
   *
   * Bot sengaja membuang **seluruh** cache guild itu, bukan hanya field yang
   * disebut: cache konfigurasi menyimpan satu baris utuh, jadi tidak ada cara
   * membuang sebagian tanpa membaca ulang dari database — dan membaca ulang itu
   * justru yang ingin dihindari.
   */
  fields: string[];
  /** Siapa yang menerbitkan; hanya untuk log. */
  source: string;
  /** Waktu terbit dalam ISO; hanya untuk log. */
  at: string;
}

export interface ConfigChangedTargets {
  config: (guildId: string) => void | Promise<void>;
  locale: (guildId: string) => void | Promise<void>;
  automod: (guildId: string) => void | Promise<void>;
  logging: (guildId: string) => void | Promise<void>;
  customCommands: (guildId: string) => void | Promise<void>;
}

/**
 * Nama target yang benar-benar akan dipanggil.
 *
 * Daftarnya eksplisit, bukan `Object.keys(targets)`: dengan `Object.keys`, satu
 * properti bantu yang ikut terpasang di objek target (mis. penghitung di tes,
 * atau penanda diagnostik di kemudian hari) akan ikut dipanggil sebagai fungsi
 * dan gagalnya tercatat sebagai "cache gagal dibuang" padahal bukan. Daftar
 * eksplisit juga membuat target yang tertinggal ketahuan lewat tipe.
 */
export const INVALIDATION_TARGET_NAMES = [
  'config',
  'locale',
  'automod',
  'logging',
  'customCommands',
] as const satisfies readonly (keyof ConfigChangedTargets)[];

export type InvalidationErrorReporter = (target: keyof ConfigChangedTargets, error: unknown) => void;
export type InvalidationIgnoredReporter = (raw: string) => void;

const SNOWFLAKE = /^\d{17,20}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Rakit pesan. Field di luar bentuk yang dikenal dibuang, bukan diteruskan. */
export function encodeConfigChanged(payload: ConfigChangedPayload): string {
  const fields = payload.fields
    .filter((field) => typeof field === 'string' && field.length > 0 && field.length <= MAX_FIELD_LENGTH)
    .slice(0, MAX_CHANGED_FIELDS);

  return JSON.stringify({
    guildId: payload.guildId,
    fields,
    source: payload.source,
    at: payload.at,
  });
}

/**
 * Baca pesan. `null` berarti pesan ditolak dan pemanggil harus mengabaikannya.
 *
 * Pesan datang dari proses lain (dan Redis adalah batas kepercayaan), jadi
 * semuanya diperiksa: bentuk JSON, guildId yang memang snowflake, dan panjang
 * daftar field. Pesan rusak tidak boleh melempar ke pemanggil — satu pesan
 * sampah tidak boleh mematikan langganan.
 */
export function decodeConfigChanged(raw: string): ConfigChangedPayload | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!isRecord(parsed)) return null;

  const { guildId, fields, source, at } = parsed;
  if (typeof guildId !== 'string' || !SNOWFLAKE.test(guildId)) return null;

  const list = Array.isArray(fields)
    ? fields
        .filter((field): field is string => typeof field === 'string' && field.length > 0 && field.length <= MAX_FIELD_LENGTH)
        .slice(0, MAX_CHANGED_FIELDS)
    : [];

  return {
    guildId,
    fields: list,
    source: typeof source === 'string' && source.length <= 40 ? source : 'tidak-diketahui',
    at: typeof at === 'string' && at.length <= 40 ? at : '',
  };
}

/**
 * Terbitkan perubahan konfigurasi.
 *
 * `false` berarti kanal ini tidak tersedia (store memori, atau klien tanpa
 * PUBLISH). Pemanggil — dashboard — memakai jawaban itu untuk menolak menulis,
 * karena menulis perubahan yang tidak akan berlaku adalah kebohongan.
 */
export async function publishConfigChanged(
  store: KeyValueStore,
  payload: ConfigChangedPayload,
): Promise<boolean> {
  if (typeof store.publish !== 'function') return false;

  try {
    return await store.publish(CONFIG_CHANGED_CHANNEL, encodeConfigChanged(payload));
  } catch {
    // Redis mati di tengah jalan: sama seperti tidak punya kanal.
    return false;
  }
}

/**
 * Buat penangan pesan yang membuang cache guild tersebut.
 *
 * Tiap target dipanggil berurutan dan kegagalannya dipisah: satu cache yang
 * gagal dibuang (mis. cache automod belum pernah dibangun) tidak boleh
 * mencegah cache lain dibuang. Karena itu error diteruskan ke pelapor, bukan
 * dilempar keluar.
 */
export function createConfigChangedHandler(
  targets: ConfigChangedTargets,
  report: { onError?: InvalidationErrorReporter; onIgnored?: InvalidationIgnoredReporter } = {},
): (raw: string) => Promise<void> {
  return async (raw: string): Promise<void> => {
    const payload = decodeConfigChanged(raw);
    if (!payload) {
      report.onIgnored?.(raw);
      return;
    }

    for (const name of INVALIDATION_TARGET_NAMES) {
      try {
        await targets[name](payload.guildId);
      } catch (error) {
        report.onError?.(name, error);
      }
    }
  };
}

/**
 * Berlangganan kanal invalidasi. `null` kalau store tidak bisa berlangganan.
 *
 * Pemanggil menerima `null` sebagai jawaban jujur "proses ini tidak akan
 * menerima pemberitahuan", bukan sebagai error: store memori memang tidak
 * punya kanal lintas proses, dan bot tetap benar (hanya kembali ke TTL).
 */
export async function subscribeConfigChanged(
  store: KeyValueStore,
  handler: (raw: string) => Promise<void> | void,
): Promise<(() => Promise<void>) | null> {
  if (typeof store.subscribe !== 'function') return null;

  return store.subscribe(CONFIG_CHANGED_CHANNEL, (message: string) => {
    void handler(message);
  });
}
