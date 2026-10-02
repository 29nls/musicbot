import type { AutomodRepository } from './repository.js';
import {
  AUTOMOD_RULES,
  defaultRule,
  type AutomodPolicy,
  type AutomodRule,
  type AutomodRuleType,
  type AutomodWhitelist,
} from './types.js';
import {
  AutomodValidationError,
  assertSnowflake,
  normalizeDomain,
  normalizeInvite,
  normalizeWord,
  validateThreshold,
} from './validation.js';

export type AutomodListField = 'domains' | 'words' | 'invites';
export type AutomodExemptionKind = 'channels' | 'roles';

/** Daftar yang hanya masuk akal untuk satu rule tertentu. */
const FIELD_RULE: Record<AutomodListField, AutomodRuleType> = {
  domains: 'link',
  words: 'badword',
  invites: 'invite',
};

export interface AutomodServiceOptions {
  /** Umur cache (ms); 0 = cache dimatikan. */
  cacheTtlMs?: number;
}

interface CacheEntry {
  policy: AutomodPolicy;
  expiresAt: number;
}

/** Gabungkan baris yang tersimpan dengan default sehingga 7 rule selalu lengkap. */
export function buildPolicy(guildId: string, stored: readonly AutomodRule[]): AutomodPolicy {
  const byType = new Map<AutomodRuleType, AutomodRule>();
  for (const rule of stored) byType.set(rule.type, rule);

  const rules = AUTOMOD_RULES.map((type) => byType.get(type) ?? defaultRule(type));

  return {
    guildId,
    rules,
    // Pengecualian channel/role bersifat global: gabungan dari semua rule.
    exemptChannels: [...new Set(rules.flatMap((rule) => rule.whitelist.channels))],
    exemptRoles: [...new Set(rules.flatMap((rule) => rule.whitelist.roles))],
  };
}

function withExemption(
  whitelist: AutomodWhitelist,
  kind: AutomodExemptionKind,
  value: string,
  add: boolean,
): AutomodWhitelist {
  if (kind === 'channels') {
    const channels = add
      ? [...whitelist.channels, value]
      : whitelist.channels.filter((item) => item !== value);
    return { ...whitelist, channels };
  }

  const roles = add ? [...whitelist.roles, value] : whitelist.roles.filter((item) => item !== value);
  return { ...whitelist, roles };
}

function withList(
  whitelist: AutomodWhitelist,
  field: AutomodListField,
  values: string[],
): AutomodWhitelist {
  switch (field) {
    case 'domains':
      return { ...whitelist, domains: values };
    case 'words':
      return { ...whitelist, words: values };
    case 'invites':
      return { ...whitelist, invites: values };
  }
}

function normalizeListItem(field: AutomodListField, value: string): string {
  switch (field) {
    case 'domains':
      return normalizeDomain(value);
    case 'words':
      return normalizeWord(value);
    case 'invites':
      return normalizeInvite(value);
  }
}

/**
 * Sumber kebenaran rule automod satu server.
 *
 * - Baca: cache in-memory (default 60 detik) karena evaluasi berjalan di setiap
 *   pesan, bukan setiap perintah.
 * - Tulis: simpan ke DB lalu buang cache — perubahan berlaku di pesan berikutnya.
 */
export class AutomodService {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly cacheTtlMs: number;

  constructor(
    private readonly repository: AutomodRepository,
    options: AutomodServiceOptions = {},
  ) {
    this.cacheTtlMs = options.cacheTtlMs ?? 60_000;
  }

  async getPolicy(guildId: string): Promise<AutomodPolicy> {
    const cached = this.readCache(guildId);
    if (cached) return cached;

    const stored = await this.repository.list(guildId);
    const policy = buildPolicy(guildId, stored);
    this.writeCache(guildId, policy);

    return policy;
  }

  /** Nyalakan/matikan rule atau ubah ambangnya. */
  async updateRule(
    guildId: string,
    type: AutomodRuleType,
    patch: { enabled?: boolean; threshold?: number },
  ): Promise<AutomodRule> {
    const policy = await this.getPolicy(guildId);
    const existing = policy.rules.find((rule) => rule.type === type) ?? defaultRule(type);

    const next: AutomodRule = { ...existing };
    if (patch.enabled !== undefined) next.enabled = patch.enabled;
    if (patch.threshold !== undefined) next.threshold = validateThreshold(type, patch.threshold);

    await this.repository.save(guildId, next);
    this.invalidate(guildId);

    return next;
  }

  /** Tambah channel/role ke pengecualian global (ditulis ke semua rule). */
  async addExemption(guildId: string, kind: AutomodExemptionKind, id: string): Promise<void> {
    const value = assertSnowflake(id, kind === 'channels' ? 'channel' : 'role');
    const policy = await this.getPolicy(guildId);

    if (policy.rules.some((rule) => rule.whitelist[kind].includes(value))) {
      throw new AutomodValidationError(`ID itu sudah ada di daftar pengecualian ${kind}.`);
    }

    await Promise.all(
      policy.rules.map((rule) =>
        this.repository.save(guildId, {
          ...rule,
          whitelist: withExemption(rule.whitelist, kind, value, true),
        }),
      ),
    );
    this.invalidate(guildId);
  }

  async removeExemption(guildId: string, kind: AutomodExemptionKind, id: string): Promise<void> {
    const value = assertSnowflake(id, kind === 'channels' ? 'channel' : 'role');
    const policy = await this.getPolicy(guildId);

    if (!policy.rules.some((rule) => rule.whitelist[kind].includes(value))) {
      throw new AutomodValidationError(`ID itu tidak ada di daftar pengecualian ${kind}.`);
    }

    await Promise.all(
      policy.rules.map((rule) =>
        this.repository.save(guildId, {
          ...rule,
          whitelist: withExemption(rule.whitelist, kind, value, false),
        }),
      ),
    );
    this.invalidate(guildId);
  }

  /** Tambah domain/kata/invite ke daftar putih rule terkait. */
  async addListItem(
    guildId: string,
    type: AutomodRuleType,
    field: AutomodListField,
    value: string,
  ): Promise<AutomodRule> {
    if (FIELD_RULE[field] !== type) {
      throw new AutomodValidationError(`Rule **${type}** tidak memakai daftar \`${field}\`.`);
    }

    const normalized = normalizeListItem(field, value);
    const policy = await this.getPolicy(guildId);
    const rule = policy.rules.find((item) => item.type === type) ?? defaultRule(type);

    if (rule.whitelist[field].includes(normalized)) {
      throw new AutomodValidationError(`\`${normalized}\` sudah ada di daftar ${field}.`);
    }

    const next: AutomodRule = {
      ...rule,
      whitelist: withList(rule.whitelist, field, [...rule.whitelist[field], normalized]),
    };

    await this.repository.save(guildId, next);
    this.invalidate(guildId);

    return next;
  }

  async removeListItem(
    guildId: string,
    type: AutomodRuleType,
    field: AutomodListField,
    value: string,
  ): Promise<AutomodRule> {
    if (FIELD_RULE[field] !== type) {
      throw new AutomodValidationError(`Rule **${type}** tidak memakai daftar \`${field}\`.`);
    }

    const normalized = normalizeListItem(field, value);
    const policy = await this.getPolicy(guildId);
    const rule = policy.rules.find((item) => item.type === type) ?? defaultRule(type);

    if (!rule.whitelist[field].includes(normalized)) {
      throw new AutomodValidationError(`\`${normalized}\` tidak ada di daftar ${field}.`);
    }

    const next: AutomodRule = {
      ...rule,
      whitelist: withList(
        rule.whitelist,
        field,
        rule.whitelist[field].filter((item) => item !== normalized),
      ),
    };

    await this.repository.save(guildId, next);
    this.invalidate(guildId);

    return next;
  }

  /** Buang cache satu server (atau seluruhnya). */
  invalidate(guildId?: string): void {
    if (guildId) this.cache.delete(guildId);
    else this.cache.clear();
  }

  private readCache(guildId: string): AutomodPolicy | undefined {
    if (this.cacheTtlMs <= 0) return undefined;

    const entry = this.cache.get(guildId);
    if (!entry) return undefined;

    if (entry.expiresAt <= Date.now()) {
      this.cache.delete(guildId);
      return undefined;
    }

    return entry.policy;
  }

  private writeCache(guildId: string, policy: AutomodPolicy): void {
    if (this.cacheTtlMs <= 0) return;
    this.cache.set(guildId, { policy, expiresAt: Date.now() + this.cacheTtlMs });
  }
}
