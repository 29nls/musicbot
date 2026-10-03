-- Samakan default kolom dengan schema.prisma.
--
-- Default di database masih versi M5 (enam kunci, tanpa `customCommands`),
-- sedangkan schema.prisma sudah menambah `customCommands`. Baris yang lahir
-- karena default lama akan punya JSON tanpa kunci itu. Dulu ini tidak
-- berbahaya: `toWrite()` di src/modules/config/mapping.ts selalu menulis
-- objek lengkap, jadi kolom default praktis tidak pernah dipakai. Sekarang
-- selisihnya muncul sebagai drift di `prisma migrate diff`, dan drift itu
-- yang membuat migrasi tak terduga di kemudian hari.
--
-- SQL di bawah diambil apa adanya dari:
--   npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script

-- AlterTable
ALTER TABLE "guild_config" ALTER COLUMN "modulesEnabled" SET DEFAULT '{"music": true, "moderation": true, "automod": false, "logging": false, "reactions": false, "tickets": false, "customCommands": false}';