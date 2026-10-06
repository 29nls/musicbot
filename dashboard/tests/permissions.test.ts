import { describe, expect, it } from 'vitest';
import {
  PERMISSION_ADMINISTRATOR,
  PERMISSION_MANAGE_GUILD,
  canManageGuild,
  checkManageGuild,
  computeGuildPermissions,
} from '@/lib/permissions.js';

const GUILD = '111111111111111111';
const OWNER = '300000000000000003';
const MANAGER = '400000000000000004';
const MEMBER = '500000000000000005';
const OUTSIDER = '600000000000000006';

const DJ_ROLE = '700000000000000007';
const ADMIN_ROLE = '800000000000000008';
const VIEW_ROLE = '900000000000000009';

/** Bit View Channel; dipakai untuk membuktikan @everyone ikut dihitung. */
const PERMISSION_VIEW_CHANNEL = 1n << 10n;

describe('perhitungan izin mengikuti aturan Discord', () => {
  const roles = [
    { id: GUILD, permissions: String(PERMISSION_VIEW_CHANNEL) },
    { id: DJ_ROLE, permissions: String(PERMISSION_MANAGE_GUILD) },
    { id: ADMIN_ROLE, permissions: String(PERMISSION_ADMINISTRATOR) },
    { id: VIEW_ROLE, permissions: '1024' },
  ];

  it('role @everyone selalu ikut, apa pun daftar role member', () => {
    const permissions = computeGuildPermissions({
      guildId: GUILD,
      userId: MEMBER,
      ownerId: OWNER,
      roles,
      memberRoleIds: [],
    });

    expect(permissions & PERMISSION_MANAGE_GUILD).toBe(0n);
  });

  it('satu role dengan Manage Server sudah cukup', () => {
    expect(
      canManageGuild({
        guildId: GUILD,
        userId: MANAGER,
        ownerId: OWNER,
        roles,
        memberRoleIds: [DJ_ROLE],
      }),
    ).toBe(true);
  });

  it('role yang bukan milik member TIDAK dihitung', () => {
    // Bug yang harus dicegah: menghitung izin dari daftar role guild tanpa
    // memfilter ke role yang benar-benar dipegang member akan memberi izin ke
    // siapa saja.
    expect(
      canManageGuild({
        guildId: GUILD,
        userId: MEMBER,
        ownerId: OWNER,
        roles,
        memberRoleIds: [],
      }),
    ).toBe(false);
  });

  it('owner tidak butuh role apa pun', () => {
    expect(
      canManageGuild({
        guildId: GUILD,
        userId: OWNER,
        ownerId: OWNER,
        roles,
        memberRoleIds: [],
      }),
    ).toBe(true);
  });

  it('Administrator berarti semua izin, termasuk Manage Server', () => {
    expect(
      canManageGuild({
        guildId: GUILD,
        userId: MEMBER,
        ownerId: OWNER,
        roles,
        memberRoleIds: [ADMIN_ROLE],
      }),
    ).toBe(true);
  });

  it('izin dari beberapa role digabung', () => {
    expect(
      computeGuildPermissions({
        guildId: GUILD,
        userId: MEMBER,
        ownerId: OWNER,
        roles,
        memberRoleIds: [VIEW_ROLE, DJ_ROLE],
      }) &
        PERMISSION_MANAGE_GUILD,
    ).not.toBe(0n);
  });
});

describe('data rusak tidak pernah berarti "punya izin"', () => {
  const roles = [{ id: GUILD, permissions: 'bukan-angka' }];

  it('permissions yang tidak bisa diurai dihitung sebagai nol', () => {
    // Arah aman untuk otorisasi adalah menolak. Mengambil `NaN` dan membandingkan
    // bit-nya akan menghasilkan jawaban yang tidak bisa diprediksi.
    expect(
      canManageGuild({
        guildId: GUILD,
        userId: MEMBER,
        ownerId: OWNER,
        roles,
        memberRoleIds: [GUILD],
      }),
    ).toBe(false);
  });

  it('permissions kosong tidak berarti semua izin', () => {
    expect(
      canManageGuild({
        guildId: GUILD,
        userId: MEMBER,
        ownerId: OWNER,
        roles: [{ id: GUILD, permissions: '' }],
        memberRoleIds: [],
      }),
    ).toBe(false);
  });
});

describe('checkManageGuild membedakan ditolak dan tidak diketahui', () => {
  const guild = {
    id: GUILD,
    owner_id: OWNER,
    roles: [
      { id: GUILD, permissions: '0' },
      { id: DJ_ROLE, permissions: String(PERMISSION_MANAGE_GUILD) },
    ],
  };

  it('allowed', async () => {
    const verdict = await checkManageGuild(
      {
        getGuild: async () => guild,
        getMember: async () => ({ user: { id: MANAGER }, roles: [DJ_ROLE] }),
      },
      GUILD,
      MANAGER,
    );

    expect(verdict).toBe('allowed');
  });

  it('denied saat member ada tapi tidak punya izin', async () => {
    const verdict = await checkManageGuild(
      {
        getGuild: async () => guild,
        getMember: async () => ({ user: { id: MEMBER }, roles: [] }),
      },
      GUILD,
      MEMBER,
    );

    expect(verdict).toBe('denied');
  });

  it('denied saat member tidak ada di guild itu (404)', async () => {
    const verdict = await checkManageGuild(
      { getGuild: async () => guild, getMember: async () => null },
      GUILD,
      OUTSIDER,
    );

    expect(verdict).toBe('denied');
  });

  it('unknown saat guild tidak bisa dibaca (403/404/5xx)', async () => {
    // `null` di sini berarti "tidak bisa dipastikan" — bot tidak ada di server,
    // token salah, atau Discord sedang tidak menjawab. Menolak menulis benar,
    // tapi pesannya harus berbeda supaya operator tahu itu sementara.
    const verdict = await checkManageGuild(
      { getGuild: async () => null, getMember: async () => null },
      GUILD,
      MANAGER,
    );

    expect(verdict).toBe('unknown');
  });

  it('unknown saat guild terbaca tapi member tidak bisa dibaca', async () => {
    const verdict = await checkManageGuild(
      { getGuild: async () => guild, getMember: async () => null },
      GUILD,
      MANAGER,
    );

    expect(verdict).toBe('denied');
  });

  it('member dengan roles kosong dan owner lain → denied', async () => {
    const verdict = await checkManageGuild(
      {
        getGuild: async () => guild,
        getMember: async () => ({ roles: [] }),
      },
      GUILD,
      MANAGER,
    );

    expect(verdict).toBe('denied');
  });

  it('izin dibaca ulang tiap panggilan, bukan di-cache', async () => {
    let calls = 0;
    const deps = {
      getGuild: async () => {
        calls += 1;

        return guild;
      },
      getMember: async () => ({ user: { id: MANAGER }, roles: [DJ_ROLE] }),
    };

    await checkManageGuild(deps, GUILD, MANAGER);
    await checkManageGuild(deps, GUILD, MANAGER);

    expect(calls).toBe(2);
  });
});