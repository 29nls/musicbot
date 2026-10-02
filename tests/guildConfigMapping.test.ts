import { describe, expect, it } from 'vitest';
import { parseModules, toDomain, toPrismaData, type GuildConfigRow } from '../src/modules/config/mapping.js';
import { DEFAULT_MODULES, type GuildConfig } from '../src/modules/config/types.js';

const row: GuildConfigRow = {
  guildId: '123456789012345678',
  logChannelId: '223456789012345678',
  welcomeChannelId: null,
  goodbyeChannelId: null,
  djRoleId: '323456789012345678',
  autoroleId: '523456789012345678',
  autoroleBotId: null,
  welcomeMessage: 'Halo {user}!',
  goodbyeMessage: null,
  defaultVolume: 70,
  idleTimeoutSec: 120,
  modulesEnabled: { music: true, moderation: false, automod: true, logging: false },
  locale: 'id',
};

describe('toDomain', () => {
  it('memetakan baris database menjadi konfigurasi domain', () => {
    const config = toDomain(row);

    expect(config.guildId).toBe(row.guildId);
    expect(config.logChannelId).toBe('223456789012345678');
    expect(config.welcomeChannelId).toBeNull();
    expect(config.djRoleId).toBe('323456789012345678');
    expect(config.autoroleId).toBe('523456789012345678');
    expect(config.autoroleBotId).toBeNull();
    expect(config.goodbyeMessage).toBeNull();
    expect(config.defaultVolume).toBe(70);
    expect(config.modules).toEqual({ music: true, moderation: false, automod: true, logging: false });
  });
});

describe('parseModules', () => {
  it('menerima objek lengkap', () => {
    expect(parseModules({ music: false, moderation: true, automod: true, logging: true })).toEqual({
      music: false,
      moderation: true,
      automod: true,
      logging: true,
    });
  });

  it('melengkapi key yang hilang dengan default', () => {
    expect(parseModules({ automod: true })).toEqual({ ...DEFAULT_MODULES, automod: true });
  });

  it('tahan terhadap data rusak (null, string, array, angka)', () => {
    expect(parseModules(null)).toEqual(DEFAULT_MODULES);
    expect(parseModules('{"music":true}')).toEqual(DEFAULT_MODULES);
    expect(parseModules([])).toEqual(DEFAULT_MODULES);
    expect(parseModules(42)).toEqual(DEFAULT_MODULES);
  });

  it('mengabaikan nilai non-boolean', () => {
    expect(parseModules({ music: 'yes', logging: 1 })).toEqual(DEFAULT_MODULES);
  });
});

describe('toPrismaData', () => {
  it('menyiapkan kolom write tanpa guildId dan menyalin modules', () => {
    const config: GuildConfig = {
      guildId: '123456789012345678',
      logChannelId: null,
      welcomeChannelId: null,
      goodbyeChannelId: null,
      djRoleId: null,
      autoroleId: null,
      autoroleBotId: null,
      welcomeMessage: null,
      goodbyeMessage: null,
      defaultVolume: 100,
      idleTimeoutSec: 300,
      modules: { music: true, moderation: true, automod: false, logging: false },
      locale: 'id',
    };

    const data = toPrismaData(config);

    expect(data).not.toHaveProperty('guildId');
    expect(data.modulesEnabled).toEqual(config.modules);
    // Salinan, bukan referensi ke objek modul yang sama.
    expect(data.modulesEnabled).not.toBe(config.modules);
  });
});
