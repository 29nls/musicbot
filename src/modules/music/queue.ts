import { shuffleTracks, type RandomSource } from './shuffle.js';
import { totalDurationMs } from './track.js';
import type { TrackInfo } from './types.js';

/**
 * Antrean lagu milik bot untuk satu server.
 *
 * Hanya berisi lagu yang **belum** diputar: lagu yang sedang berjalan disimpan
 * terpisah karena Lavalink tidak mengembalikan metadata lewat `player.track`
 * (hanya data base64). Isi antrean ini adalah sumber kebenaran.
 */
export class MusicQueue {
  private readonly tracks: TrackInfo[] = [];

  constructor(private readonly capacity: number) {}

  get size(): number {
    return this.tracks.length;
  }

  get isFull(): boolean {
    return this.tracks.length >= this.capacity;
  }

  get remainingCapacity(): number {
    return Math.max(this.capacity - this.tracks.length, 0);
  }

  /**
   * Tambahkan lagu di belakang antrean.
   * @returns jumlah lagu yang benar-benar masuk (kelebihan kapasitas dipotong).
   */
  add(tracks: readonly TrackInfo[]): number {
    const accepted = tracks.slice(0, this.remainingCapacity);
    this.tracks.push(...accepted);

    return accepted.length;
  }

  /** Ambil lagu berikutnya (FIFO). */
  shift(): TrackInfo | undefined {
    return this.tracks.shift();
  }

  /** Hapus lagu pada posisi 1-based (seperti yang ditampilkan ke user). */
  remove(position: number): TrackInfo | undefined {
    const index = Math.trunc(position) - 1;
    if (index < 0 || index >= this.tracks.length) return undefined;

    return this.tracks.splice(index, 1)[0];
  }

  /**
   * Pindahkan lagu dari satu posisi ke posisi lain (1-based, seperti tampilannya).
   *
   * Mengembalikan null kalau salah satu posisi di luar jangkauan; memindahkan ke
   * posisi yang sama dianggap tidak berubah, bukan kegagalan.
   */
  move(from: number, to: number): TrackInfo | null {
    const fromIndex = Math.trunc(from) - 1;
    const toIndex = Math.trunc(to) - 1;

    if (fromIndex < 0 || fromIndex >= this.tracks.length) return null;
    if (toIndex < 0 || toIndex >= this.tracks.length) return null;
    if (fromIndex === toIndex) return this.tracks[fromIndex] ?? null;

    const [moved] = this.tracks.splice(fromIndex, 1);
    if (!moved) return null;

    this.tracks.splice(toIndex, 0, moved);
    return moved;
  }

  /** Acak urutan antrean; mengembalikan jumlah lagu yang diacak. */
  shuffle(random: RandomSource = Math.random): number {
    const shuffled = shuffleTracks(this.tracks, random);
    this.tracks.length = 0;
    this.tracks.push(...shuffled);

    return this.tracks.length;
  }

  clear(): void {
    this.tracks.length = 0;
  }

  /** Salinan isi antrean — aman dipakai untuk render embed. */
  toArray(): TrackInfo[] {
    return [...this.tracks];
  }

  /** Total durasi semua lagu di antrean. */
  totalDurationMs(): number {
    return totalDurationMs(this.tracks);
  }
}
