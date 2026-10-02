import { describe, expect, it } from 'vitest';
import { AutomodTracker } from '../src/modules/automod/tracker.js';

const record = (tracker: AutomodTracker, content: string, userId = 'user-1', guildId = 'guild-1') =>
  tracker.record({ guildId, userId, content });

describe('AutomodTracker', () => {
  it('menghitung pesan di dalam jendela anti-spam lalu mereset setelah lewat', () => {
    let now = 1_000;
    const tracker = new AutomodTracker({ now: () => now });

    for (let index = 0; index < 5; index += 1) {
      expect(record(tracker, `pesan ${index}`).recentMessageCount).toBe(index + 1);
    }

    now += 4_999;
    expect(record(tracker, 'masih dalam jendela').recentMessageCount).toBe(6);

    now += 5_001;
    expect(record(tracker, 'jendela baru').recentMessageCount).toBe(1);
  });

  it('menghitung pesan identik berturut-turut (case-insensitive)', () => {
    const tracker = new AutomodTracker();

    expect(record(tracker, 'Halo').duplicateStreak).toBe(1);
    expect(record(tracker, 'halo').duplicateStreak).toBe(2);
    expect(record(tracker, '  HALO  ').duplicateStreak).toBe(3);
    expect(record(tracker, 'pesan lain').duplicateStreak).toBe(1);
  });

  it('pesan tanpa teks tidak dianggap duplikat', () => {
    const tracker = new AutomodTracker();

    expect(record(tracker, '').duplicateStreak).toBe(0);
    expect(record(tracker, '').duplicateStreak).toBe(0);
    expect(record(tracker, '   ').duplicateStreak).toBe(0);
  });

  it('state terpisah per guild dan per user', () => {
    const tracker = new AutomodTracker();

    record(tracker, 'sama', 'user-1', 'guild-1');
    record(tracker, 'sama', 'user-1', 'guild-1');

    expect(record(tracker, 'sama', 'user-2', 'guild-1').duplicateStreak).toBe(1);
    expect(record(tracker, 'sama', 'user-1', 'guild-2').duplicateStreak).toBe(1);
  });

  it('membersihkan entry lama saat melebihi batas', () => {
    let now = 1_000;
    const tracker = new AutomodTracker({ now: () => now, maxEntries: 2 });

    record(tracker, 'a', 'user-1');
    record(tracker, 'a', 'user-2');
    now += 20_000;
    record(tracker, 'a', 'user-3');

    // user-1 & user-2 sudah terlalu lama sehingga dibersihkan sebelum user-3 masuk.
    expect(record(tracker, 'b', 'user-3').recentMessageCount).toBe(2);
  });
});
