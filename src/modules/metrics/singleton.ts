import { MetricsRegistry } from './registry.js';

/**
 * Registry metrik untuk proses ini.
 *
 * Satu registry dipakai seluruh proses: kalau setiap modul punya penghitungnya
 * sendiri, `/metrics` hanya bisa menampilkan satu sudut dan totalnya tidak akan
 * sama dengan yang dilihat orang di log.
 *
 * `initMetrics()` dipanggil sekali di startup supaya `startedAt` sama dengan
 * yang dipakai health check. Tanpa itu, registry dibuat malas saat metrik
 * pertama dibutuhkan dan uptime-nya akan terukur sejak saat itu — angka yang
 * terlihat benar padahal salah.
 */
let registry: MetricsRegistry | undefined;

export function initMetrics(startedAt: number): void {
  registry ??= new MetricsRegistry({ startedAt });
}

export function getMetricsRegistry(): MetricsRegistry {
  registry ??= new MetricsRegistry();
  return registry;
}

/** Ganti registry (dipakai tes supaya state proses tidak bocor antar file). */
export function setMetricsRegistry(next: MetricsRegistry): void {
  registry = next;
}

export function resetMetrics(): void {
  registry = undefined;
}