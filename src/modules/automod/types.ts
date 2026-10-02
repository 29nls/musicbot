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

export const ACTION_LABELS: Record<AutomodAction, string> = {
  delete: 'Hapus pesan',
  warn: 'Catat peringatan',
  timeout: 'Timeout',
};

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

export const RULE_LABELS: Record<AutomodRuleType, { label: string; emoji: string; description: string }> = {
  spam: {
    label: 'Anti-spam',
    emoji: '🌊',
    description: 'Pesan berturut-turut terlalu cepat (default 5 pesan / 5 detik)',
  },
  invite: {
    label: 'Anti-invite',
    emoji: '🔗',
    description: 'Link invite server Discord (default hapus + warn)',
  },
  link: { label: 'Anti-link', emoji: '🌐', description: 'Semua URL (default hapus)' },
  badword: { label: 'Badword', emoji: '🤬', description: 'Daftar kata terlarang (default kosong)' },
  mention: {
    label: 'Anti-mention-spam',
    emoji: '📣',
    description: 'Terlalu banyak mention dalam satu pesan (default >5 → timeout 10 menit)',
  },
  caps: {
    label: 'Anti-caps',
    emoji: '🔠',
    description: 'Pesan berteriak: >70% huruf kapital dan panjang >10 karakter',
  },
  duplicate: {
    label: 'Anti-duplicate',
    emoji: '🔁',
    description: 'Pesan identik berturut-turut (default 3x)',
  },
};

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

/** "5 pesan / 5 detik", "—" untuk rule tanpa ambang. */
export function describeThreshold(type: AutomodRuleType, threshold: number): string {
  switch (type) {
    case 'spam':
      return `${threshold} pesan / ${SPAM_WINDOW_MS / 1_000} detik`;
    case 'mention':
      return `${threshold} mention / pesan`;
    case 'caps':
      return `${threshold}% huruf kapital`;
    case 'duplicate':
      return `${threshold}x berturut-turut`;
    default:
      return '—';
  }
}
