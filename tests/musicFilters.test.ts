import { describe, expect, it } from 'vitest';
import {
  FILTER_MODES,
  FILTER_SAFETY,
  filterModeHint,
  filterModeLabel,
  filterParamsFor,
  isWithinSafeBounds,
  parseFilterMode,
} from '../src/modules/music/filters.js';

describe('parseFilterMode', () => {
  it('menerima semua mode resmi', () => {
    for (const mode of FILTER_MODES) {
      expect(parseFilterMode(mode)).toBe(mode);
    }
  });

  it('menerima alias yang biasa diketik orang', () => {
    expect(parseFilterMode('bass')).toBe('bassboost');
    expect(parseFilterMode('vapor')).toBe('vaporwave');
    expect(parseFilterMode('8d-audio')).toBe('8d');
    expect(parseFilterMode('MATI')).toBe('off');
    expect(parseFilterMode('Bass-Boost')).toBe('bassboost');
  });

  it('menolak input yang tidak dikenal', () => {
    for (const input of ['', 'ngawur', 'eq', 'reverb', '1']) {
      expect(parseFilterMode(input)).toBeNull();
    }
  });

  it('pesan bantuan menyebut semua pilihan yang tersedia', () => {
    const hint = filterModeHint();

    for (const mode of FILTER_MODES) {
      expect(hint).toContain(filterModeLabel(mode));
    }
  });

  it('label 8D tetap terbaca sebagai 8D, bukan "8d"', () => {
    expect(filterModeLabel('8d')).toBe('8D');
  });
});

describe('filterParamsFor', () => {
  it('off mengirim objek kosong — Lavalink menganggapnya reset semua filter', () => {
    expect(filterParamsFor('off')).toEqual({});
  });

  it('bassboost hanya mengatur equalizer', () => {
    const params = filterParamsFor('bassboost');

    expect(params.equalizer?.map((band) => band.band)).toEqual([0, 1, 2, 3]);
    expect(params.timescale).toBeUndefined();
    expect(params.rotation).toBeUndefined();
  });

  it('nightcore mempercepat dan menaikkan nada dengan angka yang sama', () => {
    const { timescale } = filterParamsFor('nightcore');

    expect(timescale).toEqual({ speed: 1.125, pitch: 1.125, rate: 1.125 });
    expect(filterParamsFor('nightcore').equalizer).toBeUndefined();
  });

  it('vaporwave memperlambat dan menurunkan nada', () => {
    const { timescale } = filterParamsFor('vaporwave');

    expect(timescale).toEqual({ speed: 0.8, pitch: 0.8, rate: 0.8 });
  });

  it('nightcore dan vaporwave tidak mungkin sama — keduanya memutar timescale ke arah berlawanan', () => {
    const fast = filterParamsFor('nightcore').timescale?.speed;
    const slow = filterParamsFor('vaporwave').timescale?.speed;

    expect(fast).toBeGreaterThan(1);
    expect(slow).toBeLessThan(1);
  });

  it('8D hanya mengatur rotasi', () => {
    const params = filterParamsFor('8d');

    expect(params.rotation).toEqual({ rotationHz: 0.2 });
    expect(params.timescale).toBeUndefined();
    expect(params.equalizer).toBeUndefined();
  });
});

describe('isWithinSafeBounds', () => {
  it('semua preset resmi berada dalam batas aman Lavalink', () => {
    for (const mode of FILTER_MODES) {
      expect(isWithinSafeBounds(filterParamsFor(mode))).toBe(true);
    }
  });

  it('menolak band equalizer di luar 0-14', () => {
    expect(
      isWithinSafeBounds({ equalizer: [{ band: FILTER_SAFETY.bandMax + 1, gain: 0.2 }] }),
    ).toBe(false);
    expect(
      isWithinSafeBounds({ equalizer: [{ band: -1, gain: 0.2 }] }),
    ).toBe(false);
  });

  it('menolak gain di luar rentang yang diterima Lavalink', () => {
    expect(
      isWithinSafeBounds({ equalizer: [{ band: 0, gain: FILTER_SAFETY.gainMax + 0.1 }] }),
    ).toBe(false);
    expect(
      isWithinSafeBounds({ equalizer: [{ band: 0, gain: FILTER_SAFETY.gainMin - 0.1 }] }),
    ).toBe(false);
  });

  it('menolak timescale yang terlalu ekstrem untuk didengar', () => {
    expect(isWithinSafeBounds({ timescale: { speed: 3 } })).toBe(false);
    expect(isWithinSafeBounds({ timescale: { pitch: 0.1 } })).toBe(false);
  });

  it('menolak rotasi 8D yang terlalu cepat', () => {
    expect(isWithinSafeBounds({ rotation: { rotationHz: 10 } })).toBe(false);
    expect(isWithinSafeBounds({ rotation: { rotationHz: -1 } })).toBe(false);
  });

  it('filter kosong (off) berada dalam batas', () => {
    expect(isWithinSafeBounds({})).toBe(true);
  });
});