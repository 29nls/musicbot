import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Guild } from 'discord.js';
import { closePanel } from '../src/modules/reactionroles/expire.js';
import type { ReactionRolePanel } from '../src/modules/reactionroles/types.js';
import { startPanelExpiryJob, type PanelExpiryRunner } from '../src/services/panelExpiryJob.js';

const GUILD_ID = '123456789012345678';
const ROLE_A = '222222222222222222';
const CHANNEL_ID = '444444444444444444';
const MESSAGE_ID = '555555555555555555';
const NOW = new Date('2026-10-02T12:00:00.000Z');

interface FakeMessage {
  edits: { embeds: unknown[]; components: unknown[] }[];
  edit: (payload: { embeds: unknown[]; components: unknown[] }) => Promise<unknown>;
}

interface FakeGuildOptions {
  /** Pesan tidak ada (dihapus manual). */
  messageMissing?: boolean;
  /** Edit gagal, mis. karena bot kehilangan izin. */
  editFails?: boolean;
  /** Channel tidak bisa diambil. */
  channelMissing?: boolean;
}

interface FakeGuild {
  guild: Guild;
  edits: FakeMessage['edits'];
}

function panel(overrides: Partial<ReactionRolePanel> = {}): ReactionRolePanel {
  return {
    id: 1,
    guildId: GUILD_ID,
    channelId: CHANNEL_ID,
    messageId: MESSAGE_ID,
    expiresAt: new Date('2026-10-01T12:00:00.000Z'),
    closedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    options: [
      {
        id: 1,
        panelId: 1,
        roleId: ROLE_A,
        label: 'Pemain',
        emoji: null,
        description: null,
        position: 0,
      },
    ],
    ...overrides,
  };
}

/** Guild Discord tiruan: cukup untuk `channels.fetch` → `messages.fetch` → `edit`. */
function makeGuild(options: FakeGuildOptions = {}): FakeGuild {
  const edits: FakeMessage['edits'] = [];

  const message: FakeMessage = {
    edits,
    edit: (payload) => {
      if (options.editFails) return Promise.reject(new Error('Missing Permissions'));

      edits.push(payload);

      return Promise.resolve(payload);
    },
  };

  const channel = {
    isTextBased: () => true,
    isDMBased: () => false,
    messages: {
      fetch: () =>
        options.messageMissing ? Promise.resolve(null) : Promise.resolve(message),
    },
  };

  const guild = {
    id: GUILD_ID,
    channels: {
      fetch: () =>
        options.channelMissing ? Promise.reject(new Error('Unknown Channel')) : Promise.resolve(channel),
    },
  } as unknown as Guild;

  return { guild, edits };
}

/** Runner yang mencatat panggilan, untuk memastikan urutan & idempotensi. */
class FakeRunner implements PanelExpiryRunner {
  public readonly closed: { panelId: number; at: Date }[] = [];
  public due: ReactionRolePanel[] = [];
  public failFor = new Set<number>();
  public listError: Error | null = null;

  /** Panel yang benar-benar diminta kueri: hanya guild milik shard ini. */
  public dueFor: ReactionRolePanel[] | null = null;

  /** Guild yang dilihat pada panggilan terakhir ke `findDueForExpiry`. */
  public lastGuildIds: readonly string[] = [];

  async findDueForExpiry(_now?: Date, guildIds: readonly string[] = []): Promise<ReactionRolePanel[]> {
    if (this.listError) throw this.listError;

    this.lastGuildIds = guildIds;

    // `dueFor` meniru runner yang mengabaikan cakupan guild (mis. kueri
    // basi); kalau tidak diisi, hanya guild yang diminta yang dikembalikan.
    if (this.dueFor) return this.dueFor;

    const owned = new Set(guildIds);

    return this.due.filter((item) => owned.has(item.guildId));
  }

  async markClosed(guildId: string, panelId: number, now?: Date): Promise<ReactionRolePanel | null> {
    if (this.failFor.has(panelId)) throw new Error('Database tidak bisa dihubungi');

    const found = this.due.find((item) => item.id === panelId && item.guildId === guildId);
    if (!found || found.closedAt) return null;

    found.closedAt = now ?? new Date();
    this.closed.push({ panelId, at: now ?? new Date() });

    return { ...found };
  }
}

describe('closePanel', () => {
  it('melepas select menu dan menandai panel tertutup', async () => {
    const runner = new FakeRunner();
    const target = panel();
    runner.due = [target];
    const { guild, edits } = makeGuild();

    const outcome = await closePanel(runner, guild, target, 'expired', NOW);

    expect(outcome.changed).toBe(true);
    expect(outcome.messageUpdated).toBe(true);
    expect(edits).toHaveLength(1);
    // `components: []` adalah yang melepas select menu-nya.
    expect(edits[0]?.components).toEqual([]);
    expect(runner.closed[0]?.at).toEqual(NOW);
  });

  it('panel yang sudah ditutup tidak diedit dua kali', async () => {
    const runner = new FakeRunner();
    const target = panel({ closedAt: new Date('2026-10-01T00:00:00.000Z') });
    runner.due = [target];
    const { guild, edits } = makeGuild();

    const outcome = await closePanel(runner, guild, target, 'expired', NOW);

    expect(outcome.changed).toBe(false);
    expect(edits).toHaveLength(0);
  });

  it('menandai tertutup walau pesan tidak bisa diedit', async () => {
    const runner = new FakeRunner();
    const target = panel();
    runner.due = [target];
    const { guild } = makeGuild({ messageMissing: true });

    const outcome = await closePanel(runner, guild, target, 'expired', NOW);

    // Datanya harus tetap aman supaya panel tidak disapu ulang selamanya.
    expect(outcome.changed).toBe(true);
    expect(outcome.messageUpdated).toBe(false);
    expect(runner.closed).toHaveLength(1);
  });

  it('channel yang hilang diperlakukan sama seperti pesan hilang', async () => {
    const runner = new FakeRunner();
    const target = panel();
    runner.due = [target];
    const { guild } = makeGuild({ channelMissing: true });

    const outcome = await closePanel(runner, guild, target, 'manual', NOW);

    expect(outcome.messageUpdated).toBe(false);
    expect(runner.closed).toHaveLength(1);
  });

  it('panel tanpa messageId dilewati tanpa error', async () => {
    const runner = new FakeRunner();
    const target = panel({ messageId: null });
    runner.due = [target];
    const { guild, edits } = makeGuild();

    const outcome = await closePanel(runner, guild, target, 'expired', NOW);

    expect(outcome.messageUpdated).toBe(false);
    expect(edits).toHaveLength(0);
  });
});

describe('job penyapuan panel', () => {
  it('interval 0 tidak menjadwalkan timer apa pun', async () => {
    vi.useFakeTimers();

    const job = startPanelExpiryJob({
      runner: new FakeRunner(),
      guilds: () => [],
      runOnStart: false,
      intervalMs: 0,
    });

    expect(vi.getTimerCount()).toBe(0);
    await expect(job.runOnce()).resolves.not.toBeNull();
    job.stop();
    vi.useRealTimers();
  });

  it('menonaktifkan panel yang sudah lewat masa hidup', async () => {
    const runner = new FakeRunner();
    const target = panel();
    runner.due = [target];
    const { guild, edits } = makeGuild();

    const job = startPanelExpiryJob({
      runner,
      guilds: () => [guild],
      runOnStart: false,
      intervalMs: 0,
    });

    const result = await job.runOnce(NOW);

    expect(result).toEqual({ closed: 1, messageMissing: 0, skipped: 0 });
    expect(edits).toHaveLength(1);
    job.stop();
  });

  it('panel permanen tidak pernah disentuh', async () => {
    const runner = new FakeRunner();
    const job = startPanelExpiryJob({
      runner,
      guilds: () => [makeGuild().guild],
      runOnStart: false,
      intervalMs: 0,
    });

    const result = await job.runOnce(NOW);

    expect(result?.closed).toBe(0);
    job.stop();
  });

  it('panel dari guild yang belum ada di cache dilewati, bukan dipaksa', async () => {
    const runner = new FakeRunner();
    // Runner mengabaikan cakupan guild dan mengembalikan panel milik guild
    // lain — cbd. proses yang kehilangan guild dari cache di antara kueri
    // dan pemrosesan. Perulangan di dalam sweep tetap harus menjaganya.
    runner.dueFor = [panel()];
    const { guild, edits } = makeGuild();

    const job = startPanelExpiryJob({
      runner,
      guilds: () => [guild],
      runOnStart: false,
      intervalMs: 0,
    });

    const result = await job.runOnce(NOW);

    expect(result?.skipped).toBe(1);
    expect(result?.closed).toBe(0);
    expect(edits).toHaveLength(0);
    expect(runner.closed).toHaveLength(0);
    job.stop();
  });

  it('satu panel yang error tidak menghentikan panel lain', async () => {
    const runner = new FakeRunner();
    runner.due = [panel({ id: 1 }), panel({ id: 2 })];
    runner.failFor.add(1);
    const { guild, edits } = makeGuild();

    const job = startPanelExpiryJob({
      runner,
      guilds: () => [guild],
      runOnStart: false,
      intervalMs: 0,
    });

    const result = await job.runOnce(NOW);

    expect(result?.closed).toBe(1);
    expect(edits).toHaveLength(1);
    job.stop();
  });

  it('pesan yang hilang dihitung terpisah dari panel yang tertutup', async () => {
    const runner = new FakeRunner();
    runner.due = [panel()];

    const job = startPanelExpiryJob({
      runner,
      guilds: () => [makeGuild({ messageMissing: true }).guild],
      runOnStart: false,
      intervalMs: 0,
    });

    const result = await job.runOnce(NOW);

    expect(result).toEqual({ closed: 1, messageMissing: 1, skipped: 0 });
    job.stop();
  });

  it('sapuan kedua yang masih berjalan dilompati', async () => {
    const runner = new FakeRunner();
    // Disimpan di objek supaya TypeScript tetap tahu tipenya setelah executor
    // Promise selesai — penugasan ke `let` biasa tidak teracak oleh compiler.
    const gate: { release: () => void } = {
      release: () => undefined,
    };
    const blocker = new Promise<void>((resolve) => {
      gate.release = resolve;
    });

    runner.findDueForExpiry = async () => {
      await blocker;

      return [];
    };

    const { guild } = makeGuild();
    const job = startPanelExpiryJob({
      runner,
      guilds: () => [guild],
      runOnStart: false,
      intervalMs: 0,
    });

    const first = job.runOnce(NOW);
    const second = await job.runOnce(NOW);

    expect(second).toBeNull();
    gate.release();
    await expect(first).resolves.not.toBeNull();
    job.stop();
  });

  it('kegagalan pembacaan daftar jadi peringatan, bukan exception', async () => {
    const runner = new FakeRunner();
    runner.listError = new Error('ECONNREFUSED');

    const { guild } = makeGuild();
    const job = startPanelExpiryJob({
      runner,
      guilds: () => [guild],
      runOnStart: false,
      intervalMs: 0,
    });

    expect(await job.runOnce(NOW)).toBeNull();
    job.stop();
  });

  it('menjalankan sapuan otomatis pada interval', async () => {
    const runner = new FakeRunner();
    let calls = 0;
    runner.findDueForExpiry = async () => {
      calls += 1;

      return [];
    };

    vi.useFakeTimers();
    const { guild } = makeGuild();
    const job = startPanelExpiryJob({
      runner,
      guilds: () => [guild],
      runOnStart: false,
      intervalMs: 15 * 60_000,
    });

    await vi.advanceTimersByTimeAsync(15 * 60_000);

    expect(calls).toBe(1);
    job.stop();
    vi.useRealTimers();
  });
});

/**
 * Env di-memoize di `getEnv()`, jadi Mengubah `process.env` setelah modul lain
 * membacanya tidak berefek. Tes di sini me-reset registry modul supaya job
 * membaca env dari awal — satu-satunya cara menguji pemetaan env sungguhan.
 */
describe('interval dari env', () => {
  const original = process.env.PANEL_EXPIRY_SWEEP_MINUTES;

  afterEach(() => {
    if (original === undefined) delete process.env.PANEL_EXPIRY_SWEEP_MINUTES;
    else process.env.PANEL_EXPIRY_SWEEP_MINUTES = original;
    vi.useRealTimers();
  });

  async function startFresh(): Promise<ReturnType<typeof startPanelExpiryJob>> {
    vi.resetModules();
    const module = await import('../src/services/panelExpiryJob.js');

    return module.startPanelExpiryJob({
      runner: new FakeRunner(),
      guilds: () => [],
      runOnStart: false,
    });
  }

  it('nilai positif menjadwalkan tepat satu timer', async () => {
    process.env.PANEL_EXPIRY_SWEEP_MINUTES = '15';
    vi.useFakeTimers();

    const job = await startFresh();

    expect(vi.getTimerCount()).toBe(1);
    job.stop();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('0 mematikan penjadwalan sepenuhnya', async () => {
    process.env.PANEL_EXPIRY_SWEEP_MINUTES = '0';
    vi.useFakeTimers();

    const job = await startFresh();

    expect(vi.getTimerCount()).toBe(0);
    job.stop();
  });
});

describe('kepadatan job', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('tidak menumpuk timer setiap kali start', () => {
    const jobs = Array.from({ length: 3 }, () =>
      startPanelExpiryJob({
        runner: new FakeRunner(),
        guilds: () => [],
        runOnStart: false,
        intervalMs: 15 * 60_000,
      }),
    );

    expect(vi.getTimerCount()).toBe(3);
    for (const job of jobs) job.stop();

    expect(vi.getTimerCount()).toBe(0);
  });
});