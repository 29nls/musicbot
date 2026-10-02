import { describe, expect, it } from 'vitest';
import { formatCaseId, parseCaseNumber } from '../src/modules/moderation/caseNumber.js';
import { describeTimeout, parseTimeoutDuration } from '../src/modules/moderation/timeout.js';

describe('formatCaseId', () => {
  it('memaksa empat digit', () => {
    expect(formatCaseId(7)).toBe('#CASE-0007');
    expect(formatCaseId(142)).toBe('#CASE-0142');
  });

  it('membiarkan nomor lebih dari empat digit', () => {
    expect(formatCaseId(12_345)).toBe('#CASE-12345');
  });
});

describe('parseCaseNumber', () => {
  it('menerima format lengkap dan variasi spasi', () => {
    expect(parseCaseNumber('#CASE-0142')).toBe(142);
    expect(parseCaseNumber('case-142')).toBe(142);
    expect(parseCaseNumber('CASE 142')).toBe(142);
    expect(parseCaseNumber('  #case0142  ')).toBe(142);
  });

  it('menerima angka polos', () => {
    expect(parseCaseNumber('142')).toBe(142);
  });

  it('menolak format tidak dikenal atau nol', () => {
    expect(parseCaseNumber('abc')).toBeNull();
    expect(parseCaseNumber('#CASE-')).toBeNull();
    expect(parseCaseNumber('0')).toBeNull();
    expect(parseCaseNumber('')).toBeNull();
    expect(parseCaseNumber('-5')).toBeNull();
  });
});

describe('parseTimeoutDuration', () => {
  it('membaca satuan s/m/h/d dan nama Indonesia', () => {
    expect(parseTimeoutDuration('30s')).toBe(30_000);
    expect(parseTimeoutDuration('10m')).toBe(600_000);
    expect(parseTimeoutDuration('2h')).toBe(7_200_000);
    expect(parseTimeoutDuration('7d')).toBe(604_800_000);
    expect(parseTimeoutDuration('15 menit')).toBe(900_000);
  });

  it('menganggap angka polos sebagai menit', () => {
    expect(parseTimeoutDuration('10')).toBe(600_000);
  });

  it('menolak durasi di luar batas Discord (1 detik – 28 hari)', () => {
    expect(parseTimeoutDuration('0m')).toBeNull();
    expect(parseTimeoutDuration('29d')).toBeNull();
    expect(parseTimeoutDuration('999999m')).toBeNull();
  });

  it('menolak format salah', () => {
    expect(parseTimeoutDuration('1.5h')).toBeNull();
    expect(parseTimeoutDuration('10x')).toBeNull();
    expect(parseTimeoutDuration('abc')).toBeNull();
    expect(parseTimeoutDuration('')).toBeNull();
  });
});

describe('describeTimeout', () => {
  it('memilih satuan terbesar yang pas', () => {
    expect(describeTimeout(600_000)).toBe('10 menit');
    expect(describeTimeout(3_600_000)).toBe('1 jam');
    expect(describeTimeout(2 * 86_400_000)).toBe('2 hari');
    expect(describeTimeout(45_000)).toBe('45 detik');
  });
});
