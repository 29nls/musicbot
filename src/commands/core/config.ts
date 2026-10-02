import {
  ChannelType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import {
  getGuildConfigService,
  renderConfigEmbed,
  toConfigErrorEmbed,
  type GuildConfigPatch,
} from '../../modules/config/index.js';
import type { BotCommand } from '../../types/command.js';
import { successEmbed, warningEmbed } from '../../utils/embeds.js';
import { canManageGuild } from '../../utils/permissions.js';

export default {
  data: new SlashCommandBuilder()
    .setName('config')
    .setDescription('Lihat atau ubah konfigurasi bot di server ini')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((sub) => sub.setName('show').setDescription('Tampilkan konfigurasi yang sedang berlaku'))
    .addSubcommand((sub) =>
      sub
        .setName('set')
        .setDescription('Ubah pengaturan (opsi yang dikosongkan tidak diubah)')
        .addChannelOption((option) =>
          option
            .setName('log-channel')
            .setDescription('Channel tujuan log event')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
        )
        .addChannelOption((option) =>
          option
            .setName('welcome-channel')
            .setDescription('Channel pesan sambutan member baru')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
        )
        .addChannelOption((option) =>
          option
            .setName('goodbye-channel')
            .setDescription('Channel pesan member keluar')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
        )
        .addRoleOption((option) =>
          option.setName('dj-role').setDescription('Role yang boleh mengontrol musik'),
        )
        .addRoleOption((option) =>
          option.setName('autorole').setDescription('Role otomatis untuk member manusia yang baru join'),
        )
        .addRoleOption((option) =>
          option.setName('autorole-bot').setDescription('Role otomatis untuk bot yang baru join'),
        )
        .addIntegerOption((option) =>
          option
            .setName('volume')
            .setDescription('Volume default 0–200 (%)')
            .setMinValue(0)
            .setMaxValue(200),
        )
        .addIntegerOption((option) =>
          option
            .setName('idle-timeout')
            .setDescription('Detik sebelum bot keluar dari voice channel (30–86400)')
            .setMinValue(30)
            .setMaxValue(86_400),
        )
        .addStringOption((option) =>
          option
            .setName('welcome-message')
            .setDescription('Pesan sambutan; placeholder {user} {mention} {server} {count}')
            .setMaxLength(1_500),
        )
        .addStringOption((option) =>
          option
            .setName('goodbye-message')
            .setDescription('Pesan perpisahan; placeholder {user} {mention} {server} {count}')
            .setMaxLength(1_500),
        ),
    )
    .addSubcommand((sub) => sub.setName('reset').setDescription('Hapus konfigurasi dan kembali ke default')),
  category: 'core',
  guildOnly: true,
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
    const service = getGuildConfigService();

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      if (subcommand === 'show') {
        const config = await service.get(guildId);
        await interaction.editReply({ embeds: [renderConfigEmbed(config)] });
        return;
      }

      if (subcommand === 'reset') {
        const config = await service.reset(guildId);
        await interaction.editReply({
          embeds: [successEmbed('Konfigurasi dihapus dan kembali ke default.'), renderConfigEmbed(config)],
        });
        return;
      }

      const patch = buildPatch(interaction);
      if (Object.keys(patch).length === 0) {
        await interaction.editReply({
          embeds: [warningEmbed('Tidak ada opsi yang diisi, jadi tidak ada yang diubah.')],
        });
        return;
      }

      const updated = await service.update(guildId, patch);
      await interaction.editReply({
        embeds: [
          successEmbed('Konfigurasi diperbarui dan langsung berlaku — tanpa restart bot.'),
          renderConfigEmbed(updated),
        ],
      });
    } catch (error) {
      await interaction.editReply({ embeds: [toConfigErrorEmbed(error)] });
    }
  },
} satisfies BotCommand;

/** Kumpulkan opsi yang benar-benar diisi user. Opsi kosong tidak ikut dikirim. */
function buildPatch(interaction: ChatInputCommandInteraction): GuildConfigPatch {
  const patch: GuildConfigPatch = {};

  const logChannel = interaction.options.getChannel('log-channel');
  if (logChannel) patch.logChannelId = logChannel.id;

  const welcomeChannel = interaction.options.getChannel('welcome-channel');
  if (welcomeChannel) patch.welcomeChannelId = welcomeChannel.id;

  const goodbyeChannel = interaction.options.getChannel('goodbye-channel');
  if (goodbyeChannel) patch.goodbyeChannelId = goodbyeChannel.id;

  const djRole = interaction.options.getRole('dj-role');
  if (djRole) patch.djRoleId = djRole.id;

  const autorole = interaction.options.getRole('autorole');
  if (autorole) patch.autoroleId = autorole.id;

  const autoroleBot = interaction.options.getRole('autorole-bot');
  if (autoroleBot) patch.autoroleBotId = autoroleBot.id;

  const volume = interaction.options.getInteger('volume');
  if (volume !== null) patch.defaultVolume = volume;

  const idleTimeout = interaction.options.getInteger('idle-timeout');
  if (idleTimeout !== null) patch.idleTimeoutSec = idleTimeout;

  const welcomeMessage = interaction.options.getString('welcome-message');
  if (welcomeMessage !== null) patch.welcomeMessage = welcomeMessage;

  const goodbyeMessage = interaction.options.getString('goodbye-message');
  if (goodbyeMessage !== null) patch.goodbyeMessage = goodbyeMessage;

  return patch;
}
