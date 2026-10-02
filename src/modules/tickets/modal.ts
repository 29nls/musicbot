import {
  ActionRowBuilder,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type EmbedBuilder,
  type GuildMember,
  type ModalSubmitInteraction,
} from 'discord.js';
import { getLogger } from '../../services/logger.js';
import { successEmbed, warningEmbed } from '../../utils/embeds.js';
import { getGuildConfigService, type GuildConfig } from '../config/index.js';
import { toTicketErrorEmbed } from './errors.js';
import { openTicket, type OpenTicketOutcome } from './lifecycle.js';
import { getTicketService } from './singleton.js';
import {
  MODAL_SUBJECT_MAX_LENGTH,
  MODAL_SUBJECT_MIN_LENGTH,
  TICKET_SUBJECT_MODAL,
  isTicketSubjectModal,
} from './types.js';
import { missingTicketConfig, parseTicketSubject } from './validation.js';

/** customId text input di dalam modal. */
const SUBJECT_FIELD = 'subjek';

/** Modal yang meminta topik singkat dari member. */
export function buildTicketSubjectModal(): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(TICKET_SUBJECT_MODAL)
    .setTitle('Buat Tiket')
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId(SUBJECT_FIELD)
          .setLabel('Topik tiket')
          .setPlaceholder('Contoh: tidak bisa masuk voice channel')
          .setStyle(TextInputStyle.Short)
          .setMinLength(MODAL_SUBJECT_MIN_LENGTH)
          .setMaxLength(MODAL_SUBJECT_MAX_LENGTH)
          .setRequired(true),
      ),
    );
}

/**
 * Tombol "Buat Tiket" membuka modal, bukan langsung membuat channel.
 *
 * Meminta topik lebih dulu membuat channel tiket langsung berguna: staff tahu
 * harus menyiapkan apa sebelum member mengetik pesan pertama, dan member tidak
 * perlu mengulang cerita di channel yang salah.
 */
export async function showTicketSubjectModal(
  interaction: ButtonInteraction,
  config: GuildConfig,
): Promise<void> {
  const incomplete = missingTicketConfig(config);
  if (incomplete) {
    await reply(interaction, warningEmbed(incomplete));
    return;
  }

  try {
    await interaction.showModal(buildTicketSubjectModal());
  } catch (error) {
    getLogger().warn({ err: error, guild: interaction.guildId }, 'Gagal membuka modal tiket');
    await reply(
      interaction,
      warningEmbed('Tidak bisa membuka formulir tiket. Coba lagi sebentar lagi.'),
    );
  }
}

/**
 * Kirim modal yang sudah diisi → buat channel tiket.
 *
 * Konfigurasi server dicek ulang di sini, bukan hanya saat modal dibuka: di
 * antara membuka formulir dan mengirimnya, admin bisa saja mematikan modul,
 * memindahkan kategori, atau mengganti role staff.
 */
export async function handleTicketSubjectSubmit(
  interaction: ModalSubmitInteraction,
): Promise<void> {
  if (!isTicketSubjectModal(interaction.customId)) return;

  const guild = interaction.guild;
  if (!guild) return;

  let subject: string;
  try {
    subject = parseTicketSubject(interaction.fields.getTextInputValue(SUBJECT_FIELD));
  } catch (error) {
    await reply(interaction, toTicketErrorEmbed(error));
    return;
  }

  try {
    const config = await getGuildConfigService().get(guild.id);
    if (!config.modules.tickets) {
      await reply(interaction, warningEmbed('Modul tiket sedang mati di server ini.'));
      return;
    }

    const incomplete = missingTicketConfig(config);
    if (incomplete) {
      await reply(interaction, warningEmbed(incomplete));
      return;
    }

    const member = interaction.member as GuildMember | null;
    const outcome = await openTicket(getTicketService(), guild, {
      staffRoleId: config.ticketStaffRoleId as string,
      openerId: member?.id ?? interaction.user.id,
      subject,
    });

    if (!outcome.ok) {
      await reply(interaction, failureEmbed(outcome));
      return;
    }

    await reply(
      interaction,
      successEmbed(`Tiket dibuat: <#${outcome.channel.id}>. Topik: **${outcome.ticket.subject}**`),
    );
  } catch (error) {
    getLogger().error(
      { err: error, guild: guild.id, user: interaction.user.id },
      'Pengiriman formulir tiket gagal',
    );
    await reply(interaction, toTicketErrorEmbed(error));
  }
}

/** Pesan yang tepat untuk setiap kegagalan, tanpa menebak. */
function failureEmbed(outcome: Extract<OpenTicketOutcome, { ok: false }>): EmbedBuilder {
  if (outcome.reason === 'duplicate') {
    return warningEmbed(
      outcome.existingChannelId
        ? `Kamu sudah punya tiket terbuka: <#${outcome.existingChannelId}>. Tutup dulu sebelum membuka yang baru.`
        : 'Kamu sudah punya tiket terbuka. Tutup dulu sebelum membuka yang baru.',
    );
  }

  return warningEmbed(
    'Gagal membuat channel tiket. Pastikan aku punya izin **Manage Channels** ' +
      'dan kategori tiket yang kamu tentukan masih ada.',
  );
}

async function reply(
  interaction: ButtonInteraction | ModalSubmitInteraction,
  embed: EmbedBuilder,
): Promise<void> {
  try {
    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  } catch (error) {
    // Tombol & modal punya jendela balasan pendek; kalau sudah kedaluwarsa
    // tidak ada yang bisa dilakukan selain mencatatnya.
    getLogger().warn({ err: error }, 'Gagal membalas formulir tiket');
  }
}