import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryKeyValueStore, type KeyValueStore } from '@bot/services/kvStore.js';
import type { GuildConfig } from '@bot/modules/config/types.js';
import type { SessionPayload } from '@/lib/session.js';
import type { ConfigWriteDeps, WriteResult } from '@/lib/configWrite.js';
import type { DashboardEnv } from '@/lib/env.js';
import { readDashboardMetrics } from '@/lib/metrics.js';
import { GET, PATCH } from '@/app/api/config/route.js';

/**
 * Penjaga kabel metrik di route handler (PRD §4.5).
 *
 * `lib/metrics.ts` sendiri sudah diuji satu per satu di
 * `metrics.test.ts`. Yang diuji di sini adalah rute
 * `PATCH /api/config` benar-benar mencolokkan meter ke kedua
 * jalurnya: setiap penulisan berhasil, dan setiap penolakan —
 * termasuk penolakan origin, yang ditolak sebelum
 * `applyConfigPatch` pernah dipanggil.
 *
 * Semua kolaborator rute di-mock supaya tes hanya mengukur
 * kabelnya, bukan pipa tulisnya: pipa itu punya
 * `configWriteSecurity.test.ts` (33 tes).
 */

const harness = vi.hoisted(() => ({
  store: null as unknown as KeyValueStore,
  session: null as SessionPayload | null,
  writeResult: null as unknown as WriteResult,
  applyConfigPatchCalls: 0,
}));

const env = vi.hoisted(() => ({
  value: {
    NODE_ENV: 'test',
    DISCORD_TOKEN: 'x'.repeat(24),
    DISCORD_CLIENT_ID: '100000000000000001',
    OAUTH_CLIENT_SECRET: 'oauth-secret',
    DASHBOARD_URL: 'http://localhost:3000',
    DASHBOARD_PORT: 3000,
    DASHBOARD_SECRET: 's'.repeat(40),
    DATABASE_URL: 'postgres://localhost/harmony',
    REDIS_URL: 'redis://localhost:6379',
    DASHBOARD_DEV_FAKE_SESSION: 'false',
    oauthClientId: '100000000000000001',
  } as unknown as DashboardEnv,
}));

vi.mock('@/lib/env.js', () => ({
  getEnv: () => env.value,
  resetEnvCache: () => {},
}));

vi.mock('@/lib/sessionRoute.js', () => ({
  readSessionOrDev: async () => harness.session,
}));

vi.mock('@/lib/serverDeps.js', () => ({
  getStore: () => harness.store,
  configWriteDeps: () => ({}) as ConfigWriteDeps,
  readGuildConfig: async () => ({ locale: 'id' }) as GuildConfig,
}));

vi.mock('@/lib/discord.js', () => ({
  botPermissionDeps: () => ({}),
}));

vi.mock('@/lib/permissions.js', () => ({
  checkManageGuild: async () => 'allowed' as const,
}));

vi.mock('@/lib/configWrite.js', () => ({
  applyConfigPatch: async () => {
    harness.applyConfigPatchCalls += 1;
    return harness.writeResult;
  },
}));

/** PATCH dengan body JSON yang valid, dengan origin opsional. */
function patchRequest(origin?: string): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (origin) headers.origin = origin;

  return new Request('http://localhost:3000/api/config', {
    method: 'PATCH',
    headers,
    body: '{"defaultVolume":40}',
  });
}

const success: WriteResult = {
  ok: true,
  config: {} as GuildConfig,
  changes: [],
  invalidated: true,
  auditRecorded: true,
};

beforeEach(() => {
  harness.store = new MemoryKeyValueStore();
  harness.session = {
    userId: '100000000000000002',
    accessToken: 'dev-token',
    expiresAt: Date.now() + 60_000,
    selectedGuildId: '100000000000000003',
  };
  harness.applyConfigPatchCalls = 0;
});

describe('kabel metrik di PATCH /api/config', () => {
  it('penulisan berhasil menaikkan penghitung writes', async () => {
    harness.writeResult = success;

    const response = await PATCH(patchRequest());

    expect(response.status).toBe(200);
    expect(await readDashboardMetrics(harness.store)).toEqual({
      writesTotal: 1,
      writeDeniedTotal: 0,
    });
  });

  it('penolakan dari jalur tulis menaikkan penghitung denied', async () => {
    harness.writeResult = {
      ok: false,
      reason: 'rate-limited',
      issues: [],
      retryAfterSeconds: 30,
    };

    const response = await PATCH(patchRequest());

    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('30');
    expect(await readDashboardMetrics(harness.store)).toEqual({
      writesTotal: 0,
      writeDeniedTotal: 1,
    });
  });

  it('origin asing menaikkan penolakan tanpa pernah menyentuh jalur tulis', async () => {
    // `evil.example` tidak cocok dengan DASHBOARD_URL, tidak cocok
    // dengan asal permintaan, dan tidak punya header Host yang cocok.
    const response = await PATCH(patchRequest('https://evil.example'));

    expect(response.status).toBe(403);
    expect(harness.applyConfigPatchCalls).toBe(0);
    expect(await readDashboardMetrics(harness.store)).toEqual({
      writesTotal: 0,
      writeDeniedTotal: 1,
    });
  });

  it('sesi hilang tidak menaikkan penghitung mana pun', async () => {
    harness.session = null;

    const response = await PATCH(patchRequest());

    expect(response.status).toBe(401);
    expect(await readDashboardMetrics(harness.store)).toEqual({
      writesTotal: 0,
      writeDeniedTotal: 0,
    });
  });
});

describe('kabel metrik di GET /api/config', () => {
  it('pembacaan tidak pernah menaikkan penghitung penulisan', async () => {
    harness.writeResult = success;

    const response = await GET(
      new Request('http://localhost:3000/api/config?guildId=100000000000000003'),
    );

    expect(response.status).toBe(200);
    expect(await readDashboardMetrics(harness.store)).toEqual({
      writesTotal: 0,
      writeDeniedTotal: 0,
    });
  });
});
