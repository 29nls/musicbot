import type { KeyValueStore } from './kvStore.js';

/**
 * Lease untuk job yang hasilnya global, bukan per guild (PRD §5.3 dan §11).
 *
 * **Kenapa ini perlu.** Job retensi menghapus baris yang lewat masa berlaku dari
 * seluruh database, tanpa memilih guild. Sapuan 24/7 dan panel expiry punya
 * bentuk lain: keduanya membaca `client.guilds.cache`, yang isinya sudah hanya
 * guild milik shard ini. Jadi begitu bot berjalan di beberapa proses, job
 * retensi berjalan di tiap proses sekaligus — database dipanggil N kali untuk
 * pekerjaan yang sama, lalu tiap proses melaporkan angka yang berbeda: satu
 * bilang "120 kasus dihapus", yang lain bilang "0 kasus dihapus", padahal
 * tidak ada yang hilang di antaranya.
 *
 * **Lease, bukan pembagian guild.** Membagi job per guild kedengarannya lebih
 * bersih, tapi penghapusan memfilter hanya lewat tanggal, sehingga membatasi
 * per guild berarti daftar `guildId` yang harus dikirim ke tiap DELETE.
 * Lease lebih jujur soal batasnya: satu proses menjalankan sapuan, sisanya
 * melompat, dan hasilnya tetap satu angka yang bisa dipercaya.
 */

/** Awalan key lease sapuan di store bersama. */
export const SWEEP_LEASE_KEY_PREFIX = 'harmony:sweep-lease:';

/** Key lease untuk satu nama job, misalnya `retention`. */
export function sweepLeaseKey(name: string): string {
  return `${SWEEP_LEASE_KEY_PREFIX}${name}`;
}

/** Hasil perebutan lease. */
export type SweepLeaseClaim = 'acquired' | 'renewed' | 'foreign';

/**
 * Store yang dibaca saat dipakai, atau fungsi yang mengembalikannya.
 *
 * Formanya fungsi supaya pemanggil boleh menulis `() => getKeyValueStore()`.
 * Modul ini bisa dibangun sebelum store kunci-nilai proses selesai dibuat, dan
 * kalau store-nya ditangkap saat konstruksi, lease tertangkap store memori
 * bawaan — yang membuat lease terlihat bekerja padahal tidak menahan apa pun.
 */
export type SweepLeaseStore = KeyValueStore | (() => KeyValueStore);

/**
 * Lease "jalankan sapuan ini di tepat satu proses".
 *
 * Berbeda dari `PlayerOwnership`, yang menjaga satu guild: yang dijaga di sini
 * satu pekerjaan, jadi yang ditanya bukan guild siapa, tapi proses mana.
 */
export class SweepLease {
  constructor(
    private readonly storeSource: SweepLeaseStore,
    private readonly name: string,
    private readonly holderId: string,
    private readonly ttlMs: number,
  ) {}

  /** Store yang dipakai sekarang; fungsi diselesaikan saat ini juga. */
  private get store(): KeyValueStore {
    const source = this.storeSource;
    return typeof source === 'function' ? source() : source;
  }

  /**
   * True kalau store ini bisa menegakkan satu pemilik.
   *
   * Tanpa `compareAndSet` tidak ada yang bisa dijamin, jadi lease dinonaktifkan
   * seluruhnya, alih-alih memberi jaminan palsu. Satu shard memang tidak
   * butuh ini: pemanggil tinggal menjalankan sapuannya tanpa penguncian.
   */
  get available(): boolean {
    return typeof this.store.compareAndSet === 'function';
  }

  /**
   * Coba memegang lease.
   *
   * `acquired` = lease baru dibuat, jadi proses ini yang menjalankan sapuan.
   * `renewed` = lease ini milik proses yang sama dan baru diperpanjang, jadi
   * proses ini tetap boleh jalan karena tidak ada proses lain yang sedang
   * mengerjakannya. `foreign` = proses lain sedang memegang, jadi pemanggil
   * harus melompat supaya tidak mengulang pekerjaan yang sama.
   */
  async claim(): Promise<SweepLeaseClaim> {
    const store = this.store;
    const compareAndSet = store.compareAndSet;
    if (!compareAndSet) return 'renewed';

    const key = sweepLeaseKey(this.name);
    const fresh = await compareAndSet.call(store, key, this.holderId, {
      expectedValue: null,
      ttlMs: this.ttlMs,
    });
    if (fresh) return 'acquired';

    const current = await store.get(key);
    if (current !== this.holderId) return 'foreign';

    await store.set(key, this.holderId, { ttlMs: this.ttlMs });
    return 'renewed';
  }

  /** ID proses yang memegang lease ini, atau `null` kalau tidak ada. */
  async holder(): Promise<string | null> {
    return this.store.get(sweepLeaseKey(this.name));
  }
}