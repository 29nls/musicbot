import { DEFAULT_LOCALE, LOCALES, type Locale } from './types.js';

/** Fungsi penerjemah yang sudah terikat ke satu locale. */
export type Translator = (
  key: MessageKey,
  params?: Record<string, string | number>,
) => string;

/**
 * Katalog teks runtime (embed, balasan, pesan kesalahan).
 *
 * **Katalog ini bukan daftar lengkap, dan itu disengaja untuk sekarang.** Yang
 * sudah ada di sini adalah teks bersama yang dipakai hampir di setiap balasan:
 * judul embed, pesan gate musik, dan pesan `/config`. Sisanya — deskripsi tiap
 * perintah, isi tiap embed fitur — masih ditulis langsung di berkas perintah dan
 * masih berbahasa Indonesia.
 *
 * **Kenapa tidak sekaligus semua?** Karena katalog setengah terisi lebih buruk
 * daripada katalog kosong: orang yang menyalakan bahasa Inggris akan melihat
 * dua bahasa dalam satu layar, dan tidak ada yang bisa menebak mana yang belum
 * diterjemahkan. Jadi teks runtime diterjemahkan bertahap, dan teks yang belum
 * ada **jatuh ke bahasa Indonesia secara sadar**, bukan diam-diam jadi bahasa
 * acak. Lihat `translate()` untuk aturannya.
 *
 * Format nilainya boleh memakai `{nama}`; lihat `interpolate()`.
 */

/** Katalog bahasa Indonesia — sumber kebenaran untuk daftar kuncinya. */
const idMessages = {
  'embed.title.success': '✅ Berhasil',
  'embed.title.warning': '⚠️ Perhatian',
  'embed.title.error': '❌ Terjadi Kesalahan',

  'music.gate.moduleDisabled': 'Modul musik dimatikan di server ini.',
  'music.gate.needVoice': 'Kamu harus berada di voice channel untuk memakai perintah ini.',
  'music.gate.needSameVoice': 'Kamu harus berada di voice channel yang sama dengan bot.',
  'music.gate.needControl': 'Kamu butuh role DJ atau Manage Server untuk memakai perintah ini.',
  'music.gate.notConnected': 'Lavalink belum terhubung, jadi bot tidak bisa memutar lagu.',
  'music.gate.busy': 'Pemutaran sedang berlangsung. Tunggu atau pakai `/skip`.',
  'music.gate.guildOnly': 'Perintah musik hanya bisa dipakai di dalam server.',
  'music.gate.engineDown': 'Mesin musik belum aktif. Coba lagi sebentar lagi.',
  'music.gate.enableHint': 'Nyalakan lewat `/setup` atau `/config`.',
  'music.gate.botElsewhere':
    'Saya sedang memutar lagu di <#{channel}>. Masuk ke channel itu untuk ikut mengatur.',
  'music.gate.needDjRole':
    'Perintah ini hanya untuk role <@&{role}> (atau Manage Server).',
  'music.gate.needManageGuild': 'Perintah ini butuh izin Manage Server.',
  'music.gate.nothingPlaying': 'Tidak ada lagu yang sedang diputar.',
  'music.gate.channelNotVoice':
    'Channel itu bukan voice channel yang bisa saya masuki.',
  'music.gate.notCached': 'Saya belum termuat di server ini. Coba lagi sebentar lagi.',
  'music.gate.missingPermissions':
    'Saya tidak punya izin **Connect** dan **Speak** di <#{channel}>.',
  'music.gate.internalError':
    'Terjadi kesalahan saat memproses perintah musik. Detailnya sudah dicatat di log bot.',

  // ── Musik: embed & label───────────────────────────────────────────
  'music.field.artist': 'Artis',
  'music.field.requestedBy': 'Diminta oleh',
  'music.field.volume': 'Volume',
  'music.field.status': 'Status',
  'music.field.queue': 'Antrean',
  'music.field.playingSince': 'Diputar sejak',
  'music.field.nowPlaying': 'Sedang diputar',
  'music.field.upNext': 'Berikutnya',
  'music.field.fromSpotify': 'Dari Spotify',
  'music.field.loop': 'Loop',
  'music.field.filter': 'Filter',

  'music.value.paused': '⏸️ Dijeda',
  'music.value.playing': '▶️ Diputar',
  'music.value.emptyQueue': 'kosong',
  'music.value.emptyQueueItalic': '*antrean kosong*',
  'music.queueTracks': '{count} lagu • {duration}',
  'music.queue.emptyTitle': 'Antrean kosong',
  'music.queue.emptyHint': 'Tambahkan lagu dengan `/play <judul atau URL>`.',
  'music.queue.allDone': 'Semua lagu sudah selesai. Tambahkan dengan `/play`.',
  'music.queue.upNext': 'Berikutnya — {tracks}',
  'music.queue.upNextPaged': 'Berikutnya (halaman {page}/{total}) — {tracks}',
  'music.queue.hiddenPaged':
    '+{count} lagu lain di halaman lain • pakai tombol untuk berpindah',
  'music.queue.hidden': '+{count} lagu lain tidak ditampilkan',

  'music.nowPlaying.title': '🎶 Antrean Musik',
  'music.nowPlaying.updated': '🎶 Antrean diperbarui',
  'music.nowPlaying.idleFooter': 'Keluar otomatis dalam {duration}',
  'music.nowPlaying.loopFooter': 'Loop: {mode}',

  'music.play.started': '▶️ Mulai diputar sekarang.',
  'music.play.queued': '➕ Ditambahkan ke antrean (posisi **#{position}**).',
  'music.play.moreTracks': '…dan **{count}** lagu lain.',
  'music.play.queueFull': '⚠️ **{count}** lagu tidak ditambahkan karena antrean penuh.',
  'music.play.rejected': '⚠️ **{count}** lagu ditolak ({reason}).',
  'music.play.rejectedExtra': 'Role DJ atau Manage Server boleh memainkannya.',
  'music.play.playlistTitle': '📃 Playlist: {name}',
  'music.play.audioLine': 'Audio: {title}',
  'music.play.audioLineLinked': 'Audio: [{title}]({uri})',
  'music.play.emptyResult':
    'Tidak ada hasil untuk pencarian itu. Coba kata kunci lain atau kirim URL.',
  'music.play.loadFailed': 'Lagu ini tidak bisa dimuat: {message}',
  'music.play.queueFullMessage':
    'Antrean sudah penuh (batas {max} lagu). Tunggu sampai ada lagu yang selesai.',
  'music.play.rejectedTitle': 'Lagu Ditolak Batas Durasi',
  'music.play.lavalinkDown':
    'Lavalink belum terhubung, jadi lagu tidak bisa diputar. Cek `docker compose logs lavalink`.',

  'music.search.title': '🗑 Hasil pencarian',
  'music.search.forQuery': 'Hasil untuk `{query}` — pilih satu dari menu di bawah.',
  'music.search.pickOne': 'Pilih satu dari menu di bawah.',
  'music.search.topResults': '{count} hasil teratas',
  'music.search.placeholder': 'Pilih lagu untuk diputar',
  'music.search.footer':
    'Menu berlaku 15 menit. Pilih satu untuk langsung diputar.',
  'music.search.expired':
    'Pilihan pencarian ini sudah tidak berlaku. Ulangi `/search` untuk mencari lagi.',
  'music.search.unknown':
    'Pilihan ini tidak lagi dikenali. Ulangi `/search` untuk mencari lagi.',
  'music.search.invalidPick': 'Pilihan itu tidak valid. Ulangi `/search`.',
  'music.search.notOwner':
    'Menu ini milik orang lain. Jalankan `/search` sendiri untuk memilih.',
  'music.search.needVoice': 'Masuk ke voice channel dulu supaya saya bisa memutar.',
  'music.search.failedTitle': 'Pencarian gagal',
  'music.search.failedBody': 'Lavalink menjawab: {message}',
  'music.search.unavailableTitle': 'Lavalink belum terhubung',
  'music.search.unavailableBody':
    'Cari lagu tidak bisa jalan sebelum node Lavalink aktif. Cek `docker compose logs lavalink`.',
  'music.search.noResultsTitle': 'Tidak ada hasil',
  'music.search.sessionFailed':
    'Hasil pencarian tidak bisa disimpan sebentar, jadi menunya tidak bisa dibuat. ' +
    'Coba lagi beberapa saat lagi.',

  'music.nav.first': 'Awal',
  'music.nav.previous': 'Sebelumnya',
  'music.nav.next': 'Berikutnya',
  'music.nav.last': 'Akhir',
  'music.nav.tooOld': 'Pesan antrean ini sudah terlalu lama untuk diubah. Jalankan `/queue` lagi.',
  'music.nav.unknown': 'Tombol ini tidak lagi dikenali. Jalankan `/queue` lagi.',

  'music.limit.tooLong': 'lebih dari 6 jam',
  'music.limit.needsControl': 'lebih dari 30 menit dan peminta bukan DJ',
  'music.limit.reasonTooLong': 'melewati batas {duration}',
  'music.limit.reasonNeedsControl': 'lebih dari {duration}',
  'music.limit.reasonNeedsControlStream': 'lebih dari {duration} (atau live stream)',
  'music.limit.rejectedTooLong':
    '{count} lagu ditolak: durasinya {reason}. Batas ini berlaku untuk semua orang, ' +
    'termasuk DJ — ini untuk mencegah lagu radio yang memblokir player.',
  'music.limit.rejectedNeedsControl':
    '{count} lagu ditolak: {reason}. Coba lagi dengan role DJ atau Manage Server, ' +
    'atau pilih lagu yang lebih pendek.',

  'music.loop.off': 'Mati',
  'music.loop.track': 'Ulangi lagu',
  'music.loop.queue': 'Ulangi antrean',
  'music.filter.off': 'Normal (tanpa filter)',
  'music.filter.bassboost': 'Bassboost',
  'music.filter.nightcore': 'Nightcore',
  'music.filter.vaporwave': 'Vaporwave',
  'music.filter.8d': '8D',
  'music.play.spotifyUnsupported': 'Tautan Spotify Tidak Bisa Dipakai',
  'music.play.spotifyNotConfigured':
    'Metadata Spotify belum aktif karena `SPOTIFY_CLIENT_ID`/`SPOTIFY_CLIENT_SECRET` belum diisi di .env.',
  'music.play.spotifyNotConfiguredTitle': 'Spotify Belum Dikonfigurasi',
  'music.play.spotifyNotFound': 'Lagu tidak ditemukan di Spotify',
  'music.play.spotifySearchFailed': 'Tidak bisa mencari audio untuk lagu itu: {message}',
  'music.play.spotifyNoMatch':
    'Tidak ada hasil pencarian yang cocok dengan **{title}** di Spotify.\n\n' +
    '{tried} kandidat diperiksa dan semuanya berbeda judul atau durasinya. ' +
    'Coba cari lagunya dengan kata kunci biasa.',
  'music.play.spotifyNoMatchTitle': 'Audio Tidak Cocok',
  'music.play.spotifyFailed': 'Gagal Meminta Metadata Spotify',

  'music.nowPlaying.nothingTitle': 'Tidak ada lagu',
  'music.nowPlaying.nothingBody': 'Bot sedang tidak memutar apa pun di server ini.',

  'music.control.nothingToPause': 'Tidak ada pemutaran aktif.',
  'music.control.cannotPauseTitle': 'Tidak Bisa Dijeda',
  'music.control.pausedTrack': '{track} dijeda. Lanjutkan dengan `/resume`.',
  'music.control.pausedTitle': 'Dijeda',
  'music.control.nothingToResume': 'Tidak ada pemutaran aktif untuk dilanjutkan.',
  'music.control.resumedTrack': '{track} dilanjutkan.',
  'music.control.resumedTitle': 'Dilanjutkan',
  'music.control.skippedTrack': 'Melewati {track}',
  'music.control.nowPlayingTrack': 'Sekarang diputar: {track}',
  'music.control.queueEmpty':
    'Antrean habis. Bot keluar otomatis kalau tidak ada lagu baru.',
  'music.control.skippedTitle': 'Lagu Dilewati',
  'music.control.stoppedTrack': 'Dihentikan: {track}',
  'music.control.stoppedTitle': 'Dihentikan',
  'music.control.queueCleared':
    'Antrean dibersihkan. Bot keluar dari voice channel otomatis dalam ' +
    '**{seconds} detik** kalau tidak ada lagu baru.',

  'music.shuffle.tooShortTitle': 'Antrean terlalu pendek untuk diacak',
  'music.shuffle.tooShortBody': 'Butuh minimal dua lagu di antrean.',
  'music.shuffle.done': '**{count}** lagu diacak urutannya.',
  'music.shuffle.title': 'Antrean Diacak',

  'music.loop.unknownMode': 'Mode tidak dikenal. Pilihan yang tersedia: {options}.',
  'music.loop.disabledText': 'Loop dimatikan (sebelumnya {from}).',
  'music.loop.changedText': 'Loop diubah dari {from} ke **{to}**.',
  'music.loop.title': 'Mode Loop',

  'music.filter.unknownMode': 'Mode tidak dikenal. Pilihan yang tersedia: {options}.',
  'music.filter.disabledText': '{emoji} Filter dimatikan (sebelumnya {from}).',
  'music.filter.changedText': '{emoji} Filter diubah dari {from} ke **{to}**.',
  'music.filter.pending': 'Akan berlaku saat pemutaran dimulai.',
  'music.filter.title': 'Filter Audio',

  'music.volume.muted': 'Volume dimatikan. Pakai `/volume 100` untuk menyalakan lagi.',
  'music.volume.changed': 'Volume diubah ke **{volume}%**.',
  'music.volume.clipping': ' Di atas 100% suara bisa pecah.',
  'music.volume.title': 'Volume',

  'music.disconnect.left': 'Saya keluar dari voice channel. Antrean sudah dikosongkan.',
  'music.disconnect.nowhere':
    'Saya memang tidak sedang berada di voice channel mana pun.',
  'music.disconnect.title': 'Bot Keluar',

  'music.seek.live': 'Lagu ini siaran langsung, jadi tidak ada posisi untuk dilompat.',
  'music.seek.pastEnd': 'Posisi itu melewati akhir lagu.',
  'music.seek.tooLarge': 'Posisi terlalu jauh — maksimal 6 jam.',
  'music.seek.unreadable':
    'Posisi tidak terbaca. Contoh yang diterima: `90`, `1:30`, atau `1m30s`.',
  'music.seek.jumped': 'Lompat ke **{position}** dari {total}.',
  'music.seek.jumpedTitle': 'Lompat Posisi',
  'music.seek.unavailable':
    'Lagu tidak bisa dilompat sekarang. Coba lagi setelah lagu berikutnya dimulai.',

  'music.queue.moveEmpty': 'Antrean sedang kosong.',
  'music.queue.removeEmpty': 'Antrean sedang kosong, jadi tidak ada yang bisa dihapus.',
  'music.queue.wrongNumber':
    'Antrean hanya berisi {count} lagu. Periksa nomornya dengan `/queue`.',
  'music.queue.removed':
    '{track} dihapus dari posisi **{position}**.\nSisa antrean: **{remaining}** lagu.',
  'music.queue.removedTitle': 'Lagu Dihapus',
  'music.queue.moveFailed':
    'Posisi tidak bisa dipindahkan. Periksa nomor yang dimasukkan.',
  'music.queue.moveSame': '{track} sudah berada di posisi **{position}**.',
  'music.queue.moveDone': '{track} dipindahkan dari **{from}** ke **{to}**.',
  'music.queue.retitledTitle': 'Antrean Ditata ulang',

  'music.lyrics.nothingPlaying':
    'Tidak ada lagu yang sedang diputar. Tambahkan dulu dengan `/play`.',
  'music.lyrics.notFound': 'Lirik tidak ditemukan',
  'music.lyrics.sourceProblem': 'Sumber Lirik Bermasalah',

  'music.search.noResults':
    'Tidak menemukan apa pun untuk `{query}`. Coba kata kunci lain atau kirim URL.',

  'music.stay.guildOnly': 'Mode 24/7 hanya bisa diubah di dalam server.',
  'music.stay.needDjRole':
    'Mode 24/7 hanya bisa diubah role <@&{role}> (atau Manage Server).',
  'music.stay.needManageGuild':
    'Menyalakan atau mematikan mode 24/7 butuh izin Manage Server.',
  'music.stay.needChannel':
    'Sebutkan voice channel-nya dengan `/247 join channel:#musik`, atau masuk ke ' +
    'voice channel dulu lalu jalankan `/247 join`.',
  'music.stay.joinFailed':
    'Mode 24/7 sudah disimpan untuk <#{channel}>, tapi bot belum berhasil masuk: ' +
    '{error}. Dicoba lagi otomatis dalam beberapa menit.',
  'music.stay.joined':
    'Bot akan menjaga <#{channel}> 24/7 dan tidak keluar otomatis meski tidak ada ' +
    'lagu. Matikan dengan `/247 leave`.',
  'music.stay.alreadyThere': 'Bot sudah menjaga <#{channel}> 24/7.',
  'music.stay.pending':
    'Mode 24/7 aktif untuk <#{channel}>. Bot pindah ke sana setelah lagu yang ' +
    'sedang diputar selesai.',
  'music.stay.activeTitle': 'Mode 24/7 Aktif',
  'music.stay.savingTitle': 'Mode 24/7 Menyimpan',
  'music.stay.neverStarted': 'Mode ini belum pernah diaktifkan di server ini.',
  'music.stay.offTitle': 'Mode 24/7 Mati',
  'music.stay.offWhilePlaying':
    'Mode 24/7 dimatikan. Bot menyelesaikan lagu yang sedang diputar, lalu keluar ' +
    'mengikuti pengaturan waktu idle.',
  'music.stay.offAndLeft': 'Mode 24/7 dimatikan dan bot keluar dari voice channel.',
  'music.stay.offNotConnected':
    'Mode 24/7 dimatikan. Bot memang tidak sedang berada di voice channel mana pun.',
  'music.stay.statusTitle': 'Status Mode 24/7',
  'music.stay.statusOff': 'Mode ini belum aktif. Nyalakan dengan `/247 join`.',
  'music.stay.statusStaying':
    'Bot sedang menjaga <#{channel}> dan tidak akan keluar otomatis.',
  'music.stay.statusElsewhere':
    'Mode aktif untuk <#{channel}>, tapi bot belum ada di sana ({reason}).',
  'music.stay.fieldChannel': 'Channel 24/7',
  'music.stay.fieldPosition': 'Posisi bot',
  'music.stay.fieldIdle': 'Keluar otomatis',
  'music.stay.fieldSummary': 'Status ringkas',
  'music.stay.fieldNextAction': 'Tindakan berikutnya',
  'music.stay.notEnabled': 'Tidak diaktifkan',
  'music.stay.outsideVoice': 'Di luar voice channel',
  'music.stay.idleNo': 'Tidak, selama mode 24/7 aktif',
  'music.stay.idleYes': 'Ya, setelah {seconds} detik tanpa lagu',
  'music.stay.labelModuleOff': 'Modul musik mati',
  'music.stay.labelOff': 'Mati',
  'music.stay.labelHere': 'Aktif di <#{channel}>',
  'music.stay.labelPending': 'Aktif, belum sampai <#{channel}>',

  'stats.guildOnly': 'Statistik hanya tersedia di dalam server.',
  'playlist.guildOnly': 'Perintah ini hanya bisa dipakai di dalam server.',
  'mod.gate.guildOnly': 'Perintah ini hanya bisa dipakai di dalam server.',
  'mod.gate.needsPermission': 'Perintah ini butuh izin **{permission}**.',
  'mod.gate.moduleDisabled':
    'Modul moderasi dimatikan di server ini. Nyalakan lewat `/setup` atau `/config`.',
  'mod.gate.botNotLoaded': 'Aku belum termuat di server ini. Coba lagi sebentar lagi.',
  'mod.gate.botLacksPermission': 'Aku tidak punya izin **{permission}** di server ini.',
  'mod.gate.channelOnly': 'Perintah ini hanya bisa dipakai di channel server.',
  'mod.gate.textVoiceOnly':
    'Perintah ini hanya bisa dipakai di channel teks atau voice — bukan thread atau kategori.',
  'mod.internalError':
    'Terjadi kesalahan saat memproses aksi moderasi. Detailnya sudah dicatat di log bot.',
  'mod.databaseDown':
    'Database tidak bisa dihubungi, jadi aksi moderasi tidak dijalankan dan tidak ada yang dicatat.\n' +
    'Periksa `DATABASE_URL` di .env dan koneksi internetmu; `npm run infra:up` hanya berlaku kalau memakai Postgres lokal.',
  'mod.databaseDownTitle': 'Database Offline',

  'mod.action.note': 'Catatan',
  'mod.action.successSuffix': 'Berhasil',

  'mod.field.case': 'Kasus',
  'mod.field.target': 'Target',
  'mod.field.moderator': 'Moderator',
  'mod.field.reason': 'Alasan',
  'mod.field.expires': 'Berakhir',
  'mod.field.status': 'Status',
  'mod.field.time': 'Waktu',
  'mod.field.currentState': 'Kondisi sekarang',
  'mod.field.notification': 'Notifikasi',
  'mod.field.amount': 'Jumlah',
  'mod.field.channel': 'Channel',
  'mod.field.filter': 'Filter',
  'mod.field.actionSpread': 'Sebaran aksi',
  'mod.reason.missing': '*tidak disebutkan*',
  'mod.reason.noneShort': '*tanpa alasan*',
  'mod.reason.noneNote': '*tanpa isi*',
  'mod.dm.sent': 'DM ke target terkirim',
  'mod.dm.closed': 'DM ke target tidak terkirim (DM tertutup)',
  'mod.dm.notSent': 'DM ke target tidak terkirim (DM tertutup atau bot diblokir).',
  'mod.dm.contactModerator':
    'Kalau kamu merasa ini keliru, hubungi moderator server.',
  'mod.dm.revokedTitle': '✅ Peringatan dicabut di {server}',
  'mod.dm.revokedBody': 'Peringatan `{case}` dicabut oleh <@{moderator}>.',
  'mod.dm.banTitle': '🔨 Kamu di-ban dari {server}',
  'mod.dm.kickTitle': '👢 Kamu di-kick dari {server}',
  'mod.dm.timeoutTitle': '⏳ Kamu di-timeout di {server}',
  'mod.dm.warnTitle': '⚠️ Kamu mendapat peringatan di {server}',
  'mod.dm.unbanTitle': '🔓 Ban-mu di server {server} telah dibuka',

  'mod.log.revokedTitle': 'Peringatan Dicabut',
  'mod.log.purgeTitle': '🧹 Purge Pesan',
  'mod.log.messagesCount': '{count} pesan',

  'mod.case.statusActive': '✅ Aktif',
  'mod.case.statusRevoked': '♻️ Dicabut oleh moderator',
  'mod.case.statusInactive': '❌ Nonaktif — aksi Discord gagal dieksekusi',
  'mod.case.inactiveSuffix': ' · *nonaktif*',
  'mod.case.by': 'oleh <@{moderator}>',
  'mod.case.banned': '🔒 Masih diblokir dari server',
  'mod.case.unbanned': '✅ Sudah tidak diblokir dari server',
  'mod.case.banUnknown': '⚪ Status blokir tidak bisa diperiksa',
  'mod.case.timeoutActive': '⏳ Masih timeout sampai <t:{when}:R>',
  'mod.case.timeoutExpired': '✅ Sudah tidak timeout',
  'mod.case.timeoutUnknown': '⚪ Tidak sedang timeout atau tidak bisa diperiksa',
  'mod.case.dmSent': '✅ DM notifikasi terkirim ke target',
  'mod.case.dmFailed':
    '⚠️ DM notifikasi **tidak terkirim** — DM-nya tertutup atau bot diblokir',
  'mod.case.dmUnrecorded':
    '❔ Status pengiriman DM tidak tercatat (kasus dibuat sebelum fitur ini ada)',
  'mod.case.expired': '<t:{when}:f> — *sudah lewat*',
  'mod.case.historyTitle': 'Riwayat {target}',
  'mod.case.historyEmpty':
    'Tidak ada kasus lain atas target ini — ini satu-satunya kasusnya.',
  'mod.case.historyHidden':
    '\n\n*+{count} kasus lain tidak ditampilkan.*',
  'mod.case.historyFooter': '{count} kasus lain tercatat untuk target ini',
  'mod.case.parseError':
    'Nomor kasus tidak dikenali. Contoh yang diterima: `#CASE-0142`, `142`, atau `CASE 142`.',
  'mod.case.parseErrorTitle': 'Format Salah',
  'mod.case.notFound':
    'Kasus `{case}` tidak ada di server ini.\n' +
    'Nomor kasus berbeda antar server — pastikan memakai nomor dari server ini.',
  'mod.case.notFoundTitle': 'Kasus Tidak Ditemukan',
  'mod.case.relatedLogsTitle': '📎 Log terkait',
  'mod.case.relatedLogsFooter':
    'Log sekitar ±1 jam · `/logs case:{case}` untuk daftar kasus ini saja',

  'mod.profile.empty': 'Belum ada kasus yang tercatat untuk moderator ini.',
  'mod.profile.title': '🛡️ Profil Moderator — {name}',
  'mod.profile.footer':
    'Hanya kasus yang tercatat Harmony · data lama dihapus setelah 12 bulan',
  'mod.profile.recentTitle': '🗂️ Kasus Terbaru',
  'mod.profile.recentEmpty':
    'Belum ada kasus yang tercatat untuk moderator ini di server ini.',
  'mod.profile.detailHint': ' · `/case kasus:NNN` untuk detailnya',
  'mod.profile.ofTotal': '{shown} terbaru dari {total} kasus{hint}',
  'mod.profile.recentCount': '{count} kasus terbaru{hint}',
  'mod.profile.actionsEmpty': '*Belum ada kasus tercatat.*',
  'mod.profile.actionFailed': ' · ⚠️ {count} gagal',
  'mod.profile.totalCases': 'Total kasus **{count}**',
  'mod.profile.uniqueTargets': 'Target unik **{count}** orang',
  'mod.profile.perTarget': 'Rata-rata **{count}** kasus per target',
  'mod.profile.activeWindow': '{count} kasus dalam {days} hari terakhir',
  'mod.profile.noRecent': 'Tidak ada kasus dalam {days} hari terakhir',
  'mod.profile.failedLine':
    '⚠️ {count} kasus tercatat tapi aksi Discord-nya gagal dieksekusi',
  'mod.profile.revokedLine': '♻️ {count} peringatan dicabut kembali',
  'mod.profile.stateRevoked': ' · *dicabut*',
  'mod.profile.stateFailed': ' · *gagal*',
  'mod.profile.emptyForUser':
    'Belum ada kasus yang tercatat atas nama {moderator}.\n' +
    'Yang tercatat di sini hanya aksi lewat Harmony — ban atau timeout yang ' +
    'dilakukan manual dari Discord tidak punya kasus.',
  'mod.profile.emptyForUserTitle': '🛡️ Belum Ada Aktivitas',

  'mod.prior.title': '🗂️ Riwayat terkait <@{target}>',
  'mod.prior.activeWarnings':
    '⚠️ **{count} peringatan masih aktif** — target sudah diberi tahu sebelumnya.',
  'mod.prior.revokedWarnings': '♻️ **{count}** peringatan sebelumnya dicabut moderator.',
  'mod.prior.priorBans': '🔁 Target **pernah di-ban {count}×** di server ini.',
  'mod.prior.totalLine': '📋 Total **{count}** kasus sebelumnya — {breakdown}.',
  'mod.prior.moreActions': '+{count} jenis lain',
  'mod.prior.inactive': ' _({count} nonaktif)_',
  'mod.prior.hint':
    ' · `/case kasus:{case}` untuk detail',
  'mod.prior.footer': '{count} kasus sebelumnya tercatat di Harmony{hint}',

  'mod.warnings.title': '⚠️ Peringatan — {target}',
  'mod.warnings.footer': 'Total {count} peringatan tercatat',
  'mod.warnings.empty': 'Tidak ada peringatan yang tercatat untuk user ini.',
  'mod.notes.title': '📝 Catatan Internal — {target}',
  'mod.notes.empty': 'Belum ada catatan untuk user ini.',
  'mod.notes.footer': '{count} catatan terbaru ditampilkan',

  'mod.hierarchy.self': 'Kamu tidak bisa memoderasi dirimu sendiri.',
  'mod.hierarchy.botSelf':
    'Aku tidak bisa memoderasi diriku sendiri. Pakai Discord langsung kalau memang perlu.',
  'mod.hierarchy.owner': 'Pemilik server tidak bisa dimoderasi oleh bot.',
  'mod.hierarchy.botOutranked':
    'Role target lebih tinggi atau setara dengan role-ku, jadi aku tidak punya kuasa untuk memoderasinya.',
  'mod.hierarchy.actorOutranked':
    'Role target lebih tinggi atau setara dengan role-mu. Minta moderator yang lebih senior.',

  'mod.audit.noReason': 'Tanpa alasan',
  'mod.audit.by': 'oleh {actor} ({id})',
  'mod.audit.mention': 'oleh <@{moderator}>',
  'mod.delivery.logMissing':
    '⚠️ Channel log belum diatur atau tidak bisa dikirim, jadi log tidak tersimpan.',
  'mod.parse.badUserId':
    'Masukkan **ID user** yang valid (17–20 digit), bukan nama atau mention.',
  'mod.parse.unknownAction': 'Aksi {action}',
  'mod.parse.badCaseFormat':
    'Format kasus tidak dikenal. Contoh: `#CASE-0007` atau `7`.',
  'mod.notMember.kick':
    'User itu bukan anggota server ini, jadi tidak bisa di-kick.',
  'mod.notMember.timeout':
    'User itu bukan anggota server ini, jadi tidak bisa di-timeout.',
  'mod.gate.textChannelOnly':
    'Perintah ini hanya bisa dipakai di channel teks dalam server.',
  'mod.purge.noMatch':
    'Tidak ada pesan yang cocok dengan filter itu dalam rentang yang diperiksa.',

  'mod.ban.deleteMessages':
    '🧹 Pesan dari **{days}** hari terakhir ikut dihapus.',
  'mod.ban.notBanned': 'User `{id}` tidak sedang di-ban di server ini.',

  'mod.unwarn.revokedLine':
    'Peringatan `{case}` milik <@{target}> sudah dicabut.',
  'mod.warn.totalLine': '📊 Total peringatan tercatat: **{count}**',
  'mod.warnings.moreHidden': '*+{count} peringatan lain tidak ditampilkan.*',

  'mod.timeout.badDuration':
    'Durasi `{value}` tidak valid. Pakai format seperti `30s`, `10m`, `2h`, atau `7d` (maksimal 28 hari).',
  'mod.timeout.appliedLine': '⏳ Timeout selama **{duration}**.',
  'mod.note.internalLine': '📝 Catatan internal — target tidak diberi tahu.',

  'mod.purge.filterAuthor': 'Penulis: <@{id}>',
  'mod.purge.filterContains': 'Mengandung: `{value}`',
  'mod.purge.deletedLine': '🧹 **{count}** pesan dihapus dari <#{channel}>.',
  'mod.purge.skippedLine':
    'ℹ️ **{count}** pesan tidak bisa dihapus (lebih tua dari 14 hari atau dipinned).',
  'mod.purge.doneTitle': '🧹 Purge Selesai',

  'mod.slowmode.badDuration':
    'Durasi `{value}` tidak valid. Pakai `0`/`off`, `30s`, `5m`, atau `2h` (maksimal 6 jam).',
  'mod.slowmode.offLine': '🐌 Slowmode **dimatikan**.',
  'mod.slowmode.setLine': '🐌 Slowmode disetel ke **{duration}**.',

  'mod.lock.deniedLine':
    '🔒 `{channel}` ditolak untuk **@everyone** di channel ini.',
  'mod.unlock.restoredLine':
    '🔑 `{channel}` kembali mengikuti izin default server.',

  'mod.logs.empty': 'Tidak ada entri log yang tercatat.',
  'mod.logs.moreHidden':
    '*+{count} entri lain tidak ditampilkan — pakai `/logs` untuk melihat semuanya.*',


  'log.category.member': 'Member',
  'log.category.message': 'Pesan',
  'log.category.channel': 'Channel',
  'log.category.role': 'Role',
  'log.category.voice': 'Voice',
  'log.category.server': 'Server',
  'log.event.guildBanAdd': 'Member di-ban',
  'log.event.guildBanRemove': 'Ban dilepas',
  'log.event.guildMemberAdd': 'Member bergabung',
  'log.event.guildMemberRemove': 'Member keluar',
  'log.event.guildMemberUpdate': 'Member diperbarui',
  'log.event.messageDelete': 'Pesan dihapus',
  'log.event.messageUpdate': 'Pesan diedit',
  'log.event.messageBulkDelete': 'Pesan dihapus massal',
  'log.event.channelCreate': 'Channel dibuat',
  'log.event.channelDelete': 'Channel dihapus',
  'log.event.channelUpdate': 'Channel diperbarui',
  'log.event.guildRoleCreate': 'Role dibuat',
  'log.event.guildRoleDelete': 'Role dihapus',
  'log.event.guildRoleUpdate': 'Role diperbarui',
  'log.event.voiceStateUpdate': 'Perubahan voice',
  'log.event.guildUpdate': 'Server diperbarui',
  'log.event.guildEmojiCreate': 'Emoji ditambahkan',
  'log.event.guildEmojiUpdate': 'Emoji diubah',
  'log.event.guildEmojiDelete': 'Emoji dihapus',
  'log.event.guildStickerCreate': 'Stiker ditambahkan',
  'log.event.guildStickerUpdate': 'Stiker diubah',
  'log.event.guildStickerDelete': 'Stiker dihapus',
  'log.field.changes': 'Perubahan',
  'log.field.reason': 'Alasan',
  'log.field.source': 'Sumber',
  'log.field.case': 'Kasus',
  'log.field.moderator': 'Moderator',
  'log.source.harmony': '🤖 Harmony (perintah bot)',
  'log.source.botOutside': '🤖 Bot — di luar kasus Harmony',
  'log.source.otherModerator': '👤 Moderator lain (<@{user}>)',
  'log.summary.case': '🤖 Harmony · Kasus `{case}`',
  'log.summary.by': 'Oleh: <@{user}>',
  'log.summary.channel': 'Channel: <#{channel}>',
  'log.summary.jump': '[Lompat ke pesan log]({url})',
  'log.filter.category': 'Kategori: {value}',
  'log.filter.user': 'User: <@{user}>',
  'log.filter.channel': 'Channel: <#{channel}>',
  'log.filter.keyword': 'Kata kunci: `{value}`',
  'log.filter.case': 'Kasus: `{value}`',
  'log.filter.from': 'Dari: <t:{value}:f>',
  'log.filter.to': 'Sampai: <t:{value}:f>',
  'log.filter.all': 'Semua kategori · tanpa batas waktu',
  'log.results.title': '🔎 Riwayat Log',
  'log.results.footer': 'Halaman {page} · entri {first}–{last} dari {total}',
  'log.results.nextTitle': 'Halaman berikutnya',
  'log.results.nextValue': 'Masih ada entri lain — jalankan ulang dengan `page:{page}`.',
  'log.results.noMatch': 'Tidak ada entri yang cocok.\n\n**Filter:** {filter}',
  'log.stats.title': '📊 Statistik Log',
  'log.stats.footer': '{total} event · {from} – {to}',
  'log.stats.period': '**Periode:** {from} – {to}',
  'log.stats.periodDefault':
    '\n\n_Periode default: seluruh masa simpan riwayat. Batonai `from:` untuk mempersempit._',
  'log.stats.categoriesField': 'Event per kategori',
  'log.stats.topActionsField': 'Aksi teratas ({count})',
  'log.stats.topMembersField': 'Member paling sering terkait ({count})',
  'log.stats.noActions': 'Tidak ada event pada periode ini.',
  'log.stats.noMembers': 'Tidak ada member yang tercatat pada periode ini.',
  'log.stats.roleTarget': '🎯 {count} jadi target',
  'log.stats.roleExecutor': '⚡ {count} melakukan',
  'log.diff.yes': 'Ya',
  'log.diff.no': 'Tidak',
  'log.diff.overwriteAdded': 'overwrite **ditambahkan**',
  'log.diff.overwriteRemoved': 'overwrite **dihapus**',
  'log.diff.allowAdd': 'izinkan +{names}',
  'log.diff.allowRemove': 'izinkan -{names}',
  'log.diff.denyAdd': 'tolak +{names}',
  'log.diff.denyRemove': 'tolak -{names}',
  'log.export.allCategories': 'semua kategori',
  'log.export.collected': 'Menhimpun **{exported}** dari **{total}** entri ({categories}).',
  'log.export.truncated': '⚠️ Dipotong di {max} entri terbaru — perlebar atau persempit filter agar lengkap.',
  'log.export.saved': '📁 Tersimpan di server: `{path}`',
  'log.export.attachment': '📎 Lampiran: `{file}` ({size})',
  'log.export.title': '📤 Ekspor Log Selesai',
  'log.export.tooBig':
    'File ekspor terlalu besar ({size} MB).\nPersempit dengan filter kategori, user, atau rentang tanggal lalu coba lagi.',
  'log.export.tooBigTitle': 'Ekspor Terlalu Besar',
  'log.err.invalidId': 'ID {label} tidak valid: `{value}`.',
  'log.err.unknownCategory': 'Kategori `{value}` tidak dikenal.',
  'log.err.unknownUnit': 'Format tanggal `{label}` tidak dikenali.',
  'log.err.invalidDate':
    'Tanggal `{label}` tidak valid. Contoh yang diterima: `7d`, `24h`, `2026-10-02`, atau `02/10/2026`.',
  'log.err.dateMissing': 'Tanggal `{label}` tidak ada di kalender.',
  'log.err.rangeReversed': 'Rentang tanggal terbalik — `from` harus lebih dulu dari `to`.',
  'log.err.badCase':
    'Nomor kasus tidak valid. Contoh yang diterima: `#CASE-0142`, `0142`, atau `142`.',
  'log.err.keywordTooLong': 'Kata kunci terlalu panjang (maks 100 karakter).',
  'log.err.pageNotInteger': 'Nomor halaman harus bilangan bulat mulai dari 1.',
  'log.err.pageMax': 'Halaman maksimal {max}.',
  'log.error.rejectedTitle': 'Pengaturan Log Ditolak',
  'log.error.dbOfflineTitle': 'Database Offline',
  'log.error.dbOffline':
    'Database tidak bisa dihubungi, jadi routing log belum bisa dibaca atau disimpan.\nPeriksa `DATABASE_URL` di .env dan koneksi internetmu; `npm run infra:up` hanya berlaku kalau memakai Postgres lokal.',
  'log.error.generic':
    'Terjadi kesalahan saat mengakses pengaturan log. Detailnya sudah dicatat di log bot.',
  'log.cmd.moduleOff':
    'Modul logging sedang mati, jadi tidak ada riwayat yang dikumpulkan.\nNyalakan dengan `/config set logging:true` lalu tunggu event berikutnya tercatat.',
  'log.cmd.moduleOffTitle': 'Logging Mati',
  'log.cmd.conflict': 'Opsi `stats` dan `format` tidak bisa dipakai bersamaan.\nJalankan `/logs stats:true` untuk ringkasan di Discord, atau `/logs format:…` untuk mengunduh data mentahnya.',
  'log.cmd.conflictTitle': 'Mode Bertabrakan',
  'log.cmd.checkAgain': 'Cek lagi',
  'log.cmd.checkAgainHistory':
    'Riwayat hanya berisi event yang terjadi setelah modul logging dinyalakan, dan disimpan selama {days} hari. Perlebar rentang tanggal atau kosongkan filter.',
  'log.cmd.checkAgainStats':
    'Statistik dihitung dari riwayat yang tersimpan sepanjang {days} hari terakhir. Perlebar rentang tanggal (`from:`/`to:`) atau kosongkan filter.',
  'log.cmd.routingTitle': 'Routing Log',
  'log.cmd.routingSet': 'Log **{category}** diarahkan ke <#{channel}>.',
  'log.cmd.routingReset': 'Routing **{category}** dihapus — kembali memakai channel log global.',
  'log.cmd.routingGlobal': '(global)',
  'log.cmd.routingUnset': 'belum diatur',
  'log.cmd.moduleStatus': 'Status modul',
  'log.cmd.moduleOn': 'Logging aktif.',
  'log.cmd.moduleOffLine': 'Logging mati — nyalakan lewat `/config set logging:true` atau wizard `/setup`.',

  'playlist.created':
    'Playlist **{name}** dibuat. Tambahkan lagu dengan ' +
    '`/playlist add {name} <judul atau URL>`.',
  'playlist.createdTitle': 'Playlist Dibuat',
  'playlist.removedTrack':
    'Lagu dihapus. **{name}** kini berisi {count} lagu.',
  'playlist.nonePlayable':
    'Tidak ada satu pun dari {count} lagu yang masih bisa diputar. ' +
    'Sumbernya mungkin sudah tidak tersedia.',
  'playlist.partialLoad': '{failed} dari {count} lagu gagal dimuat dan dilewati.',
  'playlist.fieldOwner': 'Playlist',
  'playlist.deleted': 'Playlist **{name}** dihapus.',
  'playlist.title': 'Playlist',
  'playlist.unknownSub': 'Subcommand itu tidak dikenal.',
  'playlist.needQuery':
    'Tidak ada lagu yang sedang diputar. Sebutkan judul/URL, atau putar lagu dulu baru simpan.',
  'playlist.notFoundQuery': 'Tidak menemukan apa pun untuk `{query}`.',
  'playlist.loadFailed': 'Lagu itu tidak bisa dimuat: {message}',
  'playlist.lavalinkDown':
    'Lavalink belum terhubung, jadi lagu tidak bisa dicari. Cek `docker compose logs lavalink`.',
  'playlist.errNameTaken':
    'Kamu sudah punya playlist bernama **{name}**. Ganti nama, atau hapus yang lama dulu.',
  'playlist.errNoPublic':
    'Tidak ada playlist publik dengan nama itu. Buat atau bagikan dulu lewat `/playlist`.',
  'playlist.errNotFound': 'Playlist itu tidak ada. Cek `/playlist list`.',
  'playlist.errEmpty': 'Playlist masih kosong.',
  'playlist.errFull':
    'Playlist sudah berisi batas **{limit}** lagu. Hapus satu dulu sebelum menambah.',
  'playlist.errStillEmpty': 'Playlist ini masih kosong, jadi tidak ada yang bisa dihapus.',
  'playlist.errOutOfRange': 'Posisi itu di luar jangkauan. Playlist ini berisi **{count}** lagu.',
  'playlist.errNotOwner': 'Playlist itu bukan milikmu, jadi tidak bisa diubah.',
  'playlist.errPrivate': 'Playlist itu privat.',
  'playlist.errUnknown': 'Permintaan itu tidak bisa diproses.',
  'stats.trackTitle': 'Statistik Musik',
  'stats.commandTitle': 'Statistik Perintah',
  'stats.emptyTrack': 'Belum ada data pemutaran dalam {days} hari terakhir.',
  'stats.emptyCommand': 'Belum ada data pemakaian perintah dalam {days} hari terakhir.',
  'stats.fieldTopTrack': 'Lagu paling sering',
  'stats.fieldTopCommand': 'Perintah paling sering',
  'stats.fieldDaily': 'Harian',
  'stats.footerRange':
    '{since} sampai {until} (UTC) | {active} dari {days} hari ada aktivitas | tanpa data pribadi',
  'stats.summaryTrack': '**{count}x** pemutaran, {listened} didengarkan',
  'stats.summaryCommand': '**{count}x** perintah dipakai',
  'stats.peakDay': ' Hari paling ramai: **{day}** ({count}).',
  'stats.summaryTail': '{total} dalam {days} hari terakhir.{peak}',
  'stats.dailyEmpty': '*Tidak ada data.*',
  'stats.weeklyNote': '_Rentang dijumlahkan per minggu: {days} hari jadi {weeks} blok._',
  'stats.unavailable':
    'Statistik tidak bisa dimuat sekarang. Detailnya sudah dicatat di log bot.',

  'config.locale.changed': 'Bahasa server ini sekarang {locale}.',
  'config.locale.unknown':
    'Bahasa itu tidak dikenal. Pilihan yang tersedia: {available}.',
} as const;

/** Nama kunci yang sah, diturunkan dari katalog Indonesia. */
export type MessageKey = keyof typeof idMessages;

/** Katalog bahasa Inggris. Tipenya memaksa semua kunci Indonesia ada di sini. */
const enMessages: Record<MessageKey, string> = {
  'embed.title.success': '✅ Done',
  'embed.title.warning': '⚠️ Heads up',
  'embed.title.error': '❌ Something went wrong',

  'music.gate.moduleDisabled': 'The music module is turned off on this server.',
  'music.gate.needVoice': 'You need to be in a voice channel to use this command.',
  'music.gate.needSameVoice': 'You need to be in the same voice channel as the bot.',
  'music.gate.needControl': 'You need the DJ role or Manage Server to use this command.',
  'music.gate.notConnected': 'Lavalink is not connected yet, so the bot cannot play anything.',
  'music.gate.busy': 'Playback is in progress. Wait or use `/skip`.',
  'music.gate.guildOnly': 'Music commands only work inside a server.',
  'music.gate.engineDown': 'The music engine is not running yet. Try again in a moment.',
  'music.gate.enableHint': 'Turn it on with `/setup` or `/config`.',
  'music.gate.botElsewhere':
    'I am playing in <#{channel}>. Join that channel to control playback.',
  'music.gate.needDjRole':
    'This command is only for the <@&{role}> role (or Manage Server).',
  'music.gate.needManageGuild': 'This command requires the Manage Server permission.',
  'music.gate.nothingPlaying': 'Nothing is playing right now.',
  'music.gate.channelNotVoice': 'That channel is not a voice channel I can join.',
  'music.gate.notCached': 'I have not finished loading in this server. Try again in a moment.',
  'music.gate.missingPermissions':
    'I am missing **Connect** and **Speak** in <#{channel}>.',
  'music.gate.internalError':
    'Something went wrong while handling that music command. The details are in the bot log.',

  // ── Music: embeds & labels───────────────────────────────────────────
  'music.field.artist': 'Artist',
  'music.field.requestedBy': 'Requested by',
  'music.field.volume': 'Volume',
  'music.field.status': 'Status',
  'music.field.queue': 'Queue',
  'music.field.playingSince': 'Playing since',
  'music.field.nowPlaying': 'Now playing',
  'music.field.upNext': 'Up next',
  'music.field.fromSpotify': 'From Spotify',
  'music.field.loop': 'Loop',
  'music.field.filter': 'Filter',

  'music.value.paused': '⏸️ Paused',
  'music.value.playing': '▶️ Playing',
  'music.value.emptyQueue': 'empty',
  'music.value.emptyQueueItalic': '*queue is empty*',
  'music.queueTracks': '{count} tracks • {duration}',
  'music.queue.emptyTitle': 'Queue is empty',
  'music.queue.emptyHint': 'Add a track with `/play <title or URL>`.',
  'music.queue.allDone': 'Every track has finished. Add one with `/play`.',
  'music.queue.upNext': 'Up next — {tracks}',
  'music.queue.upNextPaged': 'Up next (page {page}/{total}) — {tracks}',
  'music.queue.hiddenPaged':
    '+{count} more tracks on other pages • use the buttons to browse',
  'music.queue.hidden': '+{count} more tracks not shown',

  'music.nowPlaying.title': '🎶 Music queue',
  'music.nowPlaying.updated': '🎶 Queue updated',
  'music.nowPlaying.idleFooter': 'Leaving automatically in {duration}',
  'music.nowPlaying.loopFooter': 'Loop: {mode}',

  'music.play.started': '▶️ Starting now.',
  'music.play.queued': '➕ Added to the queue (position **#{position}**).',
  'music.play.moreTracks': '…and **{count}** more tracks.',
  'music.play.queueFull': '⚠️ **{count}** tracks were not added because the queue is full.',
  'music.play.rejected': '⚠️ **{count}** tracks rejected ({reason}).',
  'music.play.rejectedExtra': 'The DJ role or Manage Server can play those.',
  'music.play.playlistTitle': '📃 Playlist: {name}',
  'music.play.audioLine': 'Audio: {title}',
  'music.play.audioLineLinked': 'Audio: [{title}]({uri})',
  'music.play.emptyResult':
    'That search returned nothing. Try different keywords or send a URL.',
  'music.play.loadFailed': 'This track could not be loaded: {message}',
  'music.play.queueFullMessage':
    'The queue is full (limit {max} tracks). Wait for a track to finish.',
  'music.play.rejectedTitle': 'Track rejected by the length limit',
  'music.play.lavalinkDown':
    'Lavalink is not connected, so the track cannot be played. Check `docker compose logs lavalink`.',

  'music.search.title': '🗑 Search results',
  'music.search.forQuery': 'Results for `{query}` — pick one from the menu below.',
  'music.search.pickOne': 'Pick one from the menu below.',
  'music.search.topResults': 'Top {count} results',
  'music.search.placeholder': 'Pick a track to play',
  'music.search.footer': 'This menu is valid for 15 minutes. Pick one to play it now.',
  'music.search.expired': 'This search choice is no longer valid. Run `/search` again.',
  'music.search.unknown': 'This choice is no longer recognised. Run `/search` again.',
  'music.search.invalidPick': 'That choice is not valid. Run `/search` again.',
  'music.search.notOwner':
    'This menu belongs to someone else. Run `/search` yourself to pick a track.',
  'music.search.needVoice': 'Join a voice channel first so I can play something.',
  'music.search.failedTitle': 'Search failed',
  'music.search.failedBody': 'Lavalink replied: {message}',
  'music.search.unavailableTitle': 'Lavalink is not connected',
  'music.search.unavailableBody':
    'Searching needs a running Lavalink node. Check `docker compose logs lavalink`.',
  'music.search.noResultsTitle': 'No results',
  'music.search.sessionFailed':
    'The search results could not be stored for a moment, so the menu could not be built. ' +
    'Try again shortly.',

  'music.nav.first': 'First',
  'music.nav.previous': 'Previous',
  'music.nav.next': 'Next',
  'music.nav.last': 'Last',
  'music.nav.tooOld': 'This queue message is too old to change. Run `/queue` again.',
  'music.nav.unknown': 'This button is no longer recognised. Run `/queue` again.',

  'music.limit.tooLong': 'longer than 6 hours',
  'music.limit.needsControl': 'longer than 30 minutes and requested by a non-DJ',
  'music.limit.reasonTooLong': 'over the {duration} limit',
  'music.limit.reasonNeedsControl': 'longer than {duration}',
  'music.limit.reasonNeedsControlStream': 'longer than {duration} (or a live stream)',
  'music.limit.rejectedTooLong':
    '{count} tracks rejected: {reason}. This limit applies to everyone, DJs included ' +
    '— it stops a radio stream from blocking the player.',
  'music.limit.rejectedNeedsControl':
    '{count} tracks rejected: {reason}. Try again with the DJ role or Manage Server, ' +
    'or pick a shorter track.',

  'music.loop.off': 'Off',
  'music.loop.track': 'Repeat track',
  'music.loop.queue': 'Repeat queue',
  'music.filter.off': 'Normal (no filter)',
  'music.filter.bassboost': 'Bassboost',
  'music.filter.nightcore': 'Nightcore',
  'music.filter.vaporwave': 'Vaporwave',
  'music.filter.8d': '8D',
  'music.play.spotifyUnsupported': 'Spotify link cannot be used',
  'music.play.spotifyNotConfigured':
    'Spotify metadata is off because `SPOTIFY_CLIENT_ID`/`SPOTIFY_CLIENT_SECRET` are not set in .env.',
  'music.play.spotifyNotConfiguredTitle': 'Spotify is not configured',
  'music.play.spotifyNotFound': 'Track not found on Spotify',
  'music.play.spotifySearchFailed': 'Could not find audio for that track: {message}',
  'music.play.spotifyNoMatch':
    'Nothing on Spotify matched **{title}**.\n\n' +
    '{tried} candidates were checked and they all differ in title or length. ' +
    'Try searching for the track by keyword instead.',
  'music.play.spotifyNoMatchTitle': 'Audio does not match',
  'music.play.spotifyFailed': 'Could not request Spotify metadata',

  'music.nowPlaying.nothingTitle': 'Nothing playing',
  'music.nowPlaying.nothingBody': 'The bot is not playing anything on this server.',

  'music.control.nothingToPause': 'There is no active playback.',
  'music.control.cannotPauseTitle': 'Cannot pause',
  'music.control.pausedTrack': '{track} is paused. Continue with `/resume`.',
  'music.control.pausedTitle': 'Paused',
  'music.control.nothingToResume': 'There is no paused playback to continue.',
  'music.control.resumedTrack': '{track} is playing again.',
  'music.control.resumedTitle': 'Resumed',
  'music.control.skippedTrack': 'Skipped {track}',
  'music.control.nowPlayingTrack': 'Now playing: {track}',
  'music.control.queueEmpty':
    'The queue is empty. The bot will leave automatically if no new track arrives.',
  'music.control.skippedTitle': 'Track skipped',
  'music.control.stoppedTrack': 'Stopped: {track}',
  'music.control.stoppedTitle': 'Stopped',
  'music.control.queueCleared':
    'The queue was cleared. The bot leaves the voice channel automatically after ' +
    '**{seconds} seconds** if no new track arrives.',

  'music.shuffle.tooShortTitle': 'Queue is too short to shuffle',
  'music.shuffle.tooShortBody': 'At least two tracks are needed in the queue.',
  'music.shuffle.done': '**{count}** tracks were shuffled.',
  'music.shuffle.title': 'Queue shuffled',

  'music.loop.unknownMode': 'Unknown mode. Available options: {options}.',
  'music.loop.disabledText': 'Loop is off (it was {from}).',
  'music.loop.changedText': 'Loop changed from {from} to **{to}**.',
  'music.loop.title': 'Loop mode',

  'music.filter.unknownMode': 'Unknown mode. Available options: {options}.',
  'music.filter.disabledText': '{emoji} Filter is off (it was {from}).',
  'music.filter.changedText': '{emoji} Filter changed from {from} to **{to}**.',
  'music.filter.pending': 'It will take effect when playback starts.',
  'music.filter.title': 'Audio filter',

  'music.volume.muted': 'Volume is muted. Use `/volume 100` to turn it back on.',
  'music.volume.changed': 'Volume is now **{volume}%**.',
  'music.volume.clipping': ' Above 100% the audio may distort.',
  'music.volume.title': 'Volume',

  'music.disconnect.left': 'I left the voice channel. The queue was cleared.',
  'music.disconnect.nowhere': 'I was not in any voice channel to begin with.',
  'music.disconnect.title': 'Bot left',

  'music.seek.live': 'This is a live stream, so there is no position to seek to.',
  'music.seek.pastEnd': 'That position is past the end of the track.',
  'music.seek.tooLarge': 'That position is too far — the maximum is 6 hours.',
  'music.seek.unreadable':
    'Could not read that position. Accepted examples: `90`, `1:30`, or `1m30s`.',
  'music.seek.jumped': 'Jumped to **{position}** of {total}.',
  'music.seek.jumpedTitle': 'Position changed',
  'music.seek.unavailable':
    'This track cannot be seeked right now. Try again once the next track starts.',

  'music.queue.moveEmpty': 'The queue is empty.',
  'music.queue.removeEmpty': 'The queue is empty, so there is nothing to remove.',
  'music.queue.wrongNumber':
    'The queue only holds {count} tracks. Check the numbers with `/queue`.',
  'music.queue.removed':
    '{track} was removed from position **{position}**.\n{remaining} tracks left in the queue.',
  'music.queue.removedTitle': 'Track removed',
  'music.queue.moveFailed': 'That position cannot be moved. Check the numbers you entered.',
  'music.queue.moveSame': '{track} is already at position **{position}**.',
  'music.queue.moveDone': '{track} moved from **{from}** to **{to}**.',
  'music.queue.retitledTitle': 'Queue rearranged',

  'music.lyrics.nothingPlaying':
    'Nothing is playing. Add a track with `/play` first.',
  'music.lyrics.notFound': 'Lyrics not found',
  'music.lyrics.sourceProblem': 'Lyrics source is having trouble',

  'music.search.noResults':
    'Found nothing for `{query}`. Try different keywords or send a URL.',

  'music.stay.guildOnly': '24/7 mode can only be changed inside a server.',
  'music.stay.needDjRole':
    'Only the <@&{role}> role (or Manage Server) can change 24/7 mode.',
  'music.stay.needManageGuild':
    'Turning 24/7 mode on or off requires the Manage Server permission.',
  'music.stay.needChannel':
    'Name the voice channel with `/247 join channel:#music`, or join one first ' +
    'and then run `/247 join`.',
  'music.stay.joinFailed':
    '24/7 mode was saved for <#{channel}>, but the bot could not join: {error}. ' +
    'It will retry automatically in a few minutes.',
  'music.stay.joined':
    'The bot will hold <#{channel}> 24/7 and will not leave even with nothing ' +
    'playing. Turn it off with `/247 leave`.',
  'music.stay.alreadyThere': 'The bot is already holding <#{channel}> 24/7.',
  'music.stay.pending':
    '24/7 mode is set for <#{channel}>. The bot will move there once the current ' +
    'track finishes.',
  'music.stay.activeTitle': '24/7 mode is on',
  'music.stay.savingTitle': '24/7 mode is being applied',
  'music.stay.neverStarted': 'This mode has never been turned on in this server.',
  'music.stay.offTitle': '24/7 mode is off',
  'music.stay.offWhilePlaying':
    '24/7 mode is off. The bot finishes the current track, then leaves according to ' +
    'the idle timeout.',
  'music.stay.offAndLeft': '24/7 mode is off and the bot left the voice channel.',
  'music.stay.offNotConnected':
    '24/7 mode is off. The bot was not in any voice channel anyway.',
  'music.stay.statusTitle': '24/7 mode status',
  'music.stay.statusOff': 'This mode is not on. Turn it on with `/247 join`.',
  'music.stay.statusStaying':
    'The bot is holding <#{channel}> and will not leave automatically.',
  'music.stay.statusElsewhere':
    'The mode is set for <#{channel}>, but the bot is not there yet ({reason}).',
  'music.stay.fieldChannel': '24/7 channel',
  'music.stay.fieldPosition': 'Bot position',
  'music.stay.fieldIdle': 'Leaves automatically',
  'music.stay.fieldSummary': 'Short status',
  'music.stay.fieldNextAction': 'Next action',
  'music.stay.notEnabled': 'Not enabled',
  'music.stay.outsideVoice': 'Outside any voice channel',
  'music.stay.idleNo': 'No, not while 24/7 mode is on',
  'music.stay.idleYes': 'Yes, after {seconds} seconds without a track',
  'music.stay.labelModuleOff': 'Music module is off',
  'music.stay.labelOff': 'Off',
  'music.stay.labelHere': 'On in <#{channel}>',
  'music.stay.labelPending': 'On, not there yet: <#{channel}>',

  'stats.guildOnly': 'Statistics are only available inside a server.',
  'playlist.guildOnly': 'This command only works inside a server.',
  'mod.gate.guildOnly': 'This command only works inside a server.',
  'mod.gate.needsPermission': 'This command requires **{permission}**.',
  'mod.gate.moduleDisabled':
    'The moderation module is turned off on this server. Turn it on with `/setup` or `/config`.',
  'mod.gate.botNotLoaded': 'I have not finished loading in this server. Try again in a moment.',
  'mod.gate.botLacksPermission': 'I am missing **{permission}** in this server.',
  'mod.gate.channelOnly': 'This command only works in a server channel.',
  'mod.gate.textVoiceOnly':
    'This command only works in a text or voice channel — not a thread or a category.',
  'mod.internalError':
    'Something went wrong while handling that moderation action. The details are in the bot log.',
  'mod.databaseDown':
    'The database cannot be reached, so the moderation action was not run and nothing was ' +
    'recorded.\nCheck `DATABASE_URL` in .env and your network; `npm run infra:up` only applies when you use local Postgres.',
  'mod.databaseDownTitle': 'Database is offline',

  'mod.action.note': 'Note',
  'mod.action.successSuffix': 'Done',

  'mod.field.case': 'Case',
  'mod.field.target': 'Target',
  'mod.field.moderator': 'Moderator',
  'mod.field.reason': 'Reason',
  'mod.field.expires': 'Expires',
  'mod.field.status': 'Status',
  'mod.field.time': 'Time',
  'mod.field.currentState': 'Current state',
  'mod.field.notification': 'Notification',
  'mod.field.amount': 'Amount',
  'mod.field.channel': 'Channel',
  'mod.field.filter': 'Filter',
  'mod.field.actionSpread': 'Action breakdown',
  'mod.reason.missing': '*not specified*',
  'mod.reason.noneShort': '*no reason*',
  'mod.reason.noneNote': '*no text*',
  'mod.dm.sent': 'DM to the target was delivered',
  'mod.dm.closed': 'DM to the target was not delivered (DMs are closed)',
  'mod.dm.notSent':
    '⚠️ DM to the target was not delivered (DMs are closed or the bot is blocked).',
  'mod.dm.contactModerator': 'If you think this is a mistake, contact a server moderator.',
  'mod.dm.revokedTitle': '✅ Warning revoked in {server}',
  'mod.dm.revokedBody': 'Warning `{case}` was revoked by <@{moderator}>.',
  'mod.dm.banTitle': '🔨 You were banned from {server}',
  'mod.dm.kickTitle': '👢 You were kicked from {server}',
  'mod.dm.timeoutTitle': '⏳ You were timed out in {server}',
  'mod.dm.warnTitle': '⚠️ You received a warning in {server}',
  'mod.dm.unbanTitle': '🔓 Your ban in {server} has been lifted',

  'mod.log.revokedTitle': 'Warning revoked',
  'mod.log.purgeTitle': '🧹 Purge messages',
  'mod.log.messagesCount': '{count} messages',

  'mod.case.statusActive': '✅ Active',
  'mod.case.statusRevoked': '♻️ Revoked by a moderator',
  'mod.case.statusInactive': '❌ Inactive — the Discord action failed to run',
  'mod.case.inactiveSuffix': ' · *inactive*',
  'mod.case.by': 'by <@{moderator}>',
  'mod.case.banned': '🔒 Still banned from the server',
  'mod.case.unbanned': '✅ No longer banned from the server',
  'mod.case.banUnknown': '⚪ Ban status could not be checked',
  'mod.case.timeoutActive': '⏳ Still timed out until <t:{when}:R>',
  'mod.case.timeoutExpired': '✅ No longer timed out',
  'mod.case.timeoutUnknown': '⚪ Not timed out, or it could not be checked',
  'mod.case.dmSent': '✅ Notification DM was delivered to the target',
  'mod.case.dmFailed':
    '⚠️ Notification DM was **not delivered** — DMs are closed or the bot is blocked',
  'mod.case.dmUnrecorded':
    '❔ DM delivery status was not recorded (the case predates this feature)',
  'mod.case.expired': '<t:{when}:f> — *already passed*',
  'mod.case.historyTitle': 'History of {target}',
  'mod.case.historyEmpty':
    'No other cases for this target — this is the only one.',
  'mod.case.historyHidden': '\n\n*+{count} other cases not shown.*',
  'mod.case.historyFooter': '{count} other cases recorded for this target',
  'mod.case.parseError':
    'Unknown case number. Accepted examples: `#CASE-0142`, `142`, or `CASE 142`.',
  'mod.case.parseErrorTitle': 'Wrong format',
  'mod.case.notFound':
    'Case `{case}` does not exist in this server.\n' +
    'Case numbers differ per server — make sure you use one from this server.',
  'mod.case.notFoundTitle': 'Case not found',
  'mod.case.relatedLogsTitle': '📎 Related logs',
  'mod.case.relatedLogsFooter':
    'Logs within about ±1 hour · `/logs case:{case}` for this case only',

  'mod.profile.empty': 'No cases recorded for this moderator.',
  'mod.profile.title': '🛡️ Moderator profile — {name}',
  'mod.profile.footer': 'Harmony-recorded cases only · old data is deleted after 12 months',
  'mod.profile.recentTitle': '🗂️ Recent cases',
  'mod.profile.recentEmpty': 'No cases recorded for this moderator in this server.',
  'mod.profile.detailHint': ' · `/case kasus:NNN` for details',
  'mod.profile.ofTotal': '{shown} most recent of {total} cases{hint}',
  'mod.profile.recentCount': '{count} most recent cases{hint}',
  'mod.profile.actionsEmpty': '*No cases recorded.*',
  'mod.profile.actionFailed': ' · ⚠️ {count} failed',
  'mod.profile.totalCases': 'Total cases **{count}**',
  'mod.profile.uniqueTargets': 'Unique targets **{count}**',
  'mod.profile.perTarget': 'Average of **{count}** cases per target',
  'mod.profile.activeWindow': '{count} cases in the last {days} days',
  'mod.profile.noRecent': 'No cases in the last {days} days',
  'mod.profile.failedLine':
    '⚠️ {count} cases were recorded but their Discord action failed to run',
  'mod.profile.revokedLine': '♻️ {count} warnings were revoked later',
  'mod.profile.stateRevoked': ' · *revoked*',
  'mod.profile.stateFailed': ' · *failed*',
  'mod.profile.emptyForUser':
    'No cases recorded for {moderator}.\n' +
    'Only actions taken through Harmony are recorded here — bans or timeouts done ' +
    'manually in Discord have no case.',
  'mod.profile.emptyForUserTitle': '🛡️ No activity yet',

  'mod.prior.title': '🗂️ Related history for <@{target}>',
  'mod.prior.activeWarnings':
    '⚠️ **{count} warnings are still active** — the target was told before.',
  'mod.prior.revokedWarnings': '♻️ **{count}** earlier warnings were revoked by a moderator.',
  'mod.prior.priorBans': '🔁 Target **was banned {count}×** in this server.',
  'mod.prior.totalLine': '📋 **{count}** earlier cases — {breakdown}.',
  'mod.prior.moreActions': '+{count} other types',
  'mod.prior.inactive': ' _({count} inactive)_',
  'mod.prior.hint': ' · `/case kasus:{case}` for details',
  'mod.prior.footer': '{count} earlier cases recorded by Harmony{hint}',

  'mod.warnings.title': '⚠️ Warnings — {target}',
  'mod.warnings.footer': '{count} warnings recorded in total',
  'mod.warnings.empty': 'No warnings recorded for this user.',
  'mod.notes.title': '📝 Internal notes — {target}',
  'mod.notes.empty': 'No notes for this user yet.',
  'mod.notes.footer': '{count} most recent notes shown',

  'mod.hierarchy.self': 'You cannot moderate yourself.',
  'mod.hierarchy.botSelf':
    'I cannot moderate myself. Use Discord directly if you really need to.',
  'mod.hierarchy.owner': 'The server owner cannot be moderated by the bot.',
  'mod.hierarchy.botOutranked':
    'The target role is higher than or equal to mine, so I have no authority to moderate it.',
  'mod.hierarchy.actorOutranked':
    'The target role is higher than or equal to yours. Ask a more senior moderator.',

  'mod.audit.noReason': 'No reason given',
  'mod.audit.by': 'by {actor} ({id})',
  'mod.audit.mention': 'by <@{moderator}>',
  'mod.delivery.logMissing':
    '⚠️ The log channel is not set or could not be reached, so nothing was logged.',
  'mod.parse.badUserId':
    'Enter a valid **user ID** (17–20 digits), not a name or a mention.',
  'mod.parse.unknownAction': 'Action {action}',
  'mod.parse.badCaseFormat': 'Unknown case format. Examples: `#CASE-0007` or `7`.',
  'mod.notMember.kick': 'That user is not a member of this server, so they cannot be kicked.',
  'mod.notMember.timeout': 'That user is not a member of this server, so they cannot be timed out.',
  'mod.gate.textChannelOnly': 'This command only works in a text channel inside a server.',
  'mod.purge.noMatch':
    'No messages matched that filter within the range that was checked.',

  'mod.ban.deleteMessages': '🧹 Messages from the last **{days}** days were deleted too.',
  'mod.ban.notBanned': 'User `{id}` is not currently banned in this server.',

  'mod.unwarn.revokedLine': 'Warning `{case}` for <@{target}> has been revoked.',
  'mod.warn.totalLine': '📊 Total recorded warnings: **{count}**',
  'mod.warnings.moreHidden': '*+{count} other warnings not shown.*',

  'mod.timeout.badDuration':
    'Duration `{value}` is not valid. Use a format like `30s`, `10m`, `2h`, or `7d` (28 days max).',
  'mod.timeout.appliedLine': '⏳ Timed out for **{duration}**.',
  'mod.note.internalLine': '📝 Internal note — the target is not told.',

  'mod.purge.filterAuthor': 'Author: <@{id}>',
  'mod.purge.filterContains': 'Contains: `{value}`',
  'mod.purge.deletedLine': '🧹 **{count}** messages deleted from <#{channel}>.',
  'mod.purge.skippedLine':
    'ℹ️ **{count}** messages could not be deleted (older than 14 days or pinned).',
  'mod.purge.doneTitle': '🧹 Purge finished',

  'mod.slowmode.badDuration':
    'Duration `{value}` is not valid. Use `0`/`off`, `30s`, `5m`, or `2h` (6 hours max).',
  'mod.slowmode.offLine': '🐌 Slowmode **turned off**.',
  'mod.slowmode.setLine': '🐌 Slowmode set to **{duration}**.',

  'mod.lock.deniedLine':
    '🔒 `{channel}` is denied for **@everyone** in this channel.',
  'mod.unlock.restoredLine':
    '🔑 `{channel}` follows the server default permissions again.',

  'mod.logs.empty': 'No log entries were recorded.',
  'mod.logs.moreHidden':
    '*+{count} other entries not shown — use `/logs` to see them all.*',


  'log.category.member': 'Member',
  'log.category.message': 'Message',
  'log.category.channel': 'Channel',
  'log.category.role': 'Role',
  'log.category.voice': 'Voice',
  'log.category.server': 'Server',
  'log.event.guildBanAdd': 'Member banned',
  'log.event.guildBanRemove': 'Ban removed',
  'log.event.guildMemberAdd': 'Member joined',
  'log.event.guildMemberRemove': 'Member left',
  'log.event.guildMemberUpdate': 'Member updated',
  'log.event.messageDelete': 'Message deleted',
  'log.event.messageUpdate': 'Message edited',
  'log.event.messageBulkDelete': 'Bulk message delete',
  'log.event.channelCreate': 'Channel created',
  'log.event.channelDelete': 'Channel deleted',
  'log.event.channelUpdate': 'Channel updated',
  'log.event.guildRoleCreate': 'Role created',
  'log.event.guildRoleDelete': 'Role deleted',
  'log.event.guildRoleUpdate': 'Role updated',
  'log.event.voiceStateUpdate': 'Voice change',
  'log.event.guildUpdate': 'Server updated',
  'log.event.guildEmojiCreate': 'Emoji added',
  'log.event.guildEmojiUpdate': 'Emoji updated',
  'log.event.guildEmojiDelete': 'Emoji deleted',
  'log.event.guildStickerCreate': 'Sticker added',
  'log.event.guildStickerUpdate': 'Sticker updated',
  'log.event.guildStickerDelete': 'Sticker deleted',
  'log.field.changes': 'Changes',
  'log.field.reason': 'Reason',
  'log.field.source': 'Source',
  'log.field.case': 'Case',
  'log.field.moderator': 'Moderator',
  'log.source.harmony': '🤖 Harmony (bot command)',
  'log.source.botOutside': '🤖 Bot — outside a Harmony case',
  'log.source.otherModerator': '👤 Another moderator (<@{user}>)',
  'log.summary.case': '🤖 Harmony · Case `{case}`',
  'log.summary.by': 'By: <@{user}>',
  'log.summary.channel': 'Channel: <#{channel}>',
  'log.summary.jump': '[Jump to the log message]({url})',
  'log.filter.category': 'Category: {value}',
  'log.filter.user': 'User: <@{user}>',
  'log.filter.channel': 'Channel: <#{channel}>',
  'log.filter.keyword': 'Keyword: `{value}`',
  'log.filter.case': 'Case: `{value}`',
  'log.filter.from': 'From: <t:{value}:f>',
  'log.filter.to': 'To: <t:{value}:f>',
  'log.filter.all': 'All categories · no time limit',
  'log.results.title': '🔎 Log history',
  'log.results.footer': 'Page {page} · entries {first}–{last} of {total}',
  'log.results.nextTitle': 'Next page',
  'log.results.nextValue': 'There are more entries — run it again with `page:{page}`.',
  'log.results.noMatch': 'No entries matched.\n\n**Filter:** {filter}',
  'log.stats.title': '📊 Log statistics',
  'log.stats.footer': '{total} events · {from} to {to}',
  'log.stats.period': '**Period:** {from} to {to}',
  'log.stats.periodDefault':
    '\n\n_Default period: the whole log retention window. Add `from:` to narrow it down._',
  'log.stats.categoriesField': 'Events per category',
  'log.stats.topActionsField': 'Top actions ({count})',
  'log.stats.topMembersField': 'Members most often involved ({count})',
  'log.stats.noActions': 'No events in this period.',
  'log.stats.noMembers': 'No members were recorded in this period.',
  'log.stats.roleTarget': '🎯 {count} as the target',
  'log.stats.roleExecutor': '⚡ {count} as the actor',
  'log.diff.yes': 'Yes',
  'log.diff.no': 'No',
  'log.diff.overwriteAdded': 'overwrite **added**',
  'log.diff.overwriteRemoved': 'overwrite **removed**',
  'log.diff.allowAdd': 'allow +{names}',
  'log.diff.allowRemove': 'allow -{names}',
  'log.diff.denyAdd': 'deny +{names}',
  'log.diff.denyRemove': 'deny -{names}',
  'log.export.allCategories': 'all categories',
  'log.export.collected': 'Collected **{exported}** of **{total}** entries ({categories}).',
  'log.export.truncated': '⚠️ Truncated at the {max} most recent entries — widen or narrow the filter to get all of them.',
  'log.export.saved': '📁 Saved on the server: `{path}`',
  'log.export.attachment': '📎 Attachment: `{file}` ({size})',
  'log.export.title': '📤📥 Log export finished',
  'log.export.tooBig':
    'The export file is too large ({size} MB).\nNarrow it with a category, user, or date filter and try again.',
  'log.export.tooBigTitle': 'Export too large',
  'log.err.invalidId': 'The {label} ID is not valid: `{value}`.',
  'log.err.unknownCategory': 'Category `{value}` is not known.',
  'log.err.unknownUnit': 'The date format `{label}` is not recognised.',
  'log.err.invalidDate':
    'The date `{label}` is not valid. Accepted examples: `7d`, `24h`, `2026-10-02`, or `02/10/2026`.',
  'log.err.dateMissing': 'That date `{label}` does not exist in the calendar.',
  'log.err.rangeReversed': 'The date range is reversed — `from` must come before `to`.',
  'log.err.badCase':
    'That case number is not valid. Accepted examples: `#CASE-0142`, `0142`, or `142`.',
  'log.err.keywordTooLong': 'The keyword is too long (100 characters max).',
  'log.err.pageNotInteger': 'The page number must be a whole number starting at 1.',
  'log.err.pageMax': 'The maximum page is {max}.',
  'log.error.rejectedTitle': 'Log settings rejected',
  'log.error.dbOfflineTitle': 'Database offline',
  'log.error.dbOffline':
    'The database cannot be reached, so log routing cannot be read or saved yet.\nCheck `DATABASE_URL` in .env and your network; `npm run infra:up` only applies when you use local Postgres.',
  'log.error.generic':
    'Something went wrong while accessing the log settings. The details are in the bot log.',
  'log.cmd.moduleOff':
    'The logging module is off, so nothing is being collected.\nTurn it on with `/config set logging:true` and wait for the next event to be recorded.',
  'log.cmd.moduleOffTitle': 'Logging is off',
  'log.cmd.conflict': 'The `stats` and `format` options cannot be used together.\nRun `/logs stats:true` for a summary in Discord, or `/logs format:…` to download the raw data.',
  'log.cmd.conflictTitle': 'Conflicting modes',
  'log.cmd.checkAgain': 'Check again',
  'log.cmd.checkAgainHistory':
    'The history only holds events from after the logging module was turned on, and is kept for {days} days. Widen the date range or clear the filters.',
  'log.cmd.checkAgainStats':
    'Statistics are computed from the history kept for the last {days} days. Widen the date range (`from:`/`to:`) or clear the filters.',
  'log.cmd.routingTitle': 'Log routing',
  'log.cmd.routingSet': '**{category}** logs are now routed to <#{channel}>.',
  'log.cmd.routingReset': 'Routing for **{category}** was removed — back to the global log channel.',
  'log.cmd.routingGlobal': '(global)',
  'log.cmd.routingUnset': 'not set yet',
  'log.cmd.moduleStatus': 'Module status',
  'log.cmd.moduleOn': 'Logging is active.',
  'log.cmd.moduleOffLine': 'Logging is off — turn it on with `/config set logging:true` or the `/setup` wizard.',

  'playlist.created':
    'Playlist **{name}** was created. Add tracks with ' +
    '`/playlist add {name} <title or URL>`.',
  'playlist.createdTitle': 'Playlist created',
  'playlist.removedTrack': 'Track removed. **{name}** now holds {count} tracks.',
  'playlist.nonePlayable':
    'None of the {count} tracks can still be played. The source may be gone.',
  'playlist.partialLoad': '{failed} of {count} tracks failed to load and were skipped.',
  'playlist.fieldOwner': 'Playlist',
  'playlist.deleted': 'Playlist **{name}** was deleted.',
  'playlist.title': 'Playlist',
  'playlist.unknownSub': 'That subcommand is not known.',
  'playlist.needQuery':
    'Nothing is playing. Give a title/URL, or play a track first and then save it.',
  'playlist.notFoundQuery': 'Found nothing for `{query}`.',
  'playlist.loadFailed': 'That track could not be loaded: {message}',
  'playlist.lavalinkDown':
    'Lavalink is not connected, so tracks cannot be searched. Check `docker compose logs lavalink`.',
  'playlist.errNameTaken':
    'You already have a playlist named **{name}**. Pick another name, or delete the old one first.',
  'playlist.errNoPublic':
    'There is no public playlist with that name. Create or share one with `/playlist` first.',
  'playlist.errNotFound': 'That playlist does not exist. Check `/playlist list`.',
  'playlist.errEmpty': 'The playlist is still empty.',
  'playlist.errFull':
    'The playlist already holds the maximum of **{limit}** tracks. Remove one before adding more.',
  'playlist.errStillEmpty': 'This playlist is still empty, so there is nothing to remove.',
  'playlist.errOutOfRange': 'That position is out of range. This playlist holds **{count}** tracks.',
  'playlist.errNotOwner': 'That playlist is not yours, so it cannot be changed.',
  'playlist.errPrivate': 'That playlist is private.',
  'playlist.errUnknown': 'That request could not be processed.',
  'stats.unavailable':
    'Statistics could not be loaded. The details are in the bot log.',
  'stats.trackTitle': 'Music statistics',
  'stats.commandTitle': 'Command statistics',
  'stats.emptyTrack': 'No playback data in the last {days} days.',
  'stats.emptyCommand': 'No command usage data in the last {days} days.',
  'stats.fieldTopTrack': 'Most played tracks',
  'stats.fieldTopCommand': 'Most used commands',
  'stats.fieldDaily': 'Daily',
  'stats.footerRange':
    '{since} to {until} (UTC) | {active} of {days} days have activity | no personal data',
  'stats.summaryTrack': '**{count}x** plays, {listened} listened',
  'stats.summaryCommand': '**{count}x** commands used',
  'stats.peakDay': ' Busiest day: **{day}** ({count}).',
  'stats.summaryTail': '{total} in the last {days} days.{peak}',
  'stats.dailyEmpty': '*No data.*',
  'stats.weeklyNote': '_The range is summed per week: {days} days become {weeks} blocks._',

  'config.locale.changed': 'This server now uses {locale}.',
  'config.locale.unknown': 'That language is not supported. Available: {available}.',
};

const catalogs: Record<Locale, Record<MessageKey, string>> = {
  id: idMessages,
  en: enMessages,
};

/** Semua kunci yang ada di katalog Indonesia. */
export const MESSAGE_KEYS = Object.keys(idMessages) as MessageKey[];

/** Kunci yang belum punya terjemahan di bahasa tertentu. */
export function missingKeys(locale: Locale): MessageKey[] {
  return MESSAGE_KEYS.filter((key) => catalogs[locale][key] === undefined);
}

/**
 * Isi placeholder `{nama}` dengan nilai yang diberikan.
 *
 * Placeholder yang tidak ada di `params` **biarkan tertulis**. Ini aturan yang
 * sama dengan perintah custom: teks yang gagal menerjemahkan harus kelihatan
 * ada yang salah, bukan hilang begitu saja supaya sulit ditelusuri.
 */
export function interpolate(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;

  return template.replace(/\{(\w+)\}/g, (match, key: string) => {
    const value = params[key];
    return value === undefined ? match : String(value);
  });
}

/**
 * Ambil teks untuk satu kunci.
 *
 * Aturan fallback-nya berurutan dan sengaja tertulis jelas:
 * 1. Bahasa yang diminta.
 * 2. **Bahasa Indonesia** — teks yang belum diterjemahkan masih terbaca dan
 *    bukan jadi kosong.
 * 3. Kuncinya sendiri, kalau bahkan katalog Indonesia tidak punya.
 *
 * Tidak pernah melempar: terjemahan yang gagal harus menampilkan teks apa pun,
 * bukan membuat perintah ikut gagal.
 */
export function translate(
  locale: Locale,
  key: MessageKey,
  params?: Record<string, string | number>,
): string {
  const template = catalogs[locale][key] ?? catalogs[DEFAULT_LOCALE][key] ?? key;

  return interpolate(template, params);
}

/**
 * Fungsi penerjemah untuk satu locale.
 *
 * Dipakai di perintah begini:
 * `const t = translator(locale); errorEmbed(t('music.gate.needVoice'))`
 */
export function translator(locale: Locale): Translator {
  return (key, params) => translate(locale, key, params);
}

/**
 * Penerjemah bawaan: bahasa Indonesia.
 *
 * Dipakai sebagai nilai bawaan parameter renderer musik supaya pemanggil lama
 * tidak ikut berubah dan teks bawaan bot tidak bergeser diam-diam.
 */
export const defaultTranslator: Translator = translator(DEFAULT_LOCALE);

/** Locale yang benar-benar punya katalog penuh. */
export function isCatalogComplete(locale: Locale): boolean {
  return missingKeys(locale).length === 0 && LOCALES.includes(locale);
}