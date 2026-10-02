/**
 * Inventaris data member — jawaban konkret untuk pertanyaan "apa yang disimpan
 * Harmony tentang saya?".
 *
 * Murni: angka-angkanya sudah diambil service, di sini hanya dirangkai jadi
 * kalimat. Embed menampilkan angka apa adanya, termasuk saat nol, karena
 * "0 catatan" adalah informasi — bukan baris yang layak disembunyikan supaya
 * embed terlihat lebih ramping.
 */

import { ACTION_LABELS, isModerationAction, type ModerationAction } from '../moderation/types.js';

/** Berapa jenis aksi yang dirinci sebelum sisanya jadi "+N jenis lain". */
const BREAKDOWN_LIMIT = 4;

/** Satu kelompok data yang disimpan tentang member. */
export interface InventoryRow {
  label: string;
  value: string;
  /** true kalau kelompok ini ikut dibersihkan saat `/data-delete` dijalankan. */
  removedByDataDelete: boolean;
}

/** Inventaris data satu member di satu server. */
export interface DataInventory {
  guildId: string;
  userId: string;
  /** Jumlah kasus moderasi atas member ini, semua jenis. */
  caseTotal: number;
  /** Per jenis aksi, urut dari terbanyak. */
  cases: { type: ModerationAction; count: number }[];
  /** Peringatan yang masih berlaku (bukan yang sudah dicabut). */
  activeWarnings: number;
  /** Tiket yang pernah dibuka member ini. */
  tickets: number;
  /** Tiket di antaranya yang transkripnya masih tersimpan. */
  ticketTranscripts: number;
  /** Entri log yang menyebut member ini sebagai target atau pelaku. */
  logEntries: number;
}

export function emptyInventory(guildId: string, userId: string): DataInventory {
  return {
    guildId,
    userId,
    caseTotal: 0,
    cases: [],
    activeWarnings: 0,
    tickets: 0,
    ticketTranscripts: 0,
    logEntries: 0,
  };
}

/**
 * Bangun inventaris dari agregat per jenis aksi.
 *
 * `actionRows` dihimpun dari `groupBy`, jadi jenis aksi tak dikenal ikut
 * menambah total tapi tidak dirinci: menampilkan "?" lebih membingungkan
 * daripada tidak menampilkannya, dan jumlahnya tetap tercermin di baris total.
 */
export function buildInventory(input: {
  guildId: string;
  userId: string;
  actionRows: readonly { type: string; active: boolean; count: number }[];
  activeWarnings: number;
  tickets: number;
  ticketTranscripts: number;
  logEntries: number;
}): DataInventory {
  const counts = new Map<ModerationAction, number>();
  let caseTotal = 0;

  for (const row of input.actionRows) {
    caseTotal += row.count;
    if (!isModerationAction(row.type)) continue;
    counts.set(row.type, (counts.get(row.type) ?? 0) + row.count);
  }

  const cases = [...counts.entries()]
    .map(([type, count]) => ({ type, count }))
    .sort(
      (a, b) =>
        b.count - a.count || ACTION_LABELS[a.type].label.localeCompare(ACTION_LABELS[b.type].label, 'id'),
    );

  return {
    guildId: input.guildId,
    userId: input.userId,
    caseTotal,
    cases,
    activeWarnings: input.activeWarnings,
    tickets: input.tickets,
    ticketTranscripts: input.ticketTranscripts,
    logEntries: input.logEntries,
  };
}

/** Baris sebaran jenis aksi, dipangkas supaya tidak jadi paragraf. */
export function inventoryActionLine(inventory: DataInventory): string | null {
  if (inventory.cases.length === 0) return null;

  const shown = inventory.cases.slice(0, BREAKDOWN_LIMIT);
  const rest = inventory.cases.length - shown.length;
  const parts = shown.map((item) => `${ACTION_LABELS[item.type].label} \`${item.count}\``);

  if (rest > 0) parts.push(`+${rest} jenis lain`);

  return parts.join(' · ');
}

/** Baris "sudah cleaned" untuk tiap kelompok data, apa adanya — termasuk nol. */
export function inventoryRows(inventory: DataInventory): InventoryRow[] {
  const actionLine = inventoryActionLine(inventory);
  const casesValue =
    actionLine === null ? 'Tidak ada' : `${inventory.caseTotal} (${actionLine})`;

  return [
    {
      label: 'Kasus moderasi',
      value: casesValue,
      removedByDataDelete: true,
    },
    {
      label: 'Peringatan yang masih berlaku',
      value: String(inventory.activeWarnings),
      removedByDataDelete: true,
    },
    {
      label: 'Catatan internal (/note)',
      value: String(inventory.cases.find((item) => item.type === 'note')?.count ?? 0),
      removedByDataDelete: true,
    },
    {
      label: 'Tiket dibuka (+ transkrip tersimpan)',
      value: `${inventory.tickets} (+${inventory.ticketTranscripts})`,
      removedByDataDelete: true,
    },
    {
      label: 'Entri log yang menyebut kamu',
      value: String(inventory.logEntries),
      // Log dihapus, bukan dianonimkan — jadi tidak ada yang tersisa darinya.
      removedByDataDelete: false,
    },
  ];
}

/** Total baris yang akan tersentuh `/data-delete` untuk inventaris ini. */
export function inventoryTouchedCount(inventory: DataInventory): number {
  return (
    inventory.caseTotal +
    inventory.activeWarnings +
    inventory.tickets +
    inventory.ticketTranscripts +
    inventory.logEntries
  );
}
