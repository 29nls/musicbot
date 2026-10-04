import { AuditLogEvent, type Guild } from 'discord.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { findAuditEntry } from '../src/modules/logging/audit.js';
import { dispatchLog } from '../src/modules/logging/dispatch.js';
import { logEmbed } from '../src/modules/logging/embeds.js';

/**
 * `dispatchLog` dan `findAuditEntry` — dua helper yang dipanggil seluruh 22
 * handler event logging.
 *
 * Keduanya tidak pernah dipanggil langsung di kode lain selain event logging,
 * jadi tanpa tes di sini tidak ada satu pun handler yang benar-benar teruji:
 * semuanya akan terlihat "hijau" padahal hanya memanggil fungsi yang tidak
 * pernah dieksekusi.
 *
 * Yang dijaga di sini adalah urutan dan ketegaran keduanya:
 *
 * 1. **Riwayat dicatat sebelum embed dikirim.** Kalau urutannya dibalik, satu
 *    pengiriman yang gagal membuat `/logs` menampilkan entri yang tidak pernah
 *    sampai ke channel mana pun — history yang menipu.
 * 2. **Kegagalan pengiriman tidakynyapping**, dan tidak menggagalkan event.
 * 3. **`findAuditEntry` tidak melempar.** Bot sering tidak punya izin View
 *    Audit Log; kalau itu jadi error, setiap event yang butuh executor akan
 *    gagal dan log judgmental hilang.
 */

const mocks = vi.hoisted(() => ({
  resolveLogTarget: vi.fn(),
  record: vi.fn(async () => 42),
  attachMessage: vi.fn(async () => undefined),
  getChannel: vi.fn(async () => null),
  loggerWarn: vi.fn(),
  loggerDebug: vi.fn(),
}));

vi.mock('../src/modules/logging/record.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/modules/logging/record.js')>();
  return { ...actual, resolveLogTarget: mocks.resolveLogTarget };
});

vi.mock('../src/modules/logging/singleton.js', () => ({
  getLoggingService: () => ({ record: mocks.record, attachMessage: mocks.attachMessage }),
}));

vi.mock('../src/services/logger.js', () => ({
  getLogger: () => ({ warn: mocks.loggerWarn, debug: mocks.loggerDebug, error: vi.fn(), info: vi.fn() }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolveLogTarget.mockResolvedValue({ enabled: true, channelId: 'log-1' });
  mocks.record.mockResolvedValue(42);
  mocks.attachMessage.mockResolvedValue(undefined);
});

/**
 * Guild/channel palsu yang mencatat urutan pemanggilannya.
 *
 * `channel: null` berarti channel tidak ditemukan (hasil `fetch` yang null),
 * dan `undefined` berarti pakai channel teks bawaan. Membedakan keduanya penting:
 * keduanya sama-sama membuat pengiriman gagal, tapi hanya yang kedua yang
 * sampai ke cabang `channel.send()`.
 */
function fakeGuild(options: { channel?: unknown; fetchError?: Error } = {}) {
  const calls: string[] = [];

  const channel = options.channel === undefined ? {
    isTextBased: () => true,
    isDMBased: () => false,
    send: async ({ embeds }: { embeds: unknown[] }) => {
      calls.push('send');
      return { id: 'message-1', embeds };
    },
  } : options.channel;

  const guild = {
    id: 'guild-1',
    channels: {
      fetch: async () => {
        calls.push('fetch');
        if (options.fetchError) throw options.fetchError;
        return channel;
      },
    },
  } as unknown as Guild;

  return { guild, calls };
}

function embed(text = 'isi') {
  return logEmbed({ category: 'member', title: text });
}

describe('dispatchLog: urutan dan kondisi berhenti', () => {
  it('mencatat riwayat sebelum mengirim embed', async () => {
    const order: string[] = [];
    mocks.record.mockImplementation(async () => {
      order.push('record');
      return 42;
    });
    const { guild, calls } = fakeGuild();

    await dispatchLog(guild, 'member', embed(), { eventKey: 'guildBanAdd' });

    // `record` harus lebih dulu: kalau tidak, kegagalan kirim menyisakan baris
    // riwayat untuk pesan yang tidak pernah sampai.
    expect(mocks.record).toHaveBeenCalledTimes(1);
    expect(order[0]).toBe('record');
    expect(calls).toContain('send');
  });

  it('menempeli ID pesan ke baris riwayat yang baru disimpan', async () => {
    const { guild } = fakeGuild();

    await dispatchLog(guild, 'member', embed(), { eventKey: 'guildBanAdd' });

    expect(mocks.attachMessage).toHaveBeenCalledWith(42, 'message-1', 'log-1');
  });

  it('tidak mengirim apa pun kalau konfigurasi tidak terbaca', async () => {
    mocks.resolveLogTarget.mockResolvedValue(null);
    const { guild, calls } = fakeGuild();

    // `resolveLogTarget` null = guild tidak bisa dibaca. Melewatinya berarti
    // satu event gagal tanpa jejak, dan log untuk guild itu hilang.
    expect(await dispatchLog(guild, 'member', embed())).toBe(false);
    expect(calls).not.toContain('send');
    expect(mocks.record).not.toHaveBeenCalled();
  });

  it('tidak mengirim apa pun kalau modul logging mati di server itu', async () => {
    mocks.resolveLogTarget.mockResolvedValue({ enabled: false, channelId: null });
    const { guild, calls } = fakeGuild();

    expect(await dispatchLog(guild, 'member', embed())).toBe(false);
    expect(calls).not.toContain('send');
    expect(mocks.record).not.toHaveBeenCalled();
  });

  it('tetap menyimpan riwayat walau tidak ada channel tujuan', async () => {
    mocks.resolveLogTarget.mockResolvedValue({ enabled: true, channelId: null });
    const { guild, calls } = fakeGuild();

    expect(await dispatchLog(guild, 'member', embed(), { eventKey: 'x' })).toBe(false);
    // Embed tidak bisa dikirim, tapi baris riwayatnya tetap berguna untuk /logs.
    expect(calls).not.toContain('send');
    expect(mocks.record).toHaveBeenCalledTimes(1);
    expect(mocks.attachMessage).not.toHaveBeenCalled();
  });

  it('melewati penyimpanan riwayat kalau meta meminta record: false', async () => {
    const { guild } = fakeGuild();

    await dispatchLog(guild, 'member', embed(), { eventKey: 'guildBanAdd', record: false });

    // Kasus yang sudah dicatat perintah tidak boleh terdua di /logs.
    expect(mocks.record).not.toHaveBeenCalled();
    expect(mocks.attachMessage).not.toHaveBeenCalled();
  });
});

describe('dispatchLog: kegagalan pengiriman tidakynyapping', () => {
  it('mengabaikan channel yang bukan channel teks meski ia bisa menerima pesan', async () => {
    // `send` di sini sengaja berfungsi. Kalau penjaga `isTextBased()` dihapus,
    // channel ini akan benar-benar mengirim dan tes ini gagal — bukan lolos
    // karena `send` tidak ada lalu tertangkap blok catch.
    const { guild, calls } = fakeGuild({
      channel: {
        isTextBased: () => false,
        isDMBased: () => false,
        send: async () => {
          calls.push('send');
          return { id: 'message-1' };
        },
      },
    });

    expect(await dispatchLog(guild, 'member', embed(), { eventKey: 'x' })).toBe(false);
    expect(calls).not.toContain('send');
    expect(mocks.loggerWarn).toHaveBeenCalled();
    expect(mocks.attachMessage).not.toHaveBeenCalled();
  });

  it('mengabaikan channel yang tidak ditemukan', async () => {
    const { guild } = fakeGuild({ channel: null });

    expect(await dispatchLog(guild, 'member', embed(), { eventKey: 'x' })).toBe(false);
    expect(mocks.record).toHaveBeenCalledTimes(1);
  });

  it('tidak melempar kalau send gagal, dan riwayat tetap tersimpan', async () => {
    const { guild } = fakeGuild({
      channel: {
        isTextBased: () => true,
        isDMBased: () => false,
        send: async () => {
          throw new Error('Missing Access');
        },
      },
    });

    // Ini yang paling penting: error pengiriman tidak boleh dilempar keluar,
    // karena pemanggilnya handler event yang tidak punya try/catch.
    await expect(dispatchLog(guild, 'member', embed(), { eventKey: 'x' })).resolves.toBe(false);
    expect(mocks.record).toHaveBeenCalledTimes(1);
    expect(mocks.attachMessage).not.toHaveBeenCalled();
  });

  it('memperlakukan channel DM sebagai bukan tujuan log meski ia bisa menerima pesan', async () => {
    const { guild, calls } = fakeGuild({
      channel: {
        isTextBased: () => true,
        isDMBased: () => true,
        send: async () => {
          calls.push('send');
          return { id: 'message-1' };
        },
      },
    });

    expect(await dispatchLog(guild, 'member', embed(), { eventKey: 'x' })).toBe(false);
    expect(calls).not.toContain('send');
  });
});

describe('findAuditEntry', () => {
  /** Audit log palsu: `entries` bisa dikembalikan apa adanya atau melempar. */
  function fakeAuditGuild(options: { entries?: Array<unknown>; throws?: Error } = {}) {
    const guild = {
      id: 'guild-1',
      fetchAuditLogs: async () => {
        if (options.throws) throw options.throws;
        return { entries: { values: () => options.entries ?? [] } };
      },
    } as unknown as Guild;
    return guild;
  }

  const entry = (overrides: Record<string, unknown> = {}) => ({
    targetId: 'user-1',
    executor: { id: 'mod-1', tag: 'Mod#0001' },
    createdTimestamp: Date.now(),
    reason: 'alasan',
    ...overrides,
  });

  it('mengembalikan entri pertama yang cocok dan cukup baru', async () => {
    const guild = fakeAuditGuild({ entries: [entry()] });

    const found = await findAuditEntry(guild, AuditLogEvent.MemberBanAdd, { targetId: 'user-1' });

    expect(found?.executor?.id).toBe('mod-1');
  });

  it('melewati entri yang targetnya berbeda lalu mengambil entri berikutnya', async () => {
    const guild = fakeAuditGuild({
      entries: [
        entry({ targetId: 'user-other', executor: { id: 'mod-2' } }),
        entry({ targetId: 'user-1', executor: { id: 'mod-1' } }),
      ],
    });

    // Kalau entri pertama dipakai tanpa cocok target, satu member bisa blamed
    // atas tindakan yang dilakukan atas orang lain.
    const found = await findAuditEntry(guild, AuditLogEvent.MemberKick, { targetId: 'user-1' });

    expect(found?.executor?.id).toBe('mod-1');
  });

  it('berhenti di entri pertama yang sudah terlalu tua', async () => {
    const guild = fakeAuditGuild({
      entries: [
        entry({ createdTimestamp: Date.now() - 60_000 }),
        entry({ createdTimestamp: Date.now() }),
      ],
    });

    // Entri diurutkan terbaru dulu, jadi entri pertama yang sudah tua berarti
    // sisanya juga tua. Ambil yang kedua berarti melaporkanPelaku untuk aksi lama.
    expect(await findAuditEntry(guild, AuditLogEvent.MemberKick, { maxAgeMs: 15_000 })).toBeNull();
  });

  it('menghormati maxAgeMs yang lebih longgar dari bawaan', async () => {
    const guild = fakeAuditGuild({
      entries: [entry({ createdTimestamp: Date.now() - 20_000 })],
    });

    expect(await findAuditEntry(guild, AuditLogEvent.MemberKick, { maxAgeMs: 60_000 })).not.toBeNull();
    expect(await findAuditEntry(guild, AuditLogEvent.MemberKick)).toBeNull();
  });

  it('mengembalikan null saat audit log kosong', async () => {
    expect(await findAuditEntry(fakeAuditGuild({ entries: [] }), AuditLogEvent.GuildUpdate)).toBeNull();
  });

  it('mengembalikan null dan mencatat saat bot tidak punya izin', async () => {
    const guild = fakeAuditGuild({ throws: new Error('Missing Permissions') });

    // Tidak melempar: bot tanpa izin View Audit Log itu normal, dan setiap event
    // yang butuh executor akan gagal kalau error ini diteruskan.
    await expect(findAuditEntry(guild, AuditLogEvent.MemberBanAdd)).resolves.toBeNull();
    expect(mocks.loggerDebug).toHaveBeenCalled();
  });
});