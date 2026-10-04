import type { KeyValueStore } from '../../services/kvStore.js';

/**
 * Kepemilikan player per guild (§5.3, §9.4).
 *
 * **Kenapa file ini ada.** Antrean dan mode loop sudah pindah ke store bersama,
 * jadi proses lain bisa membacanya. Yang masih milik satu proses adalah player
 * Lavalink-nya: koneksi voice, lagu yang sedang diputar, posisi, dan filter.
 * Koneksi voice hanya bisa dipegang satu proses, jadi memindahkannya ke store
 * bukan jawaban — tidak ada dua proses yang bisa memegang satu koneksi voice.
 * Yang bisa dijamin adalah **satu penulis**: sebelum proses menyentuh player
 * sebuah guild, proses itu harus memegang lease kepemilikan guild tersebut di
 * store bersama.
 *
 * Tanpa itu, guild besar yang kebagi ke dua shard bisa punya dua proses yang
 * sama-sama menjalankan `/play` untuk guild yang sama: satu berhasil join,
 * yang lain join lagi, player pertama menggantung, dan tidak ada yang bisa
 * menjelaskan kenapa.
 *
 * **Lease, bukan lock permanen.** Kepemilikan punya TTL dan diperpanjang berkala,
 * jadi proses yang mati tidak mengunci guild selamanya: lease-nya kedaluwarsa dan
 * guild bisa diambil proses lain. Sebaliknya, proses yang hidup terus memperpanjang
 * lease-nya, jadi tidak ada proses lain yang bisa mengambil alih tanpa terlihat.
 *
 * **`release()` tidak atomik.** Ia membaca lalu menghapus, jadi ada celah di mana
 * lease baru bisa tertimpa di antara keduanya. Celah itu dibatasi TTL dan tidak
 * berdampak besar: yang paling buruk adalah satu guild sempat ditolak sebentar
 * setelah player-nya dilepas. Menutup celah itu sepenuhnya butuh skrip Lua di
 * Redis, dan yang dijaga di sini adalah perilakunya, bukan ketiadaan celah.
 */
export const PLAYER_OWNER_KEY_PREFIX = 'harmony:player-owner:';

/** Key lease kepemilikan player sebuah guild. */
export function playerOwnerKey(guildId: string): string {
  return `${PLAYER_OWNER_KEY_PREFIX}${guildId}`;
}

/**
 * Umur lease.
 *
 * Lima menit jauh lebih lama daripada satu perintah, dan pendek cukup supaya
 * guild yang ditinggalkan proses yang mati bebas dalam waktu yang masuk akal.
 * Diperpanjang tiap `PLAYER_OWNER_RENEW_MS`, jadi proses yang hidup tidak pernah
 * kehilangan lease-nya meski botnya memegang guild tanpa aktivitas (mode 24/7).
 */
export const PLAYER_OWNER_TTL_MS = 5 * 60_000;

/** Seberapa sering lease yang dipegang diperpanjang. */
export const PLAYER_OWNER_RENEW_MS = 60_000;

/**
 * Guild ini sedang ditangani proses lain.
 *
 * Dilempar, bukan dibiarkan diam: `/play` yang gagal diam-diam akan terlihat
 * seperti "lagu tidak diputar tanpa alasan", dan yang harus memperbaikinya
 * adalah proses yang salah, bukan member yang salah klik.
 */
export class PlayerOwnedElsewhereError extends Error {
  public override readonly name = 'PlayerOwnedElsewhereError';

  constructor(
    public readonly guildId: string,
    public readonly ownerId: string | null,
  ) {
    super(`Pemilik player guild ${guildId} sedang dipegang proses lain`);
  }
}

/** Hasil klaim lease. */
export type PlayerOwnershipClaim = 'acquired' | 'renewed' | 'foreign';

/**
 * Store yang dibaca saat dipakai, atau fungsi yang mengembalikannya.
 *
 * Fungsinya ada karena urutan startup: modul musik dibangun sebelum store
 * kunci-nilai selesai dibuat, jadi store harus diambil **saat dipakai**,
 * bukan saat objek ini dibuat. Kalau diambil saat konstruksi, yang tertangkap
 * adalah store memori bawaan dan lease ownership tersimpan di sana — bot tetap
 * jalan, player tetap dijaga, tapi hanya dalam satu proses, persis yang
 * seharusnya tidak boleh terjadi. Pola yang sama sudah dipakai `SharedMusicState`.
 */
export type PlayerOwnershipStore = KeyValueStore | (() => KeyValueStore);

export class PlayerOwnership {
  constructor(
    private readonly storeSource: PlayerOwnershipStore,
    private readonly instanceId: string,
  ) {}

  /** Store yang dipakai sekarang; fungsi diselesaikan saat ini juga. */
  private get store(): KeyValueStore {
    const source = this.storeSource;
    return typeof source === 'function' ? source() : source;
  }

  /**
   * True kalau store ini bisa menegakkan satu pemilik.
   *
   * Store tanpa `compareAndSet` tidak bisa memberi jaminan, jadi kepemilikan
   * dinonaktifkan seluruhnya, alih-alih memberi jaminan palsu. Mode satu shard
   * memang tidak butuh ini; mode multi-shard yang menolak start lebih aman
   * daripada start tanpa jaminan.
   */
  get available(): boolean {
    return typeof this.store.compareAndSet === 'function';
  }

  /**
   * Klaim lease sebuah guild.
   *
   * `acquired` = lease baru dibuat, `renewed` = lease ini milik proses yang
   * sama dan baru diperpanjang, `foreign` = sedang dipegang proses lain.
   * Kalau store tidak mendukung `compareAndSet`, hasilnya selalu `renewed`:
   * pemilik tidak diblokir, karena tidak ada yang bisa diverifikasi.
   */
  async claim(guildId: string): Promise<PlayerOwnershipClaim> {
    // Diselesaikan sekali per panggilan: `compareAndSet` dipanggil dengan
    // `store` sebagai `this`, jadi store yang dibandingkan harus store yang
    // sama dengan yang dibaca di bawahnya.
    const store = this.store;
    const compareAndSet = store.compareAndSet;
    if (!compareAndSet) return 'renewed';

    const key = playerOwnerKey(guildId);

    // `expectedValue: null` berarti key harus belum ada (atau sudah kedaluwarsa),
    // jadi dua proses yang mulai bersamaan tidak bisa sama-sama berhasil.
    const fresh = await compareAndSet.call(store, key, this.instanceId, {
      expectedValue: null,
      ttlMs: PLAYER_OWNER_TTL_MS,
    });
    if (fresh) return 'acquired';

    const current = await store.get(key);
    if (current !== this.instanceId) return 'foreign';

    await store.set(key, this.instanceId, { ttlMs: PLAYER_OWNER_TTL_MS });
    return 'renewed';
  }

  /** ID proses yang memegang lease guild ini, atau `null` kalau tidak ada. */
  async ownerOf(guildId: string): Promise<string | null> {
    return this.store.get(playerOwnerKey(guildId));
  }

  /** Lempar kalau guild ini sedang dipegang proses lain. */
  async assertOwned(guildId: string): Promise<void> {
    const ownerId = await this.ownerOf(guildId);
    if (ownerId === null || ownerId === this.instanceId) return;

    throw new PlayerOwnedElsewhereError(guildId, ownerId);
  }

  /** Lepas lease — hanya kalau memang lease proses ini. */
  async release(guildId: string): Promise<void> {
    if (!this.available) return;
    if ((await this.ownerOf(guildId)) !== this.instanceId) return;

    await this.store.delete(playerOwnerKey(guildId));
  }
}