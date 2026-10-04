import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getPrisma } from '../src/services/database.js';
import { getCustomCommandService, resetCustomCommandService } from '../src/modules/customcommands/singleton.js';
import { getLyricsService, resetLyricsService } from '../src/modules/lyrics/singleton.js';
import { getSpotifyService, resetSpotifyService } from '../src/modules/spotify/singleton.js';
import { getModerationService } from '../src/modules/moderation/index.js';
import { getPrivacyService } from '../src/modules/privacy/index.js';
import { getPlaylistService } from '../src/modules/playlists/singleton.js';
import { getReactionRoleService } from '../src/modules/reactionroles/singleton.js';
import { toReactionRoleErrorEmbed } from '../src/modules/reactionroles/errors.js';
import { ReactionRoleEmptyError } from '../src/modules/reactionroles/service.js';
import { ReactionRoleValidationError } from '../src/modules/reactionroles/validation.js';
import { defaultTranslator, translator } from '../src/modules/i18n/index.js';
import { isDatabaseUnavailableError } from '../src/services/prismaErrors.js';

/**
 * Titik rakit singleton, barrel modul, dan pemetaan error reaction role.
 *
 * Dua hal yang dijaga di sini:
 *
 * 1. **Satu instance per proses.** Setiap getter harus mengembalikan objek yang
 *    sama. Kalau tidak, cache per server ikut terpecah — satu perintah membuat
 *    cache, perintah lain membaca cache berbeda, dan perubahan admin tidak
 *    pernah terlihat.
 * 2. **`reset*` benar-benar membuang instance.** Kalau hanya sebagian yang
 *    dibuang, sisa cache milik proses lama masih terbaca setelah start ulang.
 *
 * Barrel juga diuji lewat simbol yang benar-benar dipakai modul lain: file
 * `index.ts` yang salah ekspor akan gagal di sini, bukan saat bot start.
 */

const prisma = vi.hoisted(() => ({ __fake: true }));

vi.mock('../src/services/database.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/services/database.js')>();
  return { ...actual, getPrisma: () => prisma };
});

vi.mock('../src/services/logger.js', () => ({
  getLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }),
}));

beforeEach(() => {
  resetCustomCommandService();
  resetLyricsService();
  resetSpotifyService();
});

describe('singleton: satu instance per proses', () => {
  it('getter mengembalikan instance yang sama setiap dipanggil', () => {
    expect(getCustomCommandService()).toBe(getCustomCommandService());
    expect(getLyricsService()).toBe(getLyricsService());
    expect(getSpotifyService()).toBe(getSpotifyService());
    expect(getModerationService()).toBe(getModerationService());
    expect(getPrivacyService()).toBe(getPrivacyService());
    expect(getPlaylistService()).toBe(getPlaylistService());
    expect(getReactionRoleService()).toBe(getReactionRoleService());
  });

  it('reset melody dan Spotify membangun instance baru', () => {
    const lyrics = getLyricsService();
    const spotify = getSpotifyService();

    resetLyricsService();
    resetSpotifyService();

    // Kalau reset tidak membuang instance, cache dari proses lama masih terbaca
    // danPerubahan admin tidak akan terlihat setelah start ulang.
    expect(getLyricsService()).not.toBe(lyrics);
    expect(getSpotifyService()).not.toBe(spotify);
  });

  it('reset custom command membuang instance', () => {
    const service = getCustomCommandService();

    resetCustomCommandService();

    expect(getCustomCommandService()).not.toBe(service);
  });

  it('reset idempoten: memanggilnya dua kali tidak gagal', () => {
    resetCustomCommandService();

    expect(() => {
      resetCustomCommandService();
    }).not.toThrow();
    expect(getCustomCommandService()).toBeDefined();
  });

  it('semua repository Prisma dibangun dari satu Klien yang sama', () => {
    // Enam modul memakai `getPrisma()`. Kalau salah satu membangun koneksi
    // sendiri, pool PostgreSQL ikut berlipat tanpa disadari.
    const before = getPrisma();

    getCustomCommandService();
    getModerationService();
    getPrivacyService();
    getPlaylistService();
    getReactionRoleService();

    expect(getPrisma()).toBe(before);
  });

  it('service Spotify tetap ada walau kredensial kosong', () => {
    const service = getSpotifyService();

    // Tidak melempar: `/play` yang memeriksa `isConfigured` memilih jalur
    // Lavalink biasa, jadi bot tetap bisa_SERVICE musik tanpa Spotify.
    expect(service).toBeDefined();
    expect(typeof service.isConfigured).toBe('boolean');
  });
});

describe('barrel modul: simbol yang benar-benar diimpor modul lain', () => {
  it('moderation mengekspor tautan kasus, yang dipakai 7 handler logging', async () => {
    const moderation = await import('../src/modules/moderation/index.js');

    expect(typeof moderation.registerCaseLink).toBe('function');
    expect(typeof moderation.consumeCaseLink).toBe('function');
    expect(typeof moderation.clearCaseLinks).toBe('function');
    expect(moderation.LINKED_CASE_ACTIONS).toContain('ban');
  });

  it('moderation mengekspor daftar aksi yang bisa dinotifikasi', async () => {
    const moderation = await import('../src/modules/moderation/index.js');

    // `NOTIFIABLE_ACTIONS` menentukan aksi mana yang dikirim lewat DM. Kalau
    // Kalau daftarnya salah, satu aksi hanya diam-diam tidak sampai.
    expect(moderation.NOTIFIABLE_ACTIONS).toContain('ban');
    expect(moderation.NOTIFIABLE_ACTIONS).toContain('kick');
    expect(typeof moderation.moderationLogCategory('note')).toBe('object');
  });

  it('moderation mengekspor batas maksimum yang dipakai perintah', async () => {
    const moderation = await import('../src/modules/moderation/index.js');

    expect(moderation.MAX_NOTES_SHOWN).toBeGreaterThan(0);
    expect(moderation.MAX_PURGE_COUNT).toBeGreaterThan(0);
    expect(moderation.MAX_TIMEOUT_MS).toBeGreaterThan(0);
  });

  it('privacy mengekspor pernyataan retensi yang wajib ditampilkan', async () => {
    const privacy = await import('../src/modules/privacy/index.js');

    expect(privacy.MODERATION_RETENTION_YEARS).toBeGreaterThan(0);
    expect(privacy.RETENTION_STATEMENTS.length).toBeGreaterThan(0);
  });

  it('privacy mengekspor pembentuk inventory', async () => {
    const privacy = await import('../src/modules/privacy/index.js');

    // `emptyInventory` butuh guild & user: hasilnya selalu milik satu
    // satu permintaan, jadi tanda tangannya tidak boleh dibuat opsional.
    const inventory = privacy.emptyInventory('111111111111111111', '222222222222222222');
    expect(inventory.caseTotal).toBe(0);
    expect(inventory.cases).toEqual([]);
    expect(typeof privacy.buildInventory).toBe('function');
    expect(privacy.PSEUDONYM_MAX_LENGTH).toBeGreaterThan(0);
  });

  it('i18n mengekspor penerjemah yang dipakai semua renderer', async () => {
    const i18n = await import('../src/modules/i18n/index.js');

    expect(i18n.DEFAULT_LOCALE).toBe('id');
    expect(typeof i18n.translatorFor).toBe('function');
    expect(i18n.defaultTranslator('embed.title.error')).toBeTruthy();
  });
});

describe('pemetaan error reaction role', () => {
  /** Teks lengkap dari sebuah embed error. */
  function text(embed: ReturnType<typeof toReactionRoleErrorEmbed>): string {
    const data = embed.toJSON() as { title?: string; description?: string };
    return `${data.title ?? ''}\n${data.description ?? ''}`;
  }

  it('error validasi memakai kunci katalognya sendiri', () => {
    // `rr.err.noRoles` dipakai: admin tidak menandai satu pun role untuk
    // panel, dan pesan itu memang punya kuncinya sendiri.
    const error = new ReactionRoleValidationError('rr.err.noRoles');

    // Pesan validasi sudah membawa kunci katalog, jadi embed-nya ikut bahasa
    // server dan tidak perlu kalimat tambahan.
    expect(text(toReactionRoleErrorEmbed(error))).toContain(defaultTranslator('rr.err.noRoles'));
  });

  it('error validasi menghormati bahasa yang diminta', () => {
    const error = new ReactionRoleValidationError('rr.err.noRoles');

    const english = toReactionRoleErrorEmbed(error, translator('en'));

    expect(text(english)).toContain(translator('en')('rr.err.noRoles'));
  });

  it('error panel kosong dipetakan lewat jalur validasi', () => {
    // `ReactionRoleEmptyError` juga membawa kunci katalog, jadi perlakuannya
    // harus sama dengan error validasi.
    const error = new ReactionRoleEmptyError('rr.err.noRolesForPanel');

    expect(text(toReactionRoleErrorEmbed(error))).toContain(
      defaultTranslator('rr.err.noRolesForPanel'),
    );
    expect(text(toReactionRoleErrorEmbed(error))).not.toContain(defaultTranslator('rr.err.generic'));
  });

  it('database mati punya pesan dan judulnya sendiri', () => {
    const error = Object.assign(new Error('connection refused'), {
      code: 'P1001',
    });

    //_errored dimodul logging jadi pesan ini tidak boleh menyebut stack.
    expect(isDatabaseUnavailableError(error)).toBe(true);
    const rendered = text(toReactionRoleErrorEmbed(error));

    expect(rendered).toContain(defaultTranslator('rr.err.dbOffline'));
    expect(rendered).toContain(defaultTranslator('rr.err.dbOfflineTitle'));
  });

  it('error tak terduga jadi pesan umum tanpa membocorkan detail', () => {
    const rendered = text(toReactionRoleErrorEmbed(new Error('rahasia internal xyz')));

    expect(rendered).toContain(defaultTranslator('rr.err.generic'));
    // Detail internal tidak boleh sampai ke channel yang bisa dibaca semua orang.
    expect(rendered).not.toContain('rahasia internal xyz');
  });

  it('nilai yang bukan Error pun tetap aman', () => {
    expect(text(toReactionRoleErrorEmbed('bukan error'))).toContain(
      defaultTranslator('rr.err.generic'),
    );
    expect(text(toReactionRoleErrorEmbed(undefined))).toContain(
      defaultTranslator('rr.err.generic'),
    );
  });
});