import { describe, expect, it } from 'vitest';
import type { AutomodRepository } from '../src/modules/automod/repository.js';
import { AutomodService, buildPolicy } from '../src/modules/automod/service.js';
import { DEFAULT_THRESHOLDS, defaultRule, type AutomodRule } from '../src/modules/automod/types.js';
import { AutomodValidationError } from '../src/modules/automod/validation.js';

const GUILD_ID = '123456789012345678';
const CHANNEL_ID = '111111111111111111';
const ROLE_ID = '222222222222222222';

class FakeAutomodRepository implements AutomodRepository {
  public readonly rows = new Map<string, Map<string, AutomodRule>>();
  public listCalls = 0;
  public saveCalls = 0;

  async list(guildId: string): Promise<AutomodRule[]> {
    this.listCalls += 1;
    return [...(this.rows.get(guildId)?.values() ?? [])].map((rule) => structuredClone(rule));
  }

  async save(guildId: string, rule: AutomodRule): Promise<void> {
    this.saveCalls += 1;
    const map = this.rows.get(guildId) ?? new Map<string, AutomodRule>();
    map.set(rule.type, structuredClone(rule));
    this.rows.set(guildId, map);
  }
}

function makeService(cacheTtlMs = 60_000): {
  repository: FakeAutomodRepository;
  service: AutomodService;
} {
  const repository = new FakeAutomodRepository();
  return { repository, service: new AutomodService(repository, { cacheTtlMs }) };
}

describe('AutomodService.getPolicy', () => {
  it('melengkapi 7 rule dengan default PRD saat belum ada baris', async () => {
    const { service } = makeService();
    const policy = await service.getPolicy(GUILD_ID);

    expect(policy.rules).toHaveLength(7);
    expect(policy.rules.every((rule) => rule.enabled)).toBe(true);
    expect(policy.rules.find((rule) => rule.type === 'spam')?.threshold).toBe(DEFAULT_THRESHOLDS.spam);
    expect(policy.rules.find((rule) => rule.type === 'mention')?.actions).toEqual(['delete', 'timeout']);
    expect(policy.exemptChannels).toEqual([]);
  });

  it('membaca database sekali selama cache berlaku', async () => {
    const { repository, service } = makeService();

    await service.getPolicy(GUILD_ID);
    await service.getPolicy(GUILD_ID);

    expect(repository.listCalls).toBe(1);
  });

  it('cache dibuang setelah update sehingga perubahan langsung terbaca', async () => {
    const { repository, service } = makeService();

    await service.getPolicy(GUILD_ID);
    await service.updateRule(GUILD_ID, 'spam', { enabled: false });
    const policy = await service.getPolicy(GUILD_ID);

    expect(repository.listCalls).toBe(2);
    expect(policy.rules.find((rule) => rule.type === 'spam')?.enabled).toBe(false);
  });
});

describe('AutomodService.updateRule', () => {
  it('mengubah ambang sesuai rentang per rule', async () => {
    const { service } = makeService();
    const updated = await service.updateRule(GUILD_ID, 'mention', { threshold: 8 });

    expect(updated.threshold).toBe(8);
  });

  it('menolak ambang di luar rentang atau rule tanpa ambang', async () => {
    const { service } = makeService();

    await expect(service.updateRule(GUILD_ID, 'spam', { threshold: 1 })).rejects.toBeInstanceOf(
      AutomodValidationError,
    );
    await expect(service.updateRule(GUILD_ID, 'caps', { threshold: 101 })).rejects.toBeInstanceOf(
      AutomodValidationError,
    );
    await expect(service.updateRule(GUILD_ID, 'invite', { threshold: 3 })).rejects.toThrow(/tidak punya ambang/);
  });
});

describe('AutomodService pengecualian', () => {
  it('menambahkan channel ke semua rule dan bisa dihapus lagi', async () => {
    const { repository, service } = makeService();

    await service.addExemption(GUILD_ID, 'channels', CHANNEL_ID);
    let policy = await service.getPolicy(GUILD_ID);

    expect(policy.exemptChannels).toContain(CHANNEL_ID);
    expect(repository.rows.get(GUILD_ID)?.size).toBe(7);

    await service.removeExemption(GUILD_ID, 'channels', CHANNEL_ID);
    policy = await service.getPolicy(GUILD_ID);

    expect(policy.exemptChannels).toEqual([]);
  });

  it('menolak duplikat dan penghapusan yang tidak ada', async () => {
    const { service } = makeService();

    await service.addExemption(GUILD_ID, 'roles', ROLE_ID);

    await expect(service.addExemption(GUILD_ID, 'roles', ROLE_ID)).rejects.toBeInstanceOf(
      AutomodValidationError,
    );
    await expect(
      service.removeExemption(GUILD_ID, 'roles', '333333333333333333'),
    ).rejects.toBeInstanceOf(AutomodValidationError);
  });

  it('menolak ID yang bukan snowflake', async () => {
    const { service } = makeService();

    await expect(service.addExemption(GUILD_ID, 'channels', 'bukan-id')).rejects.toBeInstanceOf(
      AutomodValidationError,
    );
  });
});

describe('AutomodService daftar putih', () => {
  it('menormalkan domain dari URL penuh', async () => {
    const { service } = makeService();
    const updated = await service.addListItem(GUILD_ID, 'link', 'domains', 'https://www.YouTube.com/watch?v=1');

    expect(updated.whitelist.domains).toEqual(['youtube.com']);
  });

  it('menormalkan kata dan invite', async () => {
    const { service } = makeService();

    const badword = await service.addListItem(GUILD_ID, 'badword', 'words', '  Anjing  ');
    expect(badword.whitelist.words).toEqual(['anjing']);

    const invite = await service.addListItem(GUILD_ID, 'invite', 'invites', 'https://discord.gg/AbC123');
    expect(invite.whitelist.invites).toEqual(['abc123']);
  });

  it('menolak daftar untuk rule yang tidak cocok', async () => {
    const { service } = makeService();

    await expect(service.addListItem(GUILD_ID, 'badword', 'domains', 'youtube.com')).rejects.toThrow(
      /tidak memakai daftar/,
    );
  });

  it('menolak duplikat, isi tidak valid, dan penghapusan yang tidak ada', async () => {
    const { service } = makeService();

    await service.addListItem(GUILD_ID, 'badword', 'words', 'anjing');

    await expect(service.addListItem(GUILD_ID, 'badword', 'words', 'ANJING')).rejects.toThrow(/sudah ada/);
    await expect(service.addListItem(GUILD_ID, 'badword', 'words', 'a')).rejects.toBeInstanceOf(
      AutomodValidationError,
    );
    await expect(service.addListItem(GUILD_ID, 'link', 'domains', 'bukan domain')).rejects.toBeInstanceOf(
      AutomodValidationError,
    );
    await expect(service.removeListItem(GUILD_ID, 'badword', 'words', 'kucing')).rejects.toThrow(
      /tidak ada/,
    );
  });

  it('menghapus item yang ada', async () => {
    const { service } = makeService();

    await service.addListItem(GUILD_ID, 'link', 'domains', 'youtube.com');
    const updated = await service.removeListItem(GUILD_ID, 'link', 'domains', 'youtube.com');

    expect(updated.whitelist.domains).toEqual([]);
  });
});

describe('buildPolicy', () => {
  it('memakai baris tersimpan dan melengkapi sisanya dengan default', () => {
    const stored: AutomodRule[] = [
      { ...defaultRule('spam'), enabled: false, threshold: 3 },
      { ...defaultRule('badword'), whitelist: { ...defaultRule('badword').whitelist, words: ['anjing'] } },
    ];

    const policy = buildPolicy(GUILD_ID, stored);

    expect(policy.rules).toHaveLength(7);
    expect(policy.rules.find((rule) => rule.type === 'spam')).toMatchObject({ enabled: false, threshold: 3 });
    expect(policy.rules.find((rule) => rule.type === 'badword')?.whitelist.words).toEqual(['anjing']);
    expect(policy.rules.find((rule) => rule.type === 'link')?.threshold).toBe(DEFAULT_THRESHOLDS.link);
  });

  it('menggabungkan pengecualian dari semua rule tanpa duplikat', () => {
    const policy = buildPolicy(GUILD_ID, [
      {
        ...defaultRule('spam'),
        whitelist: { ...defaultRule('spam').whitelist, channels: [CHANNEL_ID], roles: [ROLE_ID] },
      },
      {
        ...defaultRule('link'),
        whitelist: { ...defaultRule('link').whitelist, channels: [CHANNEL_ID] },
      },
    ]);

    expect(policy.exemptChannels).toEqual([CHANNEL_ID]);
    expect(policy.exemptRoles).toEqual([ROLE_ID]);
  });
});
