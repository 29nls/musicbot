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
  type ModulesEnabled,
} from '../../modules/config/index.js';
import {
  LOCALE_LABELS,
  LOCALES,
  getLocaleService,
  parseLocale,
  toLocale,
  translatorForLocale,
} from '../../modules/i18n/index.js';
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
        .addChannelOption((option) =>
          option
            .setName('stay-channel')
            .setDescription('Voice channel yang dijaga 24/7 (matikan lewat /247 leave)')
            .addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice),
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
        )
        .addStringOption((option) =>
          option
            .setName('locale')
            .setDescription('Bahasa balasan bot (id atau en)')
            .addChoices(
              ...LOCALES.map((locale) => ({
                name: LOCALE_LABELS[locale],
                value: locale,
              })),
            ),
        )
        .addBooleanOption((option) => option.setName('music').setDescription('Modul musik aktif?'))
        .addBooleanOption((option) =>
          option.setName('moderation').setDescription('Modul moderasi aktif?'),
        )
        .addBooleanOption((option) =>
          option.setName('automod').setDescription('Modul automod aktif?'),
        )
        .addBooleanOption((option) => option.setName('logging').setDescription('Modul logging aktif?'))
        .addBooleanOption((option) =>
          option.setName('custom-commands').setDescription('Modul perintah custom (!nama) aktif?'),
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

      // Cache bahasa langsung dibuang supaya perintah berikutnya membaca
      // bahasa yang baru, bukan menunggu TTL habis.
      if (patch.locale !== undefined) {
        getLocaleService().invalidate(guildId);
      }

      // Konfirmasi ditulis dalam bahasa yang baru dipilih: orang yang baru
      // menyalakan bahasa Inggris harus melihat bukti bahwa itu berhasil.
      const locale = toLocale(updated.locale);
      const t = translatorForLocale(locale);
      const summary =
        patch.locale !== undefined
          ? t('config.locale.changed', { locale: LOCALE_LABELS[locale] })
          : 'Konfigurasi diperbarui dan langsung berlaku — tanpa restart bot.';

      await interaction.editReply({
        embeds: [successEmbed(summary), renderConfigEmbed(updated)],
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

  const stayChannel = interaction.options.getChannel('stay-channel');
  if (stayChannel) patch.stayChannelId = stayChannel.id;

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

  // Bahasa tidak dikenal ditolak di sini, bukan diteruskan ke validasi config:
  // pesannya bisa menyebut daftar yang benar, sementara pesan zod hanya
  // menyebut nama field.
  const rawLocale = interaction.options.getString('locale');
  if (rawLocale !== null) {
    const locale = parseLocale(rawLocale);
    if (!locale) {
      throw new Error(
        'Bahasa itu tidak dikenal. Pilihan yang tersedia: ' +
          LOCALES.map((item) => LOCALE_LABELS[item]).join(' / '),
      );
    }

    patch.locale = locale;
  }

  const modules: Partial<ModulesEnabled> = {};
  const music = interaction.options.getBoolean('music');
  if (music !== null) modules.music = music;
  const moderation = interaction.options.getBoolean('moderation');
  if (moderation !== null) modules.moderation = moderation;
  const automod = interaction.options.getBoolean('automod');
  if (automod !== null) modules.automod = automod;
  const logging = interaction.options.getBoolean('logging');
  if (logging !== null) modules.logging = logging;
  const customCommands = interaction.options.getBoolean('custom-commands');
  if (customCommands !== null) modules.customCommands = customCommands;
  if (Object.keys(modules).length > 0) patch.modules = modules;

  return patch;
}
