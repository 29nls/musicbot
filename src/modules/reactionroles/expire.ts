import type { Guild } from 'discord.js';
import { getLogger } from '../../services/logger.js';
import { defaultTranslator, type MessageKey, type Translator } from '../i18n/index.js';
import { isGuildTextChannel } from '../../utils/discord.js';
import { panelClosedEmbed } from './embeds.js';
import type { ReactionRolePanel } from './types.js';

/**
 * Alasan panel ditutup — ditulis apa adanya di embed, jadi tidak boleh berisi
 * detail internal.
 */
export type PanelCloseReason = 'expired' | 'manual';

/**
 * Cukup yang dibutuhkan `closePanel` — interface tipis supaya penyapuan
 * otomatis dan tes bisa memakai apa saja yang punya `markClosed`.
 */
export interface PanelCloser {
  markClosed(guildId: string, panelId: number, now?: Date): Promise<ReactionRolePanel | null>;
}

/** Hasil menonaktifkan satu panel: apa yang sebenarnya berhasil. */
export interface ClosePanelOutcome {
  panel: ReactionRolePanel;
  /** false kalau panel sudah ditutup sebelumnya — bukan kegagalan. */
  changed: boolean;
  /** false kalau pesan tidak bisa diedit (dihapus manual / channel hilang). */
  messageUpdated: boolean;
}

/**
 * Kunci alasan penutupan — kalimatnya disusun saat panel ditutup, mengikuti
 * bahasa server.
 */
const REASON_KEY: Record<PanelCloseReason, MessageKey> = {
  expired: 'rr.close.reason.expired',
  manual: 'rr.close.reason.manual',
};

/**
 * Nonaktifkan panel: lepas select menu dari pesannya dan tandai sudah tertutup.
 *
 * Satu jalur untuk penyapuan otomatis dan perintah `close` admin, supaya
 * keduanya tidak bisa berbeda — persis seperti penutupan tiket.
 *
 * Urutannya penting: **tandai dulu, edit kemudian**. Kalau bot mati di antara
 * keduanya, panel yang belum tersentuh akan disapu lagi pada sapuan
 * berikutnya (dan bisa diedit ulang), sedangkan menandai setelah edit berisiko
 * panel terlihat aktif selamanya tanpa ada yang memperbaikinya. Pesannya
 * sendiri tidak pernah dihapus supaya jejaknya tetap bisa dibaca admin.
 *
 * `service` disuntikkan supaya alurnya bisa diuji tanpa database.
 */
export async function closePanel(
  service: PanelCloser,
  guild: Guild,
  panel: ReactionRolePanel,
  reason: PanelCloseReason,
  now = new Date(),
  t: Translator = defaultTranslator,
): Promise<ClosePanelOutcome> {
  const marked = await service.markClosed(panel.guildId, panel.id, now);
  if (!marked) return { panel, changed: false, messageUpdated: false };

  const messageUpdated = await disablePanelMessage(
    guild,
    { ...panel, closedAt: now },
    reason,
    t,
  );

  return { panel: marked, changed: true, messageUpdated };
}

/**
 * Lepas select menu dari pesan panel dan ganti embed dengan pengumuman ditutup.
 *
 * Best-effort: pesan bisa sudah terhapus manual atau channel-nya dihapus, dan
 * itu bukan alasan menggagalkan sisanya.
 */
export async function disablePanelMessage(
  guild: Guild,
  panel: ReactionRolePanel,
  reason: PanelCloseReason,
  t: Translator = defaultTranslator,
): Promise<boolean> {
  if (!panel.messageId) return false;

  const channel = await guild.channels.fetch(panel.channelId).catch(() => null);
  if (!isGuildTextChannel(channel)) return false;

  const message = await channel.messages.fetch(panel.messageId).catch(() => null);
  if (!message) return false;

  try {
    // `components: []` adalah cara resmi melepas semua komponen dari pesan.
    await message.edit({
      embeds: [panelClosedEmbed(panel, t(REASON_KEY[reason]), t)],
      components: [],
    });

    return true;
  } catch (error) {
    getLogger().warn(
      { err: error, guild: guild.id, panelId: panel.id },
      'Gagal menonaktifkan pesan panel reaction role',
    );

    return false;
  }
}