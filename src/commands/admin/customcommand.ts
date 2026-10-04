import {
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import { getGuildConfigService } from '../../modules/config/index.js';
import { defaultTranslator, translatorFor, type Translator } from '../../modules/i18n/index.js';
import {
  MAX_NAME_LENGTH,
  MAX_RESPONSE_LENGTH,
  TRIGGER_PREFIX,
  CustomCommandValidationError,
  customCommandDeletedEmbed,
  customCommandDetailEmbed,
  customCommandListEmbed,
  getCustomCommandService,
  renderedMessage,
  type CustomCommand,
} from '../../modules/customcommands/index.js';
import { getLogger } from '../../services/logger.js';
import type { BotCommand } from '../../types/command.js';
import { errorEmbed, successEmbed, warningEmbed } from '../../utils/embeds.js';
import { canManageGuild } from '../../utils/permissions.js';

type Interaction = Parameters<BotCommand['execute']>[0];

/** Batas isi field embed; dipakai untuk menandai pratinjau yang terpotong. */
const PREVIEW_LIMIT = 1_024;

export default {
  data: new SlashCommandBuilder()
    .setName('customcommand')
    .setDescription('Kelola perintah custom (teks balasan yang dipanggil dengan !nama)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((sub) => sub.setName('list').setDescription('Tampilkan perintah custom di server ini'))
    .addSubcommand((sub) =>
      sub
        .setName('add')
        .setDescription('Buat perintah baru, atau ganti balasan yang namanya sama')
        .addStringOption((option) =>
          option
            .setName('name')
            .setDescription('Nama pemicu tanpa tanda !')
            .setRequired(true)
            .setMaxLength(MAX_NAME_LENGTH),
        )
        .addStringOption((option) =>
          option
            .setName('response')
            .setDescription(
              'Teks balasan. Placeholder: {pengguna} {nama} {server} {channel} {args}',
            )
            .setRequired(true)
            .setMaxLength(MAX_RESPONSE_LENGTH),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('edit')
        .setDescription('Ganti isi balasan perintah yang sudah ada')
        .addStringOption((option) =>
          option
            .setName('name')
            .setDescription('Nama perintah yang mau diubah')
            .setRequired(true)
            .setMaxLength(MAX_NAME_LENGTH),
        )
        .addStringOption((option) =>
          option
            .setName('response')
            .setDescription('Teks balasan baru')
            .setRequired(true)
            .setMaxLength(MAX_RESPONSE_LENGTH),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('delete')
        .setDescription('Hapus perintah custom')
        .addStringOption((option) =>
          option
            .setName('name')
            .setDescription('Nama perintah yang mau dihapus')
            .setRequired(true)
            .setMaxLength(MAX_NAME_LENGTH),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('show')
        .setDescription('Tampilkan isi & pratinjau balasan satu perintah')
        .addStringOption((option) =>
          option
            .setName('name')
            .setDescription('Nama perintah')
            .setRequired(true)
            .setMaxLength(MAX_NAME_LENGTH),
        ),
    ),
  category: 'admin',
  guildOnly: true,
  cooldownSeconds: 3,
  async execute(interaction, client) {
    if (!interaction.inGuild()) {
      await interaction.reply({
        embeds: [warningEmbed(defaultTranslator('mod.gate.guildOnly'), defaultTranslator('embed.title.warning'))],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const guildId = interaction.guildId;
    const t = await translatorFor(guildId);

    if (!canManageGuild(interaction)) {
      await interaction.reply({
        embeds: [warningEmbed(t('mod.gate.needsPermission', { permission: 'Manage Server' }), t('embed.title.warning'))],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      const service = getCustomCommandService();
      const sub = interaction.options.getSubcommand(true);
      const config = await getGuildConfigService().get(guildId);

      if (sub === 'list') {
        const commands = await service.list(guildId);
        const embed = customCommandListEmbed(commands, t);

        if (!config.modules.customCommands) {
          embed.setFooter({ text: t('cc.list.moduleOff') });
        }

        await interaction.editReply({ embeds: [embed] });
        return;
      }

      const name = interaction.options.getString('name', true);

      if (sub === 'add') {
        const response = interaction.options.getString('response', true);
        const result = await service.create(
          { guildId, name, response, createdBy: interaction.user.id },
          // Nama perintah slash yang aktif ikut dijaga: `!play` yang panggilan
          // ke `/play` hanya membingungkan, bukan pintasan.
          { reserved: [...client.commands.keys()] },
        );

        const command = result.command;
        await interaction.editReply({
          embeds: [
            successEmbed(
              t(result.kind === 'created' ? 'cc.add.created' : 'cc.add.replaced', {
                prefix: TRIGGER_PREFIX,
                name: command.name,
              }) + `\n\n${command.response}`,
              t(result.kind === 'created' ? 'cc.add.titleCreated' : 'cc.add.titleUpdated'),
            ),
          ],
        });
        return;
      }

      if (sub === 'edit') {
        const response = interaction.options.getString('response', true);
        const result = await service.edit(guildId, name, response);

        if (result.kind === 'not-found') {
          await interaction.editReply({
            embeds: [warningEmbed(t('cc.err.notFound', { prefix: TRIGGER_PREFIX, name }), t('embed.title.warning'))],
          });
          return;
        }

        await interaction.editReply({
          embeds: [
            successEmbed(
              t('cc.add.replaced', { prefix: TRIGGER_PREFIX, name: result.command.name }) +
                `\n\n${result.command.response}`,
              t('cc.add.titleUpdated'),
            ),
          ],
        });
        return;
      }

      if (sub === 'delete') {
        const result = await service.remove(guildId, name);

        if (result.kind === 'not-found') {
          await interaction.editReply({
            embeds: [warningEmbed(t('cc.err.notFound', { prefix: TRIGGER_PREFIX, name }), t('embed.title.warning'))],
          });
          return;
        }

        await interaction.editReply({ embeds: [customCommandDeletedEmbed(result.command, t)] });
        return;
      }

      const command = await service.find(guildId, name);

      if (!command) {
        await interaction.editReply({
          embeds: [warningEmbed(t('cc.err.notFound', { prefix: TRIGGER_PREFIX, name }), t('embed.title.warning'))],
        });
        return;
      }

      await interaction.editReply({
        embeds: [customCommandDetailEmbed(command, buildPreview(interaction, command, t), t)],
      });
    } catch (error) {
      // Validasi nama/isi balasan adalah kesalahan admin yang harus dibacakan
      // apa adanya; sisanya dicatat sebagai kegagalan bot.
      if (error instanceof CustomCommandValidationError) {
        await interaction.editReply({ embeds: [errorEmbed(t(error.key, error.params), t('embed.title.error'))] });
        return;
      }

      getLogger().error(
        { err: error, command: 'customcommand', guild: guildId },
        'Perintah custom gagal',
      );

      await interaction.editReply({
        embeds: [errorEmbed(t('cc.err.generic'), t('embed.title.error'))],
      });
    }
  },
} satisfies BotCommand;

/**
 * Pratinjau dengan nilai milik pemanggil.
 *
 * Pakai data orang yang memanggil, bukan contoh generik: placeholder
 * `{pengguna}` dan `{channel}` baru berarti sesuatu kalau isinya milik dia.
 */
function buildPreview(
  interaction: Interaction,
  command: CustomCommand,
  t: Translator,
): { text: string; truncated: boolean } | null {
  const text = renderedMessage(command.response, {
    userId: interaction.user.id,
    username: interaction.user.displayName || interaction.user.username,
    guildName: interaction.guild?.name ?? 'Server',
    channelId: interaction.channelId,
    args: t('cc.preview.args'),
  });

  if (!text) return null;

  return { text, truncated: text.length > PREVIEW_LIMIT };
}