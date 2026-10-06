import { describe, expect, it, vi } from 'vitest';
import { MemoryKeyValueStore } from '@bot/services/kvStore.js';
import { DEFAULT_MODULES, type GuildConfig } from '@bot/modules/config/types.js';
import { applyConfigPatch, sanitizeBody, type ConfigWriteDeps } from '@/lib/configWrite.js';
import type { PermissionVerdict } from '@/lib/permissions.js';

/**
 * Skenario keamanan PRD-DASHBOARD §2.4, plus urutan penolakan yang menjaga
 * penolakan itu berarti sesuatu.
 *
 * Yang diuji di sini adalah **jalur tulis**, karena itulah satu-satunya tempat di
 * dashboard yang bisa mengubah apa pun. Halaman sudah menolak lebih dulu, tapi
 * halaman bukansecurity boundary — route yang dipanggil langsung adalah.
 */

/**
 * Store yang bisa menerbitkan, seperti `RedisKeyValueStore` sungguhan.
 *
 * Store memori bawaan **tidak bisa** — `publish`-nya selalu false karena tidak ada
 * proses lain yang bisa diberi tahu. Itu justru perilaku yang benar (D3), tapi
 * berarti fixture yang dipakai untuk menguji jalur *berhasil* harus meniru store
 * yang bisa menerbitkan; memakai store memori di sana akan membuat hampir semua
 * tes gagal di langkah yang sama dan menutupi apa yang sebenarnya diuji.
 */
class PublishingStore extends MemoryKeyValueStore {
  readonly published: { channel: string; message: string }[] = [];

  override async publish(channel: string, message: string): Promise<boolean> {
    this.published.push({ channel, message });

    return true;
  }
}

const GUILD = '111111111111111111';
const OTHER_GUILD = '222222222222222222';
const USER = '100000000000000001';
const BOT_USER = '999999999999999999';
const OWNER = '300000000000000003';
const CHANNEL = '400000000000000004';
const FOREIGN_CHANNEL = '500000000000000005';
const ROLE = '600000000000000006';

function baseConfig(): GuildConfig {
  return {
    guildId: GUILD,
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
    ticketPanelChannelId: null,
    ticketCategoryId: null,
    ticketStaffRoleId: null,
    ticketPanelMessageId: null,
    stayChannelId: null,
    modules: { ...DEFAULT_MODULES },
    locale: 'id',
  };
}

interface Overrides {
  permission?: PermissionVerdict;
  config?: GuildConfig;
  channelIds?: string[];
  roleIds?: string[];
  snapshotNull?: boolean;
  store?: MemoryKeyValueStore;
  readFails?: boolean;
  saveFails?: boolean;
}

function makeDeps(overrides: Overrides = {}) {
  const config = overrides.config ?? baseConfig();
  const saved: GuildConfig[] = [];
  const audits: { executorId: string; changes: unknown[] }[] = [];

  const deps: ConfigWriteDeps = {
    readConfig: vi.fn(async () => config),
    save: vi.fn(async (next, audit) => {
      if (overrides.readFails || overrides.saveFails) throw new Error('database mati');
      saved.push(next);
      audits.push({ executorId: audit.executorId, changes: [...audit.changes] });

      return { saved: next, auditRecorded: true };
    }),
    checkPermission: vi.fn(async () => overrides.permission ?? 'allowed'),
    readGuildSnapshot: vi.fn(async () =>
      overrides.snapshotNull
        ? null
        : { channelIds: overrides.channelIds ?? [CHANNEL], roleIds: overrides.roleIds ?? [ROLE] },
    ),
    store: overrides.store ?? new PublishingStore(),
    now: () => new Date('2026-10-06T00:00:00.000Z'),
  };

  return { deps, saved, audits, config };
}

async function write(deps: ConfigWriteDeps, body: unknown, guildId = GUILD) {
  return applyConfigPatch(deps, { guildId, userId: USER, body });
}

describe('§2.4 baris 1 — Manage Server dicabut setelah login, ditolak tiap penulisan', () => {
  it('menolak saat izin sudah tidak berlaku', async () => {
    const { deps, saved } = makeDeps({ permission: 'denied' });

    const result = await write(deps, { defaultVolume: 40 });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('forbidden');
    expect(saved).toHaveLength(0);
  });

  it('memeriksa izin pada SETIAP penulisan, bukan sekali', async () => {
    const { deps, saved } = makeDeps({ permission: 'denied' });

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await write(deps, { defaultVolume: 40 + attempt });
    }

    expect(deps.checkPermission).toHaveBeenCalledTimes(3);
    expect(saved).toHaveLength(0);
  });

  it('izin tidak bisa dipastikan → menolak, bukan menebak', async () => {
    const { deps, saved } = makeDeps({ permission: 'unknown' });

    const result = await write(deps, { defaultVolume: 40 });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('permission-unknown');
    expect(saved).toHaveLength(0);
  });

  it('executor di audit adalah user yang menandatangani, bukan bot', async () => {
    const { deps, audits } = makeDeps();

    await write(deps, { defaultVolume: 40 });

    expect(audits).toHaveLength(1);
    expect(audits[0]?.executorId).toBe(USER);
    expect(audits[0]?.executorId).not.toBe(BOT_USER);
  });
});

describe('§2.4 baris 2 — guildId dikarang di body, tidak ada kueri yang memakainya', () => {
  it('guildId di body ditolak sebagai field tak dikenal', async () => {
    const { deps, saved } = makeDeps();

    const result = await write(deps, { guildId: OTHER_GUILD, defaultVolume: 40 });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('invalid-field');
      expect(result.issues[0]?.field).toBe('guildId');
    }
    expect(saved).toHaveLength(0);
  });

  it('guildId dari parameter terpisah tetap diperiksa izinnya', async () => {
    const { deps } = makeDeps({ permission: 'denied' });

    const result = await write(deps, { defaultVolume: 40 }, OTHER_GUILD);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('forbidden');
  });
});

describe('§2.4 baris 3 — channel/role milik guild lain ditolak sebelum menulis', () => {
  it('channel asing ditolak', async () => {
    const { deps, saved } = makeDeps();

    const result = await write(deps, { logChannelId: FOREIGN_CHANNEL });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('foreign-id');
    expect(saved).toHaveLength(0);
  });

  it('role asing ditolak', async () => {
    const { deps, saved } = makeDeps();

    const result = await write(deps, { djRoleId: FOREIGN_CHANNEL });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('foreign-id');
    expect(saved).toHaveLength(0);
  });

  it('channel milik guild ini diterima', async () => {
    const { deps, saved } = makeDeps();

    const result = await write(deps, { logChannelId: CHANNEL });

    expect(result.ok).toBe(true);
    expect(saved).toHaveLength(1);
    expect(saved[0]?.logChannelId).toBe(CHANNEL);
  });

  it('Discord tidak menjawab → menolak, bukan menebak', async () => {
    const { deps, saved } = makeDeps({ snapshotNull: true });

    const result = await write(deps, { logChannelId: CHANNEL });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('permission-unknown');
    expect(saved).toHaveLength(0);
  });
});

describe('§2.4 baris 6 — percobaan otomatis dibatasi', () => {
  it('menolak setelah 30 percobaan dalam jendela', async () => {
    const { deps, saved } = makeDeps();

    for (let attempt = 1; attempt <= 30; attempt += 1) {
      const result = await write(deps, { defaultVolume: 100 + attempt });
      expect(result.ok, `percobaan ${attempt} seharusnya diterima`).toBe(true);
    }

    const blocked = await write(deps, { defaultVolume: 999 });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) {
      expect(blocked.reason).toBe('rate-limited');
      expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
    }
    expect(saved).toHaveLength(30);
  });

  it('rate limit dihitung per guild, jadi guild lain tidak terpengaruh', async () => {
    const { deps } = makeDeps();

    for (let attempt = 1; attempt <= 31; attempt += 1) {
      await write(deps, { defaultVolume: 100 + attempt });
    }

    const other = await write(deps, { defaultVolume: 50 }, OTHER_GUILD);
    expect(other.ok).toBe(true);
  });
});

describe('D3 — kanal bersama mati, dashboard menolak menulis', () => {
  it('store tanpa publish menolak seluruh penulisan', async () => {
    // `MemoryKeyValueStore.publish` selalu false: tidak ada proses lain yang
    // bisa diberi tahu, jadi perubahan tidak akan berlaku.
    const { deps, saved } = makeDeps({ store: new MemoryKeyValueStore() });

    const result = await write(deps, { defaultVolume: 40 });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('shared-store-down');
    expect(saved).toHaveLength(0);
  });

  it('kanal mati menolak SEBELUM database disentuh, bukan sesudah', async () => {
    const deps = makeDeps({ store: new MemoryKeyValueStore() }).deps;

    await write(deps, { defaultVolume: 40 });

    // Kalau urutannya dibalik, `save` akan terpakai lalu publish gagal — dan
    // yang tersisa adalah perubahan yang diam-diam tidak berlaku.
    expect(deps.save).not.toHaveBeenCalled();
  });

  it('tidak ada penulisan yang lolos tanpa invalidasi terbit', async () => {
    const store = new PublishingStore();
    const { deps } = makeDeps({ store });

    const result = await write(deps, { defaultVolume: 40 });

    expect(result.ok).toBe(true);
    expect(store.published).toHaveLength(1);
    expect(store.published[0]?.message).toContain(GUILD);
  });
});

describe('validasi memakai aturan bot, bukan versi dashboard', () => {
  it('volume di atas 200 ditolak', async () => {
    const { deps } = makeDeps();
    const result = await write(deps, { defaultVolume: 201 });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('invalid-value');
  });

  it('idle timeout di bawah 30 detik ditolak', async () => {
    const { deps } = makeDeps();
    const result = await write(deps, { idleTimeoutSec: 29 });

    expect(result.ok).toBe(false);
  });

  it('pesan sambutan lebih dari 1500 karakter ditolak', async () => {
    const { deps } = makeDeps();
    const result = await write(deps, { welcomeMessage: 'a'.repeat(1501) });

    expect(result.ok).toBe(false);
  });

  it('locale yang tidak dikenal ditolak', async () => {
    const { deps } = makeDeps();
    const result = await write(deps, { locale: 'de' });

    expect(result.ok).toBe(false);
  });

  it('field tak dikenal ditolak, termasuk yang sengaja dikecualikan', async () => {
    const { deps } = makeDeps();

    for (const key of ['ticketPanelChannelId', 'createdAt', 'updatedAt', 'guildId', 'modules']) {
      const body = key === 'modules' ? { modules: { reactions: true } } : { [key]: '400000000000000004' };
      const result = await write(deps, body);
      expect(result.ok, `${key} seharusnya ditolak`).toBe(false);
    }
  });
});

describe('sanitizeBody', () => {
  it('menolak bentuk body yang bukan objek biasa', () => {
    for (const body of [null, undefined, [], 'x', 42, true]) {
      const result = sanitizeBody(body);
      expect(result.ok, `body ${JSON.stringify(body)}`).toBe(false);
    }
  });

  it('menolak kunci polusi prototipe', () => {
    const result = sanitizeBody(JSON.parse('{"__proto__":{"admin":true},"defaultVolume":40}'));

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.rejected).toContain('__proto__');
  });

  it('menerima patch yang valid apa adanya', () => {
    const result = sanitizeBody({ defaultVolume: 40, modules: { music: false } });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.patch).toEqual({ defaultVolume: 40, modules: { music: false } });
    }
  });

  it('menolak modul di luar daftar yang boleh diubah', () => {
    const result = sanitizeBody({ modules: { reactions: false } });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.rejected).toEqual(['modules.reactions']);
  });
});

describe('perubahan yang benar-benar terjadi', () => {
  it('hanya field yang berubah yang dikirim dan dicatat', async () => {
    const { deps, saved, audits } = makeDeps();

    const result = await write(deps, { defaultVolume: 40, welcomeChannelId: CHANNEL });

    expect(result.ok).toBe(true);
    expect(saved[0]?.defaultVolume).toBe(40);
    // Field yang tidak disebut tidak boleh berubah, termasuk `reactions`/`tickets`
    // yang tidak ada di patch tapi selalu ada di baris.
    expect(saved[0]?.modules.reactions).toBe(false);
    expect(saved[0]?.modules.tickets).toBe(false);

    const changes = audits[0]?.changes as { field: string }[];
    expect(changes.map((change) => change.field).sort()).toEqual(['defaultVolume', 'welcomeChannelId']);
  });

  it('null berarti mengosongkan field, bukan "tidak berubah"', async () => {
    // Ini capability yang `/config set` **tidak punya**: opsi yang tidak diisi di
    // Discord selalu berarti "tidak diubah", jadi tidak ada cara membersihkan
    // `logChannelId` lewat perintah. Dashboard bisa, karena select punya opsi
    // "— tidak ada —". Lihat catatan di PRD-DASHBOARD §4.6.
    const config = baseConfig();
    config.logChannelId = CHANNEL;
    const { deps, saved } = makeDeps({ config, channelIds: [CHANNEL] });

    const result = await write(deps, { logChannelId: null });

    expect(result.ok).toBe(true);
    expect(saved[0]?.logChannelId).toBeNull();
  });

  it('string kosong ditolak, bukan diam-diam berarti mengosongkan', async () => {
    // Justru itu alasan `null` dipakai: `''` lolos ke `snowflakeOrNull` zod
    // sebagai nilai yang tidak valid, dan pesan errornya menyebut ID Discord —
    // bukan "kosongkan".
    const config = baseConfig();
    config.logChannelId = CHANNEL;
    const { deps, saved } = makeDeps({ config, channelIds: [CHANNEL] });

    const result = await write(deps, { logChannelId: '' });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('invalid-value');
    expect(saved).toHaveLength(0);
  });

  it('mengosongkan field yang sedang kosong tidak menghasilkan perubahan', async () => {
    const { deps, saved, audits } = makeDeps();

    const result = await write(deps, { logChannelId: null });

    expect(result.ok).toBe(true);
    expect(saved).toHaveLength(0);
    expect(audits).toHaveLength(0);
  });

  it('patch tanpa perubahan nyata tidak menulis apa pun', async () => {
    const { deps, saved, audits } = makeDeps();

    const result = await write(deps, { defaultVolume: 100 });

    expect(result.ok).toBe(true);
    expect(saved).toHaveLength(0);
    expect(audits).toHaveLength(0);
  });

  it('kegagalan database dilaporkan, bukan ditelan', async () => {
    const { deps, saved } = makeDeps({ saveFails: true });

    const result = await write(deps, { defaultVolume: 40 });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('database-down');
    expect(saved).toHaveLength(0);
  });

  it('audit gagal tidak menggagalkan perubahan, tapi dilaporkan apa adanya', async () => {
    const deps = makeDeps().deps;
    const failing: ConfigWriteDeps = {
      ...deps,
      save: vi.fn(async (next) => ({ saved: next, auditRecorded: false })),
    };

    const result = await write(failing, { defaultVolume: 40 });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.auditRecorded).toBe(false);
      expect(result.config.defaultVolume).toBe(40);
    }
  });

  it('tidak ada body sama sekali ditolak', async () => {
    const { deps } = makeDeps();

    const result = await write(deps, {});

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('invalid-value');
  });
});

describe('izin dihitung dari role guild, bukan payload OAuth', () => {
  it('pemilik guild tidak butuh role apa pun', async () => {
    const { checkManageGuild } = await import('@/lib/permissions.js');

    const verdict = await checkManageGuild(
      {
        getGuild: async () => ({ id: GUILD, owner_id: OWNER, roles: [] }),
        getMember: async () => ({ user: { id: OWNER }, roles: [] }),
      },
      GUILD,
      OWNER,
    );

    expect(verdict).toBe('allowed');
  });
});