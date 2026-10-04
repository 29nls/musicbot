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
import { defaultTranslator, translatorFor, type Translator } from '../i18n/index.js';
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
export function buildTicketSubjectModal(
  t: Translator = defaultTranslator,
): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(TICKET_SUBJECT_MODAL)
    .setTitle(t('ticket.modal.title'))
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId(SUBJECT_FIELD)
          .setLabel(t('ticket.modal.subjectLabel'))
          .setPlaceholder(t('ticket.modal.subjectPlaceholder'))
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
  t: Translator = defaultTranslator,
): Promise<void> {
  const incomplete = missingTicketConfig(config, t);
  if (incomplete) {
    await reply(interaction, warningEmbed(incomplete, t('embed.title.warning')));
    return;
  }

  try {
    await interaction.showModal(buildTicketSubjectModal(t));
  } catch (error) {
    getLogger().warn({ err: error, guild: interaction.guildId }, 'Gagal membuka modal tiket');
    await reply(
      interaction,
      warningEmbed(t('ticket.modal.openFailed'), t('embed.title.warning')),
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

  const t = await translatorFor(guild.id);

  let subject: string;
  try {
    subject = parseTicketSubject(interaction.fields.getTextInputValue(SUBJECT_FIELD));
  } catch (error) {
    await reply(interaction, toTicketErrorEmbed(error, t));
    return;
  }

  try {
    const config = await getGuildConfigService().get(guild.id);
    if (!config.modules.tickets) {
      await reply(interaction, warningEmbed(t('ticket.err.moduleOff'), t('embed.title.warning')));
      return;
    }

    const incomplete = missingTicketConfig(config, t);
    if (incomplete) {
      await reply(interaction, warningEmbed(incomplete, t('embed.title.warning')));
      return;
    }

    const member = interaction.member as GuildMember | null;
    const outcome = await openTicket(
      getTicketService(),
      guild,
      {
        staffRoleId: config.ticketStaffRoleId as string,
        openerId: member?.id ?? interaction.user.id,
        subject,
      },
      t,
    );

    if (!outcome.ok) {
      await reply(interaction, failureEmbed(outcome, t));
      return;
    }

    await reply(
      interaction,
      successEmbed(t('ticket.modal.created', {
        channel: outcome.channel.id,
        subject: outcome.ticket.subject ?? '',
      }), t('embed.title.success')),
    );
  } catch (error) {
    getLogger().error(
      { err: error, guild: guild.id, user: interaction.user.id },
      'Pengiriman formulir tiket gagal',
    );
    await reply(interaction, toTicketErrorEmbed(error, t));
  }
}

/** Pesan yang tepat untuk setiap kegagalan, tanpa menebak. */
function failureEmbed(
  outcome: Extract<OpenTicketOutcome, { ok: false }>,
  t: Translator,
): EmbedBuilder {
  if (outcome.reason === 'duplicate') {
    return warningEmbed(
      outcome.existingChannelId
        ? t('ticket.modal.duplicateWithChannel', { channel: outcome.existingChannelId })
        : t('ticket.modal.duplicate'),
    );
  }

  return warningEmbed(t('ticket.err.channelFailed'), t('embed.title.warning'));
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