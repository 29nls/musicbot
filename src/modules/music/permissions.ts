export interface MusicPermissionInput {
  /** Role DJ dari konfigurasi server. */
  djRoleId: string | null;
  /** ID role milik user yang memanggil perintah. */
  memberRoleIds: readonly string[];
  /** User punya izin Manage Server? */
  canManageGuild: boolean;
}

/**
 * Siapa yang boleh mengontrol musik.
 *
 * - Manage Server selalu boleh (biar admin tidak terkunci).
 * - Server yang belum mengatur role DJ: semua orang boleh — server baru tetap
 *   bisa memakai musik tanpa setup dulu.
 * - Server yang sudah mengatur role DJ: hanya pemilik role itu.
 */
export function canControlMusic({
  djRoleId,
  memberRoleIds,
  canManageGuild,
}: MusicPermissionInput): boolean {
  if (canManageGuild) return true;
  if (!djRoleId) return true;

  return memberRoleIds.includes(djRoleId);
}

/**
 * User harus berada di channel voice yang sama dengan bot.
 * Kalau bot belum masuk voice channel mana pun, siapa pun boleh memulai.
 */
export function isInSameVoiceChannel(
  memberChannelId: string | null,
  botChannelId: string | null | undefined,
  canManageGuild: boolean,
): boolean {
  if (canManageGuild) return true;
  if (!botChannelId) return true;

  return memberChannelId === botChannelId;
}

/** Volume dari konfigurasi server, dibatasi rentang yang diterima Discord. */
export function clampVolume(volume: number, max = 200): number {
  if (!Number.isFinite(volume)) return 100;

  return Math.min(Math.max(Math.trunc(volume), 0), max);
}
