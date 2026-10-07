import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { beforeAll, describe, expect, it } from 'vitest';

/**
 * Penjaga **semantik** (compiler API): hasil `resolve()` hanya boleh dibaca
 * lewat `pickTracks`.
 *
 * Versi sebelumnya memindai teks: berkas sumber dibaca sebagai string, lalu
 * dicari `tracks.slice(0, 1)`, `SEARCH_RESULT_LIMIT = <angka>`, atau
 * `MAX_SEARCH_LINES`. Cara itu punya dua lubang yang keduanya nyata:
 *
 * 1. **Tidak bisa membedakan dua tipe yang punya field bernama sama.**
 *    `PlayOutcome` juga punya `tracks`, jadi `outcome.tracks` di renderer embed
 *    adalah pembacaan yang sah — pemindaian teks harus memilih antara ikut
 *    melarangnya (salah) atau membiarkan pola yang sama lolos (lubang).
 *    Pemakai keenam yang sekarang ketahuan, `spotify/bridge.ts`, memakai
 *    variabel bernama `search` yang sama sekali tidak mengandung kata
 *    "tracks.slice(0, 1)" — pemindaian teks tidak punya cara melihatnya.
 * 2. **Terikat tulisan, bukan makna.** Bentuk yang setara tapi ditulis berbeda
 *    (`const { tracks } = found`, `found['tracks']`, variabel bernama lain)
 *    lolos begitu saja, dan penggantian nama variabel bisa mematikan penjaganya
 *    tanpa satu pun tes gagal.
 *
 * Di sini pertanyaannya dijawab tipe, bukan tulisan: untuk setiap pembacaan
 * `.tracks` (juga `['tracks']` dan destructuring), tipe **yang dideklarasikan**
 * untuk ekspresinya diperiksa dengan TypeChecker — apakah tipe itu `SearchOutcome`
 * (sama dalam dua arah assignability). Tipe yang menyempit dipakai lewat
 * deklarasi simbolnya, karena di dalam `if (found.kind === 'tracks')` tipe di
 * lokasi itu sudah menyempit dan pertanyaannya jadi berbeda dari yang dimaksud.
 *
 * Invarian yang dijaga: **daftar berkas yang membaca `SearchOutcome.tracks`
 * langsung sama persis dengan daftar izin di bawah.** Berkas baru yang membaca
 * hasil pencarian tanpa lewat `pickTracks` akan muncul sebagai pelanggaran —
 * dan izin yang tidak dipakai lagi akan gagal juga, supaya daftar ini tidak
 * berubah jadi kebiasaan yang tidak menjelaskan apa pun.
 *
 * Batas yang jujur: ini analisis statis atas `src/`, bukan bukti runtime — yang
 * dijaga adalah bentuk kode, bukan jalur yang dieksekusi. Dua sisinya diuji apa
 * adanya di bawah: tipe yang dihapus jadi `any` tetap ditandai (karena `any`
 * assignable dua arah, penjaganya sengaja memilih ketat), sedangkan nilai yang
 * tipe deklarasinya sudah **menyempit sendiri** — mis. parameter bertipe
 * `Extract<SearchOutcome, { kind: 'tracks' }>` — tidak ditandai. Yang membuat
 * celah terakhir tidak jadi lubang: setiap nilai seperti itu tetap harus berasal
 * dari pembacaan `SearchOutcome.tracks` yang ditandai, jadi ongkosnya dibayar
 * sekali secara terlihat (satu entri di daftar izin), bukan disembunyikan.
 */

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/**
 * Berkas yang boleh membaca `SearchOutcome.tracks` langsung, beserta alasannya.
 *
 * Dua-duanya bukan pengecualian "karena sulit diubah": `selection.ts` adalah
 * rumah aturannya, dan `spotify/bridge.ts` memakai daftar hasil sebagai **kolam
 * kandidat** untuk mencocokkan metadata Spotify — yang akhirnya dipakai tetap
 * satu lagu lewat `pickSpotifyMatch`, jadi pertanyaannya berbeda ("kandidat mana
 * yang paling cocok", bukan "berapa lagu yang layak dipakai").
 */
const ALLOWED_DIRECT_READS: Record<string, string> = {
  'src/modules/music/selection.ts': 'rumah aturannya sendiri',
  'src/modules/spotify/bridge.ts': 'kolam kandidat untuk pencocokan metadata Spotify',
};

/** Berkas yang wajib memakai `pickTracks` — satu untuk tiap cara hasil dipakai. */
const REQUIRED_CALLERS = [
  'src/modules/music/musicService.ts', // /play
  'src/commands/music/search.ts', // /search
  'src/commands/music/playlist.ts', // /playlist add
  'src/modules/playlists/tracks.ts', // pemuatan playlist ke antrean
];

const SEARCH_OUTCOME_FILE = 'src/modules/music/types.ts';

interface DirectRead {
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

  host.readFile = (file) =>
    virtual.get(file.split(path.sep).join('/')) ?? baseReadFile(file);
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
function searchOutcomeType(program: ts.Program): { type: ts.Type; declaredIn: string[] } {
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

  return { type: checker.getTypeAtLocation(declaration), declaredIn };
}

/**
 * Semua pembacaan `tracks` dari sebuah `SearchOutcome`, di seluruh berkas program.
 *
 * Tiga bentuk yang ditangkap: `found.tracks`, `found['tracks']`, dan
 * `const { tracks } = found`. Bentuk pertama dan kedua diperiksa lewat tipe
 * yang dideklarasikan untuk ekspresinya; destructuring diperiksa lewat
 * initializer deklarasinya, karena tipe di lokasi pola bisa sudah menyempit.
 */
function findDirectTrackReads(
  program: ts.Program,
  outcomeType: ts.Type,
  files?: readonly string[],
): DirectRead[] {
  const checker = program.getTypeChecker();
  const reads: DirectRead[] = [];

  const isSearchOutcome = (type: ts.Type | undefined): boolean =>
    type !== undefined &&
    checker.isTypeAssignableTo(type, outcomeType) &&
    checker.isTypeAssignableTo(outcomeType, type);

  /** Tipe yang **dideklarasikan** untuk ekspresi, bukan tipe yang menyempit di sini. */
  const declaredTypeOf = (node: ts.Node): ts.Type | undefined => {
    if (ts.isIdentifier(node)) {
      const symbol = checker.getSymbolAtLocation(node);
      const declaration = symbol?.valueDeclaration ?? symbol?.declarations?.[0];
      if (symbol && declaration) return checker.getTypeOfSymbolAtLocation(symbol, declaration);
    }

    return checker.getTypeAtLocation(node);
  };

  const record = (node: ts.Node, source: ts.Node): void => {
    if (!isSearchOutcome(declaredTypeOf(source))) return;

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
      if (ts.isPropertyAccessExpression(node) && node.name.text === 'tracks') {
        record(node, node.expression);
      } else if (
        ts.isElementAccessExpression(node) &&
        node.argumentExpression !== undefined &&
        ts.isStringLiteralLike(node.argumentExpression) &&
        node.argumentExpression.text === 'tracks'
      ) {
        record(node, node.expression);
      } else if (ts.isBindingElement(node) && ts.isObjectBindingPattern(node.parent)) {
        const key = node.propertyName ?? node.name;
        const declaration = node.parent.parent;
        const source =
          ts.isVariableDeclaration(declaration) && declaration.initializer !== undefined
            ? declaration.initializer
            : node.parent;

        if (ts.isIdentifier(key) && key.text === 'tracks') record(node, source);
      }

      ts.forEachChild(node, visit);
    };

    visit(file);
  }

  return reads;
}

/** Deklarasi variabel yang namanya cocok, di seluruh berkas program. */
function declaredConstants(
  program: ts.Program,
  pattern: RegExp,
): Array<{ file: string; name: string; line: number }> {
  const found: Array<{ file: string; name: string; line: number }> = [];

  for (const file of program.getSourceFiles()) {
    if (file.isDeclarationFile) continue;

    const visit = (node: ts.Node): void => {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && pattern.test(node.name.text)) {
        found.push({ file: relative(file.fileName), name: node.name.text, line: lineOf(node) });
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

describe('penjaga AST: hasil resolve() hanya dibaca lewat pickTracks', () => {
  let program: ts.Program;
  let outcomeType: ts.Type;
  let reads: DirectRead[];

  beforeAll(() => {
    program = projectProgram();
    const outcome = searchOutcomeType(program);
    outcomeType = outcome.type;
    reads = findDirectTrackReads(program, outcomeType);
  }, 120_000);

  it('`SearchOutcome` dideklarasikan tepat sekali', () => {
    expect(searchOutcomeType(program).declaredIn).toEqual([SEARCH_OUTCOME_FILE]);
  });

  it('tidak ada berkas di luar daftar izin yang membaca SearchOutcome.tracks', () => {
    const offenders = reads
      .filter((read) => !Object.hasOwn(ALLOWED_DIRECT_READS, read.file))
      .map((read) => `${read.file}:${read.line} → ${read.text}`);

    expect(offenders).toEqual([]);
  });

  it('daftar izin tidak menyimpan entri basi', () => {
    const filesWithReads = new Set(reads.map((read) => read.file));

    // Izin yang tidak dipakai lagi berarti pengecualian yang bertahan tanpa
    // alasan — persis yang membuat daftar izin berhenti menjelaskan apa pun.
    for (const file of Object.keys(ALLOWED_DIRECT_READS)) {
      expect(filesWithReads, `${file} tidak lagi membaca langsung`).toContain(file);
    }
  });

  it('pembacaan `PlayOutcome.tracks` tidak ikut tertangkap (tipe, bukan tulisan)', () => {
    const renderers = reads.filter((read) => read.file.startsWith('src/modules/music/embeds.ts'));

    // `renderPlayOutcome` membaca `outcome.tracks` dengan nama yang sama persis,
    // tapi tipenya `PlayOutcome` — bukan hasil pencarian.
    expect(renderers).toEqual([]);
  });

  it('keempat pemakai hasil pencarian memanggil pickTracks', () => {
    for (const file of REQUIRED_CALLERS) {
      expect(callLines(program, file, 'pickTracks'), file).not.toEqual([]);
    }
  });

  it('jumlah hasil pencarian tetap satu definisi', () => {
    const limit = declaredConstants(program, /^SEARCH_RESULT_LIMIT$/);
    expect(limit.map((entry) => `${entry.file}:${entry.name}`)).toEqual([
      'src/modules/music/selection.ts:SEARCH_RESULT_LIMIT',
    ]);

    // Nama lama yang dulu jadi definisi kedua di embed.
    expect(declaredConstants(program, /^MAX_SEARCH/)).toEqual([]);
  });
});

describe('penjaga AST itu sendiri bergigi', () => {
  const KNOWN_OUTCOME = `
type SearchOutcome =
  | { kind: 'tracks'; tracks: { title: string }[] }
  | { kind: 'empty' };
declare function resolve(query: string): Promise<SearchOutcome>;

export async function langsung(query: string): Promise<number> {
  const found = await resolve(query);
  if (found.kind !== 'tracks') return 0;
  return found.tracks.length;
}

export async function lewatKurung(query: string): Promise<number> {
  const found = await resolve(query);
  if (found.kind !== 'tracks') return 0;
  return found['tracks'].length;
}

export async function bongkar(query: string): Promise<string> {
  const found = await resolve(query);
  if (found.kind !== 'tracks') return 'kosong';
  const { tracks } = found;
  return tracks[0]?.title ?? 'kosong';
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

  function readsIn(text: string): DirectRead[] {
    const program = sketchProgram({ [path.join(ROOT, 'sketsa', 'berkas.ts')]: text });
    const outcome = searchOutcomeType(program);

    return findDirectTrackReads(program, outcome.type);
  }

  it('menandai .tracks, [\'tracks\'], dan destructuring', () => {
    expect(readsIn(KNOWN_OUTCOME).map((read) => read.line)).toEqual([10, 16, 22]);
  });

  it('tidak menandai pemakaian yang sudah lewat pickTracks', () => {
    expect(readsIn(COMPLIANT)).toEqual([]);
  });

  it('tipe yang dihapus jadi `any` tetap ditandai: penjaganya sengaja ketat', () => {
    // `any` assignable dua arah ke tipe apa pun, jadi nilai yang tipenya dihapus
    // tetap ikut ditandai. Menghapus tipe lalu membaca `.tracks` adalah cara
    // melewati aturannya, bukan cara menjawab pertanyaan yang berbeda — kalau ada
    // jalur yang benar-benar perlu, ongkosnya satu entri di daftar izin.
    const denganAny = `
type SearchOutcome = { kind: 'tracks'; tracks: { title: string }[] };
declare function resolve(query: string): Promise<SearchOutcome>;

export async function dilewati(): Promise<number> {
  const found = (await resolve('x')) as any;
  return found.tracks.length;
}
`;

    expect(readsIn(denganAny)).toHaveLength(1);
  });

  it('batas yang jujur: tipe yang sudah menyempit sendiri tidak ditandai', () => {
    // Nilai seperti ini tidak bisa lahir dari udara: ia harus datang dari
    // pembacaan `SearchOutcome.tracks` yang ditandai, jadi celahnya terlihat
    // sebagai satu entri izin, bukan sebagai pintu belakang yang tak terpakai.
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
