/**
 * Penjaga pesan yang sudah diproses automod.
 *
 * PRD §9.4: "event Discord bisa terkirim dobel; handler harus toleran."
 * Untuk gateway itu bukan hypothetis — sesi yang pulih setelah koneksi
 * putus akan mengirim ulang `MessageCreate` untuk pesan yang sudah pernah
 * sampai. Tanpa penjaga, satu pesan berarti dua penghapusan, dua kasus
 * moderasi, dan dua timeout, dan **tidak ada yang gagal**: semuanya hanya
 * terjadi dua kali, dan moderator melihat dua peringatan untuk satu chat.
 *
 * Yang dijaga adalah `message.id`, yang Globally Unique, jadi id itu sudah
 * cukup tanpa digabung guild — dua server tidak mungkin memakai id yang sama.
 *
 * Sifat_state ini sengaja in-memory dan berbatas: kalau bot restart,
 * penjaga ikut kosong, sama seperti antrean musik dan `AutomodTracker`.
 * Itu batas yang wajar — pesan yang terkirim ulang hanya terjadi di sekitar
 * sesi yang sama, bukan setelah berjam-jam bot hidup.
 */

export interface SeenMessageOptions {
  /** Berapa lama id dianggap masihRemembered, dalam milidetik. */
  ttlMs?: number;
  /** Batas jumlah id yang diingat, supaya proses panjang tidak tumbuh. */
  maxEntries?: number;
  /** Jam yang bisa diganti di tes. */
  now?: () => number;
}

/** Default: cukup untuk menutup jendela redelivery gateway, tidak lebih. */
export const DEFAULT_SEEN_MESSAGE_TTL_MS = 10 * 60_000;

export class SeenMessageGuard {
  private readonly seen = new Map<string, number>();
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly now: () => number;

  constructor(options: SeenMessageOptions = {}) {
    this.ttlMs = options.ttlMs ?? DEFAULT_SEEN_MESSAGE_TTL_MS;
    this.maxEntries = Math.max(1, options.maxEntries ?? 10_000);
    this.now = options.now ?? Date.now;
  }

  /**
   * Klaim satu id pesan.
   *
   * Mengembalikan `true` kalau pesan ini baru dan boleh diproses, dan
   * `false` kalau id-nya sudah dilihat dalam masa ingat.
   *
   * Id yang sudah lewat masa ingatnya dilepas, jadi pesan dengan id yang
   * sama setelah TTL dianggap pesan baru. Itu benar: Discord tidak pernah
   * mengirim id yang sama untuk pesan berbeda.
   */
  accept(messageId: string): boolean {
    const now = this.now();

    if (this.seen.has(messageId)) {
      const seenAt = this.seen.get(messageId) as number;
      if (now - seenAt < this.ttlMs) return false;
      // Sudah lewat TTL: ini pesan baru, jadi biarkan diproses lagi.
      this.seen.delete(messageId);
    }

    this.seen.set(messageId, now);
    this.prune(now);

    return true;
  }

  /** Buang semua id. Dipakai di tes. */
  reset(): void {
    this.seen.clear();
  }

  /** Berapa id yang sedang diingat. */
  get size(): number {
    return this.seen.size;
  }

  /**
   * Buang id yang sudah kedaluwarsa, dan pangkas yang paling tua kalau
   * masih penuh. Sama seperti `AutomodTracker`: proses yang berjalan lama
   * tidak boleh menahan memori tanpa batas.
   */
  private prune(now: number): void {
    for (const [id, seenAt] of this.seen) {
      if (now - seenAt >= this.ttlMs) this.seen.delete(id);
    }

    while (this.seen.size > this.maxEntries) {
      const oldest = this.seen.keys().next();
      if (oldest.done) break;
      this.seen.delete(oldest.value);
    }
  }
}