import { describe, expect, it, vi } from 'vitest';
import { MemoryKeyValueStore, RedisKeyValueStore } from '../src/services/kvStore.js';
import {
  CONFIG_CHANGED_CHANNEL,
  createConfigChangedHandler,
  encodeConfigChanged,
  publishConfigChanged,
  subscribeConfigChanged,
} from '../src/modules/config/invalidation.js';

/**
 * Publish/subscribe di `KeyValueStore`.
 *
 * Broker Redis diganti objek dalam proses: yang perlu dibuktikan di sini adalah
 * perintah yang dikirim store (PUBLISH di koneksi perintah, SUBSCRIBE di
 * koneksi terpisah), bukan protokol Redis-nya. Broker palsu tetap menyampaikan
 * pesan antar dua store, jadi jalur "proses lain menerima" ikut teruji.
 */

/** Broker publikasi-langganan dalam proses, cukup untuk dua store. */
class Broker {
  private readonly listeners = new Map<string, Set<(message: string) => void>>();

  terkirim: { channel: string; message: string }[] = [];

  publish(channel: string, message: string): number {
    this.terkirim.push({ channel, message });
    const pendengar = this.listeners.get(channel);

    for (const listener of pendengar ?? []) listener(message);
    return pendengar?.size ?? 0;
  }

  subscribe(channel: string, listener: (message: string) => void): void {
    const set = this.listeners.get(channel) ?? new Set();
    set.add(listener);
    this.listeners.set(channel, set);
  }

  unsubscribe(channel: string, listener: (message: string) => void): void {
    this.listeners.get(channel)?.delete(listener);
  }
}

/** Klien palsu yang menyerupai ioredis: satu koneksi perintah + satu langganan. */
class FakeRedis {
  public readonly calls: string[] = [];
  public quitDipanggil = false;

  constructor(private readonly broker: Broker) {}

  async quit(): Promise<unknown> {
    this.quitDipanggil = true;
    return 'OK';
  }

  on(): unknown {
    return this;
  }

  async publish(channel: string, message: string): Promise<number> {
    this.calls.push(`publish ${channel}`);
    return this.broker.publish(channel, message);
  }
}

/** Koneksi langganan: menyimpan listener supaya bisa dipicu broker. */
class FakeSubscriber {
  private listener: ((...args: unknown[]) => void) | undefined;
  public quitDipanggil = false;
  public channels: string[] = [];

  constructor(private readonly broker: Broker) {}

  on(event: string, listener: (...args: unknown[]) => void): unknown {
    if (event === 'message') this.listener = listener;
    return this;
  }

  async subscribe(channel: string): Promise<unknown> {
    this.channels.push(channel);
    this.broker.subscribe(channel, (message) => this.listener?.(channel, message));
    return 1;
  }

  async quit(): Promise<unknown> {
    this.quitDipanggil = true;
    for (const channel of this.channels) {
      this.broker.unsubscribe(channel, (message) => this.listener?.(channel, message));
    }
    return 'OK';
  }
}

function buatStore(broker: Broker, opsi: { tanpaPublish?: boolean; tanpaSubscribe?: boolean } = {}) {
  const klien = new FakeRedis(broker);

  // `tanpaPublish` mensimulasikan klien lama tanpa PUBLISH: metode optional-nya
  // harus benar-benar tidak ada, bukan hanya melempar.
  if (opsi.tanpaPublish) {
    Object.defineProperty(klien, 'publish', { value: undefined });
  }

  const subscriber = new FakeSubscriber(broker);
  const store = new RedisKeyValueStore(klien as never, {
    subscriberFactory: () => {
      if (opsi.tanpaSubscribe) throw new Error('klien langganan tidak ada');
      return subscriber as never;
    },
  });

  return { store, klien, subscriber };
}

describe('KeyValueStore: publish', () => {
  it('store memori menjawab false, bukan pura-pura berhasil', async () => {
    const store = new MemoryKeyValueStore();

    expect(await store.publish(CONFIG_CHANGED_CHANNEL, 'apa saja')).toBe(false);
  });

  it('store Redis mengirim lewat koneksi perintah', async () => {
    const broker = new Broker();
    const { store, klien } = buatStore(broker);

    expect(await store.publish(CONFIG_CHANGED_CHANNEL, 'halo')).toBe(true);
    expect(klien.calls).toEqual([`publish ${CONFIG_CHANGED_CHANNEL}`]);
    expect(broker.terkirim).toEqual([{ channel: CONFIG_CHANGED_CHANNEL, message: 'halo' }]);
  });

  it('klien tanpa PUBLISH dijawab false supaya pemanggil bisa menolak menulis', async () => {
    const { store } = buatStore(new Broker(), { tanpaPublish: true });

    expect(await store.publish(CONFIG_CHANGED_CHANNEL, 'halo')).toBe(false);
  });
});

describe('KeyValueStore: subscribe', () => {
  it('memakai koneksi terpisah, bukan koneksi perintah', async () => {
    const broker = new Broker();
    const { store, subscriber } = buatStore(broker);
    const handler = vi.fn();

    const stop = await store.subscribe(CONFIG_CHANGED_CHANNEL, handler);
    await store.publish(CONFIG_CHANGED_CHANNEL, 'pesan-1');

    expect(subscriber.channels).toEqual([CONFIG_CHANGED_CHANNEL]);
    expect(handler).toHaveBeenCalledWith('pesan-1');
    expect(typeof stop).toBe('function');
  });

  it('pesan kanal lain tidak diteruskan', async () => {
    const broker = new Broker();
    const { store } = buatStore(broker);
    const handler = vi.fn();

    await store.subscribe(CONFIG_CHANGED_CHANNEL, handler);
    broker.publish('kanal-lain', 'bukan untuk kita');

    expect(handler).not.toHaveBeenCalled();
  });

  it('berhenti berlangganan menutup koneksi langganannya', async () => {
    const { store, subscriber } = buatStore(new Broker());

    const stop = await store.subscribe(CONFIG_CHANGED_CHANNEL, vi.fn());
    await stop();

    expect(subscriber.quitDipanggil).toBe(true);
  });

  it('tanpa pabrik koneksi langganan, subscribe melempar alih-alih diam', async () => {
    const store = new RedisKeyValueStore(new FakeRedis(new Broker()) as never);

    await expect(store.subscribe(CONFIG_CHANGED_CHANNEL, vi.fn())).rejects.toThrow('tidak punya koneksi langganan');
  });

  it('pabrik yang gagal diteruskan sebagai error, bukan diam-diam tidak berlangganan', async () => {
    const { store } = buatStore(new Broker(), { tanpaSubscribe: true });

    await expect(store.subscribe(CONFIG_CHANGED_CHANNEL, vi.fn())).rejects.toThrow('klien langganan tidak ada');
  });
});

describe('dua proses: satu menulis, satu membuang cache', () => {
  it('pesan dashboard sampai ke proses bot dan menghasilkan invalidasi', async () => {
    const broker = new Broker();

    // Proses dashboard: menulis lewat Prisma lalu menerbitkan pemberitahuan.
    const dashboard = buatStore(broker);
    // Proses bot: berlangganan dan membuang cache guild yang bersangkutan.
    const bot = buatStore(broker);

    const dibuang: string[] = [];
    const target = (nama: string) => (guildId: string) => {
      dibuang.push(`${nama}:${guildId}`);
    };

    const stop = await subscribeConfigChanged(
      bot.store,
      createConfigChangedHandler({
        config: target('config'),
        locale: target('locale'),
        automod: target('automod'),
        logging: target('logging'),
        customCommands: target('customCommands'),
      }),
    );

    expect(stop).not.toBeNull();
    expect(
      await publishConfigChanged(dashboard.store, {
        guildId: '123456789012345678',
        fields: ['defaultVolume'],
        source: 'dashboard',
        at: '2026-10-06T01:00:00.000Z',
      }),
    ).toBe(true);

    // Handler langganan dipanggil tanpa menunggu (void), jadi beri satu tick.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(dibuang.sort()).toEqual([
      'automod:123456789012345678',
      'config:123456789012345678',
      'customCommands:123456789012345678',
      'locale:123456789012345678',
      'logging:123456789012345678',
    ]);
  });

  it('pesan dengan guildId rusak dibuang tanpa membuang cache mana pun', async () => {
    const broker = new Broker();
    const bot = buatStore(broker);
    const dibuang: string[] = [];

    await subscribeConfigChanged(
      bot.store,
      createConfigChangedHandler({
        config: (guildId) => {
          dibuang.push(guildId);
        },
        locale: (guildId) => {
          dibuang.push(guildId);
        },
        automod: (guildId) => {
          dibuang.push(guildId);
        },
        logging: (guildId) => {
          dibuang.push(guildId);
        },
        customCommands: (guildId) => {
          dibuang.push(guildId);
        },
      }),
    );

    await bot.store.publish(CONFIG_CHANGED_CHANNEL, encodeConfigChanged({ guildId: 'bukan-id', fields: [], source: 'x', at: '' }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(dibuang).toEqual([]);
  });
});
