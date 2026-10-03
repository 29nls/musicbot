import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { PermissionFlagsBits } from 'discord.js';
import { describe, expect, it } from 'vitest';

const INVITE_FILE = 'tools/invite.mjs';
const README_FILE = 'README.md';
const CLIENT_ID = '1107624713720709122';

interface DeclaredPermission {
  name: string;
  reason: string;
}

/**
 * Izin yang Discord tegakkan sendiri, jadi tidak pernah muncul di `src/`.
 *
 * **Kenapa daftar ini ada, dan kenapa bukan "apa adanya".** Izin pada
 * `tools/invite.mjs` ada dua jenis: yang bot cek sendiri lewat
 * `PermissionFlagsBits` (mis. Moderate Members di gate `/timeout`), dan
 * yang hanya diminta karena Discord menolak permintaan kalau tidak ada
 * (embed tanpa *Embed Links* ditolak, unggahan file tanpa *Attach Files*
 * ditolak). Yang kedua tidak mungkin dideteksi dari kode.
 *
 * Kalau jenis kedua dibiarkan apa adanya, cek dua arah di bawah akan salah:
 * penghapusan diam-diam lolos sebagai "izin tidak terpakai", padahal bot
 * kehilangan kemampuan yang masih dibutuhkan. Jadi tiap izin jenis kedua
 * wajib dicatat di sini **beserta alasannya**, supaya keberadaannya jadi
 * keputusan yang tercatat, bukan kelalaian.
 */
const PLATFORM_ONLY: Record<string, string> = {
  EmbedLinks: 'Discord memblokir embed yang dikirim bot tanpa izin ini',
  ReadMessageHistory: 'isi pesan hanya terbaca di channel yang boleh dibaca bot',
  AttachFiles: 'unggah file ditolak tanpa izin ini; dipakai ekspor /logs dan transkrip tiket',
};

/** Izin yang menurut kebijakan proyek tidak boleh diminta, apa pun hitungan kode. */
const NEVER_REQUESTED: readonly string[] = ['Administrator'];

/**
 * Ambil daftar izin dari teks `tools/invite.mjs`.
 *
 * Berkasnya dibaca sebagai teks, bukan di-`import`: skrip itu langsung
 * mencetak ke konsol dan memanggil `process.exit`, jadi mengimpornya dari tes
 * akan menjalankan efek samping. Membaca teksnya juga membuat yang diperiksa
 * persis yang tertulis di berkas, termasuk alasan tiap izin.
 *
 * Baris yang tidak bisa dibaca membuat fungsi ini melempar, bukan dilewati.
 * Kalau baris tak terbaca dilewati diam-diam, daftar yang dilaporkan jadi
 * lebih pendek tapi tetap terlihat benar -- persis penyimpangan yang tes ini
 * bellowani.
 */
function parseDeclaredPermissions(source: string): DeclaredPermission[] {
  const block = source.match(/const REQUIRED_PERMISSIONS = \[([\s\S]*?)\n\];/);
  const body = block?.[1];
  if (body === undefined) {
    throw new Error('Daftar REQUIRED_PERMISSIONS tidak ditemukan di ' + INVITE_FILE + '.');
  }

  const declared: DeclaredPermission[] = [];
  for (const line of body.split('\n')) {
    if (line.trim().length === 0) continue;

    const match = /^\s*\[\s*'([A-Za-z]+)'\s*,\s*'([^']*)'\s*\],?\s*$/.exec(line);
    const name = match?.[1];
    if (name === undefined) {
      throw new Error('Baris daftar izin tidak bisa dibaca: ' + JSON.stringify(line));
    }

    declared.push({ name, reason: match?.[2] ?? '' });
  }

  return declared;
}

function declaredPermissions(): DeclaredPermission[] {
  return parseDeclaredPermissions(readFileSync(INVITE_FILE, 'utf8'));
}

/**
 * Semua berkas sumber yang perlu dipindai.
 *
 * **Bukan `listModuleFiles`.** Helper itu sengaja melewati berkas berawalan
 * `_` karena berkas itu bukan modul yang didaftarkan -- tapi justru
 * `src/commands/admin/_shared.ts` yang memegang seluruh `ADMIN_PERMISSIONS`,
 * jadi memakainya di sini membuat Ban Members, Kick Members, dan Moderate
 * Members seolah tidak pernah dipakai. Pemindaian izin butuh seluruh
 * `.ts`, bukan daftar modul.
 *
 * `src/generated/**` dikecualikan karena itu Prisma Client hasil generate,
 * bukan kode yang bisa diubah di repo ini.
 */
function sourceFiles(): string[] {
  return readdirSync('src', { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
    .map((entry) => path.join(entry.parentPath, entry.name))
    .filter((file) => !file.includes(path.join('src', 'generated')));
}

/** Setiap `PermissionFlagsBits.<Izin>` yang muncul di `src/`. */
function codePermissions(): Map<string, string[]> {
  const found = new Map<string, string[]>();

  for (const file of sourceFiles()) {
    const source = stripComments(readFileSync(file, 'utf8'));
    for (const match of source.matchAll(/PermissionFlagsBits\.([A-Za-z]+)/g)) {
      const name = match[1];
      if (!name) continue;

      const files = found.get(name) ?? [];
      files.push(file);
      found.set(name, files);
    }
  }

  return found;
}

/** Buang komentar; izin yang disebut di dalam komentar bukan izin yang dipakai. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
}

/** Integer yang harus sama persis dengan yang dicetak `npm run invite`. */
function permissionsInteger(declared: readonly DeclaredPermission[]): bigint {
  let total = 0n;
  for (const { name } of declared) {
    const bit = PermissionFlagsBits[name as keyof typeof PermissionFlagsBits];
    if (bit === undefined) throw new Error('Izin tidak dikenal: ' + name);
    total |= bit;
  }

  return total;
}

describe('izin OAuth2 di tools/invite.mjs', () => {
  it('setiap izin yang dipanggil di src/ terdaftar di tools/invite.mjs', () => {
    const declared = new Set(declaredPermissions().map((permission) => permission.name));
    const used = codePermissions();

    const missing = [...used.keys()].filter((name) => !declared.has(name)).sort();

    expect(missing).toEqual([]);
  });

  it('setiap izin yang terdaftar dipakai di src/ atau masuk daftar platform', () => {
    const used = codePermissions();
    const declared = declaredPermissions();

    const unused = declared
      .filter(
        (permission) =>
          !used.has(permission.name) && PLATFORM_ONLY[permission.name] === undefined,
      )
      .map((permission) => permission.name)
      .sort();

    expect(unused).toEqual([]);
  });

  it('izin platform-only punya alasan yang berarti', () => {
    for (const [name, reason] of Object.entries(PLATFORM_ONLY)) {
      expect(reason.trim(), 'alasan ' + name).not.toBe('');
      expect(reason.length, 'alasan ' + name).toBeGreaterThan(20);
    }
  });

  it('izin platform-only tidak lagi dipanggil di kode', () => {
    // Kalau kode mulai memakainya, daftar ini jadi basi dan harus ikut dicabut:
    // dari titik pandang kode, izin itu bukan lagi jenis platform-only.
    const used = codePermissions();
    const stale = Object.keys(PLATFORM_ONLY)
      .filter((name) => used.has(name))
      .sort();

    expect(stale).toEqual([]);
  });

  it('Administrator tidak pernah diminta', () => {
    const declared = declaredPermissions().map((permission) => permission.name);

    for (const name of NEVER_REQUESTED) {
      expect(declared).not.toContain(name);
    }
  });

  it('setiap nama izin dikenal oleh discord.js yang terpasang', () => {
    for (const permission of declaredPermissions()) {
      expect(
        PermissionFlagsBits[permission.name as keyof typeof PermissionFlagsBits],
        permission.name,
      ).toBeDefined();
    }
  });

  it('tidak ada izin yang dobel', () => {
    const names = declaredPermissions().map((permission) => permission.name);
    const duplicated = [...new Set(names.filter((name, i) => names.indexOf(name) !== i))].sort();

    expect(duplicated).toEqual([]);
  });

  it('setiap izin punya alasan yang rapi', () => {
    for (const permission of declaredPermissions()) {
      expect(permission.reason.trim(), permission.name).not.toBe('');
      // Spasi di tepi alasan pernah terjadi dan tidak terlihat di output mana pun.
      expect(permission.reason, permission.name).toBe(permission.reason.trim());
    }
  });

  it('daftar izin tidak kosong', () => {
    expect(declaredPermissions().length).toBeGreaterThan(5);
  });
});

describe('hasil yang benar-benar dilihat pengguna', () => {
  it('npm run invite mencetak integer yang sama dengan hitungan kode', () => {
    // Client ID diberikan lewat env supaya tes ini tidak bergantung pada isi
    // .env di mesin siapa pun yang menjalankannya.
    const output = execFileSync(process.execPath, [INVITE_FILE], {
      encoding: 'utf8',
      env: { ...process.env, DISCORD_CLIENT_ID: CLIENT_ID },
    });

    const declared = declaredPermissions();
    const expected = permissionsInteger(declared).toString();

    expect(output).toContain('Izin yang diminta (' + declared.length + ')');
    expect(output).toContain(expected);
    expect(output).toContain(
      'https://discord.com/oauth2/authorize?client_id=' +
        CLIENT_ID +
        '&permissions=' +
        expected +
        '&scope=bot%20applications.commands',
    );
  });

  it('README menyebut integer yang sama', () => {
    const expected = permissionsInteger(declaredPermissions()).toString();

    expect(readFileSync(README_FILE, 'utf8')).toContain('`' + expected + '`');
  });
});

describe('cara tes menemukan penyimpangan', () => {
  it('menemukan izin yang dipanggil di kode dan mengabaikan yang hanya dikomentari', () => {
    const source = stripComments(
      'const a = PermissionFlagsBits.ManageGuild;\n' +
        'const b = PermissionFlagsBits.BanMembers;\n' +
        '// PermissionFlagsBits.KickMembers tidak dipakai\n' +
        '/* PermissionFlagsBits.MoveMembers juga tidak */\n',
    );
    const found = [...source.matchAll(/PermissionFlagsBits\.([A-Za-z]+)/g)].map((m) => m[1]);

    expect(found).toEqual(['ManageGuild', 'BanMembers']);
  });

  it('menolak baris daftar izin yang tidak bisa dibaca, bukan melewatinya', () => {
    expect(() =>
      parseDeclaredPermissions('const REQUIRED_PERMISSIONS = [\n  ViewChannel,\n];'),
    ).toThrow(/tidak bisa dibaca/);
  });

  it('menolak berkas yang tidak punya daftar REQUIRED_PERMISSIONS sama sekali', () => {
    expect(() => parseDeclaredPermissions('// tidak ada apa pun di sini\n')).toThrow(
      /tidak ditemukan/,
    );
  });

  it('membaca daftar yang benar sesuai bentuk yang dipakai tools/invite.mjs', () => {
    const parsed = parseDeclaredPermissions(
      'const REQUIRED_PERMISSIONS = [\n' +
        "  ['ViewChannel', 'baca channel'],\n" +
        "  ['BanMembers', '/ban dan /unban'],\n" +
        '];\n',
    );

    expect(parsed).toEqual([
      { name: 'ViewChannel', reason: 'baca channel' },
      { name: 'BanMembers', reason: '/ban dan /unban' },
    ]);
  });
});