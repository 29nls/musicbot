import { EmbedBuilder } from 'discord.js';
import { EMBED_COLORS } from '../../config/constants.js';
import { PLACEHOLDER_HELP } from './trigger.js';
import { TRIGGER_PREFIX, type CustomCommand } from './types.js';

/** Batas aman isi field Discord. */
const FIELD_LIMIT = 1_024;

export interface CustomCommandPreview {
  /** Balasan setelah placeholder diganti contoh nilai. */
  text: string;
  /** true kalau contoh balasan lebih panjang dari yang akan dikirim. */
  truncated: boolean;
}

/**
 * Nama pembuat perintah.
 *
 * `anon:` = pseudonim hasil `/data-delete`, jadi mentions atau nama asli tidak
 * boleh ikut tampil di embed lama yang masih dibaca admin.
 */
export function creatorLabel(createdBy: string): string {
  return createdBy.startsWith('anon:') ? 'Anonim' : `<@${createdBy}>`;
}

/** Daftar perintah custom di server ini. */
export function customCommandListEmbed(commands: readonly CustomCommand[]): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(EMBED_COLORS.primary)
    .setTitle('💬 Perintah Custom')
    .setTimestamp();

  if (commands.length === 0) {
    embed.setDescription(
      'Belum ada perintah custom.\nBuat dengan `/customcommand add <nama> <balasan>`, ' +
        'lalu panggil dengan `!nama`.',
    );
    return embed;
  }

  embed.setDescription(
    `${commands.length} perintah. Panggil dengan awalan \`${TRIGGER_PREFIX}\` di channel teks.`,
  );

  embed.addFields({
    name: 'Daftar perintah',
    value: clip(commands.map((command) => `\`${TRIGGER_PREFIX}${command.name}\``).join(' · ')),
  });

  embed.setFooter({ text: `Rincian & pratinjau: /customcommand show <nama>` });
  return embed;
}

/** Detail satu perintah, termasuk pratinjau apa yang akan dikirim member. */
export function customCommandDetailEmbed(
  command: CustomCommand,
  preview: CustomCommandPreview | null,
): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(EMBED_COLORS.primary)
    .setTitle(`💬 ${TRIGGER_PREFIX}${command.name}`)
    .setTimestamp();

  embed.addFields(
    { name: 'Dibuat oleh', value: creatorLabel(command.createdBy), inline: true },
    { name: 'Diubah', value: `<t:${Math.floor(command.updatedAt.getTime() / 1000)}:R>`, inline: true },
    { name: 'Panggil dengan', value: `\`${TRIGGER_PREFIX}${command.name} [teks]\``, inline: true },
  );

  embed.addFields({ name: 'Balasan', value: clip(command.response) });

  if (preview) {
    embed.addFields({
      name: preview.truncated ? 'Pratinjau (dipotong)' : 'Pratinjau',
      value: clip(preview.text),
    });
  }

  embed.addFields({
    name: 'Placeholder yang bisa dipakai',
    value: PLACEHOLDER_HELP.map((item) => `\`${item.token}\` — ${item.label}`).join('\n'),
  });

  return embed;
}

/** Konfirmasi perintah yang dihapus. */
export function customCommandDeletedEmbed(command: CustomCommand): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(EMBED_COLORS.success)
    .setTitle('🗑️ Perintah dihapus')
    .setDescription(
      `\`${TRIGGER_PREFIX}${command.name}\` tidak lagi dipanggil.\n` +
        `Dihapus oleh ${creatorLabel(command.createdBy)}.`,
    )
    .setTimestamp();
}

function clip(text: string): string {
  return text.length <= FIELD_LIMIT ? text : `${text.slice(0, FIELD_LIMIT - 1)}…`;
}