import { Events } from 'discord.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadEvents } from '../src/handlers/eventHandler.js';
import type { BotClient } from '../src/client.js';

/**
 * `loadEvents` — memasang seluruh file di `src/events/` ke gateway.
 *
 * Loader ini yang menentukan apakah sebuah event **sampai** ke handler-nya, jadi
 * ada dua hal yang harus dijaga:
 *
 * 1. **Satu handler yang melempar tidak boleh mematikan proses.** Error di
 *    `guildMemberAdd` tidak boleh membuat `messageCreate` ikut mati. Karena itu
 *    setiap listener dibungkus; kalau bungkusnya dihapus, satu handler rusak
 *    menjatuhkan seluruh event bot — dan tidak ada yang gagal saat start.
 * 2. **Modul yang tidak berbentuk `{ name, execute }` harus gagal saat start.**
 *    Kalau dilewati diam-diam, event tersebut hilang tanpa jejak: bot terlihat
 *    hidup, tapi satu jenis aksi tidak pernah terjadi.
 */

const mocks = vi.hoisted(() => ({
  listModuleFiles: vi.fn(),
  importDefault: vi.fn(),
  loggerDebug: vi.fn(),
  loggerInfo: vi.fn(),
  loggerError: vi.fn(),
}));

vi.mock('../src/utils/moduleLoader.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/utils/moduleLoader.js')>();
  return { ...actual, listModuleFiles: mocks.listModuleFiles, importDefault: mocks.importDefault };
});

vi.mock('../src/services/logger.js', () => ({
  getLogger: () => ({ debug: mocks.loggerDebug, info: mocks.loggerInfo, error: mocks.loggerError }),
}));

/** Client palsu yang mencatat event mana yang dipasang lewat `on`/`once`. */
function fakeClient() {
  const on: Array<[string, unknown]> = [];
  const once: Array<[string, unknown]> = [];

  return {
    client: { on: (name: string, fn: unknown) => on.push([name, fn]), once: (name: string, fn: unknown) => once.push([name, fn]) } as unknown as BotClient,
    on,
    once,
  };
}

/** Panggil listener yang sudah terpasang untuk sebuah nama event. */
function listenerFor(registered: Array<[string, unknown]>, name: string): (client: unknown, ...args: unknown[]) => void {
  const found = registered.find(([eventName]) => eventName === name);
  if (!found) throw new Error(`event ${name} tidak terpasang`);
  return found[1] as (client: unknown, ...args: unknown[]) => void;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listModuleFiles.mockReturnValue(['/events/a.ts', '/events/b.ts']);
  mocks.importDefault.mockImplementation(async (file: string) => {
    if (file.endsWith('a.ts')) {
      return { name: Events.MessageCreate, execute: (): void => undefined };
    }
    return { name: Events.GuildMemberAdd, once: true, execute: (): void => undefined };
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});
describe('pemasangan event', () => {
  it('memasang setiap file yang ditemukan', async () => {
    const { client, on, once } = fakeClient();

    await loadEvents(client);

    expect(on).toHaveLength(1);
    expect(once).toHaveLength(1);
  });

  it('memakai `once` hanya untuk handler yang menandainya', async () => {
    const { client, on, once } = fakeClient();

    await loadEvents(client);

    // Salah pasang di sini berarti presence bot dipasang ulang setiap event apa
    // pun, atau `clientReady` tidak pernah terpasang dua kali.
    expect(on.map(([name]) => name)).toEqual([Events.MessageCreate]);
    expect(once.map(([name]) => name)).toEqual([Events.GuildMemberAdd]);
  });

  it('meneruskan client dan argumen event apa adanya', async () => {
    const seen: unknown[][] = [];
    mocks.listModuleFiles.mockReturnValue(['/events/a.ts']);
    mocks.importDefault.mockResolvedValue({
      name: Events.MessageCreate,
      execute: (...args: unknown[]) => {
        seen.push(args);
      },
    });
    const { client, on } = fakeClient();

    await loadEvents(client);
    listenerFor(on, Events.MessageCreate)(client, 'argumen-1', 'argumen-2');

    // discord.js memanggil listener dengan `client` sebagai argumen pertama,
    // dan loader juga menyisipkan client-nya. Jadi client muncul dua kali:
    // satu dari closure loader, satu dari argumen event yang diteruskan.
    expect(seen[0]?.[0]).toBe(client);
    expect(seen[0]?.slice(1)).toEqual([client, 'argumen-1', 'argumen-2']);
  });

  it('menolak modul yang tidak berbentuk { name, execute }', async () => {
    mocks.importDefault.mockResolvedValue({ name: Events.MessageCreate });

    // Lewat diam-diam berarti satu jenis event hilang tanpa jejak: bot terlihat
    // hidup, tapi aksinya tidak pernah terjadi.
    await expect(loadEvents(fakeClient().client)).rejects.toThrow(/tidak valid/);
  });

  it('menolak modul yang bukan objek sama sekali', async () => {
    mocks.importDefault.mockResolvedValue(undefined);

    await expect(loadEvents(fakeClient().client)).rejects.toThrow(/tidak valid/);
  });
});

describe('penjaga: satu handler rusak tidak menjatuhkan yang lain', () => {
  it('menangkap error yang dilempar sinkron', async () => {
    mocks.listModuleFiles.mockReturnValue(['/events/a.ts']);
    mocks.importDefault.mockResolvedValue({
      name: Events.MessageCreate,
      execute: () => {
        throw new Error('handler rusak');
      },
    });
    const { client, on } = fakeClient();

    await loadEvents(client);

    // Tidak melempar keluar: kalau ini tidak dibungkus, satu handler yang rusak
    // menghentikan pemrosesan gateway untuk semua event lain.
    expect(() => listenerFor(on, Events.MessageCreate)(client)).not.toThrow();
    expect(mocks.loggerError).toHaveBeenCalled();
  });

  it('menangkap promise yang ditolak, tanpa exception yang tidak tertangani', async () => {
    mocks.listModuleFiles.mockReturnValue(['/events/a.ts']);
    mocks.importDefault.mockResolvedValue({
      name: Events.MessageCreate,
      execute: async () => {
        throw new Error('basis data mati');
      },
    });
    const { client, on } = fakeClient();

    await loadEvents(client);
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason);
    };
    process.on('unhandledRejection', onUnhandled);

    listenerFor(on, Events.MessageCreate)(client);
    await new Promise((resolve) => setImmediate(resolve));
    process.off('unhandledRejection', onUnhandled);

    expect(unhandled).toEqual([]);
    expect(mocks.loggerError).toHaveBeenCalled();
  });

  it('event lain tetap terpanggil setelah satu handler gagal', async () => {
    const calls: string[] = [];
    mocks.listModuleFiles.mockReturnValue(['/events/a.ts', '/events/b.ts']);
    mocks.importDefault.mockImplementation(async (file: string) =>
      file.endsWith('a.ts')
        ? {
            name: Events.MessageCreate,
            execute: () => {
              calls.push('a');
              throw new Error('rusak');
            },
          }
        : { name: Events.GuildMemberAdd, execute: () => calls.push('b') },
    );
    const { client, on } = fakeClient();

    await loadEvents(client);
    listenerFor(on, Events.MessageCreate)(client);
    listenerFor(on, Events.GuildMemberAdd)(client);

    expect(calls).toEqual(['a', 'b']);
  });
});