#!/usr/bin/env bash
# Sabotase berkas tes baru yang belum punya harness: member lifecycle,
# custom command trigger, event loader, perintah musik/core, wiring service,
# dan penjaga bootstrap.
set -u
cd "$(git rev-parse --show-toplevel)"

pass=0; fail=0

# Jalankan satu berkas tes dan periksa statusnya.
run_test() {
  local test="$1"
  npx vitest run "$test" > /tmp/sab3.log 2>&1
  local code=$?
  if [ "$code" -ne 0 ]; then
    echo "  OK    tes gagal seperti seharusnya (exit $code)"; pass=$((pass+1))
  else
    echo "  GAGAL TES MASIH HIJAU"; fail=$((fail+1)); tail -25 /tmp/sab3.log
  fi
}

# Sabotase satu berkas lewat pengganti persis. Pola yang tidak cocok dianggap
# kegagalan, bukan suns_rand: `perl -0pi -e "s/\Q..\E/../"` gagal diam-diam
# kalau polanya punya karakter khusus, dan kasusnya lalu dilaporkan sebagai
# "penjaga tidak bergigi" padahal berkasnya utuh.
b64() { printf '%s' "$1" | base64 -w0; }

sabotage() {
  local file="$1" from="$2" to="$3"
  node tools/sab-patch.cjs "$file" "$(b64 "$from")" "$(b64 "$to")" > /dev/null 2>/tmp/sabpatch.err
  local code=$?
  if [ "$code" -ne 0 ]; then
    echo "  GAGAL pola tidak diterapkan di $file"
    cat /tmp/sabpatch.err
    return 1
  fi
  return 0
}


backup_and_track() {
  local name="$1" file="$2"
  mkdir -p /tmp/sabbak
  cp "$file" "/tmp/sabbak/$name"
  echo "$file" >> /tmp/sabbak/files.txt
}

case_sab() {
  local label="$1" test="$2" file="$3" from="$4" to="$5"
  backup_and_track "$(basename "$file")" "$file"
  if ! sabotage "$file" "$from" "$to"; then restore_all; return; fi
  echo "  -- $label"
  run_test "$test"
  restore_all
}

restore_all() {
  for f in $(cat /tmp/sabbak/files.txt 2>/dev/null); do
    cp "/tmp/sabbak/$(basename "$f")" "$f"
  done
  : > /tmp/sabbak/files.txt
}

rm -rf /tmp/sabbak; mkdir -p /tmp/sabbak; : > /tmp/sabbak/files.txt

echo "== memberLifecycle =="
case_sab "sapaan dikirim ke channel yang dikonfigurasi" \
  tests/memberLifecycle.test.ts src/events/guildMemberAdd.ts \
  "await sendGuildEmbed(guild, config.welcomeChannelId, embed);" "void embed;"
case_sab "konfigurasi gagal tidak lagi diam" \
  tests/memberLifecycle.test.ts src/events/guildMemberAdd.ts \
  "      logger.warn({ err: error, guild: guild.id }, 'Konfigurasi tidak terbaca saat member join');
      return;" "      throw error;"
case_sab "perpisahan dikirim" \
  tests/memberLifecycle.test.ts src/events/guildMemberRemove.ts \
  "await sendGuildEmbed(guild, config.goodbyeChannelId, embed);" "void embed;"
case_sab "autorole diberikan tanpa izin Manage Roles" \
  tests/memberLifecycle.test.ts src/events/guildMemberAdd.ts \
  "    if (!me.permissions.has(PermissionFlagsBits.ManageRoles)) {" "    if (false) {"

echo "== customCommandTrigger =="
case_sab "pesan biasa ikut membaca konfigurasi" \
  tests/customCommandTrigger.test.ts src/events/messageCreateCustomCommand.ts \
  "    if (!message.inGuild() || message.author.bot || message.system || message.partial) return;" ""
case_sab "bot tetap membalas tanpa izin kirim" \
  tests/customCommandTrigger.test.ts src/events/messageCreateCustomCommand.ts \
  "      !myPermissions.has(PermissionFlagsBits.SendMessages)" "      false"
case_sab "cooldown diabaikan" \
  tests/customCommandTrigger.test.ts src/events/messageCreateCustomCommand.ts \
  "    if (remaining > 0) {" "    if (false) {"
case_sab "mention dibebaskan ke semua orang" \
  tests/customCommandTrigger.test.ts src/events/messageCreateCustomCommand.ts \
  "allowedMentions: { parse: ['users'] }" "allowedMentions: { parse: ['everyone'] }"

echo "== eventLoader =="
case_sab "error sinkron tidak dibungkus" \
  tests/eventLoader.test.ts src/handlers/eventHandler.ts \
  "      } catch (error) {
        reportFailure(error);
      }" "      }"
case_sab "modul tak valid diterima diam-diam" \
  tests/eventLoader.test.ts src/handlers/eventHandler.ts \
  "      throw new Error(\`Modul event tidak valid (butuh default export { name, execute }): \${file}\`);" "      continue;"
case_sab "once dipasang ke semua event" \
  tests/eventLoader.test.ts src/handlers/eventHandler.ts \
  "if (event.once) client.once(event.name, listener);" "client.once(event.name, listener);"

echo "== musicCommands =="
case_sab "perintah musik menulis penolakan ke channel" \
  tests/musicCommands.test.ts src/commands/music/_shared.ts \
  "await interaction.followUp({ embeds: [embed], flags: MessageFlags.Ephemeral });" \
  "await interaction.editReply({ embeds: [embed] });"
case_sab "/shuffle mengklaim berhasil walau antrean terlalu pendek" \
  tests/musicCommands.test.ts src/commands/music/shuffle.ts \
  "        shuffled <= 1" "        shuffled < 0"
case_sab "/disconnect mengklaim keluar walau sudah di luar" \
  tests/musicCommands.test.ts src/commands/music/disconnect.ts \
  "        : t('music.disconnect.nowhere');" "        : t('music.disconnect.left');"
case_sab "/ping tidak ephemeral" \
  tests/musicCommands.test.ts src/commands/core/ping.ts \
  "await interaction.reply({ content: t('ping.measuring'), flags: MessageFlags.Ephemeral });" \
  "await interaction.reply({ content: t('ping.measuring') });"

echo "== serviceWiring =="
case_sab "singleton tidak lagi satu instance" \
  tests/serviceWiring.test.ts src/modules/moderation/index.ts \
  "  if (!service) {
    service = new ModerationService(new PrismaModerationRepository(getPrisma()));
  }" "  service = new ModerationService(new PrismaModerationRepository(getPrisma()));"
case_sab "error validasi reaction role jadi pesan umum" \
  tests/serviceWiring.test.ts src/modules/reactionroles/errors.ts \
  "  if (error instanceof ReactionRoleValidationError || error instanceof ReactionRoleEmptyError) {" "  if (false) {"
case_sab "database mati diperlakukan sebagai error umum" \
  tests/serviceWiring.test.ts src/modules/reactionroles/errors.ts \
  "  if (isDatabaseUnavailableError(error)) {" "  if (false) {"

echo "== bootstrapWiring =="
case_sab "store dibangun setelah client" \
  tests/bootstrapWiring.test.ts src/index.ts \
  "  keyValueStore = await createKeyValueStore();" "  // dipindah"
case_sab "gerbang sharding dilewati" \
  tests/bootstrapWiring.test.ts src/index.ts \
  "  assertShardingReady({" "  const _skip = (() => ({})) as unknown as typeof assertShardingReady;
  void _skip;
  const _unused = (x: unknown) => x;
  void _unused;
  if (false) assertShardingReady({"
case_sab "shutdown tidak menghentikan job retensi" \
  tests/bootstrapWiring.test.ts src/index.ts \
  "    retentionJob?.stop();" ""
case_sab "metrik shard menangkap store, bukan membacanya" \
  tests/bootstrapWiring.test.ts src/index.ts \
  "    store: () => getKeyValueStore()," "    store: getKeyValueStore(),"

echo ""
echo "sabotase berkas baru: $pass berhasil, $fail tidak bergigi"
rm -rf /tmp/sabbak
[ "$fail" -eq 0 ]