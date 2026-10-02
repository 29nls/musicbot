import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  checkCooldown,
  cooldownBucketCount,
  resetCooldown,
} from '../src/utils/cooldown.js';

/**
 * Tes untuk rate limit per user.
 *
 * Waktu dipalsukan supaya kedaluwarsa bisa diuji tanpa menunggu detik asli.
 * Setiap tes memakai kunci unik: `buckets` adalah state tingkat modul yang
 * hidup selama file tes ini.
 */
describe('checkCooldown', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-03T00:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('mengizinkan pemakaian pertama', () => {
    expect(checkCooldown('first-call', 5)).toBe(0);
  });

  it('menolak pemakaian kedua dan melaporkan sisa detik', () => {
    expect(checkCooldown('second-call', 5)).toBe(0);

    const wait = checkCooldown('second-call', 5);
    expect(wait).toBeGreaterThan(0);
    expect(wait).toBeLessThanOrEqual(5);
  });

  it('membulatkan sisa waktu ke atas supaya pesan tidak pernah bilang 0 detik', () => {
    checkCooldown('rounding', 5);
    vi.advanceTimersByTime(2_500);

    // Sisa 2,5 detik → 3, bukan 2 atau 0.
    expect(checkCooldown('rounding', 5)).toBe(3);
  });

  it('mengizinkan lagi setelah cooldown habis', () => {
    checkCooldown('expires', 5);
    vi.advanceTimersByTime(5_000);

    expect(checkCooldown('expires', 5)).toBe(0);
  });

  it('memperpanjang cooldown dari waktu pemakaian yang berhasil, bukan dari yang ditolak', () => {
    checkCooldown('no-slide', 5);
    vi.advanceTimersByTime(3_000);
    expect(checkCooldown('no-slide', 5)).toBe(2);

    // Percobaan yang ditolak tidak boleh menggeser jendela.
    vi.advanceTimersByTime(2_000);
    expect(checkCooldown('no-slide', 5)).toBe(0);
  });

  it('memisahkan kunci yang berbeda', () => {
    checkCooldown('user-a:play', 5);

    expect(checkCooldown('user-b:play', 5)).toBe(0);
    expect(checkCooldown('user-a:queue', 5)).toBe(0);
  });

  it('melewati cooldown kalau durasinya nol atau tidak masuk akal', () => {
    for (const seconds of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(checkCooldown(`skip-${seconds}`, seconds)).toBe(0);
      expect(checkCooldown(`skip-${seconds}`, seconds)).toBe(0);
    }
  });

  it('tidak menyimpan bucket untuk perintah tanpa cooldown', () => {
    const before = cooldownBucketCount();
    checkCooldown('no-cooldown-command', 0);

    expect(cooldownBucketCount()).toBe(before);
  });
});

describe('resetCooldown', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-03T00:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('mengizinkan pemakaian langsung setelah direset', () => {
    checkCooldown('reset-me', 30);
    expect(checkCooldown('reset-me', 30)).toBeGreaterThan(0);

    resetCooldown('reset-me');

    expect(checkCooldown('reset-me', 30)).toBe(0);
  });

  it('aman dipanggil untuk kunci yang tidak ada', () => {
    expect(() => resetCooldown('tidak-pernah-ada')).not.toThrow();
  });
});

describe('pemangkasan bucket', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-03T00:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('membuang bucket yang sudah kedaluwarsa saat map sudah besar', () => {
    // Isi sampai batas (10.000) dengan cooldown panjang.
    for (let index = 0; index < 10_000; index += 1) {
      checkCooldown(`bulk-${index}`, 60);
    }

    expect(cooldownBucketCount()).toBeGreaterThanOrEqual(10_000);

    // Semua kedaluwarsa, lalu satu pemakaian baru memicu pemangkasan.
    vi.advanceTimersByTime(61_000);
    checkCooldown('pemicu-pemangkasan', 5);

    // Hanya bucket baru yang tersisa: 10.000 entri mati tidak menahan memori.
    expect(cooldownBucketCount()).toBe(1);
  });
});