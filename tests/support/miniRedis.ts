import { createServer, type Server, type Socket } from 'node:net';

/**
 * Server Redis mini untuk tes integrasi.
 *
 * Ada karena jalur "Redis hidup" adalah satu-satunya jalur `createKeyValueStore`
 * yang tidak bisa diuji dengan klien tiruan: yang sedang diuji justru perilaku
 * ioredis sungguhan (perintah, urutan, balasan). Dengan server RESP kecil ini,
 * jalur itu bisa diuji tanpa memasang Redis dan tanpa Docker — cukup soket di
 * localhost yang menjawab perintah yang memang dipakai store.
 *
 * Sengaja hanya mendukung perintah yang dipakai kode ini. Perintah lain dibalas
 * dengan error Redis yang jujur, bukan diam-diam sukses, supaya kalau store
 * nanti memakai perintah baru, tes gagal dengan alasan yang jelas.
 */

interface Entry {
  value: string;
  expiresAt: number | undefined;
}

/**
 * Balasan error Redis, apa adanya supaya tes bisa membedakan hal lain.
 *
 * WAJIB diakhiri CRLF: tanpa itu ioredis tidak pernah melihat perintah selesai
 * dan menunggu selamanya, sehingga gejalanya muncul sebagai timeout, bukan
 * sebagai error yang bisa dibaca.
 */
const UNKNOWN_COMMAND = '-ERR unknown command in this test server\r\n';
const WRONG_ARGS = '-ERR wrong number of arguments\r\n';

export class MiniRedis {
  private server: Server | undefined;
  private readonly entries = new Map<string, Entry>();
  /** Soket yang masih terbuka; harus dihancurkan saat server ditutup. */
  private readonly sockets = new Set<Socket>();

  /** Perintah yang sudah dilayani, untuk diagnostik tes. */
  public readonly handled: string[] = [];

  /** Port yang sedang dipakai; 0 = belum listen. */
  public port = 0;

  /**
   * Jalankan server. Tanpa port, memakai port acak supaya paralel dengan tes
   * lain tidak bentrok; isi port untuk kasus yang butuh alamat tetap.
   */
  async listen(port = 0): Promise<number> {
    const server = createServer((socket) => this.handle(socket));
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, '127.0.0.1', resolve);
    });

    const address = server.address();
    if (address === null || typeof address === 'string') {
      throw new Error('gagal menemukan port server mini');
    }

    this.server = server;
    this.port = address.port;
    return this.port;
  }

  async close(): Promise<void> {
    const server = this.server;
    this.server = undefined;
    this.port = 0;
    this.entries.clear();
    this.handled.length = 0;

    // `server.close()` hanya berhenti menerima koneksi baru; ia masih
    // menunggu semua soket yang terbuka. Klien ioredis yang tidak sempat
    // `quit()` akan membuat hook ini menggantung, jadi soketnya dihancurkan.
    for (const socket of this.sockets) socket.destroy();
    this.sockets.clear();

    if (!server) return;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  /** Sisa TTL sebuah key dalam ms; null kalau key tidak ada. */
  ttlOf(key: string): number | null {
    const entry = this.entries.get(key);
    if (!entry || this.isExpired(entry)) return null;
    if (entry.expiresAt === undefined) return -1;
    return Math.max(0, entry.expiresAt - Date.now());
  }

  private isExpired(entry: Entry): boolean {
    return entry.expiresAt !== undefined && entry.expiresAt <= Date.now();
  }

  private handle(socket: Socket): void {
    let buffer = '';
    this.sockets.add(socket);
    socket.on('close', () => this.sockets.delete(socket));
    socket.setEncoding('utf8');

    socket.on('data', (chunk: string) => {
      buffer += chunk;
      for (;;) {
        const parsed = parseCommand(buffer);
        if (!parsed) return;
        buffer = buffer.slice(parsed.length);
        socket.write(this.run(parsed.args));
      }
    });

    socket.on('error', () => {
      //Klien menutup koneksi (mis. `quit()`); tidak ada yang perlu dilaporkan.
    });
  }

  private run(args: string[]): string {
    const name = (args[0] ?? '').toUpperCase();
    this.handled.push([name, ...args.slice(1)].join(' '));

    switch (name) {
      case 'PING':
        return '+PONG\r\n';
      case 'INFO':
        // ioredis melakukan ready check dengan membaca `loading` dari INFO.
        return bulk('redis_version:7.0.0\r\nloading:0\r\nrole:master\r\n');
      case 'CLIENT':
      case 'SELECT':
      case 'AUTH':
        return '+OK\r\n';
      case 'COMMAND':
        return '*0\r\n';
      case 'QUIT':
        return '+OK\r\n';
      case 'HELLO':
        // ioredis v6 membuka handshake dengan `HELLO 3` (RESP3). Server uji ini
        // hanya bicara RESP2, jadi jawabannya `+OK` yang membuat ioredis turun
        // ke protokol lama — sama seperti jawaban Redis yang lebih tua.
        return '+OK\r\n';
      case 'SET': {
        // `args[0]` adalah nama perintahnya, jadi key dan value baru mulai
        // dari indeks 1 — destructure dari indeks 0 akan menyimpan semua nilai
        // di bawah kunci yang namanya "SET".
        const key = args[1];
        const value = args[2];
        if (key === undefined || value === undefined) return WRONG_ARGS;
        // Opsi SET dibaca dengan mencari nama opsinya, bukan dengan posisi tetap:
        // `SET key value PX 60000` menaruh nilai TTL di indeks 4, sedangkan
        // `SET key value` tidak punya TTL sama sekali.
        const pxIndex = args.findIndex((argument) => argument.toUpperCase() === 'PX');
        const ttlMs = pxIndex >= 0 ? Number.parseInt(args[pxIndex + 1] ?? '', 10) : Number.NaN;
        this.entries.set(key, {
          value,
          expiresAt: Number.isFinite(ttlMs) && ttlMs > 0 ? Date.now() + ttlMs : undefined,
        });
        return '+OK\r\n';
      }
      case 'GET': {
        const key = args[1];
        if (key === undefined) return WRONG_ARGS;
        const entry = this.entries.get(key);
        if (!entry || this.isExpired(entry)) return '$-1\r\n';
        return bulk(entry.value);
      }
      case 'INCR': {
        const key = args[1];
        if (key === undefined) return WRONG_ARGS;
        const entry = this.entries.get(key);
        const current = entry && !this.isExpired(entry) ? Number.parseInt(entry.value, 10) : 0;
        const next = (Number.isFinite(current) ? current : 0) + 1;
        this.entries.set(key, {
          value: String(next),
          // INCR harus mempertahankan TTL yang sudah ada (persis seperti Redis).
          expiresAt: entry && !this.isExpired(entry) ? entry.expiresAt : undefined,
        });
        return `:${next}\r\n`;
      }
      case 'PTTL': {
        const key = args[1];
        if (key === undefined) return WRONG_ARGS;
        const entry = this.entries.get(key);
        if (!entry || this.isExpired(entry)) return ':-2\r\n';
        if (entry.expiresAt === undefined) return ':-1\r\n';
        return `:${Math.max(0, entry.expiresAt - Date.now())}\r\n`;
      }
      case 'DEL': {
        const key = args[1];
        if (key === undefined) return WRONG_ARGS;
        return `:${this.entries.delete(key) ? 1 : 0}\r\n`;
      }
      case 'GETDEL': {
        // Atomik di Redis sungguhan, dan itulah yang dipakai `take()`: dua
        // klik yang sama-sama diproses hanya boleh mendapat satu nilai.
        const key = args[1];
        if (key === undefined) return WRONG_ARGS;
        const entry = this.entries.get(key);
        this.entries.delete(key);
        if (!entry || this.isExpired(entry)) return '$-1\r\n';
        return bulk(entry.value);
      }
      default:
        return UNKNOWN_COMMAND;
    }
  }
}

function bulk(value: string): string {
  return `$${Buffer.byteLength(value)}\r\n${value}\r\n`;
}

/**
 * Baca satu perintah RESP dari buffer.
 *
 * @returns argumen dan panjang yang dikonsumsi, atau undefined kalau perintahnya
 * belum utuh (kedua-duanya hal normal: TCP datang berpotongan).
 */
function parseCommand(buffer: string): { args: string[]; length: number } | undefined {
  if (!buffer.startsWith('*')) return undefined;

  const newline = buffer.indexOf('\r\n');
  if (newline < 0) return undefined;

  const count = Number.parseInt(buffer.slice(1, newline), 10);
  if (!Number.isFinite(count)) return undefined;

  const args: string[] = [];
  let cursor = newline + 2;

  for (let index = 0; index < count; index += 1) {
    if (buffer[cursor] !== '$') return undefined;
    const sizeEnd = buffer.indexOf('\r\n', cursor);
    if (sizeEnd < 0) return undefined;

    const size = Number.parseInt(buffer.slice(cursor + 1, sizeEnd), 10);
    if (!Number.isFinite(size)) return undefined;

    const start = sizeEnd + 2;
    const end = start + size;
    if (buffer.length < end + 2) return undefined;

    args.push(buffer.slice(start, end));
    cursor = end + 2;
  }

  return { args, length: cursor };
}