import { describe, expect, it } from 'vitest';
import {
  SHARED_STATE_TTL_MS,
  SharedMusicState,
  sharedStateKey,
} from '../src/modules/music/sharedState.js';
import {
  MAX_STORED_TRACKS,
  decodeSharedMusicState,
  emptyRecord,
  encodeSharedMusicState,
} from '../src/modules/music/sharedStateCodec.js';
import type { LoopMode } from '../src/modules/music/loop.js';
import type { TrackInfo } from '../src/modules/music/types.js';
import {
  MemoryKeyValueStore,
  type CompareAndSetOptions,
  type KeyValueStore,
  type SetOptions,
} from '../src/services/kvStore.js';

function track(overrides: Partial<TrackInfo> = {}): TrackInfo {
  return {
    encoded: 'encoded-1',
    title: 'Lagu Satu',
    author: 'Artis Satu',
    durationMs: 210_000,
    uri: null,
    artworkUrl: null,
    isStream: false,
    requesterId: '123456789012345678',
    ...overrides,
  };
}

function tracks(count: number): TrackInfo[] {
  return Array.from({ length: count }, (_, index) =>
    track({ encoded: `encoded-${index}`, title: `Lagu ${index}`, durationMs: 1000 }),
  );
}

/** Store yang mencatat semua operasi, untuk memeriksa apa yang benar-benar ditulis. */
class RecordingStore implements KeyValueStore {
  readonly values = new Map<string, string>();
  readonly setCalls: { key: string; options: SetOptions | undefined }[] = [];
  readonly getCalls: string[] = [];

  async get(key: string): Promise<string | null> {
    this.getCalls.push(key);
    return this.values.get(key) ?? null;
  }

  async set(key: string, value: string, options?: SetOptions): Promise<void> {
    this.setCalls.push({ key, options });
    this.values.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.values.delete(key);
  }

  async take(key: string): Promise<string | null> {
    const value = this.values.get(key) ?? null;
    this.values.delete(key);
    return value;
  }

  async increment(): Promise<number> {
    return 1;
  }

  async close(): Promise<void> {
    this.values.clear();
  }
}

/** Store yang gagal membaca; dipakai untuk menguji aturan "baca gagal = jangan tulis". */
class BrokenReadStore extends MemoryKeyValueStore {
  writes = 0;

  override async get(): Promise<string | null> {
    throw new Error('store mati');
  }

  override async set(key: string, value: string, options?: SetOptions): Promise<void> {
    this.writes += 1;
    await super.set(key, value, options);
  }
}

/** Store yang baca normal tapi menulis selalu gagal. */
class BrokenWriteStore extends MemoryKeyValueStore {
  // `compareAndSet` sengaja ikut gagal: kalau hanya `set` yang gagal, store ini
  // akan Diam-diam menjadi store yang bisa menulis.
  override async set(): Promise<void> {
    throw new Error('tulis gagal');
  }

  override async compareAndSet(): Promise<boolean> {
    throw new Error('tulis gagal');
  }
}

/**
 * Store yang menyimulasikan proses lain yang menulis duluan.
 *
 * Tiap kali `compareAndSet` dipanggil, store ini menyisipkan perubahan "musuh"
 * lebih dulu lalu Membiarkan perbandingan gagal — persis balapan yang terjadi
 * ketika dua shard mengubah antrean guild yang sama pada saat yang sama.
 */
class RivalWriterStore extends MemoryKeyValueStore {
  /** Track yang disisipkan proses lain pada penulisan berikutnya. */
  rivalTrack: TrackInfo | null = null;
  /** Kalau diisi, proses lain mengubah mode loop, bukan antrean. */
  rivalLoopMode: LoopMode | null = null;
  /** Berapa kali `compareAndSet` dipanggil. */
  attempts = 0;
  /** Kalau true, proses lain selalu menulis duluan, jadi CAS tidak pernah berhasil. */
  alwaysRival = false;

  override async compareAndSet(
    key: string,
    value: string,
    options: CompareAndSetOptions,
  ): Promise<boolean> {
    this.attempts += 1;
    await this.writeRival(key, options.expectedValue);

    return super.compareAndSet(key, value, options);
  }

  private async writeRival(key: string, expectedValue: string | null): Promise<void> {
    if (!this.alwaysRival && !this.rivalTrack && !this.rivalLoopMode) return;

    const raw = await this.get(key);
    const record = decodeSharedMusicState(raw ?? expectedValue);

    const track = this.rivalTrack;
    const loopMode = this.rivalLoopMode;
    this.rivalTrack = null;
    this.rivalLoopMode = null;

    await this.set(
      key,
      encodeSharedMusicState({
        tracks: track ? [...record.tracks, track] : record.tracks,
        loopMode: loopMode ?? record.loopMode,
        updatedAt: record.updatedAt,
        version: record.version + 1,
      }),
      { ttlMs: 60_000 },
    );
  }
}

function state(overrides: Partial<ConstructorParameters<typeof SharedMusicState>[0]> = {}): SharedMusicState {
  return new SharedMusicState({ capacity: 5, store: new MemoryKeyValueStore(), ...overrides });
}

describe('codec state musik bersama', () => {
  it('mempertahankan seluruh isi record lewat encode lalu decode', () => {
    const record = {
      tracks: [track({ encoded: 'a' }), track({ encoded: 'b', isStream: true })],
      loopMode: 'queue' as const,
      updatedAt: 1_700_000_000_000,
      version: 7,
    };

    expect(decodeSharedMusicState(encodeSharedMusicState(record))).toEqual(record);
  });

  it('mengubah record kosong jadi bentuk yang bisa dibaca', () => {
    expect(decodeSharedMusicState(encodeSharedMusicState(emptyRecord()))).toEqual(emptyRecord());
  });

  it('membaca key yang hilang sebagai record kosong', () => {
    expect(decodeSharedMusicState(null)).toEqual(emptyRecord());
    expect(decodeSharedMusicState('')).toEqual(emptyRecord());
  });

  it('membaca JSON rusak sebagai record kosong, bukan melempar', () => {
    expect(decodeSharedMusicState('{bukan json')).toEqual(emptyRecord());
    expect(decodeSharedMusicState('[]')).toEqual(emptyRecord());
    expect(decodeSharedMusicState('42')).toEqual(emptyRecord());
    expect(decodeSharedMusicState('"halo"')).toEqual(emptyRecord());
  });

  it('membuang track tanpa encoded, tapi mempertahankan sisanya', () => {
    const raw = JSON.stringify({
      tracks: [
        { encoded: 'nyata', durationMs: 1000 },
        { title: 'tanpa encoded', durationMs: 1000 },
        { encoded: 'nyata-2', durationMs: 'bukan angka' },
        { encoded: 'nyata-3', durationMs: 2000 },
      ],
      loopMode: 'off',
    });

    expect(decodeSharedMusicState(raw).tracks.map((item) => item.encoded)).toEqual(['nyata', 'nyata-3']);
  });

  it('membuang track yang bukan objek', () => {
    const raw = JSON.stringify({ tracks: [null, 'bukan', 7, { encoded: 'nyata', durationMs: 1 }] });

    expect(decodeSharedMusicState(raw).tracks).toHaveLength(1);
  });

  it('membatasi jumlah track yang diterima dari store', () => {
    const raw = JSON.stringify({
      tracks: Array.from({ length: MAX_STORED_TRACKS + 50 }, (_, index) => ({
        encoded: `encoded-${index}`,
        durationMs: 1000,
      })),
    });

    expect(decodeSharedMusicState(raw).tracks).toHaveLength(MAX_STORED_TRACKS);
  });

  it('menurunkan mode loop yang tidak dikenal ke off', () => {
    const raw = JSON.stringify({ tracks: [], loopMode: 'repeater' });

    expect(decodeSharedMusicState(raw).loopMode).toBe('off');
  });

  it('menurunkan number yang rusak ke nol', () => {
    const raw = JSON.stringify({ tracks: [], updatedAt: 'kemarin', version: null });

    expect(decodeSharedMusicState(raw)).toMatchObject({ updatedAt: 0, version: 0 });
  });

  it('menganggap tracks yang bukan array sebagai antrean kosong', () => {
    expect(decodeSharedMusicState(JSON.stringify({ tracks: 'banyak' })).tracks).toEqual([]);
  });
});

describe('SharedMusicState', () => {
  it('menyimpan antrean yang ditambahkan dan mengembalikannya lewat tracks()', async () => {
    const shared = state();

    const result = await shared.add('guild-1', [track({ encoded: 'a' }), track({ encoded: 'b' })]);

    expect(result.accepted.map((item) => item.encoded)).toEqual(['a', 'b']);
    expect(result.skipped).toBe(0);
    expect(result.size).toBe(2);
    expect(shared.tracks('guild-1').map((item) => item.encoded)).toEqual(['a', 'b']);
    expect(shared.size('guild-1')).toBe(2);
  });

  it('memotong kelebihan kapasitas dan melaporkan jumlah yang terpotong', async () => {
    const shared = state({ capacity: 2 });

    const result = await shared.add('guild-1', tracks(5));

    expect(result.accepted).toHaveLength(2);
    expect(result.skipped).toBe(3);
    expect(result.size).toBe(2);
  });

  it('menjumlahkan durasi antrean dari salinan lokal', async () => {
    const shared = state();

    await shared.add('guild-1', [
      track({ encoded: 'a', durationMs: 1_000 }),
      track({ encoded: 'b', durationMs: 2_000 }),
    ]);

    expect(shared.upcomingDurationMs('guild-1')).toBe(3_000);
  });

  it('menggeser antrean dalam urutan FIFO', async () => {
    const shared = state();
    await shared.add('guild-1', [track({ encoded: 'a' }), track({ encoded: 'b' })]);

    expect((await shared.shift('guild-1'))?.encoded).toBe('a');
    expect((await shared.shift('guild-1'))?.encoded).toBe('b');
    expect(await shared.shift('guild-1')).toBeUndefined();
  });

  it('menghapus dan memindahkan lagu pada posisi 1-based', async () => {
    const shared = state();
    await shared.add('guild-1', tracks(3));

    expect((await shared.remove('guild-1', 2))?.encoded).toBe('encoded-1');
    expect(shared.tracks('guild-1').map((item) => item.encoded)).toEqual(['encoded-0', 'encoded-2']);

    expect((await shared.move('guild-1', 1, 2))?.encoded).toBe('encoded-0');
    expect(shared.tracks('guild-1').map((item) => item.encoded)).toEqual(['encoded-2', 'encoded-0']);
    expect(await shared.move('guild-1', 9, 1)).toBeNull();
    expect(await shared.remove('guild-1', 9)).toBeUndefined();
  });

  it('mengacak urutan antrean dan mengembalikan jumlahnya', async () => {
    const shared = state();
    await shared.add('guild-1', tracks(3));

    expect(await shared.shuffle('guild-1', () => 0)).toBe(3);
    expect(shared.tracks('guild-1')).toHaveLength(3);
  });

  it('mengganti seluruh isi antrean', async () => {
    const shared = state({ capacity: 2 });
    await shared.add('guild-1', tracks(3));

    expect(await shared.replace('guild-1', tracks(5))).toBe(2);
    expect(shared.size('guild-1')).toBe(2);
  });

  it('mengembalikan mode loop sebelumnya saat mode diubah', async () => {
    const shared = state();

    expect(shared.loopMode('guild-1')).toBe('off');
    expect(await shared.setLoopMode('guild-1', 'queue')).toBe('off');
    expect(shared.loopMode('guild-1')).toBe('queue');
    expect(await shared.setLoopMode('guild-1', 'track')).toBe('queue');
  });

  it('mengosongkan antrean tanpa mengubah mode loop saat clearTracks', async () => {
    const shared = state();
    await shared.add('guild-1', tracks(2));
    await shared.setLoopMode('guild-1', 'queue');

    await shared.clearTracks('guild-1');

    expect(shared.size('guild-1')).toBe(0);
    expect(shared.loopMode('guild-1')).toBe('queue');
  });

  it('membuang antrean sekaligus mode loop saat reset', async () => {
    const shared = state();
    await shared.add('guild-1', tracks(2));
    await shared.setLoopMode('guild-1', 'queue');

    await shared.reset('guild-1');

    expect(shared.size('guild-1')).toBe(0);
    expect(shared.loopMode('guild-1')).toBe('off');
  });

  it('menyimpan record dengan masa berlaku di store bersama', async () => {
    const store = new RecordingStore();
    const shared = new SharedMusicState({ capacity: 5, store, ttlMs: 60_000 });

    await shared.add('guild-1', [track()]);

    expect(store.setCalls).toHaveLength(1);
    expect(store.setCalls[0]?.key).toBe(sharedStateKey('guild-1'));
    expect(store.setCalls[0]?.options).toEqual({ ttlMs: 60_000 });
  });

  it('memakai masa berlaku bawaan saat ttlMs tidak diisi', () => {
    expect(SHARED_STATE_TTL_MS).toBe(12 * 60 * 60_000);
  });

  it('membaca state milik proses lain lewat refresh', async () => {
    const store = new MemoryKeyValueStore();
    const writer = new SharedMusicState({ capacity: 5, store });
    const reader = new SharedMusicState({ capacity: 5, store });

    await writer.add('guild-1', [track({ encoded: 'dari-proses-lain' })]);

    expect(reader.size('guild-1')).toBe(0);
    await reader.refresh('guild-1');
    expect(reader.tracks('guild-1').map((item) => item.encoded)).toEqual(['dari-proses-lain']);
  });

  it('melihat penambahan dari proses lain saat mengubah antrean', async () => {
    const store = new MemoryKeyValueStore();
    const first = new SharedMusicState({ capacity: 5, store });
    const second = new SharedMusicState({ capacity: 5, store });

    await first.add('guild-1', [track({ encoded: 'a' })]);
    await second.add('guild-1', [track({ encoded: 'b' })]);

    await first.refresh('guild-1');
    expect(first.tracks('guild-1').map((item) => item.encoded)).toEqual(['a', 'b']);
  });

  it('menaikkan nomor versi setiap penulisan', async () => {
    const shared = state();

    await shared.add('guild-1', [track()]);
    await shared.add('guild-1', [track({ encoded: 'kedua' })]);

    expect(shared.cached('guild-1').version).toBe(2);
  });

  it('tidak menulis ulang record yang tidak berubah', async () => {
    const store = new RecordingStore();
    const shared = new SharedMusicState({ capacity: 5, store });

    await shared.add('guild-1', []);
    expect(store.setCalls).toHaveLength(0);

    await shared.shift('guild-1');
    expect(store.setCalls).toHaveLength(0);

    await shared.add('guild-1', [track()]);
    expect(store.setCalls).toHaveLength(1);
  });

  it('tidak menulis ulang state saat mode loop tidak berubah', async () => {
    const store = new RecordingStore();
    const shared = new SharedMusicState({ capacity: 5, store });

    await shared.setLoopMode('guild-1', 'queue');
    await shared.setLoopMode('guild-1', 'queue');

    expect(store.setCalls).toHaveLength(1);
  });

  it('meneruskan perubahan antrean dari mutateQueue dan menulisnya sekali', async () => {
    const store = new RecordingStore();
    const shared = new SharedMusicState({ capacity: 5, store });
    await shared.add('guild-1', tracks(2));

    const result = await shared.mutateQueue('guild-1', (queue, record) => {
      record.loopMode = 'track';
      return queue.size;
    });

    expect(result).toBe(2);
    expect(shared.loopMode('guild-1')).toBe('track');
    expect(store.setCalls).toHaveLength(2);
  });

  it('tetap berjalan dan tidak menulis apa pun saat baca store gagal', async () => {
    const store = new BrokenReadStore();
    const shared = new SharedMusicState({ capacity: 5, store });

    const result = await shared.add('guild-1', [track({ encoded: 'a' })]);

    expect(result.accepted).toHaveLength(1);
    expect(shared.size('guild-1')).toBe(1);
    expect(store.writes).toBe(0);
  });

  it('tetap jalan di salinan lokal saat penulisan store gagal', async () => {
    const shared = new SharedMusicState({ capacity: 5, store: new BrokenWriteStore() });

    const result = await shared.add('guild-1', [track({ encoded: 'a' })]);

    expect(result.accepted).toHaveLength(1);
    expect(shared.size('guild-1')).toBe(1);
  });

  it('mengembalikan salinan, bukan isi yang bisa diubah diam-diam', async () => {
    const shared = state();
    await shared.add('guild-1', [track({ encoded: 'a' })]);

    shared.tracks('guild-1').push(track({ encoded: 'penyusup' }));
    shared.cached('guild-1').loopMode = 'queue';

    expect(shared.size('guild-1')).toBe(1);
    expect(shared.loopMode('guild-1')).toBe('off');
  });

  it('melupakan salinan lokal saat guild dilepas', async () => {
    const shared = state();
    await shared.add('guild-1', [track()]);
    await shared.add('guild-2', [track()]);
    expect(shared.mirrorSize).toBe(2);

    shared.forget('guild-1');
    expect(shared.mirrorSize).toBe(1);

    shared.forgetAll();
    expect(shared.mirrorSize).toBe(0);
  });

  it('membuang salinan lokal paling lama saat melebihi batas', async () => {
    const shared = new SharedMusicState({ capacity: 1, store: new MemoryKeyValueStore() });

    for (let index = 0; index < 520; index += 1) {
      await shared.refresh(`guild-${index}`);
    }

    expect(shared.mirrorSize).toBeLessThanOrEqual(500);
  });

  it('memakai minimal satu kapasitas walau diberi angka tidak masuk akal', async () => {
    const shared = new SharedMusicState({ capacity: 0, store: new MemoryKeyValueStore() });

    const result = await shared.add('guild-1', tracks(3));

    expect(result.accepted).toHaveLength(1);
  });

  it('mengembalikan record kosong untuk guild yang tidak pernah dilihat', () => {
    const shared = state();

    expect(shared.cached('tidak-ada')).toEqual(emptyRecord());
    expect(shared.tracks('tidak-ada')).toEqual([]);
    expect(shared.size('tidak-ada')).toBe(0);
    expect(shared.upcomingDurationMs('tidak-ada')).toBe(0);
    expect(shared.loopMode('tidak-ada')).toBe('off');
  });
});

describe('SharedMusicState — mutasi atomik', () => {
  it('mengulangi perubahan di atas perubahan proses lain, bukan menimpanya', async () => {
    const store = new RivalWriterStore();
    const shared = new SharedMusicState({ capacity: 10, store });
    await shared.add('guild-1', [track({ encoded: 'awal' })]);
    const sebelum = store.attempts;

    // Proses lain menyisipkan lagunya di antara baca dan tulis kita.
    store.rivalTrack = track({ encoded: 'dari-proses-lain' });

    const result = await shared.add('guild-1', [track({ encoded: 'punya-saya' })]);

    expect(result.accepted).toHaveLength(1);
    // Satu percobaan gagal, lalu satu lagi berhasil di atas keadaan terbaru.
    expect(store.attempts - sebelum).toBe(2);

    await shared.refresh('guild-1');
    expect(shared.tracks('guild-1').map((item) => item.encoded)).toEqual([
      'awal',
      'dari-proses-lain',
      'punya-saya',
    ]);
  });

  it('menjalankan mutasi yang sudah dipakai dua proses tanpa kehilangan satu pun', async () => {
    const store = new MemoryKeyValueStore();
    const first = new SharedMusicState({ capacity: 10, store });
    const second = new SharedMusicState({ capacity: 10, store });

    await first.add('guild-1', [track({ encoded: 'a' })]);
    await second.add('guild-1', [track({ encoded: 'b' })]);

    await first.refresh('guild-1');
    expect(first.tracks('guild-1').map((item) => item.encoded)).toEqual(['a', 'b']);
  });

  it('berhenti setelah beberapa percobaan dan tidak memaksa menimpa', async () => {
    const store = new RivalWriterStore();
    store.alwaysRival = true;
    store.rivalLoopMode = 'queue';
    const shared = new SharedMusicState({ capacity: 5, store });

    await shared.setLoopMode('guild-1', 'track');

    // Tidak melempar, dan tidak memaksa penulisan setelah beberapa percobaan.
    expect(store.attempts).toBeGreaterThan(1);
    // Yang berlaku di proses ini tetap mode yang diminta.
    expect(shared.loopMode('guild-1')).toBe('track');
    // Tapi perubahan orang lain di store tidak ditimpa diam-diam.
    const stored = decodeSharedMusicState(await store.get(sharedStateKey('guild-1')));
    expect(stored.loopMode).toBe('queue');
  });

  it('tetap jalan tanpa melempar saat compareAndSet melempar', async () => {
    const shared = new SharedMusicState({ capacity: 5, store: new BrokenWriteStore() });

    await expect(shared.add('guild-1', [track({ encoded: 'a' })])).resolves.toBeDefined();
    expect(shared.size('guild-1')).toBe(1);
  });

  it('berhenti menulis kalau tidak ada yang berubah, walau ada balapan', async () => {
    const store = new RivalWriterStore();
    const shared = new SharedMusicState({ capacity: 5, store });

    await shared.add('guild-1', [track({ encoded: 'a' })]);
    const before = store.attempts;

    // Antrean kosong digeser: tidak ada yang berubah, jadi tidak perlu menulis.
    await shared.shift('guild-2');

    expect(store.attempts).toBe(before);
  });
});
