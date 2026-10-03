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
              ? `Mode 24/7 hanya bisa diubah role <@&${ctx.config.djRoleId}> (atau Manage Server).`
              : 'Menyalakan atau mematikan mode 24/7 butuh izin Manage Server.',
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
  const { guild, guildId, music } = ctx;

  const option = interaction.options.getChannel('channel');
  const channelId = option?.id ?? (memberChannelId || null);

  if (!channelId) {
    await interaction.editReply({
      embeds: [
        errorEmbed(
          'Sebutkan voice channel-nya dengan `/247 join channel:#musik`, atau masuk ke voice channel dulu lalu jalankan `/247 join`.',
        ),
      ],
    });
    return;
  }

  const permissionError = await checkVoicePermissions(guild, channelId);
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
        errorEmbed(
          `Mode 24/7 sudah disimpan untuk <#${channelId}>, tapi bot belum berhasil masuk: ${outcome.error}. Dicoba lagi otomatis dalam beberapa menit.`,
        ),
      ],
    });
    return;
  }

  if (outcome.joined) {
    await interaction.editReply({
      embeds: [
        successEmbed(
          `Bot akan menjaga <#${channelId}> 24/7 dan tidak keluar otomatis meski tidak ada lagu. Matikan dengan \`/247 leave\`.`,
          '🎧 Mode 24/7 Aktif',
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
        ? successEmbed(`Bot sudah menjaga <#${channelId}> 24/7.`, '🎧 Mode 24/7 Aktif')
        : warningEmbed(
            `Mode 24/7 aktif untuk <#${channelId}>. Bot pindah ke sana setelah lagu yang sedang diputar selesai.`,
            '🎧 Mode 24/7 Menyimpan',
          ),
    ],
  });
}

/** `/247 leave` - matikan mode; bot keluar hanya kalau sedang tidak memutar. */
async function leave(interaction: ChatInputCommandInteraction, ctx: StayContext): Promise<void> {
  const { guildId, music, config } = ctx;

  if (config.stayChannelId === null) {
    await interaction.editReply({
      embeds: [infoEmbed('🎧 Mode 24/7', 'Mode ini belum pernah diaktifkan di server ini.')],
    });
    return;
  }

  await getGuildConfigService().update(guildId, { stayChannelId: null });

  if (music.isPlaying(guildId)) {
    await interaction.editReply({
      embeds: [
        warningEmbed(
          'Mode 24/7 dimatikan. Bot menyelesaikan lagu yang sedang diputar, lalu keluar mengikuti pengaturan waktu idle.',
          '🎧 Mode 24/7 Mati',
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
        wasConnected
          ? 'Mode 24/7 dimatikan dan bot keluar dari voice channel.'
          : 'Mode 24/7 dimatikan. Bot memang tidak sedang berada di voice channel mana pun.',
        '🎧 Mode 24/7 Mati',
      ),
    ],
  });
}

/** `/247 status` - kondisi nyata plus keputusan apa yang akan terjadi berikutnya. */
function statusEmbed(ctx: StayContext): ReturnType<typeof infoEmbed> {
  const { music, config, guildId } = ctx;
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
      ? 'Mode ini belum aktif. Nyalakan dengan `/247 join`.'
      : plan.action === 'stay'
        ? `Bot sedang menjaga <#${config.stayChannelId}> dan tidak akan keluar otomatis.`
        : `Mode aktif untuk <#${config.stayChannelId}>, tapi bot belum ada di sana (${plan.reason.toLowerCase()}).`;

  return infoEmbed('🎧 Status Mode 24/7', description)
    .addFields(
      {
        name: 'Channel 24/7',
        value: config.stayChannelId ? `<#${config.stayChannelId}>` : 'Tidak diaktifkan',
        inline: true,
      },
      {
        name: 'Posisi bot',
        value: current ? `<#${current}>` : 'Di luar voice channel',
        inline: true,
      },
      {
        name: 'Keluar otomatis',
        value: config.stayChannelId
          ? 'Tidak, selama mode 24/7 aktif'
          : `Ya, setelah ${config.idleTimeoutSec} detik tanpa lagu`,
        inline: true,
      },
      { name: 'Status ringkas', value: stayLabel(config, current), inline: true },
      { name: 'Tindakan berikutnya', value: plan.reason, inline: false },
    );
}