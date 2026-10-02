import { describe, expect, it } from 'vitest';
import { renderPlayOutcome } from '../src/modules/music/render.js';
import { addedToQueueEmbed } from '../src/modules/music/embeds.js';
import type { PlayOutcome, TrackInfo } from '../src/modules/music/types.js';
import {
  errorEmbed,
  infoEmbed,
  successEmbed,
  warningEmbed,
} from '../src/utils/embeds.js';
import { EMBED_COLORS } from '../src/config/constants.js';
import { getEnv } from '../src/config/env.js';

function track(overrides: Partial<TrackInfo> = {}): TrackInfo {
  return {
    encoded: 'encoded-1',
    title: 'Lagu Satu',
    author: 'Artis Satu',
    durationMs: 210_000,
    uri: 'https://example.com/1',
    artworkUrl: null,
    isStream: false,
    requesterId: '123456789012345678',
    ...overrides,
  };
}

describe('renderPlayOutcome', () => {
  it('hasil "added" yang mulai diputar menyebut pemutaran dan judulnya', () => {
    const outcome: PlayOutcome = {
      kind: 'added',
      tracks: [track()],
      started: true,
      position: 1,
      skipped: 0,
    };

    const embed = renderPlayOutcome(outcome);
    const text = `${embed.data.title ?? ''} ${embed.data.description ?? ''}`;

    expect(text).toContain('Lagu Satu');
    expect(text).toContain('Mulai diputar');
  });

  it('hasil "added" yang hanya masuk antrean menyebut posisinya', () => {
    const outcome: PlayOutcome = {
      kind: 'added',
      tracks: [track()],
      started: false,
      position: 4,
      skipped: 0,
    };

    const embed = renderPlayOutcome(outcome);

    expect(embed.data.description ?? '').toContain('#4');
  });

  it('antrean penuh menyebut batas dari konfigurasi', () => {
    const outcome: PlayOutcome = { kind: 'queue-full' };

    const embed = renderPlayOutcome(outcome);

    expect(embed.data.description ?? '').toContain(`batas ${getEnv().MAX_QUEUE_SIZE}`);
  });

  it('kesalahan sumber lagu meneruskan pesan dari Lavalink', () => {
    const outcome: PlayOutcome = { kind: 'error', message: 'dibatasi oleh sumbernya' };

    const embed = renderPlayOutcome(outcome);

    expect(embed.data.description ?? '').toContain('dibatasi oleh sumbernya');
  });

  it('pencarian kosong menyuruh mencoba kata kunci lain', () => {
    const embed = renderPlayOutcome({ kind: 'empty' });

    expect(embed.data.description ?? '').toContain('Tidak ada hasil');
  });

  it('Lavalink tidak tersedia memberi petunjuk cek log', () => {
    const embed = renderPlayOutcome({ kind: 'unavailable' });

    expect(embed.data.description ?? '').toContain('Lavalink belum terhubung');
  });

  it('jenis hasil yang tidak dikenal jatuh ke jalur Lavalink, bukan melempar', () => {
    const embed = renderPlayOutcome({ kind: 'ngawur' } as unknown as PlayOutcome);

    expect(embed.data.description ?? '').toContain('Lavalink belum terhubung');
  });
});

describe('addedToQueueEmbed', () => {
  it('menyebut jumlah lagu playlist yang dipotong', () => {
    const embed = addedToQueueEmbed({
      kind: 'added',
      tracks: [track(), track({ title: 'Lagu Dua' })],
      started: false,
      position: 2,
      skipped: 3,
    });

    const text = embed.data.description ?? '';

    expect(text).toContain('1** lagu lain');
    expect(text).toContain('3** lagu tidak ditambahkan');
  });
});

describe('embed dasar', () => {
  it('infoEmbed memakai judul, deskripsi, dan warna utama', () => {
    const embed = infoEmbed('Judul', 'Isi');

    expect(embed.data.title).toBe('Judul');
    expect(embed.data.description).toBe('Isi');
    expect(embed.data.color).toBe(EMBED_COLORS.primary);
    expect(embed.data.timestamp).toBeTruthy();
  });

  it('infoEmbed tanpa deskripsi tetap sah', () => {
    const embed = infoEmbed('Judul saja');

    expect(embed.data.title).toBe('Judul saja');
    expect(embed.data.description).toBeUndefined();
  });

  it('embed status memakai judul dan warna yang berbeda per jenis', () => {
    expect(successEmbed('baik').data.color).toBe(EMBED_COLORS.success);
    expect(warningEmbed('hmm').data.color).toBe(EMBED_COLORS.warning);
    expect(errorEmbed('buruk').data.color).toBe(EMBED_COLORS.error);
  });

  it('judul status bisa diganti tanpa mengubah warna', () => {
    const embed = warningEmbed('isi', '⚠️ Aturan automod');

    expect(embed.data.title).toBe('⚠️ Aturan automod');
    expect(embed.data.color).toBe(EMBED_COLORS.warning);
  });
});