import type { EmbedBuilder } from 'discord.js';
import { MAX_LOG_SUMMARY_LENGTH } from './types.js';

/** Ringkas satu baris (dipakai saat insert). */
export function clampLogSummary(value: string): string {
  const flat = value.replace(/\s+/g, ' ').trim();

  return flat.length > MAX_LOG_SUMMARY_LENGTH
    ? `${flat.slice(0, MAX_LOG_SUMMARY_LENGTH - 1)}…`
    : flat;
}

/**
 * Ringkasan yang bisa dicari dari isi embed: deskripsi + seluruh nilai field.
 * Ini yang membuat `from`/kata kunci di `/logs` menemukan isi pesan, alasan,
 * dan nama channel/channel tujuan tanpa menyimpan embed-nya.
 */
export function buildLogSummary(embed: EmbedBuilder): string {
  const parts: string[] = [];

  if (embed.data.description) parts.push(embed.data.description);

  for (const field of embed.data.fields ?? []) {
    parts.push(`${field.name}: ${field.value}`);
  }

  return clampLogSummary(parts.join(' · '));
}
