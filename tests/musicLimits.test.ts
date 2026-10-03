import { describe, expect, it } from 'vitest';
import {
  LONG_TRACK_THRESHOLD_MS,
  MAX_TRACK_DURATION_MS,
  checkTrackLimit,
  splitByTrackLimits,
  trackLimitReason,
  trackLimitRejectionMessage,
} from '../src/modules/music/limits.js';
import { renderPlayOutcome } from '../src/modules/music/render.js';
import type { TrackInfo } from '../src/modules/music/types.js';

const MINUTE = 60_000;

function track(overrides: Partial<TrackInfo> & { durationMs: number }): TrackInfo {
  return {
    encoded: 'data',
    title: 'Lagu Uji',
    author: 'Artis',
    uri: 'https://example.test/lagu',
    artworkUrl: null,
    isStream: false,
    requesterId: '1',
    ...overrides,
  };
}

describe('checkTrackLimit', () => {
  it('meloloskan lagu biasa untuk siapa pun', () => {
    expect(checkTrackLimit({ durationMs: 3 * MINUTE, isStream: false }, { canControl: false })).toEqual(
      { kind: 'ok' },
    );
  });

  it('menolak lagu lebih dari 30 menit untuk selain DJ', () => {
    // PRD §6.2: lagu > 30 menit hanya boleh ditambahkan DJ/Manage Server.
    expect(
      checkTrackLimit(
        { durationMs: LONG_TRACK_THRESHOLD_MS + 1_000, isStream: false },
        { canControl: false },
      ),
    ).toEqual({
      kind: 'needs-control',
      durationMs: LONG_TRACK_THRESHOLD_MS + 1_000,
      isStream: false,
    });
  });

  it('tepat di ambang 30 menit masih lolos untuk member biasa', () => {
    expect(
      checkTrackLimit({ durationMs: LONG_TRACK_THRESHOLD_MS, isStream: false }, { canControl: false }),
    ).toEqual({ kind: 'ok' });
  });

  it('DJ boleh memutar lagu panjang', () => {
    expect(
      checkTrackLimit({ durationMs: 4 * 60 * MINUTE, isStream: false }, { canControl: true }),
    ).toEqual({ kind: 'ok' });
  });

  it('batas 6 jam berlaku untuk semua orang, termasuk DJ', () => {
    // Melewati 6 jam bukan masalah hak akses, tapi masalah memori: player itu
    // akan memblokir antrean server seutuhnya.
    for (const canControl of [true, false]) {
      expect(
        checkTrackLimit({ durationMs: MAX_TRACK_DURATION_MS + 1, isStream: false }, { canControl }),
      ).toEqual({ kind: 'too-long', durationMs: MAX_TRACK_DURATION_MS + 1 });
    }
  });

  it('live stream dianggap lagu panjang, dan tidak pernah bisa dibuktikan singkat', () => {
    expect(checkTrackLimit({ durationMs: 0, isStream: true }, { canControl: false })).toEqual({
      kind: 'needs-control',
      durationMs: 0,
      isStream: true,
    });
    expect(checkTrackLimit({ durationMs: 0, isStream: true }, { canControl: true })).toEqual({
      kind: 'ok',
    });
  });

  it('durasi tidak valid diperlakukan sebagai tidak diketahui', () => {
    expect(
      checkTrackLimit({ durationMs: Number.NaN, isStream: false }, { canControl: false }).kind,
    ).toBe('needs-control');
    expect(
      checkTrackLimit({ durationMs: -5_000, isStream: false }, { canControl: false }).kind,
    ).toBe('needs-control');
  });
});

describe('splitByTrackLimits', () => {
  const list = [
    track({ durationMs: 3 * MINUTE }),
    track({ durationMs: 45 * MINUTE }),
    track({ durationMs: 7 * 60 * MINUTE }),
    track({ durationMs: 0, isStream: true }),
  ];

  it('memisahkan yang diterima dan yang ditolak beserta alasannya', () => {
    const split = splitByTrackLimits(list, { canControl: false });

    expect(split.accepted.map((item) => item.durationMs)).toEqual([3 * MINUTE]);
    expect(split.needsControl).toHaveLength(2);
    expect(split.tooLong).toHaveLength(1);
  });

  it('DJ tetap ditolak untuk lagu yang melebihi 6 jam', () => {
    const split = splitByTrackLimits(list, { canControl: true });

    expect(split.accepted).toHaveLength(3);
    expect(split.tooLong).toHaveLength(1);
    expect(split.needsControl).toHaveLength(0);
  });

  it('daftar kosong tidak menghasilkan apa pun', () => {
    expect(splitByTrackLimits([], { canControl: true })).toEqual({
      accepted: [],
      tooLong: [],
      needsControl: [],
    });
  });
});

describe('pesan batas durasi', () => {
  it('menyebut batas jamnya, bukan hanya "terlalu panjang"', () => {
    expect(trackLimitReason('too-long')).toContain('6:00:00');
    expect(trackLimitReason('needs-control')).toContain('30:00');
  });

  it('balasan penolakan menjelaskanDJ dan berlaku-untuk-semua', () => {
    const tooLong = trackLimitRejectionMessage('too-long', 2);
    expect(tooLong).toContain('2 lagu ditolak');
    expect(tooLong).toContain('semua orang');

    const needsControl = trackLimitRejectionMessage('needs-control', 1);
    expect(needsControl).toContain('role DJ');
  });
});

describe('renderPlayOutcome untuk penolakan', () => {
  it('lagu yang semuanya ditolak terlihat sebagai penolakan, bukan keberhasilan', () => {
    const json = renderPlayOutcome({ kind: 'rejected', reason: 'needs-control', count: 1 }).toJSON();

    expect(json.title).toContain('Ditolak');
    expect(json.description).toContain('role DJ');
  });

  it('antrean yang sebagian ditolak tetap melaporkan jumlah dan alasannya', () => {
    const json = renderPlayOutcome({
      kind: 'added',
      tracks: [track({ durationMs: 3 * MINUTE })],
      started: true,
      position: 0,
      skipped: 0,
      rejectedNeedsControl: 1,
      rejectedTooLong: 1,
    }).toJSON();

    const description = json.description ?? '';
    expect(description).toContain('6:00:00');
    expect(description).toContain('30:00');
    expect(description).toContain('Role DJ');
  });

  it('tanpa penolakan, embed tidak menambah baris alasan', () => {
    const json = renderPlayOutcome({
      kind: 'added',
      tracks: [track({ durationMs: 3 * MINUTE })],
      started: true,
      position: 0,
      skipped: 0,
    }).toJSON();

    expect(json.description ?? '').not.toContain('ditolak');
  });
});