import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  type MessageActionRowComponentBuilder,
} from 'discord.js';
import { EMBED_COLORS } from '../../config/constants.js';
import { defaultTranslator, type Translator } from '../i18n/index.js';
import {
  MAX_TRANSCRIPT_MESSAGES,
  TRANSCRIPT_PREVIEW_COUNT,
  transcriptPreviewLines,
  type TicketTranscript,
} from './transcript.js';
import { formatTicketId, ticketButtonId, type Ticket } from './types.js';

const toUnix = (date: Date): number => Math.floor(date.getTime() / 1_000);

/** Embed tombol "Buat Tiket" yang dikirim ke channel publik. */
export function ticketPanelEmbed(
  input: {
    staffRoleId: string;
    /** Keterangan tambahan yang Posted admin; null = pakai teks bawaan. */
    description?: string | null;
  },
  t: Translator = defaultTranslator,
): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(EMBED_COLORS.primary)
    .setTitle(t('ticket.panel.title'))
    .setDescription(input.description?.trim() || t('ticket.panel.intro'))
    .addFields({ name: t('ticket.panel.staff'), value: `<@&${input.staffRoleId}>`, inline: true })
    .setFooter({ text: t('ticket.panel.footer') })
    .setTimestamp();
}

/** Tombol "Buat Tiket" di panel publik. */
export function buildCreateButton(
  t: Translator = defaultTranslator,
): ActionRowBuilder<MessageActionRowComponentBuilder> {
  return new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(ticketButtonId('create'))
      .setLabel(t('ticket.button.create'))
      .setStyle(ButtonStyle.Primary)
      .setEmoji('🎫'),
  );
}

/** Embed perkenalan di channel tiket yang baru dibuat. */
export function ticketOpenedEmbed(
  ticket: Ticket,
  staffRoleId: string,
  t: Translator = defaultTranslator,
): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(EMBED_COLORS.success)
    .setTitle(t('ticket.opened.title', { id: formatTicketId(ticket.ticketNumber) }))
    .setDescription(t('ticket.opened.intro'))
    .addFields(
      { name: t('ticket.opened.opener'), value: `<@${ticket.openerId}>`, inline: true },
      { name: t('ticket.opened.staff'), value: `<@&${staffRoleId}>`, inline: true },
      {
        name: t('ticket.opened.subject'),
        value: ticket.subject ?? t('ticket.opened.noSubject'),
      },
    )
    .setTimestamp();
}

/** Tombol di dalam channel tiket: klaim & tutup (keduanya khusus staff). */
export function buildTicketControls(
  t: Translator = defaultTranslator,
): ActionRowBuilder<MessageActionRowComponentBuilder> {
  return new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(ticketButtonId('claim'))
      .setLabel(t('ticket.button.claim'))
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('✋'),
    new ButtonBuilder()
      .setCustomId(ticketButtonId('close'))
      .setLabel(t('ticket.button.close'))
      .setStyle(ButtonStyle.Danger)
      .setEmoji('🔒'),
  );
}

/** Embed pengingat bahwa tiket sudah ditutup & diarsipkan. */
export function ticketClosedEmbed(
  ticket: Ticket,
  closedBy: string,
  t: Translator = defaultTranslator,
): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(EMBED_COLORS.warning)
    .setTitle(t('ticket.closed.title', { id: formatTicketId(ticket.ticketNumber) }))
    .setDescription(t('ticket.closed.description'))
    .addFields({ name: t('ticket.closed.by'), value: `<@${closedBy}>`, inline: true })
    .setTimestamp();
}

/** Embed daftar tiket terbuka untuk staff. */
export function ticketListEmbed(
  tickets: readonly Ticket[],
  total: number,
  t: Translator = defaultTranslator,
): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(EMBED_COLORS.primary)
    .setTitle(t('ticket.list.title'))
    .setTimestamp();

  if (tickets.length === 0) {
    return embed.setDescription(t('ticket.list.empty'));
  }

  const lines = tickets.map((ticket) => {
    const channel = ticket.channelId
      ? `<#${ticket.channelId}>`
      : t('ticket.list.channelGone');
    const claimer = ticket.claimedBy
      ? t('ticket.list.claimer', { user: ticket.claimedBy })
      : '';
    const subject = ticket.subject ? t('ticket.list.subject', { subject: ticket.subject }) : '';

    return t('ticket.list.line', {
      id: formatTicketId(ticket.ticketNumber),
      channel,
      opener: ticket.openerId,
      subject,
      created: String(toUnix(ticket.createdAt)),
      claimer,
    });
  });

  const note =
    total > tickets.length ? t('ticket.list.more', { count: String(total - tickets.length) }) : '';

  return embed
    .setDescription(truncate(`${lines.join('\n\n')}${note}`, 4_000))
    .setFooter({ text: t('ticket.list.footer', { count: String(total) }) });
}

/**
 * Ringkasan transkrip + cuplikan isi.
 *
 * Cuplikan memakai pesan **terakhir**, bukan yang pertama: saat member membuka
 * transkrip, yang dia cari hampir selalu bagian terakhirnya. Isi lengkap ada di
 * file teks yang dilampirkan, jadi yang dipotong di sini tidak ada yang hilang.
 */
export function ticketTranscriptEmbed(
  ticket: Ticket,
  transcript: TicketTranscript,
  t: Translator = defaultTranslator,
): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(EMBED_COLORS.primary)
    .setTitle(t('ticket.transcript.title', { id: formatTicketId(ticket.ticketNumber) }))
    .addFields(
      {
        name: t('ticket.transcript.ticketField'),
        value: [
          ticket.subject ?? t('ticket.transcript.noSubject'),
          t('ticket.transcript.openerLine', { user: ticket.openerId }),
          ticket.closedAt
            ? t('ticket.transcript.closedLine', { time: String(toUnix(ticket.closedAt)) })
            : t('ticket.transcript.openStatus'),
        ].join('\n'),
        inline: false,
      },
      {
        name: t('ticket.transcript.contentField'),
        value: t('ticket.transcript.count', { count: String(transcript.messageCount) }),
        inline: true,
      },
    )
    .setTimestamp();

  if (transcript.truncated) {
    embed.addFields({
      name: t('ticket.transcript.truncatedTitle'),
      value: t('ticket.transcript.truncatedBody', { max: String(MAX_TRANSCRIPT_MESSAGES) }),
      inline: false,
    });
  }

  return embed.setDescription(
    truncate(
      t('ticket.transcript.previewHeader', {
        count: String(transcript.messages.length),
        lines: transcriptPreviewLines(transcript, TRANSCRIPT_PREVIEW_COUNT, t),
      }),
      4_000,
    ),
  );
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}
