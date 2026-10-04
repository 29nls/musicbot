import { SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import { getGuildConfigService } from '../../modules/config/index.js';
import { canControlMusic, getStayService, planStay, stayLabel } from '../../modules/music/index.js';
import type { Gate } from './_shared.js';
import type { BotCommand } from '../../types/command.js';
import { errorEmbed, infoEmbed, successEmbed, warningEmbed } from '../../utils/embeds.js';
import {
  checkVoicePermissions,
  gateMusicCommand,
  handleMusicFailure,
  replyEphemeralError,
} from './_shared.js';

/** Konteks yang lolos gate: guild, konfigurasi, dan mesin musik. */
type StayContext = Extract<Gate, { ok: true }>['ctx'];

/**
 * Mode 24/7: satu voice channel dijaga bot terus-menerus, bahkan saat tidak ada
 * lagu yang diputar (PRD 5.2).
 *
 * Tiga aturan yang tidak boleh dilanggar di perintah ini:
 * - menyalakan/mematikan mode butuh DJ atau Manage Server, bukan siapa saja;
 * - bot tidak dipaksa pindah channel di tengah lagu yang sedang berjalan;
 * - mematikan mode tidak langsung menarik bot dari channel kalau ada lagu yang
 *   sedang diputar (bot menyelesaikan lagu itu dulu).
 */
export default {
  data: new SlashCommandBuilder()
    .setName('247')
    .setDescription('Jaga satu voice channel tetap terisi bot 24/7')
    .addSubcommand((sub) =>
      sub.setName('status').setDescription('Lihat apakah mode 24/7 aktif di server ini'),
    )
    .addSubcommand((sub) =>
      sub
        .setName('join')
        .setDescription('Jaga channel ini 24/7 (default: channel kamu sekarang)')
        .addChannelOption((option) =>
          option
            .setName('channel')
            .setDescription('Voice channel yang dijaga; kosongkan untuk pakai channel kamu'),
        ),
    )
    .addSubcommand((sub) =>
      sub.setName('leave').setDescription('Matikan mode 24/7 di server ini'),
    ),
  category: 'music',
  guildOnly: true,
  cooldownSeconds: 3,
  async execute(interaction, _client) {
    await interaction.deferReply();

    try {
      // Tanpa `voice` dan `control`: status boleh dilihat siapa saja, dan
      // `/247 join` dari luar voice channel memang kejadian yang wajar.
      // Izin DJ/Manage Server diperiksa sendiri di bawah.
      const gate = await gateMusicCommand(interaction);
      if (!gate.ok) {
        await replyEphemeralError(interaction, gate.embed);
        return;
      }

      const ctx = gate.ctx;
      const { t } = ctx;
      const subcommand = interaction.options.getSubcommand(true);

      if (subcommand === 'status') {
        await interaction.editReply({ embeds: [statusEmbed(ctx)] });
        return;
      }

      const allowed = canControlMusic({
        djRoleId: ctx.config.djRoleId,
        memberRoleIds: ctx.memberRoleIds,
        canManageGuild: ctx.canManageGuild,
      });

      if (!allowed) {
        await replyEphemeralError(
          interaction,
          errorEmbed(
            ctx.config.djRoleId
              ? t('music.stay.needDjRole', { role: ctx.config.djRoleId })
              : t('music.stay.needManageGuild'),
          ),
        );
        return;
      }

      if (subcommand === 'leave') {
        await leave(interaction, ctx);
        return;
      }

      await join(interaction, ctx, ctx.voiceChannelId);
    } catch (error) {
      await handleMusicFailure(interaction, error, '247');
    }
  },
} satisfies BotCommand;

/** `/247 join` - simpan channel tujuan, lalu minta penyambungan langsung. */
async function join(
  interaction: ChatInputCommandInteraction,
  ctx: StayContext,
  memberChannelId: string,
): Promise<void> {
  const { guild, guildId, music, t } = ctx;

  const option = interaction.options.getChannel('channel');
  const channelId = option?.id ?? (memberChannelId || null);

  if (!channelId) {
    await interaction.editReply({
      embeds: [
        errorEmbed(t('music.stay.needChannel'), t('embed.title.error')),
      ],
    });
    return;
  }

  const permissionError = await checkVoicePermissions(guild, channelId, t);
  if (permissionError) {
    await interaction.editReply({ embeds: [permissionError] });
    return;
  }

  await getGuildConfigService().update(guildId, { stayChannelId: channelId });

  // Hitung mundur idle yang mungkin sudah berjalan harus dibatalkan sekarang,
  // bukan ditunggu sampai habis: kalau tidak, bot keluar sekali lagi sebelum
  // sapuan job berikutnya sempat mengembalikannya ke channel.
  music.cancelIdleDisconnect(guildId);

  const outcome = await getStayService().apply(guildId, guild.shardId);

  if (outcome.error) {
    await interaction.editReply({
      embeds: [
        errorEmbed(t('music.stay.joinFailed', { channel: channelId, error: outcome.error }), t('embed.title.error')),
      ],
    });
    return;
  }

  if (outcome.joined) {
    await interaction.editReply({
      embeds: [
        successEmbed(
          t('music.stay.joined', { channel: channelId }),
          `🎧 ${t('music.stay.activeTitle')}`,
        ),
      ],
    });
    return;
  }

  // Plan butuh menunggu (lagu sedang berjalan) atau mode sudah terpenuhi.
  // Dua-duanya harus dijelaskan, bukan dilaporkan "berhasil" tanpa keterangan.
  const alreadyThere = music.botVoiceChannelId(guildId) === channelId;
  await interaction.editReply({
    embeds: [
      alreadyThere
        ? successEmbed(
            t('music.stay.alreadyThere', { channel: channelId }),
            `🎧 ${t('music.stay.activeTitle')}`,
          )
        : warningEmbed(
            t('music.stay.pending', { channel: channelId }),
            `🎧 ${t('music.stay.savingTitle')}`,
          ),
    ],
  });
}

/** `/247 leave` - matikan mode; bot keluar hanya kalau sedang tidak memutar. */
async function leave(interaction: ChatInputCommandInteraction, ctx: StayContext): Promise<void> {
  const { guildId, music, config, t } = ctx;

  if (config.stayChannelId === null) {
    await interaction.editReply({
      embeds: [infoEmbed(`🎧 ${t('music.stay.offTitle')}`, t('music.stay.neverStarted'))],
    });
    return;
  }

  await getGuildConfigService().update(guildId, { stayChannelId: null });

  if (music.isPlaying(guildId)) {
    await interaction.editReply({
      embeds: [
        warningEmbed(
          t('music.stay.offWhilePlaying'),
          `🎧 ${t('music.stay.offTitle')}`,
        ),
      ],
    });
    return;
  }

  const wasConnected = music.botVoiceChannelId(guildId) !== null;
  await music.disconnect(guildId);

  await interaction.editReply({
    embeds: [
      successEmbed(
        wasConnected ? t('music.stay.offAndLeft') : t('music.stay.offNotConnected'),
        `🎧 ${t('music.stay.offTitle')}`,
      ),
    ],
  });
}

/** `/247 status` - kondisi nyata plus keputusan apa yang akan terjadi berikutnya. */
function statusEmbed(ctx: StayContext): ReturnType<typeof infoEmbed> {
  const { music, config, guildId, t } = ctx;
  const current = music.botVoiceChannelId(guildId);

  const plan = planStay({
    configuredChannelId: config.stayChannelId,
    currentChannelId: current,
    moduleEnabled: true,
    lavalinkConnected: music.isConnected,
    isPlaying: music.isPlaying(guildId),
  });

  const description =
    config.stayChannelId === null
      ? t('music.stay.statusOff')
      : plan.action === 'stay'
        ? t('music.stay.statusStaying', { channel: config.stayChannelId })
        : t('music.stay.statusElsewhere', {
            channel: config.stayChannelId,
            reason: plan.reason.toLowerCase(),
          });

  return infoEmbed(`🎧 ${t('music.stay.statusTitle')}`, description)
    .addFields(
      {
        name: t('music.stay.fieldChannel'),
        value: config.stayChannelId ? `<#${config.stayChannelId}>` : t('music.stay.notEnabled'),
        inline: true,
      },
      {
        name: t('music.stay.fieldPosition'),
        value: current ? `<#${current}>` : t('music.stay.outsideVoice'),
        inline: true,
      },
      {
        name: t('music.stay.fieldIdle'),
        value: config.stayChannelId
          ? t('music.stay.idleNo')
          : t('music.stay.idleYes', { seconds: config.idleTimeoutSec }),
        inline: true,
      },
      { name: t('music.stay.fieldSummary'), value: stayLabel(config, current, t), inline: true },
      { name: t('music.stay.fieldNextAction'), value: plan.reason, inline: false },
    );
}