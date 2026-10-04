import { randomBytes } from 'node:crypto';
import { getLogger } from '../../services/logger.js';
import { getKeyValueStore, type KeyValueStore } from '../../services/kvStore.js';
import { decodeSearchSession, encodeSearchSession } from './searchSessionCodec.js';
import type { TrackInfo } from './types.js';

/**
 * State antar-interaksi untuk `/search` (PRD §6.1).
 *
 * Alurnya butuh keadaan yang bertahan di luar satu pemanggilan `execute`: slash
 * command menyimpan 5 hasil, lalu select menu dibaca di interaksi berikutnya
 * yang tidak membawa query maupun akses ke Lavalink.
 *
 * Sifat penting dari pilihan ini:
 * - Pesan select menu dikirim ephemeral, jadi tidak ada yang perlu dilihat member
 *   lain dan hasil pencarian tidak perlu disimpan ke database.
 * - Session hidup di `KeyValueStore` (§9.4), jadi bersama antar proses. Ini
 *   yang membuat select menu tetap bekerja begitu bot di-sharding (§5.3):
 *   guild bisa ditangani proses berbeda antara `/search` dan kliknya. Sifat
 *   berumur pendek tetap dijaga lewat TTL, jadi tidak ada state yang tumbuh
 *   terus di store bersama.
 */

/** Awalan customId select menu pencarian — dipakai router komponen. */
export const SEARCH_SELECT_PREFIX = 'musicsearch:';

/** Berapa hasil yang ditawarkan ke user (PRD §6.1: "Cari 5 hasil"). */
export const SEARCH_RESULT_LIMIT = 5;

/**
 * Umur session pencarian.
 *
 * 15 menit cukup untuk orang memilih dengan santai, dan cukup pendek supaya
 * select menu lama tidak bisa dipakai berbulan-bulan lalu. TTL-nya dipasang di
 * store, jadi session yang ditinggalkan hilang sendiri tanpa perlu penyapuan.
 */
export const SEARCH_SESSION_TTL_MS = 15 * 60_000;

/** Awalan key session di store bersama. */
const SESSION_PREFIX = 'harmony:searchsession:';

/**
 * Batas session yang dicatat proses ini.
 *
 * Store bersama tidak bisa "hapus semua key dengan awalan tertentu", jadi proses
 * menyimpan daftar token yang pernah ia tulis sendiri. Daftar ini dibatasi dan
 * secara berkala disapu supaya bot yang berdiri lama tidak tumbuh terus; token
 * yang keluar dari daftar hanya berarti barisnya tidak ikut disapu, karena TTL
 * di sisi store sudah mengurusnya sendiri.
 */
const TRACKED_TOKENS_LIMIT = 200;

/** Seberapa sering penyapuan daftar token berjalan (dihitung per `put`). */
const PRUNE_EVERY_PUTS = 64;

/** Batas Discord: label opsi 100 karakter, description 100 karakter. */
export const MAX_OPTION_LABEL_LENGTH = 100;
export const MAX_OPTION_DESCRIPTION_LENGTH = 100;

/** Panjang token session; cukup acak supaya tidak bisa ditebak orang lain. */
const TOKEN_LENGTH = 8;

/** Hasil pencarian yang disimpan sementara, siap dimasukkan ke antrean. */
export interface SearchSession {
  token: string;
  guildId: string;
  /** Siapa yang menjalankan `/search`; hanya dia yang boleh memakai menunya. */
  requesterId: string;
  /** Query asal, untuk judul embed hasil. */
  query: string;
  tracks: readonly TrackInfo[];
  createdAt: number;
}

/** Hasil penerjemahan pilihan select menu. */
export type SearchSelection =
  | { kind: 'ok'; track: TrackInfo }
  | { kind: 'expired' }
  | { kind: 'not-owner' }
  | { kind: 'other-guild' }
  | { kind: 'bad-index' };

/** Sumber token acak, bisa disuntik saat tes. */
export type TokenFactory = () => string;

const defaultTokenFactory: TokenFactory = () => randomBytes(TOKEN_LENGTH).toString('hex');

/** Pola token yang boleh masuk: hex dengan panjang minimal 8. */
const TOKEN_PATTERN = /^[0-9a-f]{8,}$/;

export interface SearchSessionStoreOptions {
  /** Umur session; default `SEARCH_SESSION_TTL_MS`. */
  ttlMs?: number;
  /** Jam yang dipakai untuk mengukur umur; bisa disuntik saat tes. */
  now?: () => number;
  tokenFactory?: TokenFactory;
  /** Store bersama; default-nya store proses (Redis atau memori). */
  store?: KeyValueStore;
}

/**
 * Penyimpanan session pencarian di store bersama.
 *
 * Semua operasi async karena menyentuh store: `put` menulis dengan TTL,
 * `take` mengklaim session supaya hanya satu proses yang bisa memakainya.
 *
 * **Kegagalan store tidak pernah melempar.** `/search` yang gagal menulis
 * session dijawab dengan "coba lagi" (`put` mengembalikan null), dan select
 * menu yang session-nya tidak terbaca dijawab "sudah tidak berlaku" — bukan
 * dengan error yang membuat user mengira bot-nya rusak.
 */
export class SearchSessionStore {
  private readonly trackedTokens = new Set<string>();
  private readonly storeOverride: KeyValueStore | undefined;
  private readonly now: () => number;
  private readonly ttlMs: number;
  private readonly tokenFactory: TokenFactory;
  private putsSinceSweep = 0;

  constructor(options: SearchSessionStoreOptions = {}) {
    this.storeOverride = options.store;
    this.now = options.now ?? (() => Date.now());
    this.ttlMs = options.ttlMs ?? SEARCH_SESSION_TTL_MS;
    this.tokenFactory = options.tokenFactory ?? defaultTokenFactory;
  }

  /**
   * Store yang dipakai.
   *
   * Diambil saat dipakai, bukan saat objek dibuat: modul musik dibangun
   * sebelum store kunci-nilai proses selesai dibuat, jadi kalau store-nya
   * ditangkap saat konstruksi, yang tertangkap adalah store memori bawaan dan
   * session tidak pernah terbagi antar proses meski Redis hidup.
   */
  private get store(): KeyValueStore {
    return this.storeOverride ?? getKeyValueStore();
  }

  /** Berapa token yang dicatat proses ini (dipakai tes & diagnosa). */
  get size(): number {
    return this.trackedTokens.size;
  }

  /**
   * Simpan hasil pencarian dan kembalikan session-nya.
   *
   * `null` berarti session tidak bisa disimpan — pemanggil harus memberi tahu
   * user untuk mengulang, bukan mengirim select menu yang pasti tidak berlaku.
   *
   * `tracks` dipotong jadi `SEARCH_RESULT_LIMIT` supaya sesuai PRD dan supaya
   * select menu tidak mungkin melewati batas 25 opsi Discord.
   */
  async put(input: {
    guildId: string;
    requesterId: string;
    query: string;
    tracks: readonly TrackInfo[];
  }): Promise<SearchSession | null> {
    const session: SearchSession = {
      token: this.createToken(),
      guildId: input.guildId,
      requesterId: input.requesterId,
      query: input.query.trim(),
      tracks: input.tracks.slice(0, SEARCH_RESULT_LIMIT),
      createdAt: this.now(),
    };

    try {
      await this.store.set(sessionKey(session.token), encodeSearchSession(session), {
        ttlMs: this.ttlMs,
      });
    } catch (error) {
      getLogger().warn({ err: error, guildId: input.guildId }, 'Gagal menyimpan session /search');
      return null;
    }

    this.track(session.token);
    this.maybeSweep();

    return session;
  }

  /** Ambil session tanpa mengambil hak pakainya; dipakai untuk tes. */
  async peek(token: string): Promise<SearchSession | undefined> {
    return (await this.read(token)) ?? undefined;
  }

  /** Buang satu session (mis. hasil pencarian yang tidak pernah dipilih). */
  async delete(token: string): Promise<void> {
    this.trackedTokens.delete(token);
    await this.remove(sessionKey(token));
  }

  /**
   * Terjemahkan pilihan select menu menjadi lagu.
   *
   * Session diklaim (dibaca sekaligus dihapus) hanya **setelah** semua validasi
   * lolos: klik orang lain atau server lain tidak boleh membakar session milik
   * pemiliknya. Sebaliknya, dua klik milik pemilik sendiri yang kebetulan sama-
   * sama diproses hanya menghasilkan satu lagu, karena operasi klaim di store
   * bersifat sekali pakai.
   */
  async take(input: {
    token: string;
    guildId: string;
    userId: string;
    /** Indeks opsi yang dipilih, dari `values[0]`. */
    index: number;
  }): Promise<SearchSelection> {
    const session = await this.read(input.token);

    if (!session) return { kind: 'expired' };

    // Milik server lain: jangan sampai satu server memutar lagu yang hasil
    // Pencariannya di server lain.
    if (session.guildId !== input.guildId) return { kind: 'other-guild' };

    if (session.requesterId !== input.userId) return { kind: 'not-owner' };

    const track = session.tracks[input.index];
    if (!track) return { kind: 'bad-index' };

    if (!(await this.claim(input.token))) return { kind: 'expired' };

    return { kind: 'ok', track };
  }

  /** Buang session yang sudah hilang atau kedaluwarsa; jumlah yang dibuang. */
  async prune(): Promise<number> {
    let removed = 0;

    for (const token of [...this.trackedTokens]) {
      if (!(await this.read(token))) removed += 1;
    }

    return removed;
  }

  /** Kosongkan semua session proses ini; dipakai saat bot akan keluar. */
  async clear(): Promise<void> {
    const tokens = [...this.trackedTokens];
    this.trackedTokens.clear();

    for (const token of tokens) {
      await this.remove(sessionKey(token));
    }
  }

  /**
   * Baca satu session.
   *
   * `null` berarti "tidak ada yang bisa dipakai": key hilang, JSON rusak, atau
   * store sedang bermasalah. Ketiganya sama-sama berakhir dengan select menu
   * yang dijawab "sudah tidak berlaku".
   */
  private async read(token: string): Promise<SearchSession | null> {
    const key = sessionKey(token);
    let raw: string | null;

    try {
      raw = await this.store.get(key);
    } catch (error) {
      getLogger().warn({ err: error, token }, 'Gagal membaca session /search');
      return null;
    }

    const session = decodeSearchSession(raw);
    if (!session) {
      this.trackedTokens.delete(token);
      return null;
    }

    // Pengaman kedua: kalau store yang dipakai mengabaikan TTL, umur session
    // tetap dijaga di sini supaya select menu tua tidak bisa dipakai selamanya.
    if (this.isExpired(session)) {
      this.trackedTokens.delete(token);
      await this.remove(key);
      return null;
    }

    return session;
  }

  /** Klaim session: berhasil kalau proses ini yang pertama mengambilnya. */
  private async claim(token: string): Promise<boolean> {
    try {
      const claimed = await this.store.take(sessionKey(token));
      if (claimed === null) return false;

      this.trackedTokens.delete(token);
      return true;
    } catch (error) {
      getLogger().warn({ err: error, token }, 'Gagal memakai session /search');
      return false;
    }
  }

  /** Hapus key tanpa pernah melempar; tidak semua kegagalan perlu menggagalkan menu. */
  private async remove(key: string): Promise<void> {
    try {
      await this.store.delete(key);
    } catch (error) {
      getLogger().warn({ err: error, key }, 'Gagal membuang session /search');
    }
  }

  private track(token: string): void {
    if (this.trackedTokens.has(token)) return;

    if (this.trackedTokens.size >= TRACKED_TOKENS_LIMIT) {
      const oldest = this.trackedTokens.values().next();
      if (!oldest.done) this.trackedTokens.delete(oldest.value);
    }

    this.trackedTokens.add(token);
  }

  /**
   * Sapu daftar token sesekali.
   *
   * Tidak dijalankan setiap `put`: tiap penyapuan membaca semua token yang
   * dicatat, jadi di store bersama itu berarti banyak perjalanan bolak-balik
   * untuk setiap `/search`. Diambil setiap N penyimpanan, cukup untuk menahan
   * daftar tetap kecil tanpa jadi beban.
   */
  private maybeSweep(): void {
    this.putsSinceSweep += 1;
    if (this.putsSinceSweep < PRUNE_EVERY_PUTS) return;

    this.putsSinceSweep = 0;
    void this.prune();
  }

  private createToken(): string {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const token = this.tokenFactory();
      if (!this.trackedTokens.has(token)) return token;
    }

    // Lima tabrakan beruntun hampir mustahil. Kalau tetap terjadi, pakai token
    // acak lain daripada gagal menyimpan hasil untuk user.
    return `${this.tokenFactory()}${Date.now().toString(36)}`;
  }

  private isExpired(session: SearchSession): boolean {
    return this.now() - session.createdAt >= this.ttlMs;
  }
}

/** Key store untuk sebuah session. */
export function sessionKey(token: string): string {
  return `${SESSION_PREFIX}${token}`;
}

/** customId select menu untuk sebuah session. */
export function searchSelectCustomId(token: string): string {
  return `${SEARCH_SELECT_PREFIX}${token}`;
}

/**
 * Ambil token dari customId; null kalau bukan milik `/search`.
 *
 * Pola token juga menolak customId fitur lain yang kebetulan memakai awalan
 * yang sama, sehingga router tidak salah melompat ke handler ini.
 */
export function parseSearchCustomId(customId: string): string | null {
  if (!customId.startsWith(SEARCH_SELECT_PREFIX)) return null;

  const token = customId.slice(SEARCH_SELECT_PREFIX.length);
  return TOKEN_PATTERN.test(token) ? token : null;
}

/** Nilai opsi select menu: indeks lagu, supaya data mentah tidak masuk customId. */
export function searchOptionValue(index: number): string {
  return String(index);
}

/**
 * Baca nilai opsi select menu menjadi indeks.
 *
 * Menolak apa pun yang bukan bilangan bulat, supaya nilai rusak tidak pernah
 * sampai ke `tracks[NaN]` dan membuat Selection salah diam-diam.
 */
export function parseSearchOptionValue(value: string | undefined | null): number | null {
  if (value === undefined || value === null) return null;
  if (!/^\d{1,3}$/.test(value)) return null;

  return Number(value);
}

/** Potong teks ke batas Discord. */
export function clampOptionText(text: string, maxLength: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxLength) return trimmed;

  return `${trimmed.slice(0, Math.max(maxLength - 1, 1))}…`;
}

/**
 * Label opsi: judul lagu saja.
 *
 * Select menu Discord hanya menampilkan label dan description, jadi artis
 * ditulis di description supaya tidak hilang.
 */
export function searchOptionLabel(track: TrackInfo): string {
  return clampOptionText(track.title || 'Tanpa judul', MAX_OPTION_LABEL_LENGTH);
}

/** Description opsi: artis dan durasi, dipotong ke batas Discord. */
export function searchOptionDescription(track: TrackInfo): string {
  const duration = formatSeconds(track.durationMs);
  const author = track.author.trim();

  return clampOptionText(
    author ? `${author} • ${duration}` : duration,
    MAX_OPTION_DESCRIPTION_LENGTH,
  );
}

/** "3:45" atau "1:02:30"; durasi 0 (stream) menjadi "live". */
export function formatSeconds(durationMs: number): string {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return 'live';

  const totalSeconds = Math.trunc(durationMs / 1000);
  const hours = Math.trunc(totalSeconds / 3600);
  const minutes = Math.trunc((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (value: number): string => String(value).padStart(2, '0');

  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}