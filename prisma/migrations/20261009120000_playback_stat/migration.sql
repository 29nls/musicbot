-- CreateTable
CREATE TABLE "playback_stat" (
    "id" SERIAL NOT NULL,
    "guildId" VARCHAR(20) NOT NULL,
    "kind" VARCHAR(20) NOT NULL,
    "key" VARCHAR(200) NOT NULL,
    "label" VARCHAR(200) NOT NULL,
    "day" DATE NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "listenedMs" BIGINT NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "playback_stat_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "playback_stat_guildId_kind_key_day_key" ON "playback_stat"("guildId", "kind", "key", "day");

-- CreateIndex
CREATE INDEX "playback_stat_guildId_kind_day_idx" ON "playback_stat"("guildId", "kind", "day");

-- CreateIndex
CREATE INDEX "playback_stat_guildId_kind_count_idx" ON "playback_stat"("guildId", "kind", "count" DESC);