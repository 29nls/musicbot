import {
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type Guild,
  type Role,
} from 'discord.js';
import { getGuildConfigService } from '../../modules/config/index.js';
import {
  MAX_PANEL_OPTIONS,
  buildPanelComponents,
  getReactionRoleService,
  panelEmbed,
  panelListEmbed,
  panelUpdatedEmbed,
  parseRoleMentions,
  toReactionRoleErrorEmbed,
  type ReactionRolePanel,
  type RoleInput,
} from '../../modules/reactionroles/index.js';
import type { BotCommand } from '../../types/command.js';
import { successEmbed, warningEmbed } from '../../utils/embeds.js';
import { isGuildTextChannel } from '../../utils/discord.js';
import { canManageGuild } from '../../utils/permissions.js';

type Interaction = Parameters<BotCommand['execute']>[0];

export default {
  data: new SlashCommandBuilder()
    .setName('reactionrole')
    .setDescription('Panel self-assign role (member ambil role sendiri lewat select menu)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((sub) =>
      sub
        .setName('post')
        .setDescription('Kirim panel baru di sebuah channel')
        .addChannelOption((option) =>
          option
            .setName('channel')
            .setDescription('Channel tempat panel dikirim')
            .setRequired(true),
        )
        .addStringOption((option) =>
          option
            .setName('roles')
            .setDescription('Role yang bisa diambil member — pilih lewat autocomplete @ (maks 25)')
            .setRequired(true),
        )
        .addStringOption((option) =>
          option
            .setName('deskripsi')
            .setDescription('Teks singkat di atas select menu')
            .setMaxLength(1_000),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('add')
        .setDescription('Tambah role ke panel yang sudah ada')
        .addIntegerOption((option) =>
          option
            .setName('panel')
            .setDescription('Nomor panel')
            .setMinValue(1)
            .setRequired(true),
        )
        .addStringOption((option) =>
          option
            .setName('roles')
            .setDescription('Role yang akan ditambahkan — pilih lewat autocomplete @')
            .setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('remove')
        .setDescription('Hapus role dari panel')
        .addIntegerOption((option) =>
          option
            .setName('panel')
            .setDescription('Nomor panel')
            .setMinValue(1)
            .setRequired(true),
        )
        .addStringOption((option) =>
          option
            .setName('roles')
            .setDescription('Role yang akan dihapus — pilih lewat autocomplete @')
            .setRequired(true),
        ),
    )
    .addSubcommand((sub) => sub.setName('list').setDescription('Daftar panel di server ini'))
    .addSubcommand((sub) =>
      sub
        .setName('delete')
        .setDescription('Hapus panel beserta pesannya')
        .addIntegerOption((option) =>
          option
            .setName('panel')
            .setDescription('Nomor panel')
            .setMinValue(1)
            .setRequired(true),
        ),
    ),
  category: 'admin',
  guildOnly: true,
  cooldownSeconds: 5,
  async execute(interaction) {
    if (!interaction.inCachedGuild() || !canManageGuild(interaction)) {
      await interaction.reply({
        embeds: [warningEmbed('Perintah ini butuh izin **Manage Server**.')],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const guildId = interaction.guildId;
    const guild = interaction.guild;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      const config = await getGuildConfigService().get(guildId);
      if (!config.modules.reactions) {
        await interaction.editReply({
          embeds: [
            warningEmbed(
              'Modul reaction role sedang mati.\nNyalakan dengan `/config set reactions:true` dulu.',
              '❌ Modul Mati',
            ),
          ],
        });
        return;
      }

      const service = getReactionRoleService();
      const sub = interaction.options.getSubcommand(true);

      if (sub === 'list') {
        const panels = await service.list(guildId);
        await interaction.editReply({ embeds: [panelListEmbed(panels)] });
        return;
      }

      if (sub === 'post') {
        await postPanel(interaction, guild);
        return;
      }

      const panelId = interaction.options.getInteger('panel', true);

      if (sub === 'delete') {
        const removed = await service.delete(guildId, panelId);
        if (!removed) {
          await interaction.editReply({
            embeds: [warningEmbed(`Panel #${panelId} tidak ada di server ini.`)],
          });
          return;
        }

        await deletePanelMessage(guild, removed);
        await interaction.editReply({
          embeds: [successEmbed(`Panel **#${panelId}** dihapus.`, '🗑️ Panel Dihapus')],
        });
        return;
      }

      const roles = toRoleInputs(interaction, guild);

      if (sub === 'add') {
        const blocked = rejectUnusableRoles(roles, guild);
        if (blocked) {
          await interaction.editReply({ embeds: [warningEmbed(blocked)] });
          return;
        }

        const panel = await service.addRoles(guildId, panelId, roles);
        if (!panel) {
          await interaction.editReply({
            embeds: [warningEmbed(`Panel #${panelId} tidak ada di server ini.`)],
          });
          return;
        }

        await refreshPanelMessage(guild, panel);
        await interaction.editReply({
          embeds: [
            panelUpdatedEmbed(
              panel,
              `Ditambahkan: ${roles.map((role) => `<@&${role.roleId}>`).join(', ')}.`,
            ),
          ],
        });
        return;
      }

      // remove — role tidak harus bisa dikelola bot, jadi tidak divalidasi.
      const panel = await service.removeRoles(
        guildId,
        panelId,
        roles.map((role) => role.roleId),
      );
      if (!panel) {
        await interaction.editReply({
          embeds: [warningEmbed(`Panel #${panelId} tidak ada di server ini.`)],
        });
        return;
      }

      await refreshPanelMessage(guild, panel);
      await interaction.editReply({
        embeds: [
          panelUpdatedEmbed(
            panel,
            `Dihapus dari panel: ${roles.map((role) => `<@&${role.roleId}>`).join(', ')}.`,
          ),
        ],
      });
    } catch (error) {
      await interaction.editReply({ embeds: [toReactionRoleErrorEmbed(error)] });
    }
  },
} satisfies BotCommand;

async function postPanel(interaction: Interaction, guild: Guild): Promise<void> {
  const channel = interaction.options.getChannel('channel', true);
  if (!isGuildTextChannel(channel)) {
    await interaction.editReply({
      embeds: [warningEmbed('Panel hanya bisa dikirim ke channel teks server.')],
    });
    return;
  }

  const roles = toRoleInputs(interaction, guild);
  const blocked = rejectUnusableRoles(roles, guild);
  if (blocked) {
    await interaction.editReply({ embeds: [warningEmbed(blocked)] });
    return;
  }

  const description = interaction.options.getString('deskripsi');
  const panel = await getReactionRoleService().create({
    guildId: guild.id,
    channelId: channel.id,
    roles,
  });

  const names = roleNameMap(panel);
  const sent = await channel.send({
    embeds: [panelEmbed(panel, names, description)],
    components: buildPanelComponents(panel, names),
  });

  await getReactionRoleService().attachMessage(panel.id, sent.id);
  await interaction.editReply({
    embeds: [
      successEmbed(
        `Panel **#${panel.id}** dibuat di ${channel} dengan ${panel.options.length} role.`,
        '🎭 Panel Dibuat',
      ),
    ],
  });
}

/**
 * Ubah teks mention jadi input domain.
 *
 * Nama role diambil dari cache guild supaya select menu menampilkan nama yang
 * dikenal member. Role yang tidak ada di cache (mis. baru dibuat di sesi ini)
 * tetap dipakai ID-nya.
 */
function toRoleInputs(interaction: Interaction, guild: Guild): RoleInput[] {
  const ids = parseRoleMentions(interaction.options.getString('roles'));

  return ids.map((id) => ({ roleId: id, label: guild.roles.cache.get(id)?.name ?? null }));
}

/**
 * Tolak role yang memang tidak mungkin diberikan bot: @everyone, role di atas
 * posisi bot, atau saat bot tidak punya izin Manage Roles.
 *
 * Dicek di sini, bukan nanti saat select menu ditekan, supaya admin tidak baru
 * tahu masalahnya setelah anggota kesal karena role-nya tidak bisa diambil.
 */
function rejectUnusableRoles(roles: readonly RoleInput[], guild: Guild): string | null {
  if (roles.length > MAX_PANEL_OPTIONS) {
    return `Maksimal ${MAX_PANEL_OPTIONS} role per perintah (kirim ${roles.length}).`;
  }

  if (roles.some((role) => role.roleId === guild.roles.everyone.id)) {
    return 'Role @everyone tidak bisa diambil sendiri.';
  }

  const botMember = guild.members.me;
  if (!botMember) return null;

  if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles)) {
    return 'Aku tidak punya izin **Manage Roles**, jadi role apa pun tidak bisa kupasang ke member.';
  }

  const tooHigh = roles
    .map((role) => guild.roles.cache.get(role.roleId))
    .filter((role): role is Role => role !== undefined)
    .filter((role) => role.position >= botMember.roles.highest.position)
    .map((role) => `<@&${role.id}>`);

  if (tooHigh.length > 0) {
    return `Role ini posisinya di atas aku: ${tooHigh.join(', ')}. Pindahkan role bot ke atas, atau pilih role yang lebih rendah.`;
  }

  return null;
}

/** Nama role asli untuk label select menu & embed. */
function roleNameMap(panel: ReactionRolePanel): Map<string, string> {
  return new Map(
    panel.options.map((option) => [option.roleId, option.label ?? `Role ${option.id}`]),
  );
}

/** Edit pesan panel supaya daftar role di Discord ikut berubah. */
async function refreshPanelMessage(guild: Guild, panel: ReactionRolePanel): Promise<void> {
  if (!panel.messageId) return;

  const channel = await guild.channels.fetch(panel.channelId).catch(() => null);
  if (!channel?.isTextBased() || channel.isDMBased()) return;

  const names = roleNameMap(panel);
  await channel.messages
    .edit(panel.messageId, {
      embeds: [panelEmbed(panel, names)],
      components: buildPanelComponents(panel, names),
    })
    // Pesan bisa sudah terhapus (dihapus manual atau channel dihapus) — bukan
    // alasan gagalkan seluruh perintah.
    .catch(() => undefined);
}

async function deletePanelMessage(guild: Guild, panel: ReactionRolePanel): Promise<void> {
  if (!panel.messageId) return;

  const channel = await guild.channels.fetch(panel.channelId).catch(() => null);
  if (!channel?.isTextBased() || channel.isDMBased()) return;

  await channel.messages.delete(panel.messageId).catch(() => undefined);
}