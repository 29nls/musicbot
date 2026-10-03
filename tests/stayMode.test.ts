import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Guild } from 'discord.js';
import { DEFAULT_MODULES, type GuildConfig } from '../src/modules/config/types.js';
import { planStay, stayLabel, type StayPlanInput } from '../src/modules/music/stay.js';
import {
  StayService,
  type StayMusicPort,
  type StayOutcome,
} from '../src/modules/music/stayService.js';
import { startStayJob, type StayApplier } from '../src/services/stayJob.js';

const GUILD_ID = '123456789012345678';
const OTHER_GUILD = '876543210987654321';
const STAY_CHANNEL = '444444444444444444';
const OTHER_CHANNEL = '555555555555555555';

function makeConfig(overrides: Partial<GuildConfig> = {}): GuildConfig {
  return {
    guildId: GUILD_ID,
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
    stayChannelId: STAY_CHANNEL,
    modules: { ...DEFAULT_MODULES },
    locale: 'id',
    ...overrides,
  };
}

function planInput(overrides: Partial<StayPlanInput> = {}): StayPlanInput {
  return {
    configuredChannelId: STAY_CHANNEL,
    currentChannelId: null,
    moduleEnabled: true,
    lavalinkConnected: true,
    isPlaying: false,
    ...overrides,
  };
}

/** Port musik palsu: mencatat panggilan dan bisa sengaja gagal. */
class FakeMusicPort implements StayMusicPort {
  public currentChannelId: string | null = null;
  public playing = false;
  public connected = true;
  public joins: Array<{ guildId: string; channelId: string; shardId: number }> = [];
  public joinError: Error | null = null;

  botVoiceChannelId(_guildId: string): string | null {
    return this.currentChannelId;
  }

  isPlaying(_guildId: string): boolean {
    return this.playing;
  }

  get isConnected(): boolean {
    return this.connected;
  }

  async joinStayChannel(guildId: string, channelId: string, shardId: number): Promise<void> {
    if (this.joinError) throw this.joinError;

    this.joins.push({ guildId, channelId, shardId });
    this.currentChannelId = channelId;
  }
}

/** Applier palsu untuk job: mencatat guild + shard per sapuan. */
class FakeApplier implements StayApplier {
  public readonly calls: Array<{ guildId: string; shardId: number }> = [];
  private readonly failures = new Set<string>();
  private readonly joined = new Set<string>();

  failIn(guildId: string): void {
    this.failures.add(guildId);
  }

  joinIn(guildId: string): void {
    this.joined.add(guildId);
  }

  async apply(guildId: string, shardId: number): Promise<StayOutcome> {
    this.calls.push({ guildId, shardId });

    const error = this.failures.has(guildId) ? 'channel dihapus' : null;
    const joined = error === null && this.joined.has(guildId);

    return {
      guildId,
      plan: joined
        ? { action: 'join', channelId: STAY_CHANNEL, reason: 'Bot masuk channel 24/7' }
        : { action: 'none', reason: 'Tidak ada yang perlu dilakukan' },
      joined,
      error,
    };
  }
}

function makeGuild(id: string, shardId: number): Guild {
  return { id, shardId } as unknown as Guild;
}

describe('planStay', () => {
  it('tidak melakukan apa-apa kalau modul musik dimatikan', () => {
    const plan = planStay(planInput({ moduleEnabled: false }));

    expect(plan.action).toBe('none');
    expect(plan.channelId).toBeUndefined();
    expect(plan.reason).toContain('dimatikan');
  });

  it('tidak menyambung kalau Lavalink belum terhubung', () => {
    const plan = planStay(planInput({ lavalinkConnected: false }));

    expect(plan.action).toBe('none');
    expect(plan.reason).toContain('Lavalink');
  });

  it('tidak melakukan apa-apa di server yang mode 24/7-nya mati', () => {
    const plan = planStay(planInput({ configuredChannelId: null }));

    expect(plan.action).toBe('none');
    expect(plan.reason).toContain('tidak diaktifkan');
  });

  it('diam kalau bot sudah ada di channel tujuan', () => {
    const plan = planStay(planInput({ currentChannelId: STAY_CHANNEL }));

    expect(plan.action).toBe('stay');
    expect(plan.channelId).toBeUndefined();
  });

  it('menyambung ke channel tujuan saat bot belum ada di voice channel', () => {
    const plan = planStay(planInput({ currentChannelId: null }));

    expect(plan).toMatchObject({ action: 'join', channelId: STAY_CHANNEL });
  });

  it('menyambung ke channel tujuan saat bot masih di channel lain', () => {
    const plan = planStay(planInput({ currentChannelId: OTHER_CHANNEL }));

    expect(plan).toMatchObject({ action: 'join', channelId: STAY_CHANNEL });
    expect(plan.reason).toContain('channel lain');
  });

  it('tidak memindahkan bot yang sedang memutar', () => {
    const plan = planStay(planInput({ currentChannelId: OTHER_CHANNEL, isPlaying: true }));

    expect(plan.action).toBe('none');
    expect(plan.reason).toContain('sedang memutar');
  });

  it('tetap diam walau sedang memutar tapi sudah di channel tujuan', () => {
    const plan = planStay(planInput({ currentChannelId: STAY_CHANNEL, isPlaying: true }));

    expect(plan.action).toBe('stay');
  });

  it('setiap keputusan selalu punya alasan yang bisa dicatat di log', () => {
    const cases: StayPlanInput[] = [
      planInput({ moduleEnabled: false }),
      planInput({ lavalinkConnected: false }),
      planInput({ configuredChannelId: null }),
      planInput({ currentChannelId: STAY_CHANNEL }),
      planInput({ currentChannelId: null }),
      planInput({ currentChannelId: OTHER_CHANNEL, isPlaying: true }),
    ];

    for (const input of cases) {
      expect(planStay(input).reason.length).toBeGreaterThan(0);
    }
  });
});

describe('stayLabel', () => {
  it('melaporkan mode mati saat belum ada channel tujuan', () => {
    expect(stayLabel(makeConfig({ stayChannelId: null }), null)).toBe('Mati');
  });

  it('melaporkan mode mati saat modul musik mati', () => {
    const config = makeConfig({ modules: { ...DEFAULT_MODULES, music: false } });

    expect(stayLabel(config, STAY_CHANNEL)).toBe('Modul musik mati');
  });

  it('melaporkan channel tujuan saat bot sudah sampai', () => {
    expect(stayLabel(makeConfig(), STAY_CHANNEL)).toContain(STAY_CHANNEL);
  });

  it('melaporkan "belum sampai" saat bot masih di channel lain', () => {
    expect(stayLabel(makeConfig(), OTHER_CHANNEL)).toContain('belum sampai');
  });
});

describe('StayService', () => {
  function makeService(music: FakeMusicPort, config: GuildConfig): StayService {
    return new StayService({
      music,
      getConfig: async () => config,
      logger: { info: () => undefined, warn: () => undefined },
    });
  }

  it('menyambungkan bot ke channel tujuan saat belum ada di sana', async () => {
    const music = new FakeMusicPort();
    const outcome = await makeService(music, makeConfig()).apply(GUILD_ID, 3);

    expect(music.joins).toEqual([{ guildId: GUILD_ID, channelId: STAY_CHANNEL, shardId: 3 }]);
    expect(outcome.joined).toBe(true);
    expect(outcome.error).toBeNull();
    expect(outcome.plan.action).toBe('join');
  });

  it('tidak menyambung lagi kalau bot sudah di channel tujuan', async () => {
    const music = new FakeMusicPort();
    music.currentChannelId = STAY_CHANNEL;

    const outcome = await makeService(music, makeConfig()).apply(GUILD_ID, 0);

    expect(music.joins).toHaveLength(0);
    expect(outcome).toMatchObject({ joined: false, error: null });
    expect(outcome.plan.action).toBe('stay');
  });

  it('tidak menyambung ke server yang mode 24/7-nya mati', async () => {
    const music = new FakeMusicPort();
    const config = makeConfig({ stayChannelId: null });

    const outcome = await makeService(music, config).apply(GUILD_ID, 0);

    expect(music.joins).toHaveLength(0);
    expect(outcome.joined).toBe(false);
  });

  it('menahan diri saat bot sedang memutar di channel lain', async () => {
    const music = new FakeMusicPort();
    music.currentChannelId = OTHER_CHANNEL;
    music.playing = true;

    const outcome = await makeService(music, makeConfig()).apply(GUILD_ID, 0);

    expect(music.joins).toHaveLength(0);
    expect(outcome.plan.reason).toContain('sedang memutar');
  });

  it('tidak melempar saat konfigurasi gagal dibaca: dicatat, bukan diteruskan', async () => {
    const music = new FakeMusicPort();
    const service = new StayService({
      music,
      getConfig: async () => {
        throw new Error('koneksi database putus');
      },
      logger: { info: () => undefined, warn: () => undefined },
    });

    const outcome = await service.apply(GUILD_ID, 0);

    expect(music.joins).toHaveLength(0);
    expect(outcome).toMatchObject({ joined: false, error: 'konfigurasi tidak terbaca' });
  });

  it('tidak melempar saat gagal menyambung (channel dihapus admin)', async () => {
    const music = new FakeMusicPort();
    music.joinError = new Error('Unknown Channel');

    const outcome = await makeService(music, makeConfig()).apply(GUILD_ID, 0);

    expect(outcome.joined).toBe(false);
    expect(outcome.error).toBe('Unknown Channel');
  });

  it('meruskan pesan error yang bukan Error tetap terbaca', async () => {
    const music = new FakeMusicPort();
    music.joinError = 'connection reset' as unknown as Error;

    const outcome = await makeService(music, makeConfig()).apply(GUILD_ID, 0);

    expect(outcome.error).toBe('gagal menyambung');
  });
});

describe('startStayJob', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('memeriksa tiap guild dengan shard yang benar', async () => {
    const stay = new FakeApplier();
    const job = startStayJob({
      stay,
      guilds: () => [makeGuild(GUILD_ID, 1), makeGuild(OTHER_GUILD, 4)],
      runOnStart: false,
      intervalMs: 0,
    });

    const result = await job.runOnce();
    job.stop();

    expect(stay.calls).toEqual([
      { guildId: GUILD_ID, shardId: 1 },
      { guildId: OTHER_GUILD, shardId: 4 },
    ]);
    expect(result).toEqual({ checked: 2, joined: 0, errors: 0 });
  });

  it('menghitung server yang benar-benar tersambung', async () => {
    const stay = new FakeApplier();
    stay.joinIn(OTHER_GUILD);

    const job = startStayJob({
      stay,
      guilds: () => [makeGuild(GUILD_ID, 0), makeGuild(OTHER_GUILD, 0)],
      runOnStart: false,
      intervalMs: 0,
    });

    const result = await job.runOnce();
    job.stop();

    expect(result).toEqual({ checked: 2, joined: 1, errors: 0 });
  });

  it('satu server yang gagal tidak menghentikan server lain', async () => {
    const stay = new FakeApplier();
    stay.failIn(GUILD_ID);
    stay.joinIn(OTHER_GUILD);

    const job = startStayJob({
      stay,
      guilds: () => [makeGuild(GUILD_ID, 0), makeGuild(OTHER_GUILD, 0)],
      runOnStart: false,
      intervalMs: 0,
    });

    const result = await job.runOnce();
    job.stop();

    expect(result).toEqual({ checked: 2, joined: 1, errors: 1 });
  });

  it('menangani applier yang melempar tanpa menggagalkan sapuan', async () => {
    const stay: StayApplier = {
      apply: async (guildId) => {
        if (guildId === GUILD_ID) throw new Error('shard mati');
        return { guildId, plan: { action: 'none', reason: 'aman' }, joined: false, error: null };
      },
    };

    const job = startStayJob({
      stay,
      guilds: () => [makeGuild(GUILD_ID, 0), makeGuild(OTHER_GUILD, 0)],
      runOnStart: false,
      intervalMs: 0,
    });

    const result = await job.runOnce();
    job.stop();

    expect(result).toEqual({ checked: 2, joined: 0, errors: 1 });
  });

  it('sapuan yang masih berjalan tidak diganggu sapuan berikutnya', async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const stay: StayApplier = {
      apply: async (guildId) => {
        await gate;
        return { guildId, plan: { action: 'none', reason: 'aman' }, joined: false, error: null };
      },
    };

    const job = startStayJob({
      stay,
      guilds: () => [makeGuild(GUILD_ID, 0)],
      runOnStart: false,
      intervalMs: 0,
    });

    const first = job.runOnce();
    const second = await job.runOnce();

    expect(second).toBeNull();

    release?.();
    await expect(first).resolves.toMatchObject({ checked: 1 });
    job.stop();
  });

  it('berjalan sekali saat start, lalu berhenti total setelah stop()', async () => {
    vi.useFakeTimers();
    const stay = new FakeApplier();

    const job = startStayJob({
      stay,
      guilds: () => [makeGuild(GUILD_ID, 0)],
      intervalMs: 5 * 60_000,
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(stay.calls).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(stay.calls).toHaveLength(2);

    job.stop();
    await vi.advanceTimersByTimeAsync(15 * 60_000);
    expect(stay.calls).toHaveLength(2);
  });

  it('interval 0 tidak menjadwalkan timer sama sekali', async () => {
    vi.useFakeTimers();
    const stay = new FakeApplier();

    const job = startStayJob({
      stay,
      guilds: () => [makeGuild(GUILD_ID, 0)],
      intervalMs: 0,
    });

    expect(vi.getTimerCount()).toBe(0);
    job.stop();
  });
});
/**
 * Env di-memoize di `getEnv()`, jadi mengubah `process.env` setelah modul lain
 * membacanya tidak berefek. Tes di sini me-reset registry modul supaya job
 * membaca env dari awal - satu-satunya cara menguji pemetaan env sungguhan.
 */
describe('interval dari env', () => {
  const original = process.env.STAY_SWEEP_MINUTES;

  afterEach(() => {
    if (original === undefined) delete process.env.STAY_SWEEP_MINUTES;
    else process.env.STAY_SWEEP_MINUTES = original;
    vi.useRealTimers();
  });

  async function startFresh(): Promise<ReturnType<typeof startStayJob>> {
    vi.resetModules();
    const module = await import('../src/services/stayJob.js');

    return module.startStayJob({
      stay: new FakeApplier(),
      guilds: () => [],
      runOnStart: false,
    });
  }

  it('nilai positif menjadwalkan tepat satu timer', async () => {
    process.env.STAY_SWEEP_MINUTES = '5';
    vi.useFakeTimers();

    const job = await startFresh();

    expect(vi.getTimerCount()).toBe(1);
    job.stop();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('0 mematikan penjadwalan sepenuhnya', async () => {
    process.env.STAY_SWEEP_MINUTES = '0';
    vi.useFakeTimers();

    const job = await startFresh();

    expect(vi.getTimerCount()).toBe(0);
    job.stop();
  });
});
