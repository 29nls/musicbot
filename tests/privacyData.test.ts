import { describe, expect, it } from 'vitest';
import type { TicketOpenerCount } from '../src/modules/tickets/repository.js';
import type { TargetActionRow } from '../src/modules/moderation/priorCases.js';
import {
  PSEUDONYM_MAX_LENGTH,
  REASON_ANONYMIZED_MARKER,
  SUBJECT_ANONYMIZED_MARKER,
  emptyAnonymizeOutcome,
  pseudonymFor,
} from '../src/modules/privacy/anonymize.js';
import {
  dataDeleteConfirmEmbed,
  dataDeleteEmbed,
  dataDeleteLogEmbed,
  privacyEmbed,
} from '../src/modules/privacy/embeds.js';
import {
  buildInventory,
  emptyInventory,
  inventoryActionLine,
  inventoryRows,
  inventoryTouchedCount,
} from '../src/modules/privacy/inventory.js';
import { RETENTION_STATEMENTS } from '../src/modules/privacy/retention.js';
import { PrivacyService, type PrivacyRepositories } from '../src/modules/privacy/service.js';

const GUILD_ID = '123456789012345678';
const OTHER_GUILD_ID = '987654321098765432';
const USER_ID = '222222222222222222';
const OTHER_USER_ID = '444444444444444444';

function rows(...entries: [string, boolean, number][]): TargetActionRow[] {
  return entries.map(([type, active, count]) => ({ type, active, count }));
}

/** Repository palsu yang menyimpan keadaan cukup untuk menguji hasil akhir. */
function fakeRepositories(overrides: {
  actionRows?: TargetActionRow[];
  activeWarnings?: number;
  tickets?: TicketOpenerCount;
  logEntries?: number;
  playlists?: number;
  failAnonymize?: 'moderation' | 'tickets' | 'playlists' | 'logging';
} = {}) {
  const state = {
    anonymizedReason: new Map<string, string>(),
    anonymizedTickets: [] as string[],
    pseudonyms: [] as string[],
    deletedLogs: 0,
    anonymizedPlaylists: 0,
    calls: [] as string[],
  };

  const repositories: PrivacyRepositories = {
    moderation: {
      async countTargetByTypeAndActive(guildId, userId) {
        state.calls.push(`count:${guildId}:${userId}`);
        return guildId === GUILD_ID && userId === USER_ID
          ? (overrides.actionRows ?? [])
          : [];
      },
      async countWarnings(guildId, userId) {
        state.calls.push(`warnings:${guildId}:${userId}`);
        return guildId === GUILD_ID && userId === USER_ID ? (overrides.activeWarnings ?? 0) : 0;
      },
      async anonymizeTarget(guildId, userId, pseudonym, reasonMarker) {
        state.calls.push(`anonymize:moderation:${guildId}:${userId}`);
        if (overrides.failAnonymize === 'moderation') throw new Error('tabel kasus terkunci');
        state.pseudonyms.push(pseudonym);
        state.anonymizedReason.set(`${guildId}:${userId}`, reasonMarker);
        return { cases: 2, warnings: 1 };
      },
    },
    tickets: {
      async countByOpener(guildId, userId) {
        state.calls.push(`tickets:${guildId}:${userId}`);
        return guildId === GUILD_ID && userId === USER_ID
          ? (overrides.tickets ?? { tickets: 0, transcripts: 0 })
          : { tickets: 0, transcripts: 0 };
      },
      async anonymizeOpener(guildId, userId, pseudonym, subjectMarker) {
        state.calls.push(`anonymize:tickets:${guildId}:${userId}`);
        if (overrides.failAnonymize === 'tickets') throw new Error('tabel tiket terkunci');
        state.pseudonyms.push(pseudonym);
        state.anonymizedTickets.push(subjectMarker);
        return overrides.tickets ?? { tickets: 0, transcripts: 0 };
      },
    },
    playlists: {
      async countByOwner(guildId, userId) {
        state.calls.push(`countplaylist:${guildId}:${userId}`);
        return guildId === GUILD_ID && userId === USER_ID ? (overrides.playlists ?? 0) : 0;
      },
      async anonymizeOwner(guildId, userId, pseudonym) {
        state.calls.push(`anonymize:playlists:${guildId}:${userId}`);
        if (overrides.failAnonymize === 'playlists') throw new Error('tabel playlist terkunci');
        state.anonymizedPlaylists = overrides.playlists ?? 0;
        state.pseudonyms.push(pseudonym);
        return overrides.playlists ?? 0;
      },
    },
    logging: {
      async countAboutUser(guildId, userId) {
        state.calls.push(`countlog:${guildId}:${userId}`);
        return guildId === GUILD_ID && userId === USER_ID ? (overrides.logEntries ?? 0) : 0;
      },
      async deleteAboutUser(guildId, userId) {
        state.calls.push(`anonymize:logging:${guildId}:${userId}`);
        if (overrides.failAnonymize === 'logging') throw new Error('tabel log terkunci');
        state.deletedLogs = overrides.logEntries ?? 0;
        return overrides.logEntries ?? 0;
      },
    },
  };

  return { repositories, state };
}

describe('pseudonymFor', () => {
  it('memakai awalan non-numerik agar tidak pernah dikira snowflake', () => {
    const pseudonym = pseudonymFor(GUILD_ID, USER_ID);

    expect(pseudonym).toMatch(/^anon:/);
    expect(pseudonym).not.toMatch(/^\d/);
  });

  it('tetap muat di kolom ID yang saves ke 20 karakter', () => {
    expect(pseudonymFor(GUILD_ID, USER_ID).length).toBeLessThanOrEqual(PSEUDONYM_MAX_LENGTH);
  });

  it('stabil untuk member yang sama — permintaan kedua harus menemukan sisanya', () => {
    expect(pseudonymFor(GUILD_ID, USER_ID)).toBe(pseudonymFor(GUILD_ID, USER_ID));
  });

  it('berbeda antar member dan antar server', () => {
    const base = pseudonymFor(GUILD_ID, USER_ID);

    expect(pseudonymFor(GUILD_ID, OTHER_USER_ID)).not.toBe(base);
    expect(pseudonymFor(OTHER_GUILD_ID, USER_ID)).not.toBe(base);
  });

  it('tidak memuat ID user asli di dalamnya', () => {
    expect(pseudonymFor(GUILD_ID, USER_ID)).not.toContain(USER_ID);
  });
});

describe('buildInventory', () => {
  function inventory(overrides: Partial<Parameters<typeof buildInventory>[0]> = {}) {
    return buildInventory({
      guildId: GUILD_ID,
      userId: USER_ID,
      actionRows: rows(['warn', true, 3], ['note', true, 2], ['timeout', true, 1]),
      activeWarnings: 3,
      tickets: 1,
      ticketTranscripts: 1,
      logEntries: 12,
      playlists: 2,
      ...overrides,
    });
  }

  it('member tanpa data punya inventaris kosong, bukan null', () => {
    const result = inventory({
      actionRows: [],
      activeWarnings: 0,
      tickets: 0,
      ticketTranscripts: 0,
      logEntries: 0,
      playlists: 0,
    });

    expect(result.caseTotal).toBe(0);
    expect(result.cases).toEqual([]);
  });

  it('total kasus memakai seluruh baris, bukan hanya yang dirinci', () => {
    const result = inventory({ actionRows: rows(['warn', true, 30]) });

    expect(result.caseTotal).toBe(30);
    expect(result.cases).toEqual([{ type: 'warn', count: 30 }]);
  });

  it('jenis aksi tak dikenal masuk total tapi tidak dirinci', () => {
    const result = inventory({ actionRows: rows(['warn', true, 1], ['mystery', true, 4]) });

    expect(result.caseTotal).toBe(5);
    expect(result.cases).toEqual([{ type: 'warn', count: 1 }]);
  });

  it('sebaran aksi urut dari terbanyak', () => {
    const result = inventory({ actionRows: rows(['warn', true, 2], ['note', true, 5]) });

    expect(result.cases.map((item) => item.type)).toEqual(['note', 'warn']);
  });

  it('sebaran dipangkas jadi "+N jenis lain" supaya tidak jadi paragraf', () => {
    const result = inventory({
      actionRows: rows(
        ['warn', true, 9],
        ['note', true, 8],
        ['timeout', true, 7],
        ['kick', true, 6],
        ['ban', true, 5],
      ),
    });

    expect(inventoryActionLine(result)).toContain('+1 jenis lain');
  });

  it('baris inventaris menampilkan nol apa adanya', () => {
    // "0 catatan" adalah informasi — menyembunyikannya supaya embed terlihat
    // lebih ramping justru membuat user menebak-nebak.
    const labels = inventoryRows(emptyInventory(GUILD_ID, USER_ID)).map((row) => row.value);

    expect(labels).toContain('0');
    expect(labels).toContain('Tidak ada');
  });

  it('baris log ditandai sudah dihapus, bukan dianonimkan', () => {
    const rows_ = inventoryRows(inventory());
    const logRow = rows_.find((row) => row.label.includes('log'));

    expect(logRow?.removedByDataDelete).toBe(false);
  });

  it('jumlah yang akan tersentuh menjumlahkan semua kelompok data', () => {
    expect(inventoryTouchedCount(inventory())).toBe(6 + 3 + 1 + 1 + 12 + 2);
  });
});

describe('PrivacyService.inventory', () => {
  it('membaca semua kelompok data sekaligus', async () => {
    const { repositories } = fakeRepositories({
      actionRows: rows(['warn', true, 2]),
      activeWarnings: 2,
      tickets: { tickets: 3, transcripts: 1 },
      logEntries: 8,
    });

    const inventory = await new PrivacyService(repositories).inventory(GUILD_ID, USER_ID);

    expect(inventory).toMatchObject({
      caseTotal: 2,
      activeWarnings: 2,
      tickets: 3,
      ticketTranscripts: 1,
      logEntries: 8,
    });
  });

  it('tidak membocorkan data server atau member lain', async () => {
    const { repositories } = fakeRepositories({
      actionRows: rows(['warn', true, 5]),
      logEntries: 5,
    });
    const service = new PrivacyService(repositories);

    expect((await service.inventory(GUILD_ID, OTHER_USER_ID)).caseTotal).toBe(0);
    expect((await service.inventory(OTHER_GUILD_ID, USER_ID)).caseTotal).toBe(0);
  });
});

describe('PrivacyService.anonymize', () => {
  it('melempar identitas di semua modul dan melaporkan jumlahnya', async () => {
    const { repositories } = fakeRepositories({
      tickets: { tickets: 2, transcripts: 1 },
      logEntries: 9,
    });

    const outcome = await new PrivacyService(repositories).anonymize(GUILD_ID, USER_ID);

    expect(outcome).toMatchObject({
      cases: 2,
      warnings: 1,
      tickets: 2,
      transcripts: 1,
      logEntries: 9,
    });
    expect(outcome.pseudonym).toBe(pseudonymFor(GUILD_ID, USER_ID));
  });

  it('melepas identitas pemilik playlist dan melaporkan jumlahnya', async () => {
    // Playlist menyimpan `ownerId`, jadi tanpa langkah ini `/data-delete` akan
    // meninggalkan jejak yang paling mudah dilacak balik ke orangnya.
    const { repositories, state } = fakeRepositories({ playlists: 3 });

    const outcome = await new PrivacyService(repositories).anonymize(GUILD_ID, USER_ID);

    expect(outcome.playlists).toBe(3);
    expect(state.anonymizedPlaylists).toBe(3);
    expect(state.calls).toContain(`anonymize:playlists:${GUILD_ID}:${USER_ID}`);
  });

  it('playlist dianonimkan sebelum log dihapus', async () => {
    const { repositories, state } = fakeRepositories();

    await new PrivacyService(repositories).anonymize(GUILD_ID, USER_ID);

    const playlistCall = state.calls.indexOf(`anonymize:playlists:${GUILD_ID}:${USER_ID}`);
    const loggingCall = state.calls.indexOf(`anonymize:logging:${GUILD_ID}:${USER_ID}`);

    expect(playlistCall).toBeGreaterThanOrEqual(0);
    expect(playlistCall).toBeLessThan(loggingCall);
  });

  it('inventaris menghitung playlist milik member', async () => {
    const { repositories } = fakeRepositories({ playlists: 4 });

    const inventory = await new PrivacyService(repositories).inventory(GUILD_ID, USER_ID);

    expect(inventory.playlists).toBe(4);
    const row = inventoryRows(inventory).find((item) => item.label === 'Playlist milikmu');
    expect(row?.value).toBe('4');
    expect(row?.removedByDataDelete).toBe(true);
  });

  it('mengirim pseudonim yang sama ke semua modul', async () => {
    // Kalau tiap modul memakai pseudonim berbeda, permintaan berikutnya hanya
    // akan menyentuh sebagian data dan sisanya akan terlupakan diam-diam.
    const { repositories, state } = fakeRepositories();

    await new PrivacyService(repositories).anonymize(GUILD_ID, USER_ID);

    const expected = pseudonymFor(GUILD_ID, USER_ID);
    expect(state.pseudonyms.length).toBeGreaterThan(0);
    expect(new Set(state.pseudonyms)).toEqual(new Set([expected]));
  });

  it('menyatakan penanda yang menggantikan isi, bukan sekadar menghapusnya', async () => {
    const { repositories, state } = fakeRepositories();

    await new PrivacyService(repositories).anonymize(GUILD_ID, USER_ID);

    expect(state.anonymizedReason.get(`${GUILD_ID}:${USER_ID}`)).toBe(REASON_ANONYMIZED_MARKER);
    expect(state.anonymizedTickets).toEqual([SUBJECT_ANONYMIZED_MARKER]);
  });

  it('ketidakberhasilan di tengah tidak dilaporkan sebagai selesai', async () => {
    // Kalau kegagalannya ditelan, user akan mengira permintaannya tuntas
    // padahal masih ada data yang bisa ditelusuri.
    const { repositories } = fakeRepositories({ failAnonymize: 'tickets' });

    await expect(
      new PrivacyService(repositories).anonymize(GUILD_ID, USER_ID),
    ).rejects.toThrow('tabel tiket terkunci');
  });

  it('log dihapus paling akhir karena tidak ada yang bergantung padanya', async () => {
    const { repositories, state } = fakeRepositories();
    await new PrivacyService(repositories).anonymize(GUILD_ID, USER_ID);

    const loggingCall = state.calls.lastIndexOf(`anonymize:logging:${GUILD_ID}:${USER_ID}`);
    const moderationCall = state.calls.indexOf(`anonymize:moderation:${GUILD_ID}:${USER_ID}`);

    expect(loggingCall).toBeGreaterThan(moderationCall);
  });
});

describe('embed privasi', () => {
  function inventory() {
    return buildInventory({
      guildId: GUILD_ID,
      userId: USER_ID,
      actionRows: rows(['warn', true, 3], ['note', true, 1]),
      activeWarnings: 3,
      tickets: 1,
      ticketTranscripts: 1,
      logEntries: 12,
      playlists: 2,
    });
  }

  it('/privacy menyebut member dengan mention dan angkanya apa adanya', () => {
    const data = privacyEmbed(inventory()).toJSON();

    expect(data.title).toContain(`<@${USER_ID}>`);
    expect(data.description).toContain('12');
    expect(data.description).toContain('3');
  });

  it('/privacy menyatakan masa simpan tiap kelompok data', () => {
    const fields = privacyEmbed(inventory()).toJSON().fields ?? [];
    const retention = fields.find((field) => field.name === 'Masa simpan')?.value ?? '';

    for (const item of RETENTION_STATEMENTS) {
      expect(retention).toContain(item.label);
      expect(retention).toContain(String(item.days));
    }
  });

  it('/privacy menyatakan hal yang tidak pernah disimpan, termasuk isi voice', () => {
    const fields = privacyEmbed(inventory()).toJSON().fields ?? [];
    const never = fields.find((field) => field.name === 'Tidak pernah disimpan')?.value ?? '';

    expect(never.toLowerCase()).toContain('voice');
  });

  it('konfirmasi /data-delete memproyeksikan angka sebelum ada yang diubah', () => {
    const description = dataDeleteConfirmEmbed(inventory()).toJSON().description ?? '';

    expect(description).toContain('confirm:true');
    expect(description).toContain('12');
  });

  it('hasil /data-delete menyatakan apa yang masih tersisa', () => {
    // Diam-diam menyisakan jejak yang tidak disebut membuat user mengira
    // permintaannya tuntas padahal tidak.
    const description = dataDeleteEmbed(emptyAnonymizeOutcome('anon:0123456789')).toJSON()
      .description ?? '';

    expect(description).toContain('kerangka kasus');
    expect(description).toContain('moderator');
  });

  it('hasil /data-delete menyebut jumlah transkrip yang dihapus', () => {
    const description = dataDeleteEmbed({
      ...emptyAnonymizeOutcome('anon:0123456789'),
      cases: 1,
      transcripts: 2,
    }).toJSON().description ?? '';

    expect(description).toContain('2 transkrip');
  });

  it('embed log membedakan permintaan mandiri dan atas nama orang lain', () => {
    const self = dataDeleteLogEmbed({
      actorId: USER_ID,
      targetId: USER_ID,
      outcome: emptyAnonymizeOutcome('anon:0123456789'),
    }).toJSON();

    const other = dataDeleteLogEmbed({
      actorId: OTHER_USER_ID,
      targetId: USER_ID,
      outcome: emptyAnonymizeOutcome('anon:0123456789'),
    }).toJSON();

    expect(self.title).toContain('Mandiri');
    expect(other.title).toContain('User Lain');
    expect(other.fields?.map((field) => field.value)).toContain(`<@${OTHER_USER_ID}>`);
  });
});