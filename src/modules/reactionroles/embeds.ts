import {
  ActionRowBuilder,
  EmbedBuilder,
  StringSelectMenuBuilder,
  type MessageActionRowComponentBuilder,
} from 'discord.js';
import { EMBED_COLORS } from '../../config/constants.js';
import {
  MAX_OPTION_DESCRIPTION_LENGTH,
  MAX_OPTION_LABEL_LENGTH,
  roleOptionCustomId,
  type ReactionRoleOption,
  type ReactionRolePanel,
} from './types.js';

const PLACEHOLDER = 'Pilih role yang ingin kamu ambil';

/** Nama role yang tampil di select menu, dipotong ke batas Discord. */
export function optionLabel(option: ReactionRoleOption, roleName: string): string {
  const raw = option.label?.trim() || roleName;
  return truncate(raw, MAX_OPTION_LABEL_LENGTH);
}

/**
 * Embed pesan panel: daftar role yang bisa diambil & cara melepasnya.
 *
 * Menekankan aturan "pilih lagi untuk melepas" karena select menu tidak punya
 * tampilan centang — tanpa penjelasan itu user akan mengira tidak terjadi apa-apa.
 */
export function panelEmbed(
  panel: ReactionRolePanel,
  roleNames: ReadonlyMap<string, string>,
  description?: string | null,
): EmbedBuilder {
  const lifetime = panelLifetimeFooter(panel);
  const lines = panel.options.map((option) => {
    const roleName = roleNames.get(option.roleId) ?? 'Role tidak ditemukan';
    const shown = optionLabel(option, roleName);
    const icon = option.emoji ? `${option.emoji} ` : '';

    return option.description
      ? `${icon}**${shown}** — ${truncate(option.description, MAX_OPTION_DESCRIPTION_LENGTH)}`
      : `${icon}**${shown}**`;
  });

  const intro =
    description?.trim() ||
    'Pilih role di bawah untuk mengambilnya. Pilih role yang sama lagi untuk melepaskannya.';

  return new EmbedBuilder()
    .setColor(EMBED_COLORS.primary)
    .setTitle('🎭 Ambil Role Sendiri')
    .setDescription(
      `${intro}\n\n${lines.join('\n')}` +
        '\n\n*Role yang tidak bisa kamu ambil sendiri? Minta ke moderator server.*',
    )
    .setFooter({ text: `Panel #${panel.id} · ${panel.options.length} role tersedia · ${lifetime}` })
    .setTimestamp();
}

/**
 * Embed panel yang sudah lewat masa hidup.
 *
 * Pesan **tidak dihapus** — jejaknya dibiarkan supaya member yang masih
 * menyimpan tautan ke panel lama punya penjelasan, dan admin bisa mengaudit
 * panel mana yang sudah ditutup. Select menu-nya yang dilepas.
 */
export function panelClosedEmbed(panel: ReactionRolePanel, reason: string): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(EMBED_COLORS.warning)
    .setTitle('🎭 Panel Ini Sudah Ditutup')
    .setDescription(
      `Panel **#${panel.id}** sudah tidak bisa dipakai untuk mengambil role.\n\n${reason}\n\n` +
        'Minta moderator server kalau kamu masih butuh role ini.',
    )
    .setFooter({ text: 'Panel · select menu sudah dilepas' })
    .setTimestamp();
}

/** "permanen" atau "aktif sampai <t:…:R>" — timestamp Discord ikut zona waktu member. */
function panelLifetimeFooter(panel: ReactionRolePanel): string {
  if (!panel.expiresAt) return 'tanpa masa hidup';
  if (panel.closedAt) return 'sudah ditutup';

  const unix = Math.floor(panel.expiresAt.getTime() / 1_000);

  return `aktif sampai <t:${unix}:R>`;
}

/**
 * Baris select menu untuk panel.
 *
 * Label opsi memakai nama role asli sebagai cadangan supaya member melihat nama
 * yang mereka kenal, bukan `role-123456`.
 */
export function buildRoleSelect(
  panel: ReactionRolePanel,
  roleNames: ReadonlyMap<string, string>,
): ActionRowBuilder<MessageActionRowComponentBuilder> | null {
  if (panel.options.length === 0) return null;

  const options = panel.options.map((option) => {
    const roleName = roleNames.get(option.roleId) ?? 'Role tidak ditemukan';

    return {
      label: optionLabel(option, roleName),
      value: String(option.id),
      ...(option.description
        ? { description: truncate(option.description, MAX_OPTION_DESCRIPTION_LENGTH) }
        : {}),
      ...(option.emoji ? { emoji: option.emoji } : {}),
    };
  });

  const menu = new StringSelectMenuBuilder()
    .setCustomId(`rr-panel-${panel.id}`)
    .setPlaceholder(PLACEHOLDER)
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(options);

  return new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(menu);
}

/**
 * Komponen yang dikirim bersama pesan panel.
 *
 * Panel tanpa opsi menghasilkan array kosong — string select menu Discord
 * mewajibkan minimal satu opsi, dan panel kosong memang kondisi tak valid
 * (dicegah saat create & remove).
 */
export function buildPanelComponents(
  panel: ReactionRolePanel,
  roleNames: ReadonlyMap<string, string>,
): ActionRowBuilder<MessageActionRowComponentBuilder>[] {
  const select = buildRoleSelect(panel, roleNames);

  return select ? [select] : [];
}

/** Embed `/reactionrole list`. */
export function panelListEmbed(panels: readonly ReactionRolePanel[]): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(EMBED_COLORS.primary)
    .setTitle('🎭 Panel Reaction Role')
    .setTimestamp();

  if (panels.length === 0) {
    return embed.setDescription(
      'Belum ada panel. Buat dengan `/reactionrole post channel:#pengaturan roles:@Pemain,@Penggemar`.',
    );
  }

  const lines = panels.map((panel) => {
    const roles = panel.options
      .map((option) => `<@&${option.roleId}>`)
      .slice(0, 8)
      .join(', ');
    const more = panel.options.length > 8 ? `, +${panel.options.length - 8} lagi` : '';
    const state = panelStateLabel(panel);

    return `**#${panel.id}** · <#${panel.channelId}> · ${state} · ${panel.options.length} role\n${roles}${more}`;
  });

  return embed.setDescription(truncate(lines.join('\n\n'), 4_000));
}

/** Embed hasil satu aksi kecil (tambah/hapus role). */
export function panelUpdatedEmbed(
  panel: ReactionRolePanel,
  message: string,
): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(EMBED_COLORS.success)
    .setTitle('🎭 Panel Reaction Role Diperbarui')
    .setDescription(`${message}\n\nPanel **#${panel.id}** sekarang punya ${panel.options.length} role.`)
    .setTimestamp();
}

function truncate(value: string, max: number): string {
  const trimmed = value.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

/**
 * Status panel untuk `/reactionrole list`.
 *
 * Panel yang sudah lewat masa hidup tapi belum disapu tetap ditulis "⏳ habis
 * menunggu sapuan" — itu kondisi nyata yang bisa terjadi selama bot mati, dan
 * admin perlu tahu bedanya dari panel yang benar-benar sudah ditutup.
 */
function panelStateLabel(panel: ReactionRolePanel): string {
  if (panel.closedAt) return '⚫ sudah ditutup';
  if (panel.expiresAt && panel.expiresAt <= new Date()) return '⏳ habis, menunggu sapuan';
  if (panel.expiresAt) {
    return `🟢 aktif sampai <t:${Math.floor(panel.expiresAt.getTime() / 1_000)}:R>`;
  }
  if (!panel.messageId) return '🟡 pesan belum terkirim';

  return '🟢 aktif';
}

export { roleOptionCustomId };
