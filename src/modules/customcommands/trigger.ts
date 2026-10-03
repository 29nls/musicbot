/**
 * Pemicu & render custom command — murni, tanpa Discord.
 *
 * Dipisah dari sisanya karena dua hal ini menentukan perilaku yang dilihat member:
 * kapan sebuah pesan dianggap pemicu (dan kapan sama sekali bukan), serta
 * apa yang sebenarnya terkirim setelah placeholder diganti.
 */

import { PLACEHOLDER_TOKENS, TRIGGER_PREFIX } from './types.js';

export interface ParsedTrigger {
  /** Nama perintah tanpa `!`, sudah huruf kecil. */
  name: string;
  /** Sisa pesan setelah nama — inilah yang mengisi `{args}`. */
  args: string;
}

export interface ParseTriggerOptions {
  prefix?: string;
  /** ID bot; kalau ada, mention `!nama` juga dikenali. */
  botId?: string | null;
}

/** Samarkan mention bot di awal pesan: `<@123>` dan `<@!123>`. */
function stripBotMention(content: string, botId: string | null | undefined): string {
  if (!botId) return content;

  return content.replace(new RegExp(`^<@!?${botId}>\\s*`), '').trim();
}

/**
 * Baca isi pesan dan putuskan apakah itu pemicu perintah custom.
 *
 * Mengembalikan `null` untuk semua yang bukan pemicu — dan itulah majority
 * dari semua pesan di server mana pun. Karena itu pemeriksaan ini harus murahan
 * dan tidak menyentuh database sama sekali: harga salah membaca di sini bukan
 * satu pesan keliru, tapi satu query untuk setiap pesan yang masuk.
 */
export function parseTrigger(content: string, options: ParseTriggerOptions = {}): ParsedTrigger | null {
  const prefix = options.prefix ?? TRIGGER_PREFIX;
  const trimmed = stripBotMention(content, options.botId);

  if (!prefix || !trimmed.startsWith(prefix)) return null;

  const rest = trimmed.slice(prefix.length).trim();
  if (rest.length === 0) return null;

  const separator = rest.search(/\s/);
  const rawName = separator === -1 ? rest : rest.slice(0, separator);
  const args = separator === -1 ? '' : rest.slice(separator).trim();
  const name = rawName.toLocaleLowerCase('id');

  // `!halo!dunia` bukan pemicu, dan `!1234` juga bukan: keduanya akan
  // diteruskan ke database hanya untuk mendapat jawaban yang tidak pernah
  // dibaca siapa pun.
  if (!/^[a-z][a-z0-9_-]*$/.test(name)) return null;

  return { name, args };
}

export interface RenderContext {
  userId: string;
  username: string;
  guildName: string;
  channelId: string;
  args: string;
}

/** Nilai tiap placeholder dalam balasan. */
export function placeholderValues(context: RenderContext): Record<string, string> {
  return {
    '{pengguna}': `<@${context.userId}>`,
    '{nama}': context.username,
    '{server}': context.guildName,
    '{channel}': `<#${context.channelId}>`,
    '{args}': context.args,
  };
}

/**
 * Ganti placeholder dengan nilai sebenarnya.
 *
 * Placeholder yang tidak dikenal **dibiarkan apa adanya**, bukan dibuang:
 * admin yang menulis `{discord}` dan melihatnya utuh di pesan jauh lebih mudah
 * menemukan salahnya daripada melihat teksnya hilang diam-diam.
 */
export function renderResponse(template: string, context: RenderContext): string {
  const values = placeholderValues(context);

  return Object.entries(values)
    .reduce((text, [token, value]) => text.split(token).join(value), template)
    .trim();
}

/** Placeholder yang dipakai di balasan, untuk ditampilkan di `/customcommand show`. */
export const PLACEHOLDER_HELP: Array<{ token: string; label: string }> = [
  { token: PLACEHOLDER_TOKENS[0], label: 'mention pemanggil' },
  { token: PLACEHOLDER_TOKENS[1], label: 'nama pengguna pemanggil' },
  { token: PLACEHOLDER_TOKENS[2], label: 'nama server ini' },
  { token: PLACEHOLDER_TOKENS[3], label: 'mention channel tempat dipanggil' },
  { token: PLACEHOLDER_TOKENS[4], label: 'teks setelah nama perintah' },
];

/** Balasan yang utuh setelah dirender tidak boleh kosong; kalau kosong, bot diam. */
export function renderedMessage(response: string, context: RenderContext): string | null {
  const rendered = renderResponse(response, context);
  return rendered.length > 0 ? rendered : null;
}