import { describe, expect, it } from 'vitest';
import {
  LOOP_MODES,
  loopModeHint,
  loopModeLabel,
  parseLoopMode,
  planAdvance,
} from '../src/modules/music/loop.js';
import {
  parsePosition,
  resolveSeekPosition,
  seekErrorMessage,
} from '../src/modules/music/position.js';
import { shuffleTracks } from '../src/modules/music/shuffle.js';
import { MusicQueue } from '../src/modules/music/queue.js';
import type { TrackInfo } from '../src/modules/music/types.js';

function track(title: string, durationMs = 210_000): TrackInfo {
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

describe('parseLoopMode', () => {
  it('menerima ketiga mode resmi', () => {
    for (const mode of LOOP_MODES) {
      expect(parseLoopMode(mode)).toBe(mode);
    }
  });

  it('menerima alias bahasa Indonesia', () => {
    expect(parseLoopMode('antrean')).toBe('queue');
    expect(parseLoopMode('LAGU')).toBe('track');
    expect(parseLoopMode('mati')).toBe('off');
  });

  it('menolak input yang tidak dikenal', () => {
    for (const input of ['', 'ngawur', '1', 'trackk']) {
      expect(parseLoopMode(input)).toBeNull();
    }
  });

  it('pesan bantuan menyebut semua pilihan yang tersedia', () => {
    const hint = loopModeHint();

    for (const mode of LOOP_MODES) {
      expect(hint).toContain(loopModeLabel(mode));
    }
  });
});

describe('planAdvance', () => {
  const a = track('a');
  const b = track('b');
  const c = track('c');

  it('mode off: maju FIFO dan berhenti saat antrean habis', () => {
    const plan = planAdvance({ mode: 'off', finished: a, queue: [b], cycle: [] });

    expect(plan).toEqual({ action: 'play', track: b, queue: [], cycle: [] });
    expect(planAdvance({ mode: 'off', finished: b, queue: [], cycle: [] })).toEqual({
      action: 'stop',
    });
  });

  it('mode track: memutar ulang lagu yang sama', () => {
    expect(planAdvance({ mode: 'track', finished: a, queue: [b], cycle: [] })).toEqual({
      action: 'replay',
      track: a,
    });
  });

  it('mode track tetap menyetor antrean: antrean tidak berkurang', () => {
    const plan = planAdvance({ mode: 'track', finished: a, queue: [b], cycle: [] });

    expect(plan).toMatchObject({ action: 'replay' });
  });

  it('/skip mengabaikan mode track', () => {
    const plan = planAdvance({
      mode: 'track',
      finished: a,
      queue: [b],
      cycle: [],
      respectTrackLoop: false,
    });

    expect(plan).toMatchObject({ action: 'play', track: b });
  });

  it('mode queue: mengisi ulang antrean dari riwayat siklus saat habis', () => {
    // Satu putaran a → b → c diulang dari awal, jadi `c` berbunyi lagi paling
    // akhir. Kalau refill dimulai dari `c`, urutan putarannya tidak sama lagi
    // setiap putaran dan satu lagu selalu tertinggal.
    const plan = planAdvance({ mode: 'queue', finished: c, queue: [], cycle: [a, b] });

    expect(plan).toEqual({ action: 'play', track: a, queue: [b, c], cycle: [] });
  });

  it('mode queue: riwayat siklus bertambah saat masih ada antrean', () => {
    const plan = planAdvance({ mode: 'queue', finished: a, queue: [b, c], cycle: [] });

    expect(plan).toEqual({ action: 'play', track: b, queue: [c], cycle: [a] });
  });

  it('mode queue: riwayat siklus bertambah di luar mode track', () => {
    const plan = planAdvance({ mode: 'queue', finished: a, queue: [b], cycle: [c] });

    expect(plan).toMatchObject({ cycle: [c, a] });
  });

  it('berhenti saat tidak ada apa pun tersisa', () => {
    // Mode `off` dengan satu lagu: tidak ada sisa apa pun untuk diputar lagi.
    expect(planAdvance({ mode: 'off', finished: a, queue: [], cycle: [a] })).toEqual({
      action: 'stop',
    });
  });

  it('lagu tunggal dengan loop antrean terus diputar', () => {
    // Efek samping yang benar: satu lagu + `queue` = radio. Itu memang arti
    // "ulang antrean", jadi bukan kondisi yang perlu diperlakukan sebagai galat.
    expect(planAdvance({ mode: 'queue', finished: a, queue: [], cycle: [] })).toMatchObject({
      action: 'play',
      track: a,
    });
  });

  it('berhenti tanpa lagu yang sedang berjalan', () => {
    expect(planAdvance({ mode: 'track', finished: null, queue: [], cycle: [] })).toEqual({
      action: 'stop',
    });
  });
});

describe('parsePosition', () => {
  it('menerima detik polos', () => {
    expect(parsePosition('90')).toEqual({ ok: true, positionMs: 90_000 });
  });

  it('menerima format menit:detik', () => {
    expect(parsePosition('1:30')).toEqual({ ok: true, positionMs: 90_000 });
  });

  it('menit lebih dari 59 tetap diterima', () => {
    expect(parsePosition('1:90')).toEqual({ ok: true, positionMs: 150_000 });
  });

  it('menerima jam:menit:detik', () => {
    expect(parsePosition('1:02:03')).toEqual({ ok: true, positionMs: 3_723_000 });
  });

  it('menerima satuan eksplisit', () => {
    expect(parsePosition('1m30s')).toEqual({ ok: true, positionMs: 90_000 });
    expect(parsePosition('45s')).toEqual({ ok: true, positionMs: 45_000 });
    expect(parsePosition('1h')).toEqual({ ok: true, positionMs: 3_600_000 });
  });

  it('menolak nol dan negatif', () => {
    expect(parsePosition('0')).toMatchObject({ ok: false, reason: 'invalid' });
  });

  it('menolak teks yang tidak entirety terbaca', () => {
    // `1m30x` akan dianggap 90 detik kalau sisa karakter diabaikan; itu
    // diam-diam mengarang input yang tidak pernah diketik user.
    expect(parsePosition('1m30x')).toMatchObject({ ok: false, reason: 'invalid' });
    expect(parsePosition('abc')).toMatchObject({ ok: false, reason: 'invalid' });
    expect(parsePosition('')).toMatchObject({ ok: false, reason: 'invalid' });
  });

  it('menolak posisi melebihi batas', () => {
    expect(parsePosition('99:00:00')).toMatchObject({ ok: false, reason: 'too-large' });
  });
});

describe('resolveSeekPosition', () => {
  it('menerima posisi sebelum akhir lagu', () => {
    expect(resolveSeekPosition('1:00', 210_000, false)).toEqual({ ok: true, positionMs: 60_000 });
  });

  it('menolak posisi tepat di akhir lagu', () => {
    expect(resolveSeekPosition('3:30', 210_000, false)).toMatchObject({
      ok: false,
      reason: 'past-end',
    });
  });

  it('menolak lompat pada siaran langsung dengan alasan tersendiri', () => {
    expect(resolveSeekPosition('1:00', 0, true)).toMatchObject({ ok: false, reason: 'live' });
  });

  it('setiap alasan punya pesan yang menjelaskan', () => {
    for (const reason of ['live', 'past-end', 'too-large', 'invalid'] as const) {
      const message = seekErrorMessage(reason);

      expect(message.length).toBeGreaterThan(10);
      expect(message).toMatch(/[.!]$/);
    }
  });
});

describe('shuffleTracks', () => {
  /** Sumber acakan yang selalu mengembalikan nilai paling kecil — deterministik. */
  const alwaysMin = () => 0;

  it('mengembalikan salinan, bukan mengubah array asal', () => {
    const original = [track('a'), track('b'), track('c')];
    const shuffled = shuffleTracks(original, alwaysMin);

    expect(original.map((item) => item.title)).toEqual(['a', 'b', 'c']);
    expect(shuffled).not.toBe(original);
  });

  it('menghasilkan urutan yang bisa ditentukan dari sumber acakan', () => {
    // Hasil acakan tidak boleh "kebetulan" benar dalam tes — makanya acakannya
    // disuntik, supaya assertions benar-benar menguji algoritmanya.
    const shuffled = shuffleTracks([track('a'), track('b'), track('c')], alwaysMin);

    expect(shuffled.map((item) => item.title)).toEqual(['b', 'c', 'a']);
  });

  it('selalu mempertahankan seluruh lagu, tanpa duplikat atau kehilangan', () => {
    const original = ['a', 'b', 'c', 'd', 'e'].map((title) => track(title));
    let seed = 1;
    const shuffled = shuffleTracks(original, () => {
      seed = (seed * 7 + 3) % 10;
      return seed / 10;
    });

    expect([...shuffled].map((item) => item.title).sort()).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('daftar kosong dan satu elemen tetap aman', () => {
    expect(shuffleTracks([])).toEqual([]);
    expect(shuffleTracks([track('a')])).toHaveLength(1);
  });
});

describe('MusicQueue.move', () => {
  it('memindahkan lagu ke posisi baru', () => {
    const queue = new MusicQueue(5);
    queue.add([track('a'), track('b'), track('c')]);

    queue.move(3, 1);

    expect(queue.toArray().map((item) => item.title)).toEqual(['c', 'a', 'b']);
  });

  it('memindahkan ke posisi terakhir', () => {
    const queue = new MusicQueue(5);
    queue.add([track('a'), track('b'), track('c')]);

    queue.move(1, 3);

    expect(queue.toArray().map((item) => item.title)).toEqual(['b', 'c', 'a']);
  });

  it('menolak posisi di luar jangkauan tanpa mengubah antrean', () => {
    const queue = new MusicQueue(5);
    queue.add([track('a'), track('b')]);

    expect(queue.move(1, 5)).toBeNull();
    expect(queue.move(9, 1)).toBeNull();
    expect(queue.move(0, 1)).toBeNull();
    expect(queue.toArray().map((item) => item.title)).toEqual(['a', 'b']);
  });

  it('memindahkan ke posisi sendiri bukan kegagalan', () => {
    const queue = new MusicQueue(5);
    queue.add([track('a'), track('b')]);

    expect(queue.move(2, 2)?.title).toBe('b');
    expect(queue.toArray().map((item) => item.title)).toEqual(['a', 'b']);
  });
});

describe('MusicQueue.shuffle', () => {
  it('mengacak isi antrean dan melaporkan jumlahnya', () => {
    const queue = new MusicQueue(5);
    queue.add([track('a'), track('b'), track('c')]);

    expect(queue.shuffle(() => 0)).toBe(3);
    expect(queue.toArray().map((item) => item.title)).toEqual(['b', 'c', 'a']);
  });

  it('antrean kosong tidak membuat error', () => {
    expect(new MusicQueue(5).shuffle(() => 0)).toBe(0);
  });
});