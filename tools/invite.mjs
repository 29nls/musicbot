// Mencetak URL undangan OAuth2 untuk bot Harmony.
//
// Kenapa file ini ada: OAuth2 URL Generator di portal butuh angka
// izin yang tepat. Angka itu rapuh — salah satu bit berarti satu fitur tidak
// jalan dengan pesan yang membingungkan (mis. "Manage Roles" untuk autorole).
// Daftar izin di bawah diambil dari kode, bukan dari tebakan:
//
//   src/commands/admin/_shared.ts  -> ban/unban, kick, timeout/warn, slowmode,
//                                    lock/unlock, purge
//   setDefaultMemberPermissions    -> /config, /automod, /logging, /logs,
//                                    /customcommand, /reactionrole, /ticket
//   ReactionRole + welcome         -> Manage Roles
//   Logging                        -> View Channel, Send Messages, Embed Links,
//                                    Read Message History
//   Musik                          -> Connect, Speak
//
// Reaction Role memakai StringSelectMenu (menu tombol), bukan reaction emoji.
// Jadi AddReactions sengaja tidak ada di daftar ini: kode tidak pernah memanggil
// reaction.add/remove, jadi izin itu cuma menambah peringatan di layar izin.
// Administrator juga sengaja TIDAK dipakai: izinnya memberi segalanya sekaligus,
// termasuk menghapus channel dan menguras role server.
//
// Pakai: npm run invite

import { PermissionFlagsBits } from 'discord.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Izin yang dibutuhkan, urut dari yang paling ringan. */
const REQUIRED_PERMISSIONS = [
  ['ViewChannel', 'baca channel: pesan, Reaction Role, panel tiket'],
  ['SendMessages', 'kirim embed: balasan perintah, log, pengumuman'],
  ['EmbedLinks', 'embed Discord memblokir embed tanpa izin ini'],
  ['ReadMessageHistory', 'baca pesan untuk logging dan pencarian /logs'],
  ['AttachFiles', 'unggah ekspor /logs dan transkrip tiket'],
  ['KickMembers', '/kick'],
  ['BanMembers', '/ban dan /unban'],
  ['ModerateMembers', '/timeout, /warn, /note, kasus'],
  ['ManageMessages', '/purge'],
  ['ManageChannels', '/slowmode, /lock, /unlock, kanal tiket'],
  ['ManageRoles', 'welcome autorole dan Reaction Role'],
  ['ManageGuild', 'perintah admin server (/config, /automod, /logging, ...)'],
  ['Connect', 'masuk voice channel untuk musik'],
  ['Speak', 'bicara di voice channel'],
];

function readClientId() {
  let text;
  try {
    text = fs.readFileSync(path.join(ROOT, '.env'), 'utf8');
  } catch {
    return undefined;
  }

  const match = text.match(/^DISCORD_CLIENT_ID=(.*)$/m);
  const value = match?.[1].trim();
  return value && value !== '' ? value : undefined;
}

const clientId = process.env.DISCORD_CLIENT_ID ?? readClientId();
if (!clientId) {
  console.error(
    '\nGagal: DISCORD_CLIENT_ID belum diisi.\n' +
      'Salin .env.example menjadi .env lalu isi DISCORD_CLIENT_ID\n' +
      '(Developer Portal -> General Information -> Application ID).\n',
  );
  process.exit(1);
}

let permissions = 0n;
const lines = [];
for (const [name, reason] of REQUIRED_PERMISSIONS) {
  const bit = PermissionFlagsBits[name];
  if (bit === undefined) {
    console.error('Gagal: izin ' + name + ' tidak dikenal oleh discord.js yang terpasang.');
    process.exit(1);
  }
  permissions |= BigInt(bit);
  lines.push('  ' + name.padEnd(20) + ' untuk ' + reason);
}

const url =
  'https://discord.com/oauth2/authorize' +
  '?client_id=' + encodeURIComponent(clientId) +
  '&permissions=' + permissions.toString() +
  '&scope=bot%20applications.commands';

console.log('\nIzin yang diminta (' + REQUIRED_PERMISSIONS.length + '):');
console.log(lines.join('\n'));
console.log('\nBot Permissions Integer untuk OAuth2 URL Generator:');
console.log('  ' + permissions.toString() + '\n');
console.log('Scope (pilih dua, berurutan):');
console.log('  bot');
console.log('  applications.commands\n');
console.log('Atau langsung pakai URL ini:\n');
console.log('  ' + url + '\n');
console.log('Setelah bot diundang, jalankan `npm run deploy` dengan DEV_GUILD_ID');
console.log('diisi supaya slash command muncul seketika di server itu.\n');