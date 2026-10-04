import { createServer, type ServerResponse } from 'node:http';
import { getLogger } from '../../services/logger.js';
import {
  renderFleetMetrics,
  renderMetrics,
  type FleetMetrics,
  type MetricsSnapshot,
} from '../metrics/index.js';
import { buildHealthReport, healthPayload, livenessPayload, type DependencyState } from './report.js';

/**
 * Server HTTP kecil untuk health check (PRD §5.1).
 *
 * Endpointnya tanpa autentikasi karena isinya bukan data sensitif dan hanya
 * berguna kalau bisa dipanggil tanpa ritual:
 *
 * - `GET /health` (liveness): proses bot hidup? Selalu 200 selama server
 *   menyala. Gunanya untuk "restart saja kalau gagal".
 * - `GET /ready` (readiness): semua dependency ada? 200 kalau siap, 503 kalau
 *   database mati atau gateway belum siap — gunanya untuk "tunggu, jangan restart".
 * - `GET /metrics` (metrik §11): angka proses dalam format teks Prometheus —
 *   jumlah guild, lagu diputar, error rate perintah, dan latensi Lavalink.
 *   Kalau agregat lintas shard tersedia, seri `harmony_fleet_*` ikut ditulis:
 *   itu angka satu bot, bukan angka satu shard.
 *
 * Endpoint lain menjawab 404 supaya port ini tidak jadi tempat mencari
 * endpoint yang tidak pernah ada.
 *
 * Ketiganya sengaja berbagi satu port: kebijakan membuka atau menutup endpoint cukup
 * diatur di satu tempat, bukan tiga.
 */

export interface HealthServerOptions {
  /** 0 = biarkan OS memilih port bebas (dipakai tes). */
  port: number;
  /** false = endpoint tidak dijalankan sama sekali (`HEALTH_PORT=0`). */
  enabled?: boolean;
  /** Kapan proses start (ms) — untuk menghitung uptime. */
  startedAt: number;
  gatewayReady: () => boolean;
  lavalinkConnected: () => boolean;
  guildCount: () => number;
  /** Pingan database; mengembalikan 'ok'/'down'. Tidak boleh melempar. */
  pingDatabase: () => Promise<DependencyState>;
  /** Snapshot metrik proses; kalau tidak diisi, /metrics menjawab 503. */
  metrics?: () => MetricsSnapshot;
  /**
   * Agregat metrik seluruh shard (PRD §13).
   *
   * Opsional dan **hanya tambahan**: kalau tidak diisi, atau kalau pembacaan
   * agregat gagal, /metrics tetap menjawab seri proses apa adanya. Seri proses
   * selalu benar untuk shard itu; agregat melengkapi satu angka bot, jadi
   * kegagalan gather tidak boleh menghapus angka yang sudah bisa dipercaya.
   * Yang hilang berarti pembaca tahu agregat tidak ada, bukan angka proses ikut
   * hilang bersamanya.
   */
  fleetMetrics?: () => Promise<FleetMetrics>;
  /** Timeout pemeriksaan database (ms) supaya /ready tidak menggantung. */
  databaseTimeoutMs?: number;
}

export interface HealthServerHandle {
  /** Port yang benar-benar dipakai (berguna saat port 0 = tentukan sendiri). */
  readonly port: number;
  close: () => Promise<void>;
}

const DEFAULT_DATABASE_TIMEOUT_MS = 3_000;

/**
 * Jalankan server health check.
 *
 * `enabled: false` mematikan endpoint sepenuhnya; `port: 0` membiarkan OS
 * memilih port (dipakai tes supaya tidak pernah bertabrakan dengan port lain).
 */
export function startHealthServer(options: HealthServerOptions): HealthServerHandle | null {
  if (options.enabled === false) return null;
  if (!Number.isInteger(options.port) || options.port < 0) return null;

  const logger = getLogger();
  const timeoutMs = options.databaseTimeoutMs ?? DEFAULT_DATABASE_TIMEOUT_MS;

  const server = createServer((request, response) => {
    const path = (request.url ?? '/').split('?')[0] ?? '/';

    // Liveness tidak boleh menyentuh dependency apa pun: kalau database sedang
    // lambat, endpoint ini harus tetap menjawab dalam hitungan milidetik.
    if (path === '/health') {
      const report = buildHealthReport({
        now: Date.now(),
        startedAt: options.startedAt,
        gatewayReady: false,
        lavalinkConnected: false,
        database: 'unchecked',
        guildCount: 0,
      });

      sendJson(response, 200, livenessPayload(report));
      return;
    }

    if (path === '/metrics') {
      void respondMetrics(options, response);
      return;
    }

    if (path === '/ready') {
      void respondReadiness(options, timeoutMs)
        .then(({ status, body }) => sendJson(response, status, body))
        .catch((error: unknown) => {
          logger.warn({ err: error }, 'Health check readiness gagal dihitung');
          sendJson(response, 503, { status: 'down', error: 'health check gagal' });
        });
      return;
    }

    sendJson(response, 404, { error: 'not found' });
  });

  server.listen(options.port);

  server.on('error', (error: unknown) => {
    // Health check gagal start tidak boleh mematikan bot: botnya masih berguna
    // di Discord, hanya monitoring yang ikut kehilangan endpoint.
    logger.error({ err: error, port: options.port }, 'Server health check gagal start');
  });

  server.on('listening', () => {
    logger.info({ port: options.port }, 'Health check aktif: /health dan /ready');
  });

  return {
    get port(): number {
      const address = server.address();
      return typeof address === 'object' && address !== null ? address.port : options.port;
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections?.();
      }),
  };
}

/**
 * Balas `/metrics` dalam format teks Prometheus.
 *
 * Endpoint ini untuk scraper, jadi tidak boleh diam-diam menjawab 200 dengan
 * isi kosong: kalau metrik tidak tersedia, ia menjawab 503 supaya kondisi
 * "metrik hilang" terlihat, bukan grafik yang terlihat datar lalu dianggap sehat.
 *
 * Seri proses dan seri fleet digabung dalam satu balasan, bukan dua endpoint.
 * Pemantau cukup menarik satu URL, dan memisahkan endpoint berarti ada yang bisa
 * terlupa diisi — jadi KPI §13 bisa kembali jadi angka satu shard tanpa ada yang
 * menyadarinya. Kegagalan pengumpulan agregat tidak menggagalkan balasan: yang
 * hilang hanya seri `harmony_fleet_*`, dan itu dicatat di log.
 */
async function respondMetrics(options: HealthServerOptions, response: ServerResponse): Promise<void> {
  if (!options.metrics) {
    sendJson(response, 503, { error: 'metrik tidak tersedia' });
    return;
  }

  try {
    let body = renderMetrics(options.metrics(), { guildCount: options.guildCount() });
    const fleet = await collectFleet(options.fleetMetrics);

    if (fleet) {
      body += renderFleetMetrics(fleet);
    }

    response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    response.end(body);
  } catch (error) {
    getLogger().warn({ err: error }, 'Metrik gagal disusun');
    sendJson(response, 503, { error: 'metrik gagal disusun' });
  }
}

/** Agregat fleet, atau `null` kalau tidak ada atau gagal dibaca. */
async function collectFleet(
  fleetMetrics: (() => Promise<FleetMetrics>) | undefined,
): Promise<FleetMetrics | null> {
  if (!fleetMetrics) return null;

  try {
    return await fleetMetrics();
  } catch (error) {
    getLogger().warn({ err: error }, 'Agregat metrik lintas shard gagal dikumpulkan');
    return null;
  }
}

async function respondReadiness(
  options: HealthServerOptions,
  timeoutMs: number,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const database = await pingWithTimeout(options.pingDatabase, timeoutMs);

  const report = buildHealthReport({
    now: Date.now(),
    startedAt: options.startedAt,
    gatewayReady: options.gatewayReady(),
    lavalinkConnected: options.lavalinkConnected(),
    database,
    guildCount: options.guildCount(),
  });

  return { status: report.httpStatus, body: healthPayload(report, options.metrics?.()) };
}

/** Pingan database dibatasi waktunya; probe yang menggantung = 'down'. */
async function pingWithTimeout(
  ping: () => Promise<DependencyState>,
  timeoutMs: number,
): Promise<DependencyState> {
  let timer: NodeJS.Timeout | undefined;

  try {
    const result = await Promise.race([
      ping(),
      new Promise<DependencyState>((resolve) => {
        timer = setTimeout(() => resolve('down'), timeoutMs);
        timer.unref?.();
      }),
    ]);

    return result;
  } catch {
    return 'down';
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function sendJson(
  response: ServerResponse,
  status: number,
  body: Record<string, unknown>,
): void {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
  });
  response.end(payload);
}