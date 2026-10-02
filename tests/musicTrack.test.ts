import { describe, expect, it } from 'vitest';
import {
  describeTrack,
  formatTrackDuration,
  progressBar,
  toTrackInfo,
  totalDurationMs,
} from '../src/modules/music/track.js';
import type { RawTrack, TrackInfo } from '../src/modules/music/types.js';

const rawTrack: RawTrack = {
  encoded: 'base64-data',
  info: {
    title: 'Lagu Contoh',
    author: 'Artis Contoh',
    length: 225_000,
    isStream: false,
    uri: 'https://example.com/lagu',
    artworkUrl: 'https://example.com/cover.jpg',
  },
};

function info(overrides: Partial<TrackInfo> = {}): TrackInfo {
  return {
    encoded: 'x',
    title: 'Judul',
    author: 'Artis',
    durationMs: 60_000,
    uri: null,
    artworkUrl: null,
    isStream: false,
    requesterId: '1',
    ...overrides,
  };
}

describe('toTrackInfo', () => {
  it('memetakan track Lavalink ke bentuk internal', () => {
    const track = toTrackInfo(rawTrack, '123456789012345678');

    expect(track.encoded).toBe('base64-data');
    expect(track.title).toBe('Lagu Contoh');
    expect(track.author).toBe('Artis Contoh');
    expect(track.durationMs).toBe(225_000);
    expect(track.uri).toBe('https://example.com/lagu');
    expect(track.artworkUrl).toBe('https://example.com/cover.jpg');
    expect(track.isStream).toBe(false);
    expect(track.requesterId).toBe('123456789012345678');
  });

  it('mengisi null untuk field opsional yang tidak dikirim Lavalink', () => {
    const track = toTrackInfo(
      { encoded: 'x', info: { title: 'T', author: 'A', length: 1_000, isStream: false } },
      '1',
    );

    expect(track.uri).toBeNull();
    expect(track.artworkUrl).toBeNull();
  });

  it('mengosongkan durasi untuk siaran langsung', () => {
    const track = toTrackInfo(
      { encoded: 'x', info: { title: 'Radio', author: 'A', length: 999_999_999, isStream: true } },
      '1',
    );

    expect(track.durationMs).toBe(0);
    expect(track.isStream).toBe(true);
  });
});

describe('formatTrackDuration', () => {
  it('memformat durasi biasa', () => {
    expect(formatTrackDuration(info({ durationMs: 225_000 }))).toBe('3:45');
  });

  it('menandai siaran langsung', () => {
    expect(formatTrackDuration(info({ durationMs: 0, isStream: true }))).toBe('🔴 LIVE');
  });
});

describe('describeTrack', () => {
  it('menggabungkan judul dan artis', () => {
    expect(describeTrack(info({ title: 'Hujan', author: 'Nadin' }))).toBe('**Hujan** — Nadin');
  });

  it('memotong judul yang terlalu panjang', () => {
    const result = describeTrack(info({ title: 'x'.repeat(200) }), 30);

    expect(result.length).toBe(30);
    expect(result.endsWith('…')).toBe(true);
  });
});

describe('progressBar', () => {
  it('menempatkan penanda di awal, tengah, dan akhir', () => {
    expect(progressBar(0, 10_000, 5)).toBe('🔘▬▬▬▬');
    expect(progressBar(5_000, 10_000, 5)).toBe('▬▬🔘▬▬');
    expect(progressBar(10_000, 10_000, 5)).toBe('▬▬▬▬🔘');
  });

  it('membatasi nilai di luar rentang', () => {
    expect(progressBar(-5_000, 10_000, 5)).toBe('🔘▬▬▬▬');
    expect(progressBar(99_999, 10_000, 5)).toBe('▬▬▬▬🔘');
  });

  it('menampilkan penanda live untuk durasi tak diketahui', () => {
    expect(progressBar(1_000, 0)).toBe('🔴 live');
    expect(progressBar(1_000, Number.NaN)).toBe('🔴 live');
  });
});

describe('totalDurationMs', () => {
  it('menjumlahkan durasi dan melewati siaran langsung', () => {
    const tracks = [
      info({ durationMs: 30_000 }),
      info({ durationMs: 0, isStream: true }),
      info({ durationMs: 45_000 }),
    ];

    expect(totalDurationMs(tracks)).toBe(75_000);
    expect(totalDurationMs([])).toBe(0);
  });
});
