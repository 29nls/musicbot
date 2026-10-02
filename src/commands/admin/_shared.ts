import {
  MessageFlags,
  PermissionFlagsBits,
  type ChatInputCommandInteraction,
  type EmbedBuilder,
  type Guild,
  type GuildMember,
  type User,
} from 'discord.js';
import { getGuildConfigService, type GuildConfig } from '../../modules/config/index.js';
import {
  checkModerationHierarchy,
  getModerationService,
  moderationDmEmbed,
  moderationLogEmbed,
  moderationResultEmbed,
  sendGuildEmbed,
  toModerationErrorEmbed,
  type ModerationAction,
  type ModerationService,
} from '../../modules/moderation/index.js';
import { getLogger } from '../../services/logger.js';
import { errorEmbed } from '../../utils/embeds.js';

export interface AdminPermission {
  bit: bigint;
  label: string;
}

/** Izin Discord tiap perintah admin — dipakai untuk gate & default permission. */
export const ADMIN_PERMISSIONS = {
  ban: { bit: PermissionFlagsBits.BanMembers, label: 'Ban Members' },
  kick: { bit: PermissionFlagsBits.KickMembers, label: 'Kick Members' },
  timeout: { bit: PermissionFlagsBits.ModerateMembers, label: 'Moderate Members' },
  warn: { bit: PermissionFlagsBits.ModerateMembers, label: 'Moderate Members' },
  warnings: { bit: PermissionFlagsBits.ModerateMembers, label: 'Moderate Members' },
  unwarn: { bit: PermissionFlagsBits.ModerateMembers, label: 'Moderate Members' },
  purge: { bit: PermissionFlagsBits.ManageMessages, label: 'Manage Messages' },
} as const satisfies Record<string, AdminPermission>;

export interface AdminContext {
  guild: Guild;
  guildId: string;
  config: GuildConfig;
  actor: GuildMember;
  me: GuildMember;
  moderation: ModerationService;
}

export type AdminGate = { ok: true; ctx: AdminContext } | { ok: false; embed: EmbedBuilder };

const fail = (embed: EmbedBuilder): AdminGate => ({ ok: false, embed });

/**
 * Pemeriksaan bersama perintah admin: posisi server, izin user & bot, modul
 * moderasi aktif, dan konfigurasi server terbaca.
 */
export async function gateAdminCommand(
  interaction: ChatInputCommandInteraction,
  permission: AdminPermission,
): Promise<AdminGate> {
  if (!interaction.inCachedGuild()) {
    return fail(errorEmbed('Perintah ini hanya bisa dipakai di dalam server.'));
  }

  const guild = interaction.guild;
  const actor = interaction.member;

  // Lapis kedua: Discord sudah menyembunyikan perintah, tapi server bisa
  // menimpa default permission-nya.
  if (!(interaction.memberPermissions?.has(permission.bit) ?? false)) {
    return fail(errorEmbed(`Perintah ini butuh izin **${permission.label}**.`));
  }

  let config: GuildConfig;
  try {
    config = await getGuildConfigService().get(guild.id);
  } catch (error) {
    return fail(toModerationErrorEmbed(error));
  }

  if (!config.modules.moderation) {
    return fail(
      errorEmbed('Modul moderasi dimatikan di server ini. Nyalakan lewat `/setup` atau `/config`.'),
    );
  }

  const me = guild.members.me ?? (await guild.members.fetchMe().catch(() => null));
  if (!me) {
    return fail(errorEmbed('Aku belum termuat di server ini. Coba lagi sebentar lagi.'));
  }

  if (!me.permissions.has(permission.bit)) {
    return fail(errorEmbed(`Aku tidak punya izin **${permission.label}** di server ini.`));
  }

  return {
    ok: true,
    ctx: {
      guild,
      guildId: guild.id,
      config,
      actor,
      me,
      moderation: getModerationService(),
    },
  };
}

/** Ambil member target; null kalau user bukan anggota server (mis. ban orang yang sudah keluar). */
export async function resolveTargetMember(
  guild: Guild,
  userId: string,
): Promise<GuildMember | null> {
  return guild.members.fetch({ user: userId, force: true }).catch(() => null);
}

/** Jalankan aturan anti-hierarki; null = lolos. */
export function hierarchyFailure(
  ctx: AdminContext,
  targetUserId: string,
  targetMember: GuildMember | null,
): EmbedBuilder | null {
  const result = checkModerationHierarchy({
    actorId: ctx.actor.id,
    targetId: targetUserId,
    botId: ctx.me.id,
    guildOwnerId: ctx.guild.ownerId,
    actorHighestRolePosition: ctx.actor.roles.highest.position,
    botHighestRolePosition: ctx.me.roles.highest.position,
    targetHighestRolePosition: targetMember?.roles.highest.position ?? null,
  });

  return result.ok ? null : errorEmbed(result.message);
}

/** Alasan yang tercatat di audit log Discord (maks 512 karakter). */
export function auditReason(actor: { tag: string; id: string }, reason: string | null): string {
  return `${reason ?? 'Tanpa alasan'} • oleh ${actor.tag} (${actor.id})`.slice(0, 512);
}

/** Kirim DM ke target; false = DM tertutup/diblokir, bukan alasan membatalkan aksi. */
export async function dmTarget(user: User, embed: EmbedBuilder): Promise<boolean> {
  try {
    await user.send({ embeds: [embed] });
    return true;
  } catch (error) {
    getLogger().warn({ err: error, user: user.id }, 'DM moderasi gagal dikirim');
    return false;
  }
}

export function deliveryNotes(dmSent: boolean, logged: boolean): string[] {
  const notes: string[] = [];
  if (!dmSent) notes.push('⚠️ DM ke target tidak terkirim (DM tertutup atau bot diblokir).');
  if (!logged) {
    notes.push('⚠️ Channel log belum diatur atau tidak bisa dikirim, jadi log tidak tersimpan.');
  }
  return notes;
}

export interface ModerationRunOptions {
  interaction: ChatInputCommandInteraction;
  ctx: AdminContext;
  user: User;
  action: ModerationAction;
  reason: string | null;
  expiresAt?: Date | null;
  /** Aksi Discord yang dieksekusi setelah kasus tercatat. */
  execute: () => Promise<void>;
  extraLines?: string[];
}

/**
 * Alur baku satu aksi moderasi:
 * catat kasus → DM target → eksekusi aksi Discord → kirim log → balas dengan ID kasus.
 *
 * Kasus dicatat lebih dulu supaya ID kasus bisa dipakai di DM dan log. Kalau
 * aksi Discord gagal, kasus ditandai tidak aktif agar tidak menyesatkan.
 */
export async function runModerationAction(options: ModerationRunOptions): Promise<void> {
  const { interaction, ctx, user, action, reason } = options;
  const expiresAt = options.expiresAt ?? null;

  const created = await ctx.moderation.recordAction({
    guildId: ctx.guildId,
    type: action,
    targetId: user.id,
    moderatorId: interaction.user.id,
    reason,
    expiresAt,
  });

  const dmSent = await dmTarget(
    user,
    moderationDmEmbed({
      action,
      caseNumber: created.caseNumber,
      guildName: ctx.guild.name,
      reason,
      expiresAt,
    }),
  );

  try {
    await options.execute();
  } catch (error) {
    await ctx.moderation.deactivateCase(ctx.guildId, created.caseNumber).catch(() => undefined);
    throw error;
  }

  const logged = await sendGuildEmbed(
    ctx.guild,
    ctx.config.logChannelId,
    moderationLogEmbed({
      action,
      caseNumber: created.caseNumber,
      targetId: user.id,
      moderatorId: interaction.user.id,
      reason,
      createdAt: created.createdAt,
      expiresAt,
      dmSent,
    }),
  );

  await interaction.editReply({
    embeds: [
      moderationResultEmbed({
        action,
        caseNumber: created.caseNumber,
        targetId: user.id,
        reason,
        expiresAt,
        extraLines: [...(options.extraLines ?? []), ...deliveryNotes(dmSent, logged)],
      }),
    ],
  });
}

/** Ganti balasan "sedang diproses" dengan pesan privat. */
export async function replyEphemeralError(
  interaction: ChatInputCommandInteraction,
  embed: EmbedBuilder,
): Promise<void> {
  await interaction.deleteReply().catch(() => undefined);
  await interaction.followUp({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

/** Catat error tak terduga lalu tampilkan pesan privat yang bisa dibaca user. */
export async function handleAdminFailure(
  interaction: ChatInputCommandInteraction,
  error: unknown,
  command: string,
): Promise<void> {
  getLogger().error(
    { err: error, command, user: interaction.user.id, guild: interaction.guildId },
    'Perintah admin gagal',
  );

  await replyEphemeralError(interaction, toModerationErrorEmbed(error));
}
