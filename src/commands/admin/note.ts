import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { notesEmbed } from '../../modules/moderation/index.js';
import type { BotCommand } from '../../types/command.js';
import {
  ADMIN_PERMISSIONS,
  gateAdminCommand,
  handleAdminFailure,
  replyEphemeralError,
  runNoteAction,
} from './_shared.js';

export default {
  data: new SlashCommandBuilder()
    .setName('note')
    .setDescription('Catatan internal tentang member (tidak mengubah apa pun di Discord)')
    .setDefaultMemberPermissions(ADMIN_PERMISSIONS.note.bit)
    .addSubcommand((sub) =>
      sub
        .setName('add')
        .setDescription('Tambah catatan baru')
        .addUserOption((option) =>
          option.setName('user').setDescription('Member yang dicatat').setRequired(true),
        )
        .addStringOption((option) =>
          option
            .setName('content')
            .setDescription('Isi catatan')
            .setRequired(true)
            .setMaxLength(1_000),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('show')
        .setDescription('Lihat catatan terbaru seorang member')
        .addUserOption((option) =>
          option.setName('user').setDescription('Member yang ingin dilihat').setRequired(true),
        ),
    ),
  category: 'admin',
  guildOnly: true,
  cooldownSeconds: 3,
  async execute(interaction, _client) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      const gate = await gateAdminCommand(interaction, ADMIN_PERMISSIONS.note);
      if (!gate.ok) {
        await replyEphemeralError(interaction, gate.embed);
        return;
      }
      const { ctx } = gate;

      const subcommand = interaction.options.getSubcommand(true);
      const user = interaction.options.getUser('user', true);

      if (subcommand === 'show') {
        const notes = await ctx.moderation.listNotes(ctx.guildId, user.id);
        await interaction.editReply({ embeds: [notesEmbed({ id: user.id, tag: user.tag }, notes)] });
        return;
      }

      // Tanpa cek hierarki: catatan murni internal dan tidak menyentuh Discord,
      // jadi moderator tetap boleh mencatat pemilik server sekalipun.
      const content = interaction.options.getString('content', true);

      await runNoteAction({
        interaction,
        ctx,
        userId: user.id,
        content,
        extraLines: ['📝 Catatan internal — target tidak diberi tahu.'],
      });
    } catch (error) {
      await handleAdminFailure(interaction, error, 'note');
    }
  },
} satisfies BotCommand;
