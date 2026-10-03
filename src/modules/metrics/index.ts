/**
 * Barrel modul metrik (PRD §11 "Observability").
 *
 * Yang dipakai di luar modul ini: `getMetricsRegistry()` untuk mencatat,
 * `renderMetrics()` untuk endpoint `/metrics`, dan `startMetricsProbe()` yang
 * dijadwalkan di dalam proses bot.
 */
export {
  getMetricsRegistry,
  initMetrics,
  resetMetrics,
  setMetricsRegistry,
} from './singleton.js';
export { MetricsRegistry } from './registry.js';
export { renderMetrics } from './format.js';
export type { MetricsContext } from './format.js';
export { DEFAULT_PROBE_INTERVAL_MS, startMetricsProbe } from './probe.js';
export type { MetricsProbe, MetricsProbeOptions } from './probe.js';
export type {
  InteractionCounters,
  InteractionKind,
  InteractionOutcome,
  LavalinkMetrics,
  MetricsSnapshot,
} from './types.js';