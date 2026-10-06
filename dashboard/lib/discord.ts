import { createHash, randomBytes } from 'node:crypto';
import type { GuildResponse, MemberResponse, PermissionDeps } from './permissions.js';

/**
 * Pembungkus REST Discord.
 *
 * Dua token dipakai di sini, dan bedanya penting:
 *
 * - **Token OAuth user** (dari alur login) hanya untuk hal-hal yang memang milik
 *   user: siapa dia, dan server apa saja yang dia ikuti. Tidak pernah untuk
 *   memeriksa izin atau menulis.
 * - **Token bot** untuk semua yang menyangkut keadaan server: daftar channel,
 *   daftar role, dan keadaan member. Bot sudah ada di server itu, jadi inilah
 *   sumber yang benar.
 *
 * Seluruh panggilan terjadi di server (route handler / server component). Tidak
 * ada token yang pernah dikirim ke peramban, dan tidak ada `NEXT_PUBLIC_` untuk
 * nilai rahasia.
 */

const API = 'https://discord.com/api/v10';

export class DiscordError extends Error {
  constructor(
    public readonly status: number,
    public readonly path: string,
    message?: string,
  ) {
    super(message ?? `Discord ${status} saat ${path}`);
    this.name = 'DiscordError';
  }
}

export interface DiscordRequestOptions {
  token: string;
  /** 'Bot' untuk token bot, 'Bearer' untuk token OAuth user. */
  scheme: 'Bot' | 'Bearer';
  method?: string;
  body?: unknown;
  /** Batas waktu; Discord yang tidak menjawab tidak boleh menahan halaman. */
  timeoutMs?: number;
}

/**
 * Satu permintaan ke Discord.
 *
 * 401/403/404 dikembalikan sebagai `null`, bukan exception: bagi pemanggil,
 * "tidak ada" dan "tidak boleh dilihat" sama-sama berarti jangan menulis, dan
 * membedakannya di lapisan ini hanya menambah cabang yang tidak dipakai.
 * Kegagalan lain (5xx, jaringan) tetap dilempar supaya tidak diam-diam jadi
 * "tidak boleh".
 */
export async function discordRequest<T>(
  path: string,
  options: DiscordRequestOptions,
): Promise<T | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 8_000);

  try {
    const response = await fetch(`${API}${path}`, {
      method: options.method ?? 'GET',
      headers: {
        Authorization: `${options.scheme} ${options.token}`,
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
      cache: 'no-store',
    });

    if ([401, 403, 404].includes(response.status)) return null;
    if (!response.ok) {
      throw new DiscordError(response.status, path, `Discord ${response.status}: ${await response.text()}`);
    }

    return (await response.json()) as T;
  } finally {
    clearTimeout(timeout);
  }
}

// ── OAuth2 + PKCE ─────────────────────────────────────────────────────────────

export function createCodeVerifier(): string {
  return randomBytes(32).toString('base64url');
}

export function createCodeChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

export function createState(): string {
  return randomBytes(16).toString('base64url');
}

export interface AuthorizeUrlOptions {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
}

/**
 * URL otorisasi Discord.
 *
 * `scope=identify guilds` sengaja sesempit itu: `identify` untuk tahu siapa
 * yang login, `guilds` untuk menampilkan daftar server yang dia ikuti. Tidak ada
 * `email`, tidak ada `connections`, dan tidak ada `bot` — dashboard tidak butuh
 * menambahkan bot ke server mana pun; bot sudah ada di sana.
 */
export function buildAuthorizeUrl(options: AuthorizeUrlOptions): string {
  const url = new URL('https://discord.com/oauth2/authorize');
  url.searchParams.set('client_id', options.clientId);
  url.searchParams.set('redirect_uri', options.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'identify guilds');
  url.searchParams.set('state', options.state);
  url.searchParams.set('code_challenge', options.codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('prompt', 'consent');

  return url.toString();
}

export interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

export async function exchangeCode(options: {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  code: string;
  codeVerifier: string;
}): Promise<TokenResponse> {
  const body = new URLSearchParams({
    client_id: options.clientId,
    client_secret: options.clientSecret,
    grant_type: 'authorization_code',
    code: options.code,
    redirect_uri: options.redirectUri,
    code_verifier: options.codeVerifier,
  });

  const response = await fetch(`${API}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new DiscordError(response.status, '/oauth2/token', `Penukaran kode gagal: ${await response.text()}`);
  }

  return (await response.json()) as TokenResponse;
}

// ── Data yang dipakai halaman dan otorisasi ───────────────────────────────────

export interface OAuthUser {
  id: string;
  username: string;
  global_name?: string | null;
}

export interface OAuthGuild {
  id: string;
  name: string;
  icon: string | null;
  owner: boolean;
  /**
   * Izin user menurut token ini. **Tidak dipakai untuk otorisasi** — hanya
   * untuk menyortir daftar supaya server yang dia kelola muncul lebih dulu.
   */
  permissions?: string;
}

export interface GuildChannel {
  id: string;
  name: string;
  type: number;
  parent_id?: string | null;
}

export interface GuildRole {
  id: string;
  name: string;
  color: number;
  managed?: boolean;
}

export function getCurrentUser(token: string): Promise<OAuthUser | null> {
  return discordRequest<OAuthUser>('/users/@me', { token, scheme: 'Bearer' });
}

export function getUserGuilds(token: string): Promise<OAuthGuild[] | null> {
  return discordRequest<OAuthGuild[]>('/users/@me/guilds', { token, scheme: 'Bearer' });
}

export function getBotGuilds(botToken: string): Promise<{ id: string }[] | null> {
  return discordRequest<{ id: string }[]>('/users/@me/guilds', { token: botToken, scheme: 'Bot' });
}

export function getGuild(botToken: string, guildId: string): Promise<GuildResponse | null> {
  return discordRequest<GuildResponse>(`/guilds/${guildId}`, { token: botToken, scheme: 'Bot' });
}

export function getGuildMember(
  botToken: string,
  guildId: string,
  userId: string,
): Promise<MemberResponse | null> {
  return discordRequest<MemberResponse>(`/guilds/${guildId}/members/${userId}`, {
    token: botToken,
    scheme: 'Bot',
  });
}

export function getGuildChannels(botToken: string, guildId: string): Promise<GuildChannel[] | null> {
  return discordRequest<GuildChannel[]>(`/guilds/${guildId}/channels`, { token: botToken, scheme: 'Bot' });
}

export function getGuildRoles(botToken: string, guildId: string): Promise<GuildRole[] | null> {
  return discordRequest<GuildRole[]>(`/guilds/${guildId}/roles`, { token: botToken, scheme: 'Bot' });
}

/** Deps otorisasi yang memakai token bot sungguhan. */
export function botPermissionDeps(botToken: string): PermissionDeps {
  return {
    getGuild: (guildId) => getGuild(botToken, guildId),
    getMember: (guildId, userId) => getGuildMember(botToken, guildId, userId),
  };
}
