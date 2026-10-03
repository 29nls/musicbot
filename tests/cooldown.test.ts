import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  checkCooldown,
  cooldownBucketCount,
  resetCooldown,
  setCooldownStore,
} from '../src/utils/cooldown.js';
import { MemoryKeyValueStore } from '../src/services/kvStore.js';

/**
 * Rate limit per user per perintah.
 *
 * Store yang dipakai tes adalah store memori, jadi waktu bisa dipalsukan dan
 * kedaluwarsa bisa diuji tanpa menunggu detik asli. Setiap tes memakai kunci
 * unik: state store hidup selama file tes ini berjalan.
 */
describe('checkCooldown', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-03T00:00:00.000Z'));
    setCooldownStore(new MemoryKeyValueStore());
  });

  afterEach(async () => {
    vi.useRealTimers();
    await resetCooldown('bersih');
  });

  it('mengizinkan pemakaian pertama', async () => {
    expect(await checkCooldown('pertama', 5)).toBe(0);
  });

  it('menolak pemakaian kedua dan melaporkan sisa detik', async () => {
    expect(await checkCooldown('kedua', 5)).toBe(0);

    const wait = await checkCooldown('kedua', 5);
    expect(wait).toBeGreaterThan(0);
    expect(wait).toBeLessThanOrEqual(5);
  });

  it('membulatkan sisa waktu ke atas supaya pesan tidak pernah bilang 0 detik', async () => {
    await checkCooldown('pembulatan', 5);
    vi.advanceTimersByTime(2_500);

    // Sisa 2,5 detik -> 3, bukan 2 atau 0.
    expect(await checkCooldown('pembulatan', 5)).toBe(3);
  });

  it('mengizinkan lagi setelah cooldown habis', async () => {
    await checkCooldown('kedaluwarsa', 5);
    vi.advanceTimersByTime(5_000);

    expect(await checkCooldown('kedaluwarsa', 5)).toBe(0);
  });

  it('percobaan yang ditolak tidak menggeser jendela', async () => {
    await checkCooldown('tidak-geser', 5);
    vi.advanceTimersByTime(3_000);
    expect(await checkCooldown('tidak-geser', 5)).toBe(2);

    // Kalau percobaan yang ditolak ikut menulis ulang TTL, jendela ikut geser
    // dan pemakaian berikutnya tetap terblokir.
    vi.advanceTimersByTime(2_000);
    expect(await checkCooldown('tidak-geser', 5)).toBe(0);
  });

  it('memisahkan kunci yang berbeda', async () => {
    await checkCooldown('pengguna-a:play', 5);

    expect(await checkCooldown('pengguna-b:play', 5)).toBe(0);
    expect(await checkCooldown('pengguna-a:queue', 5)).toBe(0);
  });

  it('melewati cooldown kalau durasinya nol atau tidak masuk akal', async () => {
    for (const seconds of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(await checkCooldown(`lewati-${seconds}`, seconds)).toBe(0);
      expect(await checkCooldown(`lewati-${seconds}`, seconds)).toBe(0);
    }
  });

  it('kunci diberi awalan sendiri supaya tidak bentrok dengan store lain', async () => {
    const store = new MemoryKeyValueStore();
    setCooldownStore(store);
    await checkCooldown('awalan', 30);

    // Key mentah "awalan" tidak boleh ada: semua key cooldown berawalan harmony:.
    expect(await store.get('awalan')).toBeNull();
  });
});

describe('resetCooldown', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-03T00:00:00.000Z'));
    setCooldownStore(new MemoryKeyValueStore());
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('mengizinkan pemakaian langsung setelah direset', async () => {
    await checkCooldown('reset', 30);
    expect(await checkCooldown('reset', 30)).toBeGreaterThan(0);

    await resetCooldown('reset');

    expect(await checkCooldown('reset', 30)).toBe(0);
  });

  it('aman dipanggil untuk kunci yang tidak ada', async () => {
    await expect(resetCooldown('tidak-pernah-ada')).resolves.toBeUndefined();
  });
});

describe('pemangkasan bucket', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-03T00:00:00.000Z'));
    setCooldownStore(new MemoryKeyValueStore());
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('store memori dibatasi supaya tidak tumbuh tanpa batas', async () => {
    for (let index = 0; index < 10_050; index += 1) {
      await checkCooldown(`banyak-${index}`, 60);
    }

    expect(await cooldownBucketCount()).toBeLessThanOrEqual(10_000);
  });
});