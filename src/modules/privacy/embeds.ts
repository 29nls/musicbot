import { EmbedBuilder } from 'discord.js';
import { EMBED_COLORS } from '../../config/constants.js';
import { defaultTranslator, type Translator } from '../i18n/index.js';
import type { AnonymizeOutcome } from './anonymize.js';
import { inventoryRows, type DataInventory } from './inventory.js';
import { MODERATION_RETENTION_YEARS, RETENTION_STATEMENTS } from './retention.js';

/**
 * Berapa banyak kelompok data yang benar-benar tersentuh satu permintaan.
 *
 * Semua kelompok ikut dihitung, termasuk playlist dan perintah custom: kalau
 * hanya kasus, peringatan, tiket, dan log yang dihitung, member yang punya
 * playlist tapi tidak punya kasus akan membaca "tidak ada data yang tersimpan"
 * **tepat setelah** kepemilikan playlist-nya dilepas.
 */
function touchedTotal(outcome: AnonymizeOutcome): number {
  return (
    outcome.cases +
    outcome.warnings +
    outcome.tickets +
    outcome.transcripts +
    outcome.logEntries +
    outcome.playlists +
    outcome.customCommands
  );
}

/** Baris inventaris yang ditulis ke `description`, dengan pemformat yang sama. */
function inventoryLines(inventory: DataInventory, t: Translator): string[] {
  return inventoryRows(inventory, t).map((row) => `• **${row.label}:** ${row.value}`);
}

/** Blok masa simpan; label & "sejak"-nya diterjemahkan, angkanya dari retention.ts. */
function retentionLines(t: Translator): string {
  return RETENTION_STATEMENTS.map((item) =>
    t('privacy.retention.line', {
      label: t(item.labelKey),
      days: String(item.days),
      since: t(item.sinceKey),
    }),
  ).join('\n');
}

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
export function privacyEmbed(
  inventory: DataInventory,
  t: Translator = defaultTranslator,
): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(EMBED_COLORS.primary)
    .setTitle(t('privacy.embed.title', { user: inventory.userId }))
    .setDescription(
      [t('privacy.embed.intro'), '', ...inventoryLines(inventory, t)].join('\n'),
    )
    .addFields({ name: t('privacy.embed.field.retention'), value: retentionLines(t) })
    .addFields({
      name: t('privacy.embed.field.neverStored'),
      value: [t('privacy.never.voice'), t('privacy.never.messages'), t('privacy.never.external')].join('\n'),
    })
    .setFooter({ text: t('privacy.embed.footer') })
    .setTimestamp();
}

/** Konfirmasi sebelum menjalankan: angka diproyeksikan, belum ada yang diubah. */
export function dataDeleteConfirmEmbed(
  inventory: DataInventory,
  t: Translator = defaultTranslator,
): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(EMBED_COLORS.warning)
    .setTitle(t('privacy.confirm.title'))
    .setDescription(
      [
        t('privacy.confirm.intro'),
        '',
        ...inventoryLines(inventory, t),
        '',
        t('privacy.confirm.hint'),
      ].join('\n'),
    )
    .setFooter({
      // Dua kunci, bukan satu: "1 years" bukan bahasa Inggris, dan Bahasa
      // Indonesia tidak punya masalah jamak yang sama.
      text: t(
        MODERATION_RETENTION_YEARS === 1
          ? 'privacy.confirm.footerOne'
          : 'privacy.confirm.footerMany',
        { years: String(MODERATION_RETENTION_YEARS) },
      ),
    })
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
export function dataDeleteEmbed(
  outcome: AnonymizeOutcome,
  t: Translator = defaultTranslator,
): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(EMBED_COLORS.success)
    .setTitle(t('privacy.done.title'))
    .setDescription(
      [
        touchedTotal(outcome) === 0
          ? t('privacy.done.nothing')
          : [
              t('privacy.done.removedHeader'),
              t('privacy.done.identityLine', {
                cases: String(outcome.cases),
                warnings: String(outcome.warnings),
                tickets: String(outcome.tickets),
              }),
              outcome.transcripts > 0
                ? t('privacy.done.transcriptsLine', { count: String(outcome.transcripts) })
                : t('privacy.done.noTranscripts'),
              t('privacy.done.logsLine', { count: String(outcome.logEntries) }),
              t('privacy.done.playlistsLine', { count: String(outcome.playlists) }),
              t('privacy.done.customCommandsLine', { count: String(outcome.customCommands) }),
              '',
              t('privacy.done.keptContent'),
            ].join('\n'),
        '',
        t('privacy.done.keptCaseFrame'),
        t('privacy.done.keptModerator'),
      ].join('\n'),
    )
    .setFooter({ text: t('privacy.done.footer', { pseudonym: outcome.pseudonym }) })
    .setTimestamp();
}

/** Baris ringkas untuk log channel: siapa, untuk siapa, dan berapa yang tersentuh. */
export function dataDeleteLogLine(
  input: { actorId: string; targetId: string; outcome: AnonymizeOutcome },
  t: Translator = defaultTranslator,
): string {
  const { outcome } = input;
  const self = input.actorId === input.targetId;

  return t('privacy.log.line', {
    kind: t(self ? 'privacy.log.lineSelf' : 'privacy.log.lineOther'),
    actor: input.actorId,
    cases: String(outcome.cases),
    warnings: String(outcome.warnings),
    tickets: String(outcome.tickets),
    transcripts: String(outcome.transcripts),
    logs: String(outcome.logEntries),
    pseudonym: outcome.pseudonym,
  });
}

/**
 * Embed untuk channel log server.
 *
 * Separate dari embed yang dilihat member: yang ini untuk owner server, jadi
 * isinya yang penting adalah **siapa yang meminta** — member yang menghapus
 * datanya sendiri wajar, owner server yang menghapus atas nama orang lain
 * adalah tindakan yang harus terlihat.
 */
export function dataDeleteLogEmbed(
  input: { actorId: string; targetId: string; outcome: AnonymizeOutcome },
  t: Translator = defaultTranslator,
): EmbedBuilder {
  const { outcome } = input;
  const self = input.actorId === input.targetId;

  return new EmbedBuilder()
    .setColor(EMBED_COLORS.warning)
    .setTitle(t(self ? 'privacy.log.titleSelf' : 'privacy.log.titleOther'))
    .setDescription(
      [
        dataDeleteLogLine(input, t),
        '',
        t('privacy.log.casesField', { count: String(outcome.cases) }),
        t('privacy.log.warningsField', { count: String(outcome.warnings) }),
        t('privacy.log.ticketsField', {
          tickets: String(outcome.tickets),
          transcripts: String(outcome.transcripts),
        }),
        t('privacy.log.logsField', { count: String(outcome.logEntries) }),
        t('privacy.log.playlistsField', { count: String(outcome.playlists) }),
        t('privacy.log.customCommandsField', { count: String(outcome.customCommands) }),
        '',
        t('privacy.log.keptNote'),
      ].join('\n'),
    )
    .addFields({
      name: t('privacy.log.field.requestedBy'),
      value: `<@${input.actorId}>`,
      inline: true,
    })
    .addFields({ name: t('privacy.log.field.for'), value: `<@${input.targetId}>`, inline: true })
    .setFooter({ text: t('privacy.log.footer', { pseudonym: outcome.pseudonym }) })
    .setTimestamp();
}