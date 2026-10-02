import { describe, expect, it } from 'vitest';
import { formatDuration, formatUptime } from '../src/utils/duration.js';

describe('formatDuration', () => {
  it('memformat durasi di bawah satu jam sebagai m:ss', () => {
    expect(formatDuration(65_000)).toBe('1:05');
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(9_000)).toBe('0:09');
  });

  it('memformat durasi panjang sebagai h:mm:ss', () => {
    expect(formatDuration(3_723_000)).toBe('1:02:03');
    expect(formatDuration(21_600_000)).toBe('6:00:00');
  });

  it('aman untuk nilai tidak valid', () => {
    expect(formatDuration(Number.NaN)).toBe('0:00');
    expect(formatDuration(-1)).toBe('0:00');
  });
});

describe('formatUptime', () => {
  it('menyusun satuan dari yang terbesar', () => {
    expect(formatUptime(3_723_000)).toBe('1 jam 2 menit');
    expect(formatUptime(90_000_000)).toBe('1 hari 1 jam');
    expect(formatUptime(45_000)).toBe('45 detik');
  });

  it('mengembalikan "baru saja" untuk nilai nol', () => {
    expect(formatUptime(0)).toBe('baru saja');
  });
});
