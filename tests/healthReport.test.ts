import { afterAll, describe, expect, it } from 'vitest';
import {
  buildHealthReport,
  healthPayload,
  livenessPayload,
  startHealthServer,
  type DependencyState,
  type HealthServerHandle,
} from '../src/modules/health/index.js';

const STARTED_AT = 1_700_000_000_000;

function input(overrides: Partial<Parameters<typeof buildHealthReport>[0]> = {}) {
  return {
    now: STARTED_AT + 90_000,
    startedAt: STARTED_AT,
    gatewayReady: true,
    lavalinkConnected: true,
    database: 'ok' as DependencyState,
    guildCount: 12,
    ...overrides,
  };
}

describe('buildHealthReport', () => {
  it('sehat saat semua dependency siap', () => {
    const report = buildHealthReport(input());

    expect(report.status).toBe('ok');
    expect(report.httpStatus).toBe(200);
    expect(report.uptimeSeconds).toBe(90);
    expect(report.guildCount).toBe(12);
    expect(report.checks).toEqual({ gateway: true, lavalink: true, database: 'ok' });
  });

  it('database mati = down, karena hampir semua perintah membacanya', () => {
    const report = buildHealthReport(input({ database: 'down' }));

    expect(report.status).toBe('down');
    expect(report.httpStatus).toBe(503);
  });

  it('Lavalink putus hanya degraded: moderasi & tiket tetap jalan', () => {
    const report = buildHealthReport(input({ lavalinkConnected: false }));

    expect(report.status).toBe('degraded');
    expect(report.checks.lavalink).toBe(false);
  });

  it('gateway belum siap = degraded', () => {
    expect(buildHealthReport(input({ gatewayReady: false })).status).toBe('degraded');
  });

  it('database yang belum dicek tidak pernah dilaporkan sehat', () => {
    // Melaporkan "ok" sebelum tahu apa pun sama dengan melapor yang salah.
    expect(buildHealthReport(input({ database: 'unchecked' })).status).toBe('degraded');
  });

  it('uptime tidak pernah negatif walau jam meleset', () => {
    expect(buildHealthReport(input({ now: STARTED_AT - 5_000 })).uptimeSeconds).toBe(0);
  });

  it('payload JSON punya bentuk yang stabil', () => {
    expect(healthPayload(buildHealthReport(input()))).toEqual({
      status: 'ok',
      uptimeSeconds: 90,
      guildCount: 12,
      checks: { gateway: true, lavalink: true, database: 'ok' },
    });

    expect(livenessPayload(buildHealthReport(input({ database: 'down' })))).toEqual({
      status: 'ok',
      uptimeSeconds: 90,
    });
  });
});

describe('endpoint health check', () => {
  let handle: HealthServerHandle | null = null;
  let database: DependencyState = 'ok';

  const base = (): string => `http://127.0.0.1:${handle?.port ?? 0}`;

  afterAll(async () => {
    await handle?.close();
  });

  async function start(overrides: { gatewayReady?: boolean; lavalink?: boolean } = {}) {
    handle = startHealthServer({
      // 0 = biarkan OS memilih port bebas, supaya tes tidak bertabrakan.
      port: 0,
      startedAt: STARTED_AT,
      gatewayReady: () => overrides.gatewayReady ?? true,
      lavalinkConnected: () => overrides.lavalink ?? true,
      guildCount: () => 3,
      pingDatabase: async () => database,
    });

    // Tunggu sampai server benar-benar listen.
    await new Promise((resolve) => setTimeout(resolve, 50));
    return handle;
  }

  it('/health menjawab 200 walau semua dependency mati', async () => {
    database = 'down';
    await start({ gatewayReady: false, lavalink: false });

    const response = await fetch(`${base()}/health`);
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body.status).toBe('ok');
  });

  it('/ready menjawab 503 saat database mati, dengan rinciannya', async () => {
    database = 'down';
    await start();

    const response = await fetch(`${base()}/ready`);
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(503);
    expect(body.status).toBe('down');
    expect((body.checks as Record<string, unknown>).database).toBe('down');
  });

  it('/ready menjawab 200 saat semuanya siap', async () => {
    database = 'ok';
    await start();

    const response = await fetch(`${base()}/ready`);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/json');
  });

  it('endpoint lain menjawab 404, bukan halaman kosong', async () => {
    await start();

    const response = await fetch(`${base()}/rahasia`);

    expect(response.status).toBe(404);
  });

  it('ping database yang menggantung tidak menahan /ready selamanya', async () => {
    database = 'ok';
    const hanging = startHealthServer({
      port: 0,
      startedAt: STARTED_AT,
      gatewayReady: () => true,
      lavalinkConnected: () => true,
      guildCount: () => 0,
      pingDatabase: () => new Promise<DependencyState>(() => undefined),
      databaseTimeoutMs: 100,
    });
    handle = hanging;
    await new Promise((resolve) => setTimeout(resolve, 50));

    const response = await fetch(`http://127.0.0.1:${hanging?.port ?? 0}/ready`);

    expect(response.status).toBe(503);
  });

  it('ping yang melempar dianggap down, bukan error server', async () => {
    const failing = startHealthServer({
      port: 0,
      startedAt: STARTED_AT,
      gatewayReady: () => true,
      lavalinkConnected: () => true,
      guildCount: () => 0,
      pingDatabase: () => Promise.reject(new Error('connection refused')),
    });
    handle = failing;
    await new Promise((resolve) => setTimeout(resolve, 50));

    const response = await fetch(`http://127.0.0.1:${failing?.port ?? 0}/ready`);

    expect(response.status).toBe(503);
  });

  it('enabled:false mematikan endpoint sepenuhnya', () => {
    // `HEALTH_PORT=0` berarti "jangan jalankan"; bukan "pakai port sembarang".
    expect(
      startHealthServer({
        port: 8080,
        enabled: false,
        startedAt: STARTED_AT,
        gatewayReady: () => true,
        lavalinkConnected: () => true,
        guildCount: () => 0,
        pingDatabase: async () => 'ok',
      }),
    ).toBeNull();
  });
});