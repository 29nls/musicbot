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
import { recordLogEntry, resolveLogTarget } from '../../modules/logging/index.js';
import {
  checkModerationHierarchy,
  getModerationService,
  hierarchyMessage,
  LINKED_CASE_ACTIONS,
  moderationDmEmbed,
  moderationLogCategory,
  moderationLogEmbed,
  moderationResultEmbed,
  priorCaseEmbed,
  registerCaseLink,
  sendGuildEmbed,
  toModerationErrorEmbed,
  type ModerationAction,
  type ModerationService,
  type NotifiableAction,
} from '../../modules/moderation/index.js';
import { defaultTranslator, translatorFor, type Translator } from '../../modules/i18n/index.js';
import { getLogger } from '../../services/logger.js';
import { errorEmbed } from '../../utils/embeds.js';

export interface AdminPermission {
  bit: bigint;
  label: string;
}

/** Izin Discord tiap perintah admin — dipakai untuk gate & default permission. */
export const ADMIN_PERMISSIONS = {
  ban: { bit: PermissionFlagsBits.BanMembers, label: 'Ban Members' },
  unban: { bit: PermissionFlagsBits.BanMembers, label: 'Ban Members' },
  kick: { bit: PermissionFlagsBits.KickMembers, label: 'Kick Members' },
  timeout: { bit: PermissionFlagsBits.ModerateMembers, label: 'Moderate Members' },
  warn: { bit: PermissionFlagsBits.ModerateMembers, label: 'Moderate Members' },
  warnings: { bit: PermissionFlagsBits.ModerateMembers, label: 'Moderate Members' },
  unwarn: { bit: PermissionFlagsBits.ModerateMembers, label: 'Moderate Members' },
  case: { bit: PermissionFlagsBits.ModerateMembers, label: 'Moderate Members' },
  modprofile: { bit: PermissionFlagsBits.ModerateMembers, label: 'Moderate Members' },
  note: { bit: PermissionFlagsBits.ModerateMembers, label: 'Moderate Members' },
  slowmode: { bit: PermissionFlagsBits.ManageChannels, label: 'Manage Channels' },
  lock: { bit: PermissionFlagsBits.ManageChannels, label: 'Manage Channels' },
  unlock: { bit: PermissionFlagsBits.ManageChannels, label: 'Manage Channels' },
  purge: { bit: PermissionFlagsBits.ManageMessages, label: 'Manage Messages' },
} as const satisfies Record<string, AdminPermission>;

export interface AdminContext {
  guild: Guild;
  guildId: string;
  config: GuildConfig;
  actor: GuildMember;
  me: GuildMember;
  moderation: ModerationService;
  /**
   * Penerjemah bahasa server, sudah terikat.
   *
   * Gate admin sudah membaca config untuk aturan modul, jadi penerjemah
   * diambil di sana sekali lalu dipakai ulang. Tanpa ini tiap perintah
   * akan membaca locale-nya sendiri, dan 14 perintah yang semuanya memakai
   * pola sama adalah 14 tempat untuk lupa.
   */
  t: Translator;
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
    return fail(errorEmbed(defaultTranslator('mod.gate.guildOnly'), defaultTranslator('embed.title.error')));
  }

  const guild = interaction.guild;
  const actor = interaction.member;
  const t = await translatorFor(guild.id);

  // Lapis kedua: Discord sudah menyembunyikan perintah, tapi server bisa
  // menimpa default permission-nya.
  if (!(interaction.memberPermissions?.has(permission.bit) ?? false)) {
    return fail(errorEmbed(t('mod.gate.needsPermission', { permission: permission.label }), t('embed.title.error')));
  }

  let config: GuildConfig;
  try {
    config = await getGuildConfigService().get(guild.id);
  } catch (error) {
    return fail(toModerationErrorEmbed(error, t));
  }

  if (!config.modules.moderation) {
    return fail(errorEmbed(t('mod.gate.moduleDisabled'), t('embed.title.error')));
  }

  const me = guild.members.me ?? (await guild.members.fetchMe().catch(() => null));
  if (!me) {
    return fail(errorEmbed(t('mod.gate.botNotLoaded'), t('embed.title.error')));
  }

  if (!me.permissions.has(permission.bit)) {
    return fail(errorEmbed(t('mod.gate.botLacksPermission', { permission: permission.label }), t('embed.title.error')));
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
      t,
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

  return result.ok ? null : errorEmbed(hierarchyMessage(result, ctx.t), ctx.t('embed.title.error'));
}

/**
 * Alasan yang tercatat di audit log Discord (maks 512 karakter).
 *
 * String ini masuk ke **audit log Discord milik server**, jadi isinya
 * sengaja bahasa Indonesia: yang membacanya moderator lewat menu Audit Log,
 * dan audit log itu tidak punya tempat untuk bahasa server. Moderator
 * yang mengetik alasan juga sudah mengetik dalam bahasanya sendiri.
 */
export function auditReason(
  actor: { tag: string; id: string },
  reason: string | null,
  t: Translator = defaultTranslator,
): string {
  return `${reason ?? t('mod.audit.noReason')} • ${t('mod.audit.by', {
    actor: actor.tag,
    id: actor.id,
  })}`.slice(0, 512);
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

/** Catatan kondisi pengiriman; `undefined` = aksi ini memang tidak mengirim DM. */
export function deliveryNotes(
  dmSent: boolean | undefined,
  logged: boolean,
  t: Translator = defaultTranslator,
): string[] {
  const notes: string[] = [];
  if (dmSent === false) notes.push(t('mod.dm.notSent'));
  if (!logged) notes.push(t('mod.delivery.logMissing'));
  return notes;
}

export type TargetKind = 'user' | 'channel';

interface RecordedActionBase {
  interaction: ChatInputCommandInteraction;
  ctx: AdminContext;
  action: ModerationAction;
  targetId: string;
  targetKind?: TargetKind;
  reason: string | null;
  expiresAt?: Date | null;
  /** Aksi Discord yang dieksekusi setelah kasus tercatat. Opsional (mis. `/note`). */
  execute?: () => Promise<void>;
  extraLines?: string[];
  /**
   * Lampirkan riwayat kasus sebelumnya atas target yang sama sebagai embed
   * kedua. Opt-in per perintah: aksi ringan seperti `/warn` tidak perlu
   * mengulang riwayat yang bisa saja sudah dibaca, sementara `/ban` —
   * yang tidak bisa dibatalkan — hampir selalu butuh.
   */
  withPriorCases?: boolean;
}

type RecordedActionOptions = RecordedActionBase &
  ({ notify: User; action: NotifiableAction } | { notify?: undefined });

/**
 * Alur baku satu aksi yang tercatat sebagai kasus:
 * catat kasus → DM target (kalau ada) → eksekusi aksi Discord → kirim log →
 * balas dengan ID kasus.
 *
 * Kasus dicatat lebih dulu supaya ID kasus bisa dipakai di DM dan log. Kalau
 * aksi Discord gagal, kasus ditandai tidak aktif agar tidak menyesatkan.
 */
async function runRecordedAction(options: RecordedActionOptions): Promise<void> {
  const { interaction, ctx, reason } = options;
  const { t } = ctx;
  const expiresAt = options.expiresAt ?? null;

  const created = await ctx.moderation.recordAction({
    guildId: ctx.guildId,
    type: options.action,
    targetId: options.targetId,
    moderatorId: interaction.user.id,
    reason,
    expiresAt,
  });

  let dmSent: boolean | undefined;
  if (options.notify) {
    dmSent = await dmTarget(
      options.notify,
      moderationDmEmbed(
        {
          action: options.action,
          caseNumber: created.caseNumber,
          guildName: ctx.guild.name,
          reason,
          expiresAt,
        },
        t,
      ),
    );

    // Dicatat di kasusnya supaya `/case` bisa menampilkan apakah targetnya
    // benar-benar diberi tahu — termasuk saat DM-nya tertutup, yang kalau tidak
    // tercatat akan terlihat seperti tidak ada yang tahu.
    await ctx.moderation
      .recordDmStatus(ctx.guildId, created.caseNumber, dmSent ? 'sent' : 'failed')
      .catch(() => undefined);
  }

  if (options.execute) {
    // Daftarkan tautan kasus sebelum memanggil Discord: event guildBanAdd &
    // friends menyusul setelah API membalas, dan tautan itulah yang membuat log
    // kategori bisa menyebut nomor kasus ini.
    if (LINKED_CASE_ACTIONS.includes(options.action)) {
      registerCaseLink({
        guildId: ctx.guildId,
        targetId: options.targetId,
        action: options.action,
        caseNumber: created.caseNumber,
        moderatorId: interaction.user.id,
      });
    }

    try {
      await options.execute();
    } catch (error) {
      await ctx.moderation.deactivateCase(ctx.guildId, created.caseNumber).catch(() => undefined);
      throw error;
    }
  }

  const caseEmbed = moderationLogEmbed(
    {
      action: options.action,
      caseNumber: created.caseNumber,
      targetId: options.targetId,
      targetKind: options.targetKind,
      moderatorId: interaction.user.id,
      reason,
      createdAt: created.createdAt,
      expiresAt,
      dmSent,
    },
    t,
  );

  const logged = await deliverCaseLog(ctx, options.action, caseEmbed, {
    targetId: options.targetId,
    channelId: options.targetKind === 'channel' ? options.targetId : null,
    moderatorId: interaction.user.id,
    caseNumber: created.caseNumber,
  });

  const embeds = [
    moderationResultEmbed(
      {
        action: options.action,
        caseNumber: created.caseNumber,
        targetId: options.targetId,
        targetKind: options.targetKind,
        reason,
        expiresAt,
        extraLines: [...(options.extraLines ?? []), ...deliveryNotes(dmSent, logged, t)],
      },
      t,
    ),
  ];

  // Riwayat dibaca SETELAH kasus tercatat & Discord sudah dipanggil, lalu
  // kasus ini dikecualikan — jadi yang tampil benar-benar kasus sebelumnya.
  // Kegagalan baca tidak boleh menutupi hasil aksi yang sudah berhasil, jadi
  // dibiarkan kosong dan hanya dicatat sebagai peringatan di log internal.
  if (options.withPriorCases) {
    const priorCase = await priorCaseEmbedFor(
      ctx.moderation,
      ctx.guildId,
      options.targetId,
      created.caseNumber,
      t,
    ).catch((error) => {
      getLogger()
        .warn({ err: error, guildId: ctx.guildId, target: options.targetId }, 'Gagal memuat riwayat kasus');

      return null;
    });

    if (priorCase) embeds.push(priorCase);
  }

  await interaction.editReply({ embeds });
}

/**
 * Embed riwayat target untuk dilampirkan ke balasan aksi, atau null kalau
 * targetnya benar-benar bersih.
 *
 * "Riwayat kosong" sengaja tidak pernah dirender: embed yang hanya berisi
 * "tidak ada riwayat" menambah tinggi balasan tanpa keputusan yang bisa
 * diambil dari isinya. `caseNumber` yang sedang dibuat dikecualikan supaya
 * aksi ini tidak menghitung dirinya sendiri sebagai riwayat.
 */
export async function priorCaseEmbedFor(
  service: Pick<ModerationService, 'priorCaseSummary'>,
  guildId: string,
  targetId: string,
  caseNumber: number,
  t: Translator = defaultTranslator,
): Promise<EmbedBuilder | null> {
  const summary = await service.priorCaseSummary(guildId, targetId, caseNumber);

  return summary.hasHistory ? priorCaseEmbed(summary, t) : null;
}

/**
 * Kirim log kasus ke channel log lalu simpan ke riwayat untuk `/logs`.
 *
 * Kalau modul logging menyala, channel tujuan mengikuti routing per kategori
 * (`/logging set member:#log-member`) dengan `logChannelId` sebagai cadangan.
 * Modul mati atau konfigurasi tak terbaca tetap kirim ke `logChannelId` seperti
 * sebelumnya — catatan moderasi tidak boleh hilang diam-diam.
 *
 * Mengembalikan `false` kalau embed benar-benar tidak terkirim, supaya pemanggil
 * bisa memberi catatan ke user.
 */
export async function deliverCaseLog(
  ctx: AdminContext,
  action: ModerationAction,
  embed: EmbedBuilder,
  meta: { targetId: string; channelId: string | null; moderatorId: string; caseNumber: number },
): Promise<boolean> {
  const category = moderationLogCategory(action);
  const target = category
    ? await resolveLogTarget(ctx.guild, category).catch(() => null)
    : null;
  const channelId = target?.enabled ? target.channelId : ctx.config.logChannelId;

  const logged = await sendGuildEmbed(ctx.guild, channelId, embed);

  // Kasus ini adalah catatan utama aksi, jadi riwayat log disimpan di sini.
  // Event Discord yang menyusul hanya menempelkan nomor kasus pada embed
  // kategorinya tanpa mencatat baris kedua.
  if (category) {
    await recordLogEntry(ctx.guild, category, embed, {
      eventKey: `moderation.${action}`,
      targetId: meta.targetId,
      channelId: meta.channelId,
      executorId: meta.moderatorId,
      caseNumber: meta.caseNumber,
    }).catch(() => undefined);
  }

  return logged;
}

export interface ModerationRunOptions {
  interaction: ChatInputCommandInteraction;
  ctx: AdminContext;
  user: User;
  action: NotifiableAction;
  reason: string | null;
  expiresAt?: Date | null;
  execute: () => Promise<void>;
  extraLines?: string[];
  /** Lihat `withPriorCases` di `RecordedActionBase`. */
  withPriorCases?: boolean;
}

/** Aksi terhadap user: selalu mencoba DM ke target. */
export async function runModerationAction(options: ModerationRunOptions): Promise<void> {
  const { user, ...rest } = options;
  await runRecordedAction({ ...rest, targetId: user.id, notify: user });
}

export interface ChannelActionRunOptions {
  interaction: ChatInputCommandInteraction;
  ctx: AdminContext;
  channelId: string;
  action: Extract<ModerationAction, 'slowmode' | 'lock' | 'unlock'>;
  reason: string | null;
  execute: () => Promise<void>;
  extraLines?: string[];
}

/** Aksi terhadap channel: tidak ada DM, tetapi tetap punya ID kasus & log. */
export async function runChannelAction(options: ChannelActionRunOptions): Promise<void> {
  await runRecordedAction({ ...options, targetId: options.channelId, targetKind: 'channel' });
}

export interface NoteRunOptions {
  interaction: ChatInputCommandInteraction;
  ctx: AdminContext;
  userId: string;
  content: string;
  extraLines?: string[];
}

/** Catatan internal: tercatat sebagai kasus, tetapi target tidak diberi tahu. */
export async function runNoteAction(options: NoteRunOptions): Promise<void> {
  await runRecordedAction({
    interaction: options.interaction,
    ctx: options.ctx,
    action: 'note',
    targetId: options.userId,
    reason: options.content,
    extraLines: options.extraLines,
  });
}

export type LockPlan =
  | {
      ok: true;
      channelId: string;
      label: string;
      apply: (locked: boolean, reason: string) => Promise<void>;
    }
  | { ok: false; embed: EmbedBuilder };

/**
 * Siapkan lock/unlock untuk channel tempat perintah dipanggil.
 * Channel teks → tolak `SendMessages`; channel voice → tolak `Connect`.
 * Nilai `null` saat unlock mengembalikan izin ke default (bukan memaksa allow).
 */
export function resolveLockPlan(
  interaction: ChatInputCommandInteraction,
  t: Translator = defaultTranslator,
): LockPlan {
  if (!interaction.inCachedGuild()) {
    return { ok: false, embed: errorEmbed(t('mod.gate.guildOnly'), t('embed.title.error')) };
  }

  const channel = interaction.channel;
  if (!channel || channel.isDMBased()) {
    return { ok: false, embed: errorEmbed(t('mod.gate.channelOnly'), t('embed.title.error')) };
  }

  if (channel.isVoiceBased()) {
    const everyone = channel.guild.roles.everyone;

    return {
      ok: true,
      channelId: channel.id,
      label: 'Connect',
      apply: async (locked, reason) => {
        await channel.permissionOverwrites.edit(
          everyone,
          { Connect: locked ? false : null },
          { reason },
        );
      },
    };
  }

  if (channel.isTextBased() && 'permissionOverwrites' in channel) {
    const everyone = channel.guild.roles.everyone;

    return {
      ok: true,
      channelId: channel.id,
      label: 'Send Messages',
      apply: async (locked, reason) => {
        await channel.permissionOverwrites.edit(
          everyone,
          { SendMessages: locked ? false : null },
          { reason },
        );
      },
    };
  }

  return {
    ok: false,
    embed: errorEmbed(t('mod.gate.textVoiceOnly'), t('embed.title.error')),
  };
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

  const t = await translatorFor(interaction.guildId ?? 'unknown');

  await replyEphemeralError(interaction, toModerationErrorEmbed(error, t));
}
