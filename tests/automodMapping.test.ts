import { describe, expect, it } from 'vitest';
import { parseActions, parseWhitelist, toDomain } from '../src/modules/automod/mapping.js';
import { DEFAULT_THRESHOLDS } from '../src/modules/automod/types.js';

describe('parseWhitelist', () => {
  it('membaca semua daftar yang valid', () => {
    const whitelist = parseWhitelist({
      channels: ['111111111111111111'],
      roles: ['222222222222222222'],
      domains: ['youtube.com'],
      words: ['anjing'],
      invites: ['abc123'],
    });

    expect(whitelist.channels).toEqual(['111111111111111111']);
    expect(whitelist.words).toEqual(['anjing']);
    expect(whitelist.invites).toEqual(['abc123']);
  });

  it('tahan data rusak (null, string, array campuran)', () => {
    expect(parseWhitelist(null)).toEqual({
      channels: [],
      roles: [],
      domains: [],
      words: [],
      invites: [],
    });
    expect(parseWhitelist('bukan-json')).toEqual({
      channels: [],
      roles: [],
      domains: [],
      words: [],
      invites: [],
    });

    const mixed = parseWhitelist({ channels: ['ok', 42, null], roles: 'bukan array' });
    expect(mixed.channels).toEqual(['ok']);
    expect(mixed.roles).toEqual([]);
  });
});

describe('parseActions', () => {
  it('membuang aksi yang tidak dikenal', () => {
    expect(parseActions(['delete', 'warn', 'hapus'])).toEqual(['delete', 'warn']);
  });

  it('jatuh ke "delete" kalau kosong/rusak', () => {
    expect(parseActions([])).toEqual(['delete']);
    expect(parseActions(null)).toEqual(['delete']);
    expect(parseActions(['hapus semua'])).toEqual(['delete']);
  });
});

describe('toDomain', () => {
  it('memetakan baris lengkap', () => {
    const rule = toDomain({
      guildId: '123456789012345678',
      type: 'spam',
      enabled: false,
      threshold: 3,
      actions: ['delete', 'warn'],
      whitelist: { channels: ['111111111111111111'] },
    });

    expect(rule).toMatchObject({ type: 'spam', enabled: false, threshold: 3 });
    expect(rule?.actions).toEqual(['delete', 'warn']);
    expect(rule?.whitelist.channels).toEqual(['111111111111111111']);
  });

  it('mengabaikan baris dengan tipe tidak dikenal', () => {
    expect(
      toDomain({
        guildId: '123456789012345678',
        type: 'rule-lawas',
        enabled: true,
        threshold: 1,
        actions: [],
        whitelist: {},
      }),
    ).toBeNull();
  });

  it('memakai ambang default kalau nilainya bukan angka', () => {
    const rule = toDomain({
      guildId: '123456789012345678',
      type: 'duplicate',
      enabled: true,
      threshold: Number.NaN,
      actions: [],
      whitelist: {},
    });

    expect(rule?.threshold).toBe(DEFAULT_THRESHOLDS.duplicate);
  });
});
