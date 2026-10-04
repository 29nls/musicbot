import type { KeyValueStoreHandle } from '../services/kvStore.js';

/**
 * Gerbang sharding (PRD §5.3 dan §11 "Skalabilitas").
 *
 * **Sharding di sini berarti banyak proses, bukan banyak socket dalam satu
 * proses.** Itu bukan pilihan gaya: kalau satu proses memegang seluruh shard,
 * seluruh pekerjaan lintas proses yang sudah selesai — rate limit, cache
 * perintah custom, session `/search`, antrean musik, lease kepemilikan player —
 * jadi tidak berguna, karena memang hanya ada satu penulisnya. Yang bertambah
 * cuma jumlah koneksi websocket di dalam satu proses yang sama.
 *
 * Karena itu pembagian shard harus dinyatakan, bukan ditebak.
 * `DISCORD_MAX_SHARDS` menyatakan totalnya, `DISCORD_SHARD_LIST` menyatakan
 * bagian proses ini. Tanpa itu, dua proses dengan `.env` yang sama akan
 * sama-sama menyambungkan setiap guild, dan bot baru menabrak dirinya sendiri
 * saat player sebuah guild sedang dipegang lease proses lain — gejalanya
 * "antrean kosong" dan "lagu tidak diputar" yang tidak pernah menunjuk ke
 * penyebabnya.
 *
 * **Gerbangnya fail fast.** Menolak start lebih jujur daripada menjalankan bot
 * yang merusak state diam-diam. Batasnya dinyatakan terang: berkas ini hanya
 * membuktikan bahwa konfigurasi sharding *boleh* dipakai, bukan bahwa sharding
 * sudah diuji dengan dua proses sungguhan.
 */

/** Driver store kunci-nilai yang dipakai proses ini. */
export type ShardingDriver = KeyValueStoreHandle['driver'];

export interface ShardingInputs {
  /** Jumlah shard total. 1 berarti satu proses, tanpa pembagian. */
  maxShards: number;
  /** Shard yang dipegang proses ini, atau `null` kalau daftarnya belum diisi. */
  shardList: readonly number[] | null;
  /** Driver store kunci-nilai yang benar-benar dipakai, bukan yang diharapkan. */
  driver: ShardingDriver;
}

/** Opsi sharding siap pakai untuk `ClientOptions`. */
export interface ShardPlan {
  /**
   * Total shard.
   *
   * Harus diteruskan apa adanya ke `shardCount`, kalau tidak penempatan guild
   * bergeser dan guild bisa dilayani shard yang tidak menjalankan apa pun.
   */
  total: number;
  /** Shard milik proses ini. */
  ids: readonly number[];
}

/** Kesalahan konfigurasi sharding; pesannya cukup jelas tanpa stack trace. */
export class ShardingConfigError extends Error {
  public override readonly name = 'ShardingConfigError';
}

/**
 * Baca `DISCORD_SHARD_LIST` jadi nomor shard.
 *
 * Bentuknya `0,2,3`, spasi di sekitar koma diterima. String kosong atau belum
 * diisi berarti `null`, yaitu "proses ini memegang semuanya" — yang hanya boleh
 * terjadi saat `DISCORD_MAX_SHARDS=1`.
 *
 * **Entri rusak dilempar, bukan dibuang.** Shard yang diam-diam hilang dari
 * daftar tidak akan pernah tersambung, jadi server-servernya gelap tanpa satu
 * pun pesan error. Pada skala ribuan server, satu shard hilang jauh lebih sulit
 * dicari daripada konfigurasi yang menolak start.
 *
 * Duplikat dibuang, jadi shard 0 yang disebut dua kali tetap satu shard.
 * Nomor di luar rentang ditolak, karena hampir selalu salah ketik.
 */
export function parseShardList(raw: string | undefined | null, maxShards: number): number[] | null {
  if (typeof raw !== 'string') return null;

  const trimmed = raw.trim();
  if (trimmed === '') return null;

  const ids: number[] = [];
  for (const piece of trimmed.split(',')) {
    const token = piece.trim();
    if (token === '') {
      throw new ShardingConfigError(
        `DISCORD_SHARD_LIST="${trimmed}" berisi entri kosong. Bentuknya nomor shard dipisah koma, contoh: DISCORD_SHARD_LIST=0,1`,
      );
    }

    const id = Number(token);
    if (!Number.isInteger(id)) {
      throw new ShardingConfigError(
        `DISCORD_SHARD_LIST="${trimmed}" bukan daftar nomor shard. Contoh yang benar: 0,1`,
      );
    }
    if (id < 0 || id >= maxShards) {
      throw new ShardingConfigError(
        `DISCORD_SHARD_LIST="${trimmed}" menyebut shard ${id}, padahal DISCORD_MAX_SHARDS=${maxShards} hanya punya shard 0 sampai ${maxShards - 1}.`,
      );
    }

    if (!ids.includes(id)) ids.push(id);
  }

  return ids;
}

/**
 * Alasan sharding ditolak, atau `null` kalau konfigurasinya boleh dipakai.
 *
 * Ada dua syarat, dan keduanya menjawab pertanyaan yang sama: apakah state-nya
 * benar-benar terbagi antar proses. Store bersama harus hidup, dan tiap proses
 * harus menyebut shard-nya. Satu shard selalu boleh — tanpa proses kedua, store
 * per proses sama saja dengan store bersama.
 */
export function shardingBlockReason(inputs: ShardingInputs): string | null {
  if (inputs.maxShards <= 1) return null;

  if (inputs.driver !== 'redis') {
    return (
      `DISCORD_MAX_SHARDS=${inputs.maxShards} butuh Redis yang hidup, tapi store kunci-nilai jatuh ke ${inputs.driver}. ` +
      'Tanpa store bersama, rate limit, antrean, dan lease kepemilikan player hanya berlaku per proses — ' +
      'persis yang membuat sharding belum aman.'
    );
  }

  if (inputs.shardList === null) {
    return (
      `DISCORD_MAX_SHARDS=${inputs.maxShards} tanpa DISCORD_SHARD_LIST berarti setiap proses akan menyambungkan seluruh shard, ` +
      'jadi setiap guild terhubung dua kali dari token yang sama. ' +
      `Isi shard milik proses ini, contoh: DISCORD_SHARD_LIST=0 sampai ${inputs.maxShards - 1}.`
    );
  }

  return null;
}

/** Lempar kalau sharding diminta tanpa store bersama atau tanpa pembagian shard. */
export function assertShardingReady(inputs: ShardingInputs): void {
  const reason = shardingBlockReason(inputs);
  if (!reason) return;

  throw new ShardingConfigError(reason);
}

/**
 * Opsi sharding untuk `ClientOptions`, atau `null` kalau tidak ada yang perlu
 * diteruskan.
 *
 * Mengembalikan `null` dan bukan `{ total: 1, ids: [0] }` disengaja: tanpa
 * opsi `shards`, discord.js memakai jalur gateway token tunggal seperti
 * sebelumnya, jadi ada satu jalur yang sudah terbukti benar dan tidak ikut
 * berubah setiap kali sharding diubah.
 *
 * **Daftar yang belum diisi juga menghasilkan `null`, bukan daftar lengkap.**
 * Tanpa itu fungsi ini akan mengarang rencana yang justru ditolak
 * `shardingBlockReason`, jadi dua sumber kebenaran saling bertentangan soal
 * konfigurasi yang sama. Operator yang memang ingin satu proses memegang
 * semuanya menyatakannya terus terang lewat `DISCORD_SHARD_LIST=0,1,2,3`.
 */
export function resolveShardPlan(inputs: {
  maxShards: number;
  shardList: readonly number[] | null;
}): ShardPlan | null {
  if (inputs.maxShards <= 1) return null;
  if (inputs.shardList === null) return null;

  return { total: inputs.maxShards, ids: [...inputs.shardList] };
}