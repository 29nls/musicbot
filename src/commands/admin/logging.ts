import {
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { getGuildConfigService } from '../../modules/config/index.js';
import {
  CATEGORY_META,
  LOG_CATEGORIES,
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
    if (!interaction.inGuild() || !canManageGuild(interaction)) {
      await interaction.reply({
        embeds: [warningEmbed('Perintah ini butuh izin **Manage Server**.')],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const guildId = interaction.guildId;
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
            `Log **${CATEGORY_META[category].label}** diarahkan ke <#${channel.id}>.`,
            '🧾 Routing Log',
          ),
        );
        return;
      }

      if (subcommand === 'reset' && category) {
        await service.clearChannel(guildId, category);

        await replyShow(
          interaction,
          guildId,
          successEmbed(
            `Routing **${CATEGORY_META[category].label}** dihapus — kembali memakai channel log global.`,
            '🧾 Routing Log',
          ),
        );
        return;
      }

      await replyShow(interaction, guildId);
    } catch (error) {
      await interaction.editReply({ embeds: [toLoggingErrorEmbed(error)] });
    }
  },
} satisfies BotCommand;

/** Balas dengan embed routing terbaru (opsional diawali pesan sukses). */
async function replyShow(
  interaction: ChatInputCommandInteraction,
  guildId: string,
  header?: ReturnType<typeof successEmbed>,
): Promise<void> {
  const [config, subscriptions] = await Promise.all([
    getGuildConfigService().get(guildId),
    getLoggingService().getSubscriptions(guildId),
  ]);

  const routed = new Map(subscriptions.map((item) => [item.category, item.channelId] as const));

  const lines = LOG_CATEGORIES.map((category) => {
    const meta = CATEGORY_META[category];
    const channelId = routed.get(category);

    if (channelId) return `${meta.emoji} **${meta.label}** → <#${channelId}>`;
    if (config.logChannelId) return `${meta.emoji} **${meta.label}** → <#${config.logChannelId}> *(global)*`;
    return `${meta.emoji} **${meta.label}** → *belum diatur*`;
  });

  const embed = infoEmbed('🧾 Routing Log', lines.join('\n')).addFields({
    name: 'Status modul',
    value: config.modules.logging
      ? '✅ Logging aktif.'
      : '❌ Logging mati — nyalakan lewat `/config set logging:true` atau wizard `/setup`.',
  });

  await interaction.editReply({ embeds: header ? [header, embed] : [embed] });
}
