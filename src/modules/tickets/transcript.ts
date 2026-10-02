/**
 * Transkrip tiket: isi percakapan channel tiket yang diambil saat tiket ditutup.
 *
 * Disimpan sebagai satu blob JSON di baris `ticket`, bukan tabel terpisah, dengan
 * alasan yang tidak bisa dipindah ke tempat lain: retensi menghapus baris tiket,
 * jadi transkrip ikut hilang di operasi yang sama. Tidak ada data percakapan
 * yang bisa tertinggal sebagai baris yatim — dan "hapus tiket = hapus transkrip"
 * jadi satu fakta, bukan dua hal yang harus dijaga sinkron.
 */

import { MessageType, type Message, type TextChannel } from 'discord.js';
import { getLogger } from '../../services/logger.js';
import { formatTicketId, type Ticket } from './types.js';

/** Batas Discord untuk isi satu pesan. */
export const MAX_MESSAGE_CONTENT_LENGTH = 2_000;

/**
 * Batas jumlah pesan yang disimpan per tiket.
 *
 * Discord hanya mengembalikan 100 pesan per permintaan, jadi mengambil ribuan
 * pesan berarti puluhan permintaan API — dan tiket yang bisa mencapai angka itu
 * biasanya sudah tidak relevan. Yang terbaru yang disimpan, sisanya ditandai
 * terpotong supaya tidak ada yang mengira transkripnya lengkap.
 */
export const MAX_TRANSCRIPT_MESSAGES = 500;

/** Jumlah pesan yang ditampilkan sebagai preview di Discord. */
export const TRANSCRIPT_PREVIEW_COUNT = 8;

/** Jumlah pesan per permintaan ke Discord (maks API). */
const FETCH_PAGE_SIZE = 100;

/** Hanya pesan yang benar-benar ditulis manusia atau bot; sisanya pesan sistem. */
const CONTENT_TYPES: readonly MessageType[] = [MessageType.Default, MessageType.Reply];

/** Satu pesan dalam transkrip. */
export interface TranscriptEntry {
  messageId: string;
  authorId: string;
  /** Nama tampilan saat pesan dikirim — disimpan karena nama bisa berubah. */
  authorName: string;
  content: string;
  /** ISO-8601; string supaya aman di JSON tanpa timezone ambigu. */
  createdAt: string;
  /** URL lampiran; filenya sendiri tidak pernah disalin ke database. */
  attachments: string[];
}

/** Seluruh isi percakapan satu tiket. */
export interface TicketTranscript {
  /** Kapan transkrip diambil. */
  capturedAt: string;
  /** Berapa pesan yang benar-benar tersimpan. */
  messageCount: number;
  /** true kalau ada pesan yang tidak ikut disimpan karena melewati batas. */
  truncated: boolean;
  messages: TranscriptEntry[];
}

/**
 * Baca transkrip dari kolom JSON database.
 *
 * Kolom JSON bisa berisi data lama, rusak, atau hasil salinan manual. Semua
 * bentuk yang tidak dikenal jatuh ke `null` (tidak ada transkrip) daripada
 * setengah jadi: menampilkan "tidak ada" lebih jujur daripada menampilkan isi
 * yang tidak bisa dipercaya berasal dari mana.
 */
export function parseTranscript(value: unknown): TicketTranscript | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;

  const record = value as Record<string, unknown>;
  const rawMessages = Array.isArray(record.messages) ? record.messages : null;
  if (!rawMessages) return null;

  const messages: TranscriptEntry[] = [];
  for (const item of rawMessages) {
    const entry = toEntry(item);
    if (entry) messages.push(entry);
  }

  const truncated = record.truncated === true;

  return {
    capturedAt: typeof record.capturedAt === 'string' ? record.capturedAt : '',
    messageCount:
      typeof record.messageCount === 'number' && Number.isFinite(record.messageCount)
        ? record.messageCount
        : messages.length,
    truncated,
    messages,
  };
}

function toEntry(value: unknown): TranscriptEntry | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;

  const record = value as Record<string, unknown>;
  if (typeof record.messageId !== 'string' || typeof record.createdAt !== 'string') return null;

  const attachments = Array.isArray(record.attachments)
    ? record.attachments.filter((item): item is string => typeof item === 'string')
    : [];

  return {
    messageId: record.messageId,
    authorId: typeof record.authorId === 'string' ? record.authorId : '',
    authorName: typeof record.authorName === 'string' ? record.authorName : 'Tidak diketahui',
    content: typeof record.content === 'string' ? record.content : '',
    createdAt: record.createdAt,
    attachments,
  };
}

/**
 * Ambil seluruh isi channel tiket.
 *
 * Dipanggil **sebelum** channel diarsipkan, saat bot pasti masih punya akses
 * baca. Best-effort: kegagalan di sini tidak boleh menggagalkan penutupan tiket
 * — tiket yang sudah tertutup tanpa transkrip jauh lebih baik daripada tiket
 * yang menggantung terbuka karena pengambilan pesan gagal.
 *
 * Mengembalikan null kalau tidak ada satu pun pesan yang bisa dibaca.
 */
export async function captureTranscript(
  channel: TextChannel,
  now = new Date(),
): Promise<TicketTranscript | null> {
  try {
    const collected: TranscriptEntry[] = [];
    let before: string | undefined;

    // Discord mengembalikan pesan terbaru lebih dulu, jadi paginasi mundur ke
    // belakang lewat `before` sampai habis atau batas tercapai.
    for (;;) {
      const page = await channel.messages.fetch({
        limit: FETCH_PAGE_SIZE,
        ...(before ? { before } : {}),
      });
      if (page.size === 0) break;

      const batch = [...page.values()]
        .filter((message) => isContentMessage(message))
        .map(toTranscriptEntry);

      // Discord mengirim halaman terbaru lebih dulu, jadi batch perlu dibalik
      // sebelum disisipkan di depan — kalau tidak, transkrip tersimpan terbalik
      // dan yang muncul "terakhir" adalah pesan paling awal.
      collected.unshift(...batch.reverse());

      // Discord mengembalikan pesan terbaru lebih dulu, jadi ID terkecil di
      // halaman ini adalah pesan tertua — titik paginasi berikutnya.
      const oldest = [...page.values()].reduce(
        (lowest, message) => (message.id < lowest ? message.id : lowest),
        page.values().next().value?.id ?? '',
      );
      before = oldest;
      if (page.size < FETCH_PAGE_SIZE) break;
    }

    const truncated = collected.length > MAX_TRANSCRIPT_MESSAGES;
    const messages = truncated
      ? collected.slice(collected.length - MAX_TRANSCRIPT_MESSAGES)
      : collected;

    if (messages.length === 0) return null;

    return {
      capturedAt: now.toISOString(),
      messageCount: messages.length,
      truncated,
      messages,
    };
  } catch (error) {
    getLogger().warn(
      { err: error, channel: channel.id },
      'Gagal mengambil transkrip channel tiket',
    );

    return null;
  }
}

function isContentMessage(message: Message): boolean {
  return CONTENT_TYPES.includes(message.type);
}

/** Satu pesan Discord → entri transkrip, dengan batas panjang isi. */
function toTranscriptEntry(message: Message): TranscriptEntry {
  return {
    messageId: message.id,
    authorId: message.author.id,
    authorName: message.author.displayName,
    content: truncate(message.content ?? '', MAX_MESSAGE_CONTENT_LENGTH),
    createdAt: message.createdAt.toISOString(),
    attachments: message.attachments.map((attachment) => attachment.url),
  };
}

/**
 * Waktu ditulis dalam UTC supaya urutannya jelas tanpa member menebak zona waktu.
 */
export function renderTranscriptText(ticket: Ticket, transcript: TicketTranscript): string {
  const lines: string[] = [
    `Transkrip Tiket ${formatTicketId(ticket.ticketNumber)}`,
    `Subjek: ${ticket.subject ?? '(tanpa subjek)'}`,
    `Pembuat: ${ticket.openerId}`,
    `Dibuka: ${ticket.createdAt.toISOString()}`,
  ];

  if (ticket.closedAt) lines.push(`Ditutup: ${ticket.closedAt.toISOString()}`);
  lines.push(`Pesan tersimpan: ${transcript.messageCount}`, '');

  if (transcript.messages.length === 0) {
    lines.push('(tidak ada pesan yang bisa dibaca)');
  }

  for (const entry of transcript.messages) {
    lines.push(
      `[${entry.createdAt}] ${entry.authorName} (${entry.authorId}): ${entry.content || '(tanpa teks)'}`,
    );
    for (const url of entry.attachments) lines.push(`    lampiran: ${url}`);
  }

  if (transcript.truncated) {
    lines.push(
      '',
      `Catatan: transkrip dipotong pada ${MAX_TRANSCRIPT_MESSAGES} pesan terakhir;`,
      'percakapan yang lebih lama tidak tersimpan.',
    );
  }

  return lines.join('\n');
}

/** Preview singkat untuk ditampilkan di Discord sebelum file dilampirkan. */
export function transcriptPreviewLines(
  transcript: TicketTranscript,
  count = TRANSCRIPT_PREVIEW_COUNT,
): string {
  const messages = transcript.messages.slice(-count);

  return messages
    .map((entry) => {
      const text = entry.content.replace(/\s+/g, ' ').trim() || '(tanpa teks)';
      const time = entry.createdAt.slice(11, 16);

      return `\`${time} UTC\` **${entry.authorName}**: ${truncate(text, 160)}`;
    })
    .join('\n');
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}