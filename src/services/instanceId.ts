import { randomUUID } from 'node:crypto';

/**
 * Identitas proses untuk lease di store bersama.
 *
 * Satu ID per proses, dibuat saat pertama kali dibutuhkan, dan tidak pernah
 * dipublikasikan. Yang penting bukan nilainya, melainkan kestabilannya: ID yang
 * berubah tiap panggilan membuat lease selalu terbaca "dimiliki orang lain",
 * jadi tidak ada satu pun lease yang pernah bisa diperpanjang.
 *
 * Dipakai oleh dua hal yang sama-sama butuh "ini proses saya, bukan proses
 * lain": lease kepemilikan player (§5.3) dan lease sapuan job global.
 */

let cached: string | undefined;

/** ID proses ini. Stabil selama proses hidup. */
export function processInstanceId(): string {
  cached ??= randomUUID();
  return cached;
}

/** Buang ID tersimpan (dipakai tes yang ingin proses baru). */
export function resetProcessInstanceId(): void {
  cached = undefined;
}