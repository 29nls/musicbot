import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { beforeAll, describe, expect, it } from 'vitest';
import type { SearchOutcome } from '../src/modules/music/selection.js';

/**
 * Penjaga untuk `SearchOutcome` yang **opaque**: daftar lagunya tidak bisa
 * dibaca dari luar `selection.ts`.
 *
 * Dua lapis, dan sengaja dua-duanya ada karena keduanya menutup lubang yang
 * berbeda:
 *
 * 1. **Brand:** payload daftar lagu disimpan di balik kunci Symbol yang tidak
 *    diekspor, jadi `outcome.tracks` bukan "dilarang" melainkan **tidak ada**.
 *    Ini menutup jalur yang dulu tidak bisa ditutup aturan apa pun: menghapus
 *    tipe (`as any`) dan tipe yang menyempit sendiri. Konsekuensinya terlihat
 *    di sini — saat migrasi, compiler menolak **25 tempat** yang merakit cabang
 *    `tracks` dengan tangan (semuanya di tes), karena penyusunnya sekarang cuma
 *    `foundTracks()`.
 * 2. **Penjaga statis ini:** brand tidak menutup **refleksi**. `Object.values(outcome)`
 *    mengembalikan daftar lagunya tanpa perlu menyebut simbolnya — itu bukan
 *    kesalahan tipe, jadi tidak ada yang bisa menolaknya selain pemindaian
 *    seperti ini. Pemindaiannya tetap memakai tipe (TypeChecker), bukan tulisan,
 *    supaya `Object.values` pada `PlayOutcome` atau antrean tidak ikut tertangkap.
 *
 * Invariant yang dijaga: **tidak ada berkas di `src/` selain `selection.ts` yang
 * membaca daftar lagu hasil pencarian, langsung maupun lewat refleksi.** Daftar
 * izinnya kosong — sebelumnya `spotify/bridge.ts` ada di sana, dan sekarang ia
 * meminta kolam kandidat lewat `pickTracks(outcome, 'candidates', …)` seperti
 * pemakai lain. Jadi tidak ada lagi pengecualian yang harus diingat.
 */

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/** Rumah aturannya, sekaligus satu-satunya berkas yang boleh membaca daftarnya. */
const SELECTION_FILE = 'src/modules/music/selection.ts';

/** Berkas yang wajib memakai `pickTracks` — satu untuk tiap cara hasil dipakai. */
const REQUIRED_CALLERS = [
  'src/modules/music/musicService.ts', // /play, dan producer hasil pencarian
  'src/commands/music/search.ts', // /search
  'src/commands/music/playlist.ts', // /playlist add
  'src/modules/playlists/tracks.ts', // pemuatan playlist ke antrean
  'src/modules/spotify/bridge.ts', // kolam kandidat pencocokan Spotify
];

/** Pemanggilan yang bisa membuka payload tanpa menyebut simbolnya. */
const REFLECTION_CALLS = new Set([
  'Object.values',
  'Object.entries',
  'Object.assign',
  'Object.getOwnPropertySymbols',
  'Reflect.ownKeys',
]);

interface TrackListRead {
  file: string;
  line: number;
  text: string;
}

/** Opsi dasar untuk program sketsa (tanpa berkas proyek). */
const SKETCH_OPTIONS: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2023,
  module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
  strict: true,
};

function relative(fileName: string): string {
  return path.relative(ROOT, fileName).split(path.sep).join('/');
}

function lineOf(node: ts.Node): number {
  const source = node.getSourceFile();
  return source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
}

/** Program untuk proyek sungguhan, memakai daftar berkas dari `tsconfig.json`. */
function projectProgram(): ts.Program {
  const configPath = path.join(ROOT, 'tsconfig.json');
  const read = ts.readConfigFile(configPath, (file) => readFileSync(file, 'utf8'));
  const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, ROOT);

  return ts.createProgram({ rootNames: parsed.fileNames, options: parsed.options });
}

/** Program kecil dari berkas in-memory — dipakai untuk membuktikan penjaganya bergigi. */
function sketchProgram(files: Record<string, string>): ts.Program {
  const virtual = new Map(
    Object.entries(files).map(([file, text]) => [file.split(path.sep).join('/'), text] as const),
  );

  const host = ts.createCompilerHost(SKETCH_OPTIONS);
  const baseReadFile = host.readFile.bind(host);
  const baseFileExists = host.fileExists.bind(host);
  const baseGetSourceFile = host.getSourceFile.bind(host);

  host.readFile = (file) => virtual.get(file.split(path.sep).join('/')) ?? baseReadFile(file);
  host.fileExists = (file) =>
    virtual.has(file.split(path.sep).join('/')) || baseFileExists(file);
  host.getSourceFile = (file, languageVersion, onError, shouldCreateNewSourceFile) => {
    const text = virtual.get(file.split(path.sep).join('/'));
    if (text !== undefined) return ts.createSourceFile(file, text, languageVersion, true);

    return baseGetSourceFile(file, languageVersion, onError, shouldCreateNewSourceFile);
  };

  return ts.createProgram({ rootNames: Object.keys(files), options: SKETCH_OPTIONS, host });
}

/**
 * Tipe `SearchOutcome` beserta di berkas mana ia dideklarasikan.
 *
 * Dua deklarasi berarti ada definisi kedua hasil pencarian — hal yang sama
 * berbahayanya dengan definisi kedua jumlah lagu.
 */
function searchOutcomeType(program: ts.Program): {
  type: ts.Type;
  declaration: ts.TypeAliasDeclaration;
  declaredIn: string[];
} {
  const checker = program.getTypeChecker();
  const declaredIn: string[] = [];
  let declaration: ts.TypeAliasDeclaration | undefined;

  for (const file of program.getSourceFiles()) {
    if (file.isDeclarationFile) continue;

    const visit = (node: ts.Node): void => {
      if (ts.isTypeAliasDeclaration(node) && node.name.text === 'SearchOutcome') {
        declaredIn.push(relative(file.fileName));
        declaration ??= node;
      }
      ts.forEachChild(node, visit);
    };

    visit(file);
  }

  if (!declaration) throw new Error('Tipe `SearchOutcome` tidak ditemukan di src/');

  return { type: checker.getTypeAtLocation(declaration), declaration, declaredIn };
}

/**
 * Pembacaan daftar lagu hasil pencarian, langsung maupun lewat refleksi.
 *
 * Tipe yang dipakai adalah tipe **yang dideklarasikan** untuk ekspresinya,
 * bukan tipe di lokasi: di dalam `if (found.kind === 'tracks')` tipe di situ
 * sudah menyempit, dan pertanyaannya jadi berbeda dari yang dimaksud.
 */
function trackListReads(
  program: ts.Program,
  outcomeType: ts.Type,
  files?: readonly string[],
): TrackListRead[] {
  const checker = program.getTypeChecker();
  const reads: TrackListRead[] = [];

  const isSearchOutcome = (type: ts.Type | undefined): boolean =>
    type !== undefined &&
    checker.isTypeAssignableTo(type, outcomeType) &&
    checker.isTypeAssignableTo(outcomeType, type);

  const declaredTypeOf = (node: ts.Node): ts.Type | undefined => {
    if (ts.isIdentifier(node)) {
      const symbol = checker.getSymbolAtLocation(node);
      const declaration = symbol?.valueDeclaration ?? symbol?.declarations?.[0];
      if (symbol && declaration) return checker.getTypeOfSymbolAtLocation(symbol, declaration);
    }

    return checker.getTypeAtLocation(node);
  };

  const record = (node: ts.Node): void => {
    reads.push({
      file: relative(node.getSourceFile().fileName),
      line: lineOf(node),
      text: node.getText().split('\n')[0]?.trim().slice(0, 90) ?? '',
    });
  };

  for (const file of program.getSourceFiles()) {
    if (file.isDeclarationFile) continue;
    if (files && !files.includes(relative(file.fileName))) continue;

    const visit = (node: ts.Node): void => {
      // 1. Pembacaan langsung: `found.tracks`, `found['tracks']`, `{ tracks } = found`.
      if (ts.isPropertyAccessExpression(node) && node.name.text === 'tracks') {
        if (isSearchOutcome(declaredTypeOf(node.expression))) record(node);
      } else if (
        ts.isElementAccessExpression(node) &&
        node.argumentExpression !== undefined &&
        ts.isStringLiteralLike(node.argumentExpression) &&
        node.argumentExpression.text === 'tracks' &&
        isSearchOutcome(declaredTypeOf(node.expression))
      ) {
        record(node);
      } else if (ts.isBindingElement(node) && ts.isObjectBindingPattern(node.parent)) {
        const key = node.propertyName ?? node.name;
        const declaration = node.parent.parent;
        const source =
          ts.isVariableDeclaration(declaration) && declaration.initializer !== undefined
            ? declaration.initializer
            : node.parent;

        if (ts.isIdentifier(key) && key.text === 'tracks' && isSearchOutcome(declaredTypeOf(source))) {
          record(node);
        }
      }

      // 2. Refleksi: payload ikut terambil tanpa menyebut simbolnya.
      if (ts.isCallExpression(node) && REFLECTION_CALLS.has(node.expression.getText())) {
        if (node.arguments.some((argument) => isSearchOutcome(declaredTypeOf(argument)))) {
          record(node);
        }
      }

      ts.forEachChild(node, visit);
    };

    visit(file);
  }

  return reads;
}

/** Apakah sebuah node dinyatakan `export`. */
function hasExportKeyword(node: ts.HasModifiers): boolean {
  return (ts.getModifiers(node) ?? []).some(
    (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
  );
}

/** Apakah payload daftar lagu disembunyikan di balik Symbol yang tidak diekspor. */
function hiddenBehindSymbol(declaration: ts.TypeAliasDeclaration): {
  symbolName: string | null;
  exported: boolean;
  leakedStringKey: boolean;
} {
  let symbolName: string | null = null;
  let exported = false;
  let leakedStringKey = false;

  const type = declaration.type;

  if (ts.isUnionTypeNode(type)) {
    for (const member of type.types) {
      if (!ts.isTypeLiteralNode(member)) continue;

      const isTracksMember = member.members.some(
        (property) =>
          ts.isPropertySignature(property) &&
          ts.isIdentifier(property.name) &&
          property.name.text === 'kind' &&
          property.type !== undefined &&
          ts.isLiteralTypeNode(property.type) &&
          property.type.literal.getText() === "'tracks'",
      );
      if (!isTracksMember) continue;

      for (const property of member.members) {
        if (!ts.isPropertySignature(property)) continue;

        if (ts.isIdentifier(property.name) && property.name.text === 'tracks') {
          leakedStringKey = true;
        }

        if (ts.isComputedPropertyName(property.name)) {
          symbolName = property.name.expression.getText();
        }
      }
    }
  }

  if (symbolName) {
    // `export` duduk di `VariableStatement`, bukan di deklarasinya: keduanya
    // diperiksa supaya `export const TRACK_LIST = …` tidak pernah lolos.
    for (const statement of declaration.getSourceFile().statements) {
      if (!ts.isVariableStatement(statement)) continue;

      const match = statement.declarationList.declarations.find(
        (item) => ts.isIdentifier(item.name) && item.name.text === symbolName,
      );
      if (!match) continue;

      exported = hasExportKeyword(statement);
    }
  }

  return { symbolName, exported, leakedStringKey };
}

/** Deklarasi variabel yang namanya cocok, di seluruh berkas program. */
function declaredConstants(
  program: ts.Program,
  pattern: RegExp,
): Array<{ file: string; name: string }> {
  const found: Array<{ file: string; name: string }> = [];

  for (const file of program.getSourceFiles()) {
    if (file.isDeclarationFile) continue;

    const visit = (node: ts.Node): void => {
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        pattern.test(node.name.text)
      ) {
        found.push({ file: relative(file.fileName), name: node.name.text });
      }
      ts.forEachChild(node, visit);
    };

    visit(file);
  }

  return found;
}

/** Baris tempat `calleeName` dipanggil di satu berkas. */
function callLines(program: ts.Program, wanted: string, calleeName: string): number[] {
  const file = program
    .getSourceFiles()
    .find((source) => !source.isDeclarationFile && relative(source.fileName) === wanted);

  if (!file) throw new Error(`Berkas ${wanted} tidak ada di program`);

  const lines: number[] = [];

  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === calleeName
    ) {
      lines.push(lineOf(node));
    }
    ts.forEachChild(node, visit);
  };

  visit(file);

  return lines;
}

/**
 * Dijaga pada level tipe: kalau payload kembali bernama `tracks`, tipe ini jadi
 * `'terbuka'` dan baris di bawahnya gagal typecheck — jadi pembalikan brand
 * tidak bisa lolos hanya karena tesnya tidak dijalankan.
 */
type PayloadShape = Extract<SearchOutcome, { kind: 'tracks' }> extends { tracks: unknown }
  ? 'terbuka'
  : 'opaque';

const payloadShape: PayloadShape = 'opaque';

describe('tidak ada yang bisa membaca daftar lagu di luar selection.ts', () => {
  let program: ts.Program;
  let outcomeType: ts.Type;
  let declaration: ts.TypeAliasDeclaration;
  let reads: TrackListRead[];

  beforeAll(() => {
    program = projectProgram();
    const outcome = searchOutcomeType(program);
    outcomeType = outcome.type;
    declaration = outcome.declaration;
    reads = trackListReads(program, outcomeType);
  }, 120_000);

  it('`SearchOutcome` dideklarasikan tepat sekali, di selection.ts', () => {
    expect(searchOutcomeType(program).declaredIn).toEqual([SELECTION_FILE]);
  });

  it('payload daftar lagu berkunci Symbol yang tidak diekspor', () => {
    const brand = hiddenBehindSymbol(declaration);

    expect(brand.symbolName).toBe('TRACK_LIST');
    expect(brand.exported).toBe(false);
    // Kunci string `tracks` tidak boleh muncul lagi di union-nya.
    expect(brand.leakedStringKey).toBe(false);
  });

  it('bentuk payload dijaga level tipe, bukan cuma di tes ini', () => {
    expect(payloadShape).toBe('opaque');
  });

  it('tidak ada berkas lain yang membaca daftarnya — langsung maupun lewat refleksi', () => {
    const offenders = reads
      .map((read) => `${read.file}:${read.line} → ${read.text}`)
      .filter((line) => !line.startsWith(`${SELECTION_FILE}:`));

    expect(offenders).toEqual([]);
  });

  it('kelima pemakai hasil pencarian memanggil pickTracks', () => {
    for (const file of REQUIRED_CALLERS) {
      expect(callLines(program, file, 'pickTracks'), file).not.toEqual([]);
    }
  });

  it('jumlah hasil pencarian tetap satu definisi', () => {
    const limit = declaredConstants(program, /^SEARCH_RESULT_LIMIT$/);
    expect(limit.map((entry) => `${entry.file}:${entry.name}`)).toEqual([
      `${SELECTION_FILE}:SEARCH_RESULT_LIMIT`,
    ]);

    // Nama lama yang dulu jadi definisi kedua di embed.
    expect(declaredConstants(program, /^MAX_SEARCH/)).toEqual([]);
  });
});

describe('penjaga itu sendiri bergigi', () => {
  const SKETCH = `
type SearchOutcome = { kind: 'tracks'; tracks: { title: string }[] } | { kind: 'empty' };
type Queue = { tracks: { title: string }[] };
declare function resolve(query: string): Promise<SearchOutcome>;
declare function queue(): Queue;

export async function langsung(): Promise<number> {
  const found = await resolve('x');
  if (found.kind !== 'tracks') return 0;
  return found.tracks.length;
}

export async function refleksi(): Promise<number> {
  const found = await resolve('x');
  return Object.values(found).length;
}

export async function salahSasaran(): Promise<number> {
  return Object.values(queue()).length;
}
`;

  const COMPLIANT = `
type SearchOutcome =
  | { kind: 'tracks'; tracks: { title: string }[] }
  | { kind: 'empty' };
declare function resolve(query: string): Promise<SearchOutcome>;
declare function pickTracks(outcome: SearchOutcome): { title: string }[];

export async function patuh(query: string): Promise<string> {
  const found = await resolve(query);
  const [best] = pickTracks(found);
  const { title } = best ?? { title: 'kosong' };
  return title;
}
`;

  function readsIn(text: string): TrackListRead[] {
    const program = sketchProgram({ [path.join(ROOT, 'sketsa', 'berkas.ts')]: text });
    const outcome = searchOutcomeType(program);

    return trackListReads(program, outcome.type);
  }

  it('menandai pembacaan langsung DAN jalan refleksi', () => {
    expect(readsIn(SKETCH).map((read) => read.line)).toEqual([10, 15]);
  });

  it('`Object.values` pada tipe lain tidak ikut ditandai', () => {
    // Antrean juga punya `tracks`; yang membedakan hanya tipenya.
    const lines = readsIn(SKETCH).map((read) => read.line);
    expect(lines).not.toContain(19);
  });

  it('tidak menandai pemakaian yang sudah lewat pickTracks', () => {
    expect(readsIn(COMPLIANT)).toEqual([]);
  });

  it('tipe yang dihapus jadi `any` tetap ditandai: refleksi bukan izin', () => {
    // Di runtime `(found as any).tracks` memang bernilai `undefined` — brand-nya
    // bekerja — tapi `Object.values` tetap bisa membuka payload-nya, jadi jalur
    // itu harus ditandai, bukan dibiarkan karena tipenya sudah hilang.
    const denganAny = `
type SearchOutcome = { kind: 'tracks'; tracks: { title: string }[] };
declare function resolve(query: string): Promise<SearchOutcome>;

export async function dilewati(): Promise<number> {
  const found = (await resolve('x')) as any;
  return Object.values(found).length;
}
`;

    expect(readsIn(denganAny)).toHaveLength(1);
  });

  it('batas yang jujur: tipe yang sudah menyempit sendiri tidak ditandai', () => {
    // Nilai seperti ini tidak bisa lahir dari udara: ia harus berasal dari
    // pembacaan `SearchOutcome` yang ditandai, jadi celahnya terlihat.
    const menyempit = `
type SearchOutcome = { kind: 'tracks'; tracks: { title: string }[] } | { kind: 'empty' };
type SudahSempit = Extract<SearchOutcome, { kind: 'tracks' }>;

export function dilewatkan(found: SudahSempit): number {
  return found.tracks.length;
}
`;

    expect(readsIn(menyempit)).toEqual([]);
  });
});
