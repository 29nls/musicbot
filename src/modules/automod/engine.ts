import { SPAM_WINDOW_MS, type AutomodPolicy, type AutomodRule, type AutomodRuleType } from './types.js';

/** Subset pesan Discord yang dibutuhkan evaluasi — dipisah supaya bisa dites tanpa discord.js. */
export interface AutomodMessageInput {
  channelId: string;
  content: string;
  /** Total mention user + role (+ @everyone dihitung 1). */
  mentionCount: number;
  memberRoleIds: readonly string[];
  canManageMessages: boolean;
  isBot: boolean;
}

export interface AutomodState {
  /** Jumlah pesan user ini (termasuk pesan sekarang) dalam jendela anti-spam. */
  recentMessageCount: number;
  /** Berapa kali pesan identik berturut-turut (termasuk pesan sekarang). */
  duplicateStreak: number;
}

export interface AutomodViolation {
  rule: AutomodRuleType;
  actions: AutomodRule['actions'];
  /** Nilai terukur yang memicu, mis. 7 mention atau 6 pesan dalam 5 detik. */
  observed: number;
  reason: string;
}

const URL_PATTERN = /\bhttps?:\/\/[^\s<>()]+|\bwww\.[^\s<>()]+/gi;
const INVITE_PATTERN = /(?:discord(?:app)?\.gg|discord(?:app)?\.com\/invite)\/([a-z0-9-]+)/gi;

/** Host dari semua URL di teks (tanpa protokol/path). */
export function extractHosts(content: string): string[] {
  const hosts: string[] = [];

  for (const match of content.matchAll(URL_PATTERN)) {
    const raw = match[0];
    try {
      const url = new URL(raw.startsWith('www.') ? `https://${raw}` : raw);
      // `www.` dilepas supaya pencocokan daftar putih tidak bergantung prefix.
      hosts.push(url.hostname.toLowerCase().replace(/^www\./, ''));
    } catch {
      // URL tidak valid — abaikan, jangan sampai memicu false positive.
    }
  }

  return hosts;
}

/** Kode invite Discord di teks, mis. discord.gg/abc123 → "abc123". */
export function findInviteCodes(content: string): string[] {
  const codes: string[] = [];

  for (const match of content.matchAll(INVITE_PATTERN)) {
    const code = match[1];
    if (code) codes.push(code.toLowerCase());
  }

  return codes;
}

/** Cari kata terlarang dengan batas kata sederhana (agar "ass" tidak kena "class"). */
export function findBadword(content: string, words: readonly string[]): string | null {
  const lower = content.toLowerCase();
  const isBoundary = (char: string | undefined): boolean =>
    char === undefined || !/[\p{L}\p{N}]/u.test(char);

  for (const word of words) {
    const needle = word.toLowerCase();
    if (!needle) continue;

    let index = lower.indexOf(needle);
    while (index !== -1) {
      const before = index === 0 ? undefined : lower[index - 1];
      const after = lower[index + needle.length];
      if (isBoundary(before) && isBoundary(after)) return word;
      index = lower.indexOf(needle, index + 1);
    }
  }

  return null;
}

/** Persentase huruf kapital dari seluruh huruf di teks (0 kalau tidak ada huruf). */
export function capsPercent(content: string): number {
  const letters = content.match(/\p{L}/gu) ?? [];
  if (letters.length === 0) return 0;

  const upper = letters.filter((letter) => /\p{Lu}/u.test(letter)).length;
  return (upper / letters.length) * 100;
}

/** Pengecualian global PRD: channel/role di-whitelist dan pemegang Manage Messages. */
export function isExempt(message: AutomodMessageInput, policy: AutomodPolicy): boolean {
  if (message.isBot) return true;
  if (message.canManageMessages) return true;
  if (policy.exemptChannels.includes(message.channelId)) return true;
  return message.memberRoleIds.some((roleId) => policy.exemptRoles.includes(roleId));
}

function hostAllowed(host: string, domains: readonly string[]): boolean {
  return domains.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

const violation = (
  rule: AutomodRule,
  observed: number,
  reason: string,
): AutomodViolation => ({
  rule: rule.type,
  actions: [...rule.actions],
  observed,
  reason,
});

function checkRule(
  rule: AutomodRule,
  message: AutomodMessageInput,
  state: AutomodState,
): AutomodViolation | null {
  switch (rule.type) {
    case 'spam': {
      if (state.recentMessageCount > rule.threshold) {
        return violation(
          rule,
          state.recentMessageCount,
          `Mengirim ${state.recentMessageCount} pesan dalam ${SPAM_WINDOW_MS / 1_000} detik`,
        );
      }
      return null;
    }

    case 'invite': {
      const codes = findInviteCodes(message.content);
      if (codes.length === 0) return null;

      const allowed = new Set(rule.whitelist.invites);
      const offending = codes.filter((code) => !allowed.has(code));
      if (offending.length === 0) return null;

      return violation(rule, offending.length, 'Mengirim link invite server Discord');
    }

    case 'link': {
      const hosts = extractHosts(message.content);
      if (hosts.length === 0) return null;

      const offending = hosts.filter((host) => !hostAllowed(host, rule.whitelist.domains));
      if (offending.length === 0) return null;

      const shown = offending.slice(0, 3).join(', ');
      const rest = offending.length > 3 ? ` (+${offending.length - 3})` : '';
      return violation(rule, offending.length, `Mengirim link: ${shown}${rest}`);
    }

    case 'badword': {
      if (rule.whitelist.words.length === 0) return null;

      const found = findBadword(message.content, rule.whitelist.words);
      if (!found) return null;

      return violation(rule, 1, `Mengandung kata terlarang: \`${found}\``);
    }

    case 'mention': {
      if (message.mentionCount > rule.threshold) {
        return violation(
          rule,
          message.mentionCount,
          `Menyebut ${message.mentionCount} mention dalam satu pesan`,
        );
      }
      return null;
    }

    case 'caps': {
      const trimmed = message.content.trim();
      if (trimmed.length <= 10) return null;

      const percent = capsPercent(trimmed);
      if (percent <= rule.threshold) return null;

      return violation(rule, Math.round(percent), `Terlalu banyak huruf kapital (${Math.round(percent)}%)`);
    }

    case 'duplicate': {
      if (state.duplicateStreak >= rule.threshold) {
        return violation(
          rule,
          state.duplicateStreak,
          `Mengirim pesan identik ${state.duplicateStreak}x berturut-turut`,
        );
      }
      return null;
    }

    default:
      return null;
  }
}

/**
 * Evaluasi satu pesan terhadap semua rule (urutan prioritas = urutan
 * `AUTOMOD_RULES`). Mengembalikan pelanggaran pertama, atau null kalau aman.
 */
export function analyzeMessage(
  message: AutomodMessageInput,
  policy: AutomodPolicy,
  state: AutomodState,
): AutomodViolation | null {
  if (isExempt(message, policy)) return null;

  for (const rule of policy.rules) {
    if (!rule.enabled) continue;

    const found = checkRule(rule, message, state);
    if (found) return found;
  }

  return null;
}
