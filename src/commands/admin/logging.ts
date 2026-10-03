import {
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { getGuildConfigService } from '../../modules/config/index.js';
import { defaultTranslator, translatorFor, type Translator } from '../../modules/i18n/index.js';
import {
  CATEGORY_META,
  LOG_CATEGORIES,
  categoryLabel,
  getLoggingService,
  toLoggingErrorEmbed,
  type LogCategory,
} from '../../modules/logging/index.js';
import type { BotCommand } from '../../types/command.js';
import { infoEmbed, successEmbed, warningEmbed } from '../../utils/embeds.js';
import { canManageGuild } from '../../utils/permissions.js';

const CATEGORY_CHOICES = LOG_CATEGORIES.map((category) => ({
  name: CATEGORY_META[category].label,
  value: category,
}));

export default {
  data: new SlashCommandBuilder()
    .setName('logging')
    .setDescription('Atur routing channel log per kategori')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((sub) => sub.setName('show').setDescription('Tampilkan routing log saat ini'))
    .addSubcommand((sub) =>
      sub
        .setName('set')
        .setDescription('Arahkan satu kategori ke channel tertentu')
        .addStringOption((option) =>
          option
            .setName('category')
            .setDescription('Kategori event')
            .setRequired(true)
            .addChoices(...CATEGORY_CHOICES),
        )
        .addChannelOption((option) =>
          option.setName('channel').setDescription('Channel tujuan log kategori ini').setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('reset')
        .setDescription('Hapus routing kategori → kembali memakai channel log global')
        .addStringOption((option) =>
          option
            .setName('category')
            .setDescription('Kategori yang direset')
            .setRequired(true)
            .addChoices(...CATEGORY_CHOICES),
        ),
    ),
  category: 'admin',
  guildOnly: true,
  cooldownSeconds: 5,
  async execute(interaction, _client) {
    if (!interaction.inGuild()) {
      await interaction.reply({
        embeds: [warningEmbed(defaultTranslator('mod.gate.guildOnly'))],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const guildId = interaction.guildId;
    const t = await translatorFor(guildId);

    // Lapis kedua: Discord sudah menyembunyikan perintah di server tanpa izin
    // ini, tapi moderator pun bisa membukanya secara manual.
    if (!canManageGuild(interaction)) {
      await interaction.reply({
        embeds: [warningEmbed(t('mod.gate.needsPermission', { permission: 'Manage Server' }))],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const subcommand = interaction.options.getSubcommand(true);
    const service = getLoggingService();

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      const category = interaction.options.getString('category') as LogCategory | null;

      if (subcommand === 'set' && category) {
        const channel = interaction.options.getChannel('channel', true);
        await service.setChannel(guildId, category, channel.id);

        await replyShow(
          interaction,
          guildId,
          successEmbed(
            t('log.cmd.routingSet', {
              category: categoryLabel(category, t),
              channel: channel.id,
            }),
            t('log.cmd.routingTitle'),
          ),
          t,
        );
        return;
      }

      if (subcommand === 'reset' && category) {
        await service.clearChannel(guildId, category);

        await replyShow(
          interaction,
          guildId,
          successEmbed(
            t('log.cmd.routingReset', { category: categoryLabel(category, t) }),
            t('log.cmd.routingTitle'),
          ),
          t,
        );
        return;
      }

      await replyShow(interaction, guildId, undefined, t);
    } catch (error) {
      await interaction.editReply({ embeds: [toLoggingErrorEmbed(error, t)] });
    }
  },
} satisfies BotCommand;

/** Balas dengan embed routing terbaru (opsional diawali pesan sukses). */
async function replyShow(
  interaction: ChatInputCommandInteraction,
  guildId: string,
  header: ReturnType<typeof successEmbed> | undefined,
  t: Translator,
): Promise<void> {
  const [config, subscriptions] = await Promise.all([
    getGuildConfigService().get(guildId),
    getLoggingService().getSubscriptions(guildId),
  ]);

  const routed = new Map(subscriptions.map((item) => [item.category, item.channelId] as const));

  const lines = LOG_CATEGORIES.map((category) => {
    const emoji = CATEGORY_META[category].emoji;
    const label = categoryLabel(category, t);
    const channelId = routed.get(category);

    if (channelId) return `${emoji} **${label}** → <#${channelId}>`;
    if (config.logChannelId) {
      return `${emoji} **${label}** → <#${config.logChannelId}> *(${t('log.cmd.routingGlobal')})*`;
    }
    return `${emoji} **${label}** → *${t('log.cmd.routingUnset')}*`;
  });

  const embed = infoEmbed(t('log.cmd.routingTitle'), lines.join('\n')).addFields({
    name: t('log.cmd.moduleStatus'),
    value: config.modules.logging
      ? `✅ ${t('log.cmd.moduleOn')}`
      : `❌ ${t('log.cmd.moduleOffLine')}`,
  });

  await interaction.editReply({ embeds: header ? [header, embed] : [embed] });
}
