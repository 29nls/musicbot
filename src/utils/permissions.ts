import { PermissionFlagsBits, type ChatInputCommandInteraction } from 'discord.js';

/**
 * Satu definisi untuk "apakah anggota ini punya izin bit ini".
 *
 * **Kenapa helper-nya, bukan hanya `canManageGuild`.** Aturan yang sama —
 * baca `memberPermissions`, dan anggap tidak ada sebagai "tidak punya" —
 * sebelumnya ditulis di lima tempat: helper ini, gerbang perintah admin,
 * `/data-delete`, `/privacy`, dan gerbang musik yang bahkan menamai variabel
 * lokalnya `canManageGuild` sama persis dengan helper aslinya. Dua nama yang
 * sama untuk satu aturan berarti memperbaiki satu tempat tidak memperbaiki
 * yang lain, dan tidak ada yang bisa mengetahuinya.
 *
 * **`memberPermissions` yang hilang berarti "tidak punya", bukan "boleh".**
 * Interaksi di luar guild tidak punya izin sama sekali, dan `?? false` ada
 * supaya-kalimat itu ditulis eksplisit di satu tempat. Menghilangkannya
 * berarti DM bisa melewati gerbang yang seharusnya menutupnya.
 */
export function hasGuildPermission(
  interaction: ChatInputCommandInteraction,
  bit: bigint,
): boolean {
  return interaction.memberPermissions?.has(bit) ?? false;
}

/**
 * Cek izin "Manage Server" di sisi bot.
 *
 * Discord sudah menyembunyikan perintah yang punya `setDefaultMemberPermissions`,
 * tapi server bisa menimpanya — jadi perintah tetap memverifikasi sendiri.
 *
 * Menempel pada `hasGuildPermission` alih-alih menulis ulang pembacaannya:
 * ini spesialisasinya, bukan aturan kedua.
 */
export function canManageGuild(interaction: ChatInputCommandInteraction): boolean {
  return hasGuildPermission(interaction, PermissionFlagsBits.ManageGuild);
}
