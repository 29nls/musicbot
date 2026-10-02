import { describe, expect, it } from 'vitest';
import { MusicQueue } from '../src/modules/music/queue.js';
import type { TrackInfo } from '../src/modules/music/types.js';

function track(title: string, durationMs = 60_000): TrackInfo {
  return {
    encoded: `encoded-${title}`,
    title,
    author: 'Artis',
    durationMs,
    uri: null,
    artworkUrl: null,
    isStream: false,
    requesterId: '123456789012345678',
  };
}

describe('MusicQueue', () => {
  it('menambahkan lagu dan melaporkan jumlah yang masuk', () => {
    const queue = new MusicQueue(5);
    const accepted = queue.add([track('a'), track('b')]);

    expect(accepted).toBe(2);
    expect(queue.size).toBe(2);
  });

  it('memotong lagu yang melebihi kapasitas', () => {
    const queue = new MusicQueue(2);
    const accepted = queue.add([track('a'), track('b'), track('c')]);

    expect(accepted).toBe(2);
    expect(queue.toArray().map((item) => item.title)).toEqual(['a', 'b']);
  });

  it('tidak menerima apa pun saat sudah penuh', () => {
    const queue = new MusicQueue(1);
    queue.add([track('a')]);

    expect(queue.isFull).toBe(true);
    expect(queue.remainingCapacity).toBe(0);
    expect(queue.add([track('b')])).toBe(0);
  });

  it('mengambil lagu secara FIFO', () => {
    const queue = new MusicQueue(5);
    queue.add([track('a'), track('b')]);

    expect(queue.shift()?.title).toBe('a');
    expect(queue.shift()?.title).toBe('b');
    expect(queue.shift()).toBeUndefined();
  });

  it('menghapus lagu berdasarkan posisi 1-based seperti yang dilihat user', () => {
    const queue = new MusicQueue(5);
    queue.add([track('a'), track('b'), track('c')]);

    expect(queue.remove(2)?.title).toBe('b');
    expect(queue.toArray().map((item) => item.title)).toEqual(['a', 'c']);
    expect(queue.remove(0)).toBeUndefined();
    expect(queue.remove(9)).toBeUndefined();
  });

  it('membersihkan antrean tanpa menyentuh kapasitas', () => {
    const queue = new MusicQueue(3);
    queue.add([track('a'), track('b')]);
    queue.clear();

    expect(queue.size).toBe(0);
    expect(queue.add([track('c'), track('d')])).toBe(2);
  });

  it('menjumlahkan durasi dan mengabaikan siaran langsung', () => {
    const queue = new MusicQueue(5);
    queue.add([
      track('a', 60_000),
      { ...track('live'), isStream: true, durationMs: 0 },
      track('c', 30_000),
    ]);

    expect(queue.totalDurationMs()).toBe(90_000);
  });

  it('toArray mengembalikan salinan, bukan referensi internal', () => {
    const queue = new MusicQueue(5);
    queue.add([track('a')]);

    const snapshot = queue.toArray();
    snapshot.push(track('b'));

    expect(queue.size).toBe(1);
  });
});
