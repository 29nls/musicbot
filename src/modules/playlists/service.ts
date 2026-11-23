import { parsePlaylistName, PlaylistNameError } from './validation.js';
import type { PlaylistRepository } from './repository.js';
import {
  hasSameTrack,
  resolveStoredTracks,
  toStoredTrack,
  type ResolvedPlaylist,
  type TrackResolver,
} from './tracks.js';
import {
  MAX_PLAYLIST_TRACKS,
  PERSONAL_PLAYLIST_GUILD_ID,
  PLAYLIST_LIST_LIMIT,
} from './types.js';
import type {
  Playlist,
  PlaylistFailure,
  PlaylistResult,
  StoredTrack,
} from './types.js';
import type { TrackInfo } from '../music/types.js';

const ok = <T>(value: T): PlaylistResult<T> => ({ ok: true, value });
const fail = <T>(error: PlaylistFailure): PlaylistResult<T> => ({ ok: false, error });

/** Hasil menambah lagu: berapa yang benar-benar masuk, berapa yang dilewati. */
export interface AddedTracks {
  playlist: Playlist;
  added: number;
  /** Lagu yang sudah ada di playlist dan jadi tidak digandakan. */
  skippedDuplicates: number;
}

/**
 * Logika domain playlist.
 *
 * Tidak menyentuh Discord maupun Lavalink: pemutar disuntikkan sebagai
 * `TrackResolver` supaya alur pemuatan playlist bisa diuji tanpa node audio.
 */
export class PlaylistService {
  constructor(private readonly repository: PlaylistRepository) {}

  /** Buat playlist kosong. Nama ganda ditolak sebelum baris tersimpan. */
  async create(
    input: { guildId: string; ownerId: string; name: string },
    now = new Date(),
  ): Promise<PlaylistResult<Playlist>> {
    const name = parseName(input.name);
    if (!name.ok) return name;

    const existing = await this.repository.findByName(input.guildId, input.ownerId, name.value);
    if (existing) return fail({ kind: 'name-taken', name: existing.name });

    try {
      return ok(await this.repository.create({ ...input, name: name.value }, now));
    } catch (error) {
      if (isUniqueViolation(error)) return fail({ kind: 'name-taken', name: name.value });
      throw error;
    }
  }

  /**
   * Playlist milik member ini. `own=true` juga menyertakan playlist publik
   * milik orang lain, supaya `/playlist list` bisa jadi satu tempat melihat
   * semuanya.
   */
  async list(
    guildId: string,
    userId: string,
    options: { includePublic?: boolean } = {},
  ): Promise<Playlist[]> {
    const owned = await this.repository.listOwned(guildId, userId, PLAYLIST_LIST_LIMIT);
    if (!options.includePublic) return owned;

    const shared = await this.repository.listPublic(guildId, PLAYLIST_LIST_LIMIT);
    const sharedByOthers = shared.filter((playlist) => playlist.ownerId !== userId);

    return [...owned, ...sharedByOthers].slice(0, PLAYLIST_LIST_LIMIT);
  }

  /**
   * Cari playlist untuk diputar.
   *
   * Milik orang lain hanya boleh diambil kalau `isPublic` — itu bedanya "playlist
   * komunitas" dari "playlist pribadi": tanpa gerbang ini, siapa pun bisa memutar
   * playlist orang lain hanya dengan menebak namanya.
   */
  async findPlayable(
    guildId: string,
    userId: string,
    name: string,
  ): Promise<PlaylistResult<Playlist>> {
    const trimmed = name.trim();
    const own = await this.repository.findByName(guildId, userId, trimmed);
    if (own) return ok(own);

    // Playlist milik orang lain hanya bisa ditemukan lewat nama kalau publik.
    const shared = await this.repository.findPublicByName(guildId, trimmed);
    if (shared) return ok(shared);

    return fail({ kind: 'not-found' });
  }

  /** Tambah lagu ke playlist milik member ini. */
  async addTracks(
    guildId: string,
    userId: string,
    name: string,
    tracks: readonly TrackInfo[],
  ): Promise<PlaylistResult<AddedTracks>> {
    const playlist = await this.repository.findByName(guildId, userId, name.trim());
    if (!playlist) return fail({ kind: 'not-found' });

    return this.addToPlaylist(playlist, tracks, (id, fresh) =>
      this.repository.appendTracks(id, fresh),
    );
  }

  /** Hapus satu lagu; posisi dimulai dari 1 seperti `/remove`. */
  async removeTrack(
    guildId: string,
    userId: string,
    name: string,
    position: number,
  ): Promise<PlaylistResult<Playlist>> {
    const playlist = await this.repository.findByName(guildId, userId, name.trim());
    if (!playlist) return fail({ kind: 'not-found' });

    return this.removeAt(playlist, position, (id, index) =>
      this.repository.removeTrackAt(id, index),
    );
  }

  /**
   * Ubah status publik/pribadi. Hanya pemilik yang boleh.
   *
   * Playlist milik orang lain dilaporkan `not-found`, bukan `not-owner`:
   * membalas "itu bukan milikmu" berarti membocorkan bahwa playlist itu ada,
   * padahal nama yang ditebak harusnya tidak memberi informasi apa pun.
   */
  async setVisibility(
    guildId: string,
    userId: string,
    name: string,
    isPublic: boolean,
  ): Promise<PlaylistResult<Playlist>> {
    const playlist = await this.repository.findByName(guildId, userId, name.trim());
    if (!playlist) return fail({ kind: 'not-found' });
    if (playlist.ownerId !== userId) return fail({ kind: 'not-owner' });

    const updated = await this.repository.setPublic(playlist.id, isPublic);
    return updated ? ok(updated) : fail({ kind: 'not-found' });
  }

  /** Hapus playlist milik member ini; playlist orang lain dilaporkan `not-found`. */
  async remove(
    guildId: string,
    userId: string,
    name: string,
  ): Promise<PlaylistResult<Playlist>> {
    const playlist = await this.repository.findByName(guildId, userId, name.trim());
    if (!playlist) return fail({ kind: 'not-found' });
    if (playlist.ownerId !== userId) return fail({ kind: 'not-owner' });

    const deleted = await this.repository.delete(playlist.id);
    return deleted ? ok(playlist) : fail({ kind: 'not-found' });
  }

  // ── Playlist personal dashboard ────────────────────────────────────────────

  /**
   * Playlist personal satu user, lintas guild.
   *
   * `ownerId` datang dari session yang sudah diverifikasi, bukan badan
   * permintaan. Itu satu-satunya alasan query ini tidak membutuhkan `guildId`.
   */
  async listPersonal(ownerId: string): Promise<Playlist[]> {
    return this.repository.listPersonal(ownerId, PLAYLIST_LIST_LIMIT);
  }

  async createPersonal(
    ownerId: string,
    rawName: string,
    now = new Date(),
  ): Promise<PlaylistResult<Playlist>> {
    const name = parseName(rawName);
    if (!name.ok) return name;

    const existing = await this.repository.findPersonalByName(ownerId, name.value);
    if (existing) return fail({ kind: 'name-taken', name: existing.name });

    try {
      return ok(
        await this.repository.create(
          {
            guildId: PERSONAL_PLAYLIST_GUILD_ID,
            ownerId,
            name: name.value,
            scope: 'personal',
          },
          now,
        ),
      );
    } catch (error) {
      if (isUniqueViolation(error)) return fail({ kind: 'name-taken', name: name.value });
      throw error;
    }
  }

  /** Cari playlist personal berdasarkan ID; pemilik dan scope wajib cocok. */
  async findPersonalById(ownerId: string, playlistId: number): Promise<PlaylistResult<Playlist>> {
    const found = await this.repository.findById(playlistId);
    if (!found || found.scope !== 'personal' || found.ownerId !== ownerId) {
      return fail({ kind: 'not-found' });
    }

    return ok(found);
  }

  async renamePersonal(
    ownerId: string,
    playlistId: number,
    rawName: string,
  ): Promise<PlaylistResult<Playlist>> {
    const name = parseName(rawName);
    if (!name.ok) return name;

    const found = await this.findPersonalById(ownerId, playlistId);
    if (!found.ok) return found;

    const duplicate = await this.repository.findPersonalByName(ownerId, name.value);
    if (duplicate && duplicate.id !== playlistId) {
      return fail({ kind: 'name-taken', name: duplicate.name });
    }

    try {
      const updated = await this.repository.renamePersonal(playlistId, ownerId, name.value);
      return updated ? ok(updated) : fail({ kind: 'not-found' });
    } catch (error) {
      if (isUniqueViolation(error)) return fail({ kind: 'name-taken', name: name.value });
      if (isMissingRow(error)) return fail({ kind: 'not-found' });
      throw error;
    }
  }

  async removePersonal(
    ownerId: string,
    playlistId: number,
  ): Promise<PlaylistResult<Playlist>> {
    const found = await this.findPersonalById(ownerId, playlistId);
    if (!found.ok) return found;

    const deleted = await this.repository.deletePersonal(playlistId, ownerId);
    return deleted ? ok(found.value) : fail({ kind: 'not-found' });
  }

  async addTracksToPersonal(
    ownerId: string,
    playlistId: number,
    tracks: readonly TrackInfo[],
  ): Promise<PlaylistResult<AddedTracks>> {
    const found = await this.findPersonalById(ownerId, playlistId);
    if (!found.ok) return found;

    return this.addToPlaylist(found.value, tracks, (id, fresh) =>
      this.repository.appendPersonalTracks(id, ownerId, fresh),
    );
  }

  /** Hapus lagu personal berdasarkan posisi 0-based dari dashboard. */
  async removeTrackFromPersonal(
    ownerId: string,
    playlistId: number,
    index: number,
  ): Promise<PlaylistResult<Playlist>> {
    const found = await this.findPersonalById(ownerId, playlistId);
    if (!found.ok) return found;

    const current = found.value.tracks.length;
    if (!Number.isInteger(index) || index < 0 || index >= current) {
      return fail({ kind: 'out-of-range', count: current });
    }

    const updated = await this.repository.removePersonalTrackAt(playlistId, ownerId, index);
    return updated ? ok(updated) : fail({ kind: 'out-of-range', count: current });
  }

  /** Pindahkan lagu personal ke posisi lain; posisi 0-based. */
  async moveTrackInPersonal(
    ownerId: string,
    playlistId: number,
    fromIndex: number,
    toIndex: number,
  ): Promise<PlaylistResult<Playlist>> {
    const found = await this.findPersonalById(ownerId, playlistId);
    if (!found.ok) return found;

    const count = found.value.tracks.length;
    if (
      !Number.isInteger(fromIndex) ||
      !Number.isInteger(toIndex) ||
      fromIndex < 0 ||
      toIndex < 0 ||
      fromIndex >= count ||
      toIndex >= count
    ) {
      return fail({ kind: 'out-of-range', count });
    }

    if (fromIndex === toIndex) return ok(found.value);

    const updated = await this.repository.movePersonalTrackAt(
      playlistId,
      ownerId,
      fromIndex,
      toIndex,
    );

    return updated ? ok(updated) : fail({ kind: 'out-of-range', count });
  }

  /**
   * Muat playlist untuk diputar: resolve tiap entri lalu laporkan berapa yang
   * gagal, supaya angka "diputar" tidak pernah lebih besar dari yang benar-benar
   * bisa berbunyi.
   */
  async loadForPlay(
    playlist: Playlist,
    resolve: TrackResolver,
    requesterId: string,
  ): Promise<ResolvedPlaylist> {
    return resolveStoredTracks(playlist.tracks, resolve, requesterId);
  }

  private async addToPlaylist(
    playlist: Playlist,
    tracks: readonly TrackInfo[],
    append: (playlistId: number, tracks: readonly StoredTrack[]) => Promise<Playlist | null>,
  ): Promise<PlaylistResult<AddedTracks>> {
    // Batas dicek terhadap hasil akhir (sekarang + baru), bukan hanya jumlah
    // baru — playlist yang sudah penuh harus menolak satu lagu tambahan.
    const incoming: StoredTrack[] = tracks.map(toStoredTrack);
    const fresh = incoming.filter((track) => !hasSameTrack(playlist.tracks, track));

    if (playlist.tracks.length + fresh.length > MAX_PLAYLIST_TRACKS) {
      return fail({ kind: 'full', limit: MAX_PLAYLIST_TRACKS });
    }

    if (fresh.length === 0) {
      return ok({ playlist, added: 0, skippedDuplicates: incoming.length });
    }

    const updated = await append(playlist.id, fresh);
    if (!updated) return fail({ kind: 'not-found' });

    // Repository memeriksa ulang duplikat di dalam transaksi; hitung dari hasil
    // akhir supaya jumlah "ditambahkan" tidak pernah lebih besar dari kenyataan
    // saat dua tab menyimpan lagu yang sama hampir bersamaan.
    const added = Math.min(fresh.length, Math.max(updated.tracks.length - playlist.tracks.length, 0));

    return ok({
      playlist: updated,
      added,
      skippedDuplicates: incoming.length - added,
    });
  }

  private async removeAt(
    playlist: Playlist,
    position: number,
    remove: (playlistId: number, index: number) => Promise<Playlist | null>,
  ): Promise<PlaylistResult<Playlist>> {
    const index = position - 1;
    if (!Number.isInteger(index) || index < 0 || index >= playlist.tracks.length) {
      return fail({ kind: 'out-of-range', count: playlist.tracks.length });
    }

    const updated = await remove(playlist.id, index);
    if (!updated) return fail({ kind: 'out-of-range', count: playlist.tracks.length });

    return ok(updated);
  }
}

function parseName(raw: string): PlaylistResult<string> {
  try {
    return { ok: true, value: parsePlaylistName(raw) };
  } catch (error) {
    if (error instanceof PlaylistNameError) {
      return { ok: false, error: { kind: 'name-invalid', key: error.key, params: error.params } };
    }
    throw error;
  }
}

/**
 * Bentuk error Prisma yang bisa muncul saat dua permintaan balapan.
 *
 * Dicek lewat `code`, bukan `instanceof`: kelas error Prisma bisa berbeda antar
 * bundel (bot dan dashboard mengimpor klien yang sama dari jalur berbeda), dan
 * yang stabil di semua jalur adalah kode P2002/P2025.
 */
function isUniqueViolation(error: unknown): boolean {
  return errorCode(error) === 'P2002';
}

function isMissingRow(error: unknown): boolean {
  return errorCode(error) === 'P2025';
}

function errorCode(error: unknown): string | null {
  if (typeof error !== 'object' || error === null || !('code' in error)) return null;
  const code = (error as { code?: unknown }).code;

  return typeof code === 'string' ? code : null;
}
