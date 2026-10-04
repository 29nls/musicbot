import {
  ActionRowBuilder,
  EmbedBuilder,
  StringSelectMenuBuilder,
  type MessageActionRowComponentBuilder,
} from 'discord.js';
import { EMBED_COLORS } from '../../config/constants.js';
import { defaultTranslator, type Translator } from '../i18n/index.js';
import {
  MAX_OPTION_DESCRIPTION_LENGTH,
  MAX_OPTION_LABEL_LENGTH,
  roleOptionCustomId,
  type ReactionRoleOption,
  type ReactionRolePanel,
} from './types.js';

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
  t: Translator = defaultTranslator,
): EmbedBuilder {
  const lifetime = panelLifetimeFooter(panel, t);
  const missingRole = t('rr.role.missing');
  const lines = panel.options.map((option) => {
    const roleName = roleNames.get(option.roleId) ?? missingRole;
    const shown = optionLabel(option, roleName);
    const icon = option.emoji ? `${option.emoji} ` : '';

    return option.description
      ? `${icon}**${shown}** — ${truncate(option.description, MAX_OPTION_DESCRIPTION_LENGTH)}`
      : `${icon}**${shown}**`;
  });

  const intro = description?.trim() || t('rr.panel.intro');

  return new EmbedBuilder()
    .setColor(EMBED_COLORS.primary)
    .setTitle(t('rr.panel.title'))
    .setDescription(`${intro}\n\n${lines.join('\n')}\n\n${t('rr.panel.roleHint')}`)
    .setFooter({
      text: t('rr.panel.footer', {
        id: String(panel.id),
        count: String(panel.options.length),
        lifetime,
      }),
    })
    .setTimestamp();
}

/**
 * Embed panel yang sudah lewat masa hidup.
 *
 * Pesan **tidak dihapus** — jejaknya dibiarkan supaya member yang masih
 * menyimpan tautan ke panel lama punya penjelasan, dan admin bisa mengaudit
 * panel mana yang sudah ditutup. Select menu-nya yang dilepas.
 */
export function panelClosedEmbed(
  panel: ReactionRolePanel,
  reason: string,
  t: Translator = defaultTranslator,
): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(EMBED_COLORS.warning)
    .setTitle(t('rr.closed.title'))
    .setDescription(
      t('rr.closed.description', { id: String(panel.id), reason }),
    )
    .setFooter({ text: t('rr.closed.footer') })
    .setTimestamp();
}

/** "permanen" atau "aktif sampai <t:…:R>" — timestamp Discord ikut zona waktu member. */
function panelLifetimeFooter(panel: ReactionRolePanel, t: Translator): string {
  if (!panel.expiresAt) return t('rr.lifetime.none');
  if (panel.closedAt) return t('rr.lifetime.closed');

  return t('rr.lifetime.until', { unix: String(Math.floor(panel.expiresAt.getTime() / 1_000)) });
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
  t: Translator = defaultTranslator,
): ActionRowBuilder<MessageActionRowComponentBuilder> | null {
  if (panel.options.length === 0) return null;

  const missingRole = t('rr.role.missing');
  const options = panel.options.map((option) => {
    const roleName = roleNames.get(option.roleId) ?? missingRole;

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
    .setPlaceholder(t('rr.select.placeholder'))
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
  t: Translator = defaultTranslator,
): ActionRowBuilder<MessageActionRowComponentBuilder>[] {
  const select = buildRoleSelect(panel, roleNames, t);

  return select ? [select] : [];
}

/** Embed `/reactionrole list`. */
export function panelListEmbed(
  panels: readonly ReactionRolePanel[],
  t: Translator = defaultTranslator,
): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(EMBED_COLORS.primary)
    .setTitle(t('rr.list.title'))
    .setTimestamp();

  if (panels.length === 0) {
    return embed.setDescription(t('rr.list.empty'));
  }

  const lines = panels.map((panel) => {
    const roles = panel.options
      .map((option) => `<@&${option.roleId}>`)
      .slice(0, 8)
      .join(', ');
    const more =
      panel.options.length > 8
        ? t('rr.list.more', { count: String(panel.options.length - 8) })
        : '';

    return t('rr.list.line', {
      id: String(panel.id),
      channel: panel.channelId,
      state: panelStateLabel(panel, t),
      count: String(panel.options.length),
      roles,
      more,
    });
  });

  return embed.setDescription(truncate(lines.join('\n\n'), 4_000));
}

/** Embed hasil satu aksi kecil (tambah/hapus role). */
export function panelUpdatedEmbed(
  panel: ReactionRolePanel,
  message: string,
  t: Translator = defaultTranslator,
): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(EMBED_COLORS.success)
    .setTitle(t('rr.updated.title'))
    .setDescription(
      t('rr.updated.description', {
        message,
        id: String(panel.id),
        count: String(panel.options.length),
      }),
    )
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
function panelStateLabel(panel: ReactionRolePanel, t: Translator): string {
  if (panel.closedAt) return t('rr.state.closed');
  if (panel.expiresAt && panel.expiresAt <= new Date()) return t('rr.state.expired');
  if (panel.expiresAt) {
    return t('rr.state.until', {
      unix: String(Math.floor(panel.expiresAt.getTime() / 1_000)),
    });
  }
  if (!panel.messageId) return t('rr.state.noMessage');

  return t('rr.state.active');
}

export { roleOptionCustomId };
