import { GatewayIntentBits } from 'discord.js';
import { describe, expect, it } from 'vitest';
import { MINIMAL_MODE_DISABLED_FEATURES, resolveIntents } from '../src/client.js';
import { parseEnv } from '../src/config/env.js';

const REQUIRED_ENV = {
  DISCORD_TOKEN: 'a'.repeat(30),
  DISCORD_CLIENT_ID: '1107624713720709122',
  DATABASE_URL: 'postgresql://user:pass@db.example.supabase.co:5432/postgres',
  REDIS_URL: 'redis://localhost:6379',
  LAVALINK_PASSWORD: 'harmony_dev_password',
};

describe('resolveIntents', () => {
  it('mode penuh meminta dua privileged intent yang wajib diaktifkan di Portal', () => {
    const intents = resolveIntents(false);

    expect(intents).toContain(GatewayIntentBits.GuildMembers);
    expect(intents).toContain(GatewayIntentBits.MessageContent);
    // GuildMessages hanya perlu ikut kalau MessageContent ikut, dan ini yang
    // membuat logging pesan serta automod bekerja.
    expect(intents).toContain(GatewayIntentBits.GuildMessages);
  });

  it('mode minimal membuang semua privileged intent, karena itu alasan flagnya ada', () => {
    const intents = resolveIntents(true);

    expect(intents).not.toContain(GatewayIntentBits.GuildMembers);
    expect(intents).not.toContain(GatewayIntentBits.GuildMessages);
    expect(intents).not.toContain(GatewayIntentBits.MessageContent);
    // Perintah dasar harus tetap ada, kalau tidak bot tidak bisa apa-apa.
    expect(intents).toContain(GatewayIntentBits.Guilds);
    expect(intents).toContain(GatewayIntentBits.GuildVoiceStates);
  });

  it('mode minimal sedikitnya cuplikan dari mode penuh, dan tidak ada intent asing', () => {
    const full = resolveIntents(false);
    const minimal = resolveIntents(true);

    expect(minimal.every((intent) => full.includes(intent))).toBe(true);
    expect(minimal.length).toBeLessThan(full.length);
    expect(new Set(minimal).size).toBe(minimal.length);
  });

  it('fitur yang mati disebut apa adanya, bukan kode internal', () => {
    expect(MINIMAL_MODE_DISABLED_FEATURES).toContain('welcome');
    expect(MINIMAL_MODE_DISABLED_FEATURES).toContain('automod');
  });
});

describe('BOT_INTENTS_MINIMAL', () => {
  it('default-nya false, jadi perilaku bot tidak berubah tanpa diminta', () => {
    expect(parseEnv(REQUIRED_ENV).BOT_INTENTS_MINIMAL).toBe(false);
    expect(parseEnv({ ...REQUIRED_ENV, BOT_INTENTS_MINIMAL: '' }).BOT_INTENTS_MINIMAL).toBe(false);
  });

  it('hanya string "true" yang menyalakan mode minimal', () => {
    expect(parseEnv({ ...REQUIRED_ENV, BOT_INTENTS_MINIMAL: 'true' }).BOT_INTENTS_MINIMAL).toBe(true);
    expect(parseEnv({ ...REQUIRED_ENV, BOT_INTENTS_MINIMAL: 'false' }).BOT_INTENTS_MINIMAL).toBe(false);
  });

  it('nilai yang tidak dikenal ditolak, bukan dianggap benar diam-diam', () => {
    expect(() => parseEnv({ ...REQUIRED_ENV, BOT_INTENTS_MINIMAL: 'ya' })).toThrow();
  });
});