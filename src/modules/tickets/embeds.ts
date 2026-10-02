import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  type MessageActionRowComponentBuilder,
} from 'discord.js';
import { EMBED_COLORS } from '../../config/constants.js';
import { formatTicketId, ticketButtonId, type Ticket } from './types.js';

const toUnix = (date: Date): number => Math.floor(date.getTime() / 1_000);

/** Embed tombol "Buat Tiket" yang dikirim ke channel publik. */
export function ticketPanelEmbed(input: {
  staffRoleId: string;
  /** Keterangan tambahan yang Posted admin; null = pakai teks bawaan. */
  description?: string | null;
}): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(EMBED_COLORS.primary)
    .setTitle('🎫 Butuh Bantuan?')
    .setDescription(
      input.description?.trim() ||
        'Klik tombol di bawah, isi topik singkat, lalu channel privatmu akan dibuat. ' +
          'Hanya kamu dan tim staff yang bisa membacanya.',
    )
    .addFields({ name: '👮 Staff', value: `<@&${input.staffRoleId}>`, inline: true })
    .setFooter({
      text: 'Satu member hanya boleh punya satu tiket terbuka · tutup tiketmu sebelum membuka yang baru',
    })
    .setTimestamp();
}

/** Tombol "Buat Tiket" di panel publik. */
export function buildCreateButton(): ActionRowBuilder<MessageActionRowComponentBuilder> {
  return new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(ticketButtonId('create'))
      .setLabel('Buat Tiket')
      .setStyle(ButtonStyle.Primary)
      .setEmoji('🎫'),
  );
}

/** Embed perkenalan di channel tiket yang baru dibuat. */
export function ticketOpenedEmbed(ticket: Ticket, staffRoleId: string): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(EMBED_COLORS.success)
    .setTitle(`🎫 Tiket ${formatTicketId(ticket.ticketNumber)} dibuka`)
    .setDescription(
      'Sebutkan masalahmu di sini — semakin lengkap, semakin cepat staff bisa membantu.',
    )
    .addFields(
      { name: 'Pembuat', value: `<@${ticket.openerId}>`, inline: true },
      { name: 'Staff', value: `<@&${staffRoleId}>`, inline: true },
      {
        name: 'Subjek',
        value: ticket.subject ?? '*tidak disebutkan*',
      },
    )
    .setTimestamp();
}

/** Tombol di dalam channel tiket: klaim & tutup (keduanya khusus staff). */
export function buildTicketControls(): ActionRowBuilder<MessageActionRowComponentBuilder> {
  return new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(ticketButtonId('claim'))
      .setLabel('Klaim')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('✋'),
    new ButtonBuilder()
      .setCustomId(ticketButtonId('close'))
      .setLabel('Tutup Tiket')
      .setStyle(ButtonStyle.Danger)
      .setEmoji('🔒'),
  );
}

/** Embed pengingat bahwa tiket sudah ditutup & diarsipkan. */
export function ticketClosedEmbed(ticket: Ticket, closedBy: string): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(EMBED_COLORS.warning)
    .setTitle(`🔒 Tiket ${formatTicketId(ticket.ticketNumber)} ditutup`)
    .setDescription(
      'Channel ini sudah dikunci dan tidak bisa dipakai lagi. Riwayatnya tetap tersimpan di sini untuk dibaca staff.',
    )
    .addFields({ name: 'Ditutup oleh', value: `<@${closedBy}>`, inline: true })
    .setTimestamp();
}

/** Embed daftar tiket terbuka untuk staff. */
export function ticketListEmbed(tickets: readonly Ticket[], total: number): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(EMBED_COLORS.primary)
    .setTitle('🎫 Tiket Terbuka')
    .setTimestamp();

  if (tickets.length === 0) {
    return embed.setDescription('Tidak ada tiket terbuka. Bagus!');
  }

  const lines = tickets.map((ticket) => {
    const channel = ticket.channelId ? `<#${ticket.channelId}>` : '*channel hilang*';
    const claimer = ticket.claimedBy ? ` · ditangani <@${ticket.claimedBy}>` : '';
    const subject = ticket.subject ? ` — ${ticket.subject}` : '';

    return (
      `**${formatTicketId(ticket.ticketNumber)}** ${channel} · <@${ticket.openerId}>` +
      `${subject}\n< <t:${toUnix(ticket.createdAt)}:R>${claimer}`
    );
  });

  const note = total > tickets.length ? `\n\n*+${total - tickets.length} tiket lain tidak ditampilkan.*` : '';

  return embed
    .setDescription(truncate(`${lines.join('\n\n')}${note}`, 4_000))
    .setFooter({ text: `${total} tiket terbuka` });
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}