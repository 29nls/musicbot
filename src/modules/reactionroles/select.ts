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
import type { PanelOptionLookup } from './types.js';
import { isPanelActive, parseRoleOptionCustomId } from './types.js';


/**
 * Tangani pilihan dari select menu panel reaction role.
 *
 * Select menu tidak punya tampilan centang, jadi perilakunya toggle: memilih
 * role yang sudah dimiliki akan melepaskannya. Konvensi ini dijelaskan di embed
 * panel supaya member tidak mengira tidak terjadi apa-apa.
 */
/**
 * Dependency handler. Bawaannya memakai service & konfigurasi sungguhan;
 * tes menyuntikkan yang palsu supaya seluruh jalurnya bisa diperiksa tanpa
 * database.
 *
 * Pola ini mengikuti `QueueNavDeps` di modul musik: handler komponen yang
 * menyentuh service tidak bisa diuji kalau ia mengambil singleton-nya
 * sendiri, dan Alternative-nya (memock modul) menguji mock-nya sendiri.
 */
export interface ReactionRoleSelectDeps {
  /** Cari opsi panel beserta panelnya; null kalau sudah hilang. */
  findOption: (optionId: number) => Promise<PanelOptionLookup | null>;
  /** Apakah modul reaction role masih dinyalakan di server itu. */
  isModuleEnabled: (guildId: string) => Promise<boolean>;
}

function defaultSelectDeps(): ReactionRoleSelectDeps {
  return {
    findOption: (optionId) => getReactionRoleService().findOption(optionId),
    isModuleEnabled: async (guildId) => (await getGuildConfigService().get(guildId)).modules.reactions,
  };
}

export async function handleReactionRoleSelect(
  interaction: StringSelectMenuInteraction,
  deps: ReactionRoleSelectDeps = defaultSelectDeps(),
): Promise<void> {
  try {
    await applySelection(interaction, deps);
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

async function applySelection(
  interaction: StringSelectMenuInteraction,
  deps: ReactionRoleSelectDeps,
): Promise<void> {
  if (!interaction.inCachedGuild()) return;

  const optionId = parseRoleOptionCustomId(interaction.customId);
  if (optionId === null) return;

  const t = await translatorForInteraction(interaction);

  const lookup = await deps.findOption(optionId);
  if (!lookup || lookup.panel.guildId !== interaction.guildId) {
    await reply(interaction, warningEmbed(t('rr.select.panelGone'), t('embed.title.warning')));
    return;
  }

  const { panel, option } = lookup;

  // Penjaga utama, bukan sekadar-operational: bot bisa mati atau keceplosan tepat
  // saat masa hidup panel habis, sehingga select menu-nya masih ada di Discord
  // padahal panelnya sudah closed. Member yang masih menyimpan pesan lama tidak
  // boleh bisa mengambil role dari panel yang sudah berakhir.
  if (!isPanelActive(panel)) {
    await reply(interaction, warningEmbed(t('rr.select.closedPanel'), t('embed.title.warning')));
    return;
  }

  if (!(await deps.isModuleEnabled(panel.guildId))) {
    await reply(interaction, warningEmbed(t('rr.select.moduleOff'), t('embed.title.warning')));
    return;
  }

  const guild = interaction.guild;
  const role = guild.roles.cache.get(option.roleId);
  if (!role) {
    await reply(interaction, warningEmbed(t('rr.select.roleGone'), t('embed.title.warning')));
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
        ? successEmbed(t('rr.select.removed', { role: option.roleId }), t('embed.title.success'))
        : warningEmbed(t('rr.select.removeFailed'), t('embed.title.warning')),
    );
    return;
  }

  const botMember = guild.members.me;
  if (!botMember) {
    await reply(interaction, warningEmbed(t('rr.select.botMissing'), t('embed.title.warning')));
    return;
  }

  // Role di atas bot, atau bot tanpa izin Manage Roles, tidak bisa dipasang.
  const canManageRole =
    botMember.permissions.has(PermissionFlagsBits.ManageRoles) &&
    role.position < botMember.roles.highest.position;
  if (!canManageRole) {
    await reply(
      interaction,
      warningEmbed(t('rr.select.cannotAssign', { role: option.roleId }), t('embed.title.warning')),
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
      ? successEmbed(t('rr.select.added', { role: option.roleId }), t('embed.title.success'))
      : warningEmbed(t('rr.select.addFailed'), t('embed.title.warning')),
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