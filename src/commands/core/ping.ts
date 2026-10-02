import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import type { BotCommand } from '../../types/command.js';
import { formatUptime } from '../../utils/duration.js';
import { infoEmbed } from '../../utils/embeds.js';

export default {
  data: new SlashCommandBuilder().setName('ping').setDescription('Cek latensi bot dan status koneksi'),
  category: 'core',
  cooldownSeconds: 3,
  async execute(interaction, client) {
    const startedAt = Date.now();

    await interaction.reply({ content: 'Mengukur latensi…', flags: MessageFlags.Ephemeral });

    const roundtrip = Date.now() - startedAt;
    const embed = infoEmbed('🏓 Pong!', 'Bot menerima perintah dan membalas dengan normal.').addFields(
      { name: 'Gateway', value: `${Math.round(client.ws.ping)} ms`, inline: true },
      { name: 'Roundtrip', value: `${roundtrip} ms`, inline: true },
      { name: 'Uptime', value: formatUptime(client.uptime ?? 0), inline: true },
      { name: 'Server', value: `${client.guilds.cache.size}`, inline: true },
    );

    await interaction.editReply({ content: null, embeds: [embed] });
  },
} satisfies BotCommand;
