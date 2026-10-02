/**
 * Sistem tiket dasar (Fase 2, PRD §5.2): satu channel privat per tiket di
 * bawah kategori yang ditentukan admin, dengan role staff yang bisa melihat
 * semuanya. Menutup tiket = mengunci & mengganti nama channel, bukan menghapus,
 * lalu menyimpan isi percakapannya sebagai transkrip.
 */

import type { TicketTranscript } from './transcript.js';

/** Awalan customId untuk tombol tiket — dipakai router komponen. */
export const TICKET_PREFIX = 'ticket:';

/** Panjang maksimum nama channel Discord. */
export const MAX_CHANNEL_NAME_LENGTH = 100;

/** Panjang maksimum subjek tiket. */
export const MAX_SUBJECT_LENGTH = 200;

/** Jumlah tiket terbuka yang ditampilkan di `/ticket list`. */
export const TICKET_LIST_LIMIT = 20;

/** Umur simpan data tiket yang sudah ditutup (Bab 12 privasi). */
export const TICKET_RETENTION_MONTHS = 12;

export const TICKET_STATUSES = ['open', 'closed'] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

export function isTicketStatus(value: string): value is TicketStatus {
  return (TICKET_STATUSES as readonly string[]).includes(value);
}

export interface Ticket {
  id: number;
  ticketNumber: number;
  guildId: string;
  /** Channel tiket; null kalau channel dihapus manual di luar bot. */
  channelId: string | null;
  openerId: string;
  subject: string | null;
  status: TicketStatus;
  /** Staff yang mengambil alih tiket ini. */
  claimedBy: string | null;
  createdAt: Date;
  closedAt: Date | null;
  closedBy: string | null;
  /** Retensi (Bab 12 privasi): diisi saat tiket ditutup. */
  expiresAt: Date | null;
  /**
   * Isi percakapan, diambil saat tiket ditutup. null kalau tiket ditutup sebelum
   * fitur ini ada, channelnya sudah hilang, atau pengambilannya gagal.
   */
  transcript: TicketTranscript | null;
}

export interface CreateTicketInput {
  guildId: string;
  openerId: string;
  subject: string | null;
}

export interface TicketPanelIds {
  channelId: string;
  messageId: string | null;
}

export type TicketButtonAction = 'create' | 'claim' | 'close';

/** `ticket:create` → 'create'. null kalau bukan customId tiket. */
export function parseTicketButtonId(customId: string): TicketButtonAction | null {
  const action = customId.startsWith(TICKET_PREFIX) ? customId.slice(TICKET_PREFIX.length) : '';
  return action === 'create' || action === 'claim' || action === 'close' ? action : null;
}

export function ticketButtonId(action: TicketButtonAction): string {
  return `${TICKET_PREFIX}${action}`;
}

/** `#0007` — nomor tiket sama formatnya dengan nomor kasus moderasi. */
export function formatTicketId(ticketNumber: number): string {
  const safe = Number.isFinite(ticketNumber) ? Math.max(Math.trunc(ticketNumber), 0) : 0;
  return `#${safe.toString().padStart(4, '0')}`;
}

/** customId modal yang dibuka setelah tombol "Buat Tiket" ditekan. */
export const TICKET_SUBJECT_MODAL = `${TICKET_PREFIX}subject`;

/** Batas Discord untuk *short* text input = 45 karakter. */
export const MODAL_SUBJECT_MAX_LENGTH = 45;

/** Topik tiket paling pendek yang masih berguna. */
export const MODAL_SUBJECT_MIN_LENGTH = 3;

/** `ticket:subject` → true. null kalau bukan customId modal tiket. */
export function isTicketSubjectModal(customId: string): boolean {
  return customId === TICKET_SUBJECT_MODAL;
}