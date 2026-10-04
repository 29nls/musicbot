import { ActivityType, Events } from 'discord.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import clientError from '../src/events/clientError.js';
import clientReady from '../src/events/clientReady.js';
import clientWarn from '../src/events/clientWarn.js';
import { BOT_NAME } from '../src/config/constants.js';
import type { BotClient } from '../src/client.js';

/**
 * Tiga event siklus hidup client: error, peringatan, dan siap menerima perintah.
 *
 * Semuanya satu hal: menulis ke log internal bot. Tidak ada embed, tidak ada
 * interaksi, tidak ada yang bisa gagal di luar logger itu sendiri — jadi tes ini
 * tidak memeriksa format apa pun, melainkan **memastikan setiap event benar-benar
 * menulis**, dan `clientReady` tetap memasang presence bot.
 *
 * Kenapa ini penting: ketiganya punya satu jalan keluar yang mudah salah —
 * `clientReady` keluar lebih dulu kalau `client.user` belum terisi. Itu terjadi
 * kalau listener dipasang setelah handshake selesai, dan gejalanya bot hidup tapi
 * tidak pernah terlihat online. Uji di bawah menjaga kedua sisi: keluar tanpa
 * menulis saat memang belum ada user, dan menulis presence + ringkasan saat
 * sudah ada.
 */

const logger = vi.hoisted(() => ({
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
}));

vi.mock('../src/services/logger.js', () => ({ getLogger: () => logger }));

beforeEach(() => {
  logger.error.mockClear();
  logger.warn.mockClear();
  logger.info.mockClear();
  logger.debug.mockClear();
});

/** Client palsu: `user` bisa sengaja dikosongkan untuk menguji jalur keluar. */
function fakeClient(options: { user?: unknown } = {}) {
  const { user = null } = options;
  return {
    user,
    guilds: { cache: { size: 12 } },
    commands: { size: 34 },
  } as unknown as BotClient;
}

/** Objek user discord.js yang hanya punya bagian yang dipakai `clientReady`. */
function fakeUser() {
  return {
    id: '999999999999999999',
    tag: 'Harmony#0001',
    setPresence: vi.fn(),
  };
}

describe('clientError', () => {
  it('mendengarkan event error discord.js', () => {
    expect(clientError.name).toBe(Events.Error);
  });

  it('menulis error yang diteruskan, bukan menelan atau menggantinya', () => {
    const error = new Error('gateway terputus');

    clientError.execute(fakeClient(), error);

    expect(logger.error).toHaveBeenCalledTimes(1);
    // Objek error-nya harus sampai apa adanya: kalau diganti pesan teksnya,
    // stack hilang dan penyebab aslinya tidak bisa ditelusuri.
    expect(logger.error.mock.calls[0]?.[0]).toMatchObject({ err: error });
  });

  it('tidak menulis sebagai warning atau info', () => {
    clientError.execute(fakeClient(), new Error('boom'));

    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.info).not.toHaveBeenCalled();
  });
});

describe('clientWarn', () => {
  it('mendengarkan event warn discord.js', () => {
    expect(clientWarn.name).toBe(Events.Warn);
  });

  it('menulis peringatan beserta pesannya', () => {
    clientWarn.execute(fakeClient(), 'rate limit mendekati batas');

    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn.mock.calls[0]?.[0]).toMatchObject({
      message: 'rate limit mendekati batas',
    });
  });

  it('peringatan tidak dinaikkan jadi error', () => {
    clientWarn.execute(fakeClient(), 'peringatan biasa');

    expect(logger.error).not.toHaveBeenCalled();
  });
});

describe('clientReady', () => {
  it('mendengarkan clientReady dan hanya sekali', () => {
    expect(clientReady.name).toBe(Events.ClientReady);
    // `once: true` yang hilang berarti presence dipasang ulang tiap event apa
    // pun yang menyusul, dan itu memunculkan_ready berulang di log.
    expect(clientReady.once).toBe(true);
  });

  it('keluar tanpa menulis kalau client.user belum ada', () => {
    clientReady.execute(fakeClient());

    expect(logger.info).not.toHaveBeenCalled();
  });

  it('menyetel presence online dengan aktivitas listening', () => {
    const user = fakeUser();

    clientReady.execute(fakeClient({ user }));

    expect(user.setPresence).toHaveBeenCalledTimes(1);
    const presence = user.setPresence.mock.calls[0]?.[0] as {
      status: string;
      activities: Array<{ name: string; type: number }>;
    };
    expect(presence.status).toBe('online');
    expect(presence.activities[0]?.type).toBe(ActivityType.Listening);
    // Nama aktivitas diberi awalan '/': Discord hanya bisa menampilkan satu baris
    // activity, jadi '/help' adalah hal yang harus bisa diketik user apa adanya.
    expect(presence.activities[0]?.name).toContain('/help');
  });

  it('merangkum tag, jumlah server, dan jumlah perintah', () => {
    const user = fakeUser();

    clientReady.execute(fakeClient({ user }));

    expect(logger.info).toHaveBeenCalledTimes(1);
    const payload = logger.info.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(payload).toMatchObject({
      tag: user.tag,
      id: user.id,
      server: 12,
      perintah: 34,
    });
    // Nama bot ikut tercetak: ini baris pertama yang dilihat admin saat bot
    // start, dan itu tempat yang paling perlu menyebut nama bot.
    expect(logger.info.mock.calls[0]?.[1]).toContain(BOT_NAME);
  });

  it('kesalahan setPresence diteruskan ke pembungkus loader, bukan disembunyikan', () => {
    const user = fakeUser();
    user.setPresence.mockImplementation(() => {
      throw new Error('presence ditolak');
    });

    expect(() => clientReady.execute(fakeClient({ user }))).toThrow('presence ditolak');
    // `clientReady` tidak menangkap apa pun. Itu disengaja: pembungkus di
    // `handlers/eventHandler.ts` yang mencatat kegagalan, jadi kalau handler
    // ini menelan error-nya, satu baris log hilang tanpa jejak.
    expect(logger.info).not.toHaveBeenCalled();
  });
});