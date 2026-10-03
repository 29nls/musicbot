import { decodeCommandCache, encodeCommandCache } from '../src/modules/customcommands/cacheCodec.js';
import { afterEach, describe, expect, it } from 'vitest';
import {
  getKeyValueStore,
  MemoryKeyValueStore,
  setKeyValueStore,
} from '../src/services/kvStore.js';
import type { CustomCommand } from '../src/modules/customcommands/types.js';

/**
 * Codec cache perintah custom.
 *
 * Yang diuji di sini adalah kontrak dengan store: nilai yang ditulis harus
 * bisa dibaca kembali utuh, dan nilai yang rusak harus berarti "tidak ada
 * cache" — bukan error yang membuat semua `!perintah` di server itu diam.
 */

const CREATED = new Date('2026-09-01T10:00:00.000Z');
const UPDATED = new Date('2026-09-02T11:30:00.000Z');

function command(overrides: Partial<CustomCommand> = {}): CustomCommand {
  return {
    id: 1,
    guildId: '123456789012345678',
    name: 'ping',
    response: 'pong {pengguna}',
    createdBy: '999999999999999999',
    createdAt: CREATED,
    updatedAt: UPDATED,
    ...overrides,
  };
}

describe('encodeCommandCache', () => {
  it('menulis JSON yang bisa dibaca kembali persis', () => {
    const decoded = decodeCommandCache(encodeCommandCache([command()]));

    expect(decoded).toHaveLength(1);
    expect(decoded[0]).toMatchObject({
      id: 1,
      name: 'ping',
      response: 'pong {pengguna}',
      createdBy: '999999999999999999',
    });
  });

  it('date kembali sebagai Date, bukan string', () => {
    const decoded = decodeCommandCache(encodeCommandCache([command()]));

    expect(decoded[0]?.createdAt).toBeInstanceOf(Date);
    expect(decoded[0]?.createdAt.toISOString()).toBe(CREATED.toISOString());
    expect(decoded[0]?.updatedAt.toISOString()).toBe(UPDATED.toISOString());
  });

  it('daftar kosong menghasilkan JSON yang valid dan dibaca sebagai kosong', () => {
    expect(decodeCommandCache(encodeCommandCache([]))).toEqual([]);
  });

  it('beberapa perintah terurut apa adanya', () => {
    const encoded = encodeCommandCache([
      command({ id: 1, name: 'ping' }),
      command({ id: 2, name: 'rules' }),
    ]);

    expect(decodeCommandCache(encoded).map((row) => row.name)).toEqual(['ping', 'rules']);
  });
});

describe('decodeCommandCache', () => {
  it('null berarti tidak ada cache', () => {
    expect(decodeCommandCache(null)).toEqual([]);
  });

  it('JSON rusak dibaca sebagai tidak ada, bukan melempar', () => {
    expect(decodeCommandCache('{bukan json')).toEqual([]);
    expect(decodeCommandCache('')).toEqual([]);
  });

  it('bukan array dibaca sebagai tidak ada', () => {
    expect(decodeCommandCache('{"perintah":[]}')).toEqual([]);
  });

  it('entri dengan bentuk salah dilewati, bukan menggagalkan seluruh daftar', () => {
    const raw = JSON.stringify([
      { id: 1, name: 'ping', response: 'pong', createdBy: '1', createdAt: CREATED.toISOString(), updatedAt: UPDATED.toISOString() },
      { name: 'tanpa-id' },
      null,
      'bukan objek',
      { id: 2, name: 'rules', response: 'oke', createdBy: '1', createdAt: CREATED.toISOString(), updatedAt: 'tanggal rusak' },
      { id: 3, name: 'jam', response: 'oke', createdBy: '1', createdAt: CREATED.toISOString(), updatedAt: UPDATED.toISOString() },
    ]);

    const decoded = decodeCommandCache(raw);

    expect(decoded.map((row) => row.name)).toEqual(['ping', 'jam']);
  });

  it('nama kosong tidak pernah jadi pemicu yang bisa dipanggil', () => {
    const raw = JSON.stringify([
      { id: 1, name: '   ', response: 'x', createdBy: '1', createdAt: CREATED.toISOString(), updatedAt: UPDATED.toISOString() },
    ]);

    expect(decodeCommandCache(raw)).toEqual([]);
  });
});

describe('store proses', () => {
  afterEach(() => {
    setKeyValueStore({ store: new MemoryKeyValueStore(), driver: 'memory' });
  });

  it('default-nya store memori, jadi modul lain tidak gagal sebelum startup selesai', () => {
    expect(getKeyValueStore()).toBeInstanceOf(MemoryKeyValueStore);
  });

  it('store bisa diganti dan yang baru dipakai semua modul', async () => {
    const replacement = new MemoryKeyValueStore();
    setKeyValueStore({ store: replacement, driver: 'memory' });

    expect(getKeyValueStore()).toBe(replacement);

    await replacement.set('cek', 'nilai');
    expect(await getKeyValueStore().get('cek')).toBe('nilai');
  });
});