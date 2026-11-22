import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Sumber `http` dipakai `/play <URL>` untuk file audio yang di-host, termasuk
 * file yang lebih besar dari batas unggah Discord. Kalau sakelar ini kembali
 * `false`, fiturnya hilang tanpa error: Lavalink hanya menjawab "tidak ada
 * hasil" untuk tautan yang bukan YouTube/SoundCloud.
 */
describe('sumber http di lavalink/application.yml', () => {
  const config = readFileSync('lavalink/application.yml', 'utf8');

  it('menyalakan pemutaran file audio langsung dari URL', () => {
    expect(config).toMatch(/^ {6}http: true$/m);
    expect(config).not.toMatch(/^ {6}http: false$/m);
  });

  it('tidak mematikan sumber local yang dipakai lampiran /play file:', () => {
    expect(config).toMatch(/^ {6}local: true$/m);
  });
});
