import { describe, expect, it } from 'vitest';
import { decodeSearchSession, encodeSearchSession } from '../src/modules/music/searchSessionCodec.js';
import type { SearchSession } from '../src/modules/music/searchSession.js';
import type { TrackInfo } from '../src/modules/music/types.js';

/**
 * Codec session `/search`.
 *
 * Yang diuji di sini adalah sifat tolerannya: session dibaca dari store yang
 * bersama, jadi isinya bisa ditulis proses lain, versi kode lain, atau rusak.
 *Decoder harus mengembalikan `null` — bukan melempar — supaya select menu
 * menjawab "sudah tidak berlaku" dan bukan gagal.
 */

function track(overrides: Partial<TrackInfo> = {}): TrackInfo {
  return {
    encoded: 'AQAA',
    title: 'Lagu Satu',
    author: 'Artis Satu',
    durationMs: 210_000,
    uri: 'https://contoh.example/lagu',
    artworkUrl: null,
    isStream: false,
    requesterId: '123456789012345678',
    ...overrides,
  };
}

function session(overrides: Partial<SearchSession> = {}): SearchSession {
  return {
    token: 'aabbccdd',
    guildId: 'guild-1',
    requesterId: '123456789012345678',
    query: 'jazz',
    tracks: [track()],
    createdAt: 1_700_000_000_000,
    ...overrides,
  };
}

describe('encodeSearchSession', () => {
  it('menulis hanya field yang dibutuhkan', () => {
    const raw = JSON.parse(encodeSearchSession(session())) as Record<string, unknown>;

    expect(Object.keys(raw).sort()).toEqual([
      'createdAt',
      'guildId',
      'query',
      'requesterId',
      'token',
      'tracks',
    ]);
  });

  it('tidak ikut menulis field tambahan yang menempel di session', () => {
    const raw = JSON.parse(
      encodeSearchSession({ ...session(), rahasia: 'jangan-disimpan' } as SearchSession),
    ) as Record<string, unknown>;

    expect(raw.rahasia).toBeUndefined();
  });
});

describe('decodeSearchSession', () => {
  it('membaca kembali session yang ditulis', () => {
    const original = session({ tracks: [track(), track({ encoded: 'AQAB', title: 'Lagu Dua' })] });

    expect(decodeSearchSession(encodeSearchSession(original))).toEqual(original);
  });

  it('menangani store yang kosong', () => {
    expect(decodeSearchSession(null)).toBeNull();
    expect(decodeSearchSession('')).toBeNull();
  });

  it('menolak JSON rusak tanpa melempar', () => {
    for (const raw of ['{bukan json', '[1, 2', 'null-ish', '42']) {
      expect(decodeSearchSession(raw)).toBeNull();
    }
  });

  it('menolak bentuk yang bukan objek', () => {
    for (const raw of ['[]', '"aabbccdd"', '123', 'true']) {
      expect(decodeSearchSession(raw)).toBeNull();
    }
  });

  it('menolak session yang field utamanya salah bentuk', () => {
    const base = JSON.parse(encodeSearchSession(session())) as Record<string, unknown>;

    expect(decodeSearchSession(JSON.stringify({ ...base, token: '' }))).toBeNull();
    expect(decodeSearchSession(JSON.stringify({ ...base, guildId: 12 }))).toBeNull();
    expect(decodeSearchSession(JSON.stringify({ ...base, requesterId: null }))).toBeNull();
    expect(decodeSearchSession(JSON.stringify({ ...base, query: {} }))).toBeNull();
    expect(decodeSearchSession(JSON.stringify({ ...base, createdAt: 'kapan' }))).toBeNull();
    expect(decodeSearchSession(JSON.stringify({ ...base, createdAt: Number.NaN }))).toBeNull();
  });

  it('menolak session tanpa hasil pencarian', () => {
    const base = JSON.parse(encodeSearchSession(session())) as Record<string, unknown>;

    expect(decodeSearchSession(JSON.stringify({ ...base, tracks: [] }))).toBeNull();
    expect(decodeSearchSession(JSON.stringify({ ...base, tracks: 'lagu' }))).toBeNull();
    expect(decodeSearchSession(JSON.stringify({ ...base, tracks: [null] }))).toBeNull();
  });

  it('menolak track yang tidak punya data untuk Lavalink', () => {
    const base = JSON.parse(encodeSearchSession(session())) as Record<string, unknown>;

    expect(
      decodeSearchSession(JSON.stringify({ ...base, tracks: [{ ...track(), encoded: '' }] })),
    ).toBeNull();
    expect(
      decodeSearchSession(
        JSON.stringify({ ...base, tracks: [{ ...track(), durationMs: 'lama' }] }),
      ),
    ).toBeNull();
  });

  it('mengganti field track yang salah bentuk dengan nilai aman', () => {
    const base = JSON.parse(encodeSearchSession(session())) as Record<string, unknown>;
    const noisy = { ...base, tracks: [{ ...track(), title: 12, uri: 7, isStream: 'ya' }] };

    const decoded = decodeSearchSession(JSON.stringify(noisy));

    expect(decoded?.tracks[0]).toEqual({
      ...track(),
      title: '',
      uri: null,
      isStream: false,
    });
  });
});
