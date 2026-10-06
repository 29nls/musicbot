import { describe, expect, it, vi, afterEach } from 'vitest';

import { log } from '../lib/log.js';

/**
 * Tes logger bukan tentang format(JSON.stringify tidak mungkin gagal pada
 * objek biasa). Yang diuji adalah dua hal yang kalau rusak akan membocorkan
 * rahasia atau menutupi masalah: penyembunyian nilai, dan penghormatan level.
 */

const captured: string[] = [];

function captureWrite(): void {
  captured.length = 0;
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
    captured.push(String(chunk));
    return true;
  });
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
    captured.push(String(chunk));
    return true;
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  captured.length = 0;
});

function lines(): unknown[] {
  return captured.map((line) => JSON.parse(line.trim()) as unknown);
}

describe('log', () => {
  it('menulis satu baris JSON dengan bentuk yang bisa dibaca mesin', () => {
    captureWrite();
    log.info('config.write.ok', { guildId: '1', fields: ['defaultVolume'] }, {});

    expect(captured).toHaveLength(1);
    const [entry] = lines() as Record<string, unknown>[];
    expect(entry).toMatchObject({
      level: 'info',
      service: 'dashboard',
      event: 'config.write.ok',
      guildId: '1',
      fields: ['defaultVolume'],
    });
    expect(typeof entry?.time).toBe('string');
    // Tidak ada nilai produksi di bagian atas: bersama dan bisa dibandingkan
    // dengan log bot tanpa mencari-cari di dalam JSON.
    expect(Object.keys(entry ?? {}).slice(0, 4)).toEqual(['time', 'level', 'service', 'event']);
  });

  it('menyembunyikan nilai yang namanya menandakan rahasia', () => {
    captureWrite();
    log.warn('auth.failed', {
      password: 'rahasia',
      access_token: 'token-panjang',
      state: 'nonce',
      guildId: '2',
    }, {});

    const [entry] = lines() as Record<string, unknown>[];
    expect(entry).toMatchObject({
      password: '[disembunyikan]',
      access_token: '[disembunyikan]',
      state: '[disembunyikan]',
      guildId: '2',
    });
  });

  it('menyembunyikan rahasia yang tersembunyi di dalam objek bersarang', () => {
    captureWrite();
    log.error('db.fail', { prisma: { database_url: 'postgres://user:pass@host/db', retry: 3 } }, {});

    const [entry] = lines() as Record<string, unknown>[];
    expect(entry).toMatchObject({ prisma: { database_url: '[disembunyikan]', retry: 3 } });
  });

  it('menulis error dan warn ke stderr, debug dan info ke stdout', () => {
    captureWrite();
    const source = { DASHBOARD_LOG: 'debug' };
    log.debug('a', {}, source);
    log.info('b', {}, source);
    log.warn('c', {}, source);
    log.error('d', {}, source);

    expect(captured).toHaveLength(4);
    const levels = (lines() as Record<string, unknown>[]).map((entry) => entry.level);
    expect(levels).toEqual(['debug', 'info', 'warn', 'error']);
  });

  it('tidak menulis debug pada ambang bawaan', () => {
    // Sabar: `debug` harus diam tanpa `DASHBOARD_LOG=debug`. Kalau tidak, satu
    // health check yang gagal tiap 30 detik bisa mengisi disk di produksi.
    captureWrite();
    log.debug('tak tampil', {}, {});

    expect(captured).toHaveLength(0);
  });

  it('diam pada level yang lebih rendah dari ambang', () => {
    captureWrite();
    log.debug('tak tampil', {}, { DASHBOARD_LOG: 'info' });
    log.info('tampil', {}, { DASHBOARD_LOG: 'info' });
    log.warn('tampil juga', {}, { DASHBOARD_LOG: 'info' });

    expect((lines() as Record<string, unknown>[]).map((entry) => entry.event)).toEqual([
      'tampil',
      'tampil juga',
    ]);
  });

  it('diam sepenuhnya pada silent', () => {
    captureWrite();
    log.error('tidak boleh muncul', {}, { DASHBOARD_LOG: 'silent' });

    expect(captured).toHaveLength(0);
  });

  it('berhenti pada error dan tidak melempar', () => {
    captureWrite();
    vi.spyOn(process.stderr, 'write').mockImplementation(() => {
      throw new Error('EPIPE');
    });

    expect(() => log.error('stdout tertutup', {}, {})).not.toThrow();
  });

  it('memotong string dan array yang tidak wajar besar', () => {
    captureWrite();
    log.info('besar', {
      note: 'x'.repeat(500),
      ids: Array.from({ length: 100 }, (_, index) => String(index)),
    }, {});

    const [entry] = lines() as { note: string; ids: string[] }[];
    expect(entry?.note.length).toBeLessThanOrEqual(200);
    expect(entry?.ids.length).toBe(20);
  });

  it('mempertahankan nama dan pesan Error', () => {
    captureWrite();
    log.error('gagal', { cause: new TypeError('tipe salah') }, {});

    // `message` dan `name` non-enumerable. Kalau logger memeriksa `object`
    // sebelum `Error`, setiap Error berubah jadi `{}` dan penyebabnya hilang.
    const [entry] = lines() as { cause: { name: string; message: string } }[];
    expect(entry?.cause).toEqual({ name: 'TypeError', message: 'tipe salah' });
  });
});
