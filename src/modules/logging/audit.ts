import type { AuditLogEvent, Guild, GuildAuditLogsEntry } from 'discord.js';
import { getLogger } from '../../services/logger.js';

export interface AuditLookupOptions {
  /** Cocokkan targetId entri (mis. ID member yang di-kick). */
  targetId?: string;
  /** Umur maksimum entri agar tidak mengambil aksi lama yang kebetulan sama. */
  maxAgeMs?: number;
}

/**
 * Cari entri audit log terbaru untuk satu jenis aksi.
 *
 * Bisa gagal (bot tidak punya View Audit Log, audit log kosong, dsb.) — dalam
 * kasus itu log tetap dikirim tanpa kolom executor.
 */
export async function findAuditEntry(
  guild: Guild,
  type: AuditLogEvent,
  options: AuditLookupOptions = {},
): Promise<GuildAuditLogsEntry | null> {
  try {
    const logs = await guild.fetchAuditLogs({ type, limit: 5 });
    const maxAge = options.maxAgeMs ?? 15_000;
    const now = Date.now();

    for (const entry of logs.entries.values()) {
      // Entri diurutkan terbaru dulu: begitu sudah terlalu tua, sisanya pasti tua.
      if (now - entry.createdTimestamp > maxAge) break;
      if (options.targetId && entry.targetId !== options.targetId) continue;
      return entry;
    }

    return null;
  } catch (error) {
    getLogger().debug(
      { err: error, guild: guild.id, auditType: type },
      'Audit log tidak bisa dibaca (butuh izin View Audit Log)',
    );
    return null;
  }
}
