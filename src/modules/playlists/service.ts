import { parsePlaylistName, PlaylistNameError } from './validation.js';
import type { PlaylistRepository } from './repository.js';
import {
  resolveStoredTracks,
  toStoredTrack,
  type ResolvedPlaylist,
  type TrackResolver,
} from './tracks.js';
import { MAX_PLAYLIST_TRACKS, PLAYLIST_LIST_LIMIT } from './types.js';
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
    let name: string;
    try {
      name = parsePlaylistName(input.name);
    } catch (error) {
      if (error instanceof PlaylistNameError) {
        return fail({ kind: 'name-invalid', message: error.message });
      }
      throw error;
    }

    const existing = await this.repository.findByName(input.guildId, input.ownerId, name);
    if (existing) return fail({ kind: 'name-taken', name: existing.name });

    return ok(await this.repository.create({ ...input, name }, now));
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

    const updated = await this.repository.appendTracks(playlist.id, fresh);
    if (!updated) return fail({ kind: 'not-found' });

    return ok({
      playlist: updated,
      added: fresh.length,
      skippedDuplicates: incoming.length - fresh.length,
    });
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

    const index = position - 1;
    if (!Number.isInteger(index) || index < 0 || index >= playlist.tracks.length) {
      return fail({ kind: 'out-of-range', count: playlist.tracks.length });
    }

    const updated = await this.repository.removeTrackAt(playlist.id, index);
    if (!updated) return fail({ kind: 'out-of-range', count: playlist.tracks.length });

    return ok(updated);
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
}

/**
 * Dua entri dianggap lagu sama.
 *
 * Sumber yang sama (uri) adalah bukti terkuat, jadi itu yang dibandingkan lebih
 * dulu. Kalau salah satu tidak punya uri, Bandingkan judul + artis.
 *
 * `encoded` sengaja **tidak** dipakai sebagai pembeda: string base64 berbeda setiap
 * kali lagu yang sama di-resolve ulang, jadi memakainya membuat trek yang sama
 * terduplikasi hanya karena/node Lavalink yang menyelesaikannya berubah.
 */
export function hasSameTrack(tracks: readonly StoredTrack[], candidate: StoredTrack): boolean {
  return tracks.some((track) => {
    if (candidate.uri && track.uri) return candidate.uri === track.uri;

    return isSameText(track.title, candidate.title) && isSameText(track.author, candidate.author);
  });
}

function isSameText(left: string, right: string): boolean {
  return left.trim().toLocaleLowerCase('id') === right.trim().toLocaleLowerCase('id');
}