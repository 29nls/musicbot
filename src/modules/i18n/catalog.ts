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

  // Embed event log: judul, nama field, dan nilai yang ditulis satu event.
  // Satu blok supaya judul tiap event tidak tercecer di katalog.
  'log.embed.title.banAdd': '🔨 Member Ban',
  'log.embed.title.banAddHarmony': '🔨 Member Ban (Harmony)',
  'log.embed.title.banRemove': '♻️ Ban Dicabut',
  'log.embed.title.banRemoveHarmony': '♻️ Ban Dicabut (Harmony)',
  'log.embed.title.memberAdd': '👤 Member Join',
  'log.embed.title.memberKick': '👢 Member Kick',
  'log.embed.title.memberLeave': '🚪 Member Leave',
  'log.embed.title.memberUpdate': '📝 Member Diperbarui',
  'log.embed.title.memberTimeout': '⏱️ Timeout Diperbarui (Harmony)',
  'log.embed.title.messageDelete': '🗑️ Pesan Dihapus',
  'log.embed.title.messageBulkDelete': '🧹 Pesan Dihapus Massal',
  'log.embed.title.messageUpdate': '✏️ Pesan Diedit',
  'log.embed.title.channelCreate': '📁 Channel Dibuat',
  'log.embed.title.channelDelete': '🗑️ Channel Dihapus',
  'log.embed.title.channelUpdate': '📝 Channel Diperbarui',
  'log.embed.title.channelUpdateHarmony': '📝 Channel Diperbarui (Harmony)',
  'log.embed.title.roleCreate': '🎭 Role Dibuat',
  'log.embed.title.roleDelete': '🗑️ Role Dihapus',
  'log.embed.title.roleUpdate': '📝 Role Diperbarui',
  'log.embed.title.emojiCreate': '😀 Emoji Ditambahkan',
  'log.embed.title.emojiDelete': '🗑️ Emoji Dihapus',
  'log.embed.title.emojiUpdate': '📝 Emoji Diperbarui',
  'log.embed.title.stickerCreate': '🩹 Sticker Ditambahkan',
  'log.embed.title.stickerDelete': '🗑️ Sticker Dihapus',
  'log.embed.title.stickerUpdate': '📝 Sticker Diperbarui',
  'log.embed.title.guildUpdate': '🏠 Server Diperbarui',
  'log.embed.title.voiceJoin': '🔊 Join Voice',
  'log.embed.title.voiceLeave': '🔇 Leave Voice',
  'log.embed.title.voiceMove': '🔁 Pindah Voice',
  'log.embed.title.voiceState': '🎙️ Voice State',
  'log.embed.field.member': 'Member',
  'log.embed.field.id': 'ID',
  'log.embed.field.channel': 'Channel',
  'log.embed.field.name': 'Nama',
  'log.embed.field.type': 'Tipe',
  'log.embed.field.category': 'Kategori',
  'log.embed.field.color': 'Warna',
  'log.embed.field.mentionable': 'Mentionable',
  'log.embed.field.hoist': 'Tampil terpisah',
  'log.embed.field.emoji': 'Emoji',
  'log.embed.field.animated': 'Animasi',
  'log.embed.field.description': 'Deskripsi',
  'log.embed.field.tags': 'Tag',
  'log.embed.field.role': 'Role',
  'log.embed.field.author': 'Penulis',
  'log.embed.field.jump': 'Lompat',
  'log.embed.field.count': 'Jumlah',
  'log.embed.field.joined': 'Bergabung',
  'log.embed.field.accountCreated': 'Akun dibuat',
  'log.embed.field.messageId': 'ID pesan',
  'log.embed.field.attachments': 'Lampiran',
  'log.embed.field.from': 'Dari',
  'log.embed.field.to': 'Ke',
  'log.embed.field.topic': 'Topik',
  'log.embed.field.nsfw': 'NSFW',
  'log.embed.field.slowmode': 'Slowmode',
  'log.embed.field.userLimit': 'Batas user',
  'log.embed.field.serverName': 'Nama server',
  'log.embed.field.vanityUrl': 'Vanity URL',
  'log.embed.field.owner': 'Pemilik',
  'log.embed.field.boostTier': 'Boost tier',
  'log.embed.field.boosts': 'Jumlah boost',
  'log.embed.field.icon': 'Ikon',
  'log.embed.field.banner': 'Banner',
  'log.embed.field.serverMute': 'Server mute',
  'log.embed.field.serverDeaf': 'Server deaf',
  'log.embed.field.selfMute': 'Self mute',
  'log.embed.field.selfDeaf': 'Self deaf',
  'log.embed.field.streaming': 'Streaming',
  'log.embed.field.nickname': 'Nama panggilan',
  'log.embed.field.timeout': 'Timeout',
  'log.embed.field.rolesAdded': 'Role ditambahkan',
  'log.embed.field.rolesRemoved': 'Role dihapus',
  'log.embed.field.permsAdded': 'Izin ditambahkan',
  'log.embed.field.permsRemoved': 'Izin dihapus',
  'log.embed.value.present': 'Ada',
  'log.embed.value.absent': 'Tidak ada',
  'log.embed.value.messageCount': '{count} pesan',
  'log.embed.value.attachmentCount': '{count} file',
  'log.embed.value.others': '(+{count} lainnya)',
  'log.embed.value.seconds': '{count} detik',
  'log.embed.value.level': 'Level {level}',
  'log.embed.value.noContent': '*Isi pesan tidak tersedia.*',
  'log.embed.value.noPrevious': '*Isi sebelumnya tidak tersedia (pesan lama tidak di-cache).*',
  'log.embed.value.before': '**Sebelum:**',
  'log.embed.value.after': '**Sesudah:**',
  'log.embed.value.jumpLink': 'Buka pesan',
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

  // ── Automod (PRD 7.2) ─────────────────────────────────────────────
  // Judul embed, nama field, label rule & aksi, ambang, alasan
  // pelanggaran, error validasi, dan balasan tiap subcommand.
  'automod.title': '🤖 Automod',
  'automod.field.rules': 'Rule',
  'automod.field.exemptChannels': '🚫 Channel dikecualikan',
  'automod.field.exemptRoles': '🚫 Role dikecualikan',
  'automod.field.badwords': '🤬 Kata terlarang',
  'automod.field.allowedDomains': '🌐 Domain diizinkan',
  'automod.field.allowedInvites': '🔗 Invite diizinkan',
  'automod.field.user': 'Pengguna',
  'automod.field.channel': 'Channel',
  'automod.field.actions': 'Aksi',
  'automod.field.reason': 'Alasan',
  'automod.field.case': 'Kasus',
  'automod.field.message': 'Isi pesan',
  'automod.module.on': 'Modul automod **aktif** — rule di bawah berlaku di setiap pesan.',
  'automod.module.off': 'Modul automod **mati**. Nyalakan lewat `/config set automod:true` (atau wizard `/setup`) sebelum rule berlaku.',
  'automod.footer.exempt': 'Pemilik pesan dengan Manage Messages & semua bot selalu dikecualikan.',
  'automod.value.notSet': '*belum ada*',
  'automod.rule.spam.label': 'Anti-spam',
  'automod.rule.spam.description': 'Pesan berturut-turut terlalu cepat (default 5 pesan / 5 detik)',
  'automod.rule.invite.label': 'Anti-invite',
  'automod.rule.invite.description': 'Link invite server Discord (default hapus + warn)',
  'automod.rule.link.label': 'Anti-link',
  'automod.rule.link.description': 'Semua URL (default hapus)',
  'automod.rule.badword.label': 'Badword',
  'automod.rule.badword.description': 'Daftar kata terlarang (default kosong)',
  'automod.rule.mention.label': 'Anti-mention-spam',
  'automod.rule.mention.description': 'Terlalu banyak mention dalam satu pesan (default >5 → timeout 10 menit)',
  'automod.rule.caps.label': 'Anti-caps',
  'automod.rule.caps.description': 'Pesan berteriak: >70% huruf kapital dan panjang >10 karakter',
  'automod.rule.duplicate.label': 'Anti-duplicate',
  'automod.rule.duplicate.description': 'Pesan identik berturut-turut (default 3x)',
  'automod.action.delete': 'Hapus pesan',
  'automod.action.warn': 'Catat peringatan',
  'automod.action.timeout': 'Timeout',
  'automod.threshold.spam': '{count} pesan / {seconds} detik',
  'automod.threshold.mention': '{count} mention / pesan',
  'automod.threshold.caps': '{percent}% huruf kapital',
  'automod.threshold.duplicate': '{count}x berturut-turut',
  'automod.threshold.none': '—',
  'automod.reason.spam': 'Mengirim {count} pesan dalam {seconds} detik',
  'automod.reason.invite': 'Mengirim link invite server Discord',
  'automod.reason.link': 'Mengirim link: {hosts}',
  'automod.reason.badword': 'Mengandung kata terlarang: `{word}`',
  'automod.reason.mention': 'Menyebut {count} mention dalam satu pesan',
  'automod.reason.caps': 'Terlalu banyak huruf kapital ({percent}%)',
  'automod.reason.duplicate': 'Mengirim pesan identik {count}x berturut-turut',
  'automod.reason.overflow': ' (+{count})',
  'automod.err.rejectedTitle': '❌ Pengaturan Automod Ditolak',
  'automod.err.invalidId': 'ID {label} tidak valid: `{value}`.',
  'automod.err.noThreshold': 'Rule **{rule}** tidak punya ambang yang bisa diubah — cukup nyalakan/matikan.',
  'automod.err.thresholdRange': 'Ambang untuk **{rule}** harus bilangan bulat {min}–{max}. Sekarang: {current}.',
  'automod.err.emptyDomain': 'Domain tidak boleh kosong.',
  'automod.err.badDomain': 'Domain `{value}` tidak valid. Contoh: `youtube.com` atau `https://youtube.com/watch?v=1`.',
  'automod.err.unreadableDomain': 'Domain `{value}` tidak bisa dibaca.',
  'automod.err.emptyInvite': 'Kode invite tidak boleh kosong.',
  'automod.err.badInvite': 'Kode invite `{value}` tidak valid. Contoh: `abc123` atau `discord.gg/abc123`.',
  'automod.err.badWord': 'Kata terlarang harus 2–50 karakter dan tanpa baris baru.',
  'automod.err.duplicateExemption': 'ID itu sudah ada di daftar pengecualian {kind}.',
  'automod.err.missingExemption': 'ID itu tidak ada di daftar pengecualian {kind}.',
  'automod.err.wrongList': 'Rule **{rule}** tidak memakai daftar `{field}`.',
  'automod.err.itemExists': '`{value}` sudah ada di daftar {field}.',
  'automod.err.itemMissing': '`{value}` tidak ada di daftar {field}.',
  'automod.err.dbOffline': 'Database tidak bisa dihubungi, jadi pengaturan automod belum bisa dibaca atau disimpan.\nPeriksa `DATABASE_URL` di .env dan koneksi internetmu; `npm run infra:up` hanya berlaku kalau memakai Postgres lokal.',
  'automod.err.dbOfflineTitle': '❌ Database Offline',
  'automod.err.generic': 'Terjadi kesalahan saat mengakses pengaturan automod. Detailnya sudah dicatat di log bot.',
  'automod.reply.needManageGuild': 'Perintah ini butuh izin **Manage Server**.',
  'automod.reply.toggled': '{mark} Rule **{rule}** {state}.',
  'automod.state.on': 'dinyalakan',
  'automod.state.off': 'dimatikan',
  'automod.reply.thresholdChanged': '🎚️ Ambang **{rule}** diubah menjadi {value}.',
  'automod.reply.wordAdded': '🤬 Kata `{word}` ditambahkan ke daftar terlarang.',
  'automod.reply.wordRemoved': '✅ Kata `{word}` dihapus dari daftar terlarang.',
  'automod.reply.channelExempt': '🚫 <#{channel}> dikecualikan dari automod.',
  'automod.reply.channelChecked': '🚫 <#{channel}> kembali diperiksa oleh automod.',
  'automod.reply.roleExempt': '🚫 <@&{role}> dikecualikan dari automod.',
  'automod.reply.roleChecked': '🚫 <@&{role}> kembali diperiksa oleh automod.',
  'automod.reply.domainAllowed': '🌐 Domain `{domain}` diizinkan untuk anti-link.',
  'automod.reply.domainRemoved': '🌐 Domain `{domain}` dihapus dari daftar izin anti-link.',
  'automod.reply.inviteAllowed': '🔗 Invite `{code}` diizinkan untuk anti-invite.',
  'automod.reply.inviteRemoved': '🔗 Invite `{code}` dihapus dari daftar izin anti-invite.',
  'automod.log.title': '🤖 Automod — {rule}',
  'automod.log.timeoutMinutes': '{action} {minutes} menit',
  // ── Privasi (PRD 12) ────────────────────────────────────────────────
  // Inventaris data member, konfirmasi & hasil /data-delete, embed log,
  // dan masa simpan. Angka retensi tetap diambil dari modul pelaksana
  // (retention.ts), jadi katalog ini hanya menyimpan kalimatnya.
  'privacy.embed.title': '🔒 Data yang disimpan Harmony tentang <@{user}>',
  'privacy.embed.intro':
    'Semua angka di bawah hanya berlaku untuk **server ini** dan bisa berbeda di server lain.',
  'privacy.embed.field.retention': 'Masa simpan',
  'privacy.embed.field.neverStored': 'Tidak pernah disimpan',
  'privacy.never.voice':
    '• Isi voice atau video call — Harmony hanya melihat kamu bergabung/meninggalkan voice.',
  'privacy.never.messages':
    '• Isi pesan, kecuali ringkasan event yang masuk ke log server.',
  'privacy.never.external':
    '• Data pribadi di luar Discord (nama asli, email, telepon) — Harmony tidak pernah memintanya.',
  'privacy.embed.footer':
    'Untuk menghapus data yang disimpan tentangmu: /data-delete · hanya berlaku di server ini',
  'privacy.row.cases': 'Kasus moderasi',
  'privacy.row.activeWarnings': 'Peringatan yang masih berlaku',
  'privacy.row.notes': 'Catatan internal (/note)',
  'privacy.row.tickets': 'Tiket dibuka (+ transkrip tersimpan)',
  'privacy.row.playlists': 'Playlist milikmu',
  'privacy.row.customCommands': 'Perintah custom yang kamu buat',
  'privacy.row.logEntries': 'Entri log yang menyebut kamu',
  'privacy.row.noCases': 'Tidak ada',
  'privacy.row.ticketValue': '{tickets} (+{transcripts})',
  'privacy.retention.line': '• **{label}** — {days} hari ({since})',
  'privacy.retention.cases': 'Kasus moderasi, catatan internal, & peringatan',
  'privacy.retention.casesSince': 'sejak aksinya dicatat',
  'privacy.retention.tickets': 'Tiket & transkrip percakannya',
  'privacy.retention.ticketsSince': 'sejak tiket ditutup',
  'privacy.retention.logs': 'Riwayat log event',
  'privacy.retention.logsSince': 'sejak entri log ditulis',
  'privacy.confirm.title': '⚠️ Hapus data yang disimpan tentangmu?',
  'privacy.confirm.intro':
    'Tindakan ini **tidak bisa dibatalkan** dan akan berlaku di server ini:',
  'privacy.confirm.hint': 'Untuk melanjutkan, jalankan ulang dengan `confirm:true`.',
  'privacy.confirm.footerOne':
    'Retensi normal: 1 tahun — penghapusan ini lebih cepat',
  'privacy.confirm.footerMany':
    'Retensi normal: {years} tahun — penghapusan ini lebih cepat',
  'privacy.reply.emptyWarning':
    'Tidak ada data yang tersimpan di server ini — menjalankan perintah ini tidak akan mengubah apa pun.',
  'privacy.done.title': '✅ Permintaan penghapusan data diproses',
  'privacy.done.nothing': 'Tidak ada data yang tersimpan tentangmu di server ini.',
  'privacy.done.removedHeader': '**Yang dihapus:**',
  'privacy.done.identityLine':
    '• Identitas kamu pada {cases} kasus, {warnings} peringatan, dan {tickets} tiket',
  'privacy.done.transcriptsLine': '• Isi {count} transkrip percakapan tiket',
  'privacy.done.noTranscripts':
    '• Tidak ada transkrip percakapan yang perlu dihapus',
  'privacy.done.logsLine': '• {count} entri log yang menyebut kamu',
  'privacy.done.playlistsLine':
    '• Kepemilikan {count} playlist dilepas — isi lagunya tetap bisa dipakai member lain',
  'privacy.done.customCommandsLine':
    '• Pembuat {count} perintah custom dilepas — teks balasannya tetap dipakai member lain',
  'privacy.done.keptContent':
    '**Yang dibuang isinya tapi strukturnya tetap:** alasan kasus, catatan internal, dan topik tiket — diganti penanda otomatis.',
  'privacy.done.keptCaseFrame':
    'Yang **tidak** ikut dihapus: kerangka kasusnya (tipe aksi, waktu, moderator yang bertindak). Ini supaya keputusan moderasi berikutnya tidak berjalan tanpa konteks, dan tidak lagi bisa dikaitkan dengan dirimu.',
  'privacy.done.keptModerator':
    'Tindakan yang **kamu** lakukan sebagai moderator juga tidak ikut berubah — itu catatan tanggung jawabmu di server ini.',
  'privacy.done.footer':
    'Pseudonim: {pseudonym} · data di server lain tidak tersentuh',
  'privacy.log.line':
    '{kind} oleh <@{actor}> · {cases} kasus, {warnings} peringatan, {tickets} tiket, {transcripts} transkrip, {logs} log · {pseudonym}',
  'privacy.log.lineSelf': 'Permintaan penghapusan data mandiri',
  'privacy.log.lineOther': 'Permintaan penghapusan data atas nama user lain',
  'privacy.log.titleSelf': '🔒 Permintaan Penghapusan Data Mandiri',
  'privacy.log.titleOther': '🔒 Permintaan Penghapusan Data Atas Nama User Lain',
  'privacy.log.casesField': '• Kasus dianonimkan: `{count}`',
  'privacy.log.warningsField': '• Peringatan dianonimkan: `{count}`',
  'privacy.log.ticketsField':
    '• Tiket dianonimkan: `{tickets}` · transkrip dihapus: `{transcripts}`',
  'privacy.log.logsField': '• Entri log dihapus: `{count}`',
  'privacy.log.playlistsField': '• Playlist dianonimkan: `{count}`',
  'privacy.log.customCommandsField': '• Perintah custom dianonimkan: `{count}`',
  'privacy.log.keptNote':
    'Kerangka kasus (tipe, waktu, moderator) sengaja disimpan; isi & identitasnya dilepas.',
  'privacy.log.field.requestedBy': 'Diminta oleh',
  'privacy.log.field.for': 'Untuk',
  'privacy.log.footer': 'Pseudonim: {pseudonym}',
  'privacy.gate.needsModerateMembers':
    'Perintah ini butuh izin **{permission}** untuk melihat data orang lain.',
  'privacy.gate.needsManageGuild':
    'Untuk menghapus data orang lain, perintah ini butuh izin **Manage Server**.',
  'privacy.err.readFailed': 'Gagal membaca data yang tersimpan. Coba lagi sebentar lagi.',
  'privacy.err.deleteFailed':
    'Permintaan gagal diproses, jadi **ada data yang mungkin belum terhapus**. ' +
      'Coba lagi sebentar lagi, atau laporkan ke owner server.',

  // ── Perintah custom (/customcommand) ───────────────────────────────
  'cc.list.title': '💬 Perintah Custom',
  'cc.list.empty':
    'Belum ada perintah custom.\nBuat dengan `/customcommand add <nama> <balasan>`, ' +
      'lalu panggil dengan `{prefix}nama`.',
  'cc.list.count': '{count} perintah. Panggil dengan awalan `{prefix}` di channel teks.',
  'cc.list.field': 'Daftar perintah',
  'cc.list.footer': 'Rincian & pratinjau: /customcommand show <nama>',
  'cc.list.moduleOff':
    'Modul sedang mati — perintah tidak akan dipanggil. Nyalakan dengan /config set custom-commands:true',
  'cc.detail.title': '💬 {prefix}{name}',
  'cc.detail.createdBy': 'Dibuat oleh',
  'cc.detail.updated': 'Diubah',
  'cc.detail.invoke': 'Panggil dengan',
  'cc.detail.response': 'Balasan',
  'cc.detail.preview': 'Pratinjau',
  'cc.detail.previewTruncated': 'Pratinjau (dipotong)',
  'cc.detail.placeholders': 'Placeholder yang bisa dipakai',
  'cc.creator.anon': 'Anonim',
  'cc.deleted.title': '🗑️ Perintah dihapus',
  'cc.deleted.description': '`{prefix}{name}` tidak lagi dipanggil.\nDihapus oleh {creator}.',
  'cc.add.created': 'Perintah `{prefix}{name}` dibuat.',
  'cc.add.replaced': 'Balasan `{prefix}{name}` diperbarui.',
  'cc.add.titleCreated': '💬 Perintah Ditambahkan',
  'cc.add.titleUpdated': '♻️ Perintah Diperbarui',
  'cc.err.notFound': 'Perintah `{prefix}{name}` tidak ada di server ini.',
  'cc.err.emptyName': 'Nama perintah tidak boleh kosong.',
  'cc.err.nameTooLong': 'Nama perintah maksimal {max} karakter (sekarang {now}).',
  'cc.err.namePattern':
    'Nama perintah harus diawali huruf, lalu hanya boleh huruf, angka, strip (-), dan garis bawah (_).',
  'cc.err.reserved':
    '`{name}` tidak boleh dipakai: nama itu dipakai perintah Harmony yang lain. Pilih nama lain supaya tidak ambigu.',
  'cc.err.emptyResponse': 'Isi balasan tidak boleh kosong.',
  'cc.err.responseTooLong': 'Isi balasan maksimal {max} karakter (sekarang {now}).',
  'cc.err.generic': 'Gagal memproses perintah custom. Detailnya sudah dicatat di log bot.',
  'cc.preview.args': 'contoh',
  'cc.placeholder.user': 'mention pemanggil',
  'cc.placeholder.username': 'nama pengguna pemanggil',
  'cc.placeholder.guild': 'nama server ini',
  'cc.placeholder.channel': 'mention channel tempat dipanggil',
  'cc.placeholder.args': 'teks setelah nama perintah',

  // ── Reaction role (/reactionrole) ──────────────────────────────────
  'rr.select.placeholder': 'Pilih role yang ingin kamu ambil',
  'rr.role.missing': 'Role tidak ditemukan',
  'rr.role.byId': 'Role {id}',
  'rr.panel.title': '🎭 Ambil Role Sendiri',
  'rr.panel.intro':
    'Pilih role di bawah untuk mengambilnya. Pilih role yang sama lagi untuk melepaskannya.',
  'rr.panel.roleHint': '*Role yang tidak bisa kamu ambil sendiri? Minta ke moderator server.*',
  'rr.panel.footer': 'Panel #{id} · {count} role tersedia · {lifetime}',
  'rr.closed.title': '🎭 Panel Ini Sudah Ditutup',
  'rr.closed.description':
    'Panel **#{id}** sudah tidak bisa dipakai untuk mengambil role.\n\n{reason}\n\nMinta moderator server kalau kamu masih butuh role ini.',
  'rr.closed.footer': 'Panel · select menu sudah dilepas',
  'rr.close.reason.expired':
    'Panel ini punya masa hidup dan sudah habis. Select menu-nya sudah dilepas.',
  'rr.close.reason.manual':
    'Panel ini ditutup manual oleh moderator server. Select menu-nya sudah dilepas.',
  'rr.lifetime.none': 'tanpa masa hidup',
  'rr.lifetime.closed': 'sudah ditutup',
  'rr.lifetime.until': 'aktif sampai <t:{unix}:R>',
  'rr.lifetime.days': '{count} hari',
  'rr.lifetime.hours': '{count} jam',
  'rr.lifetime.minutes': '{count} menit',
  'rr.list.title': '🎭 Panel Reaction Role',
  'rr.list.empty':
    'Belum ada panel. Buat dengan `/reactionrole post channel:#pengaturan roles:@Pemain,@Penggemar`.',
  'rr.list.more': ', +{count} lagi',
  'rr.list.line': '**#{id}** · <#{channel}> · {state} · {count} role\n{roles}{more}',
  'rr.state.closed': '⚫ sudah ditutup',
  'rr.state.expired': '⏳ habis, menunggu sapuan',
  'rr.state.until': '🟢 aktif sampai <t:{unix}:R>',
  'rr.state.noMessage': '🟡 pesan belum terkirim',
  'rr.state.active': '🟢 aktif',
  'rr.updated.title': '🎭 Panel Reaction Role Diperbarui',
  'rr.updated.description': '{message}\n\nPanel **#{id}** sekarang punya {count} role.',
  'rr.updated.added': 'Ditambahkan: {roles}.',
  'rr.updated.removed': 'Dihapus dari panel: {roles}.',
  'rr.cmd.notFound': 'Panel #{id} tidak ada di server ini.',
  'rr.cmd.alreadyClosed': 'Panel **#{id}** sudah ditutup sebelumnya.',
  'rr.cmd.closed':
    'Panel **#{id}** ditutup. Select menu-nya sudah dilepas; pesan & datanya tetap tersimpan.',
  'rr.cmd.closedMessageGone':
    'Panel **#{id}** ditandai sudah tertutup, tapi pesannya tidak bisa diedit (kemungkinan sudah dihapus manual). Datanya sudah aman.',
  'rr.cmd.closedTitle': '🎭 Panel Ditutup',
  'rr.cmd.deleted': 'Panel **#{id}** dihapus.',
  'rr.cmd.deletedTitle': '🗑️ Panel Dihapus',
  'rr.cmd.created':
    'Panel **#{id}** dibuat di <#{channel}> dengan {count} role.{lifetime}',
  'rr.cmd.createdTitle': '🎭 Panel Dibuat',
  'rr.cmd.lifetime': ' Panel mati otomatis dalam {duration}.',
  'rr.cmd.permanent': ' Panel ini permanen.',
  'rr.err.invalidId': 'ID {label} tidak valid: `{value}`.',
  'rr.err.tooManyOptions':
    'Satu panel maksimal {max} role (sekarang {total}). Buat panel terpisah, atau kurangi role yang ditambahkan.',
  'rr.err.lastOption':
    'Ini opsi terakhir di panel. Hapus panelnya dengan `/reactionrole delete` kalau memang tidak dipakai lagi.',
  'rr.err.noRoles': 'Sebutkan minimal satu role, contoh: `@Pemain @Penggemar`.',
  'rr.err.unreadableRoles':
    'Role tidak terbaca. Pilih role lewat autocomplete `@` agar tersimpan sebagai mention (`<@&123…>`), atau tulis ID role-nya.',
  'rr.err.durationUnreadable':
    'Masa hidup `{value}` tidak terbaca. Contoh yang benar: `30m`, `6h`, `7d`, atau `permanen`.',
  'rr.err.durationUnit':
    'Satuan `{unit}` tidak dikenal. Pakai `m` (menit), `h` (jam), atau `d` (hari).',
  'rr.err.durationMin':
    'Masa hidup panel minimal 10 menit. Pakai `permanen` kalau memang tidak ingin berakhir.',
  'rr.err.durationMax': 'Masa hidup panel maksimal 365 hari.',
  'rr.err.noRolesForPanel': 'Pilih minimal satu role untuk panel.',
  'rr.err.allRolesInPanel': 'Semua role itu sudah ada di panel ini.',
  'rr.err.dbOffline':
    'Database tidak bisa dihubungi, jadi panel role tidak bisa disimpan.\nPeriksa `DATABASE_URL` di .env dan koneksi internetmu; `npm run infra:up` hanya berlaku kalau memakai Postgres lokal.',
  'rr.err.dbOfflineTitle': '❌ Database Offline',
  'rr.err.generic':
    'Terjadi kesalahan saat memproses panel role. Detailnya sudah dicatat di log bot.',
  'rr.err.notTextChannel': 'Panel hanya bisa dikirim ke channel teks server.',
  'rr.err.moduleOff':
    'Modul reaction role sedang mati.\nNyalakan dengan `/config set reactions:true` dulu.',
  'rr.err.moduleOffTitle': '❌ Modul Mati',
  'rr.err.maxRoles': 'Maksimal {max} role per perintah (kirim {count}).',
  'rr.err.everyone': 'Role @everyone tidak bisa diambil sendiri.',
  'rr.err.needManageRoles':
    'Aku tidak punya izin **Manage Roles**, jadi role apa pun tidak bisa kupasang ke member.',
  'rr.err.roleTooHigh':
    'Role ini posisinya di atas aku: {roles}. Pindahkan role bot ke atas, atau pilih role yang lebih rendah.',
  'rr.select.closedPanel':
    'Panel role ini sudah ditutup, jadi role-nya tidak bisa diambil lagi. Minta moderator server.',
  'rr.select.panelGone':
    'Panel role ini sudah tidak ada. Minta admin untuk membuatnya ulang.',
  'rr.select.moduleOff': 'Modul reaction role sedang mati di server ini.',
  'rr.select.roleGone':
    'Role ini sudah dihapus dari server. Minta admin untuk memperbarui panelnya.',
  'rr.select.removed': 'Role <@&{role}> **dilepas**.',
  'rr.select.removeFailed':
    'Tidak bisa melepas role ini. Minta moderator server untuk membantu.',
  'rr.select.botMissing': 'Aku belum termuat di server ini. Coba lagi sebentar lagi.',
  'rr.select.cannotAssign':
    'Aku tidak bisa memberi role <@&{role}> — posisinya terlalu tinggi atau aku tidak punya izin **Manage Roles**.',
  'rr.select.added': 'Role <@&{role}> **diambil**.',
  'rr.select.addFailed':
    'Tidak bisa memasang role ini. Minta moderator server untuk membantu.',

  // ── Tiket (/ticket) ────────────────────────────────────────────────
  'ticket.panel.title': '🎫 Butuh Bantuan?',
  'ticket.panel.intro': 'Klik tombol di bawah, isi topik singkat, lalu channel privatmu akan dibuat. Hanya kamu dan tim staff yang bisa membacanya.',
  'ticket.panel.staff': '👮 Staff',
  'ticket.panel.footer': 'Satu member hanya boleh punya satu tiket terbuka · tutup tiketmu sebelum membuka yang baru',
  'ticket.button.create': 'Buat Tiket',
  'ticket.button.claim': 'Klaim',
  'ticket.button.close': 'Tutup Tiket',
  'ticket.opened.title': '🎫 Tiket {id} dibuka',
  'ticket.opened.intro': 'Sebutkan masalahmu di sini — semakin lengkap, semakin cepat staff bisa membantu.',
  'ticket.opened.opener': 'Pembuat',
  'ticket.opened.staff': 'Staff',
  'ticket.opened.subject': 'Subjek',
  'ticket.opened.noSubject': '*tidak disebutkan*',
  'ticket.closed.title': '🔒 Tiket {id} ditutup',
  'ticket.closed.description': 'Channel ini sudah dikunci dan tidak bisa dipakai lagi. Riwayatnya tetap tersimpan di sini untuk dibaca staff.',
  'ticket.closed.by': 'Ditutup oleh',
  'ticket.list.title': '🎫 Tiket Terbuka',
  'ticket.list.empty': 'Tidak ada tiket terbuka. Bagus!',
  'ticket.list.channelGone': '*channel hilang*',
  'ticket.list.claimer': ' · ditangani <@{user}>',
  'ticket.list.subject': ' — {subject}',
  'ticket.list.line': '**{id}** {channel} · <@{opener}>{subject}\n< <t:{created}:R>{claimer}',
  'ticket.list.more': '\n\n*+{count} tiket lain tidak ditampilkan.*',
  'ticket.list.footer': '{count} tiket terbuka',
  'ticket.transcript.title': '📄 Transkrip Tiket {id}',
  'ticket.transcript.ticketField': 'Tiket',
  'ticket.transcript.noSubject': '*tanpa subjek*',
  'ticket.transcript.openerLine': 'Pembuat: <@{user}>',
  'ticket.transcript.closedLine': 'Ditutup: <t:{time}:f>',
  'ticket.transcript.openStatus': 'Status: masih terbuka',
  'ticket.transcript.contentField': 'Isi',
  'ticket.transcript.count': '{count} pesan tersimpan',
  'ticket.transcript.truncatedTitle': '⚠️ Dipotong',
  'ticket.transcript.truncatedBody': 'Hanya {max} pesan terakhir yang tersimpan.',
  'ticket.transcript.previewHeader': '**{count} pesan terakhir**\n{lines}',
  'ticket.transcript.header': 'Transkrip Tiket {id}',
  'ticket.transcript.subjectLine': 'Subjek: {subject}',
  'ticket.transcript.opener': 'Pembuat: {id}',
  'ticket.transcript.openedAt': 'Dibuka: {time}',
  'ticket.transcript.closedAt': 'Ditutup: {time}',
  'ticket.transcript.savedCount': 'Pesan tersimpan: {count}',
  'ticket.transcript.empty': '(tidak ada pesan yang bisa dibaca)',
  'ticket.transcript.entry': '[{time}] {author} ({id}): {text}',
  'ticket.transcript.attachment': '    lampiran: {url}',
  'ticket.transcript.truncatedNote': 'Catatan: transkrip dipotong pada {max} pesan terakhir;\npercakapan yang lebih lama tidak tersimpan.',
  'ticket.transcript.noText': '(tanpa teks)',
  'ticket.transcript.previewLine': '`{time} UTC` **{author}**: {text}',
  'ticket.err.notCached': 'Server ini belum termuat penuh, jadi perintah tiket belum bisa dipakai. Coba lagi sebentar lagi.',
  'ticket.err.moduleOff': 'Modul tiket sedang mati.\nNyalakan dengan `/config set tickets:true` dulu.',
  'ticket.err.moduleOffTitle': '❌ Modul Mati',
  'ticket.err.noCategory': 'Kategori tiket belum diatur. Jalankan `/ticket setup` dulu.',
  'ticket.err.noStaffRole': 'Role staff tiket belum diatur. Jalankan `/ticket setup` dulu.',
  'ticket.err.subjectTooShort': 'Tuliskan topik tiket minimal {min} karakter, supaya staff tahu harus membantu apa.',
  'ticket.err.alreadyClosed': 'Tiket ini sudah ditutup.',
  'ticket.err.dbOffline': 'Database tidak bisa dihubungi, jadi tiket tidak bisa dicatat.\nPeriksa `DATABASE_URL` di .env dan koneksi internetmu; `npm run infra:up` hanya berlaku kalau memakai Postgres lokal.',
  'ticket.err.dbOfflineTitle': '❌ Database Offline',
  'ticket.err.generic': 'Terjadi kesalahan saat memproses tiket. Detailnya sudah dicatat di log bot.',
  'ticket.err.channelFailed': 'Gagal membuat channel tiket. Pastikan aku punya izin **Manage Channels** dan kategori tiket yang kamu tentukan masih ada.',
  'ticket.btn.claimNotStaff': 'Hanya staff tiket yang bisa mengklaim tiket ini.',
  'ticket.btn.claimed': 'Tiket {number} sekarang ditangani <@{user}>.',
  'ticket.btn.closeNotAllowed': 'Hanya staff atau pembuat tiket yang bisa menutupnya.',
  'ticket.btn.closed': 'Tiket {number} ditutup dan diarsipkan. Isinya tetap tersimpan.',
  'ticket.btn.closedChannelGone': 'Tiket {number} ditandai sudah tertutup, tapi channelnya tidak bisa diarsipkan (mungkin sudah dihapus manual). Periksa datanya.',
  'ticket.modal.title': 'Buat Tiket',
  'ticket.modal.subjectLabel': 'Topik tiket',
  'ticket.modal.subjectPlaceholder': 'Contoh: tidak bisa masuk voice channel',
  'ticket.modal.openFailed': 'Tidak bisa membuka formulir tiket. Coba lagi sebentar lagi.',
  'ticket.modal.duplicateWithChannel': 'Kamu sudah punya tiket terbuka: <#{channel}>. Tutup dulu sebelum membuka yang baru.',
  'ticket.modal.duplicate': 'Kamu sudah punya tiket terbuka. Tutup dulu sebelum membuka yang baru.',
  'ticket.modal.created': 'Tiket dibuat: <#{channel}>. Topik: **{subject}**',
  'ticket.cmd.noTicket': 'Tiket tidak ditemukan. Jalankan di dalam channel tiketnya, atau sebut nomornya lewat `/ticket transcript ticket:7`.',
  'ticket.cmd.transcriptDenied': 'Transkrip ini hanya bisa dibaca staff tiket atau member yang membukanya.',
  'ticket.cmd.noTranscript': 'Transkrip untuk tiket ini tidak tersedia. Bisa jadi tiketnya ditutup sebelum fitur transkrip ada, channelnya sudah dihapus manual, atau pembacaan pesannya gagal.',
  'ticket.cmd.noTranscriptTitle': '📄 Transkrip Tidak Tersedia',
  'ticket.cmd.noOpenHere': 'Tidak ada tiket terbuka di channel ini. Jalankan perintah ini di dalam channel tiketnya.',
  'ticket.cmd.closedChannelGone': 'Tiket {number} ditandai sudah ditutup, tapi channelnya tidak bisa diarsipkan (kemungkinan sudah dihapus manual).',
  'ticket.cmd.closed': 'Tiket {number} ditutup dan diarsipkan.',
  'ticket.cmd.noPanelChannel': 'Channel panel tiket tidak bisa dikirim. Pastikan channel-nya masih ada dan bertipe teks.',
  'ticket.cmd.setupDone': 'Tiket siap dipakai. Panel dikirim ke <#{channel}>.',
  'ticket.cmd.panelResent': 'Panel tiket dikirim ulang ke <#{channel}>.',
  'ticket.cmd.panelTitle': '🎫 Tiket Disiapkan',
  'ticket.audit.closed': 'Tiket ditutup',
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

  // Log event embeds: titles, field names, and values built by a single event.
  // Kept as one block so an event title never gets scattered across the catalog.
  'log.embed.title.banAdd': '🔨 Member banned',
  'log.embed.title.banAddHarmony': '🔨 Member banned (Harmony)',
  'log.embed.title.banRemove': '♻️ Ban lifted',
  'log.embed.title.banRemoveHarmony': '♻️ Ban lifted (Harmony)',
  'log.embed.title.memberAdd': '👤 Member joined',
  'log.embed.title.memberKick': '👢 Member kicked',
  'log.embed.title.memberLeave': '🚪 Member left',
  'log.embed.title.memberUpdate': '📝 Member updated',
  'log.embed.title.memberTimeout': '⏱️ Timeout updated (Harmony)',
  'log.embed.title.messageDelete': '🗑️ Message deleted',
  'log.embed.title.messageBulkDelete': '🧹 Bulk message delete',
  'log.embed.title.messageUpdate': '✏️ Message edited',
  'log.embed.title.channelCreate': '📁 Channel created',
  'log.embed.title.channelDelete': '🗑️ Channel deleted',
  'log.embed.title.channelUpdate': '📝 Channel updated',
  'log.embed.title.channelUpdateHarmony': '📝 Channel updated (Harmony)',
  'log.embed.title.roleCreate': '🎭 Role created',
  'log.embed.title.roleDelete': '🗑️ Role deleted',
  'log.embed.title.roleUpdate': '📝 Role updated',
  'log.embed.title.emojiCreate': '😀 Emoji added',
  'log.embed.title.emojiDelete': '🗑️ Emoji deleted',
  'log.embed.title.emojiUpdate': '📝 Emoji updated',
  'log.embed.title.stickerCreate': '🩹 Sticker added',
  'log.embed.title.stickerDelete': '🗑️ Sticker deleted',
  'log.embed.title.stickerUpdate': '📝 Sticker updated',
  'log.embed.title.guildUpdate': '🏠 Server updated',
  'log.embed.title.voiceJoin': '🔊 Joined voice',
  'log.embed.title.voiceLeave': '🔇 Left voice',
  'log.embed.title.voiceMove': '🔁 Moved voice',
  'log.embed.title.voiceState': '🎙️ Voice state',
  'log.embed.field.member': 'Member',
  'log.embed.field.id': 'ID',
  'log.embed.field.channel': 'Channel',
  'log.embed.field.name': 'Name',
  'log.embed.field.type': 'Type',
  'log.embed.field.category': 'Category',
  'log.embed.field.color': 'Colour',
  'log.embed.field.mentionable': 'Mentionable',
  'log.embed.field.hoist': 'Displayed separately',
  'log.embed.field.emoji': 'Emoji',
  'log.embed.field.animated': 'Animated',
  'log.embed.field.description': 'Description',
  'log.embed.field.tags': 'Tags',
  'log.embed.field.role': 'Role',
  'log.embed.field.author': 'Author',
  'log.embed.field.jump': 'Jump',
  'log.embed.field.count': 'Count',
  'log.embed.field.joined': 'Joined',
  'log.embed.field.accountCreated': 'Account created',
  'log.embed.field.messageId': 'Message ID',
  'log.embed.field.attachments': 'Attachments',
  'log.embed.field.from': 'From',
  'log.embed.field.to': 'To',
  'log.embed.field.topic': 'Topic',
  'log.embed.field.nsfw': 'NSFW',
  'log.embed.field.slowmode': 'Slowmode',
  'log.embed.field.userLimit': 'User limit',
  'log.embed.field.serverName': 'Server name',
  'log.embed.field.vanityUrl': 'Vanity URL',
  'log.embed.field.owner': 'Owner',
  'log.embed.field.boostTier': 'Boost tier',
  'log.embed.field.boosts': 'Boost count',
  'log.embed.field.icon': 'Icon',
  'log.embed.field.banner': 'Banner',
  'log.embed.field.serverMute': 'Server mute',
  'log.embed.field.serverDeaf': 'Server deaf',
  'log.embed.field.selfMute': 'Self mute',
  'log.embed.field.selfDeaf': 'Self deaf',
  'log.embed.field.streaming': 'Streaming',
  'log.embed.field.nickname': 'Nickname',
  'log.embed.field.timeout': 'Timeout',
  'log.embed.field.rolesAdded': 'Roles added',
  'log.embed.field.rolesRemoved': 'Roles removed',
  'log.embed.field.permsAdded': 'Permissions added',
  'log.embed.field.permsRemoved': 'Permissions removed',
  'log.embed.value.present': 'Present',
  'log.embed.value.absent': 'None',
  'log.embed.value.messageCount': '{count} messages',
  'log.embed.value.attachmentCount': '{count} files',
  'log.embed.value.others': '(+{count} more)',
  'log.embed.value.seconds': '{count} seconds',
  'log.embed.value.level': 'Level {level}',
  'log.embed.value.noContent': '*Message content is not available.*',
  'log.embed.value.noPrevious': '*Previous content is not available (the old message was not cached).*',
  'log.embed.value.before': '**Before:**',
  'log.embed.value.after': '**After:**',
  'log.embed.value.jumpLink': 'Open message',
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

  // ── Automod (PRD 7.2) ─────────────────────────────────────────────
  // Judul embed, nama field, label rule & aksi, ambang, alasan
  // pelanggaran, error validasi, dan balasan tiap subcommand.
  'automod.title': '🤖 Automod',
  'automod.field.rules': 'Rules',
  'automod.field.exemptChannels': '🚫 Exempt channels',
  'automod.field.exemptRoles': '🚫 Exempt roles',
  'automod.field.badwords': '🤬 Banned words',
  'automod.field.allowedDomains': '🌐 Allowed domains',
  'automod.field.allowedInvites': '🔗 Allowed invites',
  'automod.field.user': 'User',
  'automod.field.channel': 'Channel',
  'automod.field.actions': 'Actions',
  'automod.field.reason': 'Reason',
  'automod.field.case': 'Case',
  'automod.field.message': 'Message content',
  'automod.module.on': 'The automod module is **on** — the rules below apply to every message.',
  'automod.module.off': 'The automod module is **off**. Turn it on with `/config set automod:true` (or the `/setup` wizard) before the rules apply.',
  'automod.footer.exempt': 'Message authors with Manage Messages, and every bot, are always exempt.',
  'automod.value.notSet': '*none yet*',
  'automod.rule.spam.label': 'Anti-spam',
  'automod.rule.spam.description': 'Messages sent too quickly in a row (default 5 messages / 5 seconds)',
  'automod.rule.invite.label': 'Anti-invite',
  'automod.rule.invite.description': 'Discord server invite links (default delete + warn)',
  'automod.rule.link.label': 'Anti-link',
  'automod.rule.link.description': 'Every URL (default delete)',
  'automod.rule.badword.label': 'Bad words',
  'automod.rule.badword.description': 'The banned word list (empty by default)',
  'automod.rule.mention.label': 'Anti-mention spam',
  'automod.rule.mention.description': 'Too many mentions in one message (default >5 → 10 minute timeout)',
  'automod.rule.caps.label': 'Anti-caps',
  'automod.rule.caps.description': 'Shouted messages: >70% capital letters and longer than 10 characters',
  'automod.rule.duplicate.label': 'Anti-duplicate',
  'automod.rule.duplicate.description': 'Identical messages in a row (default 3x)',
  'automod.action.delete': 'Delete message',
  'automod.action.warn': 'Record a warning',
  'automod.action.timeout': 'Timeout',
  'automod.threshold.spam': '{count} messages / {seconds} seconds',
  'automod.threshold.mention': '{count} mentions / message',
  'automod.threshold.caps': '{percent}% capital letters',
  'automod.threshold.duplicate': '{count}x in a row',
  'automod.threshold.none': '—',
  'automod.reason.spam': 'Sent {count} messages in {seconds} seconds',
  'automod.reason.invite': 'Sent a Discord server invite link',
  'automod.reason.link': 'Sent a link: {hosts}',
  'automod.reason.badword': 'Contains a banned word: `{word}`',
  'automod.reason.mention': 'Mentioned {count} times in one message',
  'automod.reason.caps': 'Too many capital letters ({percent}%)',
  'automod.reason.duplicate': 'Sent the same message {count}x in a row',
  'automod.reason.overflow': ' (+{count})',
  'automod.err.rejectedTitle': '❌ Automod Settings Rejected',
  'automod.err.invalidId': 'The {label} ID is not valid: `{value}`.',
  'automod.err.noThreshold': 'The **{rule}** rule has no adjustable threshold — just turn it on or off.',
  'automod.err.thresholdRange': 'The threshold for **{rule}** must be a whole number between {min} and {max}. Now: {current}.',
  'automod.err.emptyDomain': 'The domain cannot be empty.',
  'automod.err.badDomain': 'The domain `{value}` is not valid. Example: `youtube.com` or `https://youtube.com/watch?v=1`.',
  'automod.err.unreadableDomain': 'The domain `{value}` could not be read.',
  'automod.err.emptyInvite': 'The invite code cannot be empty.',
  'automod.err.badInvite': 'The invite code `{value}` is not valid. Example: `abc123` or `discord.gg/abc123`.',
  'automod.err.badWord': 'A banned word must be 2–50 characters and contain no line breaks.',
  'automod.err.duplicateExemption': 'That ID is already in the {kind} exemption list.',
  'automod.err.missingExemption': 'That ID is not in the {kind} exemption list.',
  'automod.err.wrongList': 'The **{rule}** rule does not use the `{field}` list.',
  'automod.err.itemExists': '`{value}` is already in the {field} list.',
  'automod.err.itemMissing': '`{value}` is not in the {field} list.',
  'automod.err.dbOffline': 'The database cannot be reached, so the automod settings cannot be read or saved yet.\nCheck `DATABASE_URL` in .env and your internet connection; `npm run infra:up` only helps with a local Postgres.',
  'automod.err.dbOfflineTitle': '❌ Database Offline',
  'automod.err.generic': 'Something went wrong while accessing the automod settings. The details are in the bot log.',
  'automod.reply.needManageGuild': 'This command needs the **Manage Server** permission.',
  'automod.reply.toggled': '{mark} The **{rule}** rule was turned {state}.',
  'automod.state.on': 'on',
  'automod.state.off': 'off',
  'automod.reply.thresholdChanged': '🎚️ The **{rule}** threshold is now {value}.',
  'automod.reply.wordAdded': '🤬 The word `{word}` was added to the banned list.',
  'automod.reply.wordRemoved': '✅ The word `{word}` was removed from the banned list.',
  'automod.reply.channelExempt': '🚫 <#{channel}> is now exempt from automod.',
  'automod.reply.channelChecked': '🚫 <#{channel}> is checked by automod again.',
  'automod.reply.roleExempt': '🚫 <@&{role}> is now exempt from automod.',
  'automod.reply.roleChecked': '🚫 <@&{role}> is checked by automod again.',
  'automod.reply.domainAllowed': '🌐 The domain `{domain}` is now allowed for anti-link.',
  'automod.reply.domainRemoved': '🌐 The domain `{domain}` was removed from the anti-link allow list.',
  'automod.reply.inviteAllowed': '🔗 The invite `{code}` is now allowed for anti-invite.',
  'automod.reply.inviteRemoved': '🔗 The invite `{code}` was removed from the anti-invite allow list.',
  'automod.log.title': '🤖 Automod — {rule}',
  'automod.log.timeoutMinutes': '{action} for {minutes} minutes',
  'privacy.embed.title': '🔒 Data Harmony stores about <@{user}>',
  'privacy.embed.intro':
    'Every number below applies to **this server** only, and may differ in other servers.',
  'privacy.embed.field.retention': 'Retention',
  'privacy.embed.field.neverStored': 'Never stored',
  'privacy.never.voice':
    '• Voice or video call contents — Harmony only sees you join or leave voice.',
  'privacy.never.messages':
    '• Message contents, except the event summaries that land in the server log.',
  'privacy.never.external':
    '• Personal data outside Discord (real name, email, phone number) — Harmony never asks for it.',
  'privacy.embed.footer':
    'To delete the data stored about you: /data-delete · this server only',
  'privacy.row.cases': 'Moderation cases',
  'privacy.row.activeWarnings': 'Warnings still in effect',
  'privacy.row.notes': 'Internal notes (/note)',
  'privacy.row.tickets': 'Tickets opened (+ transcripts kept)',
  'privacy.row.playlists': 'Your playlists',
  'privacy.row.customCommands': 'Custom commands you created',
  'privacy.row.logEntries': 'Log entries that mention you',
  'privacy.row.noCases': 'None',
  'privacy.row.ticketValue': '{tickets} (+{transcripts})',
  'privacy.retention.line': '• **{label}** — {days} days ({since})',
  'privacy.retention.cases': 'Moderation cases, internal notes, & warnings',
  'privacy.retention.casesSince': 'since the action was recorded',
  'privacy.retention.tickets': 'Tickets & their conversation transcripts',
  'privacy.retention.ticketsSince': 'since the ticket was closed',
  'privacy.retention.logs': 'Event log history',
  'privacy.retention.logsSince': 'since the log entry was written',
  'privacy.confirm.title': '⚠️ Delete the data stored about you?',
  'privacy.confirm.intro':
    'This **cannot be undone**, and it applies to this server:',
  'privacy.confirm.hint': 'To continue, run it again with `confirm:true`.',
  'privacy.confirm.footerOne':
    'Normal retention: 1 year — this deletion is faster',
  'privacy.confirm.footerMany':
    'Normal retention: {years} years — this deletion is faster',
  'privacy.reply.emptyWarning':
    'Nothing is stored in this server — running this command will not change anything.',
  'privacy.done.title': '✅ Data deletion request processed',
  'privacy.done.nothing': 'There is no stored data about you in this server.',
  'privacy.done.removedHeader': '**Deleted:**',
  'privacy.done.identityLine':
    '• Your identity in {cases} cases, {warnings} warnings, and {tickets} tickets',
  'privacy.done.transcriptsLine': '• Contents of {count} ticket conversation transcripts',
  'privacy.done.noTranscripts': '• No ticket transcripts needed deleting',
  'privacy.done.logsLine': '• {count} log entries that mention you',
  'privacy.done.playlistsLine':
    '• Ownership of {count} playlists released — the tracks stay available to other members',
  'privacy.done.customCommandsLine':
    '• The creator of {count} custom commands released — the replies stay in use by members',
  'privacy.done.keptContent':
    '**Contents replaced, structure kept:** case reasons, internal notes, and ticket subjects — swapped for an automatic marker.',
  'privacy.done.keptCaseFrame':
    'What is **not** deleted: the case frame itself (action type, time, which moderator acted). That keeps the next moderation decision from happening without context, and it can no longer be linked back to you.',
  'privacy.done.keptModerator':
    'Actions **you** took as a moderator are unchanged too — that is a record of your own responsibility in this server.',
  'privacy.done.footer':
    'Pseudonym: {pseudonym} · data in other servers is untouched',
  'privacy.log.line':
    '{kind} by <@{actor}> · {cases} cases, {warnings} warnings, {tickets} tickets, {transcripts} transcripts, {logs} log entries · {pseudonym}',
  'privacy.log.lineSelf': 'Self-serve data deletion request',
  'privacy.log.lineOther': 'Data deletion request on behalf of another user',
  'privacy.log.titleSelf': '🔒 Self-Serve Data Deletion Request',
  'privacy.log.titleOther': '🔒 Data Deletion Request on Behalf of Another User',
  'privacy.log.casesField': '• Cases anonymized: `{count}`',
  'privacy.log.warningsField': '• Warnings anonymized: `{count}`',
  'privacy.log.ticketsField':
    '• Tickets anonymized: `{tickets}` · transcripts deleted: `{transcripts}`',
  'privacy.log.logsField': '• Log entries deleted: `{count}`',
  'privacy.log.playlistsField': '• Playlists anonymized: `{count}`',
  'privacy.log.customCommandsField': '• Custom commands anonymized: `{count}`',
  'privacy.log.keptNote':
    'The case frame (type, time, moderator) is deliberately kept; its contents and identity are released.',
  'privacy.log.field.requestedBy': 'Requested by',
  'privacy.log.field.for': 'For',
  'privacy.log.footer': 'Pseudonym: {pseudonym}',
  'privacy.gate.needsModerateMembers':
    'This command needs the **{permission}** permission to view data about other members.',
  'privacy.gate.needsManageGuild':
    'Deleting data about other members requires the **Manage Server** permission.',
  'privacy.err.readFailed': 'Could not read the stored data. Please try again shortly.',
  'privacy.err.deleteFailed':
    'The request could not be processed, so **some data may still not be deleted**. ' +
      'Try again shortly, or report it to the server owner.',

  // ── Custom commands (/customcommand) ───────────────────────────────
  'cc.list.title': '💬 Custom Commands',
  'cc.list.empty':
    'There are no custom commands yet.\nCreate one with `/customcommand add <name> <reply>`, ' +
      'then trigger it with `{prefix}name`.',
  'cc.list.count': '{count} commands. Trigger them with the `{prefix}` prefix in a text channel.',
  'cc.list.field': 'Command list',
  'cc.list.footer': 'Details & preview: /customcommand show <name>',
  'cc.list.moduleOff':
    'The module is off — commands will not be triggered. Turn it on with /config set custom-commands:true',
  'cc.detail.title': '💬 {prefix}{name}',
  'cc.detail.createdBy': 'Created by',
  'cc.detail.updated': 'Last edited',
  'cc.detail.invoke': 'Trigger it with',
  'cc.detail.response': 'Reply',
  'cc.detail.preview': 'Preview',
  'cc.detail.previewTruncated': 'Preview (truncated)',
  'cc.detail.placeholders': 'Available placeholders',
  'cc.creator.anon': 'Anonymous',
  'cc.deleted.title': '🗑️ Command deleted',
  'cc.deleted.description': '`{prefix}{name}` is no longer triggered.\nDeleted by {creator}.',
  'cc.add.created': 'Command `{prefix}{name}` created.',
  'cc.add.replaced': 'The reply for `{prefix}{name}` was updated.',
  'cc.add.titleCreated': '💬 Command added',
  'cc.add.titleUpdated': '♻️ Command updated',
  'cc.err.notFound': 'There is no `{prefix}{name}` command on this server.',
  'cc.err.emptyName': 'The command name cannot be empty.',
  'cc.err.nameTooLong': 'A command name is at most {max} characters (currently {now}).',
  'cc.err.namePattern':
    'A command name must start with a letter, then only letters, digits, hyphens (-), and underscores (_).',
  'cc.err.reserved':
    '`{name}` cannot be used: another Harmony command uses that name. Pick a different name to avoid ambiguity.',
  'cc.err.emptyResponse': 'The reply cannot be empty.',
  'cc.err.responseTooLong': 'A reply is at most {max} characters (currently {now}).',
  'cc.err.generic': 'Failed to process the custom command. Details were written to the bot log.',
  'cc.preview.args': 'example',
  'cc.placeholder.user': 'mention of the caller',
  'cc.placeholder.username': 'display name of the caller',
  'cc.placeholder.guild': 'name of this server',
  'cc.placeholder.channel': 'mention of the channel it was triggered in',
  'cc.placeholder.args': 'text after the command name',

  // ── Reaction roles (/reactionrole) ─────────────────────────────────
  'rr.select.placeholder': 'Pick the role you want',
  'rr.role.missing': 'Role not found',
  'rr.role.byId': 'Role {id}',
  'rr.panel.title': '🎭 Pick Your Own Role',
  'rr.panel.intro':
    'Pick a role below to get it. Pick the same role again to remove it.',
  'rr.panel.roleHint': '*A role you cannot get yourself? Ask the server moderators.*',
  'rr.panel.footer': 'Panel #{id} · {count} roles available · {lifetime}',
  'rr.closed.title': '🎭 This Panel Is Closed',
  'rr.closed.description':
    'Panel **#{id}** can no longer be used to get roles.\n\n{reason}\n\nAsk the server moderators if you still need this role.',
  'rr.closed.footer': 'Panel · the select menu has been removed',
  'rr.close.reason.expired':
    'This panel had a lifetime and it has ended. Its select menu has been removed.',
  'rr.close.reason.manual':
    'This panel was closed manually by a server moderator. Its select menu has been removed.',
  'rr.lifetime.none': 'no lifetime',
  'rr.lifetime.closed': 'closed',
  'rr.lifetime.until': 'active until <t:{unix}:R>',
  'rr.lifetime.days': '{count} days',
  'rr.lifetime.hours': '{count} hours',
  'rr.lifetime.minutes': '{count} minutes',
  'rr.list.title': '🎭 Reaction Role Panels',
  'rr.list.empty':
    'No panels yet. Create one with `/reactionrole post channel:#settings roles:@Player,@Fan`.',
  'rr.list.more': ', +{count} more',
  'rr.list.line': '**#{id}** · <#{channel}> · {state} · {count} roles\n{roles}{more}',
  'rr.state.closed': '⚫ closed',
  'rr.state.expired': '⏳ ended, waiting for sweep',
  'rr.state.until': '🟢 active until <t:{unix}:R>',
  'rr.state.noMessage': '🟡 message not sent yet',
  'rr.state.active': '🟢 active',
  'rr.updated.title': '🎭 Reaction Role Panel Updated',
  'rr.updated.description': '{message}\n\nPanel **#{id}** now has {count} roles.',
  'rr.updated.added': 'Added: {roles}.',
  'rr.updated.removed': 'Removed from the panel: {roles}.',
  'rr.cmd.notFound': 'There is no panel #{id} on this server.',
  'rr.cmd.alreadyClosed': 'Panel **#{id}** was already closed.',
  'rr.cmd.closed':
    'Panel **#{id}** closed. Its select menu was removed; the message and its data are kept.',
  'rr.cmd.closedMessageGone':
    'Panel **#{id}** is marked closed, but its message could not be edited (likely deleted manually). The data is safe.',
  'rr.cmd.closedTitle': '🎭 Panel Closed',
  'rr.cmd.deleted': 'Panel **#{id}** deleted.',
  'rr.cmd.deletedTitle': '🗑️ Panel Deleted',
  'rr.cmd.created':
    'Panel **#{id}** created in <#{channel}> with {count} roles.{lifetime}',
  'rr.cmd.createdTitle': '🎭 Panel Created',
  'rr.cmd.lifetime': ' It turns off automatically in {duration}.',
  'rr.cmd.permanent': ' This panel is permanent.',
  'rr.err.invalidId': 'Invalid {label} ID: `{value}`.',
  'rr.err.tooManyOptions':
    'A panel holds at most {max} roles (currently {total}). Create a separate panel, or add fewer roles.',
  'rr.err.lastOption':
    'This is the last option in the panel. Delete the panel with `/reactionrole delete` if it is no longer used.',
  'rr.err.noRoles': 'Mention at least one role, for example: `@Player @Fan`.',
  'rr.err.unreadableRoles':
    'Could not read the roles. Pick them through the `@` autocomplete so they are stored as mentions (`<@&123…>`), or type the role IDs.',
  'rr.err.durationUnreadable':
    'Could not read the lifetime `{value}`. Valid examples: `30m`, `6h`, `7d`, or `permanen`.',
  'rr.err.durationUnit':
    'Unknown unit `{unit}`. Use `m` (minutes), `h` (hours), or `d` (days).',
  'rr.err.durationMin':
    'A panel lives for at least 10 minutes. Use `permanen` if you do not want it to end.',
  'rr.err.durationMax': 'A panel lives for at most 365 days.',
  'rr.err.noRolesForPanel': 'Pick at least one role for the panel.',
  'rr.err.allRolesInPanel': 'All of those roles are already in this panel.',
  'rr.err.dbOffline':
    'The database cannot be reached, so role panels cannot be saved.\nCheck `DATABASE_URL` in .env and your internet connection; `npm run infra:up` only applies when using a local Postgres.',
  'rr.err.dbOfflineTitle': '❌ Database Offline',
  'rr.err.generic':
    'Something went wrong while processing the role panel. Details were written to the bot log.',
  'rr.err.notTextChannel': 'A panel can only be posted to a server text channel.',
  'rr.err.moduleOff':
    'The reaction role module is off.\nTurn it on with `/config set reactions:true` first.',
  'rr.err.moduleOffTitle': '❌ Module Off',
  'rr.err.maxRoles': 'At most {max} roles per command ({count} sent).',
  'rr.err.everyone': 'The @everyone role cannot be self-assigned.',
  'rr.err.needManageRoles':
    'I do not have the **Manage Roles** permission, so I cannot assign any role to members.',
  'rr.err.roleTooHigh':
    'These roles sit above me: {roles}. Move my role higher, or pick lower roles.',
  'rr.select.closedPanel':
    'This role panel is closed, so its roles can no longer be taken. Ask the server moderators.',
  'rr.select.panelGone':
    'This role panel no longer exists. Ask an admin to create it again.',
  'rr.select.moduleOff': 'The reaction role module is off on this server.',
  'rr.select.roleGone':
    'This role was deleted from the server. Ask an admin to update the panel.',
  'rr.select.removed': 'Role <@&{role}> **removed**.',
  'rr.select.removeFailed': 'Could not remove this role. Ask the server moderators for help.',
  'rr.select.botMissing': 'I am not loaded in this server yet. Try again in a moment.',
  'rr.select.cannotAssign':
    'I cannot give the <@&{role}> role — it sits too high or I lack the **Manage Roles** permission.',
  'rr.select.added': 'Role <@&{role}> **claimed**.',
  'rr.select.addFailed': 'Could not assign this role. Ask the server moderators for help.',

  // ── Tickets (/ticket) ──────────────────────────────────────────────
  'ticket.panel.title': '🎫 Need Help?',
  'ticket.panel.intro': 'Click the button below, enter a short topic, and your private channel will be created. Only you and the staff team can read it.',
  'ticket.panel.staff': '👮 Staff',
  'ticket.panel.footer': 'One member can only have one open ticket · close yours before opening a new one',
  'ticket.button.create': 'Create Ticket',
  'ticket.button.claim': 'Claim',
  'ticket.button.close': 'Close Ticket',
  'ticket.opened.title': '🎫 Ticket {id} opened',
  'ticket.opened.intro': 'Describe your issue here — the more detail you give, the faster staff can help.',
  'ticket.opened.opener': 'Opened by',
  'ticket.opened.staff': 'Staff',
  'ticket.opened.subject': 'Subject',
  'ticket.opened.noSubject': '*not provided*',
  'ticket.closed.title': '🔒 Ticket {id} closed',
  'ticket.closed.description': 'This channel is locked and can no longer be used. Its history is kept here for staff to read.',
  'ticket.closed.by': 'Closed by',
  'ticket.list.title': '🎫 Open Tickets',
  'ticket.list.empty': 'No open tickets. Nice!',
  'ticket.list.channelGone': '*channel missing*',
  'ticket.list.claimer': ' · handled by <@{user}>',
  'ticket.list.subject': ' — {subject}',
  'ticket.list.line': '**{id}** {channel} · <@{opener}>{subject}\n< <t:{created}:R>{claimer}',
  'ticket.list.more': '\n\n*+{count} more tickets not shown.*',
  'ticket.list.footer': '{count} open tickets',
  'ticket.transcript.title': '📄 Ticket Transcript {id}',
  'ticket.transcript.ticketField': 'Ticket',
  'ticket.transcript.noSubject': '*no subject*',
  'ticket.transcript.openerLine': 'Opened by: <@{user}>',
  'ticket.transcript.closedLine': 'Closed: <t:{time}:f>',
  'ticket.transcript.openStatus': 'Status: still open',
  'ticket.transcript.contentField': 'Contents',
  'ticket.transcript.count': '{count} messages stored',
  'ticket.transcript.truncatedTitle': '⚠️ Truncated',
  'ticket.transcript.truncatedBody': 'Only the last {max} messages were stored.',
  'ticket.transcript.previewHeader': '**Last {count} messages**\n{lines}',
  'ticket.transcript.header': 'Ticket Transcript {id}',
  'ticket.transcript.subjectLine': 'Subject: {subject}',
  'ticket.transcript.opener': 'Opened by: {id}',
  'ticket.transcript.openedAt': 'Opened: {time}',
  'ticket.transcript.closedAt': 'Closed: {time}',
  'ticket.transcript.savedCount': 'Messages stored: {count}',
  'ticket.transcript.empty': '(no readable messages)',
  'ticket.transcript.entry': '[{time}] {author} ({id}): {text}',
  'ticket.transcript.attachment': '    attachment: {url}',
  'ticket.transcript.truncatedNote': 'Note: the transcript was truncated to the last {max} messages;\nolder conversation was not stored.',
  'ticket.transcript.noText': '(no text)',
  'ticket.transcript.previewLine': '`{time} UTC` **{author}**: {text}',
  'ticket.err.notCached': 'This server is not fully cached yet, so ticket commands are not ready. Try again in a moment.',
  'ticket.err.moduleOff': 'The ticket module is off.\nTurn it on with `/config set tickets:true` first.',
  'ticket.err.moduleOffTitle': '❌ Module Off',
  'ticket.err.noCategory': 'The ticket category is not set yet. Run `/ticket setup` first.',
  'ticket.err.noStaffRole': 'The ticket staff role is not set yet. Run `/ticket setup` first.',
  'ticket.err.subjectTooShort': 'Write a ticket subject of at least {min} characters, so staff know what to help with.',
  'ticket.err.alreadyClosed': 'This ticket is already closed.',
  'ticket.err.dbOffline': 'The database cannot be reached, so the ticket cannot be recorded.\nCheck `DATABASE_URL` in .env and your internet connection; `npm run infra:up` only applies when using a local Postgres.',
  'ticket.err.dbOfflineTitle': '❌ Database Offline',
  'ticket.err.generic': 'Something went wrong while processing the ticket. Details were written to the bot log.',
  'ticket.err.channelFailed': 'Could not create the ticket channel. Make sure I have the **Manage Channels** permission and the configured ticket category still exists.',
  'ticket.btn.claimNotStaff': 'Only ticket staff can claim this ticket.',
  'ticket.btn.claimed': 'Ticket {number} is now handled by <@{user}>.',
  'ticket.btn.closeNotAllowed': 'Only staff or the ticket opener can close it.',
  'ticket.btn.closed': 'Ticket {number} closed and archived. Its contents are kept.',
  'ticket.btn.closedChannelGone': 'Ticket {number} is marked closed, but its channel could not be archived (it may have been deleted manually). Check the data.',
  'ticket.modal.title': 'Create Ticket',
  'ticket.modal.subjectLabel': 'Ticket subject',
  'ticket.modal.subjectPlaceholder': 'Example: cannot join a voice channel',
  'ticket.modal.openFailed': 'Could not open the ticket form. Try again in a moment.',
  'ticket.modal.duplicateWithChannel': 'You already have an open ticket: <#{channel}>. Close it before opening a new one.',
  'ticket.modal.duplicate': 'You already have an open ticket. Close it before opening a new one.',
  'ticket.modal.created': 'Ticket created: <#{channel}>. Subject: **{subject}**',
  'ticket.cmd.noTicket': 'Ticket not found. Run this inside the ticket channel, or name its number with `/ticket transcript ticket:7`.',
  'ticket.cmd.transcriptDenied': 'This transcript can only be read by ticket staff or the member who opened it.',
  'ticket.cmd.noTranscript': 'No transcript is available for this ticket. It may have been closed before the transcript feature existed, its channel may have been deleted manually, or reading its messages failed.',
  'ticket.cmd.noTranscriptTitle': '📄 Transcript Not Available',
  'ticket.cmd.noOpenHere': 'There is no open ticket in this channel. Run this command inside its ticket channel.',
  'ticket.cmd.closedChannelGone': 'Ticket {number} is marked closed, but its channel could not be archived (it was likely deleted manually).',
  'ticket.cmd.closed': 'Ticket {number} closed and archived.',
  'ticket.cmd.noPanelChannel': 'The ticket panel channel cannot be posted to. Make sure it still exists and is a text channel.',
  'ticket.cmd.setupDone': 'Tickets are ready. The panel was sent to <#{channel}>.',
  'ticket.cmd.panelResent': 'The ticket panel was sent again to <#{channel}>.',
  'ticket.cmd.panelTitle': '🎫 Tickets Ready',
  'ticket.audit.closed': 'Ticket closed',
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