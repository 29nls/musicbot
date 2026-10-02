import { EmbedBuilder } from 'discord.js';
import { EMBED_COLORS } from '../../config/constants.js';
import { MODULE_LABELS, type GuildConfig, type ModulesEnabled } from './types.js';

const notSet = '*belum diatur*';

const channel = (id: string | null): string => (id ? `<#${id}>` : notSet);
const role = (id: string | null): string => (id ? `<@&${id}>` : notSet);

function moduleLines(modules: ModulesEnabled): string {
  return (Object.keys(MODULE_LABELS) as (keyof ModulesEnabled)[])
    .map((key) => `${modules[key] ? '✅' : '❌'} **${MODULE_LABELS[key].label}**`)
    .join('\n');
}

/** Ringkasan konfigurasi satu server — dipakai /setup dan /config show. */
export function renderConfigEmbed(config: GuildConfig, title = '⚙️ Konfigurasi Server'): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(EMBED_COLORS.primary)
    .setTitle(title)
    .addFields(
      { name: '📋 Channel log', value: channel(config.logChannelId), inline: true },
      { name: '👋 Channel welcome', value: channel(config.welcomeChannelId), inline: true },
      { name: '🚪 Channel goodbye', value: channel(config.goodbyeChannelId), inline: true },
      { name: '🎧 Role DJ', value: role(config.djRoleId), inline: true },
      { name: '🎭 Autorole member', value: role(config.autoroleId), inline: true },
      { name: '🤖 Autorole bot', value: role(config.autoroleBotId), inline: true },
      { name: '🔊 Volume default', value: `${config.defaultVolume}%`, inline: true },
      { name: '⏱️ Auto-disconnect', value: `${config.idleTimeoutSec} detik`, inline: true },
      { name: '🧩 Modul aktif', value: moduleLines(config.modules) },
      {
        name: '💬 Pesan welcome',
        value: config.welcomeMessage ? config.welcomeMessage.slice(0, 300) : notSet,
      },
      {
        name: '💬 Pesan goodbye',
        value: config.goodbyeMessage ? config.goodbyeMessage.slice(0, 300) : notSet,
      },
    )
    .setTimestamp();
}
