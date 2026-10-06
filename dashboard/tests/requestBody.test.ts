import { describe, expect, it } from 'vitest';
import { DEFAULT_MODULES } from '@bot/modules/config/types.js';
import { buildRequestBody, type FormDraft } from '@/components/ConfigForm.js';
import { DASHBOARD_VALUE_FIELDS } from '@/lib/fieldCatalog.js';

/**
 * Aturan yang menentukan apa yang benar-benar dikirim ke database.
 *
 * Dipisah dari tes render React karena ini keputusan, bukan tampilan: kalau form
 * mengirim field yang tidak berubah, setiap penyuntingan menghasilkan entri
 * audit kosong dan setiap penyimpanan menyebabkan bot membuang cache tanpa
 * alasan.
 */

function draft(overrides: Partial<FormDraft> = {}): FormDraft {
  const base: FormDraft = {
    logChannelId: '',
    welcomeChannelId: '',
    goodbyeChannelId: '',
    djRoleId: '',
    autoroleId: '',
    autoroleBotId: '',
    welcomeMessage: '',
    goodbyeMessage: '',
    defaultVolume: '100',
    idleTimeoutSec: '300',
    stayChannelId: '',
    locale: 'id',
    modules: { ...DEFAULT_MODULES },
  };

  return { ...base, ...overrides, modules: { ...base.modules, ...(overrides.modules ?? {}) } };
}

describe('hanya field yang berubah yang dikirim', () => {
  it('draft yang sama menghasilkan body kosong', () => {
    expect(buildRequestBody(draft(), draft())).toEqual({});
  });

  it('satu field angka terkirim sebagai angka, bukan string', () => {
    const body = buildRequestBody(draft(), draft({ defaultVolume: '40' }));

    expect(body).toEqual({ defaultVolume: 40 });
    expect(typeof body.defaultVolume).toBe('number');
  });

  it('idle timeout dikirim sebagai angka', () => {
    expect(buildRequestBody(draft(), draft({ idleTimeoutSec: '600' }))).toEqual({ idleTimeoutSec: 600 });
  });

  it('field teks dikirim apa adanya', () => {
    expect(buildRequestBody(draft(), draft({ welcomeMessage: 'halo {user}' }))).toEqual({
      welcomeMessage: 'halo {user}',
    });
  });

  it('locale ikut terkirim saat berubah', () => {
    expect(buildRequestBody(draft(), draft({ locale: 'en' }))).toEqual({ locale: 'en' });
  });
});

describe('kosong berarti mengosongkan, bukan tidak berubah', () => {
  it('channel yang dikosongkan terkirim null', () => {
    const before = draft({ logChannelId: '400000000000000004' });
    const after = draft({ logChannelId: '' });

    expect(buildRequestBody(before, after)).toEqual({ logChannelId: null });
  });

  it('pesan yang dikosongkan terkirim null', () => {
    const before = draft({ goodbyeMessage: 'sampai jumpa' });

    expect(buildRequestBody(before, draft({ goodbyeMessage: '' }))).toEqual({ goodbyeMessage: null });
  });

  it('nilai kosong yang sama sekali tidak dikirim', () => {
    // Kalau `''` terkirim untuk field yang tadinya juga kosong, setiap
    // penyimpanan akan terlihat seperti perubahan pada semua field kosong.
    expect(buildRequestBody(draft(), draft())).toEqual({});
  });
});

describe('modul', () => {
  // `music` dan `moderation` bawaannya true, `logging`/`automod`/`customCommands`
  // bawaannya false. Tes harus tahu itu: mematikan modul yang memang sudah mati
  // bukan perubahan, dan mengirimnya akan membuang cache bot tanpa alasan.
  it('modul yang dimatikan terkirim sebagai false', () => {
    const after = draft();
    after.modules.music = false;

    expect(buildRequestBody(draft(), after)).toEqual({ modules: { music: false } });
  });

  it('beberapa modul dalam satu permintaan', () => {
    const after = draft();
    after.modules.music = false;
    after.modules.logging = true;

    expect(buildRequestBody(draft(), after)).toEqual({ modules: { music: false, logging: true } });
  });

  it('modul yang tidak berubah tidak ikut terkirim', () => {
    const after = draft();
    after.modules.music = DEFAULT_MODULES.music;

    expect(buildRequestBody(draft(), after)).toEqual({});
  });

  it('menyalakan modul yang sudah mati terkirim sebagai true', () => {
    const after = draft();
    after.modules.logging = true;

    expect(buildRequestBody(draft(), after)).toEqual({ modules: { logging: true } });
  });

  it('modul di luar daftar dashboard tidak pernah bisa dikirim', () => {
    // `buildRequestBody` hanya membaca `DASHBOARD_MODULES`, jadi `reactions` dan
    // `tickets` tidak punya jalan ke body meski ada di `ModulesEnabled`.
    const after = draft();
    // Ditulis lewat `unknown` karena `ModulesEnabled` memang tidak punya index
    // signature — dan justru itu yang kita buktikan: kedua key ini tidak punya
    // jalan ke body meski ada di tipe.
    const modules = after.modules as unknown as Record<string, boolean>;
    modules.reactions = false;
    modules.tickets = true;

    expect(buildRequestBody(draft(), after)).toEqual({});
  });
});

describe('beberapa field sekaligus', () => {
  it('nilai dan modul bisa dikirim bersamaan', () => {
    const after = draft({ defaultVolume: '40', welcomeChannelId: '400000000000000004' });
    after.modules.music = false;

    expect(buildRequestBody(draft(), after)).toEqual({
      defaultVolume: 40,
      welcomeChannelId: '400000000000000004',
      modules: { music: false },
    });
  });

  it('tidak ada field yang terkirim dua kali', () => {
    const after = draft({ defaultVolume: '40' });
    const body = buildRequestBody(draft(), after);

    expect(Object.keys(body)).toHaveLength(1);
  });
});

describe('setiap field punya cara mengosongkannya', () => {
  it('field channel, role, dan teks bisa dikosongkan', () => {
    const clearable = DASHBOARD_VALUE_FIELDS.filter(
      (field) => field.kind === 'channel' || field.kind === 'role' || field.kind === 'text',
    );

    expect(clearable.length).toBe(9);

    for (const field of clearable) {
      const before = draft({ [field.patchKey]: '400000000000000004' });
      const body = buildRequestBody(before, draft());

      expect(body[field.patchKey], `${field.patchKey} tidak bisa dikosongkan`).toBeNull();
    }
  });
});