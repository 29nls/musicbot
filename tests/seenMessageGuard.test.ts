import { describe, expect, it } from 'vitest';
import { DEFAULT_SEEN_MESSAGE_TTL_MS, SeenMessageGuard } from '../src/modules/automod/dedupe.js';

/**
 * `SeenMessageGuard` — penjaga idempotensi untuk handler `messageCreate`.
 *
 * Modul ini murni: tidak ada jam sungguhan, tidak ada Discord, tidak ada
 * database. Itu disengaja supaya batas memorinya bisa diuji dengan thousands
 * entri dalam waktu sekejap, bukan dengan menunggu jam.
 *
 * Sifat yang diuji di sini ada dua dan keduanya penting: **menahan yang
 * perlu menahan**, dan **tidak menahan yang tidak perlu**. Penjaga yang
 * terlalu longgar membuat satu pesan jadi dua kasus; penjaga yang terlalu
 * rapat membuat pesan sah yang datangnya sah terlewat.
 */

const NOW = 1_700_000_000_000;

function guardAt(now: number, options: { ttlMs?: number; maxEntries?: number } = {}) {
  return new SeenMessageGuard({ now: () => now, ...options });
}

describe('SeenMessageGuard', () => {
  it('meneruskan pesan yang baru', () => {
    const guard = guardAt(NOW);

    expect(guard.accept('msg-1')).toBe(true);
  });

  it('menolak id yang sama di detik yang sama', () => {
    const guard = guardAt(NOW);
    guard.accept('msg-1');

    expect(guard.accept('msg-1')).toBe(false);
  });

  it('meneruskan id yang berbeda', () => {
    const guard = guardAt(NOW);
    guard.accept('msg-1');

    expect(guard.accept('msg-2')).toBe(true);
  });

  it('meneruskan id yang sama setelah masa ingat lewat', () => {
    // Kalau tidak, bot yang hidup lama akan menolak semua pesan setelah
    // ribuan id pertama — kebalikan dari kegagalannya.
    let now = NOW;
    const guard = new SeenMessageGuard({ now: () => now, ttlMs: 60_000 });
    guard.accept('msg-1');
    expect(guard.accept('msg-1')).toBe(false);

    now += 60_001;

    expect(guard.accept('msg-1')).toBe(true);
  });

  it('membuang id kedaluwarsa saat menyalin yang baru', () => {
    let now = NOW;
    const guard = new SeenMessageGuard({ now: () => now, ttlMs: 1_000 });
    guard.accept('lama');
    expect(guard.size).toBe(1);

    now += 5_000;
    guard.accept('baru');

    expect(guard.size).toBe(1);
  });

  it('tidak tumbuh melewati batas entri', () => {
    // Batas ini yang menjaga proses berjam-jam tidak menahan memori tanpa
    // batas. Tanpa pruning, 5.000 guild aktif akan menumpuk semuanya.
    const guard = guardAt(NOW, { maxEntries: 10 });

    for (let i = 0; i < 5_000; i += 1) guard.accept(`msg-${i}`);

    expect(guard.size).toBeLessThanOrEqual(10);
  });

  it('membuang yang paling tua lebih dulu saat penuh', () => {
    const guard = guardAt(NOW, { maxEntries: 3 });
    guard.accept('a');
    guard.accept('b');
    guard.accept('c');
    guard.accept('d');

    expect(guard.size).toBe(3);
    // 'a' sudah keluar, jadi tidak lagi dihitung duplikat.
    expect(guard.accept('a')).toBe(true);
  });

  it('reset mengosongkan seluruh ingatan', () => {
    const guard = guardAt(NOW);
    guard.accept('msg-1');
    expect(guard.accept('msg-1')).toBe(false);

    guard.reset();

    expect(guard.size).toBe(0);
    expect(guard.accept('msg-1')).toBe(true);
  });

  it('menahan id yang sama lintas guild, karena id Discord unik secara global', () => {
    // Asumsi desain yang dipakai `messageCreate`: penjaga menyimpan id pesan
    // apa adanya, tanpa guild. Itu aman karena snowflake Discord unik
    // secara global — dua guild tidak mungkin memakai id yang sama. Kalau
    // suatu saat id-nya jadi hanya unik per guild, asumsi ini wajib ditulis
    // ulang, dan tes inilah yang akan mengingatkan untuk melakukannya.
    const guard = guardAt(NOW);

    expect(guard.accept('msg-1')).toBe(true);
    expect(guard.accept('msg-1')).toBe(false);
  });

  it('masa ingat bawaan menutup jendela redelivery tanpa menahan pesan selamanya', () => {
    expect(DEFAULT_SEEN_MESSAGE_TTL_MS).toBe(10 * 60_000);

    const guard = new SeenMessageGuard({ now: () => NOW });
    expect(guard.accept('msg-1')).toBe(true);
    // Sepuluh menit kemudian id yang sama sudah boleh dilepas.
    const later = new SeenMessageGuard({ now: () => NOW + DEFAULT_SEEN_MESSAGE_TTL_MS + 1 });
    expect(later.accept('msg-1')).toBe(true);
  });

  it('berfungsi dengan entri nol', () => {
    const guard = guardAt(NOW, { maxEntries: 0 });

    // Batas minimum 1: penjaga yang tidak bisa mengingat apa pun akan
    // membiarkan setiap pengiriman ulang lewat, jadi batas bawahnya dijaga.
    expect(guard.size).toBe(0);
    guard.accept('msg-1');
    expect(guard.size).toBe(1);
  });
});