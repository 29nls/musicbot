import { describe, expect, it, vi } from 'vitest';
import {
  CONFIG_CHANGED_CHANNEL,
  MAX_CHANGED_FIELDS,
  createConfigChangedHandler,
  decodeConfigChanged,
  encodeConfigChanged,
  publishConfigChanged,
  subscribeConfigChanged,
  type ConfigChangedTargets,
} from '../src/modules/config/invalidation.js';
import { MemoryKeyValueStore, type KeyValueStore } from '../src/services/kvStore.js';

/**
 * Kanal invalidasi konfigurasi.
 *
 * Yang dibuktikan di sini bukan "Redis-nya jalan", melainkan keputusan yang
 * diambil modul ini terhadap pesan yang bentuknya tidak terduga. Pesan datang
 * dari proses lain lewat Redis, jadi batas kepercayaannya ada di sini: pesan
 * rusak harus diabaikan, bukan melempar; dan satu cache yang gagal dibuang
 * tidak boleh mencegah cache lain dibuang.
 */

const GUILD = '123456789012345678';

function payload(over: Partial<Parameters<typeof encodeConfigChanged>[0]> = {}) {
  return {
    guildId: GUILD,
    fields: ['defaultVolume'],
    source: 'dashboard',
    at: '2026-10-06T01:00:00.000Z',
    ...over,
  };
}

function buatTargets(over: Partial<ConfigChangedTargets> = {}): ConfigChangedTargets & { calls: string[] } {
  const calls: string[] = [];
  const rekam = (name: string) => (guildId: string) => {
    calls.push(`${name}:${guildId}`);
  };

  return {
    calls,
    config: over.config ?? rekam('config'),
    locale: over.locale ?? rekam('locale'),
    automod: over.automod ?? rekam('automod'),
    logging: over.logging ?? rekam('logging'),
    customCommands: over.customCommands ?? rekam('customCommands'),
  };
}

describe('encode/decode pesan invalidasi', () => {
  it('bolak-balik tetap utuh', () => {
    const pesan = encodeConfigChanged(payload({ fields: ['defaultVolume', 'locale'] }));
    const hasil = decodeConfigChanged(pesan);

    expect(hasil).toEqual({
      guildId: GUILD,
      fields: ['defaultVolume', 'locale'],
      source: 'dashboard',
      at: '2026-10-06T01:00:00.000Z',
    });
    expect(pesan.startsWith(CONFIG_CHANGED_CHANNEL)).toBe(false);
  });

  it('field yang tidak dikenal dan yang terlalu panjang dibuang', () => {
    const pesan = encodeConfigChanged(
      payload({ fields: ['ok', '', 'x'.repeat(61), 'modules.music'] }),
    );

    expect(decodeConfigChanged(pesan)?.fields).toEqual(['ok', 'modules.music']);
  });

  it('daftar field dibatasi, bukan ditolak', () => {
    const banyak = Array.from({ length: MAX_CHANGED_FIELDS + 25 }, (_, i) => `field${i}`);
    const hasil = decodeConfigChanged(encodeConfigChanged(payload({ fields: banyak })));

    expect(hasil?.fields).toHaveLength(MAX_CHANGED_FIELDS);
  });

  it('JSON rusak diabaikan, bukan melempar', () => {
    expect(decodeConfigChanged('bukan-json')).toBeNull();
    expect(decodeConfigChanged('')).toBeNull();
    expect(decodeConfigChanged('null')).toBeNull();
    expect(decodeConfigChanged('[]')).toBeNull();
    expect(decodeConfigChanged('123')).toBeNull();
  });

  it('guildId yang bukan snowflake ditolak', () => {
    expect(decodeConfigChanged(JSON.stringify({ guildId: 'abc' }))).toBeNull();
    expect(decodeConfigChanged(JSON.stringify({ guildId: '123' }))).toBeNull();
    expect(decodeConfigChanged(JSON.stringify({ guildId: 1234567890123 }))).toBeNull();
    expect(decodeConfigChanged(JSON.stringify({ guildId: '12345678901234567890' }))).not.toBeNull();
  });

  it('field yang bukan string disaring keluar', () => {
    const hasil = decodeConfigChanged(
      JSON.stringify({ guildId: GUILD, fields: ['oke', 7, null, { a: 1 }, 'oke-2'] }),
    );

    expect(hasil?.fields).toEqual(['oke', 'oke-2']);
  });

  it('source dan at yang tidak masuk akal diganti, bukan diteruskan', () => {
    const hasil = decodeConfigChanged(JSON.stringify({ guildId: GUILD, source: 'x'.repeat(41), at: 5 }));

    expect(hasil?.source).toBe('tidak-diketahui');
    expect(hasil?.at).toBe('');
  });

  it('kunci tambahan dari pengirim lain diabaikan', () => {
    const hasil = decodeConfigChanged(JSON.stringify({ guildId: GUILD, fields: [], jahat: 'DROP TABLE' }));

    expect(hasil).not.toBeNull();
    expect(Object.keys(hasil ?? {})).toEqual(['guildId', 'fields', 'source', 'at']);
  });
});

describe('publishConfigChanged', () => {
  it('menjawab false kalau store tidak punya kanal (store memori)', async () => {
    const store = new MemoryKeyValueStore();

    expect(await publishConfigChanged(store, payload())).toBe(false);
  });

  it('mengirim pesan yang bisa dibaca ulang oleh decode', async () => {
    const terkirim: { channel: string; message: string }[] = [];
    const store = {
      publish: async (channel: string, message: string) => {
        terkirim.push({ channel, message });
        return true;
      },
    };

    expect(
      await publishConfigChanged(store as unknown as KeyValueStore, payload({ fields: ['locale'] })),
    ).toBe(true);
    expect(terkirim).toHaveLength(1);
    expect(terkirim[0]?.channel).toBe(CONFIG_CHANGED_CHANNEL);
    expect(decodeConfigChanged(terkirim[0]?.message ?? '')?.fields).toEqual(['locale']);
  });

  it('kegagalan Redis dilaporkan sebagai false, bukan dilempar', async () => {
    const store = {
      publish: async () => {
        throw new Error('ECONNRESET');
      },
    };

    expect(await publishConfigChanged(store as unknown as KeyValueStore, payload())).toBe(false);
  });
});

describe('createConfigChangedHandler', () => {
  it('membuang cache semua target untuk guild yang benar', async () => {
    const targets = buatTargets();
    const handler = createConfigChangedHandler(targets);

    await handler(encodeConfigChanged(payload()));

    expect(targets.calls.sort()).toEqual([
      `automod:${GUILD}`,
      `config:${GUILD}`,
      `customCommands:${GUILD}`,
      `locale:${GUILD}`,
      `logging:${GUILD}`,
    ]);
  });

  it('satu target yang gagal tidak menghalangi target lain', async () => {
    const dilaporkan: string[] = [];
    const targets = buatTargets({
      locale: () => {
        throw new Error('cache locale rusak');
      },
    });
    const handler = createConfigChangedHandler(targets, {
      onError: (target) => dilaporkan.push(target),
    });

    await handler(encodeConfigChanged(payload()));

    expect(dilaporkan).toEqual(['locale']);
    expect(targets.calls).toContain(`config:${GUILD}`);
    expect(targets.calls).toContain(`customCommands:${GUILD}`);
  });

  it('target async juga ditunggu sebelum target berikutnya', async () => {
    const urutan: string[] = [];
    const targets = buatTargets({
      config: async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        urutan.push('config');
      },
      locale: () => {
        urutan.push('locale');
      },
    });

    await createConfigChangedHandler(targets)(encodeConfigChanged(payload()));

    expect(urutan).toEqual(['config', 'locale']);
  });

  it('pesan rusak tidak memanggil satu target pun dan dilaporkan', async () => {
    const targets = buatTargets();
    const diabaikan: string[] = [];
    const handler = createConfigChangedHandler(targets, { onIgnored: (raw) => diabaikan.push(raw) });

    await handler('{rusak');

    expect(targets.calls).toEqual([]);
    expect(diabaikan).toEqual(['{rusak']);
  });
});

describe('subscribeConfigChanged', () => {
  it('menjawab null kalau store tidak bisa berlangganan', async () => {
    const store = new MemoryKeyValueStore();

    expect(await subscribeConfigChanged(store, vi.fn())).toBeNull();
  });

  it('mendaftar di kanal yang benar dan meneruskan pesan mentah', async () => {
    const handler = vi.fn();
    const subscribe = vi.fn(async (_channel: string, cb: (message: string) => void) => {
      cb('pesan-masuk');
      return async () => {};
    });

    const stop = await subscribeConfigChanged({ subscribe } as never, handler);

    expect(subscribe).toHaveBeenCalledWith(CONFIG_CHANGED_CHANNEL, expect.any(Function));
    expect(handler).toHaveBeenCalledWith('pesan-masuk');
    expect(typeof stop).toBe('function');
  });
});
