/** Enam kategori log sesuai PRD §7.3. */
export const LOG_CATEGORIES = ['member', 'message', 'channel', 'role', 'voice', 'server'] as const;

export type LogCategory = (typeof LOG_CATEGORIES)[number];

export function isLogCategory(value: string): value is LogCategory {
  return (LOG_CATEGORIES as readonly string[]).includes(value);
}

/** Label, emoji, dan warna embed per kategori. */
export const CATEGORY_META: Record<LogCategory, { label: string; emoji: string; color: number }> = {
  member: { label: 'Member', emoji: '👤', color: 0x5865f2 },
  message: { label: 'Pesan', emoji: '💬', color: 0xfee75c },
  channel: { label: 'Channel', emoji: '📁', color: 0x57f287 },
  role: { label: 'Role', emoji: '🎭', color: 0xeb459e },
  voice: { label: 'Voice', emoji: '🔊', color: 0x1abc9c },
  server: { label: 'Server', emoji: '🏠', color: 0xed4245 },
};

/** Satu baris routing: kategori X dikirim ke channel Y. */
export interface LogSubscription {
  guildId: string;
  category: LogCategory;
  channelId: string;
}

/** Umur simpan riwayat log (Bab 12 privasi) — dipakai job pembersihan. */
export const DEFAULT_LOG_RETENTION_DAYS = 30;

/** Jumlah entri per halaman untuk `/logs`. */
export const LOG_PAGE_SIZE = 10;

/** Batas atas halaman supaya offset tidak meledak (per disbanded 10 = 10.000 baris). */
export const MAX_LOG_PAGE = 1_000;

/** Panjang maksimum ringkasan yang disimpan (pencocokan kata kunci). */
export const MAX_LOG_SUMMARY_LENGTH = 1_000;

/** Satu entri riwayat log seperti tersimpan di `log_entry`. */
export interface LogRecord {
  id: number;
  guildId: string;
  category: LogCategory;
  eventKey: string;
  title: string;
  summary: string;
  executorId: string | null;
  targetId: string | null;
  channelId: string | null;
  logChannelId: string | null;
  logMessageId: string | null;
  /** Nomor kasus (tanpa `#`) kalau aksi berasal dari perintah bot Harmony. */
  caseId: string | null;
  createdAt: Date;
}

/** Data minimum untuk menyimpan satu entri; `guildId` & `expiresAt` diisi service. */
export interface LogRecordInput {
  category: LogCategory;
  eventKey: string;
  title: string;
  summary?: string;
  executorId?: string | null;
  targetId?: string | null;
  channelId?: string | null;
  logChannelId?: string | null;
  /** Nomor kasus moderasi; null untuk aksi moderator lain/sistem. */
  caseNumber?: number | null;
}

/** Kriteria pencarian `/logs` — sudah tervalidasi & dinormalisasi. */
export interface LogSearchFilter {
  guildId: string;
  categories: LogCategory[];
  /** Hanya entri yang berasal dari kasus moderasi Harmony. */
  caseNumber: number | null;
  /** Satu filter "user": cocok bila jadi target ATAU executor. */
  userId: string | null;
  /** Batasi hanya entri yang targetnya ini (dipakai halaman ringkasan kasus). */
  targetId?: string | null;
  channelId: string | null;
  keyword: string | null;
  from: Date | null;
  to: Date | null;
  page: number;
  pageSize: number;
}

export interface LogSearchResult {
  rows: LogRecord[];
  /** Total baris yang cocok — bukan cuma jumlah halaman ini. */
  total: number;
}
