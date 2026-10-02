import { PermissionFlagsBits, type ChatInputCommandInteraction } from 'discord.js';

/**
 * Cek izin "Manage Server" di sisi bot.
 *
 * Discord sudah menyembunyikan perintah yang punya `setDefaultMemberPermissions`,
 * tapi server bisa menimpanya — jadi perintah tetap memverifikasi sendiri.
 */
export function canManageGuild(interaction: ChatInputCommandInteraction): boolean {
  return interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) ?? false;
}
