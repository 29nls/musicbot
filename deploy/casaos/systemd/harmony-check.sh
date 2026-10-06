#!/bin/bash
# Pemeriksa /health Harmony untuk harmony-health.timer.
#
# Dipasang oleh deploy/casaos/install-systemd.sh sebagai /usr/local/bin/harmony-check
# (mode 755, dijalankan sebagai root oleh systemd).
#
# Kenapa menunggu DUA kegagalan berturut-turut: saat bot baru start, /health
# memang belum menjawab selama beberapa detik. Merestart pada kegagalan pertama
# berarti membunuh bot yang sedang menyala normal, dan itu lebih buruk daripada
# satu siklus pemeriksaan yang terlewat.
#
# Penandanya di /run karena tmpfs: hilang sendiri saat reboot, yang memang
# perilaku yang benar untuk sebuah penghitung kegagalan berturut-turut.
set -u

PORT=@HEALTH_PORT@
FLAG=/run/harmony-health-failed

if curl -fsS -m 10 "http://127.0.0.1:${PORT}/health" >/dev/null 2>&1; then
  rm -f "$FLAG"
  exit 0
fi

if [ -f "$FLAG" ]; then
  rm -f "$FLAG"
  systemctl restart harmony
else
  touch "$FLAG"
fi
