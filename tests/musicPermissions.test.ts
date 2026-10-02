import { describe, expect, it } from 'vitest';
import {
  canControlMusic,
  clampVolume,
  isInSameVoiceChannel,
} from '../src/modules/music/permissions.js';

const DJ_ROLE = '223456789012345678';

describe('canControlMusic', () => {
  it('selalu mengizinkan pemegang Manage Server', () => {
    expect(
      canControlMusic({ djRoleId: DJ_ROLE, memberRoleIds: [], canManageGuild: true }),
    ).toBe(true);
  });

  it('mengizinkan semua orang kalau server belum mengatur role DJ', () => {
    expect(
      canControlMusic({ djRoleId: null, memberRoleIds: [], canManageGuild: false }),
    ).toBe(true);
  });

  it('mengizinkan pemilik role DJ', () => {
    expect(
      canControlMusic({ djRoleId: DJ_ROLE, memberRoleIds: [DJ_ROLE], canManageGuild: false }),
    ).toBe(true);
  });

  it('menolak anggota lain saat role DJ diatur', () => {
    expect(
      canControlMusic({
        djRoleId: DJ_ROLE,
        memberRoleIds: ['323456789012345678'],
        canManageGuild: false,
      }),
    ).toBe(false);
    expect(
      canControlMusic({ djRoleId: DJ_ROLE, memberRoleIds: [], canManageGuild: false }),
    ).toBe(false);
  });
});

describe('isInSameVoiceChannel', () => {
  it('boleh kalau bot belum masuk voice channel', () => {
    expect(isInSameVoiceChannel('111', null, false)).toBe(true);
    expect(isInSameVoiceChannel(null, undefined, false)).toBe(true);
  });

  it('harus sama channel saat bot sedang memutar', () => {
    expect(isInSameVoiceChannel('111', '111', false)).toBe(true);
    expect(isInSameVoiceChannel('222', '111', false)).toBe(false);
    expect(isInSameVoiceChannel(null, '111', false)).toBe(false);
  });

  it('Manage Server dikecualikan supaya admin tidak terkunci', () => {
    expect(isInSameVoiceChannel('222', '111', true)).toBe(true);
    expect(isInSameVoiceChannel(null, '111', true)).toBe(true);
  });
});

describe('clampVolume', () => {
  it('membatasi 0–200 dan membulatkan', () => {
    expect(clampVolume(150)).toBe(150);
    expect(clampVolume(-20)).toBe(0);
    expect(clampVolume(900)).toBe(200);
    expect(clampVolume(99.7)).toBe(99);
  });

  it('memakai 100 untuk nilai tidak masuk akal', () => {
    expect(clampVolume(Number.NaN)).toBe(100);
    expect(clampVolume(Number.POSITIVE_INFINITY)).toBe(100);
  });
});
