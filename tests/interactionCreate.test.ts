import type { ChatInputCommandInteraction, EmbedBuilder, Interaction } from 'discord.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import interactionCreate from '../src/events/interactionCreate.js';
import { getMetricsRegistry, initMetrics } from '../src/modules/metrics/index.js';
import { MemoryKeyValueStore } from '../src/services/kvStore.js';
import { setCooldownStore } from '../src/utils/cooldown.js';
import type { BotCommand } from '../src/types/command.js';

/**
 * Perilaku `interactionCreate` — dispatcher yang dilihat semua member.
 *
 * Handler ini punya banyak cabang yang semuanya terlihat sama dari luar:
 * sama-sama "tidak ada yang terjadi" atau satu embed. Kalau salah satu hilang,
 * member tidak melihat apa-apa dan tidak ada yang mengeluh, jadi hampir
 * semua tes di sini adalah tes cabang yang **tidak boleh** sampai ke
 * `command.execute`, bukan hanya tes yang berhasil.
 *
 * Cooldown dan metrik memakai implementasi sungguhan, bukan tiruan:
 * keduanya punya bentuk yang mudah disalahpahami, dan memverifikasi
 * bentuknya di sini lebih berharga daripada memverifikasi bahwa tes memanggil
 * fungsi yang benar.
 */

const GUILD = 'guild-1';

const mocks = vi.hoisted(() => ({
  routeComponent: vi.fn(async () => true),
  translatorForGuild: vi.fn(async () => (key: string) => `id:${key}`),
  recordCommand: vi.fn(async () => undefined),
}));

vi.mock('../src/handlers/componentRouter.js', () => ({ routeComponent: mocks.routeComponent }));

vi.mock('../src/modules/i18n/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/modules/i18n/index.js')>();
  return { ...actual, translatorForGuild: mocks.translatorForGuild };
});

vi.mock('../src/modules/stats/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/modules/stats/index.js')>();
  return { ...actual, getStatsService: () => ({ recordCommand: mocks.recordCommand }) };
});

interface FakeReply {
  embeds: EmbedBuilder[];
  flags?: number;
}

interface FakeCommandOptions {
  guildOnly?: boolean;
  cooldownSeconds?: number;
  execute?: () => Promise<void>;
}

function fakeCommand(options: FakeCommandOptions = {}): BotCommand {
  return {
    data: { name: 'ping' },
    execute: options.execute ?? (async () => undefined),
    guildOnly: options.guildOnly ?? false,
    cooldownSeconds: options.cooldownSeconds ?? 0,
  } as unknown as BotCommand;
}

interface FakeInteractionOptions {
  kind?: 'command' | 'button' | 'select' | 'modal' | 'other';
  commandName?: string;
  guildId?: string | null;
  userId?: string;
  replied?: boolean;
  deferred?: boolean;
}

function fakeInteraction(options: FakeInteractionOptions = {}) {
  const kind = options.kind ?? 'command';
  const replies: FakeReply[] = [];
  const edits: FakeReply[] = [];

  const interaction = {
    commandName: options.commandName ?? 'ping',
    guildId: options.guildId === undefined ? GUILD : options.guildId,
    user: { id: options.userId ?? 'user-1' },
    replied: options.replied ?? false,
    deferred: options.deferred ?? false,
    isButton: () => kind === 'button',
    isStringSelectMenu: () => kind === 'select',
    isModalSubmit: () => kind === 'modal',
    isChatInputCommand: () => kind === 'command',
    inGuild: () => (options.guildId === undefined ? true : options.guildId !== null),
    reply: async (payload: FakeReply) => {
      replies.push(payload);
    },
    editReply: async (payload: FakeReply) => {
      edits.push(payload);
    },
  };

  return {
    interaction: interaction as unknown as Interaction,
    chatInput: interaction as unknown as ChatInputCommandInteraction,
    replies,
    edits,
  };
}

function fakeClient(commands: BotCommand[] = []) {
  return { commands: new Map(commands.map((c) => ['ping', c])) } as never;
}

/** Teks semua embed yang dibalas, supaya asersi bisa dibaca. */
function replyText(replies: FakeReply[]): string {
  return replies
    .map((r) => r.embeds.map((e) => `${e.data.title ?? ''} ${e.data.description ?? ''}`).join(' '))
    .join(' ');
}

function commandCounters() {
  const snapshot = getMetricsRegistry().snapshot();
  return { ...snapshot.interactions.command };
}

beforeEach(() => {
  mocks.routeComponent.mockClear();
  mocks.translatorForGuild.mockClear();
  mocks.recordCommand.mockClear();
  mocks.routeComponent.mockResolvedValue(true);

  // Store cooldown terisolasi: tanpa ini bucket dari tes lain ikut terbawa
  // dan tes cooldown jadi soal urutan, bukan soal logika.
  setCooldownStore(new MemoryKeyValueStore());
  initMetrics(0);
});

describe('interactionCreate — komponen', () => {
  it.each(['button', 'select', 'modal'] as const)(
    'menyerahkan %s ke router komponen dan berhenti',
    async (kind) => {
      const execute = vi.fn(async () => undefined);
      const { interaction, replies } = fakeInteraction({ kind });

      await interactionCreate.execute(fakeClient([fakeCommand({ execute })]), interaction);

      expect(mocks.routeComponent).toHaveBeenCalledTimes(1);
      expect(execute).not.toHaveBeenCalled();
      expect(replies).toHaveLength(0);
    },
  );

  it('mengabaikan jenis interaksi yang bukan perintah maupun komponen', async () => {
    const execute = vi.fn(async () => undefined);
    const { interaction, replies } = fakeInteraction({ kind: 'other' });

    await interactionCreate.execute(fakeClient([fakeCommand({ execute })]), interaction);

    expect(mocks.routeComponent).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
    expect(replies).toHaveLength(0);
  });
});

describe('interactionCreate — perintah', () => {
  it('menjalankan perintah yang dikenal', async () => {
    const execute = vi.fn(async () => undefined);
    const { interaction, replies } = fakeInteraction();

    await interactionCreate.execute(fakeClient([fakeCommand({ execute })]), interaction);

    expect(execute).toHaveBeenCalledTimes(1);
    expect(replies).toHaveLength(0);
  });

  it('menolak perintah yang tidak dikenal, dengan pesan yang bisa dibaca', async () => {
    const execute = vi.fn(async () => undefined);
    const { interaction, replies } = fakeInteraction({ commandName: 'hantu' });

    await interactionCreate.execute(fakeClient([fakeCommand({ execute })]), interaction);

    expect(execute).not.toHaveBeenCalled();
    expect(replyText(replies)).toContain('core.err.unknownCommand');
  });

  it('menolak perintah guildOnly di DM', async () => {
    const execute = vi.fn(async () => undefined);
    const { interaction, replies } = fakeInteraction({ guildId: null });

    await interactionCreate.execute(fakeClient([fakeCommand({ execute, guildOnly: true })]), interaction);

    expect(execute).not.toHaveBeenCalled();
    expect(replyText(replies)).toContain('mod.gate.guildOnly');
  });

  it('menjalankan perintah guildOnly di server', async () => {
    const execute = vi.fn(async () => undefined);
    const { interaction } = fakeInteraction();

    await interactionCreate.execute(fakeClient([fakeCommand({ execute, guildOnly: true })]), interaction);

    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('tidak mengirim statistik untuk perintah di DM', async () => {
    const { interaction } = fakeInteraction({ guildId: null });

    await interactionCreate.execute(fakeClient([fakeCommand()]), interaction);

    expect(mocks.recordCommand).not.toHaveBeenCalled();
  });

  it('mencatat pemakaian perintah hanya di server', async () => {
    const { interaction } = fakeInteraction();

    await interactionCreate.execute(fakeClient([fakeCommand()]), interaction);

    expect(mocks.recordCommand).toHaveBeenCalledWith('ping', GUILD);
  });
});

describe('interactionCreate — cooldown', () => {
  it('menahan perintah kedua dari user yang sama', async () => {
    const execute = vi.fn(async () => undefined);
    const command = fakeCommand({ execute, cooldownSeconds: 30 });

    const first = fakeInteraction();
    await interactionCreate.execute(fakeClient([command]), first.interaction);

    const second = fakeInteraction();
    await interactionCreate.execute(fakeClient([command]), second.interaction);

    expect(execute).toHaveBeenCalledTimes(1);
    expect(replyText(second.replies)).toContain('core.cooldown.command');
  });

  it('tidak menahan perintah dari user lain', async () => {
    const execute = vi.fn(async () => undefined);
    const command = fakeCommand({ execute, cooldownSeconds: 30 });

    await interactionCreate.execute(fakeClient([command]), fakeInteraction({ userId: 'user-1' }).interaction);
    await interactionCreate.execute(fakeClient([command]), fakeInteraction({ userId: 'user-2' }).interaction);

    expect(execute).toHaveBeenCalledTimes(2);
  });

  it('cooldown tidak menahan perintah yang tidak dikenal', async () => {
    // Perintah yang tidak dikenal tidak masuk cooldown: nama yang diketik
    // orang sudah tidak terdaftar, jadi tidak ada yang perlu dibatasi.
    const first = fakeInteraction({ commandName: 'hantu' });
    const second = fakeInteraction({ commandName: 'hantu' });

    await interactionCreate.execute(fakeClient([]), first.interaction);
    await interactionCreate.execute(fakeClient([]), second.interaction);

    expect(replyText(second.replies)).not.toContain('core.cooldown.command');
  });
});

describe('interactionCreate — kegagalan', () => {
  it('menangkap error perintah dan membalas dengan embed', async () => {
    const execute = vi.fn(async () => {
      throw new Error('boom');
    });
    const { interaction, replies } = fakeInteraction();

    await expect(
      interactionCreate.execute(fakeClient([fakeCommand({ execute })]), interaction),
    ).resolves.toBeUndefined();

    expect(replyText(replies)).toContain('core.err.commandFailed');
  });

  it('mengedit balasan yang sudah di-defer, bukan membalas lagi', async () => {
    const execute = vi.fn(async () => {
      throw new Error('boom');
    });
    const { interaction, replies, edits } = fakeInteraction({ deferred: true });

    await interactionCreate.execute(fakeClient([fakeCommand({ execute })]), interaction);

    expect(replies).toHaveLength(0);
    expect(replyText(edits)).toContain('core.err.commandFailed');
  });

  it('tidak melempar keluar saat pesan gagalnya sendiri gagal', async () => {
    const execute = vi.fn(async () => {
      throw new Error('boom');
    });
    const broken = fakeInteraction();
    const interaction = {
      ...broken.chatInput,
      reply: async () => {
        throw new Error('balasan gagal');
      },
      editReply: async () => {
        throw new Error('edit gagal');
      },
    } as unknown as Interaction;

    await expect(
      interactionCreate.execute(fakeClient([fakeCommand({ execute })]), interaction),
    ).resolves.toBeUndefined();
  });
});

describe('interactionCreate — metrik', () => {
  it('menghitung perintah yang berhasil lewat gerbang', async () => {
    const before = commandCounters();

    await interactionCreate.execute(fakeClient([fakeCommand()]), fakeInteraction().interaction);

    const after = commandCounters();
    expect(after.total).toBe(before.total + 1);
    expect(after.errors).toBe(before.errors);
  });

  it('menghitung perintah yang gagal sebagai error', async () => {
    const before = commandCounters();
    const execute = vi.fn(async () => {
      throw new Error('boom');
    });

    await interactionCreate.execute(fakeClient([fakeCommand({ execute })]), fakeInteraction().interaction);

    const after = commandCounters();
    expect(after.errors).toBe(before.errors + 1);
  });

  it('tidak menghitung perintah yang ditolak cooldown', async () => {
    const command = fakeCommand({ cooldownSeconds: 30 });
    await interactionCreate.execute(fakeClient([command]), fakeInteraction().interaction);

    const before = commandCounters();
    await interactionCreate.execute(fakeClient([command]), fakeInteraction().interaction);

    expect(commandCounters().total).toBe(before.total);
  });
});