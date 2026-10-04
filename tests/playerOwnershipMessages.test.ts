import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Pesan "guild ini sedang dipegang proses lain" harus sama di semua jalur.
 *
 * Jalur slash command punya `handleMusicFailure`; jalur select menu `/search`
 * punya pembalasnya sendiri. Dua jalur itu dulu tidak sama: select menu melempar
 * error apa adanya ke router komponen, yang hanya menampilkan "komponen
 * gagal" — jadi member yang guild-nya dipegang proses lain melihat pesan
 * berbeda tergantung apakah dia mengetik `/play` atau memilih dari `/search`.
 */
describe('pesan kepemilikan player sama di semua jalur', () => {
  const shared = readFileSync(
    fileURLToPath(new URL('../src/commands/music/_shared.ts', import.meta.url)),
    'utf8',
  );
  const searchSelect = readFileSync(
    fileURLToPath(new URL('../src/modules/music/searchSelect.ts', import.meta.url)),
    'utf8',
  );
  const stay247 = readFileSync(
    fileURLToPath(new URL('../src/commands/music/stay247.ts', import.meta.url)),
    'utf8',
  );

  it('perintah musik memakai satu pembungkus yang mengenali error kepemilikan', () => {
    expect(shared).toMatch(/error instanceof PlayerOwnedElsewhereError/);
    expect(shared).toContain("t('music.gate.ownedElsewhere')");
  });

  it('select /search juga mengenali error kepemilikan, bukan melempar ke router', () => {
    expect(searchSelect).toMatch(/catch \(error\)/);
    expect(searchSelect).toMatch(/error instanceof PlayerOwnedElsewhereError/);
    expect(searchSelect).toContain("t('music.gate.ownedElsewhere')");
  });

  it('keduanya memakai kunci katalog yang sama, jadi tidak bisa berbeda diam-diam', () => {
    const keys = [...shared.matchAll(/music\.gate\.ownedElsewhere/g)].length;
    const selectKeys = [...searchSelect.matchAll(/music\.gate\.ownedElsewhere/g)].length;

    expect(keys).toBeGreaterThan(0);
    expect(selectKeys).toBe(keys);
  });

  it('/247 join lewat pembungkus yang sama, bukan punya pesan sendiri', () => {
    expect(stay247).toContain('handleMusicFailure');
    // Kalau nanti ada jalur tanpa pembungkus, guard ini yang menangkap.
    expect(stay247).not.toContain('PlayerOwnedElsewhereError');
  });
});

describe('select /search tidak pernah mencapai render hasil kalau guild dipegang proses lain', () => {
  const searchSelect = readFileSync(
    fileURLToPath(new URL('../src/modules/music/searchSelect.ts', import.meta.url)),
    'utf8',
  );

  it('pemanggilan enqueue dibungkus try, dan jalur kepemilikan selalu berhenti', () => {
    const start = searchSelect.indexOf('let outcome: PlayOutcome;');
    const end = searchSelect.indexOf('renderPlayOutcome(outcome, t)', start);

    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);

    const block = searchSelect.slice(start, end);
    expect(block).toMatch(/catch \(error\) \{/);
    // Jalur kepemilikan harus berhenti di situ, bukan jatuh ke render.
    const returnIndex = block.indexOf('return;', block.indexOf('instanceof PlayerOwnedElsewhereError'));
    expect(returnIndex).toBeGreaterThan(-1);
  });
});