import { describe, expect, it } from 'vitest';
import {
  caseAwareFields,
  caseSourceFields,
  describeLogFilter,
} from '../src/modules/logging/embeds.js';
import type { LogSearchFilter } from '../src/modules/logging/types.js';
import { moderationLogCategory } from '../src/modules/moderation/logging.js';

const BOT_ID = '1000000000000000001';
const MOD_ID = '1000000000000000002';
const LINK = { caseNumber: 142, moderatorId: MOD_ID };

function filter(overrides: Partial<LogSearchFilter> = {}): LogSearchFilter {
  return {
    guildId: '123456789012345678',
    categories: [],
    caseNumber: null,
    userId: null,
    channelId: null,
    keyword: null,
    from: null,
    to: null,
    page: 1,
    pageSize: 10,
    ...overrides,
  };
}

describe('caseSourceFields', () => {
  it('menandai aksi Harmony lengkap dengan nomor kasus & moderator', () => {
    const fields = caseSourceFields(LINK, MOD_ID, BOT_ID);

    expect(fields.map((field) => field.name)).toEqual(['Sumber', 'Kasus', 'Moderator']);
    expect(fields[0]?.value).toBe('🤖 Harmony (perintah bot)');
    expect(fields[1]?.value).toBe('`#CASE-0142`');
    expect(fields[2]?.value).toBe(`<@${MOD_ID}>`);
  });

  it('menandai moderator lain beserta namanya', () => {
    const fields = caseSourceFields(null, MOD_ID, BOT_ID);

    expect(fields).toHaveLength(1);
    expect(fields[0]?.value).toBe(`👤 Moderator lain (<@${MOD_ID}>)`);
  });

  it('membedakan bot lain dari kasus Harmony', () => {
    expect(caseSourceFields(null, BOT_ID, BOT_ID)[0]?.value).toBe('🤖 Bot — di luar kasus Harmony');
  });

  it('tidak menampilkan sumber kalau tidak ada executor', () => {
    expect(caseSourceFields(null, null, BOT_ID)).toEqual([]);
    expect(caseSourceFields(null, undefined, undefined)).toEqual([]);
  });

  it('kasus selalu menang atas executor audit log', () => {
    const fields = caseSourceFields(LINK, BOT_ID, BOT_ID);

    expect(fields.map((field) => field.name)).toContain('Kasus');
    expect(fields.some((field) => field.value.includes('Moderator lain'))).toBe(false);
    expect(fields.some((field) => field.value.includes('di luar kasus Harmony'))).toBe(false);
  });
});

describe('caseAwareFields', () => {
  const external = [
    { name: 'Executor', value: `<@${MOD_ID}>`, inline: true },
    { name: 'Alasan', value: 'spam', inline: true },
  ];

  it('membuat embed event ringkas ketika kasusnya sudah ada', () => {
    const fields = caseAwareFields(LINK, external, MOD_ID, BOT_ID);

    expect(fields.map((field) => field.name)).toEqual(['Sumber', 'Kasus', 'Moderator']);
    // Detail & alasan aksi sudah ada di log kasus — tidak perlu diulang.
    expect(fields.some((field) => field.name === 'Alasan')).toBe(false);
    expect(fields.some((field) => field.name === 'Executor')).toBe(false);
  });

  it('mempertahankan field event dan menambah sumber saat aksi luar Harmony', () => {
    const fields = caseAwareFields(null, external, MOD_ID, BOT_ID);

    expect(fields.map((field) => field.name)).toEqual(['Executor', 'Alasan', 'Sumber']);
  });

  it('tidak menambah penanda sumber dua kali', () => {
    const fields = caseAwareFields(null, external, BOT_ID, BOT_ID);

    expect(fields.filter((field) => field.name === 'Sumber')).toHaveLength(1);
  });

  it('bekerja tanpa executor sama sekali', () => {
    const fields = caseAwareFields(null, external, null, BOT_ID);

    expect(fields).toHaveLength(2);
  });
});

describe('describeLogFilter', () => {
  it('menampilkan nomor kasus yang dicari', () => {
    expect(describeLogFilter(filter({ caseNumber: 142 }))).toContain('#CASE-0142');
  });

  it('menggabungkan beberapa filter', () => {
    const text = describeLogFilter(filter({ categories: ['member'], userId: MOD_ID }));

    expect(text).toContain('Kategori: Member');
    expect(text).toContain(`User: <@${MOD_ID}>`);
  });

  it('menyatakan keadaan kosong dengan jelas', () => {
    expect(describeLogFilter(filter())).toBe('Semua kategori · tanpa batas waktu');
  });
});

describe('moderationLogCategory', () => {
  it('memetakan aksi ke kategori log yang sesuai', () => {
    expect(moderationLogCategory('ban')).toBe('member');
    expect(moderationLogCategory('kick')).toBe('member');
    expect(moderationLogCategory('timeout')).toBe('member');
    expect(moderationLogCategory('unban')).toBe('member');
    expect(moderationLogCategory('warn')).toBe('member');
    expect(moderationLogCategory('slowmode')).toBe('channel');
    expect(moderationLogCategory('lock')).toBe('channel');
    expect(moderationLogCategory('unlock')).toBe('channel');
  });

  it('catatan internal tidak masuk kategori log mana pun', () => {
    expect(moderationLogCategory('note')).toBeNull();
  });
});
