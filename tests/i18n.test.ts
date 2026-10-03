import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LOCALE,
  LOCALE_LABELS,
  LOCALES,
  MESSAGE_KEYS,
  applyCommandLocalization,
  applyCommandLocalizations,
  interpolate,
  isCatalogComplete,
  missingKeys,
  parseLocale,
  toLocale,
  translate,
  translator,
} from '../src/modules/i18n/index.js';
import {
  EN_COMMAND_TRANSLATIONS,
  MAX_COMMAND_DESCRIPTION_LENGTH,
  commandsMissingTranslation,
} from '../src/modules/i18n/commandTranslations.js';
import { LocaleService } from '../src/modules/i18n/service.js';
import { listModuleFiles, importDefault } from '../src/utils/moduleLoader.js';
import type { GuildConfig } from '../src/modules/config/index.js';

describe('parseLocale', () => {
  it('menerima kode bahasa dan alias yang biasa diketik orang', () => {
    for (const input of ['id', 'ID', ' id ', 'ind', 'Indonesia', 'bahasa indonesia']) {
      expect(parseLocale(input)).toBe('id');
    }

    for (const input of ['en', 'EN', 'eng', 'English', 'inggris']) {
      expect(parseLocale(input)).toBe('en');
    }
  });

  it('menolak bahasa yang tidak dikenal, bukan menebak', () => {
    expect(parseLocale('de')).toBeNull();
    expect(parseLocale('')).toBeNull();
    expect(parseLocale('  ')).toBeNull();
    expect(parseLocale(null)).toBeNull();
    expect(parseLocale(undefined)).toBeNull();
  });

  it('toLocale selalu mengembalikan bahasa yang sah', () => {
    expect(toLocale('en')).toBe('en');
    expect(toLocale('entah')).toBe(DEFAULT_LOCALE);
    expect(toLocale(undefined)).toBe('id');
  });

  it('punya label untuk setiap bahasa yang didukung', () => {
    for (const locale of LOCALES) {
      expect(LOCALE_LABELS[locale]).toBeTruthy();
    }
  });
});

describe('katalog runtime', () => {
  it('memberi terjemahan berbeda untuk tiap bahasa yang diminta', () => {
    expect(translate('id', 'embed.title.error')).toContain('Kesalahan');
    expect(translate('en', 'embed.title.error')).toContain('Something went wrong');
    expect(translate('id', 'embed.title.error')).not.toBe(translate('en', 'embed.title.error'));
  });

  it('mengisi placeholder dengan nilai yang diberikan', () => {
    expect(translate('en', 'config.locale.changed', { locale: 'English' })).toBe(
      'This server now uses English.',
    );
    expect(translate('id', 'config.locale.changed', { locale: 'Bahasa Indonesia' })).toBe(
      'Bahasa server ini sekarang Bahasa Indonesia.',
    );
  });

  it('membiarkan placeholder yang tidak dikenal tetap tertulis', () => {
    expect(interpolate('Halo {nama},_missing {x}', { nama: 'Budi' })).toBe(
      'Halo Budi,_missing {x}',
    );
    expect(interpolate('Tanpa placeholder')).toBe('Tanpa placeholder');
  });

  it('tidak pernah melempar untuk kunci yang tidak dikenal', () => {
    const bogus = 'kunci.itu.tidak.ada' as Parameters<typeof translate>[1];

    expect(translate('en', bogus)).toBe(bogus);
    expect(translate('id', bogus)).toBe(bogus);
  });

  it('memiliki katalog lengkap untuk kedua bahasa', () => {
    expect(missingKeys('id')).toEqual([]);
    expect(missingKeys('en')).toEqual([]);
    expect(isCatalogComplete('id')).toBe(true);
    expect(isCatalogComplete('en')).toBe(true);
  });

  it('menyimpan kunci yang sama persis di kedua bahasa', () => {
    // Tipe katalog Inggris sudah memaksa ini, tapi tes ini yang memastikannya
    // kalau suatu saat katalog ditulis ulang tanpa tipe.
    expect(MESSAGE_KEYS.length).toBeGreaterThan(0);
    for (const key of MESSAGE_KEYS) {
      expect(translate('id', key)).not.toBe(key);
      expect(translate('en', key)).not.toBe(key);
    }
  });

  it('translator memakai locale yang sama seperti translate', () => {
    const t = translator('en');

    expect(t('music.gate.needVoice')).toBe(translate('en', 'music.gate.needVoice'));
  });
});

describe('LocaleService', () => {
  function config(locale: string): GuildConfig {
    return { guildId: 'g', locale } as unknown as GuildConfig;
  }

  function makeService(responses: (string | Error)[]): {
    service: LocaleService;
    calls: () => number;
  } {
    let calls = 0;
    const service = new LocaleService({
      getConfig: async () => {
        const next = responses[calls];
        calls += 1;
        if (next instanceof Error) throw next;
        return config(next ?? 'id');
      },
    });

    return { service, calls: () => calls };
  }

  it('membaca bahasa server dan menyimpannya di cache', async () => {
    const { service, calls } = makeService(['en', 'en', 'en']);

    expect(await service.localeFor('g')).toBe('en');
    expect(await service.localeFor('g')).toBe('en');
    expect(await service.localeFor('g')).toBe('en');
    expect(calls()).toBe(1);
  });

  it('membaca ulang setelah cache kedaluwarsa', async () => {
    let now = 1_000;
    let calls = 0;
    const service = new LocaleService({
      getConfig: async () => {
        calls += 1;
        return config(calls === 1 ? 'id' : 'en');
      },
      ttlMs: 100,
      now: () => now,
    });

    expect(await service.localeFor('g')).toBe('id');
    expect(await service.localeFor('g')).toBe('id');

    now += 101;
    expect(await service.localeFor('g')).toBe('en');
  });

  it('membuang cache saat bahasa diubah, supaya langsung berlaku', async () => {
    const { service } = makeService(['id', 'id']);

    expect(await service.localeFor('g')).toBe('id');
    service.invalidate('g');
    expect(await service.localeFor('g')).toBe('id');
  });

  it('jatuh ke bahasa bawaan saat config tidak bisa dibaca', async () => {
    const { service } = makeService([new Error('database mati')]);

    expect(await service.localeFor('g')).toBe(DEFAULT_LOCALE);
  });

  it('jatuh ke bahasa bawaan untuk bahasa yang tidak dikenal', async () => {
    const { service } = makeService(['de']);

    expect(await service.localeFor('g')).toBe(DEFAULT_LOCALE);
  });

  it('mengosongkan seluruh cache saat diminta', async () => {
    const { service, calls } = makeService(['en', 'en', 'en']);

    await service.localeFor('g');
    service.invalidateAll();
    await service.localeFor('g');
    expect(calls()).toBe(2);
  });
});

/** Bentuk payload yang dipakai tes; memuat field hasil lokalisasi. */
interface LocalizedJson {
  name: string;
  description?: string;
  name_localizations?: Record<string, string>;
  description_localizations?: Record<string, string>;
}

describe('lokalisasi perintah saat deploy', () => {
  it('menambahkan nama dan deskripsi bahasa Inggris', () => {
    const result = applyCommandLocalization<LocalizedJson>({
      name: 'play',
      description: 'Putar lagu',
    });

    expect(result.name_localizations).toEqual({ en: 'play' });
    expect(result.description_localizations).toEqual({ en: 'Play a track or add it to the queue' });
  });

  it('meneruskan perintah tanpa terjemahan apa adanya', () => {
    const json: LocalizedJson = { name: 'perintah-yang-tidak-ada', description: 'X' };
    const result = applyCommandLocalization(json);

    expect(result).toEqual(json);
    expect(result.name_localizations).toBeUndefined();
  });

  it('tidak menimpa terjemahan bahasa lain yang sudah ada', () => {
    const result = applyCommandLocalization({
      name: 'play',
      name_localizations: { de: 'abspielen' },
      description_localizations: { de: 'Ein Lied abspielen' },
    });

    expect(result.name_localizations).toEqual({ de: 'abspielen', en: 'play' });
    expect(result.description_localizations).toEqual({
      de: 'Ein Lied abspielen',
      en: 'Play a track or add it to the queue',
    });
  });

  it('menerjemahkan seluruh daftar sekaligus', () => {
    const result = applyCommandLocalizations<LocalizedJson>([{ name: 'play' }, { name: 'queue' }]);

    expect(result).toHaveLength(2);
    expect(result.every((item) => item.description_localizations !== undefined)).toBe(true);
  });

  it('menyebut perintah yang belum punya terjemahan', () => {
    expect(commandsMissingTranslation(['play', 'perintah-yang-tidak-ada'])).toEqual([
      'perintah-yang-tidak-ada',
    ]);
    expect(commandsMissingTranslation(['play'])).toEqual([]);
  });
});

describe('cakupan terjemahan perintah', () => {
  /**
   * Batas khusus untuk tes yang mengimpor seluruh 46 modul perintah.
   *
   * Impor pertama itu dingin: harus memuat loader, Prisma, Redis, dan
   * Lavalink lebih dulu. Di luar bawah lima detik saat mesinnya sedang dipakai
   * atau saat coverage menginstrumentasi tiap berkas, itu bukan kegagalan
   * apa pun — hanya pekerjaan yang memang mahal. Assertion-nya tidak berubah.
   */
  const IMPORT_ALL_COMMANDS_TIMEOUT_MS = 30_000;

  /**
   * Daftar nama perintah asli, dihitung sekali untuk seluruh blok.
   *
   * Empat tes di bawah butuh data yang sama; menghitungnya berulang berarti
   * mengimpor 46 modul sebanyak empat kali tanpa menambah cakupan apa pun.
   */
  let commandNames: Promise<string[]> | undefined;

  async function loadCommandNames(): Promise<string[]> {
    const names: string[] = [];

    for (const file of listModuleFiles('src/commands')) {
      const command = (await importDefault('./' + file.replace(/\\/g, '/'))) as
        | { data?: { name?: string } }
        | undefined;

      if (command?.data?.name) names.push(command.data.name);
    }

    return names;
  }

  function realCommandNames(): Promise<string[]> {
    commandNames ??= loadCommandNames();
    return commandNames;
  }

  it(
    'menerjemahkan setiap perintah yang benar-benar ada',
    async () => {
      const missing = commandsMissingTranslation(await realCommandNames());

      expect(missing).toEqual([]);
    },
    IMPORT_ALL_COMMANDS_TIMEOUT_MS,
  );

  it('tidak punya entri untuk perintah yang sudah dihapus', async () => {
    const actual = new Set(await realCommandNames());
    const stale = Object.keys(EN_COMMAND_TRANSLATIONS).filter((name) => !actual.has(name));

    expect(stale).toEqual([]);
  });

  it('memakai nama perintah yang sama persis di kedua bahasa', async () => {
    // Discord memakai nama Indonesia sebagai nama kanonik; terjemahan nama
    // perintah yang berbeda akan merusak orang yang mengetik nama aslinya.
    for (const name of await realCommandNames()) {
      const translation = EN_COMMAND_TRANSLATIONS[name];

      expect(translation?.en.name).toBe(name);
    }
  });

  it('menjaga deskripsi Inggris dalam batas Discord', () => {
    for (const [name, translation] of Object.entries(EN_COMMAND_TRANSLATIONS)) {
      expect(translation.en.description.length, name).toBeGreaterThan(0);
      expect(translation.en.description.length, name).toBeLessThanOrEqual(
        MAX_COMMAND_DESCRIPTION_LENGTH,
      );
    }
  });
});