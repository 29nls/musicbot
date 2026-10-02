import { describe, expect, it } from 'vitest';
import { isRegisterableModule } from '../src/utils/moduleLoader.js';

describe('isRegisterableModule', () => {
  it('menerima modul perintah/event biasa', () => {
    expect(isRegisterableModule('play.ts')).toBe(true);
    expect(isRegisterableModule('clientReady.js')).toBe(true);
    expect(isRegisterableModule('interactionCreate.mjs')).toBe(true);
  });

  it('melewati helper berawalan garis bawah', () => {
    // Regresi: `shared.ts` di dalam folder commands/ pernah ikut dimuat dan
    // membuat bot gagal start.
    expect(isRegisterableModule('_shared.ts')).toBe(false);
    expect(isRegisterableModule('_helpers.js')).toBe(false);
  });

  it('melewati berkas yang bukan modul', () => {
    expect(isRegisterableModule('types.d.ts')).toBe(false);
    expect(isRegisterableModule('play.test.ts')).toBe(false);
    expect(isRegisterableModule('play.spec.ts')).toBe(false);
    expect(isRegisterableModule('.gitkeep')).toBe(false);
    expect(isRegisterableModule('catatan.md')).toBe(false);
  });
});
