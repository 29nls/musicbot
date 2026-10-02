import { EmbedBuilder } from 'discord.js';
import { describe, expect, it } from 'vitest';
import { buildLogSummary, clampLogSummary } from '../src/modules/logging/summary.js';
import { MAX_LOG_SUMMARY_LENGTH } from '../src/modules/logging/types.js';

describe('clampLogSummary', () => {
  it('meratakan spasi berlebih', () => {
    expect(clampLogSummary(' Halo\n\n  dunia   lagi ')).toBe('Halo dunia lagi');
  });

  it('memotong melebihi batas kolom dan menandai dengan ellipsis', () => {
    const clamped = clampLogSummary('x'.repeat(MAX_LOG_SUMMARY_LENGTH + 50));

    expect(clamped).toHaveLength(MAX_LOG_SUMMARY_LENGTH);
    expect(clamped.endsWith('…')).toBe(true);
  });

  it('tidak mengubah teks yang sudah muat', () => {
    expect(clampLogSummary('ringkas')).toBe('ringkas');
  });
});

describe('buildLogSummary', () => {
  it('menggabungkan deskripsi dan seluruh nilai field', () => {
    const embed = new EmbedBuilder()
      .setTitle('🗑️ Pesan Dihapus')
      .setDescription('> isi pesan')
      .addFields(
        { name: 'Channel', value: '<#111>' },
        { name: 'Penulis', value: '<@222>' },
      );

    expect(buildLogSummary(embed)).toBe('> isi pesan · Channel: <#111> · Penulis: <@222>');
  });

  it('hanya deskripsi kalau embed tanpa field', () => {
    expect(buildLogSummary(new EmbedBuilder().setDescription('  sampai  '))).toBe('sampai');
  });

  it('mengembalikan string kosong untuk embed tanpa isi', () => {
    expect(buildLogSummary(new EmbedBuilder())).toBe('');
  });

  it('ringkasan tetap muat di kolom database', () => {
    // Embed log memotong tiap field di 1.024 karakter; dua field penuh sudah
    // melewati batas kolom `summary`.
    const embed = new EmbedBuilder().addFields(
      { name: 'Isi', value: 'y'.repeat(1_000) },
      { name: 'Lain', value: 'z'.repeat(1_000) },
    );

    const summary = buildLogSummary(embed);
    expect(summary.length).toBeLessThanOrEqual(MAX_LOG_SUMMARY_LENGTH);
    expect(summary.endsWith('…')).toBe(true);
  });
});
