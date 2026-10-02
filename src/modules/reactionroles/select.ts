import {
  MessageFlags,
  PermissionFlagsBits,
  type EmbedBuilder,
  type StringSelectMenuInteraction,
} from 'discord.js';
import { getLogger } from '../../services/logger.js';
import { successEmbed, warningEmbed } from '../../utils/embeds.js';
import { getGuildConfigService } from '../config/index.js';
import { toReactionRoleErrorEmbed } from './errors.js';
import { getReactionRoleService } from './singleton.js';
import { parseRoleOptionCustomId } from './types.js';

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
    await reply(interaction, toReactionRoleErrorEmbed(error));
  }
}

async function applySelection(interaction: StringSelectMenuInteraction): Promise<void> {
  if (!interaction.inCachedGuild()) return;

  const optionId = parseRoleOptionCustomId(interaction.customId);
  if (optionId === null) return;

  const lookup = await getReactionRoleService().findOption(optionId);
  if (!lookup || lookup.panel.guildId !== interaction.guildId) {
    await reply(
      interaction,
      warningEmbed('Panel role ini sudah tidak ada. Minta admin untuk membuatnya ulang.'),
    );
    return;
  }

  const { panel, option } = lookup;
  const config = await getGuildConfigService().get(panel.guildId);
  if (!config.modules.reactions) {
    await reply(interaction, warningEmbed('Modul reaction role sedang mati di server ini.'));
    return;
  }

  const guild = interaction.guild;
  const role = guild.roles.cache.get(option.roleId);
  if (!role) {
    await reply(
      interaction,
      warningEmbed('Role ini sudah dihapus dari server. Minta admin untuk memperbarui panelnya.'),
    );
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
        ? successEmbed(`Role <@&${option.roleId}> **dilepas**.`)
        : warningEmbed('Tidak bisa melepas role ini. Minta moderator server untuk membantu.'),
    );
    return;
  }

  const botMember = guild.members.me;
  if (!botMember) {
    await reply(interaction, warningEmbed('Aku belum termuat di server ini. Coba lagi sebentar lagi.'));
    return;
  }

  // Role di atas bot, atau bot tanpa izin Manage Roles, tidak bisa dipasang.
  const canManageRole =
    botMember.permissions.has(PermissionFlagsBits.ManageRoles) &&
    role.position < botMember.roles.highest.position;
  if (!canManageRole) {
    await reply(
      interaction,
      warningEmbed(
        `Aku tidak bisa memberi role <@&${option.roleId}> — posisinya terlalu tinggi atau aku tidak punya izin **Manage Roles**.`,
      ),
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
      ? successEmbed(`Role <@&${option.roleId}> **diambil**.`)
      : warningEmbed('Tidak bisa memasang role ini. Minta moderator server untuk membantu.'),
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