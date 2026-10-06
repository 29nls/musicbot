import {
  botPermissionDeps,
  getBotGuilds,
  getUserGuilds,
} from '@/lib/discord.js';
import { getEnv } from '@/lib/env.js';
import { DEV_PERMISSION_DEPS, devFixturesEnabled, devUserGuilds } from '@/lib/devFixtures.js';
import { checkManageGuild, type PermissionVerdict } from '@/lib/permissions.js';

/**
 * Daftar server yang benar-benar bisa diubah, beserta status izinnya.
 *
 * **Tiga sumber, tiga pertanyaan berbeda.**
 *
 * - `GET /users/@me/guilds` dengan token OAuth menjawab "server mana yang kamu ikuti".
 * - `GET /users/@me/guilds` dengan token bot menjawab "server mana yang bot-nya ada".
 * - `GET /guilds/{id}/members/{userId}` dengan token bot menjawab "kamu masih punya izin".
 *
 * **Kenapa irisan dua yang pertama wajib.** Tanpa keberadaan bot, konfigurasi yang
 * tampil tidak dibaca proses mana pun, jadi dashboard akan menampilkan pengaturan
 * untuk server tempat Harmony tidak ada. Itu lebih buruk dari tidak menampilkan
 * apa-apa, karena kelihatannya meyakinkan.
 *
 * **Kenapa izin dicek satu per satu, bukan dari payload OAuth.** `permissions` di
 * payload OAuth adalah snapshot saat token diterbitkan; bisa basi dan tidak bisa
 * diperbarui tanpa memaksa login ulang. Yang dipakai adalah sumber yang sama
 * dengan penulisan, supaya daftar dan penulisan tidak pernah berbeda pendapat.
 *
 * **Status `unknown` tidak boleh disembunyikan** jadi `denied` maupun `allowed`:
 * yang pertama menuduh, yang kedua berbahaya. Ketiganya tampil apa adanya, dan
 * hanya `allowed` yang punya tautan ke halaman pengaturan.
 */

export interface GuildOption {
  id: string;
  name: string;
  icon: string | null;
  verdict: PermissionVerdict;
}

/**
 * `null` berarti Discord tidak menjawab. Penyerang tidak boleh membacanya sebagai
 * "tidak ada server" — pemanggil membedakan "tidak ada" dari "tidak tahu".
 */
export async function listManageableGuilds(
  accessToken: string,
  userId: string,
): Promise<GuildOption[] | null> {
  const permissionDeps = devFixturesEnabled() ? DEV_PERMISSION_DEPS : botPermissionDeps(getEnv().DISCORD_TOKEN);

  if (devFixturesEnabled()) {
    return devUserGuilds().map((guild) => ({
      id: guild.id,
      name: guild.name,
      icon: guild.icon,
      verdict: 'allowed' as const,
    }));
  }

  const [userGuilds, botGuilds] = await Promise.all([
    getUserGuilds(accessToken),
    getBotGuilds(getEnv().DISCORD_TOKEN),
  ]);

  if (!userGuilds || !botGuilds) return null;

  const botIds = new Set(botGuilds.map((guild) => guild.id));

  const options: GuildOption[] = [];
  for (const guild of userGuilds) {
    if (!botIds.has(guild.id)) continue;

    options.push({
      id: guild.id,
      name: guild.name,
      icon: guild.icon,
      verdict: await checkManageGuild(permissionDeps, guild.id, userId),
    });
  }

  // `Array.prototype.sort` stabil sejak ES2019, jadi kunci kedua (nama) membuat
  // urutannya sama di dua render dan tidak berganti-ganti di depan mata user.
  return options.sort(
    (left, right) => rank(left.verdict) - rank(right.verdict) || left.name.localeCompare(right.name),
  );
}

function rank(verdict: PermissionVerdict): number {
  if (verdict === 'allowed') return 0;
  if (verdict === 'unknown') return 1;

  return 2;
}