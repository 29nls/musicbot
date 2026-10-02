import { describe, expect, it } from 'vitest';
import {
  PRIOR_CASE_HINT_LIMIT,
  buildPriorCaseSummary,
  priorCaseNoteLines,
  priorCaseRecentLines,
  type PriorCaseSummary,
  type TargetActionRow,
} from '../src/modules/moderation/priorCases.js';
import { priorCaseEmbed } from '../src/modules/moderation/embeds.js';
import { priorCaseEmbedFor } from '../src/commands/admin/_shared.js';
import type { ModerationCase } from '../src/modules/moderation/types.js';

const GUILD_ID = '123456789012345678';
const USER_ID = '222222222222222222';
const MOD_ID = '333333333333333333';

function record(overrides: Partial<ModerationCase> = {}): ModerationCase {
  return {
    id: 1,
    caseNumber: 141,
    guildId: GUILD_ID,
    type: 'warn',
    targetId: USER_ID,
    moderatorId: MOD_ID,
    reason: 'spam',
    createdAt: new Date('2026-10-01T08:00:00.000Z'),
    expiresAt: null,
    active: true,
    dmStatus: 'sent',
    ...overrides,
  };
}

function rows(...entries: [string, boolean, number][]): TargetActionRow[] {
  return entries.map(([type, active, count]) => ({ type, active, count }));
}

type SummaryInput = Parameters<typeof buildPriorCaseSummary>[0];

function summary(overrides: Partial<SummaryInput> = {}): PriorCaseSummary {
  return buildPriorCaseSummary({
    targetId: USER_ID,
    actionRows: rows(['warn', true, 3], ['timeout', true, 1]),
    recentCases: [record()],
    activeWarnings: 3,
    ...overrides,
  });
}

describe('buildPriorCaseSummary', () => {
  it('target tanpa riwayat ditandai tidak punya riwayat', () => {
    const result = summary({ actionRows: [], recentCases: [], activeWarnings: 0 });

    expect(result.hasHistory).toBe(false);
    expect(result.total).toBe(0);
    expect(result.byAction).toEqual([]);
  });

  it('total memakai seluruh baris agregat, bukan hanya yang dirinci', () => {
    // Tampilkan 5 kasus terakhir, tapi hitung dari seluruh riwayat: target yang
    // paling bermasalah justru yang paling banyak kasusnya.
    const result = summary({ actionRows: rows(['warn', true, 30], ['ban', true, 4]) });

    expect(result.total).toBe(34);
    expect(result.recentCases).toHaveLength(1);
  });

  it('jenis aksi tak dikenal dibuang dari sebaran tapi tetap masuk total', () => {
    const result = summary({ actionRows: rows(['warn', true, 2], ['purge_all', true, 5]) });

    expect(result.byAction).toEqual([{ type: 'warn', count: 2, inactive: 0 }]);
    expect(result.total).toBe(7);
  });

  it('urutkan sebaran dari terbanyak, seri diurutkan sesuai nama aksi', () => {
    const result = summary({
      actionRows: rows(['warn', true, 3], ['ban', true, 3], ['timeout', true, 7]),
    });

    expect(result.byAction.map((item) => item.type)).toEqual(['timeout', 'ban', 'warn']);
  });

  it('peringatan aktif diambil dari tabel peringatan, bukan kasus warn', () => {
    // Kasus warn yang dicabut moderator masih ada di riwayat, tapi peringatan
    // yang sudah berlaku tidak. Menyamakan keduanya akan melaporkan member yang
    // sudah "dibersihkan" seolah masih punya peringatan hidup.
    const result = summary({
      actionRows: rows(['warn', true, 2], ['warn', false, 5]),
      activeWarnings: 2,
    });

    expect(result.activeWarnings).toBe(2);
    expect(result.byAction).toEqual([{ type: 'warn', count: 7, inactive: 5 }]);
  });

  it('menyalin daftar kasus, bukan menyimpan referensi yang sama', () => {
    const recent = [record()];
    const result = summary({ recentCases: recent });

    recent.push(record({ caseNumber: 99 }));

    expect(result.recentCases).toHaveLength(1);
  });

  it('ban yang gagal dieksekusi tidak dihitung sebagai pernah di-ban', () => {
    // Kasus ban nonaktif berarti Discord menolak eksekusinya, jadi tidak ada
    // yang pernah diblokir. Menghitungnya akan menyatakan sesuatu yang salah.
    const result = summary({ actionRows: rows(['ban', true, 1], ['ban', false, 2]) });

    expect(result.priorBans).toBe(1);
    expect(result.total).toBe(3);
  });

  it('peringatan yang dicabut dipisahkan dari yang masih berlaku', () => {
    const result = summary({
      actionRows: rows(['warn', true, 2], ['warn', false, 4]),
      activeWarnings: 2,
    });

    expect(result.revokedWarnings).toBe(4);
    expect(result.activeWarnings).toBe(2);
  });

  it('tidak menghitung ban dari kasus yang bukan jenis ban', () => {
    const result = summary({ actionRows: rows(['unban', true, 3]) });

    expect(result.priorBans).toBe(0);
  });
});

describe('priorCaseNoteLines', () => {
  it('menyebut peringatan aktif paling dulu, karena itu yang mengubah keputusan', () => {
    const lines = priorCaseNoteLines(summary({ activeWarnings: 3 }));

    expect(lines[0]).toContain('3');
    expect(lines[0]).toContain('peringatan masih aktif');
  });

  it('tidak membuat baris peringatan kalau tidak ada yang berlaku', () => {
    const lines = priorCaseNoteLines(summary({ activeWarnings: 0 }));

    expect(lines.join('\n')).not.toMatch(/peringatan masih aktif/);
  });

  it('menyebut ban sebelumnya sebagai pola, bukan sebagai jumlah biasa', () => {
    const lines = priorCaseNoteLines(summary({ actionRows: rows(['ban', true, 2]) }));
    const text = lines.join('\n');

    expect(text).toContain('pernah di-ban');
    expect(text).toContain('2');
  });

  it('tidak menyebut ban sebelumnya kalau baru pertama kali', () => {
    const lines = priorCaseNoteLines(summary({ actionRows: rows(['warn', true, 1]) }));

    expect(lines.join('\n')).not.toMatch(/pernah di-ban/);
  });

  it('merangkum total dan sebaran jenis aksi', () => {
    const text = priorCaseNoteLines(summary()).join('\n');

    expect(text).toMatch(/Total \*\*4\*\* kasus sebelumnya/);
    expect(text).toContain('Warn');
    expect(text).toContain('Timeout');
  });

  it('menyebut peringatan yang dicabut supaya angka peringatan tidak menyesatkan', () => {
    const text = priorCaseNoteLines(
      summary({ actionRows: rows(['warn', true, 2], ['warn', false, 1]) }),
    ).join('\n');

    expect(text).toContain('dicabut moderator');
  });

  it('sebaran jenis aksi dipangkas supaya barisnya tidak meledak', () => {
    const text = priorCaseNoteLines(
      summary({
        actionRows: rows(
          ['warn', true, 9],
          ['note', true, 8],
          ['timeout', true, 7],
          ['kick', true, 6],
          ['ban', true, 5],
          ['unban', true, 4],
        ),
      }),
    ).join('\n');

    expect(text).toContain('+2 jenis lain');
  });

  it('tidak membuat baris apa pun untuk member yang benar-benar bersih', () => {
    const clean = buildPriorCaseSummary({
      targetId: USER_ID,
      actionRows: [],
      recentCases: [],
      activeWarnings: 0,
    });

    expect(priorCaseNoteLines(clean)).toEqual([]);
  });
});

describe('priorCaseRecentLines', () => {
  it('memakai format baris yang sama dengan /case', () => {
    const lines = priorCaseRecentLines(summary());

    expect(lines[0]).toContain('141');
    expect(lines[0]).toContain(`<@${MOD_ID}>`);
  });

  it('dibatasi supaya balasan tidak meledak', () => {
    const many = Array.from({ length: 12 }, (_, index) =>
      record({ id: index + 1, caseNumber: 100 + index }),
    );

    expect(priorCaseRecentLines(summary({ recentCases: many }))).toHaveLength(
      PRIOR_CASE_HINT_LIMIT,
    );
  });

  it('menandai kasus yang sudah tidak aktif', () => {
    const lines = priorCaseRecentLines(summary({ recentCases: [record({ active: false })] }));

    expect(lines[0]).toMatch(/nonaktif/);
  });
});

describe('priorCaseEmbed', () => {
  function json(target: PriorCaseSummary) {
    return priorCaseEmbed(target).toJSON();
  }

  it('menyebut target dengan mention di judul', () => {
    expect(json(summary()).title).toContain(`<@${USER_ID}>`);
  });

  it('menampilkan ringkasan lalu daftar kasus terbaru', () => {
    const description = json(summary()).description ?? '';

    expect(description).toContain('peringatan masih aktif');
    expect(description).toContain('141');
  });

  it('footer menyebut total kasus dan arah ke /case', () => {
    const footer = json(summary()).footer?.text ?? '';

    expect(footer).toContain('4 kasus sebelumnya');
    expect(footer).toContain('/case kasus:#CASE-0141');
  });

  it('tanpa kasus terbaru, footer tidak menjanjikan halaman detail', () => {
    const footer = json(summary({ recentCases: [] })).footer?.text ?? '';

    expect(footer).not.toContain('/case');
  });

  it('deskripsi dipotong ke batas Discord', () => {
    const long = Array.from({ length: 40 }, (_, index) =>
      record({ id: index + 1, caseNumber: 100 + index, reason: 'x'.repeat(900) }),
    );

    expect((json(summary({ recentCases: long })).description ?? '').length).toBeLessThanOrEqual(4_000);
  });
});

describe('priorCaseEmbedFor', () => {
  function serviceWith(value: PriorCaseSummary | Error) {
    return {
      priorCaseSummary: async () => {
        if (value instanceof Error) throw value;

        return value;
      },
    };
  }

  it('member dengan riwayat mendapat embed kedua', async () => {
    const embed = await priorCaseEmbedFor(
      serviceWith(summary()),
      GUILD_ID,
      USER_ID,
      142,
    );

    expect(embed?.toJSON().title).toContain(`<@${USER_ID}>`);
  });

  it('member bersih tidak mendapat embed sama sekali', async () => {
    const embed = await priorCaseEmbedFor(
      serviceWith(summary({ actionRows: [], recentCases: [], activeWarnings: 0 })),
      GUILD_ID,
      USER_ID,
      142,
    );

    expect(embed).toBeNull();
  });

  it('nomor kasus yang sedang dibuat diteruskan untuk dikecualikan', async () => {
    const seen: number[] = [];
    const service = {
      priorCaseSummary: async (_guildId: string, _targetId: string, caseNumber: number) => {
        seen.push(caseNumber);

        return summary();
      },
    };

    await priorCaseEmbedFor(service, GUILD_ID, USER_ID, 142);

    expect(seen).toEqual([142]);
  });

  it('kegagalan baca riwayat diteruskan, bukan ditelan jadi null', async () => {
    // Yang best-effort adalah balasan, bukan pembacaan riwayatnya: kalau error
    // ditelan di sini, kegagalan database tidak akan pernah kelihatan.
    await expect(
      priorCaseEmbedFor(serviceWith(new Error('database down')), GUILD_ID, USER_ID, 142),
    ).rejects.toThrow('database down');
  });
});