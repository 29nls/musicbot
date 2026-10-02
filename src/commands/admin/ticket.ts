import {
  ChannelType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type Guild,
  type GuildMember,
  type GuildTextBasedChannel,
} from 'discord.js';
import { getGuildConfigService } from '../../modules/config/index.js';
import {
  TICKET_LIST_LIMIT,
  buildCreateButton,
  closeAndArchive,
  getTicketService,
  isStaff,
  missingTicketConfig,
  renderTranscriptText,
  ticketListEmbed,
  ticketPanelEmbed,
  ticketTranscriptEmbed,
  toTicketErrorEmbed,
  type Ticket,
} from '../../modules/tickets/index.js';
import type { BotCommand } from '../../types/command.js';
import { successEmbed, warningEmbed } from '../../utils/embeds.js';
import { isGuildTextChannel } from '../../utils/discord.js';
import { canManageGuild } from '../../utils/permissions.js';

export default {
  data: new SlashCommandBuilder()
    .setName('ticket')
    .setDescription('Sistem tiket dasar: channel privat untuk permintaan bantuan')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((sub) =>
      sub
        .setName('setup')
        .setDescription('Atur kategori, role staff, dan kirim tombol tiket')
        .addChannelOption((option) =>
          option
            .setName('category')
            .setDescription('Kategori tempat channel tiket dibuat')
            .addChannelTypes(ChannelType.GuildCategory)
            .setRequired(true),
        )
        .addRoleOption((option) =>
          option
            .setName('staff')
            .setDescription('Role yang bisa melihat & menutup semua tiket')
            .setRequired(true),
        )
        .addChannelOption((option) =>
          option
            .setName('panel')
            .setDescription('Channel tempat tombol "Buat Tiket" dikirim')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
            .setRequired(true),
        )
        .addStringOption((option) =>
          option
            .setName('description')
            .setDescription('Teks pengantar di atas tombol tiket')
            .setMaxLength(1_000),
        ),
    )
    .addSubcommand((sub) => sub.setName('list').setDescription('Daftar tiket yang masih terbuka'))
    .addSubcommand((sub) =>
      sub
        .setName('close')
        .setDescription('Tutup & arsipkan tiket yang sedang dibuka di channel ini'),
    ).addSubcommand((sub) =>
      sub
        .setName('panel')
        .setDescription('Kirim ulang panel tiket ke channel panel'),
    )
    .addSubcommand((sub) =>
      sub
        .setName('transcript')
        .setDescription('Baca transkrip percakapan tiket (staff atau pembuat tiketnya)')
        .addIntegerOption((option) =>
          option
            .setName('ticket')
            .setDescription('Nomor tiket. Kosongkan untuk memakai tiket di channel ini.')
            .setMinValue(1),
        ),
    ),
  category: 'admin',
  guildOnly: true,
  cooldownSeconds: 5,
  async execute(interaction) {
    if (!interaction.inCachedGuild()) {
      await interaction.reply({
        embeds: [warningEmbed('Perintah ini hanya bisa dipakai di server.')],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const guildId = interaction.guildId;
    const guild = interaction.guild;
    const sub = interaction.options.getSubcommand(true);

    // `transcript` sengaja dikecualikan: pembuat tiket boleh membaca transkrip
    // tiketnya sendiri, dan mereka tidak punya izin Manage Server. Kalau gate-nya
    // dipasang di sini, member bahkan tidak akan melihat perintahnya.
    if (sub !== 'transcript' && !canManageGuild(interaction)) {
      await interaction.reply({
        embeds: [warningEmbed('Perintah ini butuh izin **Manage Server**.')],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      const configs = getGuildConfigService();
      const config = await configs.get(guildId);

      if (!config.modules.tickets) {
        await interaction.editReply({
          embeds: [
            warningEmbed(
              'Modul tiket sedang mati.\nNyalakan dengan `/config set tickets:true` dulu.',
              '❌ Modul Mati',
            ),
          ],
        });
        return;
      }

      if (sub === 'transcript') {
        await showTranscript(interaction, guildId, config);
        return;
      }

      if (sub === 'list') {
        const summary = await getTicketService().listOpen(guildId, TICKET_LIST_LIMIT);
        await interaction.editReply({ embeds: [ticketListEmbed(summary.tickets, summary.total)] });
        return;
      }

      if (sub === 'close') {
        await closeFromCommand(interaction, guild);
        return;
      }

      await postPanel(interaction, guild, config, sub === 'setup', configs);
    } catch (error) {
      await interaction.editReply({ embeds: [toTicketErrorEmbed(error)] });
    }
  },
} satisfies BotCommand;

type Interaction = Parameters<BotCommand['execute']>[0];
type ConfigService = ReturnType<typeof getGuildConfigService>;

async function postPanel(
  interaction: Interaction,
  guild: Guild,
  config: Awaited<ReturnType<ConfigService['get']>>,
  isSetup: boolean,
  configs: ConfigService,
): Promise<void> {
  const incomplete = missingTicketConfig(config);
  if (incomplete) {
    await interaction.editReply({ embeds: [warningEmbed(incomplete)] });
    return;
  }

  const staffRoleId = isSetup
    ? interaction.options.getRole('staff', true).id
    : (config.ticketStaffRoleId as string);

  const panelChannel = isSetup
    ? asPanelChannel(interaction.options.getChannel('panel', true))
    : await fetchChannel(guild, config.ticketPanelChannelId);

  if (!panelChannel) {
    await interaction.editReply({
      embeds: [
        warningEmbed(
          'Channel panel tiket tidak bisa dikirim. Pastikan channel-nya masih ada dan bertipe teks.',
        ),
      ],
    });
    return;
  }

  if (isSetup) {
    const category = interaction.options.getChannel('category', true);
    await configs.update(guild.id, {
      ticketCategoryId: category.id,
      ticketStaffRoleId: staffRoleId,
      ticketPanelChannelId: panelChannel.id,
    });
  }

  const sent = await panelChannel.send({
    embeds: [
      ticketPanelEmbed({
        staffRoleId,
        description: interaction.options.getString('description'),
      }),
    ],
    components: [buildCreateButton()],
  });

  // Panel lama dihapus supaya member tidak punya dua tombol yang menunjuk ke
  // dua channel tiket yang berbeda.
  if (config.ticketPanelMessageId) {
    await deleteMessage(guild, config.ticketPanelChannelId, config.ticketPanelMessageId);
  }
  await configs.update(guild.id, { ticketPanelMessageId: sent.id });

  await interaction.editReply({
    embeds: [
      successEmbed(
        isSetup
          ? `Tiket siap dipakai. Panel dikirim ke ${panelChannel}.`
          : `Panel tiket dikirim ulang ke ${panelChannel}.`,
        '🎫 Tiket Disiapkan',
      ),
    ],
  });
}

/**
 * `/ticket close` memakai jalur yang sama dengan tombol tutup, jadi database
 * dan channel tidak pernah bertentangan: satu sudah tertutup, yang lain masih
 * bisa diketik.
 */
/**
 * `/ticket transcript` — tampilkan isi percakapan tiket.
 *
 * Yang boleh membaca: staff tiket, atau member yang membuka tiket itu sendiri.
 * Aturan ini ditegakkan di sini, bukan hanya lewat `setDefaultMemberPermissions`,
 * karena pemilik tiket memang tidak punya izin admin sama sekali.
 */
async function showTranscript(
  interaction: Interaction,
  guildId: string,
  config: Awaited<ReturnType<ConfigService['get']>>,
): Promise<void> {
  const ticket = await resolveTicket(interaction, guildId);
  if (!ticket) {
    await interaction.editReply({
      embeds: [
        warningEmbed(
          'Tiket tidak ditemukan. Jalankan di dalam channel tiketnya, atau sebut nomornya ' +
            'lewat `/ticket transcript ticket:7`.',
        ),
      ],
    });
    return;
  }

  const isOwner = ticket.openerId === interaction.user.id;
  if (!isOwner && !isStaff(interaction.member as GuildMember | null, config)) {
    await interaction.editReply({
      embeds: [
        warningEmbed(
          'Transkrip ini hanya bisa dibaca staff tiket atau member yang membukanya.',
        ),
      ],
    });
    return;
  }

  const transcript = ticket.transcript;
  if (!transcript) {
    await interaction.editReply({
      embeds: [
        warningEmbed(
          'Transkrip untuk tiket ini tidak tersedia. Bisa jadi tiketnya ditutup sebelum ' +
            'fitur transkrip ada, channelnya sudah dihapus manual, atau pembacaan pesannya gagal.',
          '📄 Transkrip Tidak Tersedia',
        ),
      ],
    });
    return;
  }

  const text = renderTranscriptText(ticket, transcript);
  await interaction.editReply({
    embeds: [ticketTranscriptEmbed(ticket, transcript)],
    files: [
      {
        attachment: Buffer.from(text, 'utf8'),
        name: transcriptFileName(ticket),
      },
    ],
  });
}

/** Tiket yang dimaksud: dari nomor opsional, atau dari channel tempat perintah dipanggil. */
async function resolveTicket(interaction: Interaction, guildId: string): Promise<Ticket | null> {
  const ticketNumber = interaction.options.getInteger('ticket');
  const service = getTicketService();

  if (ticketNumber !== null) return service.findByNumber(guildId, ticketNumber);

  return service.findAnyByChannel(guildId, interaction.channelId);
}

/** `transkrip-tiket-0007.txt` — nomor tiket dipadatkan supaya rapi saat diunduh. */
function transcriptFileName(ticket: Ticket): string {
  const number = ticket.ticketNumber.toString().padStart(4, '0');

  return `transkrip-tiket-${number}.txt`;
}

async function closeFromCommand(interaction: Interaction, guild: Guild): Promise<void> {
  const ticket = await getTicketService().findOpenByChannel(guild.id, interaction.channelId);
  if (!ticket) {
    await interaction.editReply({
      embeds: [
        warningEmbed(
          'Tidak ada tiket terbuka di channel ini. Jalankan perintah ini di dalam channel tiketnya.',
        ),
      ],
    });
    return;
  }

  const result = await closeAndArchive(
    getTicketService(),
    guild,
    interaction.channelId,
    interaction.user.id,
  );
  if (!result) {
    await interaction.editReply({ embeds: [warningEmbed('Tiket ini sudah ditutup.')] });
    return;
  }

  if (!result.channel) {
    await interaction.editReply({
      embeds: [
        warningEmbed(
          `Tiket ${result.ticket.ticketNumber} ditandai sudah ditutup, tapi channelnya tidak bisa diarsipkan ` +
            '(kemungkinan sudah dihapus manual).',
        ),
      ],
    });
    return;
  }

  await interaction.editReply({
    embeds: [
      successEmbed(`Tiket ${result.ticket.ticketNumber} ditutup dan diarsipkan.`),
    ],
  });
}

async function fetchChannel(
  guild: Guild,
  channelId: string | null,
): Promise<GuildTextBasedChannel | null> {
  if (!channelId) return null;

  const channel = await guild.channels.fetch(channelId).catch(() => null);

  return isGuildTextChannel(channel) ? channel : null;
}

/** Sama seperti `fetchChannel`, tapi untuk channel dari opsi slash command. */
function asPanelChannel(channel: unknown): GuildTextBasedChannel | null {
  return isGuildTextChannel(channel) ? channel : null;
}

async function deleteMessage(
  guild: Guild,
  channelId: string | null,
  messageId: string,
): Promise<void> {
  const channel = await fetchChannel(guild, channelId);
  if (!channel) return;

  await channel.messages.delete(messageId).catch(() => undefined);
}