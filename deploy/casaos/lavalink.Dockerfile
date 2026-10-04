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
RUN mkdir -p /opt/Lavalink/logs /opt/Lavalink/plugins