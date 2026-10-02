import { describe, expect, it } from 'vitest';
import { logStatsEmbed } from '../src/modules/logging/embeds.js';
import {
  STATS_TOP_ACTIONS,
  STATS_TOP_MEMBERS,
  eventKeyEmoji,
  eventKeyLabel,
  formatShare,
  memberIdsOverlap,
  statsBar,
  statsPeriod,
  summarizeLogStats,
  toMemberTargetRows,
  type LogCountRow,
  type LogStatsInput,
} from '../src/modules/logging/stats.js';
import {
  DEFAULT_LOG_RETENTION_DAYS,
  LOG_CATEGORIES,
  type LogSearchFilter,
} from '../src/modules/logging/types.js';

const USER_A = '111111111111111111';
const USER_B = '222222222222222222';
const USER_C = '333333333333333333';

const NOW = new Date('2026-10-02T12:00:00.000Z');

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

function emptyStatsInput(overrides: Partial<LogStatsInput> = {}): LogStatsInput {
  return {
    categories: [],
    actions: [],
    targets: [],
    executors: [],
    selfActions: [],
    ...overrides,
  };
}

function count(key: string, value: number): LogCountRow {
  return { key, count: value };
}

describe('summarizeLogStats', () => {
  it('selalu mengembalikan enam kategori urut sesuai LOG_CATEGORIES', () => {
    const stats = summarizeLogStats(
      emptyStatsInput({ categories: [count('message', 3), count('member', 1)] }),
    );

    expect(stats.categories.map((item) => item.category)).toEqual([...LOG_CATEGORIES]);
    expect(stats.categories.find((item) => item.category === 'message')?.count).toBe(3);
    expect(stats.categories.find((item) => item.category === 'role')?.count).toBe(0);
  });

  it('total memakai seluruh baris, termasuk kategori yang tak dikenal', () => {
    const stats = summarizeLogStats(
      emptyStatsInput({
        categories: [count('member', 4), count('entah', 6)],
      }),
    );

    // `entah` tidak muncul di tabel per kategori, tapi totalnya tetap jujur.
    expect(stats.total).toBe(10);
    expect(stats.categories.reduce((sum, item) => sum + item.count, 0)).toBe(4);
  });

  it('menempatkan aksi teratas menurut jumlah, lalu kunci secara stabil', () => {
    const stats = summarizeLogStats(
      emptyStatsInput({
        actions: [
          count('messageDelete', 4),
          count('channelCreate', 9),
          count('guildMemberAdd', 4),
          count('messageUpdate', 0),
        ],
      }),
    );

    expect(stats.topActions).toEqual([
      { eventKey: 'channelCreate', count: 9 },
      { eventKey: 'guildMemberAdd', count: 4 },
      { eventKey: 'messageDelete', count: 4 },
    ]);
  });

  it('memotong daftar sesuai batas dan mengabaikan jumlah nol', () => {
    const actions = Array.from({ length: 9 }, (_, index) => count(`event${index}`, 9 - index));

    const stats = summarizeLogStats(emptyStatsInput({ actions, topActions: 3 }));

    expect(stats.topActions).toHaveLength(3);
    expect(stats.topActions[0]?.eventKey).toBe('event0');
    expect(stats.topActions[2]?.eventKey).toBe('event2');
  });

  it('batas bawaan lima baris', () => {
    const actions = Array.from({ length: 12 }, (_, index) => count(`event${index}`, 12 - index));

    const stats = summarizeLogStats(emptyStatsInput({ actions }));

    expect(stats.topActions).toHaveLength(STATS_TOP_ACTIONS);
  });

  it('menggabungkan peran target dan executor untuk member yang sama', () => {
    const stats = summarizeLogStats(
      emptyStatsInput({
        targets: [count(USER_A, 3), count(USER_B, 2)],
        executors: [count(USER_A, 5)],
      }),
    );

    expect(stats.topMembers[0]).toEqual({ userId: USER_A, count: 8, asTarget: 3, asExecutor: 5 });
    expect(stats.topMembers[1]).toEqual({ userId: USER_B, count: 2, asTarget: 2, asExecutor: 0 });
  });

  it('aksi pada diri sendiri dihitung satu kali', () => {
    const stats = summarizeLogStats(
      emptyStatsInput({
        targets: [count(USER_C, 2)],
        executors: [count(USER_C, 2)],
        selfActions: [count(USER_C, 2)],
      }),
    );

    expect(stats.topMembers[0]).toEqual({ userId: USER_C, count: 2, asTarget: 2, asExecutor: 2 });
  });

  it('membuang member yang hanya menyumbang aksi pada diri sendiri', () => {
    const stats = summarizeLogStats(
      emptyStatsInput({
        targets: [count(USER_A, 1)],
        executors: [count(USER_A, 1)],
        selfActions: [count(USER_A, 1), count(USER_C, 4)],
      }),
    );

    expect(stats.topMembers.map((item) => item.userId)).toEqual([USER_A]);
  });

  it('mengabaikan target & executor kosong', () => {
    const stats = summarizeLogStats(
      emptyStatsInput({
        targets: [count('', 7)],
        executors: [count('', 7)],
        selfActions: [],
      }),
    );

    expect(stats.topMembers).toEqual([]);
  });

  it('urutan stably turun saat jumlah sama', () => {
    const stats = summarizeLogStats(
      emptyStatsInput({
        targets: [count(USER_C, 3), count(USER_A, 3), count(USER_B, 3)],
      }),
    );

    expect(stats.topMembers.map((item) => item.userId)).toEqual([USER_A, USER_B, USER_C]);
  });

  it('batas bawaan lima member', () => {
    const targets = Array.from({ length: 8 }, (_, index) => count(`user${index}`, 8 - index));

    const stats = summarizeLogStats(emptyStatsInput({ targets }));

    expect(stats.topMembers).toHaveLength(STATS_TOP_MEMBERS);
  });
});

describe('toMemberTargetRows', () => {
  it('membuang target dari kategori non-member', () => {
    const rows = toMemberTargetRows([
      { key: USER_A, category: 'member', count: 3 },
      { key: '444444444444444444', category: 'channel', count: 9 },
      { key: '555555555555555555', category: 'role', count: 7 },
    ]);

    expect(rows).toEqual([{ key: USER_A, count: 3 }]);
  });

  it('menjumlahkan member yang jadi target di beberapa kategori', () => {
    const rows = toMemberTargetRows([
      { key: USER_A, category: 'member', count: 3 },
      { key: USER_A, category: 'voice', count: 2 },
      { key: USER_A, category: 'message', count: 1 },
    ]);

    expect(rows).toEqual([{ key: USER_A, count: 6 }]);
  });

  it('mengabaikan target kosong dan kategori asing', () => {
    const rows = toMemberTargetRows([
      { key: '', category: 'member', count: 4 },
      { key: USER_B, category: 'entah', count: 4 },
    ]);

    expect(rows).toEqual([]);
  });
});

describe('memberIdsOverlap', () => {
  it('deteksi user yang muncul di kedua sisi', () => {
    expect(memberIdsOverlap([count(USER_A, 1)], [count(USER_A, 1)])).toBe(true);
  });

  it('false saat tidak ada irisan dan saat salah satu sisi kosong', () => {
    expect(memberIdsOverlap([count(USER_A, 1)], [count(USER_B, 1)])).toBe(false);
    expect(memberIdsOverlap([], [count(USER_B, 1)])).toBe(false);
    expect(memberIdsOverlap([count(USER_A, 1)], [])).toBe(false);
  });
});

describe('statsPeriod', () => {
  it('batas bawah memakai masa simpan riwayat bila from kosong', () => {
    const period = statsPeriod(filter(), NOW);

    const expected = new Date(
      NOW.getTime() - DEFAULT_LOG_RETENTION_DAYS * 86_400_000,
    );
    expect(period.from.getTime()).toBe(expected.getTime());
    expect(period.to.getTime()).toBe(NOW.getTime());
    expect(period.defaulted).toBe(true);
  });

  it('memakai rentang yang diminta user apa adanya', () => {
    const from = new Date('2026-09-01T00:00:00.000Z');
    const to = new Date('2026-09-07T00:00:00.000Z');

    const period = statsPeriod(filter({ from, to }), NOW);

    expect(period.from).toBe(from);
    expect(period.to).toBe(to);
    expect(period.defaulted).toBe(false);
  });
});

describe('eventKeyLabel', () => {
  it('menerjemahkan event Discord', () => {
    expect(eventKeyLabel('guildMemberAdd')).toBe('Member bergabung');
    expect(eventKeyEmoji('guildMemberAdd')).toBe('📥');
  });

  it('menerjemahkan aksi moderasi lewat label yang sama dengan perintah', () => {
    expect(eventKeyLabel('moderation.ban')).toBe('Ban');
    expect(eventKeyEmoji('moderation.ban')).toBe('🔨');
  });

  it('kunci tak dikenal ditampilkan apa adanya', () => {
    expect(eventKeyLabel('entahApaIni')).toBe('entahApaIni');
    expect(eventKeyEmoji('entahApaIni')).toBe('•');
    expect(eventKeyLabel('moderation.entah')).toBe('Aksi entah');
  });
});

describe('formatShare & statsBar', () => {
  it('persentase dibulatkan, nol aman', () => {
    expect(formatShare(1, 3)).toBe('33%');
    expect(formatShare(2, 3)).toBe('67%');
    expect(formatShare(0, 0)).toBe('0%');
  });

  it('batang mengikuti nilai tertinggi', () => {
    expect(statsBar(5, 5, 10)).toBe('██████████');
    expect(statsBar(0, 5, 10)).toBe('░░░░░░░░░░');
    expect(statsBar(1, 5, 10)).toBe('██░░░░░░░░');
  });

  it('nilai terendah tetap punya satu blok', () => {
    expect(statsBar(1, 400, 10)).toBe('█░░░░░░░░░');
  });

  it('batas nol atau lebar nol tidak menghasilkan batang', () => {
    expect(statsBar(3, 0, 10)).toBe('');
    expect(statsBar(3, 3, 0)).toBe('');
  });

  it('nilai di luar rentang dijepit', () => {
    expect(statsBar(99, 5, 4)).toBe('████');
    expect(statsBar(-1, 5, 4)).toBe('░░░░');
  });
});

describe('logStatsEmbed', () => {
  const period = { from: new Date('2026-09-03T00:00:00.000Z'), to: NOW, defaulted: true };
  const stats = summarizeLogStats(
    emptyStatsInput({
      categories: [count('member', 8), count('message', 2)],
      actions: [count('moderation.ban', 5), count('messageDelete', 5), count('voiceStateUpdate', 1)],
      targets: [count(USER_A, 4)],
      executors: [count(USER_B, 6)],
    }),
  );

  it('menampilkan jumlah, batang kategori, dan daftar teratas', () => {
    const embed = logStatsEmbed(stats, { filter: filter(), period });
    const rendered = JSON.stringify(embed.toJSON());

    expect(embed.toJSON().title).toBe('📊 Statistik Log');
    expect(embed.toJSON().footer?.text).toContain('10 event');
    expect(rendered).toContain('Event per kategori');
    expect(rendered).toContain('Member');
    expect(rendered).toContain('Aksi teratas');
    expect(rendered).toContain('Member paling sering terkait');
  });

  it('member yang disebut memakai mention agar bisa diklik', () => {
    const embed = logStatsEmbed(stats, { filter: filter(), period });

    expect(embed.toJSON().fields?.[2]?.value).toContain(`<@${USER_B}>`);
  });

  it('menandai periode default supaya angka tidak disalahartikan', () => {
    const embed = logStatsEmbed(stats, { filter: filter(), period });
    expect(embed.toJSON().description).toContain('Periode default');
  });

  it('periode eksplisit tidak menampilkan catatan default', () => {
    const embed = logStatsEmbed(stats, {
      filter: filter(),
      period: { ...period, defaulted: false },
    });

    expect(embed.toJSON().description).not.toContain('Periode default');
  });

  it('daftar kosong tetap punya field yang bisa dibaca', () => {
    const embed = logStatsEmbed(summarizeLogStats(emptyStatsInput()), {
      filter: filter(),
      period,
    });

    expect(embed.toJSON().fields?.[1]?.value).toBe('Tidak ada event pada periode ini.');
    expect(embed.toJSON().fields?.[2]?.value).toContain('Tidak ada member');
  });

  it('membatasi jumlah baris sesuai opsi', () => {
    const many = summarizeLogStats(
      emptyStatsInput({
        categories: [count('member', 1)],
        actions: Array.from({ length: 8 }, (_, index) => count(`event${index}`, 8 - index)),
        targets: Array.from({ length: 8 }, (_, index) => count(`user${index}`, 8 - index)),
      }),
    );

    const embed = logStatsEmbed(many, { filter: filter(), period, topActions: 2, topMembers: 3 });
    const fields = embed.toJSON().fields ?? [];

    expect(fields[1]?.name).toBe('Aksi teratas (2)');
    expect(fields[1]?.value).toContain('event0');
    expect(fields[1]?.value).not.toContain('event2');
    expect(fields[2]?.name).toBe('Member paling sering terkait (3)');
    expect(fields[2]?.value).toContain('user0');
    expect(fields[2]?.value).not.toContain('user3');
  });
});
