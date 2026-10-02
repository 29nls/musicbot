import { EmbedBuilder } from 'discord.js';
import { EMBED_COLORS } from '../../config/constants.js';
import type { AnonymizeOutcome } from './anonymize.js';
import { inventoryRows, type DataInventory } from './inventory.js';
import { MODERATION_RETENTION_YEARS, RETENTION_STATEMENTS } from './retention.js';

/**
 * Embed `/privacy`: inventaris data member + masa simpan + hal yang tidak
 * pernah disimpan.
 *
 * Isinya sengaja menampilkan angka **aslinya**, termasuk yang nol. Pernyataan
 * privasi yang ditulis sebagai "kami hanya menyimpan sedikit data" selalu bisa
 * dibaca sebagai "berarti sedikit sekali", padahal yang relevan bagi user
 * adalah "berapa yang sebenarnya disimpan tentang saya" — bukan seberapa
 * sedikit kata-katanya.
 */
export function privacyEmbed(inventory: DataInventory): EmbedBuilder {
  const rows = inventoryRows(inventory);

  return new EmbedBuilder()
    .setColor(EMBED_COLORS.primary)
    .setTitle(`🔒 Data yang disimpan Harmony tentang <@${inventory.userId}>`)
    .setDescription(
      [
        'Semua angka di bawah hanya berlaku untuk **server ini** dan bisa berbeda di server lain.',
        '',
        ...rows.map((row) => `• **${row.label}:** ${row.value}`),
      ].join('\n'),
    )
    .addFields({
      name: 'Masa simpan',
      value: RETENTION_STATEMENTS.map(
        (item) => `• **${item.label}** — ${item.days} hari (${item.since})`,
      ).join('\n'),
    })
    .addFields({
      name: 'Tidak pernah disimpan',
      value:
        [
          '• Isi voice atau video call — Harmony hanya melihat kamu bergabung/meninggalkan voice.',
          '• Isi pesan, kecuali ringkasan event yang masuk ke log server.',
          '• Data pribadi di luar Discord (nama asli, email, telepon) — Harmony tidak pernah memintanya.',
        ].join('\n'),
    })
    .setFooter({
      text: 'Untuk menghapus data yang disimpan tentangmu: /data-delete · hanya berlaku di server ini',
    })
    .setTimestamp();
}

/** Konfirmasi sebelum menjalankan: angka diproyeksikan, belum ada yang diubah. */
export function dataDeleteConfirmEmbed(inventory: DataInventory): EmbedBuilder {
  const rows = inventoryRows(inventory);

  return new EmbedBuilder()
    .setColor(EMBED_COLORS.warning)
    .setTitle('⚠️ Hapus data yang disimpan tentangmu?')
    .setDescription(
      [
        'Tindakan ini **tidak bisa dibatalkan** dan akan berlaku di server ini:',
        '',
        ...rows.map((row) => `• **${row.label}:** ${row.value}`),
        '',
        'Untuk melanjutkan, jalankan ulang dengan `confirm:true`.',
      ].join('\n'),
    )
    .setFooter({ text: `Retensi normal: ${MODERATION_RETENTION_YEARS} tahun — penghapusan ini lebih cepat` })
    .setTimestamp();
}

/**
 * Hasil `/data-delete`.
 *
 * Embed ini juga menyatakan **apa yang masih ada** setelah permintaan
 * berjalan. Diam-diam menyisakan jejak yang tidak disebut akan membuat user
 * mengira permintaannya tuntas padahal tidak — dan itu yang membuat perintah
 * seperti ini kehilangan makna.
 */
export function dataDeleteEmbed(outcome: AnonymizeOutcome): EmbedBuilder {
  const touched = outcome.cases + outcome.warnings + outcome.tickets + outcome.logEntries;

  return new EmbedBuilder()
    .setColor(EMBED_COLORS.success)
    .setTitle('✅ Permintaan penghapusan data diproses')
    .setDescription(
      [
        touched === 0
          ? 'Tidak ada data yang tersimpan tentangmu di server ini.'
          : [
              `**Yang dihapus:**`,
              `• Identitas kamu pada ${outcome.cases} kasus, ${outcome.warnings} peringatan, dan ${outcome.tickets} tiket`,
              outcome.transcripts > 0
                ? `• Isi ${outcome.transcripts} transkrip percakapan tiket`
                : '• Tidak ada transkrip percakapan yang perlu dihapus',
              `• ${outcome.logEntries} entri log yang menyebut kamu`,
              '',
              '**Yang dibuang isinya tapi strukturnya tetap:** alasan kasus, catatan internal, dan topik tiket — diganti penanda otomatis.',
            ].join('\n'),
        '',
        'Yang **tidak** ikut dihapus: kerangka kasusnya (tipe aksi, waktu, moderator yang bertindak). Ini supaya keputusan moderasi berikutnya tidak berjalan tanpa konteks, dan tidak lagi bisa dikaitkan dengan dirimu.',
        'Tindakan yang **kamu** lakukan sebagai moderator juga tidak ikut berubah — itu catatan tanggung jawabmu di server ini.',
      ].join('\n'),
    )
    .setFooter({
      text: `Pseudonim: ${outcome.pseudonym} · data di server lain tidak tersentuh`,
    })
    .setTimestamp();
}

/** Baris ringkas untuk log channel: siapa, untuk siapa, dan berapa yang tersentuh. */
export function dataDeleteLogLine(input: {
  actorId: string;
  targetId: string;
  outcome: AnonymizeOutcome;
}): string {
  const { outcome } = input;
  const self = input.actorId === input.targetId;

  return (
    `${self ? 'Permintaan penghapusan data mandiri' : 'Permintaan penghapusan data atas nama user lain'} ` +
    `oleh <@${input.actorId}> · ` +
    `${outcome.cases} kasus, ${outcome.warnings} peringatan, ${outcome.tickets} tiket, ` +
    `${outcome.transcripts} transkrip, ${outcome.logEntries} log · ${outcome.pseudonym}`
  );
}

/**
 * Embed untuk channel log server.
 *
 * Separate dari embed yang dilihat member: yang ini untuk owner server, jadi
 * isinya yang penting adalah **siapa yang meminta** — member yang menghapus
 * datanya sendiri wajar, owner server yang menghapus atas nama orang lain
 * adalah tindakan yang harus terlihat.
 */
export function dataDeleteLogEmbed(input: {
  actorId: string;
  targetId: string;
  outcome: AnonymizeOutcome;
}): EmbedBuilder {
  const { outcome } = input;
  const self = input.actorId === input.targetId;

  return new EmbedBuilder()
    .setColor(EMBED_COLORS.warning)
    .setTitle(
      self
        ? '🔒 Permintaan Penghapusan Data Mandiri'
        : '🔒 Permintaan Penghapusan Data Atas Nama User Lain',
    )
    .setDescription(
      [
        dataDeleteLogLine(input),
        '',
        `• Kasus dianonimkan: \`${outcome.cases}\``,
        `• Peringatan dianonimkan: \`${outcome.warnings}\``,
        `• Tiket dianonimkan: \`${outcome.tickets}\` · transkrip dihapus: \`${outcome.transcripts}\``,
        `• Entri log dihapus: \`${outcome.logEntries}\``,
        '',
        'Kerangka kasus (tipe, waktu, moderator) sengaja disimpan; isi & identitasnya dilepas.',
      ].join('\n'),
    )
    .addFields({ name: 'Diminta oleh', value: `<@${input.actorId}>`, inline: true })
    .addFields({ name: 'Untuk', value: `<@${input.targetId}>`, inline: true })
    .setFooter({ text: `Pseudonim: ${outcome.pseudonym}` })
    .setTimestamp();
}
