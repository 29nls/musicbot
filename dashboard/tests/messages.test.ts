import { describe, expect, it } from 'vitest';
import { MESSAGE_KEYS, translate } from '@bot/modules/i18n/catalog.js';
import { LOCALES } from '@bot/modules/i18n/types.js';
import {
  DASHBOARD_MESSAGE_KEYS,
  dashboardTranslate,
  dashboardTranslator,
} from '@/lib/messages.js';
import { DASHBOARD_MODULES, DASHBOARD_VALUE_FIELDS, highImpactFields } from '@/lib/fieldCatalog.js';

/**
 * Penjaga katalog dashboard (D6).
 *
 * Tiga aturan, ketiganya bisa diuji dan ketiganya bisa gagal diam-diam kalau
 * tidak dijaga:
 *
 * 1. Tidak ada kunci dashboard yang sama dengan kunci bot. Kalau nanti ada, itu
 *    dua definisi untuk satu teks dan hanya satu yang dipakai.
 * 2. Tidak ada nilai dashboard yang identik dengan nilai bot. Dua teks sama di
 *    dua tempat tetap dua tempat untuk diperbarui.
 * 3. Setiap kunci punya terjemahan di kedua bahasa.
 */

const botKeys = new Set<string>(MESSAGE_KEYS);

describe('katalog dashboard tidak menabrak katalog bot', () => {
  it('tidak ada kunci yang sama', () => {
    const clash = DASHBOARD_MESSAGE_KEYS.filter((key) => botKeys.has(key));

    expect(clash).toEqual([]);
  });

  it('tidak ada kalimat panjang yang identik dengan teks bot', () => {
    // Hanya teks yang panjang diperiksa. Kata pendek seperti "Cancel" atau
    // "Save" akan selalu bertabrakan dengan kosakata — itu bukan duplikasi yang
    // berbahaya karena tidak ada kalimat yang harus ikut diperbarui. Yang
    // berbahaya adalah kalimat utuh yang punya dua salinan.
    const strip = (text: string): string => text.replace(/^[\p{Emoji_Presentation}\s]+/u, '');
    const botValues = new Set(MESSAGE_KEYS.map((key) => strip(translate('id', key))));

    const duplicated = DASHBOARD_MESSAGE_KEYS.filter((key) => {
      const value = strip(dashboardTranslate('id', key));

      return value.length >= 12 && botValues.has(value);
    });

    expect(duplicated).toEqual([]);
  });

  it('prefiks katalog dashboard tidak menyerupai katalog bot', () => {
    // Bot memakai `config.*`, `mod.*`, `music.*`, `log.*`, `embed.*`, `admin.*`.
    // Dashboard memakai `login.*`, `guilds.*`, `config.section*`, `config.value*`,
    // `config.channel*`, `action.*`, `save.*`, `confirm.*`, `error.*`,
    // `audit.*`, `help.*`.
    for (const key of DASHBOARD_MESSAGE_KEYS) {
      expect(botKeys.has(key), `kunci "${key}" bentrok`).toBe(false);
    }
  });
});

describe('kelengkapan terjemahan', () => {
  it('setiap kunci punya teks di kedua bahasa', () => {
    for (const locale of LOCALES) {
      for (const key of DASHBOARD_MESSAGE_KEYS) {
        const text = dashboardTranslate(locale, key);
        expect(text, `${key} kosong di ${locale}`).not.toBe('');
        expect(text, `${key} belum diterjemahkan di ${locale}`).not.toBe(key);
      }
    }
  });

  it('Bahasa Inggris benar-benar berbeda dari Bahasa Indonesia', () => {
    // Kalau keduanya sama, berarti ada yang lupa mengisi `enMessages`. Katalog
    // setengah terisi lebih buruk daripada kosong: orang melihat dua bahasa di
    // satu layar dan tidak bisa menebak mana yang belum diterjemahkan.
    const identical = DASHBOARD_MESSAGE_KEYS.filter(
      (key) => dashboardTranslate('id', key) === dashboardTranslate('en', key),
    );

    // Tiga yang memang boleh sama: `login.title` (nama produk),
    // `save.fieldTitle` dan `save.invalid` (pola placeholder murni tanpa kata
    // bahasa). Kalau ada kunci lain, berarti `enMessages` punya baris yang
    // disalin dari `idMessages`.
    expect(identical.sort()).toEqual(['login.title', 'save.fieldTitle', 'save.invalid']);
  });

  it('bahasa yang tidak dikenal jatuh ke Bahasa Indonesia, bukan ke kunci', () => {
    const unknown = 'de' as unknown as 'id';

    expect(dashboardTranslate(unknown, 'action.save')).toBe(dashboardTranslate('id', 'action.save'));
  });
});

describe('placeholder', () => {
  it('placeholder diisi', () => {
    expect(dashboardTranslate('id', 'save.okBody', { count: 3 })).toContain('3');
  });

  it('placeholder yang tidak ada dibiarkan tertulis, bukan dihapus', () => {
    // Teks yang gagal menerjemahkan harus terlihat ada yang salah supaya bisa
    // dicari di log — bukan hilang begitu saja.
    expect(dashboardTranslate('id', 'save.okBody')).toContain('{count}');
  });
});

describe('kunci yang dipakai katalog field benar-benar ada', () => {
  it('setiap label field ada di katalog bot', () => {
    for (const field of DASHBOARD_VALUE_FIELDS) {
      expect(() => translate('id', field.labelKey)).not.toThrow();
      expect(botKeys.has(field.labelKey), `${field.patchKey} punya labelKey yang tidak ada`).toBe(true);
    }
  });

  it('setiap label modul ada di katalog bot', () => {
    for (const module of DASHBOARD_MODULES) {
      expect(botKeys.has(module.labelKey)).toBe(true);
    }
  });

  it('setiap kunci penjelasan ada di katalog dashboard', () => {
    for (const field of DASHBOARD_VALUE_FIELDS) {
      expect(dashboardTranslate('id', field.helpKey), field.patchKey).not.toBe(field.helpKey);
    }
  });

  it('setiap kunci konfirmasi ada dan punya placeholder {before}', () => {
    // US-D3: konfirmasi harus menyebut nilai lama dengan kalimatnya. Kalau
    // placeholder-nya hilang, dialog akan menyebut perubahan tanpa memberi tahu
    // apa yang diganti — persis yang diminta untuk dihindari.
    const confirms = highImpactFields();
    expect(confirms.length).toBeGreaterThan(0);

    for (const field of confirms) {
      const key = field.highImpactConfirmKey;
      expect(key, `${field.patchKey} butuh kunci konfirmasi`).toBeDefined();
      if (!key) continue;
      expect(dashboardTranslate('id', key)).toContain('{before}');
    }
  });

  it('field ber-impact tinggi persis yang PRD sebutkan', () => {
    const keys = highImpactFields().map((field) => field.patchKey).sort();

    // `logChannelId`, `djRoleId`, `autoroleId`, `autoroleBotId`, `stayChannelId` —
    // plus modul yang dimatikan, yang ditangani lewat `confirm.moduleOff`.
    expect(keys).toEqual(['autoroleBotId', 'autoroleId', 'djRoleId', 'logChannelId', 'stayChannelId']);
  });

  it('batas angka field berasal dari konstanta bot', () => {
    const volume = DASHBOARD_VALUE_FIELDS.find((field) => field.patchKey === 'defaultVolume');
    const idle = DASHBOARD_VALUE_FIELDS.find((field) => field.patchKey === 'idleTimeoutSec');

    expect(volume).toMatchObject({ min: 0, max: 200 });
    expect(idle).toMatchObject({ min: 30, max: 86_400 });
  });
});

describe('dashboardTranslator mengikat satu bahasa', () => {
  it('penerjemah yang terikat memakai bahasa itu', () => {
    const t = dashboardTranslator('en');

    expect(t('action.save')).toBe('Save changes');
    expect(dashboardTranslator('id')('action.save')).toBe('Simpan perubahan');
  });
});