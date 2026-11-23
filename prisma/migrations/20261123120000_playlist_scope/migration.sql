-- Playlist personal dashboard bisa dibuka lintas guild. Baris lama tetap
-- `server`, jadi perilaku `/playlist` tidak berubah.
ALTER TABLE "playlist" ADD COLUMN "scope" VARCHAR(10) NOT NULL DEFAULT 'server';

CREATE INDEX "playlist_ownerId_scope_idx" ON "playlist"("ownerId", "scope");
