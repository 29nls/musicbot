import { afterEach, describe, expect, it, vi } from 'vitest';
import { GuildConfigService } from '../src/modules/config/guildConfigService.js';
import type { GuildConfigRepository } from '../src/modules/config/repository.js';
import { DEFAULT_IDLE_TIMEOUT_SEC, DEFAULT_MODULES, type GuildConfig } from '../src/modules/config/types.js';
import { ConfigValidationError } from '../src/modules/config/validation.js';

const GUILD_ID = '123456789012345678';

class FakeRepository implements GuildConfigRepository {
  public readonly rows = new Map<string, GuildConfig>();
  public findCalls = 0;
  public upsertCalls = 0;
  public removeCalls = 0;

  async find(guildId: string): Promise<GuildConfig | null> {
    this.findCalls += 1;
    return this.rows.get(guildId) ?? null;
  }

  async upsert(config: GuildConfig): Promise<GuildConfig> {
    this.upsertCalls += 1;
    const stored = structuredClone(config);
    this.rows.set(config.guildId, stored);
    return stored;
  }

  async remove(guildId: string): Promise<void> {
    this.removeCalls += 1;
    this.rows.delete(guildId);
  }
}

function makeService(repository: FakeRepository, cacheTtlMs = 60_000): GuildConfigService {
  return new GuildConfigService(repository, { defaults: { defaultVolume: 80 }, cacheTtlMs });
}

afterEach(() => {
  vi.useRealTimers();
});

describe('GuildConfigService', () => {
  it('memberi nilai default untuk server yang belum pernah di-setup', async () => {
    const config = await makeService(new FakeRepository()).get(GUILD_ID);

    expect(config.guildId).toBe(GUILD_ID);
    expect(config.defaultVolume).toBe(80); // dari opsi defaults
    expect(config.idleTimeoutSec).toBe(DEFAULT_IDLE_TIMEOUT_SEC);
    expect(config.modules).toEqual(DEFAULT_MODULES);
    expect(config.logChannelId).toBeNull();
    expect(config.welcomeMessage).toBeNull();
  });

  it('membaca database hanya sekali saat cache masih berlaku', async () => {
    const repository = new FakeRepository();
    const service = makeService(repository);

    await service.get(GUILD_ID);
    await service.get(GUILD_ID);
    await service.get(GUILD_ID);

    expect(repository.findCalls).toBe(1);
  });

  it('tanpa cache (TTL 0) selalu membaca database', async () => {
    const repository = new FakeRepository();
    const service = makeService(repository, 0);

    await service.get(GUILD_ID);
    await service.get(GUILD_ID);

    expect(repository.findCalls).toBe(2);
  });

  it('perubahan langsung berlaku tanpa menunggu TTL', async () => {
    const repository = new FakeRepository();
    const service = makeService(repository);

    await service.get(GUILD_ID); // isi cache dengan default
    const updated = await service.update(GUILD_ID, { logChannelId: '223456789012345678' });
    const readBack = await service.get(GUILD_ID);

    expect(updated.logChannelId).toBe('223456789012345678');
    expect(readBack.logChannelId).toBe('223456789012345678');
    expect(repository.upsertCalls).toBe(1);
  });

  it('patch sebagian tidak menghapus pengaturan lain', async () => {
    const repository = new FakeRepository();
    const service = makeService(repository);

    await service.update(GUILD_ID, { welcomeChannelId: '323456789012345678', defaultVolume: 55 });
    const config = await service.update(GUILD_ID, { djRoleId: '423456789012345678' });

    expect(config.welcomeChannelId).toBe('323456789012345678');
    expect(config.defaultVolume).toBe(55);
    expect(config.djRoleId).toBe('423456789012345678');
  });

  it('merge modul: menyalakan satu modul tidak mematikan yang lain', async () => {
    const repository = new FakeRepository();
    const service = makeService(repository);

    const config = await service.update(GUILD_ID, { modules: { automod: true } });

    expect(config.modules).toEqual({ ...DEFAULT_MODULES, automod: true });
  });

  it('menolak nilai tidak valid sebelum menyentuh database', async () => {
    const repository = new FakeRepository();
    const service = makeService(repository);

    await expect(service.update(GUILD_ID, { defaultVolume: 900 })).rejects.toBeInstanceOf(ConfigValidationError);
    await expect(service.update(GUILD_ID, { idleTimeoutSec: 5 })).rejects.toThrow(/idleTimeoutSec/);
    expect(repository.upsertCalls).toBe(0);
  });

  it('reset menghapus baris dan kembali ke default', async () => {
    const repository = new FakeRepository();
    const service = makeService(repository);

    await service.update(GUILD_ID, { logChannelId: '223456789012345678', modules: { automod: true } });
    const config = await service.reset(GUILD_ID);

    expect(repository.removeCalls).toBe(1);
    expect(repository.rows.has(GUILD_ID)).toBe(false);
    expect(config.logChannelId).toBeNull();
    expect(config.modules).toEqual(DEFAULT_MODULES);
  });

  it('cache kedaluwarsa setelah TTL sehingga perubahan dari proses lain terbaca', async () => {
    vi.useFakeTimers();

    const repository = new FakeRepository();
    const service = makeService(repository, 1_000);

    await service.get(GUILD_ID);

    // Simulasi proses lain (mis. instance bot kedua) yang mengubah baris DB.
    repository.rows.set(GUILD_ID, {
      guildId: GUILD_ID,
      logChannelId: '223456789012345678',
      welcomeChannelId: null,
      goodbyeChannelId: null,
      djRoleId: null,
      welcomeMessage: null,
      defaultVolume: 100,
      idleTimeoutSec: 300,
      modules: DEFAULT_MODULES,
      locale: 'id',
    });

    vi.advanceTimersByTime(1_500);

    const config = await service.get(GUILD_ID);

    expect(config.logChannelId).toBe('223456789012345678');
    expect(repository.findCalls).toBe(2);
  });

  it('invalidate membuang cache satu server saja', async () => {
    const repository = new FakeRepository();
    const service = makeService(repository);
    const otherGuild = '987654321098765432';

    await service.get(GUILD_ID);
    await service.get(otherGuild);
    service.invalidate(GUILD_ID);
    await service.get(GUILD_ID);
    await service.get(otherGuild);

    expect(repository.findCalls).toBe(3); // GUILD_ID dibaca 2x, otherGuild 1x
  });

  it('isModuleEnabled membaca modul aktif', async () => {
    const service = makeService(new FakeRepository());

    await expect(service.isModuleEnabled(GUILD_ID, 'music')).resolves.toBe(true);
    await expect(service.isModuleEnabled(GUILD_ID, 'automod')).resolves.toBe(false);
  });
});
