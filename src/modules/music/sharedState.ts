import { getLogger } from '../../services/logger.js';
import { getKeyValueStore, type KeyValueStore } from '../../services/kvStore.js';
import type { LoopMode } from './loop.js';
import { MusicQueue } from './queue.js';
import {
  decodeSharedMusicState,
  emptyRecord,
  encodeSharedMusicState,
  type SharedMusicRecord,
} from './sharedStateCodec.js';
import type { RandomSource } from './shuffle.js';
import { totalDurationMs } from './track.js';
import type { TrackInfo } from './types.js';

/**
 * State musik per server yang disimpan di store bersama (§9.4).
 *
 * **Kenapa file ini ada.** Antrean lagu dan mode loop sebelumnya hidup di dua
 * `Map` di dalam `MusicService`. Dua `Map` itu hilang saat bot restart, dan tidak
 * terlihat oleh shard lain (§5.3). Akibatnya guild yang besar yang di-sharding
 * bisa saja menampilkan antrean kosong di satu perintah, lalu penuh di
 * perintah berikutnya, padahal tidak ada yang salah pada apa pun.
 *
 * Yang dipindahkan ke sini adalah bagian state yang **benar-benar boleh dibagi**:
 * lagu yang belum diputar dan mode loop. Yang tetap milik satu proses adalah
 * player Lavalink-nya — koneksi voice, lagu yang sedang diputar, posisi, filter,
 * dan riwayat siklus. Koneksi voice hanya bisa dipegang satu proses, jadi
 * memindahkan `currents` ke store tidak akan membuat dua proses bisa memutar
 * lagu yang sama; yang membuatnya benar adalah pemindahan antrean, supaya
 * proses lain bisa membacanya dan tidak lagi menampilkan "antrean kosong".
 *
 * **Bentuk mutasinya: baca-ubah-tulis.** Setiap perubahan membaca record
 * terbaru dari store, mengubahnya di memori, lalu menulis ulang. Jadi penambahan dari
 * proses lain ikut terbaca dan tidak hilang diam-diam. Yang **belum** aman
 * adalah dua proses yang menulis pada milidetik yang sama: tidak ada WATCH/MULTI
 * atau skrip Lua, jadi penulisan terakhir menang. Itu batas yang jujur untuk
 * tahap ini, dan alasan antrean ini jarang ditulis dari dua proses pada saat
 * yang sama karena hanya satu proses yang memegang koneksi voice.
 *
 * **Kegagalan store tidak pernah menjatuhkan pemutaran.** Aturannya satu aturan:
 * kalau baca gagal, perubahan tetap berjalan di salinan lokal tapi **tidak**
 * ditulis ulang. Menulis di atas record yang tidak bisa dibaca berarti menghapus
 * antrean orang lain dengan state yang menebak-nebak.
 */

/** Awalan key state musik di store bersama. */
export const SHARED_STATE_KEY_PREFIX = 'harmony:musicstate:';

/** Key state musik sebuah guild. */
export function sharedStateKey(guildId: string): string {
  return `${SHARED_STATE_KEY_PREFIX}${guildId}`;
}

/**
 * Umur record state musik.
 *
 * 12 jam jauh lebih lama dari jeda bot yang realistis, jadi antrean tetap ada
 * setelah restart singkat. Setelah itu record hilang sendiri: bot yang berdiri
 * lama di ribuan guild tidak boleh menyisakan key untuk guild yang sudah
 * meninggalkannya beberapa bulan lalu.
 */
export const SHARED_STATE_TTL_MS = 12 * 60 * 60_000;

/** Batas guild yang salinan lokalnya disimpan proses ini. */
const MIRROR_LIMIT = 500;

/**
 * Berapa kali percobaan menulis sebelum menyerah.
 *
 * Tiga sudah lebih dari cukup: setiap percobaan berarti proses lain menulis
 * pada saat yang sama, dan itu sangat jarang pada antrean satu guild.
 * Menambah angka hanya memperpanjang waktu tunggu tanpa mengubah kemungkinan
 * berhasil.
 */
const MAX_CAS_ATTEMPTS = 3;

/** Hasil baca: record yang sudah didekode, plus teks mentahnya. */
interface LoadedState {
  record: SharedMusicRecord;
  /** Teks di store, `null` kalau key-nya tidak ada. */
  raw: string | null;
}

/** Hasil penambahan lagu ke antrean. */
export interface AddQueueResult {
  /** Lagu yang benar-benar masuk (kelebihan kapasitas dipotong). */
  accepted: TrackInfo[];
  /** Berapa lagu yang tidak kebawa tempat. */
  skipped: number;
  /** Ukuran antrean setelah penambahan. */
  size: number;
}

export interface SharedMusicStateOptions {
  /** Batas lagu per antrean; sama dengan batas antrean di §6.2. */
  capacity: number;
  /** Store bersama; default-nya store proses (Redis atau memori). */
  store?: KeyValueStore;
  /** Masa berlaku record; default `SHARED_STATE_TTL_MS`. */
  ttlMs?: number;
  /** Jam; bisa disuntik saat tes. */
  now?: () => number;
}

/**
 * Pembungkus read-modify-write untuk state musik per guild.
 *
 * Semua operasi async karena menyentuh store. Pembacaan sinkron tetap tersedia
 * lewat `cached()` untuk render embed, tetapi nilainya hanya sah kalau guild
 * itu baru saja di-`refresh()` atau diubah — itu sebabnya setiap jalur baca di
 * `MusicService` dimulai dengan `refresh()`.
 */
export class SharedMusicState {
  /** Salinan lokal supaya render embed tidak menunggu store. */
  private readonly mirror = new Map<string, SharedMusicRecord>();
  private readonly capacity: number;
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(private readonly options: SharedMusicStateOptions) {
    this.capacity = Math.max(1, Math.trunc(options.capacity));
    this.ttlMs = options.ttlMs ?? SHARED_STATE_TTL_MS;
    this.now = options.now ?? Date.now;
  }

  /**
   * Store yang dipakai.
   *
   * Diambil saat dipakai, bukan saat objek dibuat, supaya modul musik yang
   * dibangun sebelum `setKeyValueStore()` tetap ikut memakai store yang benar.
   */
  private get store(): KeyValueStore {
    return this.options.store ?? getKeyValueStore();
  }

  /** Salinan lokal untuk guild ini; selalu ada, tidak pernah null. */
  cached(guildId: string): SharedMusicRecord {
    const record = this.mirror.get(guildId);
    return record ? cloneRecord(record) : emptyRecord();
  }

  /** Mode loop dari salinan lokal; default `off`. */
  loopMode(guildId: string): LoopMode {
    return this.mirror.get(guildId)?.loopMode ?? 'off';
  }

  /** Jumlah lagu di salinan lokal. */
  size(guildId: string): number {
    return this.mirror.get(guildId)?.tracks.length ?? 0;
  }

  /** Berapa guild yang punya salinan lokal — dipakai tes. */
  get mirrorSize(): number {
    return this.mirror.size;
  }

  /** Salinan daftar lagu dari salinan lokal — aman untuk render embed. */
  tracks(guildId: string): TrackInfo[] {
    return [...(this.mirror.get(guildId)?.tracks ?? [])];
  }

  /** Total durasi antrean dari salinan lokal. */
  upcomingDurationMs(guildId: string): number {
    return totalDurationMs(this.tracks(guildId));
  }

  /** Baca state terbaru dari store dan perbarui salinan lokal. */
  async refresh(guildId: string): Promise<SharedMusicRecord> {
    const stored = await this.load(guildId);
    return stored ? cloneRecord(stored.record) : this.cached(guildId);
  }

  /** Tambahkan lagu di belakang antrean. */
  async add(guildId: string, tracks: readonly TrackInfo[]): Promise<AddQueueResult> {
    return this.mutateQueue(guildId, (queue) => {
      const accepted = queue.add(tracks);
      return { accepted: tracks.slice(0, accepted), skipped: tracks.length - accepted, size: queue.size };
    });
  }

  /** Ambil lagu berikutnya (FIFO). */
  async shift(guildId: string): Promise<TrackInfo | undefined> {
    return this.mutateQueue(guildId, (queue) => queue.shift());
  }

  /** Hapus lagu pada posisi 1-based. */
  async remove(guildId: string, position: number): Promise<TrackInfo | undefined> {
    return this.mutateQueue(guildId, (queue) => queue.remove(position));
  }

  /** Pindahkan lagu dari satu posisi ke posisi lain (1-based). */
  async move(guildId: string, from: number, to: number): Promise<TrackInfo | null> {
    return this.mutateQueue(guildId, (queue) => queue.move(from, to));
  }

  /** Acak urutan antrean; mengembalikan jumlah lagu yang diacak. */
  async shuffle(guildId: string, random: RandomSource = Math.random): Promise<number> {
    return this.mutateQueue(guildId, (queue) => queue.shuffle(random));
  }

  /** Ganti seluruh isi antrean, dipotong ke kapasitas. */
  async replace(guildId: string, tracks: readonly TrackInfo[]): Promise<number> {
    return this.mutateQueue(guildId, (queue) => {
      queue.clear();
      return queue.add(tracks);
    });
  }

  /** Ubah mode loop; mengembalikan mode sebelumnya. */
  async setLoopMode(guildId: string, mode: LoopMode): Promise<LoopMode> {
    return this.mutateQueue(guildId, (_queue, record) => {
      const previous = record.loopMode;
      record.loopMode = mode;
      return previous;
    });
  }

  /** Kosongkan antrean tanpa mengubah mode loop (dipakai `/stop`). */
  async clearTracks(guildId: string): Promise<void> {
    await this.mutateQueue(guildId, (queue) => queue.clear());
  }

  /** Buang seluruh state guild ini: antrean kosong dan loop mati. */
  async reset(guildId: string): Promise<void> {
    await this.mutateQueue(guildId, (queue, record) => {
      queue.clear();
      record.loopMode = 'off';
    });
  }

  /** Lupakan salinan lokal; untuk kebersihan memori saat bot keluar. */
  forget(guildId: string): void {
    this.mirror.delete(guildId);
  }

  /** Lupakan semua salinan lokal (dipanggil saat shutdown). */
  forgetAll(): void {
    this.mirror.clear();
  }

  /**
   * Baca-ubah-tulis satu record.
   *
   * `apply` menerima `MusicQueue` yang sudah berisi antrean terbaru dan record
   * yang sedang dibaca. Kalau `apply` mengubah `record.loopMode`, perubahan itu
   * ikut ditulis. Nilai balik `apply` dikembalikan ke pemanggil apa adanya.
   */
  async mutateQueue<T>(
    guildId: string,
    apply: (queue: MusicQueue, record: SharedMusicRecord) => T,
  ): Promise<T> {
    // Percobaan terakhir disimpan supaya nilai kembaliannya bisa dikembalikan
    // juga ketika semua percobaan gagal menulis.
    let last: { result: T; next: SharedMusicRecord } | undefined;

    for (let attempt = 1; attempt <= MAX_CAS_ATTEMPTS; attempt += 1) {
      const loaded = await this.load(guildId);
      const base = loaded?.record ?? this.cached(guildId);
      // Salinan sebelum `apply` jalan. `apply` boleh mengubah `base` langsung
      // (mis. mode loop), jadi pembanding "ada yang berubah atau tidak" harus
      // memakai keadaan sebelumnya, bukan objek yang sama dengan dirinya sendiri.
      const before = cloneRecord(base);

      const queue = new MusicQueue(this.capacity);
      queue.add(base.tracks);

      const result = apply(queue, base);
      const next: SharedMusicRecord = {
        tracks: queue.toArray(),
        loopMode: base.loopMode,
        updatedAt: this.now(),
        version: base.version + 1,
      };

      // Baca gagal -> jangan tulis. Lihat catatan di kepala file.
      if (loaded === null) {
        this.remember(guildId, next);
        return result;
      }

      // Tidak ada yang berubah: jangan tulis, supaya lagu yang berakhir dengan
      // antrean kosong tidak membanjiri store dengan record yang identik.
      if (isSameRecord(before, next)) {
        this.remember(guildId, before);
        return result;
      }

      last = { result, next };

      const written = await this.writeIfUnchanged(guildId, loaded.raw, next);
      if (written) return result;

      // Artinya proses lain menulis antara baca dan tulis kita. Perubahan itu
      // belum hilang dari store, tapi perubahan kita belum masuk. Ulangi dari
      // keadaan terbaru — `apply` dipanggil ulang, jadi harus bebas efek samping.
      getLogger().debug(
        { guildId, attempt },
        'Antrian berubah oleh proses lain saat ditulis — mengulangi perubahan',
      );
    }

    // Habis percobaan: penyimpanan terus berebut. Memaksa penulisan di sini
    // berarti menimpa perubahan orang lain, jadi hasilnya hanya berlaku di
    // proses ini dan dicatat apa adanya.
    getLogger().warn(
      { guildId },
      'Antrean masih berebut setelah beberapa percobaan — perubahan hanya berlaku di proses ini',
    );

    if (!last) return undefined as T;
    this.remember(guildId, last.next);

    return last.result;
  }

  /**
   * Baca record beserta teks mentahnya dari store.
   *
   * Teks mentah ikut dibawa karena yang ditanyakan `compareAndSet` adalah
   * "nilai ini masih sama?" Kita tidak boleh membandingkan hasil decode:
   * encode-decode tidak dijamin menghasilkan string yang sama persis, jadi
   * perbandingan seperti itu selalu gagal.
   */
  private async load(guildId: string): Promise<LoadedState | null> {
    try {
      const raw = await this.store.get(sharedStateKey(guildId));
      const record = decodeSharedMusicState(raw);
      this.remember(guildId, record);
      return { record, raw };
    } catch (error) {
      getLogger().warn({ err: error, guildId }, 'Gagal membaca state musik dari store — memakai salinan lokal');
      return null;
    }
  }

  /**
   * Tulis record hanya kalau nilai di store masih persis yang kita baca.
   *
   * Mengembalikan false kalau ada proses lain yang menulis lebih dulu — itu
   * bukan kegagalan, itu informasi: pemanggil membaca ulang dan mengulangi.
   *
   * Kalau store tidak punya `compareAndSet` (klien Redis tanpa `EVAL`, atau
   * store khusus yang tidak mendukungnya), penulisan tetap dilakukan dan
   * hasilnya dianggap berhasil — karena memang tidak ada yang bisa dicek di
   * sini. Batas ini sudah tercatat di kepala file, bukan disembunyikan.
   */
  private async writeIfUnchanged(
    guildId: string,
    expectedRaw: string | null,
    record: SharedMusicRecord,
  ): Promise<boolean> {
    const store = this.store;

    if (!store.compareAndSet) {
      await this.save(guildId, record);
      return true;
    }

    try {
      const written = await store.compareAndSet(sharedStateKey(guildId), encodeSharedMusicState(record), {
        expectedValue: expectedRaw,
        ttlMs: this.ttlMs,
      });

      this.remember(guildId, record);
      return written;
    } catch (error) {
      // Store gagal menulis: salinan lokal tetap diperbarui supaya guild ini
      // jalan, dan hasilnya dikembalikan apa adanya.
      getLogger().warn({ err: error, guildId }, 'Gagal menulis state musik ke store');
      this.remember(guildId, record);
      return true;
    }
  }

  /** Tulis record ke store dengan masa berlaku baru. */
  private async save(guildId: string, record: SharedMusicRecord): Promise<void> {
    this.remember(guildId, record);

    try {
      await this.store.set(sharedStateKey(guildId), encodeSharedMusicState(record), { ttlMs: this.ttlMs });
    } catch (error) {
      // Salinan lokal sudah diperbarui, jadi guild ini tetap jalan. Yang hilang
      // hanya bertahan lintas proses, dan itu akan hilang sendiri saat record
      // ditulis ulang oleh mutasi berikutnya.
      getLogger().warn({ err: error, guildId }, 'Gagal menulis state musik ke store');
    }
  }

  /** Simpan salinan lokal, buang yang paling lama kalau penuh. */
  private remember(guildId: string, record: SharedMusicRecord): void {
    this.mirror.delete(guildId);
    this.mirror.set(guildId, record);

    while (this.mirror.size > MIRROR_LIMIT) {
      const oldest = this.mirror.keys().next();
      if (oldest.done) break;
      this.mirror.delete(oldest.value);
    }
  }
}

function cloneRecord(record: SharedMusicRecord): SharedMusicRecord {
  return { ...record, tracks: [...record.tracks] };
}

function isSameRecord(a: SharedMusicRecord, b: SharedMusicRecord): boolean {
  if (a.loopMode !== b.loopMode || a.tracks.length !== b.tracks.length) return false;

  return a.tracks.every((track, index) => track.encoded === b.tracks[index]?.encoded);
}
