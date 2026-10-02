-- CreateTable
CREATE TABLE "playlist" (
    "id" SERIAL NOT NULL,
    "guildId" VARCHAR(20) NOT NULL,
    "ownerId" VARCHAR(20) NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "tracks" JSONB NOT NULL DEFAULT '[]',
    "isPublic" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "playlist_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "playlist_guildId_ownerId_name_key" ON "playlist"("guildId", "ownerId", "name");

-- CreateIndex
CREATE INDEX "playlist_guildId_ownerId_idx" ON "playlist"("guildId", "ownerId");
