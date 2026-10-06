/**
 * Otorisasi: siapa yang boleh mengubah konfigurasi sebuah server.
 *
 * **Kenapa dicek ulang tiap permintaan, bukan sekali saat login.** Izin Discord
 * bisa dicabut kapan saja, sedangkan sesi dashboard hidup sampai tujuh hari.
 * Kalau izin hanya diperiksa saat login, orang yang sudah kehilangan jabatan
 * tetap bisa menulis selama sesinya belum habis.
 *
 * **Kenapa lewat token bot, bukan token OAuth user.** Payload OAuth membawa
 * `permissions`, tapi itu nilai saat token diterbitkan — bisa basi, dan tidak
 * ada cara memperbaruinya tanpa memaksa login ulang. Sumber kebenarannya adalah
 * REST Discord dengan token bot, yang memang sudah dimiliki proyek ini.
 *
 * **Kenapa `GET /guilds/{id}/members/{userId}` saja tidak cukup.** Endpoint itu
 * mengembalikan daftar role member, bukan izin. Izin dihitung dari role:
 * `@everyone` + role member, ditambah aturan `owner` dan `ADMINISTRATOR`. Itu
 * yang dilakukan `computeGuildPermissions` di bawah, dan itulah bagian yang
 * diuji tanpa jaringan.
 */

/** Bit MANAGE_GUILD. */
export const PERMISSION_MANAGE_GUILD = 1n << 5n;
/** Bit ADMINISTRATOR — di Discord berarti semua izin. */
export const PERMISSION_ADMINISTRATOR = 1n << 3n;

export type PermissionVerdict = 'allowed' | 'denied' | 'unknown';

export interface RoleLike {
  id: string;
  /** Bitfield izin sebagai string desimal; Discord mengirimnya sebagai string. */
  permissions: string;
}

export interface PermissionInput {
  guildId: string;
  userId: string;
  ownerId: string;
  roles: readonly RoleLike[];
  memberRoleIds: readonly string[];
}

function toBigInt(value: string): bigint {
  try {
    return BigInt(value);
  } catch {
    return 0n;
  }
}

/**
 * Izin efektif seorang member di satu guild.
 *
 * Urutannya seperti aturan Discord: `@everyone` (role dengan id = guildId)
 * selalu ikut, role member menambah, `ADMINISTRATOR` berarti semua izin, dan
 * owner guild tidak perlu izin apa pun. Angka yang tidak bisa diurai dihitung
 * sebagai 0 — bukan sebagai "semua izin", karena arah aman untuk otorisasi
 * adalah menolak.
 */
export function computeGuildPermissions(input: PermissionInput): bigint {
  if (input.userId === input.ownerId) return ~0n;

  const memberRoles = new Set(input.memberRoleIds);
  memberRoles.add(input.guildId); // @everyone

  let permissions = 0n;
  for (const role of input.roles) {
    if (!memberRoles.has(role.id)) continue;
    permissions |= toBigInt(role.permissions);
  }

  if ((permissions & PERMISSION_ADMINISTRATOR) !== 0n) return ~0n;

  return permissions;
}

export function canManageGuild(input: PermissionInput): boolean {
  return (computeGuildPermissions(input) & PERMISSION_MANAGE_GUILD) !== 0n;
}

/** Jawaban REST minimal yang dibutuhkan; hanya bagian yang dipakai disebut. */
export interface GuildRoleResponse {
  id: string;
  permissions: string;
}

export interface GuildResponse {
  id: string;
  owner_id: string;
  roles: GuildRoleResponse[];
}

export interface MemberResponse {
  user?: { id: string };
  roles: string[];
}

/** Cara mengambil sesuatu dari Discord; disuntik supaya bisa diuji tanpa jaringan. */
export interface PermissionDeps {
  getGuild(guildId: string): Promise<GuildResponse | null>;
  getMember(guildId: string, userId: string): Promise<MemberResponse | null>;
}

/**
 * Periksa izin Manage Server untuk satu guild.
 *
 * `null` dari deps berarti "tidak bisa dipastikan" — 404 (membernya memang tidak
 * ada) dan 403/500 (token bot tidak bisa melihat guild itu) tidak dibedakan di
 * sini, tapi konsekuensinya sama untuk pemanggil: jangan menulis. Bedanya,
 * `denied` dan `unknown` diberi nama berbeda supaya UI bisa menjelaskan
 * ("Anda tidak punya izin" vs "izin tidak bisa diverifikasi sekarang").
 */
export async function checkManageGuild(
  deps: PermissionDeps,
  guildId: string,
  userId: string,
): Promise<PermissionVerdict> {
  const guild = await deps.getGuild(guildId);
  if (!guild) return 'unknown';

  const member = await deps.getMember(guildId, userId);
  if (!member) return 'denied';

  return canManageGuild({
    guildId,
    userId,
    ownerId: guild.owner_id,
    roles: guild.roles,
    memberRoleIds: member.roles,
  })
    ? 'allowed'
    : 'denied';
}
