import { describe, expect, it } from 'vitest';
import { EnvError, parseEnv } from '../src/config/env.js';

const validEnv = {
  NODE_ENV: 'test',
  DISCORD_TOKEN: 'a'.repeat(60),
  DISCORD_CLIENT_ID: '123456789012345678',
  DATABASE_URL: 'postgresql://harmony:pass@localhost:5432/harmony',
  REDIS_URL: 'redis://localhost:6379',
  LAVALINK_PASSWORD: 'rahasia',
};

describe('parseEnv', () => {
  it('mengisi default untuk variabel opsional', () => {
    const env = parseEnv(validEnv);

    expect(env.LOG_LEVEL).toBe('info');
    expect(env.LAVALINK_HOST).toBe('localhost');
    expect(env.LAVALINK_PORT).toBe(2333);
    expect(env.DEFAULT_VOLUME).toBe(100);
    expect(env.MAX_QUEUE_SIZE).toBe(500);
    expect(env.DEV_GUILD_ID).toBeUndefined();
    expect(env.LAVALINK_NODES).toBeUndefined();
  });

  it('membaca daftar node Lavalink sebagai teks apa adanya', () => {
    const env = parseEnv({ ...validEnv, LAVALINK_NODES: 'lava-a:2333, lava-b:4040' });

    expect(env.LAVALINK_NODES).toBe('lava-a:2333, lava-b:4040');
  });

  it('menganggap LAVALINK_NODES kosong sebagai undefined, bukan daftar kosong', () => {
    const env = parseEnv({ ...validEnv, LAVALINK_NODES: '   ' });

    expect(env.LAVALINK_NODES).toBeUndefined();
  });

  it('tidak memaksa LAVALINK_NODES ada, jadi konfigurasi lama tetap berlaku', () => {
    const env = parseEnv(validEnv);

    expect(env.LAVALINK_HOST).toBe('localhost');
    expect(env.LAVALINK_PORT).toBe(2333);
  });

  it('mengubah string angka menjadi number', () => {
    const env = parseEnv({ ...validEnv, LAVALINK_PORT: '4040', MAX_QUEUE_SIZE: '250' });

    expect(env.LAVALINK_PORT).toBe(4040);
    expect(env.MAX_QUEUE_SIZE).toBe(250);
  });

  it('menganggap DEV_GUILD_ID kosong sebagai undefined (bukan error)', () => {
    const env = parseEnv({ ...validEnv, DEV_GUILD_ID: '' });

    expect(env.DEV_GUILD_ID).toBeUndefined();
  });

  it('menolak token yang hilang dengan pesan yang menyebut nama variabel', () => {
    const { DISCORD_TOKEN: _token, ...withoutToken } = validEnv;

    expect(() => parseEnv(withoutToken)).toThrowError(EnvError);
    expect(() => parseEnv(withoutToken)).toThrowError(/DISCORD_TOKEN/);
  });

  it('menolak DISCORD_CLIENT_ID yang bukan snowflake', () => {
    expect(() => parseEnv({ ...validEnv, DISCORD_CLIENT_ID: 'bukan-angka' })).toThrowError(/DISCORD_CLIENT_ID/);
  });

  it('menolak volume di luar rentang 0–200', () => {
    expect(() => parseEnv({ ...validEnv, DEFAULT_VOLUME: '500' })).toThrowError(/DEFAULT_VOLUME/);
  });

  it('menolak LOG_LEVEL yang tidak dikenal', () => {
    expect(() => parseEnv({ ...validEnv, LOG_LEVEL: 'verbose' })).toThrowError(/LOG_LEVEL/);
  });
});
