import { defaultTranslator, type MessageKey, type Translator } from '../i18n/index.js';

/** Tujuh rule automod sesuai PRD §7.2 — urutan array = prioritas evaluasi. */
export const AUTOMOD_RULES = [
  'spam',
  'invite',
  'link',
  'badword',
  'mention',
  'caps',
  'duplicate',
] as const;

export type AutomodRuleType = (typeof AUTOMOD_RULES)[number];

export function isAutomodRuleType(value: string): value is AutomodRuleType {
  return (AUTOMOD_RULES as readonly string[]).includes(value);
}

export const AUTOMOD_ACTIONS = ['delete', 'warn', 'timeout'] as const;

export type AutomodAction = (typeof AUTOMOD_ACTIONS)[number];

export function isAutomodAction(value: string): value is AutomodAction {
  return (AUTOMOD_ACTIONS as readonly string[]).includes(value);
}

/**
 * Label aksi dalam bahasa server.
 *
 * Dulu ini objek konstanta berisi kalimat Indonesia. Begitu bahasa server ikut
 * ditampilkan, objek yang sudah jadi tidak cukup: kalimatnya harus dicari saat
 * render, bukan saat modul dimuat. Kunci katalognya tetap satu tempat, jadi
 * label tidak bisa lagi berbeda antara `/automod show` dan embed log.
 */
export function actionLabel(action: AutomodAction, t: Translator = defaultTranslator): string {
  return t(('automod.action.' + action) as MessageKey);
}

/** Daftar pengecualian & daftar kata/domain per rule. */
export interface AutomodWhitelist {
  channels: string[];
  roles: string[];
  domains: string[];
  words: string[];
  invites: string[];
}

export interface AutomodRule {
  type: AutomodRuleType;
  enabled: boolean;
  /** 0 = rule ini tidak memakai ambang. */
  threshold: number;
  actions: AutomodAction[];
  whitelist: AutomodWhitelist;
}

/**
 * Semua rule satu server (sudah dilengkapi default) + pengecualian global.
 * `exemptChannels`/`exemptRoles` adalah gabungan dari semua rule supaya
 * pengecualian berlaku global seperti aturan PRD.
 */
export interface AutomodPolicy {
  guildId: string;
  rules: AutomodRule[];
  exemptChannels: string[];
  exemptRoles: string[];
}

/** Jendela deteksi anti-spam (PRD: 5 detik). */
export const SPAM_WINDOW_MS = 5_000;

/** Durasi timeout untuk anti-mention-spam (PRD: 10 menit). */
export const AUTOMOD_TIMEOUT_MS = 10 * 60_000;

export const DEFAULT_THRESHOLDS: Record<AutomodRuleType, number> = {
  spam: 5,
  invite: 0,
  link: 0,
  badword: 0,
  mention: 5,
  caps: 70,
  duplicate: 3,
};

/** Aksi default tiap rule sesuai kolom "Aksi Default" PRD §7.2. */
export const DEFAULT_ACTIONS: Record<AutomodRuleType, AutomodAction[]> = {
  spam: ['delete', 'warn'],
  invite: ['delete', 'warn'],
  link: ['delete'],
  badword: ['delete', 'warn'],
  mention: ['delete', 'timeout'],
  caps: ['delete'],
  duplicate: ['delete'],
};

/** Rule mana yang ambangnya bisa diubah user, beserta rentang amannya. */
export const THRESHOLD_RANGES: Record<AutomodRuleType, { min: number; max: number } | null> = {
  spam: { min: 2, max: 20 },
  invite: null,
  link: null,
  badword: null,
  mention: { min: 1, max: 20 },
  caps: { min: 10, max: 100 },
  duplicate: { min: 2, max: 10 },
};

/**
 * Metadata rule yang TIDAK diterjemahkan: emoji, dan kunci katalog label &
 * deskripsi.
 *
 * Emoji sengaja tetap di sini karena sama di kedua bahasa dan tidak pernah
 * dibaca manusia sebagai kalimat; label & deskripsi disimpan sebagai kunci
 * supaya teksnya dicari saat render. `ruleLabel` dan `ruleDescription` yang
 * menerjemahkannya.
 */
export const RULE_META: Record<AutomodRuleType, { emoji: string; key: string }> = {
  spam: { emoji: '🌊', key: 'spam' },
  invite: { emoji: '🔗', key: 'invite' },
  link: { emoji: '🌐', key: 'link' },
  badword: { emoji: '🤬', key: 'badword' },
  mention: { emoji: '📣', key: 'mention' },
  caps: { emoji: '🔠', key: 'caps' },
  duplicate: { emoji: '🔁', key: 'duplicate' },
};

/** Nama rule dalam bahasa server, mis. "Anti-spam". */
export function ruleLabel(type: AutomodRuleType, t: Translator = defaultTranslator): string {
  return t(('automod.rule.' + type + '.label') as MessageKey);
}

/** Satu baris penjelasan rule dalam bahasa server. */
export function ruleDescription(type: AutomodRuleType, t: Translator = defaultTranslator): string {
  return t(('automod.rule.' + type + '.description') as MessageKey);
}

export function emptyWhitelist(): AutomodWhitelist {
  return { channels: [], roles: [], domains: [], words: [], invites: [] };
}

/** Rule lengkap dengan nilai default dari PRD. */
export function defaultRule(type: AutomodRuleType): AutomodRule {
  return {
    type,
    enabled: true,
    threshold: DEFAULT_THRESHOLDS[type],
    actions: [...DEFAULT_ACTIONS[type]],
    whitelist: emptyWhitelist(),
  };
}

/**
 * "5 pesan / 5 detik", "—" untuk rule tanpa ambang.
 *
 * Angka detik dihitung dari `SPAM_WINDOW_MS`, bukan ditulis tetap di katalog:
 * konstanta yang diubah harus ikut terlihat di teks, bukan meninggalkan
 * kalimat yang menyebut angka lama.
 */
export function describeThreshold(
  type: AutomodRuleType,
  threshold: number,
  t: Translator = defaultTranslator,
): string {
  switch (type) {
    case 'spam':
      return t('automod.threshold.spam', {
        count: threshold,
        seconds: SPAM_WINDOW_MS / 1_000,
      });
    case 'mention':
      return t('automod.threshold.mention', { count: threshold });
    case 'caps':
      return t('automod.threshold.caps', { percent: threshold });
    case 'duplicate':
      return t('automod.threshold.duplicate', { count: threshold });
    default:
      return t('automod.threshold.none');
  }
}
