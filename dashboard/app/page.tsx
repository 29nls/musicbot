// Halaman sementara: hanya untuk membuktikan bahwa modul bot (validasi, tipe,
// katalog) bisa diimpor apa adanya ke dalam build Next.js. Diganti oleh
// halaman daftar server pada langkah berikutnya.
import { MAX_VOLUME, MIN_IDLE_TIMEOUT_SEC } from '@bot/modules/config/types.js';
import { guildConfigPatchSchema } from '@bot/modules/config/validation.js';

export default function Home() {
  const contoh = guildConfigPatchSchema.safeParse({ defaultVolume: MAX_VOLUME + 1 });

  return (
    <main>
      <h1 style={{ fontSize: 24 }}>Harmony Dashboard</h1>
      <p>
        Modul bot termuat. Batas volume {MAX_VOLUME}, idle timeout minimal {MIN_IDLE_TIMEOUT_SEC} detik.
      </p>
      <p>Contoh validasi volume di atas batas: {contoh.success ? 'lolos' : 'ditolak'}.</p>
    </main>
  );
}
