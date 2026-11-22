-- CreateTable
CREATE TABLE "giveaway" (
    "id" SERIAL NOT NULL,
    "guildId" VARCHAR(20) NOT NULL,
    "channelId" VARCHAR(20) NOT NULL,
    "messageId" VARCHAR(20),
    "prize" VARCHAR(200) NOT NULL,
    "winnersCount" INTEGER NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "giveaway_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "giveaway_entry" (
    "id" SERIAL NOT NULL,
    "giveawayId" INTEGER NOT NULL,
    "userId" VARCHAR(20) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "giveaway_entry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "giveaway_guildId_createdAt_idx" ON "giveaway"("guildId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "giveaway_endedAt_endsAt_idx" ON "giveaway"("endedAt", "endsAt");

-- CreateIndex
CREATE UNIQUE INDEX "giveaway_entry_giveawayId_userId_key" ON "giveaway_entry"("giveawayId", "userId");

-- CreateIndex
CREATE INDEX "giveaway_entry_userId_idx" ON "giveaway_entry"("userId");

-- AddForeignKey
ALTER TABLE "giveaway_entry" ADD CONSTRAINT "giveaway_entry_giveawayId_fkey" FOREIGN KEY ("giveawayId") REFERENCES "giveaway"("id") ON DELETE CASCADE ON UPDATE CASCADE;
