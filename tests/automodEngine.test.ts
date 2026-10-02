import { describe, expect, it } from 'vitest';
import {
  analyzeMessage,
  capsPercent,
  extractHosts,
  findBadword,
  findInviteCodes,
  type AutomodMessageInput,
  type AutomodState,
} from '../src/modules/automod/engine.js';
import { defaultRule, type AutomodPolicy, type AutomodRule, type AutomodRuleType } from '../src/modules/automod/types.js';

const rule = (type: AutomodRuleType, overrides: Partial<AutomodRule> = {}): AutomodRule => ({
  ...defaultRule(type),
  ...overrides,
});

const policyWith = (rules: AutomodRule[]): AutomodPolicy => ({
  guildId: '123456789012345678',
  rules,
  exemptChannels: [],
  exemptRoles: [],
});

const message = (overrides: Partial<AutomodMessageInput> = {}): AutomodMessageInput => ({
  channelId: '111111111111111111',
  content: 'halo dunia',
  mentionCount: 0,
  memberRoleIds: [],
  canManageMessages: false,
  isBot: false,
  ...overrides,
});

const state = (overrides: Partial<AutomodState> = {}): AutomodState => ({
  recentMessageCount: 1,
  duplicateStreak: 1,
  ...overrides,
});

const analyze = (
  type: AutomodRuleType,
  options: {
    message?: Partial<AutomodMessageInput>;
    state?: Partial<AutomodState>;
    rules?: AutomodRule[];
    ruleOverrides?: Partial<AutomodRule>;
  } = {},
) =>
  analyzeMessage(
    message(options.message),
    policyWith(options.rules ?? [rule(type, options.ruleOverrides)]),
    state(options.state),
  );

describe('rule anti-spam', () => {
  it('terpicu saat melewati ambang dalam jendela', () => {
    const found = analyze('spam', { state: { recentMessageCount: 6 } });

    expect(found?.rule).toBe('spam');
    expect(found?.actions).toEqual(['delete', 'warn']);
    expect(found?.observed).toBe(6);
  });

  it('tidak terpicu tepat di ambang', () => {
    expect(analyze('spam', { state: { recentMessageCount: 5 } })).toBeNull();
  });
});

describe('rule anti-invite', () => {
  it('mendeteksi discord.gg dan discord.com/invite', () => {
    expect(analyze('invite', { message: { content: 'join discord.gg/abc123' } })?.rule).toBe('invite');
    expect(
      analyze('invite', { message: { content: 'https://discord.com/invite/xyz789' } })?.rule,
    ).toBe('invite');
  });

  it('menghormati daftar invite yang diizinkan', () => {
    const rules = [rule('invite', { whitelist: { ...defaultRule('invite').whitelist, invites: ['abc123'] } })];

    expect(analyze('invite', { message: { content: 'discord.gg/abc123' }, rules })).toBeNull();
    expect(analyze('invite', { message: { content: 'discord.gg/abc123 dan discord.gg/lain' }, rules })?.rule).toBe(
      'invite',
    );
  });
});

describe('rule anti-link', () => {
  it('mendeteksi URL biasa dan www', () => {
    expect(analyze('link', { message: { content: 'lihat https://example.com/artikel' } })?.rule).toBe('link');
    expect(analyze('link', { message: { content: 'kunjungi www.example.com' } })?.rule).toBe('link');
  });

  it('mengizinkan domain (termasuk subdomain) dari daftar', () => {
    const whitelist = { ...defaultRule('link').whitelist, domains: ['youtube.com'] };
    const rules = [rule('link', { whitelist })];

    expect(analyze('link', { message: { content: 'cek https://youtube.com/watch?v=1' }, rules })).toBeNull();
    expect(analyze('link', { message: { content: 'cek https://m.youtube.com/watch?v=1' }, rules })).toBeNull();
    expect(analyze('link', { message: { content: 'cek https://notyoutube.com/x' }, rules })?.rule).toBe('link');
  });
});

describe('rule badword', () => {
  it('diam kalau daftar kata kosong', () => {
    expect(analyze('badword', { message: { content: 'anjing' } })).toBeNull();
  });

  it('mendeteksi kata terlarang tanpa memedulikan kapital', () => {
    const whitelist = { ...defaultRule('badword').whitelist, words: ['anjing'] };
    const found = analyze('badword', {
      message: { content: 'Dasar ANJING!' },
      ruleOverrides: { whitelist },
    });

    expect(found?.rule).toBe('badword');
  });

  it('memakai batas kata, bukan substring', () => {
    const whitelist = { ...defaultRule('badword').whitelist, words: ['ass'] };
    const rules = [rule('badword', { whitelist })];

    expect(analyze('badword', { message: { content: 'class assignment' }, rules })).toBeNull();
    expect(analyze('badword', { message: { content: 'you are ass!' }, rules })?.rule).toBe('badword');
  });
});

describe('rule anti-mention-spam', () => {
  it('terpicu di atas ambang mention', () => {
    const found = analyze('mention', { message: { mentionCount: 7 } });

    expect(found?.rule).toBe('mention');
    expect(found?.actions).toEqual(['delete', 'timeout']);
  });

  it('tidak terpicu di ambang', () => {
    expect(analyze('mention', { message: { mentionCount: 5 } })).toBeNull();
  });
});

describe('rule anti-caps', () => {
  it('terpicu saat mayoritas kapital dan pesan cukup panjang', () => {
    expect(analyze('caps', { message: { content: 'HALO SEMUA ORANG' } })?.rule).toBe('caps');
  });

  it('tidak terpicu untuk pesan pendek atau kapital di ambang', () => {
    expect(analyze('caps', { message: { content: 'HI!' } })).toBeNull();
    // 10 huruf: 7 kapital = tepat 70% — PRD memakai ">70%".
    expect(analyze('caps', { message: { content: 'ABCDEFGabc!' } })).toBeNull();
    expect(analyze('caps', { message: { content: 'ABCDEFGHabc!' } })?.rule).toBe('caps');
  });
});

describe('rule anti-duplicate', () => {
  it('terpicu saat pesan identik mencapai ambang', () => {
    expect(analyze('duplicate', { state: { duplicateStreak: 3 } })?.rule).toBe('duplicate');
    expect(analyze('duplicate', { state: { duplicateStreak: 2 } })).toBeNull();
  });
});

describe('pengecualian & prioritas', () => {
  it('melewati pemegang Manage Messages', () => {
    expect(
      analyze('spam', { message: { canManageMessages: true }, state: { recentMessageCount: 99 } }),
    ).toBeNull();
  });

  it('melewati bot', () => {
    expect(analyze('spam', { message: { isBot: true }, state: { recentMessageCount: 99 } })).toBeNull();
  });

  it('melewati channel dan role yang dikecualikan', () => {
    const policy = {
      ...policyWith([rule('spam')]),
      exemptChannels: ['111111111111111111'],
      exemptRoles: ['222222222222222222'],
    };

    expect(analyzeMessage(message(), policy, state({ recentMessageCount: 99 }))).toBeNull();
    expect(
      analyzeMessage(
        message({ channelId: '999999999999999999', memberRoleIds: ['222222222222222222'] }),
        policy,
        state({ recentMessageCount: 99 }),
      ),
    ).toBeNull();
  });

  it('role yang dikecualikan tidak memblokir user tanpa role itu', () => {
    const policy = { ...policyWith([rule('spam')]), exemptRoles: ['222222222222222222'] };

    const found = analyzeMessage(
      message({ memberRoleIds: ['333333333333333333'] }),
      policy,
      state({ recentMessageCount: 99 }),
    );

    expect(found?.rule).toBe('spam');
  });

  it('rule yang dimatikan tidak dievaluasi', () => {
    expect(
      analyze('spam', { ruleOverrides: { enabled: false }, state: { recentMessageCount: 99 } }),
    ).toBeNull();
  });

  it('rule pertama yang terpicu menang (urutan prioritas)', () => {
    const found = analyzeMessage(
      message({ content: 'discord.gg/abc123' }),
      policyWith([rule('spam'), rule('invite')]),
      state({ recentMessageCount: 6 }),
    );

    expect(found?.rule).toBe('spam');
  });
});

describe('helper murni', () => {
  it('extractHosts menormalkan protokol dan www (tanpa domain telanjang)', () => {
    expect(extractHosts('lihat https://a.com/x dan www.b.org serta a.com')).toEqual(['a.com', 'b.org']);
    expect(extractHosts('tanpa link')).toEqual([]);
  });

  it('findInviteCodes mengambil kode dari berbagai format', () => {
    expect(findInviteCodes('discord.gg/AbC123')).toEqual(['abc123']);
    expect(findInviteCodes('https://discord.com/invite/xyz-9')).toEqual(['xyz-9']);
    expect(findInviteCodes('tanpa invite')).toEqual([]);
  });

  it('findBadword mengembalikan kata yang cocok', () => {
    expect(findBadword('Dasar ANJING!', ['anjing'])).toBe('anjing');
    expect(findBadword('aman', ['anjing'])).toBeNull();
  });

  it('capsPercent menghitung dari huruf saja', () => {
    expect(capsPercent('ABCD')).toBe(100);
    expect(capsPercent('abCD')).toBe(50);
    expect(capsPercent('12345')).toBe(0);
  });
});
