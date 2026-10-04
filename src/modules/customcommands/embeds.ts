import { EmbedBuilder } from 'discord.js';
import { EMBED_COLORS } from '../../config/constants.js';
import { defaultTranslator, type Translator } from '../i18n/index.js';
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
export function creatorLabel(createdBy: string, t: Translator = defaultTranslator): string {
  return createdBy.startsWith('anon:') ? t('cc.creator.anon') : `<@${createdBy}>`;
}

/** Daftar perintah custom di server ini. */
export function customCommandListEmbed(
  commands: readonly CustomCommand[],
  t: Translator = defaultTranslator,
): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(EMBED_COLORS.primary)
    .setTitle(t('cc.list.title'))
    .setTimestamp();

  if (commands.length === 0) {
    embed.setDescription(t('cc.list.empty', { prefix: TRIGGER_PREFIX }));
    return embed;
  }

  embed.setDescription(t('cc.list.count', { count: commands.length, prefix: TRIGGER_PREFIX }));

  embed.addFields({
    name: t('cc.list.field'),
    value: clip(commands.map((command) => `\`${TRIGGER_PREFIX}${command.name}\``).join(' · ')),
  });

  embed.setFooter({ text: t('cc.list.footer') });
  return embed;
}

/** Detail satu perintah, termasuk pratinjau apa yang akan dikirim member. */
export function customCommandDetailEmbed(
  command: CustomCommand,
  preview: CustomCommandPreview | null,
  t: Translator = defaultTranslator,
): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(EMBED_COLORS.primary)
    .setTitle(t('cc.detail.title', { prefix: TRIGGER_PREFIX, name: command.name }))
    .setTimestamp();

  embed.addFields(
    { name: t('cc.detail.createdBy'), value: creatorLabel(command.createdBy, t), inline: true },
    {
      name: t('cc.detail.updated'),
      value: `<t:${Math.floor(command.updatedAt.getTime() / 1000)}:R>`,
      inline: true,
    },
    {
      name: t('cc.detail.invoke'),
      value: `\`${TRIGGER_PREFIX}${command.name} [teks]\``,
      inline: true,
    },
  );

  embed.addFields({ name: t('cc.detail.response'), value: clip(command.response) });

  if (preview) {
    embed.addFields({
      name: t(preview.truncated ? 'cc.detail.previewTruncated' : 'cc.detail.preview'),
      value: clip(preview.text),
    });
  }

  embed.addFields({
    name: t('cc.detail.placeholders'),
    value: PLACEHOLDER_HELP.map((item) => `\`${item.token}\` — ${t(item.labelKey)}`).join('\n'),
  });

  return embed;
}

/** Konfirmasi perintah yang dihapus. */
export function customCommandDeletedEmbed(
  command: CustomCommand,
  t: Translator = defaultTranslator,
): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(EMBED_COLORS.success)
    .setTitle(t('cc.deleted.title'))
    .setDescription(
      t('cc.deleted.description', {
        prefix: TRIGGER_PREFIX,
        name: command.name,
        creator: creatorLabel(command.createdBy, t),
      }),
    )
    .setTimestamp();
}

function clip(text: string): string {
  return text.length <= FIELD_LIMIT ? text : `${text.slice(0, FIELD_LIMIT - 1)}…`;
}
