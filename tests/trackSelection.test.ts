import { describe, expect, it } from 'vitest';
import { isUrl } from '../src/modules/music/search.js';
import { SEARCH_RESULT_LIMIT, pickTracks, type TrackPickPurpose } from '../src/modules/music/selection.js';
import type { RawTrack, SearchOutcome } from '../src/modules/music/types.js';

/**
 * Satu aturan "berapa lagu yang layak dipakai" untuk `/play`, `/search`, dan
 * `/playlist add`.
 *
 * Sebelumnya pertanyaan itu dijawab di empat tempat dengan cara yang berbeda:
 * `/play` mengambil satu track, session `/search` memotong lima, embed
 * `/search` menyimpan angka lima-nya sendiri, `/playlist add` memotong satu
 * untuk kata kunci, dan pemuatan playlist mengambil track pertama per entri.
 * Dua di antaranya pernah salah dalam arah yang berlawanan — `/play` memutar
 * seluruh hasil pencarian, `/playlist add` pernah menyimpan seluruh hasil
 * pencarian juga. Yang salah bukan salah satu pemanggilnya, melainkan jumlah
 * tempat yang menjawab pertanyaan yang sama.
 *
 * Berkas ini menguji **perilaku** tabelnya. Sisi struktur — bahwa pemakai
 * benar-benar lewat `pickTracks` dan angka hasil pencarian hanya punya satu
 * definisi — dijaga secara semantik lewat compiler API di
 * `trackSelectionAst.test.ts`, bukan dengan pemindaian teks.
 */

function rawTrack(id: number): RawTrack {
  return {
    encoded: `encoded-${id}`,
    info: {
      title: `Lagu ${id}`,
      author: 'Penyanyi',
      length: 180_000,
      isStream: false,
      uri: `https://example.test/watch?v=${id}`,
    },
  };
}

function resolved(count: number, playlistName?: string): SearchOutcome {
  return {
    kind: 'tracks',
    tracks: Array.from({ length: count }, (_, index) => rawTrack(index + 1)),
    ...(playlistName ? { playlistName } : {}),
  };
}

/** Judul lagu yang dipilih, supaya urutannya ikut terperiksa. */
function titles(purpose: TrackPickPurpose, query: string, outcome: SearchOutcome): string[] {
  return pickTracks(outcome, purpose, query).map((track) => track.info.title);
}

describe('pickTracks: jumlah lagu diputuskan di satu tempat', () => {
  it("'single' mengambil tepat satu, apa pun bentuk query-nya", () => {
    // Kata kunci: `ytsearch:` kembali dengan ±25 hasil.
    expect(titles('single', 'hujan nadin', resolved(25, 'Radio MIX'))).toEqual(['Lagu 1']);

    // URL playlist/radio: satu `/play` tetap satu lagu (US-01).
    expect(
      titles('single', 'https://www.youtube.com/watch?v=1&list=RD1', resolved(25, 'Radio MIX')),
    ).toEqual(['Lagu 1']);

    // Hasil tunggal tetap tunggal.
    expect(titles('single', 'lagu satu', resolved(1))).toEqual(['Lagu 1']);
  });

  it("'choices' memotong ke SEARCH_RESULT_LIMIT dan tidak menambah apa pun", () => {
    expect(SEARCH_RESULT_LIMIT).toBe(5);

    expect(titles('choices', 'hujan nadin', resolved(25))).toEqual([
      'Lagu 1',
      'Lagu 2',
      'Lagu 3',
      'Lagu 4',
      'Lagu 5',
    ]);

    // Lebih sedikit dari batas: tidak ada pilihan kosong yang ditambahkan.
    expect(titles('choices', 'lagu langka', resolved(3))).toHaveLength(3);
  });

  it("'save' satu lagu untuk kata kunci, utuh untuk URL playlist", () => {
    expect(titles('save', 'hujan nadin', resolved(25, 'Radio MIX'))).toEqual(['Lagu 1']);

    // URL playlist: menyimpan seluruh isinya memang tujuan `/playlist add`.
    const saved = pickTracks(resolved(25, 'Album'), 'save', 'https://www.youtube.com/playlist?list=PL1');
    expect(saved).toHaveLength(25);
  });

  it('pembeda URL memakai isUrl yang sama dengan pengirim identifier ke Lavalink', () => {
    // Huruf besar tetap URL (janji `isUrl`), jadi `save` tidak salah potong.
    expect(isUrl('Https://Example.com/playlist?list=PL1')).toBe(true);
    expect(titles('save', 'Https://Example.com/playlist?list=PL1', resolved(4))).toHaveLength(4);

    // Skema non-http (mis. `spotify:track:...`) adalah kata kunci bagi bot.
    expect(isUrl('spotify:track:abc')).toBe(false);
    expect(titles('save', 'spotify:track:abc', resolved(4))).toEqual(['Lagu 1']);
  });

  it('hasil non-track jadi daftar kosong, bukan halaman kosong atau crash', () => {
    const outcomes: SearchOutcome[] = [
      { kind: 'empty' },
      { kind: 'error', message: 'gagal' },
      { kind: 'unavailable' },
    ];
    const purposes: TrackPickPurpose[] = ['single', 'choices', 'save'];

    for (const outcome of outcomes) {
      for (const purpose of purposes) {
        expect(pickTracks(outcome, purpose, 'apa saja')).toEqual([]);
      }
    }
  });
});
