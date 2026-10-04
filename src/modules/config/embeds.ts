import { EmbedBuilder } from 'discord.js';
import { EMBED_COLORS } from '../../config/constants.js';
import { LOCALE_LABELS, defaultTranslator, toLocale, type Translator } from '../i18n/index.js';
import { moduleLabel } from './labels.js';
import { MODULE_LABELS, type GuildConfig, type ModulesEnabled } from './types.js';

const channel = (id: string | null, t: Translator): string =>
  id ? `<#${id}>` : t('config.value.notSet');
const role = (id: string | null, t: Translator): string =>
  id ? `<@&${id}>` : t('config.value.notSet');

function moduleLines(modules: ModulesEnabled, t: Translator): string {
  return (Object.keys(MODULE_LABELS) as (keyof ModulesEnabled)[])
    .map((key) => `${modules[key] ? '✅' : '❌'} **${moduleLabel(key, t)}**`)
    .join('\n');
}

/**
 * Ringkasan konfigurasi satu server — dipakai `/setup` dan `/config`.
 *
 * Judul dikirim pemanggil, bukan ditulis di sini, karena `/config` memakai
 * judul konfigurasi sedangkan `/setup` memakai judul wizardnya sendiri, dan
 * keduanya harus ikut bahasa server. Nama bahasa di field locale sengaja
 * memakai nama bahasa itu sendiri (endonym) di kedua bahasa: orang mencari
 * "English", bukan "Inggris", saat server-nya English.
 */
export function renderConfigEmbed(
  config: GuildConfig,
  title: string,
  t: Translator = defaultTranslator,
): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(EMBED_COLORS.primary)
    .setTitle(title)
    .addFields(
      { name: t('config.field.logChannel'), value: channel(config.logChannelId, t), inline: true },
      {
        name: t('config.field.welcomeChannel'),
        value: channel(config.welcomeChannelId, t),
        inline: true,
      },
      {
        name: t('config.field.goodbyeChannel'),
        value: channel(config.goodbyeChannelId, t),
        inline: true,
      },
      { name: t('config.field.djRole'), value: role(config.djRoleId, t), inline: true },
      { name: t('config.field.autoroleMember'), value: role(config.autoroleId, t), inline: true },
      { name: t('config.field.autoroleBot'), value: role(config.autoroleBotId, t), inline: true },
      { name: t('config.field.volume'), value: `${config.defaultVolume}%`, inline: true },
      {
        name: t('config.field.idleTimeout'),
        value: t('config.value.seconds', { count: config.idleTimeoutSec }),
        inline: true,
      },
      {
        name: t('config.field.stayChannel'),
        value: config.stayChannelId
          ? t('config.value.stayActive', { channel: channel(config.stayChannelId, t) })
          : t('config.value.stayOff', { none: t('config.value.notSet') }),
        inline: true,
      },
      {
        name: t('config.field.locale'),
        value: `${LOCALE_LABELS[toLocale(config.locale)]} (\`${toLocale(config.locale)}\`)`,
        inline: true,
      },
      { name: t('config.field.modules'), value: moduleLines(config.modules, t) },
      {
        name: t('config.field.ticketPanel'),
        value: channel(config.ticketPanelChannelId, t),
        inline: true,
      },
      {
        name: t('config.field.ticketCategory'),
        value: channel(config.ticketCategoryId, t),
        inline: true,
      },
      {
        name: t('config.field.ticketStaffRole'),
        value: role(config.ticketStaffRoleId, t),
        inline: true,
      },
      {
        name: t('config.field.welcomeMessage'),
        value: config.welcomeMessage ? config.welcomeMessage.slice(0, 300) : t('config.value.notSet'),
      },
      {
        name: t('config.field.goodbyeMessage'),
        value: config.goodbyeMessage ? config.goodbyeMessage.slice(0, 300) : t('config.value.notSet'),
      },
    )
    .setTimestamp();
}