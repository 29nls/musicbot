# Image Lavalink untuk CasaOS/ZimaOS.
#
# Kenapa image turunan, bukan bind mount:
#
# Di CasaOS, compose diletakkan di /DATA/AppData/<app>/ dan repositori hanya
# di-*clone* saat build. File `lavalink/application.yml` ikut ter-clone saat itu,
# tapi folder build dihapus sesudahnya — sehingga `volumes: ./lavalink/...`
# akan menunjuk ke berkas yang sudah tidak ada, dan container Lavalink gagal
# start dengan error yang tidak nyambung ke penyebabnya.
#
# `application.yml` sendiri **ikut dilacak Git**, jadi aman dimasukan ke image.
# Yang tidak ikut (Lavalink.jar) hanya dipakai untuk menjalankan Lavalink dari
# host saat pengembangan, bukan lewat image ini.

FROM ghcr.io/lavalink-devs/lavalink:4-alpine

# File konfigurasi sudah ada di image dasar dengan isi bawaan; menggantinya
# dengan milik repo membuat password & daftar plugin ikut terbawa.
COPY lavalink/application.yml /opt/Lavalink/application.yml

# Folder log & plugin tetap berupa named volume di compose supaya isinya
# bertahan melewati update image.
RUN mkdir -p /opt/Lavalink/logs /opt/Lavalink/plugins /opt/Lavalink/attachments \
 && chmod 0777 /opt/Lavalink/attachments

# apk butuh root; image dasar berjalan sebagai user `lavalink`.
USER root

# yt-dlp dipasang lewat pip, bukan paket Alpine: paket `yt-dlp` di Alpine 3.20
# (base image Lavalink ini) tertinggal di 2024.x, di bawah batas minimum
# 2026.08.19 yang terukur bisa mengekstrak audio YouTube, dan gejalanya adalah
# "Requested format is not available" saat memutar lagu. pip menyediakan rilis
# terbaru yang kompatibel dengan Python 3.12 di image ini.
#
# Biner ini tetap diperlukan supaya sumber `lavasrc.sources.ytdlp` punya
# binernya: image resmi Lavalink tidak memuatnya, dan tanpa biner itu pencarian
# `ytsearch:` kembali dilayani youtube-plugin -- yang kliennya ditolak YouTube
# untuk lagu musik ("This video requires login", lihat bagian "Musik tidak bisa
# dimuat" di README.md).
RUN apk add --no-cache python3 py3-pip \
 && python3 -m pip install --break-system-packages --no-cache-dir 'yt-dlp>=2026.08.19'

# Kembalikan ke user bawaan image supaya runtime tidak berjalan sebagai root.
USER lavalink