import { SlashCommandBuilder } from 'discord.js';
import { buildQueuePage, queueEmbed, queueNavRow } from '../../modules/music/index.js';
import type { BotCommand } from '../../types/command.js';
import { infoEmbed } from '../../utils/embeds.js';
import { gateMusicCommand, handleMusicFailure, replyEphemeralError } from './_shared.js';

export default {
  data: new SlashCommandBuilder().setName('queue').setDescription('Tampilkan antrean lagu di server ini'),
  category: 'music',
  guildOnly: true,
  async execute(interaction, _client) {
    await interaction.deferReply();

    try {
      const gate = await gateMusicCommand(interaction);
      if (!gate.ok) {
        await replyEphemeralError(interaction, gate.embed);
        return;
      }

      const { music, guildId, t } = gate.ctx;
      const snapshot = await music.snapshot(guildId);

      if (!snapshot.current && snapshot.upcoming.length === 0) {
        await interaction.editReply({
          embeds: [
            infoEmbed(`🎶 ${t('music.queue.emptyTitle')}`, t('music.queue.emptyHint')),
          ],
        });
        return;
      }

      // Halaman pertama (AC §8 US-02): 10 lagu per halaman, dengan tombol
      // navigasi kalau masih ada halaman berikutnya.
      const page = buildQueuePage(snapshot.upcoming, 1);
      const row = queueNavRow(page, t);

      await interaction.editReply({
        embeds: [queueEmbed(snapshot, page, t)],
        components: row ? [row] : [],
      });
    } catch (error) {
      await handleMusicFailure(interaction, error, 'queue');
    }
  },
} satisfies BotCommand;
