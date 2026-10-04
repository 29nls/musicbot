import {
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type Guild,
  type Role,
} from 'discord.js';
import { getGuildConfigService } from '../../modules/config/index.js';
import { defaultTranslator, translatorFor, type Translator } from '../../modules/i18n/index.js';
import {
  MAX_PANEL_OPTIONS,
  buildPanelComponents,
  closePanel,
  describePanelLifetime,
  getReactionRoleService,
  panelEmbed,
  panelListEmbed,
  panelUpdatedEmbed,
  parsePanelDuration,
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
        )
        .addStringOption((option) =>
          option
            .setName('duration')
            .setDescription(
              'Masa hidup panel, mis. 30m, 6h, 7d. Kosongkan untuk permanen.',
            )
            .setMaxLength(20),
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
    )
    .addSubcommand((sub) =>
      sub
        .setName('close')
        .setDescription(
          'Tutup panel sekarang: select menu dilepas, pesan & datanya tetap ada',
        )
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
    if (!interaction.inGuild()) {
      await interaction.reply({
        embeds: [warningEmbed(defaultTranslator('mod.gate.guildOnly'), defaultTranslator('embed.title.warning'))],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const guildId = interaction.guildId;
    const t = await translatorFor(guildId);

    if (!interaction.inCachedGuild() || !canManageGuild(interaction)) {
      await interaction.reply({
        embeds: [warningEmbed(t('mod.gate.needsPermission', { permission: 'Manage Server' }), t('embed.title.warning'))],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const guild = interaction.guild;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      const config = await getGuildConfigService().get(guildId);
      if (!config.modules.reactions) {
        await interaction.editReply({
          embeds: [warningEmbed(t('rr.err.moduleOff'), t('rr.err.moduleOffTitle'))],
        });
        return;
      }

      const service = getReactionRoleService();
      const sub = interaction.options.getSubcommand(true);

      if (sub === 'list') {
        const panels = await service.list(guildId);
        await interaction.editReply({ embeds: [panelListEmbed(panels, t)] });
        return;
      }

      if (sub === 'post') {
        await postPanel(interaction, guild, t);
        return;
      }

      const panelId = interaction.options.getInteger('panel', true);

      if (sub === 'close') {
        const panel = await service.find(guildId, panelId);
        if (!panel) {
          await interaction.editReply({
            embeds: [warningEmbed(t('rr.cmd.notFound', { id: String(panelId) }), t('embed.title.warning'))],
          });
          return;
        }

        const outcome = await closePanel(service, guild, panel, 'manual', new Date(), t);
        if (!outcome.changed) {
          await interaction.editReply({
            embeds: [warningEmbed(t('rr.cmd.alreadyClosed', { id: String(panelId) }), t('embed.title.warning'))],
          });
          return;
        }

        await interaction.editReply({
          embeds: [
            successEmbed(
              t(outcome.messageUpdated ? 'rr.cmd.closed' : 'rr.cmd.closedMessageGone', {
                id: String(panelId),
              }),
              t('rr.cmd.closedTitle'),
            ),
          ],
        });
        return;
      }

      if (sub === 'delete') {
        const removed = await service.delete(guildId, panelId);
        if (!removed) {
          await interaction.editReply({
            embeds: [warningEmbed(t('rr.cmd.notFound', { id: String(panelId) }), t('embed.title.warning'))],
          });
          return;
        }

        await deletePanelMessage(guild, removed);
        await interaction.editReply({
          embeds: [successEmbed(t('rr.cmd.deleted', { id: String(panelId) }), t('rr.cmd.deletedTitle'))],
        });
        return;
      }

      const roles = toRoleInputs(interaction, guild);

      if (sub === 'add') {
        const blocked = rejectUnusableRoles(roles, guild, t);
        if (blocked) {
          await interaction.editReply({ embeds: [warningEmbed(blocked, t('embed.title.warning'))] });
          return;
        }

        const panel = await service.addRoles(guildId, panelId, roles);
        if (!panel) {
          await interaction.editReply({
            embeds: [warningEmbed(t('rr.cmd.notFound', { id: String(panelId) }), t('embed.title.warning'))],
          });
          return;
        }

        await refreshPanelMessage(guild, panel, t);
        await interaction.editReply({
          embeds: [
            panelUpdatedEmbed(
              panel,
              t('rr.updated.added', {
                roles: roles.map((role) => `<@&${role.roleId}>`).join(', '),
              }),
              t,
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
          embeds: [warningEmbed(t('rr.cmd.notFound', { id: String(panelId) }), t('embed.title.warning'))],
        });
        return;
      }

      await refreshPanelMessage(guild, panel, t);
      await interaction.editReply({
        embeds: [
          panelUpdatedEmbed(
            panel,
            t('rr.updated.removed', {
              roles: roles.map((role) => `<@&${role.roleId}>`).join(', '),
            }),
            t,
          ),
        ],
      });
    } catch (error) {
      await interaction.editReply({ embeds: [toReactionRoleErrorEmbed(error, t)] });
    }
  },
} satisfies BotCommand;

async function postPanel(interaction: Interaction, guild: Guild, t: Translator): Promise<void> {
  const channel = interaction.options.getChannel('channel', true);
  if (!isGuildTextChannel(channel)) {
    await interaction.editReply({
      embeds: [warningEmbed(t('rr.err.notTextChannel'), t('embed.title.warning'))],
    });
    return;
  }

  const roles = toRoleInputs(interaction, guild);
  const blocked = rejectUnusableRoles(roles, guild, t);
  if (blocked) {
    await interaction.editReply({ embeds: [warningEmbed(blocked, t('embed.title.warning'))] });
    return;
  }

  const description = interaction.options.getString('deskripsi');
  // Masa hidup yang tidak terbaca harus ditolak di sini, sebelum panel & pesan
  // dibuat — menjadikan panel permanen karena salah ketik adalah kegagalan yang
  // baru ketahuan berminggu-minggu kemudian.
  const expiresAt = parsePanelDuration(interaction.options.getString('duration'));
  const panel = await getReactionRoleService().create({
    guildId: guild.id,
    channelId: channel.id,
    roles,
    expiresAt,
  });

  const names = roleNameMap(panel, t);
  const sent = await channel.send({
    embeds: [panelEmbed(panel, names, description, t)],
    components: buildPanelComponents(panel, names, t),
  });

  const service = getReactionRoleService();
  await service.attachMessage(panel.id, sent.id);

  const lifetime = expiresAt
    ? t('rr.cmd.lifetime', {
        duration: describePanelLifetime(expiresAt.getTime() - Date.now(), t),
      })
    : t('rr.cmd.permanent');

  await interaction.editReply({
    embeds: [
      successEmbed(
        t('rr.cmd.created', {
          id: String(panel.id),
          channel: channel.id,
          count: String(panel.options.length),
          lifetime,
        }),
        t('rr.cmd.createdTitle'),
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
function rejectUnusableRoles(
  roles: readonly RoleInput[],
  guild: Guild,
  t: Translator,
): string | null {
  if (roles.length > MAX_PANEL_OPTIONS) {
    return t('rr.err.maxRoles', {
      max: String(MAX_PANEL_OPTIONS),
      count: String(roles.length),
    });
  }

  if (roles.some((role) => role.roleId === guild.roles.everyone.id)) {
    return t('rr.err.everyone');
  }

  const botMember = guild.members.me;
  if (!botMember) return null;

  if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles)) {
    return t('rr.err.needManageRoles');
  }

  const tooHigh = roles
    .map((role) => guild.roles.cache.get(role.roleId))
    .filter((role): role is Role => role !== undefined)
    .filter((role) => role.position >= botMember.roles.highest.position)
    .map((role) => `<@&${role.id}>`);

  if (tooHigh.length > 0) {
    return t('rr.err.roleTooHigh', { roles: tooHigh.join(', ') });
  }

  return null;
}

/** Nama role asli untuk label select menu & embed. */
function roleNameMap(panel: ReactionRolePanel, t: Translator): Map<string, string> {
  return new Map(
    panel.options.map((option) => [
      option.roleId,
      option.label ?? t('rr.role.byId', { id: String(option.id) }),
    ]),
  );
}

/** Edit pesan panel supaya daftar role di Discord ikut berubah. */
async function refreshPanelMessage(
  guild: Guild,
  panel: ReactionRolePanel,
  t: Translator,
): Promise<void> {
  if (!panel.messageId) return;

  const channel = await guild.channels.fetch(panel.channelId).catch(() => null);
  if (!channel?.isTextBased() || channel.isDMBased()) return;

  const names = roleNameMap(panel, t);
  await channel.messages
    .edit(panel.messageId, {
      embeds: [panelEmbed(panel, names, undefined, t)],
      components: buildPanelComponents(panel, names, t),
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