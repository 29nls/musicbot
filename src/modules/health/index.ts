/**
 * Barrel modul health check.
 *
 * Endpoint-nya sendiri (server HTTP) hanya dipakai dari entrypoint bot;
 * perintah dan tes memakai bagian murni (`report.ts`).
 */
export { startHealthServer } from './server.js';
export type { HealthServerHandle, HealthServerOptions } from './server.js';
export {
  buildHealthReport,
  healthPayload,
  livenessPayload,
} from './report.js';
export type { DependencyState, HealthInput, HealthReport, HealthStatus } from './report.js';