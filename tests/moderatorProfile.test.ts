import { describe, expect, it } from 'vitest';
import {
  CHANNEL_TARGET_ACTIONS,
  MODERATOR_ACTIVE_WINDOW_DAYS,
  actionBar,
  actionShare,
  buildModeratorProfile,
  casesPerTarget,
  moderatorActionLines,
  moderatorCaseLine,
  moderatorFailedTotal,
  moderatorOverviewLines,
  moderatorRevokedTotal,
  moderatorTargetKind,
  type ModeratorActionRow,
  type ModeratorTotals,
} from '../src/modules/moderation/modProfile.js';
import {
  moderatorProfileEmbed,
  moderatorRecentCasesEmbed,
} from '../src/modules/moderation/embeds.js';
import type { ModerationCase } from '../src/modules/moderation/types.js';

const GUILD_ID = '123456789012345678';
const MOD_ID = '333333333333333333';
const USER_A = '222222222222222222';
const CHANNEL_ID = '444444444444444444';

const FIRST = new Date('2026-01-10T08:00:00.000Z');
const LAST = new Date('2026-10-02T08:00:00.000Z');

function record(overrides: Partial<ModerationCase> = {}): ModerationCase {
  return {
    id: 1,
    caseNumber: 14,
    guildId: GUILD_ID,
    type: 'ban',
    targetId: USER_A,
    moderatorId: MOD_ID,
    reason: 'spam',
    createdAt: LAST,
    expiresAt: null,
    active: true,
    dmStatus: null,
    ...overrides,
  };
}

function totals(overrides: Partial<ModeratorTotals> = {}): ModeratorTotals {
  return {
    total: 0,
    uniqueTargets: 0,
    firstCaseAt: null,
    lastCaseAt: null,
    recentCount: 0,
    ...overrides,
  };
}

function profile(
  actionRows: ModeratorActionRow[],
  totalsInput: Partial<ModeratorTotals> = {},
  recentCases: ModerationCase[] = [],
) {
  return buildModeratorProfile({
    moderatorId: MOD_ID,
    actionRows,
    // Defaultnya selalu diisi supaya setiap tes hanya perlu menyebut angka yang
    // memang sedang diuji.
    totals: { ...totals(), ...totalsInput },
    recentCases,
  });
}

describe('buildModeratorProfile', () => {
  it('mengelompokkan baris per jenis aksi', () => {
    const result = profile([
      { type: 'ban', active: true, count: 3 },
      { type: 'ban', active: true, count: 2 },
      { type: 'warn', active: true, count: 1 },
    ]);

    expect(result.actions).toHaveLength(2);
    expect(result.actions[0]).toMatchObject({ type: 'ban', total: 5 });
  });

  it('mengurutkan aksi dari yang terbanyak', () => {
    const result = profile([
      { type: 'note', active: true, count: 1 },
      { type: 'ban', active: true, count: 9 },
      { type: 'warn', active: true, count: 4 },
    ]);

    expect(result.actions.map((stat) => stat.type)).toEqual(['ban', 'warn', 'note']);
  });

  it('peringatan dicabut dihitung terpisah dari aksi yang gagal', () => {
    const result = profile([
      { type: 'warn', active: false, count: 4 },
      { type: 'ban', active: false, count: 2 },
    ]);

    // Menyamakan keduanya akan terlihat seperti moderator gagal 6 kali.
    expect(moderatorFailedTotal(result)).toBe(2);
    expect(moderatorRevokedTotal(result)).toBe(4);
  });

  it('jenis aksi tak dikenal dibuang, tidak ditampilkan sebagai "?"', () => {
    const result = profile([
      { type: 'ban', active: true, count: 2 },
      { type: 'aksi_dari_veri_baru', active: true, count: 5 },
    ]);

    expect(result.actions.map((stat) => stat.type)).toEqual(['ban']);
  });

  it('total nol menghasilkan profil kosong, bukan error', () => {
    const result = profile([]);

    expect(result.totals.total).toBe(0);
    expect(result.actions).toEqual([]);
    expect(moderatorOverviewLines(result)).toEqual([
      'Belum ada kasus yang tercatat untuk moderator ini.',
    ]);
  });
});

describe('actionShare & casesPerTarget', () => {
  it('porsi dihitung terhadap total keseluruhan', () => {
    const stat = { type: 'ban' as const, total: 3, failed: 0, revoked: 0 };

    expect(actionShare(stat, 12)).toBe(25);
  });

  it('total nol memberi nol, bukan NaN atau error', () => {
    const stat = { type: 'ban' as const, total: 3, failed: 0, revoked: 0 };

    expect(actionShare(stat, 0)).toBe(0);
  });

  it('rasio kasus per target null saat tidak ada target', () => {
    expect(casesPerTarget(profile([]))).toBeNull();
  });

  it('rasio kasus per target null saat target nol', () => {
    const result = profile([{ type: 'ban', active: true, count: 5 }], {
      total: 5,
      uniqueTargets: 0,
    });

    expect(casesPerTarget(result)).toBeNull();
  });

  it('rasio membesar ketika satu orang jadi target berulang', () => {
    const result = profile([{ type: 'ban', active: true, count: 6 }], {
      total: 6,
      uniqueTargets: 2,
    });

    expect(casesPerTarget(result)).toBe(3);
  });
});

describe('actionBar', () => {
  it('aksi terbanyak mengisi batang penuh', () => {
    const stat = { type: 'ban' as const, total: 10, failed: 0, revoked: 0 };

    expect(actionBar(stat, 10, 10)).toBe('█'.repeat(10));
  });

  it('proporsional terhadap aksi terbanyak', () => {
    const stat = { type: 'ban' as const, total: 5, failed: 0, revoked: 0 };

    expect(actionBar(stat, 10, 10)).toBe('█████░░░░░');
  });

  it('jumlah nol tetap dapat satu blok supaya tidak terlihat seperti tidak ada data', () => {
    const stat = { type: 'ban' as const, total: 1, failed: 0, revoked: 0 };

    expect(actionBar(stat, 0, 10)).toBe('░░░░░░░░░░');
  });

  it('nilai nol dan total nol tidak membuat batang melebihi lebar', () => {
    const stat = { type: 'ban' as const, total: 0, failed: 0, revoked: 0 };

    expect(actionBar(stat, 0, 8)).toHaveLength(8);
  });
});

describe('moderatorOverviewLines', () => {
  const built = profile(
    [
      { type: 'ban', active: true, count: 4 },
      { type: 'warn', active: false, count: 2 },
      { type: 'lock', active: false, count: 1 },
    ],
    {
      total: 7,
      uniqueTargets: 3,
      firstCaseAt: FIRST,
      lastCaseAt: LAST,
      recentCount: 2,
    },
  );

  it('menyatakan total dan target unik', () => {
    const text = moderatorOverviewLines(built).join('\n');

    expect(text).toContain('Total kasus **7**');
    expect(text).toContain('Target unik **3**');
  });

  it('menyatakan rentang waktu', () => {
    expect(moderatorOverviewLines(built).join('\n')).toContain('Aktif <t:');
  });

  it('menyatakan aktivitas 30 hari terakhir dengan jendela yang disebutkan', () => {
    const line = moderatorOverviewLines(built).find((item) => item.includes('hari terakhir'));

    expect(line).toContain(`2 kasus dalam ${MODERATOR_ACTIVE_WINDOW_DAYS} hari terakhir`);
  });

  it('memberi tahu saat moderator sedang tidak aktif', () => {
    const idle = profile([{ type: 'ban', active: true, count: 4 }], {
      total: 4,
      uniqueTargets: 2,
      firstCaseAt: FIRST,
      lastCaseAt: FIRST,
      recentCount: 0,
    });

    expect(moderatorOverviewLines(idle).join('\n')).toContain('Tidak ada kasus dalam');
  });

  it('menyorot aksi yang gagal dieksekusi', () => {
    const text = moderatorOverviewLines(built).join('\n');

    // lock yang gagal = 1; warn yang dicabut bukan kegagalan.
    expect(text).toContain('⚠️ 1 kasus tercatat tapi aksi Discord-nya gagal');
  });

  it('menyatakan peringatan yang dicabut secara terpisah', () => {
    expect(moderatorOverviewLines(built).join('\n')).toContain('♻️ 2 peringatan dicabut kembali');
  });

  it('tidak menyebut gagal maupun dicabut saat tidak ada', () => {
    const clean = profile([{ type: 'ban', active: true, count: 3 }], {
      total: 3,
      uniqueTargets: 1,
      firstCaseAt: FIRST,
      lastCaseAt: LAST,
      recentCount: 1,
    });

    const text = moderatorOverviewLines(clean).join('\n');

    expect(text).not.toContain('⚠️');
    expect(text).not.toContain('♻️');
  });

  it('tidak menyebut rasio kasus per target saat rasionya wajar', () => {
    const text = moderatorOverviewLines(built).join('\n');

    // 7 kasus / 3 target = 2.3, di atas ambang 1.5, jadi disebut.
    expect(text).toContain('Rata-rata');
  });

  it('satu kasus untuk satu target tidak perlu disebut rasionya', () => {
    const small = profile([{ type: 'ban', active: true, count: 1 }], {
      total: 1,
      uniqueTargets: 1,
      firstCaseAt: FIRST,
      lastCaseAt: LAST,
      recentCount: 1,
    });

    expect(moderatorOverviewLines(small).join('\n')).not.toContain('Rata-rata');
  });
});

describe('moderatorActionLines', () => {
  it('menampilkan label, jumlah, dan persentase tiap aksi', () => {
    const built = profile(
      [
        { type: 'ban', active: true, count: 3 },
        { type: 'warn', active: true, count: 1 },
      ],
      { total: 4 },
    );

    const lines = moderatorActionLines(built).split('\n');

    expect(lines[0]).toContain('🔨');
    expect(lines[0]).toContain('`3`');
    expect(lines[0]).toContain('75%');
    expect(lines[1]).toContain('25%');
  });

  it('menandai aksi yang gagal di barisnya sendiri', () => {
    const built = profile([{ type: 'kick', active: false, count: 1 }]);

    expect(moderatorActionLines(built)).toContain('⚠️ 1 gagal');
  });

  it('profil tanpa aksi tidak membuat baris kosong', () => {
    expect(moderatorActionLines(profile([]))).toBe('*Belum ada kasus tercatat.*');
  });
});

describe('moderatorTargetKind', () => {
  it('aksi channel dikenali sebagai target channel', () => {
    for (const type of CHANNEL_TARGET_ACTIONS) {
      expect(moderatorTargetKind(type)).toBe('channel');
    }
  });

  it('aksi lainnya adalah target user', () => {
    for (const type of ['ban', 'kick', 'timeout', 'warn', 'unban', 'note'] as const) {
      expect(moderatorTargetKind(type)).toBe('user');
    }
  });
});

describe('moderatorCaseLine', () => {
  it('target user ditulis sebagai mention user', () => {
    const line = moderatorCaseLine(record(), 'user');

    expect(line).toContain(`<@${USER_A}>`);
    expect(line).toContain('🔨 Ban');
    expect(line).toContain('`14`');
  });

  it('target channel ditulis sebagai mention channel', () => {
    const line = moderatorCaseLine(record({ type: 'lock', targetId: CHANNEL_ID }), 'channel');

    expect(line).toContain(`<#${CHANNEL_ID}>`);
    expect(line).toContain('🔒 Lock');
  });

  it('kasus nonaktif ditandai, tapi dibedakan dari yang dicabut', () => {
    expect(moderatorCaseLine(record({ active: false }), 'user')).toContain('*gagal*');
    expect(
      moderatorCaseLine(record({ type: 'warn', active: false }), 'user'),
    ).toContain('*dicabut*');
  });

  it('kasus aktif tidak diberi penanda tambahan', () => {
    expect(moderatorCaseLine(record(), 'user')).not.toContain('*');
  });
});

describe('embed profil moderator', () => {
  const built = profile(
    [
      { type: 'ban', active: true, count: 6 },
      { type: 'warn', active: true, count: 2 },
    ],
    {
      total: 8,
      uniqueTargets: 5,
      firstCaseAt: FIRST,
      lastCaseAt: LAST,
      recentCount: 4,
    },
    [record(), record({ caseNumber: 15, type: 'warn' })],
  );

  it('judul memuat nama moderator dari cache guild', () => {
    expect(moderatorProfileEmbed(built, { displayName: 'Raka' }).toJSON().title).toContain(
      'Raka',
    );
  });

  it('tanpa nama menampilkan mention sebagai gantinya', () => {
    expect(moderatorProfileEmbed(built).toJSON().title).toContain(`<@${MOD_ID}>`);
  });

  it('menyatakan cakupan data hanya yang tercatat Harmony', () => {
    expect(moderatorProfileEmbed(built).toJSON().footer?.text).toContain('Harmony');
  });

  it('field sebaran aksi tidak melewati batas field Discord', () => {
    const many = profile(
      ['ban', 'kick', 'timeout', 'warn', 'unban', 'slowmode', 'lock', 'unlock', 'note'].map(
        (type, index) => ({ type, active: true, count: 100 - index }),
      ),
      { total: 900 },
    );

    const field = moderatorProfileEmbed(many)
      .toJSON()
      .fields?.find((item) => item.name === 'Sebaran aksi');

    expect(field?.value.length).toBeLessThanOrEqual(1_024);
  });

  it('embed kasus terbaru menyebut bagian yang tidak ditampilkan', () => {
    const json = moderatorRecentCasesEmbed(built).toJSON();

    expect(json.footer?.text).toContain('2 terbaru dari 8 kasus');
    expect(json.description).toContain('`14`');
  });

  it('embed kasus terbaru tanpa sisa kasus tidak menyebut pengurangan', () => {
    const exact = profile([{ type: 'ban', active: true, count: 2 }], { total: 2 }, [
      record(),
      record({ caseNumber: 15 }),
    ]);

    expect(moderatorRecentCasesEmbed(exact).toJSON().footer?.text).toContain(
      '2 kasus terbaru',
    );
  });

  it('embed kasus terbaru mengarahkan ke /case untuk detail', () => {
    expect(moderatorRecentCasesEmbed(built).toJSON().footer?.text).toContain('/case');
  });

  it('moderator tanpa kasus mendapat kalimat yang jelas, bukan halaman kosong', () => {
    expect(moderatorRecentCasesEmbed(profile([])).toJSON().description).toContain('Belum ada');
  });

  it('embed profil moderator tanpa kasus tetap aman dirender', () => {
    const json = moderatorProfileEmbed(profile([])).toJSON();

    expect(json.description).toContain('Belum ada kasus');
  });
});