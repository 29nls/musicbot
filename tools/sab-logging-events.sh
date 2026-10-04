#!/usr/bin/env bash
# Sabotase tests/loggingEvents.test.ts: ubah src, WAJIB tes gagal.
set -u
cd "$(git rev-parse --show-toplevel)"

LOG=src/events/logging
TEST=tests/loggingEvents.test.ts
BACKUP=$(mktemp -d)

# Berkas yang boleh disabotase.
FILES="banAdd banRemove channelCreate channelDelete channelUpdate emojiCreate emojiDelete emojiUpdate guildUpdate memberAdd memberRemove memberUpdate messageBulkDelete messageDelete messageUpdate roleCreate roleDelete roleUpdate stickerCreate stickerDelete stickerUpdate voiceStateUpdate"

for f in $FILES; do cp "$LOG/$f.ts" "$BACKUP/$f.ts"; done

pass=0; fail=0

restore() {
  for f in $FILES; do cp "$BACKUP/$f.ts" "$LOG/$f.ts"; done
}

backup_of() { echo "$BACKUP/$(basename "$1" .ts).ts"; }

sabotage() {
  local file="$1" from="$2" to="$3"
  if ! grep -qF "$from" "$file"; then
    echo "  GAGAL pola tidak ditemukan: $from"
    return 1
  fi
  perl -0pi -e "s/\Q$from\E/$to/" "$file"
}

run_case() {
  local label="$1" file="$2"
  if cmp -s "$(backup_of "$file")" "$file"; then
    echo "  GAGAL $label -> berkas tidak berubah"; fail=$((fail+1)); restore; return
  fi
  npx vitest run "$TEST" > /tmp/sab3.log 2>&1
  local code=$?
  if [ "$code" -ne 0 ]; then
    echo "  OK    $label -> tes gagal (exit $code)"; pass=$((pass+1))
  else
    echo "  GAGAL $label -> TES MASIH HIJAU"; fail=$((fail+1)); tail -30 /tmp/sab3.log
  fi
  restore
}

# 1. emojiUpdate: penjaga "diam saat tidak berubah" dihapus.
sabotage "$LOG/emojiUpdate.ts" "    if (lines.length === 0) return;" "    if (false) return;" && \
run_case "emojiUpdate tidak diam saat tidak berubah" "$LOG/emojiUpdate.ts"

# 2. roleUpdate: penjaga diff dihapus.
sabotage "$LOG/roleUpdate.ts" "    if (lines.length === 0) return;" "    if (false) return;" && \
run_case "roleUpdate tidak diam saat tidak berubah" "$LOG/roleUpdate.ts"

# 3. guildUpdate: penjaga diff dihapus.
sabotage "$LOG/guildUpdate.ts" "    if (lines.length === 0) return;" "    if (false) return;" && \
run_case "guildUpdate tidak diam saat tidak berubah" "$LOG/guildUpdate.ts"

# 4. channelUpdate: penjaga diff dihapus.
sabotage "$LOG/channelUpdate.ts" "    if (lines.length === 0) return;" "    if (false) return;" && \
run_case "channelUpdate tidak diam saat tidak berubah" "$LOG/channelUpdate.ts"

# 5. messageUpdate: penjaga "isi sama" dihapus.
sabotage "$LOG/messageUpdate.ts" "    if (before === after) return;" "    if (false) return;" && \
run_case "messageUpdate mengirim tanpa perubahan" "$LOG/messageUpdate.ts"

# 6. channelDelete: DM tidak lagi dilewati.
sabotage "$LOG/channelDelete.ts" "    if (channel.isDMBased()) return;" "    if (false) return;" && \
run_case "channelDelete memproses DM" "$LOG/channelDelete.ts"

# 7. channelUpdate: DM tidak lagi dilewati.
sabotage "$LOG/channelUpdate.ts" "    if (newChannel.isDMBased() || oldChannel.isDMBased()) return;" "    if (false) return;" && \
run_case "channelUpdate memproses DM" "$LOG/channelUpdate.ts"

# 8. memberRemove: ban tidak lagi diabaikan (satu ban jadi dua baris).
sabotage "$LOG/memberRemove.ts" "    if (banEntry) return;" "    if (false) return;" && \
run_case "memberRemove dobel dengan guildBanAdd" "$LOG/memberRemove.ts"

# 9. banAdd: record tidak lagi diboloskan saat ada tautan kasus.
sabotage "$LOG/banAdd.ts" "      record: link === null," "      record: true," && \
run_case "banAdd mencatat ulang kasus" "$LOG/banAdd.ts"

# 10. memberUpdate: Case number hilang saat ada tautan.
sabotage "$LOG/memberUpdate.ts" "      caseNumber: link?.caseNumber ?? null," "      caseNumber: null," && \
run_case "memberUpdate kehilangan nomor kasus" "$LOG/memberUpdate.ts"

# 11. memberAdd: audit log dicari untuk manusia juga.
sabotage "$LOG/memberAdd.ts" "    const entry = member.user.bot" "    const entry = true || member.user.bot" && \
run_case "memberAdd mencari audit untuk manusia" "$LOG/memberAdd.ts"

# 12. messageBulkDelete: targetIddipaksa pada penulis pertama.
sabotage "$LOG/messageBulkDelete.ts" "      targetId: authorIds.length === 1 ? (authorIds[0] ?? null) : null," "      targetId: authorIds[0] ?? null," && \
run_case "messageBulkDelete menebak target" "$LOG/messageBulkDelete.ts"

# 13. stickerCreate: sticker tanpa guild diproses.
sabotage "$LOG/stickerCreate.ts" "    if (!sticker.guild) return;" "    if (false) return;" && \
run_case "stickerCreate memproses sticker tanpa guild" "$LOG/stickerCreate.ts"

# 14. voiceStateUpdate: perubahan tanpa channel tidak lagi diam.
sabotage "$LOG/voiceStateUpdate.ts" "    if (!joined && !left && !moved && changes.length === 0) return;" "    if (false) return;" && \
run_case "voiceStateUpdate mengirim tanpa perubahan" "$LOG/voiceStateUpdate.ts"

# 15. emojiCreate: kategori ROUTING salah (bukan yang di embed).
sabotage "$LOG/emojiCreate.ts" "dispatchLog(emoji.guild, 'server'," "dispatchLog(emoji.guild, 'member'," && \
run_case "emojiCreate kategori routing salah" "$LOG/emojiCreate.ts"

# 16. roleCreate: kategori ROUTING salah (bukan yang di embed).
sabotage "$LOG/roleCreate.ts" "dispatchLog(role.guild, 'role'," "dispatchLog(role.guild, 'server'," && \
run_case "roleCreate kategori routing salah" "$LOG/roleCreate.ts"

# 16b. roleCreate: kategori EMBED salah -> warna/footer tidak sesuai routing.
sabotage "$LOG/roleCreate.ts" "      category: 'role'," "      category: 'server'," && \
run_case "roleCreate kategori embed salah" "$LOG/roleCreate.ts"

# 16c. memberAdd: kategori routing salah.
sabotage "$LOG/memberAdd.ts" "dispatchLog(member.guild, 'member'," "dispatchLog(member.guild, 'role'," && \
run_case "memberAdd kategori routing salah" "$LOG/memberAdd.ts"

# 17. messageUpdate: pesan luar server ikut diproses.
sabotage "$LOG/messageUpdate.ts" "    if (!newMessage.inGuild()) return;" "    if (false) return;" && \
run_case "messageUpdate memproses pesan luar server" "$LOG/messageUpdate.ts"

# 18. memberUpdate: member parsial ikut dibandingkan.
sabotage "$LOG/memberUpdate.ts" "    if (!oldMember.partial) {" "    if (true) {" && \
run_case "memberUpdate membandingkan member parsial" "$LOG/memberUpdate.ts"

echo ""
echo "sabotase logging events: $pass berhasil, $fail tidak bergigi"
rm -rf "$BACKUP"
[ "$fail" -eq 0 ]