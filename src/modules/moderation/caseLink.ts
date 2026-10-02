import type { ModerationAction } from './types.js';

/**
 * Tautan singkat antara aksi moderasi Harmony dan event Discord yang menyusul.
 *
 * Saat `/ban` dijalankan, Discord lebih dulu membalas API, lalu mengirim event
 * `guildBanAdd` beberapa saat kemudian. Tanpa jembatan ini, log kategori hanya
 * tahu "seseorang memblokir X" tanpa tahu apakah itu kasus `#CASE-0142` dari
 * Harmony atau tindakan moderator lain. Registry ini menjembataninya:
 * kasus dicatat, tautan didaftarkan, lalu event yang datang mengambil tautannya.
 */
export interface CaseLink {
  guildId: string;
  /** Member (ban/kick/timeout/unban) atau channel (slowmode/lock/unlock). */
  targetId: string;
  action: ModerationAction;
  caseNumber: number;
  /** Moderator yang menjalankan perintahnya (bisa bot lain yang punya izin). */
  moderatorId: string;
  createdAt: number;
}

/** Aksi yang menghasilkan event Discord dan karena itu bisa dijembatani. */
export const LINKED_CASE_ACTIONS: readonly ModerationAction[] = [
  'ban',
  'kick',
  'timeout',
  'unban',
  'slowmode',
  'lock',
  'unlock',
];

/** Event Discord bisa tiba terlambat; 60 detik sudah jauh melebihi itu. */
const TTL_MS = 60_000;

/** Batas aman supaya tautan tidak menumpuk tanpa henti. */
const MAX_KEYS = 500;

const links = new Map<string, CaseLink[]>();

function linkKey(guildId: string, targetId: string): string {
  return `${guildId}:${targetId}`;
}

/** Buang tautan yang sudah lewat masa berlaku (dan batasi jumlah server). */
function prune(): void {
  const now = Date.now();

  for (const [key, list] of links) {
    const fresh = list.filter((link) => now - link.createdAt < TTL_MS);
    if (fresh.length === 0) links.delete(key);
    else if (fresh.length !== list.length) links.set(key, fresh);
  }

  while (links.size > MAX_KEYS) {
    const oldest = links.keys().next();
    if (oldest.done) break;
    links.delete(oldest.value);
  }
}

/**
 * Daftarkan tautan tepat sebelum aksi Discord dieksekusi supaya tidak ada
 * event yang datang lebih dulu dan tidak menemukan tautannya.
 */
export function registerCaseLink(link: Omit<CaseLink, 'createdAt'>): void {
  prune();

  const key = linkKey(link.guildId, link.targetId);
  const list = links.get(key) ?? [];
  list.push({ ...link, createdAt: Date.now() });
  links.set(key, list);
}

/**
 * Ambil tautan yang cocok lalu hapus dari antrean — satu aksi = satu event.
 * Tautan dengan aksi lain tetap disimpan (mis. timeout lalu kick beruntun).
 * Mengembalikan null kalau tidak ada, artinya aksi datang dari luar Harmony.
 */
export function consumeCaseLink(
  guildId: string,
  targetId: string,
  actions: readonly ModerationAction[],
): CaseLink | null {
  prune();

  const key = linkKey(guildId, targetId);
  const list = links.get(key);
  if (!list) return null;

  const index = list.findIndex((link) => actions.includes(link.action));
  if (index === -1) return null;

  const [found] = list.splice(index, 1);
  if (list.length === 0) links.delete(key);

  return found ?? null;
}

/** Buang semua tautan — dipakai saat bot start ulang atau saat shutdown. */
export function clearCaseLinks(guildId?: string): void {
  if (!guildId) {
    links.clear();
    return;
  }

  for (const key of [...links.keys()]) {
    if (key.startsWith(`${guildId}:`)) links.delete(key);
  }
}

/** Jumlah target yang masih punya tautan aktif — untuk tes & diagnostik. */
export function pendingCaseLinkCount(): number {
  prune();
  return links.size;
}
