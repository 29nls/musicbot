import {
  MessageFlags,
  PermissionFlagsBits,
  type EmbedBuilder,
  type StringSelectMenuInteraction,
} from 'discord.js';
import { getLogger } from '../../services/logger.js';
import { successEmbed, warningEmbed } from '../../utils/embeds.js';
import { getGuildConfigService } from '../config/index.js';
import { defaultTranslator, translatorFor, type Translator } from '../i18n/index.js';
import { toReactionRoleErrorEmbed } from './errors.js';
import { getReactionRoleService } from './singleton.js';
import { isPanelActive, parseRoleOptionCustomId } from './types.js';


/**
 * Tangani pilihan dari select menu panel reaction role.
 *
 * Select menu tidak punya tampilan centang, jadi perilakunya toggle: memilih
 * role yang sudah dimiliki akan melepaskannya. Konvensi ini dijelaskan di embed
 * panel supaya member tidak mengira tidak terjadi apa-apa.
 */
export async function handleReactionRoleSelect(
  interaction: StringSelectMenuInteraction,
): Promise<void> {
  try {
    await applySelection(interaction);
  } catch (error) {
    getLogger().warn({ err: error }, 'Pemilihan reaction role gagal');
    await reply(
      interaction,
      toReactionRoleErrorEmbed(error, await translatorForInteraction(interaction)),
    );
  }
}

/** Penerjemah untuk balasan handler; tanpa guild (DM) jatuh ke bahasa bawaan. */
function translatorForInteraction(
  interaction: StringSelectMenuInteraction,
): Promise<Translator> {
  return interaction.guildId
    ? translatorFor(interaction.guildId)
    : Promise.resolve(defaultTranslator);
}

async function applySelection(interaction: StringSelectMenuInteraction): Promise<void> {
  if (!interaction.inCachedGuild()) return;

  const optionId = parseRoleOptionCustomId(interaction.customId);
  if (optionId === null) return;

  const t = await translatorForInteraction(interaction);

  const lookup = await getReactionRoleService().findOption(optionId);
  if (!lookup || lookup.panel.guildId !== interaction.guildId) {
    await reply(interaction, warningEmbed(t('rr.select.panelGone')));
    return;
  }

  const { panel, option } = lookup;

  // Penjaga utama, bukan sekadar-operational: bot bisa mati atau keceplosan tepat
  // saat masa hidup panel habis, sehingga select menu-nya masih ada di Discord
  // padahal panelnya sudah closed. Member yang masih menyimpan pesan lama tidak
  // boleh bisa mengambil role dari panel yang sudah berakhir.
  if (!isPanelActive(panel)) {
    await reply(interaction, warningEmbed(t('rr.select.closedPanel')));
    return;
  }

  const config = await getGuildConfigService().get(panel.guildId);
  if (!config.modules.reactions) {
    await reply(interaction, warningEmbed(t('rr.select.moduleOff')));
    return;
  }

  const guild = interaction.guild;
  const role = guild.roles.cache.get(option.roleId);
  if (!role) {
    await reply(interaction, warningEmbed(t('rr.select.roleGone')));
    return;
  }

  const member = interaction.member;

  if (member.roles.cache.has(option.roleId)) {
    const ok = await member.roles
      .remove(role, 'Reaction role dilepas lewat panel')
      .then(() => true)
      .catch((error: unknown) => {
        getLogger().warn({ err: error, guild: guild.id, user: member.id }, 'Gagal melepas role reaction');
        return false;
      });

    await reply(
      interaction,
      ok
        ? successEmbed(t('rr.select.removed', { role: option.roleId }))
        : warningEmbed(t('rr.select.removeFailed')),
    );
    return;
  }

  const botMember = guild.members.me;
  if (!botMember) {
    await reply(interaction, warningEmbed(t('rr.select.botMissing')));
    return;
  }

  // Role di atas bot, atau bot tanpa izin Manage Roles, tidak bisa dipasang.
  const canManageRole =
    botMember.permissions.has(PermissionFlagsBits.ManageRoles) &&
    role.position < botMember.roles.highest.position;
  if (!canManageRole) {
    await reply(
      interaction,
      warningEmbed(t('rr.select.cannotAssign', { role: option.roleId })),
    );
    return;
  }

  const ok = await member.roles
    .add(role, 'Reaction role diambil lewat panel')
    .then(() => true)
    .catch((error: unknown) => {
      getLogger().warn({ err: error, guild: guild.id, user: member.id }, 'Gagal memasang role reaction');
      return false;
    });

  await reply(
    interaction,
    ok
      ? successEmbed(t('rr.select.added', { role: option.roleId }))
      : warningEmbed(t('rr.select.addFailed')),
  );
}

async function reply(
  interaction: StringSelectMenuInteraction,
  embed: EmbedBuilder,
): Promise<void> {
  try {
    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  } catch (error) {
    // Select menu punya jendela balasan 3 detik; kalau sudah kedaluwarsa tidak
    // ada yang bisa dilakukan selain mencatatnya.
    getLogger().warn({ err: error }, 'Gagal membalas pilihan reaction role');
  }
}