export const DEFAULT_WELCOME_MESSAGE =
  '👋 Selamat datang {mention} di **{server}**! Kamu member ke-**{count}**.';

export const DEFAULT_GOODBYE_MESSAGE = '👋 **{user}** meninggalkan **{server}**. Sekarang **{count}** member.';

export interface GreetingContext {
  userId: string;
  userTag: string;
  serverName: string;
  memberCount: number;
}

/**
 * Isi placeholder pesan welcome/goodbye.
 * Placeholder yang didukung: `{user}` `{mention}` `{server}` `{count}`.
 */
export function renderGreeting(template: string, context: GreetingContext): string {
  return template
    .replaceAll('{user}', context.userTag)
    .replaceAll('{mention}', `<@${context.userId}>`)
    .replaceAll('{server}', context.serverName)
    .replaceAll('{count}', String(context.memberCount));
}

/** Pesan yang dipakai kalau server belum mengatur teks kustom. */
export function greetingTemplate(template: string | null, fallback: string): string {
  return template && template.trim().length > 0 ? template : fallback;
}
