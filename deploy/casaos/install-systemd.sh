#!/usr/bin/env bash
# Memasang Harmony sebagai layanan systemd untuk jalur TANPA Docker.
#
#   bash deploy/casaos/install-systemd.sh              # sebagai root
#   bash deploy/casaos/install-systemd.sh --dry-run    # lihat hasilnya saja, tanpa menyentuh /etc
#   bash deploy/casaos/install-systemd.sh --verify     # buktikan bot hidup lagi setelah dibunuh
#   bash deploy/casaos/install-systemd.sh --no-health-timer
#   bash deploy/casaos/install-systemd.sh --uninstall
#
# Cukup satu berkas yang disunting kalau perlu: berkas ini sendiri, lewat
# environment. Tidak ada berkas konfigurasi kedua yang harus dijaga sinkron.
#
#   HARMONY_USER=flow HARMONY_DIR=/DATA/AppData/harmony-dev \
#   NODE_BIN=/usr/local/bin/node NPM_BIN=/usr/bin/npm \
#   JAVA_BIN_DIR=/home/flow/jdk/jdk-21.0.5+11-jre/bin \
#   HEALTH_PORT=8080 bash deploy/casaos/install-systemd.sh
#
# Yang dipasang:
#   /etc/systemd/system/harmony-lavalink.service      mesin audio, dijalankan lebih dulu
#   /etc/systemd/system/harmony.service               bot
#   /etc/systemd/system/harmony-health.service|.timer pemeriksa /health tiap 5 menit
#   /usr/local/bin/harmony-check                      skrip yang dipanggil timer itu

set -euo pipefail

SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEMPLATE_DIR="${SELF_DIR}/systemd"
DEST="${DEST:-/etc/systemd/system}"
CHECK_DEST="${CHECK_DEST:-/usr/local/bin/harmony-check}"

DRY_RUN=0
UNINSTALL=0
HEALTH_TIMER=1
VERIFY=0

usage() {
  # Seluruh blok komentar di kepala berkas, apa pun panjangnya.
  awk 'NR == 1 { next } /^#/ { sub(/^# ?/, ""); print; next } { exit }' "${BASH_SOURCE[0]}"
}

for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --uninstall) UNINSTALL=1 ;;
    --verify) VERIFY=1 ;;
    --no-health-timer) HEALTH_TIMER=0 ;;
    --help|-h) usage; exit 0 ;;
    *) printf 'Gagal: argumen tidak dikenal: %s\n\n' "$arg" >&2; usage >&2; exit 1 ;;
  esac
done

say() { printf '%s\n' "$*"; }
die() { printf '\nGagal: %s\n\n' "$*" >&2; exit 1; }

if [ "$VERIFY" = 1 ] && [ "$DRY_RUN" = 1 ]; then
  die "--verify dan --dry-run tidak bisa digabung: --verify menguji unit yang benar-benar berjalan."
fi

# ── nilai yang disubstitusikan ──────────────────────────────────────────────

HARMONY_DIR="${HARMONY_DIR:-$(cd "${SELF_DIR}/../.." && pwd)}"

if [ -z "${HARMONY_USER:-}" ]; then
  if [ -n "${SUDO_USER:-}" ]; then
    HARMONY_USER="$SUDO_USER"
  else
    HARMONY_USER="$(stat -c %U "$HARMONY_DIR" 2>/dev/null || id -un)"
  fi
fi

NODE_BIN="${NODE_BIN:-$(command -v node || true)}"
NPM_BIN="${NPM_BIN:-$(command -v npm || true)}"

# Direktori JRE: JAVA_HOME menang, lalu `java` dari PATH, terakhir pola yang
# dipakai panduan "JRE diunduh ke $HOME" di README.
JAVA_BIN_DIR="${JAVA_BIN_DIR:-}"
if [ -z "$JAVA_BIN_DIR" ] && [ -n "${JAVA_HOME:-}" ]; then
  JAVA_BIN_DIR="${JAVA_HOME}/bin"
fi
if [ -z "$JAVA_BIN_DIR" ] && command -v java >/dev/null 2>&1; then
  JAVA_BIN_DIR="$(dirname "$(command -v java)")"
fi
if [ -z "$JAVA_BIN_DIR" ]; then
  JAVA_BIN_DIR="$(ls -d "${HOME}"/jdk/jdk-*-jre/bin 2>/dev/null | head -1 || true)"
fi

# PATH untuk unit Lavalink. Direktori diurutkan tanpa duplikat supaya berkas
# hasilnya enak dibaca.
PATH_VALUE=""
for part in "$JAVA_BIN_DIR" \
  "$(dirname "${NODE_BIN:-/nonexistent}")" \
  "$(dirname "${NPM_BIN:-/nonexistent}")" \
  /usr/local/bin /usr/bin /bin; do
  [ -n "$part" ] || continue
  case ":${PATH_VALUE}:" in *":${part}:"*) continue ;; esac
  PATH_VALUE="${PATH_VALUE:+${PATH_VALUE}:}${part}"
done

# Port health: dari .env kalau ada, karena itu yang benar-benar didengarkan bot.
HEALTH_PORT="${HEALTH_PORT:-}"
if [ -z "$HEALTH_PORT" ] && [ -f "${HARMONY_DIR}/.env" ]; then
  HEALTH_PORT="$(sed -n 's/^[[:space:]]*HEALTH_PORT[[:space:]]*=[[:space:]]*//p' "${HARMONY_DIR}/.env" \
    | tail -1 | tr -d '"'"'"'[:space:]')"
fi
HEALTH_PORT="${HEALTH_PORT:-8080}"
case "$HEALTH_PORT" in ''|*[!0-9]*) die "HEALTH_PORT tidak masuk akal: ${HEALTH_PORT}" ;; esac

# ── pemeriksaan sebelum menyentuh apa pun ───────────────────────────────────

[ -f "${TEMPLATE_DIR}/harmony.service" ] || die "template tidak ditemukan di ${TEMPLATE_DIR}"
[ -d "$HARMONY_DIR" ] || die "HARMONY_DIR tidak ada: ${HARMONY_DIR}"
[ -f "${HARMONY_DIR}/package.json" ] || die "${HARMONY_DIR} bukan checkout repo (package.json tidak ada)"
[ -n "$NODE_BIN" ] || die "node tidak ditemukan. Set NODE_BIN=/path/ke/node."
[ -n "$NPM_BIN" ] || die "npm tidak ditemukan. Set NPM_BIN=/path/ke/npm."

if [ "$DRY_RUN" = 0 ] && [ "$(id -u)" != 0 ]; then
  die "Butuh root: menulis ke ${DEST}, memanggil systemctl, dan (pada --verify)
mengirim sinyal ke proses milik user lain.
  Jalankan ulang:
      sudo bash ${SELF_DIR}/$(basename "${BASH_SOURCE[0]}")${VERIFY:+ --verify}"
fi

# .env wajib: `EnvironmentFile=` yang menunjuk berkas tidak ada membuat systemd
# MENOLAK start unit-nya, dan pesannya baru muncul di journalctl nanti.
[ -f "${HARMONY_DIR}/.env" ] || die "${HARMONY_DIR}/.env tidak ada.
  Unit bot memakai EnvironmentFile= ke berkas itu, dan systemd menolak start
  kalau berkasnya tidak ada. Salin .env.example lebih dulu dan isi nilainya."
if [ ! -f "${HARMONY_DIR}/dist/index.js" ]; then
  say "PERINGATAN: ${HARMONY_DIR}/dist/index.js belum ada."
  say "            Jalankan 'npm run build' sebelum start, atau unit bot akan gagal."
fi
NODE_MAJOR="$("$NODE_BIN" --version 2>/dev/null | sed 's/^v\([0-9]*\).*/\1/')"
case "$NODE_MAJOR" in ''|*[!0-9]*) : ;; *)
  [ "$NODE_MAJOR" -ge 22 ] || say "PERINGATAN: Node $( "$NODE_BIN" --version ) < 22; package.json menetapkan >=22."
  ;;
esac

# ── dry-run: hasilkan ke direktori sementara, cetak, jangan pasang ──────────

TMP_ROOT=""
if [ "$DRY_RUN" = 1 ]; then
  TMP_ROOT="$(mktemp -d)"
  DEST="${TMP_ROOT}/etc/systemd/system"
  CHECK_DEST="${TMP_ROOT}/usr/local/bin/harmony-check"
  mkdir -p "$DEST" "$(dirname "$CHECK_DEST")"
fi

# ── render ──────────────────────────────────────────────────────────────────

render() {
  local template="$1" output="$2" text
  text="$(cat "$template")"
  text="${text//@HARMONY_USER@/$HARMONY_USER}"
  text="${text//@HARMONY_DIR@/$HARMONY_DIR}"
  text="${text//@NODE_BIN@/$NODE_BIN}"
  text="${text//@NPM_BIN@/$NPM_BIN}"
  text="${text//@PATH_VALUE@/$PATH_VALUE}"
  text="${text//@HEALTH_PORT@/$HEALTH_PORT}"
  printf '%s\n' "$text" > "$output"
  # Asersi, bukan harapan: placeholder yang lolos berarti unit-nya menunjuk
  # path yang tidak ada, dan gagalnya baru terlihat saat boot.
  if grep -q '@[A-Z_]\{1,\}@' "$output"; then
    die "placeholder tersisa di ${output}: $(grep -o '@[A-Z_]\{1,\}@' "$output" | sort -u | tr '\n' ' ')"
  fi
}

install_units() {
  mkdir -p "$DEST"
  render "${TEMPLATE_DIR}/harmony-lavalink.service" "${DEST}/harmony-lavalink.service"
  render "${TEMPLATE_DIR}/harmony.service" "${DEST}/harmony.service"
  if [ "$HEALTH_TIMER" = 1 ]; then
    render "${TEMPLATE_DIR}/harmony-health.service" "${DEST}/harmony-health.service"
    render "${TEMPLATE_DIR}/harmony-health.timer" "${DEST}/harmony-health.timer"
    render "${TEMPLATE_DIR}/harmony-check.sh" "$CHECK_DEST"
    chmod 755 "$CHECK_DEST"
  fi
}

# ── --verify: buktikan bahwa unit yang hidup AKAN hidup lagi ───────────────

verify_recovery() {
  local unit="harmony" dep="harmony-lavalink" timeout="${VERIFY_TIMEOUT:-90}"
  local curl_bin=""
  command -v curl >/dev/null 2>&1 && curl_bin="$(command -v curl)"

  command -v systemctl >/dev/null 2>&1 || die "systemctl tidak ada, jadi tidak ada yang bisa diuji."

  local started dep_started
  started="$(systemctl is-active "$unit" 2>/dev/null || true)"
  dep_started="$(systemctl is-active "$dep" 2>/dev/null || true)"
  if [ "$started" != "active" ]; then
    die "Unit ${unit} berstatus '${started}', bukan 'active'.
  Yang bisa dibuktikan hanyalah unit yang SUDAH hidup; memperbaiki instalasi yang
  mati bukan pekerjaan pengujian ini.
      systemctl status ${unit} --no-pager
      journalctl -u ${unit} -n 30 --no-pager"
  fi

  local before_pid before_restarts
  before_pid="$(systemctl show -p MainPID --value "$unit" 2>/dev/null || true)"
  before_restarts="$(systemctl show -p NRestarts --value "$unit" 2>/dev/null || true)"
  if [ -z "$before_pid" ] || [ "$before_pid" = "0" ]; then
    die "MainPID ${unit} terbaca '${before_pid:-kosong}'; tidak ada proses untuk dibunuh."
  fi

  say "Membunuh pid ${before_pid} dengan SIGKILL — tanpa penutupan rapi, seperti crash."
  kill -9 "$before_pid" 2>/dev/null || die "tidak bisa mengirim SIGKILL ke pid ${before_pid}."
  say "Menunggu systemd menghidupkannya kembali (maksimal ${timeout}s; jeda ada di RestartSec unit)."
  say ""

  # Yang diperiksa PID BARU, bukan sekadar 'active': status bisa saja masih
  # terbaca dari keadaan sebelumnya, dan pemeriksaan yang selalu hijau tidak
  # membuktikan apa pun.
  local deadline active="" after_pid="" after_restarts=""
  deadline=$(( $(date +%s) + timeout ))
  while [ "$(date +%s)" -lt "$deadline" ]; do
    active="$(systemctl is-active "$unit" 2>/dev/null || true)"
    after_pid="$(systemctl show -p MainPID --value "$unit" 2>/dev/null || true)"
    after_restarts="$(systemctl show -p NRestarts --value "$unit" 2>/dev/null || true)"
    if [ "$active" = "active" ] && [ -n "$after_pid" ] && [ "$after_pid" != "0" ] \
      && [ "$after_pid" != "$before_pid" ]; then
      break
    fi
    sleep 1
  done

  local failed=0
  if [ "$active" = "active" ] && [ -n "$after_pid" ] && [ "$after_pid" != "0" ] \
    && [ "$after_pid" != "$before_pid" ]; then
    say "LULUS  proses hidup lagi sebagai pid ${after_pid} (sebelumnya ${before_pid})"
  else
    say "GAGAL  tidak ada pid baru setelah ${timeout}s (status: ${active:-?}, pid: ${after_pid:-kosong})"
    failed=1
  fi

  case "$before_restarts" in
    ''|*[!0-9]*)
      say "LEWAT  NRestarts tidak dilaporkan systemd ini, jadi asersi itu dilewati"
      ;;
    *)
      if [ "$after_restarts" != "$before_restarts" ]; then
        say "LULUS  NRestarts ${before_restarts} -> ${after_restarts} (yang merestart systemd, bukan proses yang selamat)"
      else
        say "GAGAL  NRestarts tetap ${before_restarts}; pid baru bisa berarti hal lain"
        failed=1
      fi
      ;;
  esac

  if [ -n "$curl_bin" ] && [ -n "$HEALTH_PORT" ] && [ "$HEALTH_PORT" != "0" ]; then
    local i=0 healthy=0
    while [ "$i" -lt 30 ]; do
      if "$curl_bin" -fsS -m 5 "http://127.0.0.1:${HEALTH_PORT}/health" >/dev/null 2>&1; then
        healthy=1
        break
      fi
      i=$((i + 1))
      sleep 1
    done
    if [ "$healthy" = 1 ]; then
      say "LULUS  /health menjawab di port ${HEALTH_PORT}"
    else
      # Peringatan, bukan kegagalan: yang dibuktikan mode ini adalah prosesnya
      # kembali, dan health server memang bisa dimatikan (HEALTH_PORT=0).
      say "PERINGATAN  prosesnya kembali tetapi /health belum menjawab di port ${HEALTH_PORT} (30s)"
    fi
  else
    say "LEWAT  pemeriksaan /health dilewati (HEALTH_PORT=${HEALTH_PORT:-kosong}, curl=${curl_bin:-tidak ada})"
  fi

  if [ "$(systemctl is-active "$dep" 2>/dev/null || true)" = "active" ]; then
    say "LULUS  ${dep} tetap active, jadi yang dibunuh memang hanya bot"
  else
    say "PERINGATAN  ${dep} tidak 'active' setelah uji; periksa terpisah"
  fi

  say ""
  if [ "$failed" = 0 ]; then
    say "TERBUKTI di mesin ini: bot hidup lagi tanpa disentuh, dan systemd yang melakukannya."
  else
    say "TIDAK TERBUKTI. Periksa: journalctl -u ${unit} -n 50 --no-pager"
  fi
  say ""
  say "Yang TIDAK dibuktikan di sini:"
  say "  - bot benar-benar melayani perintah Discord lagi (yang diperiksa /health)"
  say "  - pemulihan setelah NAS reboot; itu butuh reboot sungguhan"
  return $failed
}

if [ "$VERIFY" = 1 ]; then
  if verify_recovery; then exit 0; else exit 1; fi
fi

if [ "$UNINSTALL" = 1 ]; then
  if command -v systemctl >/dev/null 2>&1; then
    systemctl disable --now harmony-health.timer >/dev/null 2>&1 || true
    systemctl disable --now harmony harmony-lavalink >/dev/null 2>&1 || true
  fi
  rm -f "${DEST}/harmony.service" "${DEST}/harmony-lavalink.service" \
    "${DEST}/harmony-health.service" "${DEST}/harmony-health.timer" "$CHECK_DEST"
  command -v systemctl >/dev/null 2>&1 && systemctl daemon-reload || true
  say "Unit dihapus. Folder repo dan .env tidak disentuh."
  exit 0
fi

install_units

# ── yang dipakai untuk memasang ─────────────────────────────────────────────

say "Nilai yang dipakai:"
say "  HARMONY_USER = ${HARMONY_USER}"
say "  HARMONY_DIR  = ${HARMONY_DIR}"
say "  NODE_BIN     = ${NODE_BIN}"
say "  NPM_BIN      = ${NPM_BIN}"
say "  PATH (unit)  = ${PATH_VALUE}"
say "  HEALTH_PORT  = ${HEALTH_PORT}   (timer: $([ "$HEALTH_TIMER" = 1 ] && echo ya || echo tidak))"
say "  JRE          = ${JAVA_BIN_DIR:-(tidak terdeteksi — 'java' harus ada di PATH unit)}"
say ""

if [ "$DRY_RUN" = 1 ]; then
  say "Hasil render (mode --dry-run; tidak ada yang dipasang, tidak ada systemctl dipanggil):"
  for f in "${DEST}"/*; do
    say ""
    say "───── ${f#"${DEST}/"} ─────"
    cat "$f"
  done
  say ""
  say "───── harmony-check ─────"
  cat "$CHECK_DEST"
  say ""
  say "Catatan: pada pemasangan sungguhan, unit masuk ke /etc/systemd/system"
  say "         dan skripnya ke /usr/local/bin/harmony-check (mode 755)."
  [ -n "$TMP_ROOT" ] && rm -rf "$TMP_ROOT"
  exit 0
fi

say "Dipasang di ${DEST}."
say ""

if command -v systemctl >/dev/null 2>&1; then
  systemctl daemon-reload
  systemctl enable --now harmony-lavalink.service harmony.service
  if [ "$HEALTH_TIMER" = 1 ]; then
    systemctl enable --now harmony-health.timer
  fi
  say "Status:"
  systemctl status harmony-lavalink.service harmony.service --no-pager || true
  say ""
  say "Kalau unit gagal, penyebabnya ada di:"
  say "  journalctl -u harmony-lavalink -n 30 --no-pager"
  say "  journalctl -u harmony -n 30 --no-pager"
else
  say "systemctl tidak ada di lingkungan ini, jadi unit hanya ditulis ke ${DEST}."
fi
