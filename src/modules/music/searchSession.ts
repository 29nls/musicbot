import { randomBytes } from 'node:crypto';
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
 * - Session hidup di memori satu proses bot. Kalau bot nanti di-sharding, store
 *   ini harus pindah ke store bersama (Redis) sebelum sharding diaktifkan;
 *   selama satu proses, select menu selalu kembali ke proses yang membuatnya.
 */

/** Awalan customId select menu pencarian — dipakai router komponen. */
export const SEARCH_SELECT_PREFIX = 'musicsearch:';

/** Berapa hasil yang ditawarkan ke user (PRD §6.1: "Cari 5 hasil"). */
export const SEARCH_RESULT_LIMIT = 5;

/**
 * Umur session pencarian.
 *
 * 15 menit cukup untuk orang memilih dengan santai, dan cukup pendek supaya
 * select menu lama tidak bisa dipakai berbulan-bulan lalu.
 */
export const SEARCH_SESSION_TTL_MS = 15 * 60_000;

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

/**
 * Penyimpanan session pencarian untuk satu proses bot.
 *
 * Sengaja in-memory: hasil pencarian berumur pendek dan tidak perlu bertahan
 * melewati restart (lihat catatan di atas file ini).
 */
export class SearchSessionStore {
  private readonly sessions = new Map<string, SearchSession>();

  constructor(
    private readonly options: {
      ttlMs?: number;
      maxSessions?: number;
      now?: () => number;
      tokenFactory?: TokenFactory;
    } = {},
  ) {}

  /** Berapa session yang tersimpan sebelum penyapuan berikutnya. */
  get size(): number {
    return this.sessions.size;
  }

  /**
   * Simpan hasil pencarian dan kembalikan session-nya.
   *
   * `tracks` dipotong jadi `SEARCH_RESULT_LIMIT` supaya sesuai PRD dan supaya
   * select menu tidak mungkin melewati batas 25 opsi Discord.
   */
  put(input: {
    guildId: string;
    requesterId: string;
    query: string;
    tracks: readonly TrackInfo[];
  }): SearchSession {
    this.prune();

    const session: SearchSession = {
      token: this.createToken(),
      guildId: input.guildId,
      requesterId: input.requesterId,
      query: input.query.trim(),
      tracks: input.tracks.slice(0, SEARCH_RESULT_LIMIT),
      createdAt: this.now(),
    };

    this.sessions.set(session.token, session);
    this.enforceCapacity();

    return session;
  }

  /** Ambil session tanpa menghapus; dipakai untuk render ulang dan tes. */
  peek(token: string): SearchSession | undefined {
    const session = this.sessions.get(token);
    if (!session) return undefined;

    if (this.isExpired(session)) {
      this.sessions.delete(token);
      return undefined;
    }

    return session;
  }

  /** Buang satu session (mis. hasil pencarian yang tidak pernah dipilih). */
  delete(token: string): void {
    this.sessions.delete(token);
  }

  /**
   * Terjemahkan pilihan select menu menjadi lagu.
   *
   * Session dibuang saat dipakai: select menu Discord masih bisa diklik dua kali
   * (klik kedua kadang tidak terkirim ke bot), jadi satu pilihan tidak boleh
   * bisa menambahkan lagu dua kali.
   */
  take(input: {
    token: string;
    guildId: string;
    userId: string;
    /** Indeks opsi yang dipilih, dari `values[0]`. */
    index: number;
  }): SearchSelection {
    const session = this.peek(input.token);

    if (!session) return { kind: 'expired' };

    // Milik server lain: jangan sampai satu server memutar lagu yang hasil
    // Pencariannya di server lain.
    if (session.guildId !== input.guildId) return { kind: 'other-guild' };

    if (session.requesterId !== input.userId) return { kind: 'not-owner' };

    const track = session.tracks[input.index];
    if (!track) return { kind: 'bad-index' };

    this.sessions.delete(input.token);

    return { kind: 'ok', track };
  }

  /** Buang session yang sudah melewati umur; mengembalikan jumlah yang dibuang. */
  prune(): number {
    let removed = 0;

    for (const [token, session] of this.sessions) {
      if (this.isExpired(session)) {
        this.sessions.delete(token);
        removed += 1;
      }
    }

    return removed;
  }

  /** Kosongkan semua session; dipakai saat bot akan keluar. */
  clear(): void {
    this.sessions.clear();
  }

  private isExpired(session: SearchSession): boolean {
    return this.now() - session.createdAt >= this.ttlMs;
  }

  private createToken(): string {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const token = this.tokenFactory();
      if (!this.sessions.has(token)) return token;
    }

    // Lima tabrakan beruntun hampir mustahil. Kalau tetap terjadi, pakai token
    // acak lain daripada gagal menyimpan hasil untuk user.
    return `${this.tokenFactory()}${Date.now().toString(36)}`;
  }

  /** Batasi jumlah session supaya server ramai tidak menahan memori tanpa batas. */
  private enforceCapacity(): void {
    // Map mempertahankan urutan sisip, jadi kunci pertama adalah yang tertua.
    while (this.sessions.size > this.maxSessions) {
      const oldest = this.sessions.keys().next();
      if (oldest.done) return;
      this.sessions.delete(oldest.value);
    }
  }

  private get ttlMs(): number {
    return this.options.ttlMs ?? SEARCH_SESSION_TTL_MS;
  }

  private get maxSessions(): number {
    return this.options.maxSessions ?? 200;
  }

  private get tokenFactory(): TokenFactory {
    return this.options.tokenFactory ?? defaultTokenFactory;
  }

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }
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