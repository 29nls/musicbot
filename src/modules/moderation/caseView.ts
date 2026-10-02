import type { TargetKind } from './embeds.js';
import { ACTION_LABELS, NOTIFIABLE_ACTIONS, type ModerationCase } from './types.js';

/** Berapa kasus lain (untuk target yang sama) yang ditampilkan di halaman kasus. */
export const CASE_HISTORY_LIMIT = 5;

/** Berapa entri log terkait yang ditampilkan di halaman kasus. */
export const CASE_LOG_LIMIT = 5;

/**
 * Seberapa jauh ke belakang & depan dari waktu kasus log sekitar diambil.
 * Satu jam cukup untuk menangkap event Discord yang menyusul aksi
 * (`guildMemberRemove` setelah kick, `guildMemberUpdate` setelah timeout)
 * tanpa menyedot seharian aktivitas member.
 */
export const CASE_LOG_WINDOW_MS = 60 * 60 * 1_000;

/** Aksi yang targetnya sebuah channel, bukan member. */
const CHANNEL_ACTIONS = new Set(['slowmode', 'lock', 'unlock']);

/** Target channel ditampilkan sebagai `<#id>`, selain itu `<@id>`. */
export function caseTargetKind(record: ModerationCase): TargetKind {
  return CHANNEL_ACTIONS.has(record.type) ? 'channel' : 'user';
}

/**
 * Status kasus dalam satu kalimat.
 *
 * `active`=false berarti dua hal berbeda, jadi dibedakan di sini: untuk
 * `/warn` itu berarti peringatan dicabut, untuk aksi lain itu berarti aksi
 * Discord gagal dieksekusi sehingga kasus dinonaktifkan.
 */
export function describeCaseStatus(record: ModerationCase): string {
  if (record.active) return '✅ Aktif';

  return record.type === 'warn'
    ? '♻️ Dicabut oleh moderator'
    : '❌ Nonaktif — aksi Discord gagal dieksekusi';
}

/** Rentang waktu untuk mencari log yang terjadi di sekitar kasus ini. */
export function caseLogWindow(record: ModerationCase): { from: Date; to: Date } {
  const at = record.createdAt.getTime();

  return { from: new Date(at - CASE_LOG_WINDOW_MS), to: new Date(at + CASE_LOG_WINDOW_MS) };
}

/**
 * Keadaan target saat halaman dibuka, untuk melihat apakah aksi masih berlaku.
 *
 * `null` berarti tidak bisa diperiksa (API Discord gagal atau aksi memang
 * tidak punya bentuk "masih berlaku"). Embed membedakannya dari `false`.
 */
export interface CaseTargetState {
  /** Target masih diblokir dari server. */
  banned: boolean | null;
  /** Sisa timeout target, kalau sedang timeout. */
  timeoutUntil: Date | null;
}

/**
 * Baris "kondisi sekarang" di halaman kasus.
 *
 * Hanya aksi yang bisa berubah statusnya sendiri (ban & timeout) yang punya
 * baris; kick/warn/note tidak perlu dicek ulang karena tidak bisa dibatalkan.
 */
export function currentStateLines(
  record: ModerationCase,
  state: CaseTargetState | null,
): string[] {
  if (record.type === 'ban') {
    if (state?.banned === true) return ['🔒 Masih diblokir dari server'];
    if (state?.banned === false) return ['✅ Sudah tidak diblokir dari server'];
    return ['⚪ Status blokir tidak bisa diperiksa'];
  }

  if (record.type === 'timeout') {
    const until = state?.timeoutUntil ?? null;
    if (until && until.getTime() > Date.now()) {
      return [`⏳ Masih timeout sampai <t:${Math.floor(until.getTime() / 1_000)}:R>`];
    }
    if (until) return ['✅ Sudah tidak timeout'];
    return ['⚪ Tidak sedang timeout atau tidak bisa diperiksa'];
  }

  return [];
}

/** Baris ringkas satu kasus untuk daftar riwayat target. */
export function caseHistoryLine(record: ModerationCase): string {
  const meta = ACTION_LABELS[record.type];
  const state = record.active ? '' : ' · *nonaktif*';

  return (
    `\`${record.caseNumber}\` ${meta.emoji} ${meta.label} · <t:${Math.floor(record.createdAt.getTime() / 1_000)}:R>` +
    ` · oleh <@${record.moderatorId}>${state}`
  );
}

/**
 * Baris status pengiriman DM ke target, atau null kalau kasus ini memang tidak
 * pernah mengirim DM.
 *
 * `dmStatus: null` ambigu oleh dirinya sendiri — bisa berarti "aksi ini tidak
 * mengirim DM" (slowmode, note) atau "kasus dibuat sebelum status ini
 * dicatat". Keduanya dibedakan lewat `NOTIFIABLE_ACTIONS`: kalau aksinya memang
 * seharusnya mengirim DM tapi statusnya kosong, jawabannya "tidak tercatat",
 * bukan "tidak dikirim". Tanpa pembedaan ini kasus lama akan terlihat seolah
 * targetnya tidak pernah diberi tahu.
 *
 * DM tambahan seperti dari `/unwarn` tidak ikut ditulis di sini: `dm_status`
 * menggambarkan notifikasi atas kasus itu sendiri, bukan DM tambahan yang
 * menyertainya.
 */
export function dmDeliveryLine(record: ModerationCase): string | null {
  if (record.dmStatus === 'sent') return '✅ DM notifikasi terkirim ke target';
  if (record.dmStatus === 'failed') {
    return '⚠️ DM notifikasi **tidak terkirim** — DM-nya tertutup atau bot diblokir';
  }

  if (!NOTIFIABLE_ACTIONS.includes(record.type as (typeof NOTIFIABLE_ACTIONS)[number])) return null;

  return '❔ Status pengiriman DM tidak tercatat (kasus dibuat sebelum fitur ini ada)';
}

/** Alasan yang aman ditampilkan di embed: dipotong ke batas field Discord. */
export function caseReasonText(record: ModerationCase): string {
  const reason = record.reason?.trim();

  return reason ? reason.slice(0, 1_000) : '*tidak disebutkan*';
}
