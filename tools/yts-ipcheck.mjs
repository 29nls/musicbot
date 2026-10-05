#!/usr/bin/env node
// Menguji apa yang YouTube balas untuk IP keluar mesin ini -- tanpa Lavalink.
//
// Kenapa dipisah dari tools/yts-probe.mjs: probe itu mengukur Lavalink (versi
// plugin, daftar klien, apakah klien bisa mengirim byte audio). Alat ini
// mengukur lapisan di bawahnya: apa jawaban YouTube untuk IP ini. Jadi urutan
// diagnosis yang jujur saat pemutaran gagal:
//   1. node tools/yts-ipcheck.mjs  -> kalau di sini tidak ada URL audio,
//      masalahnya IP/egress, bukan plugin atau config;
//   2. node tools/yts-probe.mjs    -> baru kalau di sini ada URL audio.
//
// Kenapa ini berguna: playlist lagu yang gagal bisa berasal dari dua sebab yang
// mirip di layar tapi sangat berbeda obatnya -- klien/config salah, atau IP
// ditolak YouTube. Yang kedua tidak bisa diperbaiki dengan menambah klien.
//
// Pemakaian:
//   node tools/yts-ipcheck.mjs               # 3 video yang gagal + 1 kontrol
//   node tools/yts-ipcheck.mjs --ids a,b,c
//
// Cara membaca keluaran:
//   URL>0      = YouTube masih mengirim URL audio langsung -> IP ini dilayani.
//   SABR>0     = format ada tapi URL-nya tidak, hanya serverAbrStreamingUrl.
//                Pola inilah yang membuat plugin gagal (butuh URL langsung).
//   status lain (LOGIN_REQUIRED/UNPLAYABLE/ERROR) = video tidak dilayani sama sekali.
//
// Batas yang jujur: SABR-only bisa juga muncul untuk IP sehat, tergantung
// giliran YouTube. Karena itu alat ini untuk membandingkan dua keadaan
// (mis. WARP menyala vs mati) pada menit yang sama, bukan untuk memvonis
// satu kali jalan.

const DEFAULT_IDS = ['wsEkktRGZ18', 'W0QYe8fcPYc', 'dukrIo4bIlc', 'dQw4w9WgXcQ'];
const INNERTUBE_KEY = 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8';

function arg(name) {
  const i = process.argv.indexOf(name);
  return i === -1 ? null : process.argv[i + 1];
}

// Dua klien saja: ANDROID_VR (yang paling sering dipakai plugin di repo ini)
// dan WEB (pembanding yang paling umum). Menambah klien di sini tidak menambah
// bukti -- yang dicari bukan cakupan, tapi jawaban YouTube untuk IP ini.
const CLIENTS = {
  WEB: {
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    client: { clientName: 'WEB', clientVersion: '2.20241010.01.00', hl: 'en', gl: 'US' },
  },
  ANDROID_VR: {
    userAgent:
      'com.google.android.apps.youtube.vr.oculus/1.60.19 (Linux; U; Android 12; GB) gzip',
    client: {
      clientName: 'ANDROID_VR',
      clientVersion: '1.60.19',
      deviceMake: 'Oculus',
      deviceModel: 'Quest 3',
      androidSdkVersion: 32,
      osName: 'Android',
      osVersion: '12',
      hl: 'en',
      gl: 'US',
    },
  },
};

async function egressIp() {
  try {
    const res = await fetch('https://api.ipify.org', { signal: AbortSignal.timeout(15000) });
    return (await res.text()).trim();
  } catch {
    return '(tidak terukur)';
  }
}

async function ask(clientName, videoId) {
  const cfg = CLIENTS[clientName];
  const res = await fetch(
    `https://www.youtube.com/youtubei/v1/player?key=${INNERTUBE_KEY}&prettyPrint=false`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'user-agent': cfg.userAgent,
        origin: 'https://www.youtube.com',
      },
      body: JSON.stringify({
        context: { client: cfg.client },
        videoId,
        contentCheckOk: true,
        racyCheckOk: true,
      }),
      signal: AbortSignal.timeout(30000),
    },
  );
  const json = await res.json().catch(() => null);
  if (json === null) return { status: `HTTP ${res.status}`, reason: '', total: 0, withUrl: 0, sabr: 0 };
  const ps = json.playabilityStatus ?? {};
  const formats = json.streamingData?.adaptiveFormats ?? json.streamingData?.formats ?? [];
  return {
    status: ps.status ?? `HTTP ${res.status}`,
    reason: (ps.reason ?? '').replace(/\s+/g, ' ').trim(),
    total: formats.length,
    withUrl: formats.filter((f) => typeof f.url === 'string' && f.url.length > 0).length,
    sabr: formats.filter((f) => typeof f.serverAbrStreamingUrl === 'string').length,
  };
}

const ids = (arg('--ids') ? arg('--ids').split(',') : DEFAULT_IDS).map((s) => s.trim()).filter(Boolean);

const ip = await egressIp();
console.log(`IP keluar mesin ini: ${ip}`);
console.log('');

let ok = 0;
let tried = 0;
for (const id of ids) {
  for (const clientName of Object.keys(CLIENTS)) {
    tried += 1;
    let r;
    try {
      r = await ask(clientName, id);
    } catch (err) {
      console.log(`VIDEO ${id} | ${clientName.padEnd(10)} | GAGAL JARINGAN: ${err.message}`);
      continue;
    }
    if (r.withUrl > 0) ok += 1;
    console.log(
      `VIDEO ${id} | ${clientName.padEnd(10)} | status=${r.status.padEnd(16)} | format=${String(r.total).padStart(2)} | URL=${String(r.withUrl).padStart(2)} | SABR=${String(r.sabr).padStart(2)}${r.reason ? ` | alasan=${r.reason}` : ''}`,
    );
  }
}

console.log('');
console.log(`HASIL: IP=${ip} | klien dengan URL audio langsung=${ok}/${tried}`);
if (ok === 0) {
  console.log(
    'BACA: tidak ada satu pun URL audio langsung. Ini menunjuk ke IP/egress (atau verifikasi bot), bukan ke daftar klien di application.yml.',
  );
}
