import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseEnv } from '../src/config/env.js';
import {
  assertShardingReady,
  parseShardList,
  resolveShardPlan,
  shardingBlockReason,
  ShardingConfigError,
  type ShardingInputs,
} from '../src/config/sharding.js';

const REQUIRED_ENV = {
  DISCORD_TOKEN: 'a'.repeat(30),
  DISCORD_CLIENT_ID: '1107624713720709122',
  DATABASE_URL: 'postgresql://user:pass@db.example.supabase.co:5432/postgres',
  REDIS_URL: 'redis://localhost:6379',
  LAVALINK_PASSWORD: 'harmony_dev_password',
};

function inputs(overrides: Partial<ShardingInputs> = {}): ShardingInputs {
  return { maxShards: 4, shardList: [0, 1], driver: 'redis', ...overrides };
}

describe('parseShardList', () => {
  it('belum diisi berarti null, yaitu proses ini memegang semuanya', () => {
    expect(parseShardList(undefined, 4)).toBeNull();
    expect(parseShardList('', 4)).toBeNull();
    expect(parseShardList('   ', 4)).toBeNull();
  });

  it('membaca daftar nomor shard dan membuang spasi di sekitar koma', () => {
    expect(parseShardList('0,2,3', 4)).toEqual([0, 2, 3]);
    expect(parseShardList(' 0 , 2 ', 4)).toEqual([0, 2]);
  });

  it('membuang duplikat, jadi shard yang disebut dua kali tetap satu', () => {
    expect(parseShardList('0,0,1,1', 4)).toEqual([0, 1]);
  });

  it('entri rusak dilempar, bukan dibuang: shard yang hilang tidak akan pernah tersambung', () => {
    expect(() => parseShardList('0,abc', 4)).toThrow(ShardingConfigError);
    expect(() => parseShardList('0,,1', 4)).toThrow(ShardingConfigError);
    expect(() => parseShardList('1.5', 4)).toThrow(ShardingConfigError);
  });

  it('nomor shard di luar rentang ditolak, dan pesannya menyebut batasnya', () => {
    expect(() => parseShardList('4', 4)).toThrow(ShardingConfigError);
    expect(() => parseShardList('4', 4)).toThrow(/hanya punya shard 0 sampai 3/);
    expect(() => parseShardList('-1', 4)).toThrow(ShardingConfigError);
  });

  it('shard tunggal tetap valid saat total shard satu', () => {
    expect(parseShardList('0', 1)).toEqual([0]);
  });
});

describe('shardingBlockReason', () => {
  it('satu shard selalu boleh: tanpa proses kedua, store per proses sama saja', () => {
    expect(shardingBlockReason({ maxShards: 1, shardList: null, driver: 'memory' })).toBeNull();
  });

  it('beberapa shard tanpa Redis ditolak, dan pesan menyebut driver yang dipakai', () => {
    const reason = shardingBlockReason(inputs({ driver: 'memory' }));

    expect(reason).not.toBeNull();
    expect(reason).toContain('Redis');
    expect(reason).toContain('memory');
    expect(reason).toContain('DISCORD_MAX_SHARDS=4');
  });

  it('Redis hidup tapi shard tidak dibagi ditolak, karena tiap proses akan menyambung semuanya', () => {
    const reason = shardingBlockReason(inputs({ shardList: null }));

    expect(reason).not.toBeNull();
    expect(reason).toContain('DISCORD_SHARD_LIST');
  });

  it('kekurangan Redis disebut lebih dulu, karena itu yang paling merusak state', () => {
    const memory = shardingBlockReason(inputs({ shardList: null, driver: 'memory' }));
    const redis = shardingBlockReason(inputs({ shardList: null, driver: 'redis' }));

    expect(memory).toContain('Redis');
    expect(redis).not.toContain('Redis yang hidup');
  });

  it('konfigurasi yang benar tidak diblokir', () => {
    expect(shardingBlockReason(inputs())).toBeNull();
  });
});

describe('assertShardingReady', () => {
  it('melempar ShardingConfigError, yang pesannya terbaca tanpa stack trace', () => {
    try {
      assertShardingReady(inputs({ driver: 'memory' }));
      expect.unreachable('harus melempar');
    } catch (error) {
      const failure = error as ShardingConfigError;
      expect(failure).toBeInstanceOf(ShardingConfigError);
      expect(failure.name).toBe('ShardingConfigError');
      expect(failure.message).toContain('Redis');
    }
  });

  it('tidak melempar saat konfigurasi boleh dipakai', () => {
    expect(() => assertShardingReady(inputs())).not.toThrow();
  });
});

describe('resolveShardPlan', () => {
  it('satu shard tidak menghasilkan opsi apa pun, jadi jalur gateway tunggal tetap utuh', () => {
    expect(resolveShardPlan({ maxShards: 1, shardList: null })).toBeNull();
    expect(resolveShardPlan({ maxShards: 1, shardList: [0] })).toBeNull();
  });

  it('hanya shard milik proses ini, tapi totalnya diteruskan apa adanya', () => {
    expect(resolveShardPlan({ maxShards: 4, shardList: [0, 2] })).toEqual({
      total: 4,
      ids: [0, 2],
    });
  });

  it('daftar yang belum diisi tidak diarang jadi daftar lengkap, karena gerbang akan menolaknya', () => {
    // Kalau di sini dikembalikan [0, 1, 2, 3], klien punya rencana yang tidak
    // pernah boleh dipakai, dan alasan penolakan hilang di antara dua fungsi.
    expect(resolveShardPlan({ maxShards: 4, shardList: null })).toBeNull();
  });

  it('satu proses memegang semuanya harus dinyatakan, bukan terjadi sebagai bawaan', () => {
    // Menyatakan eksplisit itu sah: yang ditolak adalah ketidaktahuan, bukan
    // pilihan memakai satu proses.
    const declared = [0, 1, 2, 3];

    expect(resolveShardPlan({ maxShards: 4, shardList: declared })?.ids).toEqual(declared);
    expect(shardingBlockReason(inputs({ shardList: declared }))).toBeNull();
  });

  it('dua proses yang membagi shard menutup semua guild tanpa tumpang tindih', () => {
    // Sifat yang benar-benar penting: tidak ada guild yang gelap karena
    // shard-nya dilewati, dan tidak ada guild yang dilayani dua proses.
    const first = resolveShardPlan({ maxShards: 4, shardList: [0, 1] });
    const second = resolveShardPlan({ maxShards: 4, shardList: [2, 3] });
    const covered = [...(first?.ids ?? []), ...(second?.ids ?? [])];

    expect(covered).toHaveLength(4);
    expect(new Set(covered).size).toBe(4);
    expect([...covered].sort((a, b) => a - b)).toEqual([0, 1, 2, 3]);
    expect(shardingBlockReason(inputs({ shardList: first?.ids ?? null }))).toBeNull();
    expect(shardingBlockReason(inputs({ shardList: second?.ids ?? null }))).toBeNull();
  });
});

describe('konfigurasi sharding lewat env', () => {
  it('default-nya satu shard dan tanpa daftar, jadi tidak ada yang berubah tanpa diminta', () => {
    const env = parseEnv(REQUIRED_ENV);

    expect(env.DISCORD_MAX_SHARDS).toBe(1);
    expect(env.DISCORD_SHARD_LIST).toBeUndefined();
    expect(shardingBlockReason({ maxShards: env.DISCORD_MAX_SHARDS, shardList: null, driver: 'redis' })).toBeNull();
  });

  it('daftar shard dibaca sebagai teks apa adanya, termasuk spasi', () => {
    expect(parseEnv({ ...REQUIRED_ENV, DISCORD_SHARD_LIST: '0, 2' }).DISCORD_SHARD_LIST).toBe('0, 2');
  });

  it('daftar yang hanya berisi spasi dianggap belum diisi, bukan daftar kosong', () => {
    expect(parseEnv({ ...REQUIRED_ENV, DISCORD_SHARD_LIST: '   ' }).DISCORD_SHARD_LIST).toBeUndefined();
  });

  it('jumlah shard wajib bilangan bulat di bawah seribu', () => {
    expect(() => parseEnv({ ...REQUIRED_ENV, DISCORD_MAX_SHARDS: '0' })).toThrow();
    expect(() => parseEnv({ ...REQUIRED_ENV, DISCORD_MAX_SHARDS: '1.5' })).toThrow();
    expect(() => parseEnv({ ...REQUIRED_ENV, DISCORD_MAX_SHARDS: '1001' })).toThrow();
  });
});

describe('BotClient meneruskan shard milik proses ini', () => {
  const source = readFileSync(
    fileURLToPath(new URL('../src/client.ts', import.meta.url)),
    'utf8',
  );

  it('opsi shards tidak pernah diisi angka alone, karena itu menyambungkan semuanya', () => {
    // `shards: 4` membuat discord.js menjalankan shard 0 sampai 3 di dalam satu
    // proses; yang benar untuk model banyak proses di sini adalah daftar id.
    expect(source).not.toMatch(/shards:\s*[^,\n}]*\benv\.DISCORD_MAX_SHARDS\b/);
    expect(source).toMatch(/shards:\s*plan\.ids/);
  });

  it('shardCount ikut diteruskan, kalau tidak guild bergeser ke shard yang mati', () => {
    expect(source).toMatch(/shardCount:\s*plan\.total/);
  });
});